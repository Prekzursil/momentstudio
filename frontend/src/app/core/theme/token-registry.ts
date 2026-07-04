/**
 * Closed theme-token registry + per-token-type value validators (P1a WU2).
 *
 * The single source of truth for what a token NAME and VALUE may be. An admin
 * may supply a value for a known key but may never introduce a key: every
 * `--token` name must be a member of the closed base registry or a
 * server-emitted derived-ramp name, and must match `^--[a-zA-Z0-9-]+$`.
 * Anything else resolves to `undefined` and hard-rejects.
 *
 * Wire format is frozen by the WU0 spike memo §4:
 * - Tailwind-consumed color -> bare space-separated `R G B` triplet.
 * - Non-Tailwind literal color -> hex / `rgb()` / `hsl()` literal.
 * - `font-family` -> curated enum (never free text).
 * - sizes / spacing -> numeric+unit (or a safe `clamp/min/max/calc`).
 *
 * Mirrors `backend/app/services/theme_validation.py`.
 */

export const TOKEN_NAME_PATTERN = /^--[a-zA-Z0-9-]+$/;

/** Curated font-family enum — never free text (blocks arbitrary @font-face). */
export const FONT_FAMILY_ALLOWLIST: readonly string[] = [
  'Inter, system-ui, -apple-system, sans-serif',
  'Cinzel, ui-serif, Georgia, serif',
  'system-ui, sans-serif',
  'ui-serif, Georgia, serif',
  'ui-monospace, SFMono-Regular, Menlo, monospace',
];

/** The frozen token value types. */
export type TokenType = 'color-triplet' | 'color-literal' | 'font-family' | 'numeric';

/** A registry entry: the token's type, its value validator and safe default. */
export interface TokenEntry {
  readonly kind: TokenType;
  readonly validate: (value: string) => boolean;
  readonly fallback: string;
  readonly allowUrl: boolean;
}

const CHANNEL = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const TRIPLET = new RegExp(`^${CHANNEL}(?: ${CHANNEL}){2}$`);

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_FN = /^rgba?\(\s*[0-9.,%\s/]+\)$/i;
const HSL_FN = /^hsla?\(\s*[0-9.,%\s/deg]+\)$/i;

const SIMPLE_LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|vw|vh|vmin|vmax|%|ch|ex|pt)$/;
const MATH_PREFIX = /^(?:clamp|min|max|calc)\(.+\)$/;
const MATH_FUNC_NAMES = /\b(?:clamp|min|max|calc)\b/g;
const MATH_UNITS = /px|rem|em|vw|vh|vmin|vmax|ch|ex|pt|%/g;
const MATH_BODY = /^[-0-9.\s,+*/()]+$/;

/** True for a bare space-separated `R G B` triplet, each channel 0-255. */
export function isColorTriplet(value: string): boolean {
  return TRIPLET.test(value);
}

/** True for a hex, `rgb()`/`rgba()` or `hsl()`/`hsla()` literal color. */
export function isColorLiteral(value: string): boolean {
  return HEX.test(value) || RGB_FN.test(value) || HSL_FN.test(value);
}

/** True only for an exact member of the curated font-family allowlist. */
export function isFontFamily(value: string): boolean {
  return FONT_FAMILY_ALLOWLIST.includes(value);
}

/** True for a numeric+unit length or a safe clamp/min/max/calc expression. */
export function isNumericLength(value: string): boolean {
  if (SIMPLE_LENGTH.test(value)) {
    return true;
  }
  if (!MATH_PREFIX.test(value)) {
    return false;
  }
  const stripped = value.replace(MATH_FUNC_NAMES, '').replace(MATH_UNITS, '');
  return MATH_BODY.test(stripped);
}

function tripletEntry(fallback: string): TokenEntry {
  return { kind: 'color-triplet', validate: isColorTriplet, fallback, allowUrl: false };
}

function fontEntry(fallback: string): TokenEntry {
  return { kind: 'font-family', validate: isFontFamily, fallback, allowUrl: false };
}

function numericEntry(fallback: string): TokenEntry {
  return { kind: 'numeric', validate: isNumericLength, fallback, allowUrl: false };
}

// Closed base-token registry. Fallbacks are the compiled defaults derived from
// today's styles.css (in the frozen R G B / curated-enum / numeric wire format).
const BASE_TOKENS = new Map<string, TokenEntry>([
  ['--background', tripletEntry('255 255 255')],
  ['--surface', tripletEntry('241 245 249')],
  ['--surface-inverse', tripletEntry('15 23 42')],
  ['--text', tripletEntry('51 65 85')],
  ['--text-inverse', tripletEntry('255 255 255')],
  ['--text-heading', tripletEntry('15 23 42')],
  ['--text-strong', tripletEntry('15 23 42')],
  ['--text-muted', tripletEntry('100 116 139')],
  ['--border', tripletEntry('226 232 240')],
  ['--accent', tripletEntry('79 70 229')],
  ['--overlay', tripletEntry('0 0 0')],
  ['--font-body', fontEntry('Inter, system-ui, -apple-system, sans-serif')],
  ['--font-heading', fontEntry('Cinzel, ui-serif, Georgia, serif')],
  ['--font-size-base', numericEntry('1rem')],
]);

// Server-emitted derived-ramp names (WU5/WU6 precomputed shade ramp + spacing).
const COLOR_RAMP =
  /^--(background|surface|text|border)-(?:50|100|200|300|400|500|600|700|800|900|950)$/;
const SPACE_RAMP = /^--space-(?:3xs|2xs|xs|sm|md|lg|xl|2xl|3xl)$/;
const RAMP_FALLBACK: Record<string, string> = {
  background: '255 255 255',
  surface: '241 245 249',
  text: '51 65 85',
  border: '226 232 240',
};

/** Resolve a token NAME to its registry entry, or `undefined` to hard-reject. */
export function resolveToken(name: string): TokenEntry | undefined {
  if (!TOKEN_NAME_PATTERN.test(name)) {
    return undefined;
  }
  const base = BASE_TOKENS.get(name);
  if (base) {
    return base;
  }
  const ramp = COLOR_RAMP.exec(name);
  if (ramp) {
    return tripletEntry(RAMP_FALLBACK[ramp[1]]);
  }
  if (SPACE_RAMP.test(name)) {
    return numericEntry('1rem');
  }
  return undefined;
}
