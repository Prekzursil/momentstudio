import { parseMoney } from './money';
describe('parseMoney number/string tip (golden WU)', () => {
  it('handles finite numbers and trimmed strings', () => {
    expect(parseMoney(3.5)).toBe(3.5);
    expect(parseMoney(Number.NaN)).toBe(0);
    expect(parseMoney(' 9 ')).toBe(9);
    expect(parseMoney('nope')).toBe(0);
  });
});
