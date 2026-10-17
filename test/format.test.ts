import { describe, expect, test } from 'bun:test';
import { formatDuration, formatStepSuccess, isColorSupported } from '../src/format';

describe('formatDuration', () => {
  test('форматирует значения менее 1000 мс в миллисекунды с двумя знаками', () => {
    expect(formatDuration(0)).toBe('0.00ms');
    expect(formatDuration(0.123)).toBe('0.12ms');
    expect(formatDuration(12.345)).toBe('12.35ms');
    expect(formatDuration(999.99)).toBe('999.99ms');
  });

  test('форматирует значения от 1000 мс и более в секунды с двумя знаками', () => {
    expect(formatDuration(1000)).toBe('1.00s');
    expect(formatDuration(1234.5)).toBe('1.23s');
    expect(formatDuration(12345)).toBe('12.35s');
  });

  test('отрицательные значения защищены и форматируются как 0.00ms', () => {
    expect(formatDuration(-10)).toBe('0.00ms');
  });
});

describe('isColorSupported', () => {
  const originalEnv = { ...process.env };

  test('отключает цвет при установленной NO_COLOR', () => {
    process.env.NO_COLOR = '1';
    delete process.env.FORCE_COLOR;
    expect(isColorSupported()).toBe(false);
    process.env = { ...originalEnv };
  });

  test('включает цвет при FORCE_COLOR="1", если NO_COLOR не установлена', () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    expect(isColorSupported()).toBe(true);
    process.env = { ...originalEnv };
  });
});

describe('formatStepSuccess', () => {
  const originalEnv = { ...process.env };

  test('содержит отметку ✓, название шага и время в квадратных скобках (NO_COLOR)', () => {
    process.env.NO_COLOR = '1';
    const formatted = formatStepSuccess('сборка', 45.12);
    expect(formatted).toBe('✓ сборка [45.12ms]');
    process.env = { ...originalEnv };
  });

  test('содержит цветную отметку при FORCE_COLOR="1"', () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    const formatted = formatStepSuccess('доставка архива', 1500);
    expect(formatted).toContain('✓');
    expect(formatted).toContain('доставка архива');
    expect(formatted).toContain('[1.50s]');
    expect(formatted).toContain('\x1b[32m');
    process.env = { ...originalEnv };
  });
});

describe('SNAKE_FRAMES', () => {
  test('содержит непустой массив односимвольных кадров змейки', async () => {
    const { SNAKE_FRAMES } = await import('../src/format');
    expect(SNAKE_FRAMES.length).toBeGreaterThan(0);
    for (const frame of SNAKE_FRAMES) {
      expect(frame.length).toBe(1);
    }
  });
});

describe('isInteractive', () => {
  const originalEnv = { ...process.env };

  test('отключает интерактивность при CI=true или PIZDEPLOY_NO_SPINNER=1', async () => {
    const { isInteractive } = await import('../src/format');
    process.env.CI = '1';
    expect(isInteractive()).toBe(false);

    delete process.env.CI;
    process.env.PIZDEPLOY_NO_SPINNER = '1';
    expect(isInteractive()).toBe(false);

    process.env = { ...originalEnv };
  });
});

describe('withStep', () => {
  test('неинтерактивный режим: успешный шаг выводит formatStepSuccess и возвращает результат', async () => {
    const { withStep } = await import('../src/format');
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    try {
      const res = await withStep(
        'проверка каталогов',
        async () => {
          await Bun.sleep(10);
          return 0;
        },
        { interactive: false },
      );

      expect(res).toBe(0);
      expect(logs.length).toBe(1);
      expect(logs[0]).toContain('✓');
      expect(logs[0]).toContain('проверка каталогов');
      expect(logs[0]).toMatch(/\[\d+\.\d+ms\]/);
    } finally {
      console.log = origLog;
    }
  });

  test('неинтерактивный режим: сбойный шаг не выводит успех в stdout', async () => {
    const { withStep } = await import('../src/format');
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    try {
      const res = await withStep(
        'сбойная операция',
        async () => {
          return 1;
        },
        { interactive: false },
      );

      expect(res).toBe(1);
      expect(logs.length).toBe(0);
    } finally {
      console.log = origLog;
    }
  });

  test('неинтерактивный режим: выброшенная ошибка пробрасывается наружу', async () => {
    const { withStep } = await import('../src/format');
    await expect(
      withStep(
        'падение',
        async () => {
          throw new Error('boom');
        },
        { interactive: false },
      ),
    ).rejects.toThrow('boom');
  });

  test('интерактивный режим: выводит кадры спиннера и перезаписывает строку на ✓ при успехе', async () => {
    const { withStep } = await import('../src/format');
    const writes: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(chunk.toString());
      return true;
    }) as typeof process.stdout.write;

    try {
      const res = await withStep(
        'тяжёлая сборка',
        async () => {
          await Bun.sleep(100);
          return 'done';
        },
        { interactive: true },
      );

      expect(res).toBe('done');
      const allWrites = writes.join('');
      expect(allWrites).toContain('тяжёлая сборка');
      expect(allWrites).toContain('✓');
      expect(allWrites).toContain('тяжёлая сборка [');
      expect(allWrites).toContain('\r\x1b[K');
    } finally {
      process.stdout.write = origWrite;
    }
  });

  test('интерактивный режим: при сбое или исключении очищает строку спиннера', async () => {
    const { withStep } = await import('../src/format');
    const writes: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(chunk.toString());
      return true;
    }) as typeof process.stdout.write;

    try {
      const res = await withStep(
        'неудачный шаг',
        async () => {
          return 1;
        },
        { interactive: true },
      );
      expect(res).toBe(1);
      expect(writes[writes.length - 1]).toBe('\r\x1b[K');

      await expect(
        withStep(
          'шаг с исключением',
          async () => {
            throw new Error('fail');
          },
          { interactive: true },
        ),
      ).rejects.toThrow('fail');
      expect(writes[writes.length - 1]).toBe('\r\x1b[K');
    } finally {
      process.stdout.write = origWrite;
    }
  });
});
