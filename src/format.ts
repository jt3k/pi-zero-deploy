/**
 * Кадры односимвольного спиннера в стиле snake game:
 * циклическое движение точки/хвоста по контуру ячейки символа Брайля.
 */
export const SNAKE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

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
 * Определяет, является ли окружение интерактивным терминалом,
 * в котором уместно запускать таймер анимации спиннера.
 */
export function isInteractive(): boolean {
  if (process.env.CI || process.env.PIZDEPLOY_NO_SPINNER) {
    return false;
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

/**
 * Формирует строку сбоя шага:
 * '✗ <label> [<duration>]' с красным крестиком при поддержке цвета.
 */
export function formatStepFailure(label: string, durationMs: number): string {
  const cross = isColorSupported() ? '\x1b[31m✗\x1b[0m' : '✗';
  return `${cross} ${label} [${formatDuration(durationMs)}]`;
}

function defaultIsSuccess(val: unknown): boolean {
  if (typeof val === 'number') {
    return val === 0;
  }
  if (
    val &&
    typeof val === 'object' &&
    'exitCode' in val &&
    typeof (val as { exitCode: unknown }).exitCode === 'number'
  ) {
    return (val as { exitCode: number }).exitCode === 0;
  }
  return true;
}

export interface StepOptions<T> {
  isSuccess?: (result: T) => boolean;
  interactive?: boolean;
}

/**
 * Декларативная обёртка выполнения шага:
 * - В интерактивном TTY отображает змейку-спиннер во время работы.
 * - По завершении атомарно перезаписывает строку на '✓ <label> [XX.XXms]'.
 * - В не-TTY выводит результат без перезаписи строки и не запускает таймеры.
 */
export async function withStep<T>(
  label: string,
  fn: () => Promise<T>,
  options: StepOptions<T> = {},
): Promise<T> {
  const interactive = options.interactive ?? isInteractive();
  const isSuccess = options.isSuccess ?? defaultIsSuccess;
  let timer: ReturnType<typeof setInterval> | undefined;
  let frameIndex = 0;

  if (interactive) {
    const renderFrame = () => {
      const frame = SNAKE_FRAMES[frameIndex % SNAKE_FRAMES.length];
      frameIndex++;
      const spinnerSymbol = isColorSupported() ? `\x1b[36m${frame}\x1b[0m` : frame;
      process.stdout.write(`\r\x1b[K${spinnerSymbol} ${label}`);
    };
    renderFrame();
    timer = setInterval(renderFrame, 80);
  }

  const start = performance.now();
  try {
    const result = await fn();
    const elapsed = performance.now() - start;
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }

    if (isSuccess(result)) {
      if (interactive) {
        process.stdout.write(`\r\x1b[K${formatStepSuccess(label, elapsed)}\n`);
      } else {
        console.log(formatStepSuccess(label, elapsed));
      }
    } else {
      if (interactive) {
        process.stdout.write('\r\x1b[K');
      }
    }
    return result;
  } catch (err) {
    if (timer) {
      clearInterval(timer);
    }
    if (interactive) {
      process.stdout.write('\r\x1b[K');
    }
    throw err;
  }
}
