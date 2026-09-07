import { shouldReloadOnRetry } from './offline.helpers';

/** Golden WU offline-should-reload — shouldReloadOnRetry. */
describe('offline shouldReloadOnRetry (golden WU tip)', () => {
  it('reloads only when online is true', () => {
    expect(shouldReloadOnRetry(true)).toBe(true);
    expect(shouldReloadOnRetry(false)).toBe(false);
  });
});
