/**
 * Server-side published-theme source for the SSR head-inline sink (P1a WU6).
 *
 * `server.ts` today makes ZERO HTTP calls, so the SSR theme-fetch posture is
 * specified here explicitly rather than assumed:
 *
 *  - **Backend-URL wiring:** the express process reads its OWN `SSR_API_BASE_URL`
 *    env var (the Angular runtime config never reaches this process); the theme
 *    is resolved at `${base}/theme` (WU4a `GET /theme`).
 *  - **Failure / timeout -> compiled default, NEVER a 500:** the fetch runs under
 *    an explicit `AbortController` timeout; any failure/timeout returns `null` so
 *    the caller (`theme-head`) emits the compiled-default block — a themed render
 *    with defaults, never unstyled, never a 500 on the SSR hot path.
 *  - **Bounded in-process cache + publish invalidation:** the singleton
 *    storefront theme is held in a single-slot TTL cache so the hot path is not a
 *    per-request backend round-trip; `invalidateThemeCache()` (called by the
 *    WU4b publish path) forces the next request to re-read.
 *  - **Kill-switch:** an env flag forces compiled-defaults (bypassing the
 *    published/cached doc) for a misbehaving sink, independent of the backend
 *    fallback — flip it and every route renders the known-safe defaults with no
 *    redeploy.
 *
 * DERIVE-AWARE contract: this module returns the RAW published document as
 * fetched (the source-of-truth editable primaries + fonts + spacing). It does
 * NOT derive the shade / on-colour set itself — the WU6 sink (`theme-head`)
 * owns that: it re-validates every key through the WU2 registry (dropping any
 * derived / tampered key the cached doc might carry) and only THEN computes the
 * fourteen derived tokens via `deriveTokens`. Deriving here instead would emit
 * the DERIVED full set from an UN-validated cached doc, re-opening the
 * white-on-white bypass class — so derivation stays in the sink, after
 * validation, never in the transport/cache layer.
 *
 * This module is intentionally free of node-only imports (uses only `fetch` /
 * `AbortController` / `URL` — web-standard in both node 18+ and the browser) so
 * it is instrumented by the karma coverage gate. `server.ts` — which imports
 * express / `@angular/ssr/node` — is the node-only bootstrap that wires it in.
 */

/** A raw theme document token map as published (name -> value). */
export type ThemeTokenDoc = Readonly<Record<string, string>>;

/** Shape of the WU4a `GET /theme` response consumed server-side. */
interface ThemeReadResponse {
  readonly tokens?: Record<string, string>;
}

/** Resolved SSR theme-source configuration (env-derived, no I/O deps). */
export interface ThemeSourceConfig {
  /** Backend base URL the express process resolves `/theme` against. */
  readonly apiBaseUrl: string;
  /** Abort the published-token fetch after this many ms. */
  readonly timeoutMs: number;
  /** How long a fetched doc is served from the in-process cache. */
  readonly cacheTtlMs: number;
  /** When true, force compiled-defaults (bypass the published/cached doc). */
  readonly killSwitch: boolean;
}

/** Injected I/O dependencies (explicit so every branch is unit-testable). */
export interface ThemeFetchDeps {
  /** The `fetch` implementation (injected in tests, `globalThis.fetch` live). */
  readonly fetchImpl: typeof fetch;
  /** Monotonic-ish clock in ms (injected in tests, `Date.now` live). */
  readonly now: () => number;
}

const DEFAULT_API_BASE_URL = '/api/v1';
const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_CACHE_TTL_MS = 30_000;

/**
 * The ambient `process.env`, or `undefined` where there is no `process` (the
 * browser / karma). An explicit `if` (not an optional chain) so BOTH branches
 * are deterministically coverable regardless of any webpack `process` shim.
 */
export function processEnv(): Record<string, string | undefined> | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (proc === undefined) {
    return undefined;
  }
  return proc.env;
}

/**
 * Read a trimmed env var, safe in both the browser (karma, where `process` is
 * undefined) and the node SSR process. Empty / missing -> `undefined`.
 */
export function readEnv(
  name: string,
  env?: Record<string, string | undefined>,
): string | undefined {
  const source = env ?? processEnv();
  return source?.[name]?.trim() || undefined;
}

/** Derive the SSR theme-source config from the environment. */
export function readThemeConfig(env?: Record<string, string | undefined>): ThemeSourceConfig {
  const base = readEnv('SSR_API_BASE_URL', env) ?? DEFAULT_API_BASE_URL;
  const timeoutRaw = Number(readEnv('MS_THEME_TIMEOUT_MS', env));
  const ttlRaw = Number(readEnv('MS_THEME_CACHE_TTL_MS', env));
  return {
    apiBaseUrl: base.replace(/\/+$/, ''),
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS,
    cacheTtlMs: Number.isFinite(ttlRaw) && ttlRaw >= 0 ? ttlRaw : DEFAULT_CACHE_TTL_MS,
    killSwitch: readEnv('MS_THEME_KILL_SWITCH', env) === '1',
  };
}

/** Live I/O deps for the running express process. */
export function defaultFetchDeps(): ThemeFetchDeps {
  return { fetchImpl: globalThis.fetch.bind(globalThis), now: () => Date.now() };
}

interface CacheSlot {
  readonly tokens: ThemeTokenDoc;
  readonly expiresAt: number;
}

// Single-slot bounded cache — the storefront theme is a singleton document, so
// one slot with a TTL is a bounded cache (never grows). Reset on publish.
let cacheSlot: CacheSlot | null = null;

/** Invalidate the cached published theme (called by the WU4b publish path). */
export function invalidateThemeCache(): void {
  cacheSlot = null;
}

/** Fetch the published doc under an explicit timeout; `null` on any failure. */
async function fetchThemeDoc(
  config: ThemeSourceConfig,
  fetchImpl: typeof fetch,
): Promise<ThemeTokenDoc | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(`${config.apiBaseUrl}/theme`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as ThemeReadResponse;
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
 * Resolve the published theme doc for the SSR sink, or `null` to signal the
 * caller should emit compiled defaults. Applies (in order): the kill-switch,
 * the bounded TTL cache, then a timeout-bounded backend fetch.
 */
export async function getThemeTokens(
  config: ThemeSourceConfig,
  deps: ThemeFetchDeps,
): Promise<ThemeTokenDoc | null> {
  if (config.killSwitch) {
    return null;
  }
  const nowMs = deps.now();
  if (cacheSlot !== null && cacheSlot.expiresAt > nowMs) {
    return cacheSlot.tokens;
  }
  const doc = await fetchThemeDoc(config, deps.fetchImpl);
  if (doc === null) {
    return null;
  }
  cacheSlot = { tokens: doc, expiresAt: nowMs + config.cacheTtlMs };
  return doc;
}
