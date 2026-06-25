import { parseMoney } from './money';

describe('parseMoney', () => {
  it('returns finite numbers unchanged', () => {
    expect(parseMoney(12.5)).toBe(12.5);
    expect(parseMoney(0)).toBe(0);
    expect(parseMoney(-3)).toBe(-3);
  });

  it('returns 0 for non-finite numbers', () => {
    expect(parseMoney(Number.NaN)).toBe(0);
    expect(parseMoney(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('parses numeric strings (trimmed)', () => {
    expect(parseMoney('19.99')).toBe(19.99);
    expect(parseMoney('  42  ')).toBe(42);
  });

  it('returns 0 for non-numeric strings', () => {
    expect(parseMoney('abc')).toBe(0);
    expect(parseMoney('')).toBe(0);
  });

  it('parses finite bigints', () => {
    expect(parseMoney(10n)).toBe(10);
  });

  it('returns 0 for non-finite bigints', () => {
    expect(parseMoney(10n ** 400n)).toBe(0);
  });

  it('returns 0 for unsupported types', () => {
    expect(parseMoney(null)).toBe(0);
    expect(parseMoney(undefined)).toBe(0);
    expect(parseMoney({})).toBe(0);
    expect(parseMoney([])).toBe(0);
    expect(parseMoney(true)).toBe(0);
  });
});
