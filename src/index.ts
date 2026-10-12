#!/usr/bin/env bun
import { $ } from "bun";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "util";

const DEFAULT_HOST = "pi@zero.local";
const REMOTE_PROJECTS_ROOT = "/home/pi/projects";
const USAGE = "usage: pizdeploy [init|ps|start|stop|restart|status|logs|disable|remove|rm] [name] [--ssh <user@host>] [--dry-run]";

// Верификация службы: прямой запуск Node занимает ~5 с на Pi Zero, таймаут 60 с с запасом.
// Переменные окружения существуют только чтобы тесты не ждали минуту.
const VERIFY_TIMEOUT_MS = readNumberEnv("PIZDEPLOY_VERIFY_TIMEOUT_MS", 60_000);
const VERIFY_INTERVAL_MS = readNumberEnv("PIZDEPLOY_VERIFY_INTERVAL_MS", 5_000);
const STABLE_HOLD_MS = readNumberEnv("PIZDEPLOY_STABLE_HOLD_MS", 20_000);

type RemoteResult = { exitCode: number; stdout: string; stderr: string };

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Извлекает и адаптирует команду scripts.start; при отсутствии или пустом значении — undefined. */
export function resolveExecStart(pkg: unknown): string | undefined {
  const raw = (pkg as { scripts?: { start?: unknown } })?.scripts?.start;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // Адаптируем пути вида dist/... -> ... потому что WorkingDirectory указывает на распакованный dist
  let cmd = trimmed.replace(/\bdist\//g, "");

  // Нормализуем node -> /usr/bin/node для абсолютного пути в systemd ExecStart
  if (cmd.startsWith("node ") || cmd === "node") {
    cmd = "/usr/bin/" + cmd;
  }

  return cmd;
}

function normalizeService(name: string): string {
  return name.endsWith(".service") ? name : `${name}.service`;
}

/** Читае необязательный `pizdeploy.port`; при отсутствии — undefined. */
export function resolvePort(pkg: unknown): number | undefined {
  const raw = (pkg as { pizdeploy?: { port?: unknown } })?.pizdeploy?.port;
  const port = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

/** Имя пользователя, под которым идём по SSH (для linger). */
export function userFromHost(host: string): string | undefined {
  const at = host.lastIndexOf("@");
  return at === -1 ? undefined : host.slice(0, at);
}

function socketPathFor(host: string): string {
  return `/tmp/pizdeploy-${Buffer.from(host).toString("hex").slice(0, 16)}.sock`;
}

/** Общие опции `ssh`: нережимный вход + переиспользование соединения через ControlMaster. */
export function sshOptions(host: string, socketPath: string): string[] {
  const opts = [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=3",
    "-o", "ControlMaster=auto",
    "-o", `ControlPath=${socketPath}`,
    "-o", "ControlPersist=10s",
  ];
  if (!host.includes(":")) {
    opts.push("-o", "AddressFamily=inet");
  }
  return opts;
}

/** Опции `scp`: то же соединение, но мастер поднимает `ssh`. */
export function scpOptions(host: string, socketPath: string): string[] {
  const opts = [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=3",
    "-o", `ControlPath=${socketPath}`,
  ];
  if (!host.includes(":")) {
    opts.push("-o", "AddressFamily=inet");
  }
  return opts;
}

/**
 * Удалённая команда как отдельный вызов: вывод перехватывается, чтобы шаги
 * конвейера не печатали в stdout утилиты, и проверяется код возврата.
 */
async function remoteExec(sshOpts: string[], host: string, command: string): Promise<RemoteResult> {
  const proc = Bun.spawnSync(["ssh", ...sshOpts, host, command], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode ?? 1,
    stdout: proc.stdout?.toString() ?? "",
    stderr: proc.stderr?.toString() ?? "",
  };
}

async function closeControlMaster(host: string, socketPath: string): Promise<void> {
  await $`ssh -O exit -o ControlPath=${socketPath} ${host}`.quiet().nothrow();
}

/** Шаг конвейера: ненулевой код возврата обязан остановить деплой. */
async function runStep(
  sshOpts: string[],
  host: string,
  label: string,
  command: string
): Promise<number> {
  const res = await remoteExec(sshOpts, host, command);
  if (res.exitCode !== 0) {
    const reason = res.stderr.trim() || res.stdout.trim() || "сообщение не получено";
    console.error(`pizdeploy: шаг «${label}» завершился с кодом ${res.exitCode}: ${reason}`);
    return res.exitCode || 1;
  }
  return 0;
}

/**
 * Каноничный шаблон user-юнита: чтение systemd-unit.service из текущего проекта
 * или эталонного шаблона pizdeploy, с автоинжекцией WorkingDirectory и ExecStart.
 */
export function renderUnit(
  name: string,
  execStart: string,
  port?: number,
  customTemplatePath?: string
): string {
  let templateContent = "";
  const projectTemplate = customTemplatePath || resolve(process.cwd(), "systemd-unit.service");
  const fallbackTemplate = resolve(import.meta.dir, "..", "systemd-unit.service");

  if (existsSync(projectTemplate)) {
    templateContent = readFileSync(projectTemplate, "utf8");
  } else if (existsSync(fallbackTemplate)) {
    templateContent = readFileSync(fallbackTemplate, "utf8");
  } else {
    // Резервный встроенный шаблон на случай сборки в бинарник без внешних файлов
    templateContent = [
      "[Unit]",
      `Description=${name}`,
      "After=default.target",
      "",
      "[Service]",
      "Type=simple",
      "Restart=always",
      "RestartSec=2",
      'Environment="NODE_ENV=production"',
      "",
      "[Install]",
      "WantedBy=default.target",
    ].join("\n");
  }

  // Разбор на секции INI
  const sections: { name: string; lines: string[] }[] = [];
  let currentSection: { name: string; lines: string[] } | null = null;

  for (const rawLine of templateContent.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      currentSection = { name: trimmed, lines: [] };
      sections.push(currentSection);
    } else if (currentSection && trimmed.length > 0) {
      currentSection.lines.push(trimmed);
    }
  }

  // 1. Секция [Unit]
  let unitSec = sections.find((s) => s.name.toLowerCase() === "[unit]");
  if (!unitSec) {
    unitSec = { name: "[Unit]", lines: [`Description=${name}`, "After=default.target"] };
    sections.unshift(unitSec);
  } else {
    const descIdx = unitSec.lines.findIndex((l) => l.trim().startsWith("Description="));
    if (descIdx === -1) {
      unitSec.lines.unshift(`Description=${name}`);
    } else if (unitSec.lines[descIdx].trim() === "Description=app" && name !== "app") {
      unitSec.lines[descIdx] = `Description=${name}`;
    }
  }

  // 2. Секция [Service]
  let serviceSec = sections.find((s) => s.name.toLowerCase() === "[service]");
  if (!serviceSec) {
    serviceSec = {
      name: "[Service]",
      lines: ["Type=simple", "Restart=always", "RestartSec=2", 'Environment="NODE_ENV=production"'],
    };
    sections.push(serviceSec);
  }

  // Фильтруем любые старые WorkingDirectory= и ExecStart=
  serviceSec.lines = serviceSec.lines.filter((l) => {
    const t = l.trim();
    return !t.startsWith("WorkingDirectory=") && !t.startsWith("ExecStart=");
  });

  // Внедряем актуальные WorkingDirectory и ExecStart
  const injected = [
    `WorkingDirectory=${REMOTE_PROJECTS_ROOT}/${name}/current`,
    `ExecStart=${execStart}`,
  ];
  if (port) {
    const hasPortEnv = serviceSec.lines.some((l) => l.includes(`PORT=`));
    if (!hasPortEnv) {
      injected.push(`Environment="PORT=${port}"`);
    }
  }

  serviceSec.lines.unshift(...injected);

  // 3. Секция [Install]
  let installSec = sections.find((s) => s.name.toLowerCase() === "[install]");
  if (!installSec) {
    installSec = { name: "[Install]", lines: ["WantedBy=default.target"] };
    sections.push(installSec);
  } else {
    const hasWantedBy = installSec.lines.some((l) => l.trim().startsWith("WantedBy="));
    if (!hasWantedBy) {
      installSec.lines.push("WantedBy=default.target");
    }
  }

  // Сборка итогового файла
  const resultLines: string[] = [];
  for (const sec of sections) {
    resultLines.push(sec.name);
    for (const line of sec.lines) {
      resultLines.push(line);
    }
    resultLines.push("");
  }

  return resultLines.join("\n").replace(/\n+$/, "\n");
}

/**
 * Ленивое включение linger: перед установкой юнита. Идемпотентно и не требует
 * root для собственного пользователя; без него служба умирает после закрытия SSH.
 */
async function ensureLinger(sshOpts: string[], host: string, user: string): Promise<number> {
  const property = `loginctl show-user ${user} --property=Linger`;
  const before = await remoteExec(sshOpts, host, property);
  if (before.stdout.includes("Linger=yes")) return 0;

  const enable = await remoteExec(sshOpts, host, `loginctl enable-linger ${user}`);
  if (enable.exitCode !== 0) {
    console.error(
      `pizdeploy: не удалось включить автозапуск сессии пользователя ${user}: ${
        enable.stderr.trim() || `код ${enable.exitCode}`
      }`
    );
    return enable.exitCode || 1;
  }

  const after = await remoteExec(sshOpts, host, property);
  if (!after.stdout.includes("Linger=yes")) {
    console.error(`pizdeploy: автозапуск сессии ${user} остался выключенным (ожидался Linger=yes)`);
    return 1;
  }
  console.log(`🔓 Автозапуск пользовательской сессии ${user} включён`);
  return 0;
}

async function readRestarts(sshOpts: string[], host: string, service: string): Promise<number> {
  const res = await remoteExec(sshOpts, host, `systemctl --user show ${service} -p NRestarts --value`);
  const value = Number.parseInt(res.stdout.trim(), 10);
  return Number.isFinite(value) ? value : 0;
}

function portListenCheck(port: number): string {
  return `ss -tln 2>/dev/null | awk -v p=${port} '$4 ~ (":" p "$") {found=1} END {exit found ? 0 : 1}'`;
}

/**
 * Успех = служба `active` и (если порт известен) порт слушается.
 * Без порта — выдержка с проверкой, что служба не перезапускается.
 */
async function verifyService(
  sshOpts: string[],
  host: string,
  service: string,
  port: number | undefined
): Promise<{ ok: boolean; reason: string }> {
  const deadline = Date.now() + VERIFY_TIMEOUT_MS;
  const timeoutSec = Math.round(VERIFY_TIMEOUT_MS / 1000);

  let active = false;
  for (;;) {
    const res = await remoteExec(sshOpts, host, `systemctl --user is-active ${service}`);
    if (res.stdout.trim() === "active") {
      active = true;
      break;
    }
    if (Date.now() >= deadline) break;
    await Bun.sleep(VERIFY_INTERVAL_MS);
  }
  if (!active) {
    return { ok: false, reason: `служба ${service} не перешла в состояние active за ${timeoutSec} с` };
  }

  if (port) {
    for (;;) {
      const res = await remoteExec(sshOpts, host, portListenCheck(port));
      if (res.exitCode === 0) return { ok: true, reason: "" };
      if (Date.now() >= deadline) break;
      await Bun.sleep(VERIFY_INTERVAL_MS);
    }
    const seen = await remoteExec(
      sshOpts,
      host,
      `ss -tln 2>/dev/null | awk 'NR>1 {print $4}' | tr '\\n' ' '`
    );
    return {
      ok: false,
      reason: `порт ${port} никто не слушает; на хосте прослушиваются: ${seen.stdout.trim() || "ничего"}`,
    };
  }

  const before = await readRestarts(sshOpts, host, service);
  await Bun.sleep(STABLE_HOLD_MS);
  const after = await readRestarts(sshOpts, host, service);
  if (after > before) {
    return {
      ok: false,
      reason: `служба перезапустилась за выдержку (${before} → ${after} перезапусков) — приложение падает`,
    };
  }
  return { ok: true, reason: "" };
}

export type ServiceAction =
  | "start"
  | "stop"
  | "restart"
  | "status"
  | "logs"
  | "disable"
  | "remove"
  | "rm";

export async function handleServiceControl(
  host: string,
  action: ServiceAction,
  service: string,
  projectName?: string
): Promise<number> {
  const socketPath = socketPathFor(host);
  const sshOpts = sshOptions(host, socketPath);

  try {
    if (action === "status") {
      const res = await remoteExec(sshOpts, host, `systemctl --user status ${service}`);
      if (res.stdout) console.log(res.stdout.trimEnd());
      if (res.stderr) console.error(res.stderr.trimEnd());
      return res.exitCode;
    }

    if (action === "logs") {
      const res = await remoteExec(
        sshOpts,
        host,
        `journalctl --user -u ${service} -n 50 --no-pager`
      );
      if (res.stdout) console.log(res.stdout.trimEnd());
      if (res.stderr) console.error(res.stderr.trimEnd());
      return res.exitCode;
    }

    if (action === "remove" || action === "rm") {
      const proj = projectName || service.replace(/\.service$/, "");
      const remoteCmd = `
systemctl --user stop ${service} 2>/dev/null || true
systemctl --user disable ${service} 2>/dev/null || true
rm -f ~/.config/systemd/user/${service}
systemctl --user daemon-reload
rm -f ${REMOTE_PROJECTS_ROOT}/${proj}/current
`;
      const res = await remoteExec(sshOpts, host, remoteCmd);
      if (res.exitCode !== 0) {
        console.error(res.stderr.trim() || `Ошибка при удалении службы ${service}`);
        return res.exitCode || 1;
      }
      console.log(`🗑 Служба ${service} удалена и снята с учёта на ${host}`);
      return 0;
    }

    const remoteCmd = `if systemctl --user cat ${service} >/dev/null 2>&1; then systemctl --user ${action} ${service}; else echo "not_found"; exit 1; fi`;
    const res = await remoteExec(sshOpts, host, remoteCmd);
    if (res.exitCode !== 0) {
      if (res.stdout.includes("not_found")) {
        console.error(`pizdeploy: служба ${service} не найдена на ${host}`);
      } else {
        console.error(res.stderr.trim() || `Ошибка при выполнении ${action} ${service}`);
      }
      return res.exitCode || 1;
    }

    if (action === "start") {
      console.log(`▶️ Служба ${service} запущена на ${host}`);
    } else if (action === "stop") {
      console.log(`⏹ Служба ${service} остановлена на ${host}`);
    } else if (action === "restart") {
      console.log(`🔄 Служба ${service} перезапущена на ${host}`);
    } else if (action === "disable") {
      console.log(`🛑 Автозапуск службы ${service} отключен на ${host}`);
    }
    return 0;
  } finally {
    await closeControlMaster(host, socketPath);
  }
}

export function buildPsScript(): string {
  return `bash -c '
declare -A ports
while read -r _ _ _ addr _ proc; do
  port="\${addr##*:}"
  [[ "$proc" =~ pid=([0-9]+) ]] && ports["\${BASH_REMATCH[1]}"]="$port"
done < <(ss -tlpn 2>/dev/null)

first=1
printf "["
for p in /home/pi/projects/*; do
  [[ -d "$p" ]] || continue
  name="\${p##*/}"
  has_current=0
  rel="-"
  if [[ -L "$p/current" ]]; then
    has_current=1
    rel=$(basename "$(readlink -f "$p/current" 2>/dev/null)")
  fi
  m_pid="null"
  m_port="null"
  stat="inactive"
  for pid in "\${!ports[@]}"; do
    cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null)
    if [[ "$cwd" == "$p" || "$cwd" == "$p/"* ]]; then
      m_pid="$pid"
      m_port="\${ports[$pid]}"
      stat="running"
      break
    fi
  done
  if [[ "$stat" == "inactive" ]]; then
    astate=""
    main_pid="0"
    while IFS="=" read -r k v; do
      [[ "$k" == "ActiveState" ]] && astate="$v"
      [[ "$k" == "MainPID" ]] && main_pid="$v"
    done < <(systemctl --user show "\${name}.service" -p ActiveState -p MainPID 2>/dev/null)
    if [[ "$astate" == "active" && "$main_pid" =~ ^[0-9]+$ && "$main_pid" -gt 0 ]]; then
      stat="running"
      m_pid="$main_pid"
    fi
  fi
  [[ $has_current -eq 0 && "$stat" != "running" ]] && continue
  [[ $first -eq 0 ]] && printf ","
  first=0
  printf "{\\"project\\":\\"%s\\",\\"release\\":\\"%s\\",\\"status\\":\\"%s\\",\\"port\\":%s,\\"pid\\":%s}" \
    "$name" "$rel" "$stat" "$m_port" "$m_pid"
done
printf "]\\n"
'`;
}

export async function handlePs(host: string): Promise<number> {
  const socketPath = socketPathFor(host);
  const sshOpts = sshOptions(host, socketPath);
  const remoteBashScript = buildPsScript();

  try {
    const res = await remoteExec(sshOpts, host, remoteBashScript);
    if (res.exitCode !== 0) {
      console.error(res.stderr.trim() || "Ошибка при получении статуса сервисов");
      return res.exitCode || 1;
    }
    const rawText = res.stdout.trim();
    let data: Array<{
      project: string;
      release: string;
      status: string;
      port: string | null;
      pid: string | null;
    }> = [];

    try {
      data = JSON.parse(rawText || "[]");
    } catch {
      // При получении не-JSON ответа (например, в тестовых заглушках)
      data = [];
    }

    const hostname = host.replace(/^.*@/, "");
    const rows = data.map((item) => ({
      Project: item.project,
      Release: item.release,
      Status: item.status,
      URL: item.port ? `http://${hostname}:${item.port}` : "-",
      PID: item.pid || "-",
    }));

    console.table(rows);
    return 0;
  } finally {
    await closeControlMaster(host, socketPath);
  }
}

export async function handleInit(cwd: string = process.cwd()): Promise<number> {
  const pkgPath = resolve(cwd, "package.json");
  if (!existsSync(pkgPath)) {
    console.error("pizdeploy: в текущем каталоге не найден package.json.");
    console.error("Команда init предназначена для проектов с package.json, откуда берутся имя сервиса, скрипт запуска (scripts.start) и параметры хоста.");
    return 1;
  }

  const targetFile = resolve(cwd, "systemd-unit.service");
  if (existsSync(targetFile)) {
    console.log("ℹ️ Файл systemd-unit.service уже существует в текущем каталоге. Пропускаем создание.");
    return 0;
  }

  let pkgName = "app";
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg && typeof pkg.name === "string" && pkg.name.trim()) {
      pkgName = pkg.name.trim();
    }
  } catch {
    // Используем "app" при ошибке парсинга
  }

  const content = [
    "[Unit]",
    `Description=${pkgName}`,
    "After=default.target",
    "",
    "[Service]",
    "Type=simple",
    "Restart=always",
    "RestartSec=2",
    'Environment="NODE_ENV=production"',
    "# Добавьте переменные окружения и секреты:",
    '# Environment="BOT_TOKEN=..."',
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");

  writeFileSync(targetFile, content, "utf8");
  console.log(`✨ Создан шаблон systemd-unit.service для "${pkgName}".`);
  console.log("💡 WorkingDirectory и ExecStart указывать не нужно — pizdeploy настроит их автоматически при деплое.");
  return 0;
}

export async function main(argv: readonly string[] = Bun.argv.slice(2)): Promise<number> {
  let flagSsh: string | undefined;
  let dryRun = false;
  let command: "deploy" | "ps" | "init" | ServiceAction = "deploy";
  let targetServiceArg: string | undefined;

  const SERVICE_CMDS: readonly ServiceAction[] = [
    "start",
    "stop",
    "restart",
    "status",
    "logs",
    "disable",
    "remove",
    "rm",
  ];

  try {
    const parsed = parseArgs({
      args: [...argv],
      options: {
        ssh: { type: "string" },
        "dry-run": { type: "boolean" },
      },
      allowPositionals: true,
      strict: true,
    });
    flagSsh = parsed.values.ssh;
    dryRun = parsed.values["dry-run"] ?? false;
    const positionals = parsed.positionals;
    if (positionals.length === 0) {
      command = "deploy";
    } else if (positionals.length === 1 && positionals[0] === "init") {
      command = "init";
    } else if (positionals.length === 1 && positionals[0] === "ps") {
      command = "ps";
    } else if (
      SERVICE_CMDS.includes(positionals[0] as ServiceAction) &&
      positionals.length <= 2
    ) {
      command = positionals[0] as ServiceAction;
      targetServiceArg = positionals[1];
    } else {
      console.error(USAGE);
      return 2;
    }
  } catch {
    console.error(USAGE);
    return 2;
  }

  // Подкоманда init: подготовка шаблона службы в текущем каталоге
  if (command === "init") {
    return await handleInit();
  }

  const pkg = await Bun.file("package.json").json().catch(() => ({}));
  const host = flagSsh || pkg?.pizdeploy?.ssh || DEFAULT_HOST;
  const name: string = pkg?.name || "app";
  const port = resolvePort(pkg);
  const defaultService = normalizeService(pkg?.pizdeploy?.service || pkg?.name || "app");
  const service: string = targetServiceArg ? normalizeService(targetServiceArg) : defaultService;

  // Подкоманда ps: опрос состояния удаленных сервисов
  if (command === "ps") {
    if (!Bun.which("ssh")) {
      console.error("pizdeploy: ssh не найден в PATH. Установите OpenSSH.");
      return 127;
    }
    return await handlePs(host);
  }

  // Подкоманды управления службами на хосте
  if (SERVICE_CMDS.includes(command as ServiceAction)) {
    if (!Bun.which("ssh")) {
      console.error("pizdeploy: ssh не найден в PATH. Установите OpenSSH.");
      return 127;
    }
    const projName = targetServiceArg ? targetServiceArg.replace(/\.service$/, "") : name;
    return await handleServiceControl(host, command as ServiceAction, service, projName);
  }

  const projectDir = `${REMOTE_PROJECTS_ROOT}/${name}`;
  const incomingDir = `${projectDir}/incoming`;
  const releasesDir = `${projectDir}/releases`;
  const currentLink = `${projectDir}/current`;
  const unitDir = "~/.config/systemd/user";

  const execStart = resolveExecStart(pkg);

  // Режим dry-run: вывод плана без сборки и сетевых вызовов
  if (dryRun) {
    const relId = `${name}_mock5`;
    const releaseDir = `${releasesDir}/${relId}`;
    console.log(`[Dry-Run] Будет запущен bun run build, вычислен хэш архива и развернут релиз в: ${releaseDir}`);
    console.log(
      `[Dry-Run] Служба ${service} (user-юнит): ${execStart ?? "node index.js"} в ${projectDir}/current, ${
        port ? `проверка порта ${port}` : "порт не задан — проверка прослушивания пропускается"
      }`
    );
    return 0;
  }

  // Проверка зависимостей
  if (!Bun.which("ssh")) {
    console.error("pizdeploy: ssh не найден в PATH. Установите OpenSSH.");
    return 127;
  }
  if (!Bun.which("scp")) {
    console.error("pizdeploy: scp не найден в PATH. Установите OpenSSH.");
    return 127;
  }

  if (!execStart) {
    console.error("pizdeploy: в package.json отсутствует обязательный скрипт 'scripts.start'");
    return 1;
  }

  const ARCHIVE = "./dist.tar.gz";
  const socketPath = socketPathFor(host);
  const sshOpts = sshOptions(host, socketPath);
  const scpOpts = scpOptions(host, socketPath);

  try {
    // 1. Сборка
    const buildResult = await $`bun run build`.nothrow();
    if (buildResult.exitCode !== 0) return buildResult.exitCode;

    // 2. Упаковка
    const tarResult = await $`tar -czf ${ARCHIVE} -C ./dist .`.nothrow();
    if (tarResult.exitCode !== 0) return tarResult.exitCode;

    // 3. Хэш SHA-256 от архива
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(await Bun.file(ARCHIVE).bytes());
    const hash5 = hasher.digest("hex").slice(0, 5);

    const relId = `${name}_${hash5}`;
    const releaseDir = `${releasesDir}/${relId}`;

    // 4. Подготовка директорий incoming и releases на хосте (инициализирует ControlMaster)
    const mkdirCode = await runStep(sshOpts, host, "подготовка каталогов", `mkdir -p ${incomingDir} ${releasesDir}`);
    if (mkdirCode !== 0) return mkdirCode;

    // 5. Копирование архива в буфер incoming (по открытому сокету)
    const scpResult = await $`scp ${scpOpts} ${ARCHIVE} ${host + ":" + incomingDir + "/dist.tar.gz"}`
      .quiet()
      .nothrow();
    if (scpResult.exitCode !== 0) {
      console.error(`pizdeploy: не удалось передать архив на ${host}: ${scpResult.stderr.toString().trim()}`);
      return scpResult.exitCode;
    }

    // 6. Автозапуск пользовательской сессии (лениво, перед установкой юнита)
    const remoteUser = userFromHost(host) ?? (await remoteExec(sshOpts, host, "id -un")).stdout.trim();
    if (!remoteUser) {
      console.error("pizdeploy: не удалось определить пользователя на целевом хосте");
      return 1;
    }
    const lingerCode = await ensureLinger(sshOpts, host, remoteUser);
    if (lingerCode !== 0) return lingerCode;

    // 7. Распаковка в releases/<relId> (current ещё не трогаем)
    const extractCode = await runStep(
      sshOpts,
      host,
      "распаковка релиза",
      `mkdir -p ${releaseDir} && tar -xzf ${incomingDir}/dist.tar.gz -C ${releaseDir} && rm -f ${incomingDir}/dist.tar.gz`
    );
    if (extractCode !== 0) return extractCode;

    // 8. Предыдущий релиз нужен для отката при неподтверждённой активации
    const prev = await remoteExec(
      sshOpts,
      host,
      `test -L "${currentLink}" && readlink -f "${currentLink}" 2>/dev/null || true`
    );
    const prevTarget = prev.stdout.trim();

    // 9. Атомарное переключение current
    const switchCode = await runStep(
      sshOpts,
      host,
      "переключение current",
      `ln -sfn ${releaseDir} ${projectDir}/current_tmp && mv -fT ${projectDir}/current_tmp ${currentLink}`
    );
    if (switchCode !== 0) return switchCode;

    // 10. Запись сгенерированного юнита в каталог пользовательских юнитов
    const unit = renderUnit(name, execStart, port);
    const writeCode = await runStep(
      sshOpts,
      host,
      "запись user-юнита",
      `mkdir -p ${unitDir} && cat > ${unitDir}/${service} <<'PIZDEPLOY_UNIT'\n${unit}PIZDEPLOY_UNIT`
    );
    if (writeCode !== 0) return writeCode;

    // 11. Перечитываем конфигурацию пользовательского менеджера
    const reloadCode = await runStep(sshOpts, host, "daemon-reload", "systemctl --user daemon-reload");
    if (reloadCode !== 0) return reloadCode;

    // 12. Включаем автозапуск и стартуем
    const enableCode = await runStep(
      sshOpts,
      host,
      "включение службы",
      `systemctl --user enable --now ${service}`
    );
    if (enableCode !== 0) return enableCode;

    // 13. Верификация работоспособности; отказ = откат current
    const verdict = await verifyService(sshOpts, host, service, port);
    if (!verdict.ok) {
      console.error(`pizdeploy: деплой не подтверждён — ${verdict.reason}`);
      if (prevTarget && prevTarget !== currentLink) {
        await runStep(
          sshOpts,
          host,
          "откат current",
          `ln -sfn ${prevTarget} ${projectDir}/current_tmp && mv -fT ${projectDir}/current_tmp ${currentLink}`
        );
        console.error(`pizdeploy: current возвращён на ${prevTarget.split("/").pop()}`);
      } else {
        await runStep(
          sshOpts,
          host,
          "удаление current при первом деплое",
          `rm -f ${currentLink} ${projectDir}/current_tmp`
        );
        console.error("pizdeploy: предыдущего релиза нет — симлинк current удалён");
      }
      return 1;
    }

    // 14. Ротация: `|| true` допустим только здесь — сбой очистки не отменяет успех
    await remoteExec(
      sshOpts,
      host,
      `cd ${releasesDir} && ls -1d * 2>/dev/null | sort | head -n -3 | xargs rm -rf 2>/dev/null || true`
    );

    const hostname = host.replace(/^.*@/, "");
    console.log(`🎉 Успешно развернут релиз: ${relId}`);
    console.log(`   Служба: ${service} (systemctl --user, ${hostname})`);
    console.log(port ? `   URL: http://${hostname}:${port}` : "   порт не задан (pizdeploy.port) — проверка прослушивания пропущена");
    return 0;
  } finally {
    // Гарантированная очистка локального архива и закрытие мультиплекс-сессии
    await $`rm -f ${ARCHIVE}`.nothrow();
    await closeControlMaster(host, socketPath);
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}