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

// Closed base-token registry — the ADMIN-EDITABLE set ONLY. Fallbacks are the
// compiled defaults derived from today's styles.css (frozen R G B / curated-enum
// / numeric wire format); each colour fallback pins the LIGHT value (styles.css
// :root). The dark reassignment (styles.css :root.dark) is a runtime concern of
// the token layer, not the admin-value validator.
//
// COLOUR SPLIT (the fix for the white-on-white bypass class): ONLY the NINE
// primary colour tokens are editable here. The fourteen shade / state tokens
// (--background-subtle, --surface-muted/-raised, --surface-inverse-hover,
// --field, --text-strong/-secondary/-inverse/-onmedia, --accent-strong/-subtle,
// --border-muted/-strong/-inverse) are DERIVED from these primaries by
// `theme-derive.ts` and are DELIBERATELY ABSENT — so `resolveAdminEditable` (the
// draft-save / publish gate) rejects them as an unknown editable key and no
// admin-supplied draft can set a shade / on-colour to a contrast-failing value.
// (`resolveToken`, the broad SSR sink resolver, still accepts the server-emitted
// ramp for forward-compat; the admin gate is the strict `ADMIN_EDITABLE_NAMES`
// subset, which additionally exposes the five `--space-*` anchors.) The derived
// on-colours always contrast their background by construction; primary pairings
// are gated at publish.
const BASE_TOKENS = new Map<string, TokenEntry>([
  ['--background', tripletEntry('255 255 255')],
  ['--surface', tripletEntry('241 245 249')],
  ['--surface-inverse', tripletEntry('15 23 42')],
  ['--text', tripletEntry('51 65 85')],
  ['--text-heading', tripletEntry('15 23 42')],
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

// The admin-controllable spacing anchors — the CLOSED subset of the `--space-*`
// family that ships as a P1a admin control (mirrors the normal-tier `space(...)`
// entries in `token-taxonomy.ts` SEED_TOKENS). The wider `SPACE_RAMP` (`2xs` /
// `3xs` / `2xl` / `3xl`) is server-emitted only and NOT admin-settable.
const SPACE_ANCHOR_DEFAULTS: Record<string, string> = {
  '--space-xs': '0.5rem',
  '--space-sm': '0.75rem',
  '--space-md': '1rem',
  '--space-lg': '1.5rem',
  '--space-xl': '2rem',
};

// The CLOSED admin-editable registry — the ONLY names a draft-save / publish may
// set (`resolveAdminEditable`). A STRICT SUBSET of `resolveToken`: the twelve
// primary / font / size base tokens PLUS the five spacing anchors. It excludes the
// numeric colour ramp, the wider `--space-*` ramp, and every derived shade / state
// token — the guard that closes the white-on-white bypass class. Mirrors
// `backend/app/services/theme_validation.py::_ADMIN_EDITABLE_TOKENS`.
const ADMIN_EDITABLE_TOKENS = new Map<string, TokenEntry>([
  ...BASE_TOKENS,
  ...Object.entries(SPACE_ANCHOR_DEFAULTS).map(
    ([name, fallback]): [string, TokenEntry] => [name, numericEntry(fallback)],
  ),
]);

/**
 * The exact admin-settable token-name set (the pinning-test contract). Adding or
 * removing a key here changes the admin surface and MUST fail the pinning test.
 */
export const ADMIN_EDITABLE_NAMES: readonly string[] = [...ADMIN_EDITABLE_TOKENS.keys()];

/**
 * Resolve a token NAME to its registry entry, or `undefined` to hard-reject.
 *
 * The BROAD (sink-acceptable) resolver: accepts base tokens, the server-emitted
 * numeric colour ramp and the full `--space-*` ramp for forward-compat with the
 * WU5/WU6 SSR sink (`theme-head` re-validation). NOT the admin gate — use
 * {@link resolveAdminEditable} for the draft-save / publish path.
 */
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

/**
 * Resolve an ADMIN-SETTABLE token NAME (draft-save / publish path), else
 * `undefined`. STRICT subset of {@link resolveToken}: primaries + fonts + size +
 * the five spacing anchors ONLY. A numeric colour-ramp step, a wider `--space-*`
 * ramp step, or any derived shade / state token hard-rejects — an admin can never
 * set a computed / server-emitted token (the white-on-white bypass fix).
 */
export function resolveAdminEditable(name: string): TokenEntry | undefined {
  if (!TOKEN_NAME_PATTERN.test(name)) {
    return undefined;
  }
  return ADMIN_EDITABLE_TOKENS.get(name);
}
