import { parseArgs } from 'util';
import type { ParsedCli, ServiceAction } from './types';

export const DEFAULT_HOST = 'pi@zero.local';
export const VERSION = '0.1.0';
export const USAGE =
  'usage: pizdeploy [init|ps|start|stop|restart|status|logs|disable|remove|rm] [name] [--ssh <user@host>] [--dry-run]';

export const HELP_TEXT = `pi zero deploy (pizdeploy) - zero-privilege deployment for Raspberry Pi

Usage:
  pizdeploy [options]
  pizdeploy init
  pizdeploy ps [--ssh <user@host>]
  pizdeploy <start|stop|restart|status|logs|disable|remove|rm> [name] [--ssh <user@host>]

Commands:
  (default)   Build, package, deliver and verify deployment
  init        Generate a systemd-unit.service template in current project
  ps          List deployed projects, releases, statuses and ports on host
  start       Start user systemd service
  stop        Stop user systemd service
  restart     Restart user systemd service
  status      Show detailed systemctl status of service
  logs        Show last 50 log lines via journalctl
  disable     Disable automatic startup of service
  remove, rm  Stop, disable, remove systemd unit and current symlink

Options:
  --ssh <user@host>  Target host (default: from package.json or pi@zero.local)
  --dry-run          Preview deployment steps without building or network calls
  -h, --help         Show this help message
  -v, --version      Show version`;

export const SERVICE_CMDS: readonly ServiceAction[] = [
  'start',
  'stop',
  'restart',
  'status',
  'logs',
  'disable',
  'remove',
  'rm',
];

export function validateName(name: string): boolean {
  if (!name || name === '.' || name === '..') return false;
  return /^[a-zA-Z0-9_.-]+$/.test(name);
}

export function validateService(service: string): boolean {
  if (!service || !service.endsWith('.service')) return false;
  const base = service.slice(0, -'.service'.length);
  return validateName(base);
}

export function validateHost(host: string): boolean {
  if (!host || host.startsWith('-')) return false;
  return /^[a-zA-Z0-9_@.:-]+$/.test(host);
}

export function validatePort(port: unknown): number | undefined {
  const val =
    typeof port === 'string' ? Number(port) : typeof port === 'number' ? port : Number.NaN;
  return Number.isInteger(val) && val > 0 && val <= 65535 ? val : undefined;
}

export type ParseCliResult =
  | { ok: true; action: 'exit'; exitCode: number }
  | { ok: true; action: 'run'; parsed: ParsedCli }
  | { ok: false; exitCode: number; error: string };

export function parseCliArgs(argv: readonly string[]): ParseCliResult {
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: {
        ssh: { type: 'string' },
        'dry-run': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
      allowPositionals: true,
      strict: true,
    });

    if (parsed.values.help) {
      console.log(HELP_TEXT);
      return { ok: true, action: 'exit', exitCode: 0 };
    }

    if (parsed.values.version) {
      console.log(`pizdeploy v${VERSION}`);
      return { ok: true, action: 'exit', exitCode: 0 };
    }

    const flagSsh = parsed.values.ssh;
    if (flagSsh !== undefined && !validateHost(flagSsh)) {
      console.error(USAGE);
      return { ok: false, exitCode: 2, error: USAGE };
    }

    const dryRun = parsed.values['dry-run'] ?? false;
    const positionals = parsed.positionals;
    let command: 'deploy' | 'ps' | 'init' | ServiceAction;
    let targetServiceArg: string | undefined;

    if (positionals.length === 0) {
      command = 'deploy';
    } else if (positionals.length === 1 && positionals[0] === 'init') {
      command = 'init';
    } else if (positionals.length === 1 && positionals[0] === 'ps') {
      command = 'ps';
    } else if (SERVICE_CMDS.includes(positionals[0] as ServiceAction) && positionals.length <= 2) {
      command = positionals[0] as ServiceAction;
      targetServiceArg = positionals[1];
      if (targetServiceArg && !validateName(targetServiceArg.replace(/\.service$/, ''))) {
        console.error(USAGE);
        return { ok: false, exitCode: 2, error: USAGE };
      }
    } else {
      console.error(USAGE);
      return { ok: false, exitCode: 2, error: USAGE };
    }

    return {
      ok: true,
      action: 'run',
      parsed: {
        command,
        flagSsh,
        dryRun,
        targetServiceArg,
      },
    };
  } catch {
    console.error(USAGE);
    return { ok: false, exitCode: 2, error: USAGE };
  }
}
