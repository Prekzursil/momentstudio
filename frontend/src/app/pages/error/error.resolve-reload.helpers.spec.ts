import { resolveLocationReload } from './error.helpers';

/** Golden WU error-resolve-reload — resolveLocationReload. */
describe('resolveLocationReload (golden WU tip)', () => {
  it('returns a bound reload callback when host.reload exists', () => {
    const calls: number[] = [];
    const host = { reload: () => calls.push(1) };
    const fn = resolveLocationReload(host);
    expect(typeof fn).toBe('function');
    fn!();
    expect(calls).toEqual([1]);
    expect(resolveLocationReload(null)).toBeNull();
    expect(resolveLocationReload({})).toBeNull();
  });
});
