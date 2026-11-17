/** Pure helpers for the 404 / not-found page (home links / suggested paths / message keys). */

export type NotFoundMessageKey = 'eyebrow' | 'title' | 'body';

export type NotFoundNavLink = {
  readonly path: string;
  readonly kind: 'home' | 'shop' | 'blog';
};

const NOT_FOUND_MESSAGES: Readonly<Record<NotFoundMessageKey, string>> = {
  eyebrow: '404',
  title: 'Page not found',
  body: "The page you are looking for doesn't exist. Try heading back home or search the shop.",
};

/**
 * Primary home escape link(s) for the not-found page.
 * Paths must stay in sync with the NotFoundComponent template routerLinks.
 */
export function notFoundHomeLinks(): readonly NotFoundNavLink[] {
  return [{ path: '/', kind: 'home' }] as const;
}

/**
 * Suggested recovery paths (shop / blog) shown beside home on 404.
 * Paths must stay in sync with the NotFoundComponent template routerLinks.
 */
export function notFoundSuggestedPaths(): readonly NotFoundNavLink[] {
  return [
    { path: '/shop', kind: 'shop' },
    { path: '/blog', kind: 'blog' },
  ] as const;
}

/**
 * Resolve a known message key to the user-facing copy on the not-found page.
 * Unknown / blank keys fall back to the body recovery message.
 */
export function notFoundMessage(key: NotFoundMessageKey | string | null | undefined): string {
  if (key === 'eyebrow' || key === 'title' || key === 'body') {
    return NOT_FOUND_MESSAGES[key];
  }
  return NOT_FOUND_MESSAGES.body;
}
