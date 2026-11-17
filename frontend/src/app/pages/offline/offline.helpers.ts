/** Pure helpers for the offline PWA recovery page (retry / nav / online). */

export type OfflineNavLink = {
  readonly path: string;
  readonly kind: 'home' | 'shop' | 'blog';
};

/**
 * Escape routes shown beside Retry on the offline page.
 * Paths must stay in sync with the OfflineComponent template routerLinks.
 */
export function offlineNavLinks(): readonly OfflineNavLink[] {
  return [
    { path: '/', kind: 'home' },
    { path: '/shop', kind: 'shop' },
    { path: '/blog', kind: 'blog' },
  ] as const;
}

/**
 * Read navigator.onLine with a safe default (optimistic online) when the
 * Navigator API is missing — mirrors PwaService constructor fallback.
 */
export function detectBrowserOnline(
  nav: { readonly onLine?: boolean } | null | undefined = typeof navigator !== 'undefined'
    ? navigator
    : undefined,
): boolean {
  if (!nav || typeof nav.onLine !== 'boolean') {
    return true;
  }
  return nav.onLine;
}

/**
 * Retry should only reload when the browser reports online; otherwise stay
 * on the offline page so a futile reload does not flash the UI.
 */
export function shouldReloadOnRetry(isOnline: boolean): boolean {
  return isOnline === true;
}
