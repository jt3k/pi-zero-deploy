import { existsSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import type { AutobuildInfo } from './types';

export const REMOTE_PROJECTS_ROOT = process.env.PIZDEPLOY_REMOTE_ROOT || '$HOME/projects';

export function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// Верификация службы: прямой запуск Node занимает ~5 с на Pi Zero, таймаут 60 с с запасом.
// Переменные окружения существуют только чтобы тесты не ждали минуту или для кастомной настройки.
export const VERIFY_TIMEOUT_MS = readNumberEnv('PIZDEPLOY_VERIFY_TIMEOUT_MS', 60_000);
export const VERIFY_INTERVAL_MS = readNumberEnv('PIZDEPLOY_VERIFY_INTERVAL_MS', 1_000);
export const STABLE_HOLD_MS = readNumberEnv('PIZDEPLOY_STABLE_HOLD_MS', 5_000);

/**
 * Эвристический разбор scripts.start для автоматической сборки, когда scripts.build отсутствует.
 * Ищет запускаемый файл, отделяя флаги node и аргументы приложения.
 */
export function detectAutobuildEntry(
  startCmd: string,
  cwd: string = process.cwd(),
): AutobuildInfo | null {
  const trimmed = startCmd.trim();
  if (!trimmed) return null;

  // Разбиваем команду на аргументы с учётом простых кавычек или пробелов
  const tokens = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  if (tokens.length === 0) return null;

  // Очищаем токен от внешних кавычек
  const stripQuotes = (t: string) => t.replace(/^['"](.*)['"]$/, '$1');

  // Первый токен: если это node/bun рантайм, отсекаем его
  let isNodeRuntime = false;
  let startIndex = 0;
  const first = tokens[0] ? stripQuotes(tokens[0]) : '';
  if (first === 'node' || first.endsWith('/node') || first === 'bun' || first.endsWith('/bun')) {
    isNodeRuntime = true;
    startIndex = 1;
  }

  const nodeFlags: string[] = [];
  let entryToken: string | null = null;
  let entryTokenIndex = -1;

  for (let i = startIndex; i < tokens.length; i++) {
    const raw = stripQuotes(tokens[i]);
    if (raw.startsWith('-')) {
      nodeFlags.push(raw);
    } else {
      entryToken = raw;
      entryTokenIndex = i;
      break;
    }
  }

  if (!entryToken) return null;

  // Обязательно проверяем расширение: если токена без рантайма, или расширение не JS/TS, то это неизвестный бинарник
  const ext = extname(entryToken);
  const recognizedExts = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx'];
  if (!ext || !recognizedExts.includes(ext.toLowerCase())) {
    // Без расширения допустимо только если токен явно указан после `node` и файл реально существует
    if (!isNodeRuntime || !existsSync(resolve(cwd, entryToken))) {
      return null;
    }
  }

  const baseName = basename(entryToken, ext || undefined);
  if (!baseName) return null;

  const appArgs = tokens.slice(entryTokenIndex + 1).map(stripQuotes);
  const outputFileName = `${baseName}.mjs`;

  const nodePrefix = '/usr/bin/node';
  const execParts = [nodePrefix, ...nodeFlags, outputFileName, ...appArgs];
  const execStart = execParts.join(' ');

  return {
    entryPath: entryToken,
    outputFileName,
    execStart,
  };
}

/** Извлекает и адаптирует команду scripts.start; при отсутствии или пустом значении — undefined. */
export function resolveExecStart(pkg: unknown): string | undefined {
  const raw = (pkg as { scripts?: { start?: unknown } })?.scripts?.start;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // Адаптируем пути вида dist/... -> ... потому что WorkingDirectory указывает на распакованный dist
  let cmd = trimmed.replace(/\bdist\//g, '');

  // Нормализуем node -> /usr/bin/node для абсолютного пути в systemd ExecStart
  if (cmd.startsWith('node ') || cmd === 'node') {
    cmd = '/usr/bin/' + cmd;
  }

  return cmd;
}

export function normalizeService(name: string): string {
  return name.endsWith('.service') ? name : `${name}.service`;
}

/** Читает необязательный `pizdeploy.port`; при отсутствии — undefined. */
export function resolvePort(pkg: unknown): number | undefined {
  const raw = (pkg as { pizdeploy?: { port?: unknown } })?.pizdeploy?.port;
  const port = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : Number.NaN;
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}
