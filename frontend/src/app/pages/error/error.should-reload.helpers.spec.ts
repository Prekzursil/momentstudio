import { shouldReloadOnRetry } from './error.helpers';

/** Golden WU error-should-reload — shouldReloadOnRetry. */
describe('error shouldReloadOnRetry (golden WU tip)', () => {
  it('requires a reload function and rejects already-reloading', () => {
    expect(shouldReloadOnRetry(undefined)).toBe(false);
    expect(shouldReloadOnRetry(null)).toBe(false);
    expect(shouldReloadOnRetry(() => undefined)).toBe(true);
    expect(shouldReloadOnRetry(() => undefined, true)).toBe(false);
  });
});
