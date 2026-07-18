/**
 * Server-side DRAFT-preview source for the SSR head-inline sink (P1a WU12).
 *
 * The published-theme path (`theme-source.ts`) renders every storefront visitor
 * the LIVE theme. This module adds the admin-only DRAFT-preview channel: when a
 * request carries a `theme_preview` token (minted behind the backend admin gate,
 * `POST /theme/preview-token`), the express SSR process resolves that token's
 * draft/version tokens from `GET /theme/preview?token=…` and injects THEM instead
 * of the published doc — so an admin sees the storefront rendered with the draft
 * WITHOUT publishing.
 *
 * Security posture (matches `theme-source.ts` and the backend gate):
 *  - The draft is NEVER exposed to an unauthenticated visitor: the backend route
 *    is token-gated + expiry-bounded; a missing / bad / expired token 403s and
 *    this module returns `null` so the caller falls back to compiled defaults
 *    (never the published doc, never the draft).
 *  - The preview fetch is NOT cached — a preview must reflect the latest draft
 *    and is short-lived per token, so it always round-trips (unlike the cached
 *    published path).
 *  - Runs under the same explicit `AbortController` timeout as the published
 *    fetch; any failure/timeout -> `null` -> compiled defaults, never a 500.
 *
 * DERIVE-AWARE: like `theme-source.ts`, this returns the RAW document as fetched;
 * the WU6 sink (`theme-head`) re-validates every key through the WU2 registry and
 * recomputes the derived tokens, so a tampered/cached draft cannot smuggle a
 * derived shade / on-colour past the sink.
 *
 * Intentionally free of node-only imports (uses only `URL` / `fetch` /
 * `AbortController`) so the karma coverage gate instruments it; `server.ts` (the
 * node-only express bootstrap) wires it in.
 */

import type { ThemeFetchDeps, ThemeSourceConfig, ThemeTokenDoc } from './theme-source';

/** The query-string key carrying the signed draft-preview token. */
export const PREVIEW_TOKEN_PARAM = 'theme_preview';

/** Shape of the WU12 `GET /theme/preview` response consumed server-side. */
interface ThemePreviewResponse {
  readonly tokens?: Record<string, string>;
}

/**
 * Extract the `theme_preview` token from a request URL, or `null` when absent.
 *
 * `rawUrl` is the express `originalUrl` (a path+query, possibly relative), so it
 * is parsed against a dummy origin. A malformed URL, an absent param, or an
 * empty/whitespace token all yield `null` (no preview -> the published path).
 */
export function readPreviewToken(rawUrl: string): string | null {
  let params: URLSearchParams;
  try {
    params = new URL(rawUrl, 'http://localhost').searchParams;
  } catch {
    return null;
  }
  const token = params.get(PREVIEW_TOKEN_PARAM);
  if (token === null) {
    return null;
  }
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve the previewed theme doc for a token, or `null` to signal the caller
 * should fall back to compiled defaults (never the published doc). Uncached and
 * timeout-bounded; any non-2xx / malformed body / failure returns `null`.
 */
export async function getPreviewThemeTokens(
  token: string,
  config: ThemeSourceConfig,
  deps: ThemeFetchDeps,
): Promise<ThemeTokenDoc | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const url = `${config.apiBaseUrl}/theme/preview?${PREVIEW_TOKEN_PARAM}=${encodeURIComponent(token)}`;
    const response = await deps.fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as ThemePreviewResponse;
    const tokens = body.tokens;
    if (tokens === undefined || tokens === null || typeof tokens !== 'object') {
      return null;
    }
    return tokens;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the doc the SSR sink should inject for a request: if the URL carries a
 * preview token, the previewed draft/version (or `null` -> defaults on any
 * failure); otherwise `null` so the caller uses the published path. Keeps the
 * preview-vs-published decision in one covered, node-free place.
 */
export async function resolvePreviewDoc(
  rawUrl: string,
  config: ThemeSourceConfig,
  deps: ThemeFetchDeps,
): Promise<{ isPreview: boolean; doc: ThemeTokenDoc | null }> {
  const token = readPreviewToken(rawUrl);
  if (token === null) {
    return { isPreview: false, doc: null };
  }
  const doc = await getPreviewThemeTokens(token, config, deps);
  return { isPreview: true, doc };
}
