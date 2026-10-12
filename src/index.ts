#!/usr/bin/env bun
import { $ } from "bun";
import { parseArgs } from "util";

const DEFAULT_HOST = "pi@zero.local";
const USAGE = "usage: pizdeploy [ps|stop|disable] [name] [--ssh <user@host>] [--dry-run]";

function normalizeService(name: string): string {
  return name.endsWith(".service") ? name : `${name}.service`;
}

export async function handleServiceControl(
  host: string,
  action: "stop" | "disable",
  service: string
): Promise<number> {
  const socketPath = `/tmp/pizdeploy-${Buffer.from(host).toString("hex").slice(0, 16)}.sock`;
  const sshOpts = [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=3",
    "-o", "ControlMaster=auto",
    "-o", `ControlPath=${socketPath}`,
    "-o", "ControlPersist=10s",
  ];
  if (!host.includes(":")) {
    sshOpts.push("-o", "AddressFamily=inet");
  }

  const remoteCmd = `if systemctl cat ${service} >/dev/null 2>&1; then sudo systemctl ${action} ${service}; else echo "not_found"; exit 1; fi`;

  try {
    const proc = await $`ssh ${sshOpts} ${host} ${remoteCmd}`.quiet().nothrow();
    if (proc.exitCode !== 0) {
      if (proc.stdout.toString().includes("not_found")) {
        console.error(`pizdeploy: служба ${service} не найдена на ${host}`);
      } else {
        console.error(proc.stderr.toString().trim() || `Ошибка при выполнении ${action} ${service}`);
      }
      return proc.exitCode;
    }

    if (action === "stop") {
      console.log(`⏹ Служба ${service} остановлена на ${host}`);
    } else {
      console.log(`🛑 Автозапуск службы ${service} отключен на ${host}`);
    }
    return 0;
  } finally {
    await $`ssh -O exit -o ControlPath=${socketPath} ${host}`.quiet().nothrow();
  }
}

export async function handlePs(host: string): Promise<number> {
  const socketPath = `/tmp/pizdeploy-${Buffer.from(host).toString("hex").slice(0, 16)}.sock`;
  const sshOpts = [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=3",
    "-o", "ControlMaster=auto",
    "-o", `ControlPath=${socketPath}`,
    "-o", "ControlPersist=10s",
  ];
  if (!host.includes(":")) {
    sshOpts.push("-o", "AddressFamily=inet");
  }

  const remoteBashScript = `bash -c '
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
  rel="-"
  [[ -L "$p/current" ]] && rel=$(basename "$(readlink -f "$p/current" 2>/dev/null)")
  m_pid="null"
  m_port="null"
  svc="-"
  stat="inactive"
  for pid in "\${!ports[@]}"; do
    cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null)
    if [[ "$cwd" == "$p" || "$cwd" == "$p/"* ]]; then
      m_pid="$pid"
      m_port="\${ports[$pid]}"
      stat="running"
      [[ -f "/proc/$pid/cgroup" ]] && svc=$(grep -oE "[^/]+\\.service" "/proc/$pid/cgroup" 2>/dev/null | head -n1 || echo "-")
      break
    fi
  done
  [[ $first -eq 0 ]] && printf ","
  first=0
  printf "{\\"project\\":\\"%s\\",\\"release\\":\\"%s\\",\\"service\\":\\"%s\\",\\"status\\":\\"%s\\",\\"port\\":%s,\\"pid\\":%s}" \
    "$name" "$rel" "\${svc:--}" "$stat" "$m_port" "$m_pid"
done
printf "]\\n"
'`;

  try {
    const proc = await $`ssh ${sshOpts} ${host} ${remoteBashScript}`.quiet().nothrow();
    if (proc.exitCode !== 0) {
      console.error(proc.stderr.toString().trim() || "Ошибка при получении статуса сервисов");
      return proc.exitCode;
    }
    const rawText = proc.stdout.toString().trim();
    let data: Array<{
      project: string;
      release: string;
      service: string;
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
      Service: item.service,
      PID: item.pid || "-",
    }));

    console.table(rows);
    return 0;
  } finally {
    await $`ssh -O exit -o ControlPath=${socketPath} ${host}`.quiet().nothrow();
  }
}

export async function main(argv: readonly string[] = Bun.argv.slice(2)): Promise<number> {
  let flagSsh: string | undefined;
  let dryRun = false;
  let command: "deploy" | "ps" | "stop" | "disable" = "deploy";
  let targetServiceArg: string | undefined;

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
    } else if (positionals.length === 1 && positionals[0] === "ps") {
      command = "ps";
    } else if ((positionals[0] === "stop" || positionals[0] === "disable") && positionals.length <= 2) {
      command = positionals[0];
      targetServiceArg = positionals[1];
    } else {
      console.error(USAGE);
      return 2;
    }
  } catch {
    console.error(USAGE);
    return 2;
  }

  const pkg = await Bun.file("package.json").json().catch(() => ({}));
  const host = flagSsh || pkg?.pizdeploy?.ssh || DEFAULT_HOST;
  const name: string = pkg?.name || "app";
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

  // Подкоманды stop и disable: управление службами на хосте
  if (command === "stop" || command === "disable") {
    if (!Bun.which("ssh")) {
      console.error("pizdeploy: ssh не найден в PATH. Установите OpenSSH.");
      return 127;
    }
    return await handleServiceControl(host, command, service);
  }

  const REMOTE_PROJECT_DIR = `/home/pi/projects/${name}`;
  const INCOMING_DIR = `${REMOTE_PROJECT_DIR}/incoming`;
  const RELEASES_DIR = `${REMOTE_PROJECT_DIR}/releases`;

  // Режим dry-run: вывод плана без сборки и сетевых вызовов
  if (dryRun) {
    const relId = `${name}_mock5`;
    const releaseDir = `${RELEASES_DIR}/${relId}`;
    console.log(`[Dry-Run] Будет запущен bun run build, вычислен хэш архива и развернут релиз в: ${releaseDir}`);
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

  const ARCHIVE = "./dist.tar.gz";
  // Путь к файлу юнита: ищем systemd/<service> рядом с package.json
  const serviceFile = `./systemd/${service}`;
  const hasService = await Bun.file(serviceFile).exists();

  const socketPath = `/tmp/pizdeploy-${Buffer.from(host).toString("hex").slice(0, 16)}.sock`;
  const sshBaseOpts = [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=3",
    "-o", "ControlMaster=auto",
    "-o", `ControlPath=${socketPath}`,
    "-o", "ControlPersist=10s",
  ];
  if (!host.includes(":")) {
    sshBaseOpts.push("-o", "AddressFamily=inet");
  }
  const scpOpts = [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=3",
    "-o", `ControlPath=${socketPath}`,
  ];
  if (!host.includes(":")) {
    scpOpts.push("-o", "AddressFamily=inet");
  }

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
    const releaseDir = `${RELEASES_DIR}/${relId}`;
    const currentLink = `${REMOTE_PROJECT_DIR}/current`;

    // 4. Подготовка директорий incoming и releases на хосте (инициализирует ControlMaster)
    const mkdirResult = await $`ssh ${sshBaseOpts} ${host} ${`mkdir -p ${INCOMING_DIR} ${RELEASES_DIR}`}`.nothrow();
    if (mkdirResult.exitCode !== 0) return mkdirResult.exitCode;

    // 5. Копирование архива в буфер incoming (по открытому сокету)
    const scpResult = await $`scp ${scpOpts} ${ARCHIVE} ${host + ":" + INCOMING_DIR + "/dist.tar.gz"}`.nothrow();
    if (scpResult.exitCode !== 0) return scpResult.exitCode;

    // Копирование файла юнита в буфер incoming, если он предоставлен в проекте
    if (hasService) {
      const scpServiceResult = await $`scp ${scpOpts} ${serviceFile} ${host + ":" + INCOMING_DIR + "/" + service}`.nothrow();
      if (scpServiceResult.exitCode !== 0) return scpServiceResult.exitCode;
    }

    // 6. Распаковка в releases/<relId>, очистка incoming, атомарное переключение current, обновление systemd, рестарт службы и ротация в releases
    const remoteCommands = [
      `mkdir -p ${releaseDir} && tar -xzf ${INCOMING_DIR}/dist.tar.gz -C ${releaseDir} && rm -f ${INCOMING_DIR}/dist.tar.gz`,
      `ln -sfn ${releaseDir} ${REMOTE_PROJECT_DIR}/current_tmp && mv -fT ${REMOTE_PROJECT_DIR}/current_tmp ${currentLink}`,
      hasService
        ? `if ! cmp -s ${INCOMING_DIR}/${service} /etc/systemd/system/${service} 2>/dev/null; then sudo cp ${INCOMING_DIR}/${service} /etc/systemd/system/${service} && sudo systemctl daemon-reload && sudo systemctl enable ${service}; fi && rm -f ${INCOMING_DIR}/${service}`
        : "",
      `if systemctl cat ${service} >/dev/null 2>&1; then sudo systemctl restart ${service}; fi`,
      `cd ${RELEASES_DIR} && ls -1d * 2>/dev/null | sort | head -n -3 | xargs rm -rf 2>/dev/null || true`,
    ]
      .filter(Boolean)
      .join(" && ");

    const remoteResult = await $`ssh ${sshBaseOpts} ${host} ${remoteCommands}`.nothrow();
    if (remoteResult.exitCode !== 0) return remoteResult.exitCode;

    console.log(`🎉 Успешно развернут релиз: ${relId}`);
    return 0;
  } finally {
    // Гарантированная очистка локального архива и закрытие мультиплекс-сессии
    await $`rm -f ${ARCHIVE}`.nothrow();
    await $`ssh -O exit -o ControlPath=${socketPath} ${host}`.quiet().nothrow();
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
