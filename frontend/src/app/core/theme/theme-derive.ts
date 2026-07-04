/**
 * Shade / state token DERIVATION (P1a WU4b-derive).
 *
 * The security foundation that eliminates the white-on-white bypass class: only
 * the NINE primary colour tokens are admin-editable; the fourteen shade / state
 * tokens are COMPUTED from those primaries here and can never be set by an admin.
 *
 *   PRIMARY (editable): --background, --surface, --surface-inverse, --text,
 *     --text-heading, --text-muted, --accent, --border, --overlay.
 *   DERIVED (computed): --background-subtle, --surface-muted, --surface-raised,
 *     --surface-inverse-hover, --field, --text-strong, --text-secondary,
 *     --accent-strong, --accent-subtle, --border-muted, --border-strong,
 *     --border-inverse, --text-inverse, --text-onmedia.
 *
 * Because the ON-COLOURS (`--text-inverse`, `--text-onmedia`, `--border-inverse`)
 * are derived to CONTRAST their background — `--text-inverse` is black-or-white
 * chosen for maximum WCAG contrast against `--surface-inverse`, `--text-onmedia`
 * likewise against `--accent` — a failing pairing on those surfaces is impossible
 * BY CONSTRUCTION: `max(contrast(black), contrast(white))` against any colour is
 * always >= 4.58:1 (the crossover minimum), so both always clear AA. An admin has
 * no key to force white-on-white.
 *
 * Colour maths runs in sRGB with per-channel linear interpolation (`mix`), which
 * is documented as an acceptable derivation space (WU spec) and — critically for
 * the TS<->Python parity contract — is trivially bit-identical across languages:
 * both round `a + t*(b - a)` with round-half-up (`Math.round` in TS,
 * `floor(x + 0.5)` in Python; identical for the non-negative 0-255 domain). The
 * fixture-driven parity harness proves both sides emit the same output.
 *
 * Mirrors `backend/app/services/theme_derive.py`.
 */

import { contrastRatio, type RgbTriplet } from './contrast';

/**
 * The nine admin-editable primary colour tokens + their compiled-default `R G B`
 * (source of truth). Each default equals the frozen WU2 registry fallback — a
 * spec asserts that parity — but is duplicated here so the pure derivation stays
 * branch-free (no defensive "missing from registry" path to leave uncovered).
 */
export const PRIMARY_DEFAULTS: Readonly<Record<string, string>> = {
  '--background': '255 255 255',
  '--surface': '241 245 249',
  '--surface-inverse': '15 23 42',
  '--text': '51 65 85',
  '--text-heading': '15 23 42',
  '--text-muted': '100 116 139',
  '--accent': '79 70 229',
  '--border': '226 232 240',
  '--overlay': '0 0 0',
};

/** The nine admin-editable primary colour token names (source of truth). */
export const PRIMARY_COLOR_NAMES: readonly string[] = Object.keys(PRIMARY_DEFAULTS);

/** The fourteen derived (computed, non-editable) colour token names. */
export const DERIVED_COLOR_NAMES: readonly string[] = [
  '--background-subtle',
  '--surface-muted',
  '--surface-raised',
  '--surface-inverse-hover',
  '--field',
  '--text-strong',
  '--text-secondary',
  '--accent-strong',
  '--accent-subtle',
  '--border-muted',
  '--border-strong',
  '--border-inverse',
  '--text-inverse',
  '--text-onmedia',
];

const BLACK: RgbTriplet = [0, 0, 0];
const WHITE: RgbTriplet = [255, 255, 255];

/** Round-half-up (matches Python `floor(x + 0.5)` for the non-negative domain). */
function roundChannel(value: number): number {
  return Math.round(value);
}

/** Parse a frozen `R G B` triplet string into an sRGB tuple. */
export function parseTriplet(value: string): RgbTriplet {
  const parts = value.split(' ');
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** Render an sRGB tuple back to the frozen space-separated `R G B` wire format. */
export function formatTriplet([r, g, b]: RgbTriplet): string {
  return `${r} ${g} ${b}`;
}

/** Per-channel linear interpolation a fraction `t` of the way from `a` to `b`. */
function mix(a: RgbTriplet, b: RgbTriplet, t: number): RgbTriplet {
  return [
    roundChannel(a[0] + t * (b[0] - a[0])),
    roundChannel(a[1] + t * (b[1] - a[1])),
    roundChannel(a[2] + t * (b[2] - a[2])),
  ];
}

/**
 * Black-or-white, whichever has the greater WCAG contrast against `bg`. Ties go
 * to white. The chosen extreme always clears >= 4.58:1 (the black/white crossover
 * minimum), so an on-colour is AA against ANY background by construction.
 */
export function bestOnColor(bg: RgbTriplet): RgbTriplet {
  return contrastRatio(WHITE, bg) >= contrastRatio(BLACK, bg) ? WHITE : BLACK;
}

/** How each derived token is computed from the primaries. */
type Derivation =
  | { readonly op: 'mix'; readonly a: string; readonly b: string; readonly t: number }
  | { readonly op: 'mixblack'; readonly a: string; readonly t: number }
  | { readonly op: 'copy'; readonly a: string }
  | { readonly op: 'oncolor'; readonly a: string };

/**
 * The frozen derivation table. Fractions are tuned so the derived defaults
 * reproduce today's `styles.css` `:root` values within a small tolerance (<= 4 /
 * 255 per channel; verified by the parity/default specs) — no visual regression.
 */
export const DERIVATIONS: Readonly<Record<string, Derivation>> = {
  // Shade steps toward a lighter/darker neighbour primary.
  '--background-subtle': { op: 'mix', a: '--background', b: '--surface', t: 0.5 },
  '--surface-muted': { op: 'mix', a: '--surface', b: '--background', t: 0.5 },
  '--surface-raised': { op: 'mix', a: '--surface', b: '--border', t: 0.85 },
  '--surface-inverse-hover': { op: 'mix', a: '--surface-inverse', b: '--background', t: 0.07 },
  '--field': { op: 'mix', a: '--surface', b: '--background', t: 0.9 },
  '--text-strong': { op: 'mix', a: '--text', b: '--text-heading', t: 0.6 },
  '--text-secondary': { op: 'mix', a: '--text', b: '--text-muted', t: 0.4 },
  '--accent-strong': { op: 'mixblack', a: '--accent', t: 0.3 },
  '--accent-subtle': { op: 'mix', a: '--accent', b: '--background', t: 0.92 },
  '--border-muted': { op: 'mix', a: '--border', b: '--surface', t: 0.25 },
  '--border-strong': { op: 'mix', a: '--border', b: '--text', t: 0.114 },
  // On-colours + inverse edge — contrast-derived or copied, NOT admin-settable.
  '--border-inverse': { op: 'copy', a: '--surface-inverse' },
  '--text-inverse': { op: 'oncolor', a: '--surface-inverse' },
  '--text-onmedia': { op: 'oncolor', a: '--accent' },
};

/** Resolve a primary's current triplet from `primaries`, else its compiled default. */
function primaryValue(primaries: Readonly<Record<string, string>>, name: string): RgbTriplet {
  return parseTriplet(primaries[name] ?? PRIMARY_DEFAULTS[name]);
}

/** Compute one derived token's triplet from the primary values. */
function computeDerived(
  derivation: Derivation,
  primaries: Readonly<Record<string, string>>,
): RgbTriplet {
  switch (derivation.op) {
    case 'mix':
      return mix(
        primaryValue(primaries, derivation.a),
        primaryValue(primaries, derivation.b),
        derivation.t,
      );
    case 'mixblack':
      return mix(primaryValue(primaries, derivation.a), BLACK, derivation.t);
    case 'copy':
      return primaryValue(primaries, derivation.a);
    case 'oncolor':
      return bestOnColor(primaryValue(primaries, derivation.a));
  }
}

/** The `name -> R G B` map of ONLY the fourteen derived tokens for `primaries`. */
export function deriveColorTokens(
  primaries: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of DERIVED_COLOR_NAMES) {
    out[name] = formatTriplet(computeDerived(DERIVATIONS[name], primaries));
  }
  return out;
}

/**
 * The full effective token map: the caller's editable tokens (primaries + fonts +
 * spacing pass through untouched) with the fourteen derived colour tokens COMPUTED
 * and overlaid. Any derived key present in the input is IGNORED and recomputed, so
 * a doc that tries to smuggle a derived value can never win — the source of truth
 * is always the primaries.
 */
export function deriveTokens(
  input: Readonly<Record<string, string>>,
): Record<string, string> {
  const passthrough: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    if (!DERIVED_COLOR_NAMES.includes(name)) {
      passthrough[name] = value;
    }
  }
  return { ...passthrough, ...deriveColorTokens(input) };
}
