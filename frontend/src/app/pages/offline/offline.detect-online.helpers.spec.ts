import { detectBrowserOnline } from './offline.helpers';

/** Golden WU offline-detect-online — detectBrowserOnline. */
describe('detectBrowserOnline (golden WU tip)', () => {
  it('reads onLine and defaults optimistic when missing', () => {
    expect(detectBrowserOnline({ onLine: true })).toBe(true);
    expect(detectBrowserOnline({ onLine: false })).toBe(false);
    expect(detectBrowserOnline({})).toBe(true);
    expect(detectBrowserOnline(null)).toBe(true);
    expect(detectBrowserOnline(undefined)).toBe(true);
  });
});
