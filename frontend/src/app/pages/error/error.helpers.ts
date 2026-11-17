/** Pure helpers for the error recovery page (message / nav / retry). */

export type ErrorPageKind = 'generic' | 'network' | 'server' | 'timeout';

export type ErrorNavLink = {
  readonly path: string;
  readonly kind: 'home' | 'shop' | 'blog';
};

const ERROR_MESSAGES: Readonly<Record<ErrorPageKind, string>> = {
  generic: "We've logged the issue. Please try again, return home, or contact support.",
  network: 'A network problem interrupted the request. Check your connection and retry.',
  server: 'The server could not complete the request. Please try again shortly.',
  timeout: 'The request timed out. Retry, or return home and try again later.',
};

/**
 * Map a known error kind to the user-facing body copy on the error page.
 * Unknown / blank kinds fall back to the generic recovery message.
 */
export function errorPageMessage(kind: ErrorPageKind | string | null | undefined): string {
  if (kind === 'network' || kind === 'server' || kind === 'timeout' || kind === 'generic') {
    return ERROR_MESSAGES[kind];
  }
  return ERROR_MESSAGES.generic;
}

/**
 * Escape routes shown beside Retry on the error page.
 * Paths must stay in sync with the ErrorComponent template routerLinks.
 */
export function errorNavLinks(): readonly ErrorNavLink[] {
  return [
    { path: '/', kind: 'home' },
    { path: '/shop', kind: 'shop' },
    { path: '/blog', kind: 'blog' },
  ] as const;
}

/**
 * Retry should only reload when a reload function is available and the caller
 * has not already armed a reload (guards double-submit / missing location).
 */
export function shouldReloadOnRetry(
  reloadFn: (() => void) | null | undefined,
  alreadyReloading = false,
): boolean {
  if (alreadyReloading) {
    return false;
  }
  return typeof reloadFn === 'function';
}

type ReloadHost = { reload?: () => void } | null | undefined;

/**
 * Resolve a reload callback from a location-like host.
 * Defaults to the browser `location` global when no host is passed.
 */
export function resolveLocationReload(
  host: ReloadHost = typeof location === 'undefined' ? null : location,
): (() => void) | null {
  if (!host || typeof host.reload !== 'function') {
    return null;
  }
  return () => host.reload!();
}
