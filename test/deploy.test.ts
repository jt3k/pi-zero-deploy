import { afterAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  renderUnit,
  resolveExecStart,
  resolvePort,
  sshOptions,
  scpOptions,
  userFromHost,
  detectAutobuildEntry,
  validateName,
  validateService,
  validateHost,
  validatePort,
} from '../src/index';

const repoRoot = join(import.meta.dir, '..');
const entrypoint = join(repoRoot, 'src', 'index.ts');
const bunExe = process.execPath;
const bunDir = join(bunExe, '..');

const sandboxes: string[] = [];

/**
 * Удалённый «хост»-обработчик: отвечает на команды конвейера так, как это делает
 * Pi с user-менеджером systemd, и позволяет инжектировать отказы по подстроке.
 */
const REMOTE_HANDLER = `#!/bin/sh
CMD="$1"

case "$CMD" in
  *"loginctl show-user"*)
    if [ -f "$SANDBOX/linger.enabled" ]; then printf 'Linger=%s\\n' "\${LINGER_AFTER:-yes}"
    else printf 'Linger=%s\\n' "\${LINGER:-no}"; fi
    exit 0 ;;
  *"loginctl enable-linger"*)
    : > "$SANDBOX/linger.enabled"
    exit 0 ;;
  *"readlink -f"*current*)
    if [ -n "\${PREV_TARGET:-}" ]; then printf '%s\\n' "$PREV_TARGET"; exit 0; fi
    exit 1 ;;
  *"is-active"*)
    f="$SANDBOX/isactive.count"; n=$(cat "$f" 2>/dev/null || echo 0); n=$((n+1)); printf '%s' "$n" > "$f"
    if [ "$n" -ge "\${ACTIVE_FROM:-1}" ]; then echo active; exit 0; fi
    echo inactive; exit 3 ;;
  *"NRestarts"*)
    f="$SANDBOX/nrestarts.count"; n=$(cat "$f" 2>/dev/null || echo 0); n=$((n+1)); printf '%s' "$n" > "$f"
    if [ "$n" -eq 1 ]; then printf '%s\\n' "\${NRESTARTS_BEFORE:-0}"
    else printf '%s\\n' "\${NRESTARTS_AFTER:-\${NRESTARTS_BEFORE:-0}}"; fi
    exit 0 ;;
  *"ss -tln"*"awk -v p="*)
    [ "\${PORT_LISTEN:-yes}" = "yes" ] && exit 0
    exit 1 ;;
  *"ss -tln"*)
    printf '%s\\n' "\${LISTENING:-22 3000}"; exit 0 ;;
esac

if [ -n "\${FAIL_ON:-}" ]; then
  case "$CMD" in
    *"$FAIL_ON"*) printf 'stub failure\\n' >&2; exit "\${FAIL_EXIT:-1}" ;;
  esac
fi
exit 0
`;

function makeDeploySandbox(options: { packageJson?: unknown } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'pizdeploy-deploy-')));
  sandboxes.push(base);

  const binDir = join(base, 'fake-bin');
  mkdirSync(binDir, { recursive: true });

  const handler = join(base, 'remote.sh');
  writeFileSync(handler, REMOTE_HANDLER);
  chmodSync(handler, 0o755);

  // Заглушка ssh: пишет команду в лог (одной строкой, чтобы многострочные
  // команды вроде heredoc не разбивались на несколько «вызовов») и отдаёт её
  // удалённому «хосту».
  const sshStub = join(binDir, 'ssh');
  writeFileSync(
    sshStub,
    '#!/bin/sh\nif [ "$1" = "-O" ]; then exit 0; fi\nfor a in "$@"; do last="$a"; done\n' +
      "printf '%s\\n' \"$last\" | tr '\\n' ' ' >> \"$SSH_LOG\"; printf '\\n' >> \"$SSH_LOG\"\n" +
      'SANDBOX="' +
      base +
      '" sh "' +
      handler +
      '" "$last"\n',
  );
  chmodSync(sshStub, 0o755);

  const scpStub = join(binDir, 'scp');
  writeFileSync(
    scpStub,
    '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a"; done >> "$SCP_LOG"\nexit "${SCP_EXIT:-0}"\n',
  );
  chmodSync(scpStub, 0o755);

  const pkg = options.packageJson ?? {
    name: 'myapp',
    scripts: {
      build: "sh -c 'mkdir -p dist && echo built > dist/index.js'",
      start: 'node dist/index.js',
    },
  };
  writeFileSync(join(base, 'package.json'), JSON.stringify(pkg, null, 2));

  return { base, cwd: base, pathValue: `${binDir}:${bunDir}:/usr/bin:/bin` };
}

function deploy(opts: {
  cwd: string;
  pathValue: string;
  base: string;
  env?: Record<string, string>;
  args?: string[];
}) {
  const sshLog = join(opts.base, 'ssh.log');
  const scpLog = join(opts.base, 'scp.log');
  writeFileSync(sshLog, '');
  writeFileSync(scpLog, '');

  const proc = Bun.spawnSync([bunExe, entrypoint, ...(opts.args ?? [])], {
    cwd: opts.cwd,
    env: {
      PATH: opts.pathValue,
      SANDBOX: opts.base,
      SSH_LOG: sshLog,
      SCP_LOG: scpLog,
      PIZDEPLOY_VERIFY_TIMEOUT_MS: '400',
      PIZDEPLOY_VERIFY_INTERVAL_MS: '50',
      PIZDEPLOY_STABLE_HOLD_MS: '50',
      ...opts.env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    calls: readFileSync(sshLog, 'utf8').split('\n').filter(Boolean),
    scp: readFileSync(scpLog, 'utf8').split('\n').filter(Boolean),
  };
}

afterAll(() => {
  for (const dir of sandboxes) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('вспомогательные функции', () => {
  test('sshOptions/scpOptions переиспользуют одно соединение и не требуют пароля', () => {
    const ssh = sshOptions('pi@zero.local', '/tmp/s.sock');
    expect(ssh).toContain('BatchMode=yes');
    expect(ssh).toContain('ControlMaster=auto');
    expect(ssh).toContain('ControlPath=/tmp/s.sock');
    expect(ssh).toContain('-o');

    const scp = scpOptions('pi@zero.local', '/tmp/s.sock');
    expect(scp).toContain('ControlPath=/tmp/s.sock');
    expect(scp).not.toContain('ControlMaster=auto');
  });

  test('для IPv6-адреса без порта AddressFamily не добавляется', () => {
    expect(sshOptions('pi@fe80::1', '/tmp/s.sock')).not.toContain('AddressFamily=inet');
    expect(sshOptions('pi@zero.local', '/tmp/s.sock')).toContain('AddressFamily=inet');
  });

  test('userFromHost извлекает имя пользователя из адреса', () => {
    expect(userFromHost('pi@zero.local')).toBe('pi');
    expect(userFromHost('deploy@10.0.0.5')).toBe('deploy');
    expect(userFromHost('zero.local')).toBeUndefined();
  });

  test('pizdeploy.port читается, при отсутствии остаётся undefined', () => {
    expect(resolvePort({ pizdeploy: { port: 1234 } })).toBe(1234);
    expect(resolvePort({ pizdeploy: { port: '3000' } })).toBe(3000);
    expect(resolvePort({ pizdeploy: {} })).toBeUndefined();
    expect(resolvePort({})).toBeUndefined();
    expect(resolvePort(undefined)).toBeUndefined();
    expect(resolvePort({ pizdeploy: { port: 'abc' } })).toBeUndefined();
  });

  test('resolveExecStart адаптирует команду и отсекает dist/', () => {
    expect(resolveExecStart({ scripts: { start: 'node dist/index.js' } })).toBe(
      '/usr/bin/node index.js',
    );
    expect(resolveExecStart({ scripts: { start: 'node server.js' } })).toBe(
      '/usr/bin/node server.js',
    );
    expect(resolveExecStart({ scripts: { start: '/usr/bin/node dist/server.js' } })).toBe(
      '/usr/bin/node server.js',
    );
    expect(resolveExecStart({ scripts: { start: 'dist/app' } })).toBe('app');
    expect(resolveExecStart({ scripts: { start: '   ' } })).toBeUndefined();
    expect(resolveExecStart({ scripts: {} })).toBeUndefined();
    expect(resolveExecStart({})).toBeUndefined();
    expect(resolveExecStart(undefined)).toBeUndefined();
  });

  test('detectAutobuildEntry корректно разбирает команды и пути', () => {
    expect(detectAutobuildEntry('node app.js')).toEqual({
      entryPath: 'app.js',
      outputFileName: 'app.mjs',
      execStart: '/usr/bin/node app.mjs',
    });
    expect(detectAutobuildEntry('node ./src/server.js')).toEqual({
      entryPath: './src/server.js',
      outputFileName: 'server.mjs',
      execStart: '/usr/bin/node server.mjs',
    });
    expect(detectAutobuildEntry('node --inspect --expose-gc src/index.ts')).toEqual({
      entryPath: 'src/index.ts',
      outputFileName: 'index.mjs',
      execStart: '/usr/bin/node --inspect --expose-gc index.mjs',
    });
    expect(detectAutobuildEntry('node app.js --port 8080')).toEqual({
      entryPath: 'app.js',
      outputFileName: 'app.mjs',
      execStart: '/usr/bin/node app.mjs --port 8080',
    });
    expect(detectAutobuildEntry('')).toBeNull();
    expect(detectAutobuildEntry('some-binary arg')).toBeNull();
  });

  test('деплой проекта без scripts.start прерывается с ошибкой до передачи файлов', () => {
    const sb = makeDeploySandbox({
      packageJson: {
        name: 'myapp',
        scripts: { build: "sh -c 'mkdir -p dist && echo built > dist/index.js'" },
      },
    });
    const res = deploy({ ...sb });

    expect(res.code).toBe(1);
    expect(res.stderr).toContain('scripts.start');
    expect(res.calls.length).toBe(0);
  });

  test('деплой проекта без scripts.build автоматически собирает проект в .mjs', () => {
    const sb = makeDeploySandbox({
      packageJson: {
        name: 'micro-app',
        scripts: { start: 'node app.js' },
      },
    });
    writeFileSync(join(sb.base, 'app.js'), "console.log('hello');\n");

    const res = deploy({ ...sb, env: { LINGER: 'yes' } });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('🔨 Автоматическая сборка:');
    expect(res.stdout).toContain('🎉 Успешно развернут релиз:');
    const unitCall = res.calls.find((c) =>
      c.includes('base64 -d > ~/.config/systemd/user/micro-app.service'),
    );
    expect(unitCall).toBeDefined();
    const match = unitCall!.match(/echo '([^']+)' \| base64 -d/);
    expect(match).toBeDefined();
    const decoded = Buffer.from(match![1], 'base64').toString('utf8');
    expect(decoded).toContain('ExecStart=/usr/bin/node app.mjs');
  });

  test('деплой проекта без scripts.build с нераспознанным start выводит подсказку', () => {
    const sb = makeDeploySandbox({
      packageJson: {
        name: 'unknown-app',
        scripts: { start: 'unknown-runner' },
      },
    });

    const res = deploy({ ...sb });

    expect(res.code).toBe(1);
    expect(res.stderr).toContain('не удалось определить входной файл');
    expect(res.stderr).toContain('Рекомендация');
    expect(res.calls.length).toBe(0);
  });
});

describe('генерация unit-файла', () => {
  test('дефолтный шаблон формирует unit с WorkingDirectory, ExecStart и NODE_ENV=production', () => {
    const unit = renderUnit('my-app', '/usr/bin/node index.js');
    expect(unit).toContain('Description=my-app');
    expect(unit).toContain('After=default.target');
    expect(unit).toContain('WorkingDirectory=%h/projects/my-app/current');
    expect(unit).toContain('ExecStart=/usr/bin/node index.js');
    expect(unit).toContain('Environment="NODE_ENV=production"');
    expect(unit).not.toContain('PORT=');
    expect(unit).toContain('WantedBy=default.target');
  });

  test('дефолтный шаблон с заданным портом содержит Environment=PORT', () => {
    const unit = renderUnit('my-app', '/usr/bin/node index.js', 1234);
    expect(unit).toContain('WorkingDirectory=%h/projects/my-app/current');
    expect(unit).toContain('ExecStart=/usr/bin/node index.js');
    expect(unit).toContain('Environment="PORT=1234"');
    expect(unit).toContain('Environment="NODE_ENV=production"');
  });

  test('пользовательский template из проекта сохраняет переменные окружения и подставляет WorkingDirectory + ExecStart', () => {
    const tmpTemplate = join(tmpdir(), `custom-unit-${Date.now()}.service`);
    writeFileSync(
      tmpTemplate,
      [
        '[Unit]',
        'Description=My Custom Telegram Bot',
        'After=default.target',
        '',
        '[Service]',
        'Type=simple',
        'Environment="NODE_ENV=production"',
        'Environment="BOT_TOKEN=123456:ABC-DEF"',
        '',
        '[Install]',
        'WantedBy=default.target',
      ].join('\n'),
    );

    try {
      const unit = renderUnit('tg-bot', '/usr/bin/node bot.js', undefined, tmpTemplate);
      expect(unit).toContain('Description=My Custom Telegram Bot');
      expect(unit).toContain('WorkingDirectory=%h/projects/tg-bot/current');
      expect(unit).toContain('ExecStart=/usr/bin/node bot.js');
      expect(unit).toContain('Restart=always');
      expect(unit).toContain('RestartSec=2');
      expect(unit).toContain('Environment="BOT_TOKEN=123456:ABC-DEF"');
      expect(unit).toContain('Environment="NODE_ENV=production"');
      expect(unit).not.toContain('PORT=');
      expect(unit).toContain('WantedBy=default.target');
    } finally {
      rmSync(tmpTemplate, { force: true });
    }
  });

  test('пользовательский шаблон с явными Restart и RestartSec сохраняет пользовательские значения', () => {
    const tmpTemplate = join(tmpdir(), `custom-restart-${Date.now()}.service`);
    writeFileSync(
      tmpTemplate,
      [
        '[Unit]',
        'Description=Explicit Restart Bot',
        '',
        '[Service]',
        'Type=simple',
        'Restart=on-failure',
        'RestartSec=5',
        'Environment="NODE_ENV=production"',
      ].join('\n'),
    );

    try {
      const unit = renderUnit('custom-bot', '/usr/bin/node bot.js', undefined, tmpTemplate);
      expect(unit).toContain('Restart=on-failure');
      expect(unit).toContain('RestartSec=5');
      expect(unit).not.toContain('Restart=always');
      expect(unit).not.toContain('RestartSec=2');
    } finally {
      rmSync(tmpTemplate, { force: true });
    }
  });

  test('пользовательский шаблон с устаревшими WorkingDirectory и ExecStart перезаписывает их актуальными значениями', () => {
    const tmpTemplate = join(tmpdir(), `override-unit-${Date.now()}.service`);
    writeFileSync(
      tmpTemplate,
      [
        '[Unit]',
        'Description=Legacy Service',
        '',
        '[Service]',
        'WorkingDirectory=/old/path',
        'ExecStart=/old/bin/start.sh',
        'Environment="KEY=value"',
      ].join('\n'),
    );

    try {
      const unit = renderUnit('new-service', '/usr/bin/node server.js', undefined, tmpTemplate);
      expect(unit).toContain('WorkingDirectory=%h/projects/new-service/current');
      expect(unit).toContain('ExecStart=/usr/bin/node server.js');
      expect(unit).toContain('Restart=always');
      expect(unit).toContain('RestartSec=2');
      expect(unit).not.toContain('/old/path');
      expect(unit).not.toContain('/old/bin/start.sh');
      expect(unit).toContain('Environment="KEY=value"');
      expect(unit).toContain('WantedBy=default.target');
    } finally {
      rmSync(tmpTemplate, { force: true });
    }
  });
});

describe('отказ от sudo', () => {
  test('ни одна удалённая команда не содержит sudo и не пишет в /etc/systemd/system', () => {
    const sb = makeDeploySandbox();
    const res = deploy({ ...sb, env: { LINGER: 'yes' } });

    expect(res.code).toBe(0);
    expect(res.calls.length).toBeGreaterThan(0);
    for (const call of res.calls) {
      expect(call).not.toContain('sudo');
      expect(call).not.toContain('/etc/systemd/system');
    }
    expect(res.calls.some((c) => c.includes('systemctl --user enable --now myapp.service'))).toBe(
      true,
    );
    expect(res.calls.some((c) => c.includes('systemctl --user daemon-reload'))).toBe(true);
  });

  test('юнит пишется в ~/.config/systemd/user с сгенерированным содержимым', () => {
    const sb = makeDeploySandbox({
      packageJson: {
        name: 'myapp',
        pizdeploy: { port: 1234 },
        scripts: {
          build: "sh -c 'mkdir -p dist && echo built > dist/index.js'",
          start: 'node dist/index.js',
        },
      },
    });
    const res = deploy({ ...sb, env: { LINGER: 'yes' } });

    expect(res.code).toBe(0);
    const unitCall = res.calls.find((c) =>
      c.includes('base64 -d > ~/.config/systemd/user/myapp.service'),
    );
    expect(unitCall).toBeDefined();
    const match1 = unitCall!.match(/echo '([^']+)' \| base64 -d/);
    expect(match1).toBeDefined();
    const decoded1 = Buffer.from(match1![1], 'base64').toString('utf8');
    expect(decoded1).toContain('ExecStart=/usr/bin/node index.js');
    expect(decoded1).toContain('Environment="PORT=1234"');
    expect(decoded1).toContain('WantedBy=default.target');
    expect(decoded1).toContain('WorkingDirectory=%h/projects/myapp/current');
  });

  test('каталог systemd/ проекта игнорируется и не передаётся на хост', () => {
    const sb = makeDeploySandbox();
    mkdirSync(join(sb.base, 'systemd'), { recursive: true });
    writeFileSync(
      join(sb.base, 'systemd', 'myapp.service'),
      '[Service]\nExecStart=/usr/bin/node /somewhere/legacy.js\n',
    );

    const res = deploy({ ...sb, env: { LINGER: 'yes' } });

    expect(res.code).toBe(0);
    expect(res.scp.join('\n')).not.toContain('.service');
    expect(res.scp.join('\n')).toContain('dist.tar.gz');
    const unitCall = res.calls.find((c) =>
      c.includes('base64 -d > ~/.config/systemd/user/myapp.service'),
    );
    expect(unitCall).toBeDefined();
    const match2 = unitCall!.match(/echo '([^']+)' \| base64 -d/);
    expect(match2).toBeDefined();
    const decoded2 = Buffer.from(match2![1], 'base64').toString('utf8');
    expect(decoded2).toContain('ExecStart=/usr/bin/node index.js');
    expect(decoded2).not.toContain('legacy.js');
  });
});

describe('linger', () => {
  test('при выключенном linger включается ровно один раз за деплой', () => {
    const sb = makeDeploySandbox();
    const res = deploy({ ...sb, env: { LINGER: 'no' } });

    expect(res.code).toBe(0);
    expect(res.calls.filter((c) => c.includes('loginctl enable-linger pi')).length).toBe(1);
    expect(res.calls.filter((c) => c.includes('loginctl show-user pi')).length).toBe(2);
    expect(res.stdout).toContain('Автозапуск пользовательской сессии pi включён');
  });

  test('при уже включённом linger состояние не меняется', () => {
    const sb = makeDeploySandbox();
    const res = deploy({ ...sb, env: { LINGER: 'yes' } });

    expect(res.code).toBe(0);
    expect(res.calls.filter((c) => c.includes('loginctl enable-linger')).length).toBe(0);
    expect(res.calls.filter((c) => c.includes('loginctl show-user pi')).length).toBe(1);
  });

  test('не удалось включить linger — деплой прерывается до распаковки', () => {
    const sb = makeDeploySandbox();
    const res = deploy({ ...sb, env: { LINGER: 'no', LINGER_AFTER: 'no' } });

    expect(res.code).not.toBe(0);
    expect(res.stdout).not.toContain('🎉');
    expect(res.stderr).toContain('автозапуск сессии pi остался выключенным');
    expect(res.calls.some((c) => c.includes('tar -xzf'))).toBe(false);
  });
});

describe('проверка кода возврата каждого шага', () => {
  test('отказ распаковки: ненулевой код, пустой stdout, current не переключается', () => {
    const sb = makeDeploySandbox();
    const res = deploy({ ...sb, env: { LINGER: 'yes', FAIL_ON: 'tar -xzf' } });

    expect(res.code).not.toBe(0);
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain('распаковка релиза');
    expect(res.calls.some((c) => c.includes('mv -fT'))).toBe(false);
  });

  test('отказ установки юнита: сообщение об успехе отсутствует', () => {
    const sb = makeDeploySandbox();
    const res = deploy({ ...sb, env: { LINGER: 'yes', FAIL_ON: 'enable --now' } });

    expect(res.code).not.toBe(0);
    expect(res.stdout).not.toContain('🎉');
    expect(res.stderr).toContain('включение службы');
  });

  test('отказ scp: ненулевой код без удалённых шагов', () => {
    const sb = makeDeploySandbox();
    const res = deploy({ ...sb, env: { LINGER: 'yes', SCP_EXIT: '1' } });

    expect(res.code).toBe(1);
    expect(res.stdout).toBe('');
    expect(res.calls.some((c) => c.includes('tar -xzf'))).toBe(false);
  });

  test('сбой ротации не отменяет успешный деплой', () => {
    const sb = makeDeploySandbox();
    const res = deploy({ ...sb, env: { LINGER: 'yes', FAIL_ON: 'head -n -3' } });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('🎉');
  });

  test('при отказе верификации current возвращается на предыдущий релиз', () => {
    const sb = makeDeploySandbox();
    const res = deploy({
      ...sb,
      env: {
        LINGER: 'yes',
        PREV_TARGET: '/home/pi/projects/myapp/releases/myapp_old11',
        ACTIVE_FROM: '999',
      },
    });

    expect(res.code).not.toBe(0);
    expect(res.stdout).not.toContain('🎉');
    expect(
      res.calls.some((c) => c.includes('ln -sfn /home/pi/projects/myapp/releases/myapp_old11')),
    ).toBe(true);
  });

  test('при отказе верификации во время первого деплоя current удаляется без зацикливания', () => {
    const sb = makeDeploySandbox();
    const res = deploy({
      ...sb,
      env: { LINGER: 'yes', ACTIVE_FROM: '999' },
    });

    expect(res.code).not.toBe(0);
    expect(res.stdout).not.toContain('🎉');
    expect(res.calls.some((c) => c.includes('rm -f $HOME/projects/myapp/current'))).toBe(true);
    expect(res.calls.some((c) => c.includes('ln -sfn $HOME/projects/myapp/current'))).toBe(false);
  });

  test('каталог неудачного релиза остаётся на диске', () => {
    const sb = makeDeploySandbox();
    const res = deploy({ ...sb, env: { LINGER: 'yes', ACTIVE_FROM: '999' } });

    expect(res.code).not.toBe(0);
    // Ротация (единственный шаг с `|| true`) при отказе не выполняется.
    expect(res.calls.some((c) => c.includes('head -n -3'))).toBe(false);
  });
});

describe('верификация работоспособности', () => {
  test('служба становится active со второй попытки — код 0', () => {
    const sb = makeDeploySandbox();
    const res = deploy({ ...sb, env: { LINGER: 'yes', ACTIVE_FROM: '2' } });

    expect(res.code).toBe(0);
    expect(res.calls.filter((c) => c.includes('is-active')).length).toBeGreaterThanOrEqual(2);
  });

  test('служба никогда не становится active — ненулевой код', () => {
    const sb = makeDeploySandbox();
    const res = deploy({ ...sb, env: { LINGER: 'yes', ACTIVE_FROM: '999' } });

    expect(res.code).not.toBe(0);
    expect(res.stdout).not.toContain('🎉');
    expect(res.stderr).toContain('не перешла в состояние active');
  });

  test('порт задан и слушается — код 0', () => {
    const sb = makeDeploySandbox({
      packageJson: {
        name: 'myapp',
        pizdeploy: { port: 1234 },
        scripts: {
          build: "sh -c 'mkdir -p dist && echo built > dist/index.js'",
          start: 'node dist/index.js',
        },
      },
    });
    const res = deploy({ ...sb, env: { LINGER: 'yes', PORT_LISTEN: 'yes' } });

    expect(res.code).toBe(0);
    expect(res.calls.some((c) => c.includes('ss -tln') && c.includes('p=1234'))).toBe(true);
  });

  test('порт задан, но не слушается — ненулевой код с указанием порта', () => {
    const sb = makeDeploySandbox({
      packageJson: {
        name: 'myapp',
        pizdeploy: { port: 1234 },
        scripts: {
          build: "sh -c 'mkdir -p dist && echo built > dist/index.js'",
          start: 'node dist/index.js',
        },
      },
    });
    const res = deploy({ ...sb, env: { LINGER: 'yes', PORT_LISTEN: 'no', LISTENING: '22 3000' } });

    expect(res.code).not.toBe(0);
    expect(res.stdout).not.toContain('🎉');
    expect(res.stderr).toContain('порт 1234');
    expect(res.stderr).toContain('3000');
  });

  test('порт не задан — проверка прослушивания пропускается', () => {
    const sb = makeDeploySandbox();
    const res = deploy({ ...sb, env: { LINGER: 'yes' } });

    expect(res.code).toBe(0);
    expect(res.calls.filter((c) => c.includes('ss -tln')).length).toBe(0);
  });

  test('растущий NRestarts трактуется как неуспех', () => {
    const sb = makeDeploySandbox();
    const res = deploy({
      ...sb,
      env: { LINGER: 'yes', NRESTARTS_BEFORE: '0', NRESTARTS_AFTER: '3' },
    });

    expect(res.code).not.toBe(0);
    expect(res.stdout).not.toContain('🎉');
    expect(res.stderr).toContain('перезапустилась');
  });

  test('успешный вывод содержит URL при наличии порта и не содержит строку службы', () => {
    const sb = makeDeploySandbox({
      packageJson: {
        name: 'myapp',
        pizdeploy: { port: 1234 },
        scripts: {
          build: "sh -c 'mkdir -p dist && echo built > dist/index.js'",
          start: 'node dist/index.js',
        },
      },
    });
    const res = deploy({ ...sb, env: { LINGER: 'yes' } });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('🎉 Успешно развернут релиз:');
    expect(res.stdout).toContain('URL: http://zero.local:1234');
    expect(res.stdout).not.toContain('Служба:');
  });

  test('без порта вывод не содержит строку службы и сообщение о пропуске проверки', () => {
    const sb = makeDeploySandbox();
    const res = deploy({ ...sb, env: { LINGER: 'yes' } });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('🎉 Успешно развернут релиз:');
    expect(res.stdout).not.toContain('Служба:');
    expect(res.stdout).not.toContain('порт не задан');
    expect(res.stdout).not.toContain('URL:');
  });

  test('переменные окружения PIZDEPLOY_VERIFY_INTERVAL_MS и PIZDEPLOY_STABLE_HOLD_MS ускоряют верификацию', () => {
    const sb = makeDeploySandbox();
    const res = deploy({
      ...sb,
      env: {
        LINGER: 'yes',
        PIZDEPLOY_VERIFY_TIMEOUT_MS: '500',
        PIZDEPLOY_VERIFY_INTERVAL_MS: '50',
        PIZDEPLOY_STABLE_HOLD_MS: '50',
      },
    });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('🎉 Успешно развернут релиз:');
  });
});

describe('функции валидации входных данных', () => {
  test('validateName: разрешает безопасные имена и отклоняет path traversal и спецсимволы', () => {
    expect(validateName('my-app')).toBe(true);
    expect(validateName('my_app.service')).toBe(true);
    expect(validateName('app-123')).toBe(true);
    expect(validateName('')).toBe(false);
    expect(validateName('.')).toBe(false);
    expect(validateName('..')).toBe(false);
    expect(validateName('../evil')).toBe(false);
    expect(validateName('my app')).toBe(false);
    expect(validateName('app;rm -rf /')).toBe(false);
    expect(validateName('app$()')).toBe(false);
  });

  test('validateService: требует суффикс .service и безопасную основу', () => {
    expect(validateService('my-app.service')).toBe(true);
    expect(validateService('bot.service')).toBe(true);
    expect(validateService('my-app')).toBe(false);
    expect(validateService('.service')).toBe(false);
    expect(validateService('my app.service')).toBe(false);
    expect(validateService('my;app.service')).toBe(false);
  });

  test('validateHost: запрещает ведущие дефисы и спецсимволы shell', () => {
    expect(validateHost('pi@zero.local')).toBe(true);
    expect(validateHost('custom.host')).toBe(true);
    expect(validateHost('user@192.168.1.50')).toBe(true);
    expect(validateHost('-oProxyCommand=calc.exe')).toBe(false);
    expect(validateHost('')).toBe(false);
    expect(validateHost('host;rm -rf /')).toBe(false);
    expect(validateHost('host && whoami')).toBe(false);
  });

  test('validatePort: разрешает целые числа 1..65535', () => {
    expect(validatePort(80)).toBe(80);
    expect(validatePort('3000')).toBe(3000);
    expect(validatePort(65535)).toBe(65535);
    expect(validatePort(0)).toBeUndefined();
    expect(validatePort(70000)).toBeUndefined();
    expect(validatePort(-1)).toBeUndefined();
    expect(validatePort('invalid')).toBeUndefined();
  });
});
