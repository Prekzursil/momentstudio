/**
 * SSR head-inline theme sink — the head-builder (P1a WU6).
 *
 * Emits the ONE permitted stylesheet string: a hash-pinned `<style id="ms-theme">`
 * carrying the published theme tokens on `:root`, injected into `<head>` at
 * request time so SSR renders themed with no FOUC and "re-theme with no rebuild"
 * holds. Every token value is RE-VALIDATED through the WU2 sink at SSR time — the
 * stored/cached doc is NEVER trusted — and anything that fails hard-rejects to
 * the compiled default. A backend blip / kill-switch (`doc === null`) yields the
 * full compiled-default block, never an unstyled render.
 *
 * Security note: this module is the one permitted head-inline sink and is
 * therefore subject to the `bypassSecurityTrust*` / `innerHTML` CI-lint ban
 * (WU13). It uses ONLY pure string assembly + the WU2 validators — no DOM APIs,
 * no `innerHTML`, no Angular sanitizer bypass. Mirrors the express-side
 * head-injection precedent (`index.html` head hooks).
 */

import { deriveTokens } from '../app/core/theme/theme-derive';
import { SEED_TOKENS } from '../app/core/theme/token-taxonomy';
import { validateToken } from '../app/core/theme/token-validation';
import type { ThemeTokenDoc } from './theme-source';

/** The id of the single injected theme `<style>` element. */
export const STYLE_ELEMENT_ID = 'ms-theme';

/**
 * The compiled-default token map (name -> value) from the WU3 seed taxonomy —
 * the known-safe baseline emitted on a backend failure/timeout, the kill-switch,
 * or a fully-rejected malicious doc. Every value here passes the WU2 registry
 * validator (verified by the WU3 taxonomy spec), so the block always renders.
 */
export const COMPILED_DEFAULT_TOKENS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(SEED_TOKENS.map((token) => [token.name, token.compiledDefault])),
);

/**
 * Resolve a raw doc into the safe token map to emit. Start from the compiled
 * defaults (primaries + fonts + spacing), overlay ONLY doc values that pass WU2
 * validation — which now covers ONLY the editable PRIMARY keys, so a doc that
 * carries a derived shade / on-colour has it DROPPED here — then recompute every
 * derived token from the resolved primaries via `deriveTokens`. This is what
 * kills the bypass class: the emitted `:root` always gets its shade / state
 * tokens from the derivation, never from admin input, so a contrast-failing
 * `--surface-inverse-hover` / `--background-subtle` / white on-colour cannot be
 * injected. `null` (backend failure / kill-switch) -> derived compiled defaults.
 */
export function resolveThemeTokens(doc: ThemeTokenDoc | null): Record<string, string> {
  const editable: Record<string, string> = { ...COMPILED_DEFAULT_TOKENS };
  if (doc !== null) {
    for (const [name, value] of Object.entries(doc)) {
      const result = validateToken(name, value);
      if (result.ok) {
        editable[name] = result.value;
      }
    }
  }
  return deriveTokens(editable);
}

/**
 * Assemble the `:root` custom-property block from a resolved token map. Keys are
 * sorted for a deterministic, stable output (and hash). Every value is already
 * WU2-validated (no `;` `{` `}` `<`), so the assembly cannot break out.
 */
export function buildThemeCss(tokens: Readonly<Record<string, string>>): string {
  const declarations = Object.keys(tokens)
    .sort()
    .map((name) => `${name}: ${tokens[name]};`)
    .join('');
  return `:root{${declarations}}`;
}

/** Base64-encode raw bytes (browser + node via the global `btoa`). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Base64 SHA-256 of `text` via SubtleCrypto — the CSP hash of the style body. */
export async function sha256Base64(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToBase64(new Uint8Array(digest));
}

/**
 * Assemble the `Content-Security-Policy-Report-Only` value: the per-response
 * `style-src 'sha256-<hash>'` matching the emitted block, plus the zero-cost
 * hardening directives shipped now (N-C1) — `base-uri`, `object-src`,
 * `frame-ancestors`. The enforce flip + `unsafe-inline` removal stay P1b.
 */
export function buildCspReportOnly(hash: string): string {
  return [
    `style-src 'sha256-${hash}'`,
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
  ].join('; ');
}

/** The fully-assembled theme head: the style tag, its hash, and the CSP header. */
export interface ThemeHead {
  /** The `:root{…}` CSS text (the `<style>` element body). */
  readonly css: string;
  /** The complete `<style id="ms-theme">…</style>` tag to inject. */
  readonly styleTag: string;
  /** Base64 SHA-256 of `css` (the CSP `style-src 'sha256-…'` payload). */
  readonly hash: string;
  /** The `Content-Security-Policy-Report-Only` header value for this response. */
  readonly cspHeader: string;
  /** The resolved, validated token map that was emitted. */
  readonly tokens: Readonly<Record<string, string>>;
}

/** Build the hash-pinned theme `<style>` + report-only CSP for a doc (or null). */
export async function buildThemeHead(doc: ThemeTokenDoc | null): Promise<ThemeHead> {
  const tokens = resolveThemeTokens(doc);
  const css = buildThemeCss(tokens);
  const hash = await sha256Base64(css);
  const styleTag = `<style id="${STYLE_ELEMENT_ID}">${css}</style>`;
  return { css, styleTag, hash, cspHeader: buildCspReportOnly(hash), tokens };
}

const HEAD_OPEN = /<head[^>]*>/i;
const HEAD_CLOSE = '</head>';

/**
 * Inject the theme `<style>` as the FIRST child of `<head>` (before `<base>` /
 * preloads) so the themed `:root` is in the first head bytes — no default-then
 * -swap FOUC. Falls back to before `</head>`, then to a prepend, if the document
 * has no recognizable head (defensive; the SSR document always has one).
 */
export function injectThemeHead(html: string, styleTag: string): string {
  const openMatch = HEAD_OPEN.exec(html);
  if (openMatch !== null) {
    const at = openMatch.index + openMatch[0].length;
    return `${html.slice(0, at)}${styleTag}${html.slice(at)}`;
  }
  const closeIndex = html.indexOf(HEAD_CLOSE);
  if (closeIndex !== -1) {
    return `${html.slice(0, closeIndex)}${styleTag}${html.slice(closeIndex)}`;
  }
  return `${styleTag}${html}`;
}

/** A themed SSR render: the head-injected HTML + its report-only CSP header. */
export interface ThemedRender {
  readonly html: string;
  readonly cspHeader: string;
}

/**
 * The one call `server.ts` makes after `CommonEngine.render`: build the sink
 * from the (already-fetched) doc, inject it into `<head>`, and return the themed
 * HTML plus the matching report-only CSP header for the response.
 */
export async function applyThemeSsr(
  html: string,
  doc: ThemeTokenDoc | null,
): Promise<ThemedRender> {
  const head = await buildThemeHead(doc);
  return { html: injectThemeHead(html, head.styleTag), cspHeader: head.cspHeader };
}
