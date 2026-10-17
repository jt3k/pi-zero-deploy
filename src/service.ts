import { REMOTE_PROJECTS_ROOT } from './config';
import { formatStepSuccess } from './format';
import { closeControlMaster, remoteExec, socketPathFor, sshOptions } from './ssh';
import type { ServiceAction } from './types';

export async function handleServiceControl(
  host: string,
  action: ServiceAction,
  service: string,
  projectName?: string,
): Promise<number> {
  const socketPath = socketPathFor(host);
  const sshOpts = sshOptions(host, socketPath);

  try {
    if (action === 'status') {
      const res = await remoteExec(sshOpts, host, `systemctl --user status ${service}`);
      if (res.stdout) console.log(res.stdout.trimEnd());
      if (res.stderr) console.error(res.stderr.trimEnd());
      return res.exitCode;
    }

    if (action === 'logs') {
      const res = await remoteExec(
        sshOpts,
        host,
        `journalctl --user -u ${service} -n 50 --no-pager`,
      );
      if (res.stdout) console.log(res.stdout.trimEnd());
      if (res.stderr) console.error(res.stderr.trimEnd());
      return res.exitCode;
    }

    if (action === 'remove' || action === 'rm') {
      const proj = projectName || service.replace(/\.service$/, '');
      const remoteCmd = `
systemctl --user stop ${service} 2>/dev/null || true
systemctl --user disable ${service} 2>/dev/null || true
rm -f ~/.config/systemd/user/${service}
systemctl --user daemon-reload
rm -f ${REMOTE_PROJECTS_ROOT}/${proj}/current
`;
      const startRemove = performance.now();
      const res = await remoteExec(sshOpts, host, remoteCmd);
      if (res.exitCode !== 0) {
        console.error(res.stderr.trim() || `Ошибка при удалении службы ${service}`);
        return res.exitCode || 1;
      }
      console.log(
        formatStepSuccess(
          `🗑 Служба ${service} удалена и снята с учёта на ${host}`,
          performance.now() - startRemove,
        ),
      );
      return 0;
    }

    const startCmd = performance.now();
    const remoteCmd = `if systemctl --user cat ${service} >/dev/null 2>&1; then systemctl --user ${action} ${service}; else echo "not_found"; exit 1; fi`;
    const res = await remoteExec(sshOpts, host, remoteCmd);
    if (res.exitCode !== 0) {
      if (res.stdout.includes('not_found')) {
        console.error(`pizdeploy: служба ${service} не найдена на ${host}`);
      } else {
        console.error(res.stderr.trim() || `Ошибка при выполнении ${action} ${service}`);
      }
      return res.exitCode || 1;
    }

    const elapsed = performance.now() - startCmd;
    if (action === 'start') {
      console.log(formatStepSuccess(`▶️ Служба ${service} запущена на ${host}`, elapsed));
    } else if (action === 'stop') {
      console.log(formatStepSuccess(`⏹ Служба ${service} остановлена на ${host}`, elapsed));
    } else if (action === 'restart') {
      console.log(formatStepSuccess(`🔄 Служба ${service} перезапущена на ${host}`, elapsed));
    } else if (action === 'disable') {
      console.log(
        formatStepSuccess(`🛑 Автозапуск службы ${service} отключен на ${host}`, elapsed),
      );
    }
    return 0;
  } finally {
    await closeControlMaster(host, socketPath);
  }
}
