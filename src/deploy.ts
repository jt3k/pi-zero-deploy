import { $ } from 'bun';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  REMOTE_PROJECTS_ROOT,
  STABLE_HOLD_MS,
  VERIFY_INTERVAL_MS,
  VERIFY_TIMEOUT_MS,
  detectAutobuildEntry,
  resolveExecStart,
} from './config';
import {
  closeControlMaster,
  remoteExec,
  runStep,
  scpOptions,
  socketPathFor,
  sshOptions,
  userFromHost,
} from './ssh';
import { renderUnit } from './unit';
import { formatDuration, withStep } from './format';

/**
 * Ленивое включение linger: перед установкой юнита. Идемпотентно и не требует
 * root для собственного пользователя; без него служба умирает после закрытия SSH.
 */
export async function ensureLinger(sshOpts: string[], host: string, user: string): Promise<number> {
  const property = `loginctl show-user ${user} --property=Linger`;
  const before = await remoteExec(sshOpts, host, property);
  if (before.stdout.includes('Linger=yes')) return 0;

  const enable = await remoteExec(sshOpts, host, `loginctl enable-linger ${user}`);
  if (enable.exitCode !== 0) {
    console.error(
      `pizdeploy: не удалось включить автозапуск сессии пользователя ${user}: ${
        enable.stderr.trim() || `код ${enable.exitCode}`
      }`,
    );
    return enable.exitCode || 1;
  }

  const after = await remoteExec(sshOpts, host, property);
  if (!after.stdout.includes('Linger=yes')) {
    console.error(`pizdeploy: автозапуск сессии ${user} остался выключенным (ожидался Linger=yes)`);
    return 1;
  }
  console.log(`🔓 Автозапуск пользовательской сессии ${user} включён`);
  return 0;
}

export async function readRestarts(
  sshOpts: string[],
  host: string,
  service: string,
): Promise<number> {
  const res = await remoteExec(
    sshOpts,
    host,
    `systemctl --user show ${service} -p NRestarts --value`,
  );
  const value = Number.parseInt(res.stdout.trim(), 10);
  return Number.isFinite(value) ? value : 0;
}

export function portListenCheck(port: number): string {
  return `ss -tln 2>/dev/null | awk -v p=${port} '$4 ~ (":" p "$") {found=1} END {exit found ? 0 : 1}'`;
}

/**
 * Успех = служба `active` и (если порт известен) порт слушается.
 * Без порта — выдержка с проверкой, что служба не перезапускается.
 */
export async function verifyService(
  sshOpts: string[],
  host: string,
  service: string,
  port: number | undefined,
): Promise<{ ok: boolean; reason: string }> {
  const deadline = Date.now() + VERIFY_TIMEOUT_MS;
  const timeoutSec = Math.round(VERIFY_TIMEOUT_MS / 1000);

  let active = false;
  for (;;) {
    const res = await remoteExec(sshOpts, host, `systemctl --user is-active ${service}`);
    if (res.stdout.trim() === 'active') {
      active = true;
      break;
    }
    if (Date.now() >= deadline) break;
    await Bun.sleep(VERIFY_INTERVAL_MS);
  }
  if (!active) {
    return {
      ok: false,
      reason: `служба ${service} не перешла в состояние active за ${timeoutSec} с`,
    };
  }

  if (port) {
    for (;;) {
      const res = await remoteExec(sshOpts, host, portListenCheck(port));
      if (res.exitCode === 0) return { ok: true, reason: '' };
      if (Date.now() >= deadline) break;
      await Bun.sleep(VERIFY_INTERVAL_MS);
    }
    const seen = await remoteExec(
      sshOpts,
      host,
      `ss -tln 2>/dev/null | awk 'NR>1 {print $4}' | tr '\\n' ' '`,
    );
    return {
      ok: false,
      reason: `порт ${port} никто не слушает; на хосте прослушиваются: ${seen.stdout.trim() || 'ничего'}`,
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
  return { ok: true, reason: '' };
}

/**
 * Формирует bash-команду безопасной ротации релизов:
 * 1. Защищает активный релиз (симлинк current), никогда не удаляя его.
 * 2. Сортирует директории по mtime (ls -1td), сохраняя 3 самых свежих.
 * 3. Удаляет устаревшие неактивные релизы.
 */
export function buildRotationScript(releasesDir: string, currentLink: string): string {
  return [
    `cur=$(readlink -f "${currentLink}" 2>/dev/null || true)`,
    `cd "${releasesDir}" 2>/dev/null && \\`,
    `for d in $(ls -1td */ 2>/dev/null | tail -n +4); do`,
    `  full=$(readlink -f "$d" 2>/dev/null || true)`,
    `  if [[ -n "$cur" && "$full" == "$cur" ]]; then`,
    `    continue`,
    `  fi`,
    `  rm -rf "$d"`,
    `done || true`,
  ].join('\n');
}

export type DeployOptions = {
  host: string;
  name: string;
  service: string;
  port?: number;
  dryRun?: boolean;
  pkg: Record<string, unknown>;
};

export async function handleDeploy(options: DeployOptions): Promise<number> {
  const { host, name, service, port, dryRun = false, pkg } = options;

  const projectDir = `${REMOTE_PROJECTS_ROOT}/${name}`;
  const incomingDir = `${projectDir}/incoming`;
  const releasesDir = `${projectDir}/releases`;
  const currentLink = `${projectDir}/current`;
  const unitDir = '~/.config/systemd/user';

  const execStart = resolveExecStart(pkg);

  // Режим dry-run: вывод плана без сборки и сетевых вызовов
  if (dryRun) {
    const relId = `${name}_mock5`;
    const releaseDir = `${releasesDir}/${relId}`;
    console.log(
      `[Dry-Run] Будет запущен bun run build, вычислен хэш архива и развернут релиз в: ${releaseDir}`,
    );
    console.log(
      `[Dry-Run] Служба ${service} (user-юнит): ${execStart ?? 'node index.js'} в ${projectDir}/current, ${
        port ? `проверка порта ${port}` : 'порт не задан — проверка прослушивания пропускается'
      }`,
    );
    return 0;
  }

  // Проверка зависимостей
  if (!Bun.which('ssh')) {
    console.error('pizdeploy: ssh не найден в PATH. Установите OpenSSH.');
    return 127;
  }
  if (!Bun.which('scp')) {
    console.error('pizdeploy: scp не найден в PATH. Установите OpenSSH.');
    return 127;
  }

  if (!execStart) {
    console.error("pizdeploy: в package.json отсутствует обязательный скрипт 'scripts.start'");
    return 1;
  }

  const tempArchive = join(
    tmpdir(),
    `pizdeploy-${Date.now()}-${Buffer.from(Bun.randomUUIDv7()).toString('hex').slice(0, 8)}.tar.gz`,
  );
  const socketPath = socketPathFor(host);
  const sshOpts = sshOptions(host, socketPath);
  const scpOpts = scpOptions(host, socketPath);

  const startTotal = performance.now();
  try {
    // 1. Сборка
    let effectiveExecStart = execStart;
    const hasCustomBuild =
      typeof pkg?.scripts?.build === 'string' && pkg.scripts.build.trim().length > 0;

    if (hasCustomBuild) {
      const buildResult = await withStep('сборка проекта', () => $`bun run build`.nothrow());
      if (buildResult.exitCode !== 0) return buildResult.exitCode;
    } else {
      const rawStart = (pkg as { scripts?: { start?: string } })?.scripts?.start || '';
      const autobuild = detectAutobuildEntry(rawStart);
      if (!autobuild) {
        console.error(
          `pizdeploy: в package.json отсутствует скрипт "build", и не удалось определить входной файл из scripts.start: "${rawStart}"`,
        );
        console.error(
          `💡 Рекомендация: добавьте скрипт "build" в package.json (например: "build": "bun build ./app.js --target=node --outfile=./dist/app.mjs")`,
        );
        console.error(
          `   или укажите прямой путь к запускаемому JS/TS файлу в scripts.start: "node ./app.js".`,
        );
        return 1;
      }

      console.log(
        `🔨 Автоматическая сборка: bun build ${autobuild.entryPath} -> ./dist/${autobuild.outputFileName}`,
      );
      const buildResult = await withStep('автоматическая сборка', () =>
        $`bun build ${autobuild.entryPath} --target=node --outfile=./dist/${autobuild.outputFileName} --minify`.nothrow(),
      );
      if (buildResult.exitCode !== 0) {
        return buildResult.exitCode;
      }
      effectiveExecStart = autobuild.execStart;
    }

    // 2. Упаковка
    const tarResult = await withStep('упаковка архива', () =>
      $`tar -czf ${tempArchive} -C ./dist .`.nothrow(),
    );
    if (tarResult.exitCode !== 0) return tarResult.exitCode;

    // 3. Хэш SHA-256 от архива
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(await Bun.file(tempArchive).bytes());
    const hash5 = hasher.digest('hex').slice(0, 5);

    const relId = `${name}_${hash5}`;
    const releaseDir = `${releasesDir}/${relId}`;

    // 4. Подготовка директорий incoming и releases на хосте (инициализирует ControlMaster)
    const mkdirCode = await runStep(
      sshOpts,
      host,
      'подготовка каталогов',
      `mkdir -p ${incomingDir} ${releasesDir}`,
    );
    if (mkdirCode !== 0) return mkdirCode;

    // 5. Копирование архива в буфер incoming (по открытому сокету)
    const scpResult = await withStep('доставка архива', () =>
      $`scp ${scpOpts} ${tempArchive} ${host + ':' + incomingDir + '/dist.tar.gz'}`
        .quiet()
        .nothrow(),
    );
    if (scpResult.exitCode !== 0) {
      console.error(
        `pizdeploy: не удалось передать архив на ${host}: ${scpResult.stderr.toString().trim()}`,
      );
      return scpResult.exitCode;
    }

    // 6. Автозапуск пользовательской сессии (лениво, перед установкой юнита)
    const remoteUser =
      userFromHost(host) ?? (await remoteExec(sshOpts, host, 'id -un')).stdout.trim();
    if (!remoteUser) {
      console.error('pizdeploy: не удалось определить пользователя на целевом хосте');
      return 1;
    }
    const lingerCode = await withStep('проверка linger', () =>
      ensureLinger(sshOpts, host, remoteUser),
    );
    if (lingerCode !== 0) return lingerCode;

    // 7. Распаковка в releases/<relId> (current ещё не трогаем)
    const extractCode = await runStep(
      sshOpts,
      host,
      'распаковка релиза',
      `mkdir -p ${releaseDir} && tar -xzf ${incomingDir}/dist.tar.gz -C ${releaseDir} && rm -f ${incomingDir}/dist.tar.gz`,
    );
    if (extractCode !== 0) return extractCode;

    // 8. Предыдущий релиз нужен для отката при неподтверждённой активации
    const prev = await remoteExec(
      sshOpts,
      host,
      `test -L "${currentLink}" && readlink -f "${currentLink}" 2>/dev/null || true`,
    );
    const prevTarget = prev.stdout.trim();

    // 9. Атомарное переключение current
    const switchCode = await runStep(
      sshOpts,
      host,
      'переключение current',
      `ln -sfn ${releaseDir} ${projectDir}/current_tmp && mv -fT ${projectDir}/current_tmp ${currentLink}`,
    );
    if (switchCode !== 0) return switchCode;

    // 10. Запись сгенерированного юнита в каталог пользовательских юнитов
    const unit = renderUnit(name, effectiveExecStart, port);
    const unitB64 = Buffer.from(unit, 'utf8').toString('base64');
    const writeCode = await runStep(
      sshOpts,
      host,
      'запись user-юнита',
      `mkdir -p ${unitDir} && echo '${unitB64}' | base64 -d > ${unitDir}/${service}`,
    );
    if (writeCode !== 0) return writeCode;

    // 11. Перечитываем конфигурацию пользовательского менеджера
    const reloadCode = await runStep(
      sshOpts,
      host,
      'daemon-reload',
      'systemctl --user daemon-reload',
    );
    if (reloadCode !== 0) return reloadCode;

    // 12. Включаем автозапуск и перезапускаем/стартуем службу
    const enableCode = await runStep(
      sshOpts,
      host,
      'включение службы',
      `systemctl --user enable --now ${service} && systemctl --user restart ${service}`,
    );
    if (enableCode !== 0) return enableCode;

    // 13. Верификация работоспособности; отказ = откат current
    const verdict = await withStep(
      'верификация службы',
      () => verifyService(sshOpts, host, service, port),
      { isSuccess: (res) => res.ok },
    );
    if (!verdict.ok) {
      console.error(`pizdeploy: деплой не подтверждён — ${verdict.reason}`);
      if (prevTarget && prevTarget !== currentLink) {
        await runStep(
          sshOpts,
          host,
          'откат current',
          `ln -sfn ${prevTarget} ${projectDir}/current_tmp && mv -fT ${projectDir}/current_tmp ${currentLink}`,
        );
        console.error(`pizdeploy: current возвращён на ${prevTarget.split('/').pop()}`);
      } else {
        await runStep(
          sshOpts,
          host,
          'удаление current при первом деплое',
          `rm -f ${currentLink} ${projectDir}/current_tmp`,
        );
        console.error('pizdeploy: предыдущего релиза нет — симлинк current удалён');
      }
      return 1;
    }

    // 14. Ротация: `|| true` допустим только здесь — сбой очистки не отменяет успех
    await withStep(
      'ротация старых релизов',
      () => remoteExec(sshOpts, host, buildRotationScript(releasesDir, currentLink)),
      { isSuccess: () => true },
    );

    const totalDuration = performance.now() - startTotal;
    const hostname = host.replace(/^.*@/, '');
    console.log(`🎉 Успешно развернут релиз: ${relId} [${formatDuration(totalDuration)}]`);
    if (port) {
      console.log(`   URL: http://${hostname}:${port}`);
    }
    return 0;
  } finally {
    // Гарантированная очистка локального временного архива и закрытие мультиплекс-сессии
    await $`rm -f ${tempArchive}`.nothrow();
    await closeControlMaster(host, socketPath);
  }
}
