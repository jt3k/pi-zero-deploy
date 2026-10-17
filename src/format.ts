/**
 * Форматирует длительность выполнения в стиле bun test:
 * - < 1000 мс: 'XX.XXms' (например, '12.34ms')
 * - >= 1000 мс: 'X.XXs' (например, '1.25s')
 */
export function formatDuration(ms: number): string {
  const safeMs = Math.max(0, ms);
  if (safeMs < 1000) {
    return `${safeMs.toFixed(2)}ms`;
  }
  return `${(safeMs / 1000).toFixed(2)}s`;
}

/**
 * Проверяет, следует ли использовать ANSI-цвета при выводе:
 * учитывает переменные NO_COLOR, FORCE_COLOR и свойство isTTY.
 */
export function isColorSupported(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') {
    return false;
  }
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0') {
    return true;
  }
  return Boolean(process.stdout.isTTY);
}

/**
 * Формирует строку успешного завершения шага:
 * '✓ <label> [<duration>]' с зелёной галочкой при поддержке цвета.
 */
export function formatStepSuccess(label: string, durationMs: number): string {
  const check = isColorSupported() ? '\x1b[32m✓\x1b[0m' : '✓';
  return `${check} ${label} [${formatDuration(durationMs)}]`;
}
