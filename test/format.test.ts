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
