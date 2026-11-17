import { of } from 'rxjs';

import { SiteSocialService } from '../../core/site-social.service';
import { NotFoundComponent } from './not-found.component';
import { notFoundHomeLinks, notFoundMessage, notFoundSuggestedPaths } from './not-found.helpers';

/**
 * Golden WU nf51 — first not-found page specs.
 * Covers home links, suggested recovery paths, and message keys.
 */
describe('NotFoundComponent home / suggested / message helpers', () => {
  it('notFoundHomeLinks returns the home escape path', () => {
    const links = notFoundHomeLinks();
    expect(links.map((l) => l.path)).toEqual(['/']);
    expect(links.map((l) => l.kind)).toEqual(['home']);
    // Fresh call must not share mutable state with a prior snapshot.
    expect(notFoundHomeLinks()).not.toBe(links);
    expect(notFoundHomeLinks()).toEqual(links);
  });

  it('notFoundSuggestedPaths returns shop and blog recovery paths', () => {
    const links = notFoundSuggestedPaths();
    expect(links.map((l) => l.path)).toEqual(['/shop', '/blog']);
    expect(links.map((l) => l.kind)).toEqual(['shop', 'blog']);
    expect(notFoundSuggestedPaths()).not.toBe(links);
    expect(notFoundSuggestedPaths()).toEqual(links);
  });

  it('notFoundMessage maps known keys and falls back to body', () => {
    expect(notFoundMessage('eyebrow')).toBe('404');
    expect(notFoundMessage('title')).toBe('Page not found');
    expect(notFoundMessage('body')).toContain("doesn't exist");
    expect(notFoundMessage(null)).toBe(notFoundMessage('body'));
    expect(notFoundMessage(undefined)).toBe(notFoundMessage('body'));
    expect(notFoundMessage('unknown-key')).toBe(notFoundMessage('body'));
  });
});

describe('NotFoundComponent field wiring (golden WU)', () => {
  it('exposes homeLinks, suggestedPaths, and message fields from helpers', () => {
    const social = {
      get: () => of({ contact: { email: 'help@example.com' } }),
    } as SiteSocialService;
    const cmp = new NotFoundComponent(social);
    expect(cmp.homeLinks).toEqual(notFoundHomeLinks());
    expect(cmp.suggestedPaths).toEqual(notFoundSuggestedPaths());
    expect(cmp.eyebrow).toBe(notFoundMessage('eyebrow'));
    expect(cmp.title).toBe(notFoundMessage('title'));
    expect(cmp.body).toBe(notFoundMessage('body'));
    expect(cmp.contactHref()).toBe('mailto:');
  });
});
