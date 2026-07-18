/**
 * CSS-safe encoder for theme token values (P1a WU2).
 *
 * The SOLE defence against a tainted `--custom-property` value reaching the
 * stylesheet: Angular does NOT sanitize `--*` custom-property bindings, and the
 * SSR head-inline `<style>` is emitted server-side, so every token value flows
 * through this encoder before it is validated and emitted.
 *
 * Strategy: DECODE CSS unicode escapes first (so an escaped `\3c` cannot slip a
 * `<` past a later check), then HARD-REJECT any value that could break out of
 * the declaration/rule it lives in — `</style>`/`<`, control characters, rule
 * or selector breakouts (`{` `}` `;`), `@import`, `expression()`, and any
 * `url()` outside an `https:`/self allowlist. A rejected value is never
 * emitted; the caller degrades to a compiled default.
 *
 * Mirrors `backend/app/services/theme_validation.py`.
 */

const HEX_ESCAPE = /\\([0-9a-fA-F]{1,6})[ \t\n\f\r]?/g;
const LITERAL_ESCAPE = /\\([^0-9a-fA-F])/g;
// URL-target class excludes quotes, `)`, `(` and whitespace. Excluding `(`
// mirrors the CSS url-token grammar (an unquoted `url()` value cannot contain an
// unescaped `(`) and keeps matching linear: the scan stops at the next `(`
// instead of running to end-of-input and backtracking, so `url(` followed by
// many `url(!` repetitions can no longer drive polynomial backtracking (ReDoS).
// Mirrors the backend theme_validation `_URL_CALL` (which additionally matches
// the class possessively; JS has no possessive quantifier, but the `(` exclusion
// alone is linear and match-equivalent — a spaced/`(`-bearing target still fails).
const URL_CALL = /url\(\s*(['"]?)([^'")(\s]*)\1\s*\)/gi;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** True if the value contains a C0 control character or DEL (0x00-0x1f, 0x7f). */
function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** Result of {@link encodeCssSafe}: a safe (decoded) value, or a rejection. */
export interface EncodeResult {
  readonly ok: boolean;
  readonly value: string;
}

/** Options controlling {@link encodeCssSafe}. */
export interface EncodeOptions {
  /** Permit `url()` values whose target is an `https:`/self URL. */
  readonly allowUrl?: boolean;
}

/**
 * True for a self/relative URL or an absolute `https:` URL, using an origin
 * parse (not a substring match, which `javascript:%0ahttps:` could fool).
 */
export function isAllowedUrl(raw: string): boolean {
  const candidate = raw.trim();
  if (candidate === '') {
    return false;
  }
  if (!SCHEME.test(candidate)) {
    return true;
  }
  try {
    return new URL(candidate).protocol === 'https:';
  } catch {
    return false;
  }
}

function decodeHexEscape(_match: string, hex: string): string {
  const codepoint = Number.parseInt(hex, 16);
  if (codepoint === 0 || codepoint > 0x10ffff) {
    return '\uFFFD';
  }
  return String.fromCodePoint(codepoint);
}

/** Decode CSS numeric (`\3c`) and literal (`\g`) escapes to plain characters. */
export function decodeCssEscapes(value: string): string {
  const decoded = value.replace(HEX_ESCAPE, decodeHexEscape);
  return decoded.replace(LITERAL_ESCAPE, '$1');
}

function reject(): EncodeResult {
  return { ok: false, value: '' };
}

/** Decode escapes first, then hard-reject any CSS breakout / injection sink. */
export function encodeCssSafe(value: string, options: EncodeOptions = {}): EncodeResult {
  const allowUrl = options.allowUrl ?? false;
  const decoded = decodeCssEscapes(value);
  if (hasControlChar(decoded)) {
    return reject();
  }
  if (decoded.includes('<')) {
    return reject();
  }
  if (decoded.includes('{') || decoded.includes('}') || decoded.includes(';')) {
    return reject();
  }
  const lowered = decoded.toLowerCase();
  if (lowered.includes('@import')) {
    return reject();
  }
  if (lowered.includes('expression(')) {
    return reject();
  }
  if (lowered.includes('javascript:')) {
    return reject();
  }
  if (lowered.includes('url(')) {
    if (!allowUrl) {
      return reject();
    }
    const matches = [...decoded.matchAll(URL_CALL)];
    if (matches.length === 0) {
      return reject();
    }
    for (const match of matches) {
      if (!isAllowedUrl(match[2])) {
        return reject();
      }
    }
  }
  return { ok: true, value: decoded };
}
