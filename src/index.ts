#!/usr/bin/env bun
import {
  DEFAULT_HOST,
  HELP_TEXT,
  SERVICE_CMDS,
  USAGE,
  VERSION,
  parseCliArgs,
  validateHost,
  validateName,
  validatePort,
  validateService,
} from './cli';
import {
  REMOTE_PROJECTS_ROOT,
  VERIFY_INTERVAL_MS,
  VERIFY_TIMEOUT_MS,
  STABLE_HOLD_MS,
  detectAutobuildEntry,
  normalizeService,
  readNumberEnv,
  resolveExecStart,
  resolvePort,
} from './config';
import type { DeployOptions } from './deploy';
import { ensureLinger, handleDeploy, portListenCheck, readRestarts, verifyService } from './deploy';
import { buildPsScript, handlePs } from './ps';
import { handleServiceControl } from './service';
import {
  closeControlMaster,
  remoteExec,
  runStep,
  scpOptions,
  socketPathFor,
  sshOptions,
  userFromHost,
} from './ssh';
import type { AutobuildInfo, ParsedCli, RemoteResult, ServiceAction } from './types';
import { handleInit, renderUnit } from './unit';

// Реэкспорт всех публичных типов и функций для полной обратной совместимости с тестами и API
export type { RemoteResult, AutobuildInfo, ServiceAction, ParsedCli, DeployOptions };
export {
  DEFAULT_HOST,
  VERSION,
  USAGE,
  HELP_TEXT,
  SERVICE_CMDS,
  validateName,
  validateService,
  validateHost,
  validatePort,
  parseCliArgs,
  REMOTE_PROJECTS_ROOT,
  readNumberEnv,
  VERIFY_TIMEOUT_MS,
  VERIFY_INTERVAL_MS,
  STABLE_HOLD_MS,
  detectAutobuildEntry,
  resolveExecStart,
  normalizeService,
  resolvePort,
  userFromHost,
  socketPathFor,
  sshOptions,
  scpOptions,
  remoteExec,
  closeControlMaster,
  runStep,
  renderUnit,
  handleInit,
  handleServiceControl,
  buildPsScript,
  handlePs,
  ensureLinger,
  readRestarts,
  portListenCheck,
  verifyService,
  handleDeploy,
};

export async function main(argv: readonly string[] = Bun.argv.slice(2)): Promise<number> {
  const cliResult = parseCliArgs(argv);
  if (!cliResult.ok) {
    return cliResult.exitCode;
  }
  if (cliResult.action === 'exit') {
    return cliResult.exitCode;
  }

  const { command, flagSsh, dryRun, targetServiceArg } = cliResult.parsed;

  // Подкоманда init: подготовка шаблона службы в текущем каталоге
  if (command === 'init') {
    return await handleInit();
  }

  const pkg = await Bun.file('package.json')
    .json()
    .catch(() => ({}));
  const host = flagSsh || pkg?.pizdeploy?.ssh || DEFAULT_HOST;
  if (!validateHost(host)) {
    console.error(
      'pizdeploy: недопустимый адрес хоста (начинается с дефиса или содержит спецсимволы)',
    );
    return 2;
  }
  const name: string = pkg?.name || 'app';
  const port = resolvePort(pkg);
  const defaultService = normalizeService(pkg?.pizdeploy?.service || pkg?.name || 'app');
  const service: string = targetServiceArg ? normalizeService(targetServiceArg) : defaultService;

  if (command === 'deploy' && !validateName(name)) {
    console.error(`pizdeploy: недопустимое имя проекта в package.json: "${name}"`);
    return 1;
  }
  if (SERVICE_CMDS.includes(command as ServiceAction) && !validateService(service)) {
    console.error(`pizdeploy: недопустимое имя службы: "${service}"`);
    return 1;
  }

  // Подкоманда ps: опрос состояния удаленных сервисов
  if (command === 'ps') {
    if (!Bun.which('ssh')) {
      console.error('pizdeploy: ssh не найден в PATH. Установите OpenSSH.');
      return 127;
    }
    return await handlePs(host);
  }

  // Подкоманды управления службами на хосте
  if (SERVICE_CMDS.includes(command as ServiceAction)) {
    if (!Bun.which('ssh')) {
      console.error('pizdeploy: ssh не найден в PATH. Установите OpenSSH.');
      return 127;
    }
    const projName = targetServiceArg ? targetServiceArg.replace(/\.service$/, '') : name;
    return await handleServiceControl(host, command as ServiceAction, service, projName);
  }

  // Основной деплой
  return await handleDeploy({
    host,
    name,
    service,
    port,
    dryRun,
    pkg,
  });
}

if (import.meta.main) {
  process.exitCode = await main();
}
