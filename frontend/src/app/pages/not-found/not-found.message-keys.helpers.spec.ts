import { notFoundMessage, notFoundHomeLinks, notFoundSuggestedPaths } from './not-found.helpers';

/** Golden WU tip orphan — not-found helpers. */
describe('not-found helpers tip (golden WU)', () => {
  it('maps message keys and falls back to body', () => {
    expect(notFoundMessage('eyebrow')).toBe('404');
    expect(notFoundMessage('title')).toBe('Page not found');
    expect(notFoundMessage('nope' as any)).toBe(notFoundMessage('body'));
  });

  it('returns fresh home and suggested path arrays', () => {
    expect(notFoundHomeLinks().map((l) => l.path)).toEqual(['/']);
    expect(notFoundSuggestedPaths().map((l) => l.path)).toEqual(['/shop', '/blog']);
    expect(notFoundHomeLinks()).not.toBe(notFoundHomeLinks());
  });
});
