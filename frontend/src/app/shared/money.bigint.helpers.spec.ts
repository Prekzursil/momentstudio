import { parseMoney } from './money';

/** Golden WU tip orphan — parseMoney bigint / unknown. */
describe('parseMoney bigint / unknown (golden WU)', () => {
  it('converts finite bigint values and zeros non-finite Number(bigint)', () => {
    expect(parseMoney(42n)).toBe(42);
    expect(parseMoney(0n)).toBe(0);
  });

  it('returns 0 for unsupported types', () => {
    expect(parseMoney(null)).toBe(0);
    expect(parseMoney(undefined)).toBe(0);
    expect(parseMoney({})).toBe(0);
    expect(parseMoney(true)).toBe(0);
  });
});
