import { $ } from 'bun';
import { withStep } from './format';
import type { RemoteResult } from './types';

/** Имя пользователя, под которым идём по SSH (для linger). */
export function userFromHost(host: string): string | undefined {
  const at = host.lastIndexOf('@');
  return at === -1 ? undefined : host.slice(0, at);
}

export function socketPathFor(host: string): string {
  return `/tmp/pizdeploy-${Buffer.from(host).toString('hex').slice(0, 16)}.sock`;
}

/** Общие опции `ssh`: нережимный вход + переиспользование соединения через ControlMaster. */
export function sshOptions(host: string, socketPath: string): string[] {
  const opts = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=3',
    '-o',
    'ControlMaster=auto',
    '-o',
    `ControlPath=${socketPath}`,
    '-o',
    'ControlPersist=10s',
  ];
  if (!host.includes(':')) {
    opts.push('-o', 'AddressFamily=inet');
  }
  return opts;
}

/** Опции `scp`: то же соединение, но мастер поднимает `ssh`. */
export function scpOptions(host: string, socketPath: string): string[] {
  const opts = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=3', '-o', `ControlPath=${socketPath}`];
  if (!host.includes(':')) {
    opts.push('-o', 'AddressFamily=inet');
  }
  return opts;
}

/**
 * Удалённая команда как отдельный вызов: вывод перехватывается, чтобы шаги
 * конвейера не печатали в stdout утилиты, и проверяется код возврата.
 */
export async function remoteExec(
  sshOpts: string[],
  host: string,
  command: string,
): Promise<RemoteResult> {
  try {
    const proc = Bun.spawn(['ssh', ...sshOpts, host, command], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return {
      exitCode,
      stdout,
      stderr,
    };
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function closeControlMaster(host: string, socketPath: string): Promise<void> {
  await $`ssh -O exit -o ControlPath=${socketPath} ${host}`.quiet().nothrow();
}

/** Шаг конвейера: ненулевой код возврата обязан остановить деплой. */
export async function runStep(
  sshOpts: string[],
  host: string,
  label: string,
  command: string,
): Promise<number> {
  return withStep(label, async () => {
    const res = await remoteExec(sshOpts, host, command);
    if (res.exitCode !== 0) {
      const reason = res.stderr.trim() || res.stdout.trim() || 'сообщение не получено';
      console.error(`pizdeploy: шаг «${label}» завершился с кодом ${res.exitCode}: ${reason}`);
      return res.exitCode || 1;
    }
    return 0;
  });
}
