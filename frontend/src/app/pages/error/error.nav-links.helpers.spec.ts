import { errorNavLinks, errorPageMessage } from './error.helpers';

/** Golden WU tip orphan — error helpers. */
describe('error helpers tip (golden WU)', () => {
  it('returns home/shop/blog escape paths', () => {
    expect(errorNavLinks().map((l) => l.path)).toEqual(['/', '/shop', '/blog']);
    expect(errorNavLinks()).not.toBe(errorNavLinks());
  });

  it('maps known kinds and falls back to generic', () => {
    expect(errorPageMessage('network')).toContain('network');
    expect(errorPageMessage('unknown-x')).toBe(errorPageMessage('generic'));
  });
});
