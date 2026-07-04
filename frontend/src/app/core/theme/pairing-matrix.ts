/**
 * Curated global fg/bg contrast pairing matrix (P1a WU3).
 *
 * The pre-validated set of foreground/background colour pairings the storefront
 * defaults use, defined GLOBALLY across the home / listing / detail archetypes
 * (the token values are global, so a pairing's ratio is archetype-independent).
 * Every pairing is pre-validated >= WCAG AA using the WU8-core `contrast.ts`
 * maths, and each is tagged `size: 'body' | 'large'` (N-C4) so the AA threshold
 * (4.5:1 body / 3:1 large) is pinned per pairing rather than guessed — the exact
 * data WU8 enforces and WU10 exposes.
 *
 * Foreground/background reference the seed colour tokens by name
 * (`token-taxonomy.ts`); the ratios are computed from those tokens' compiled
 * defaults. A candidate that fails its honest AA target (e.g. muted text on the
 * raised surface, ~4.35:1 < 4.5) is deliberately EXCLUDED — the matrix is the
 * known-good set, not every possible combination.
 */

import {
  AA_THRESHOLDS,
  contrastRatio,
  meetsAa,
  passesAa,
  type RgbTriplet,
  type TextSize,
} from './contrast';
import { deriveColorTokens, deriveTokens, PRIMARY_DEFAULTS } from './theme-derive';
import { type Archetype, ARCHETYPES, getToken } from './token-taxonomy';

/** A curated, pre-validated foreground-on-background pairing. */
export interface Pairing {
  /** Stable identifier. */
  readonly id: string;
  /** Foreground (text) colour token name. */
  readonly foreground: string;
  /** Background colour token name. */
  readonly background: string;
  /** Text size selecting the AA threshold. */
  readonly size: TextSize;
  /** Archetypes this pairing applies to (all three — the tokens are global). */
  readonly archetypes: readonly Archetype[];
  /** The pinned AA target ratio (== `AA_THRESHOLDS[size]`). */
  readonly minRatio: number;
  /** Human-readable role of the pairing. */
  readonly role: string;
}

function pairing(
  id: string,
  foreground: string,
  background: string,
  size: TextSize,
  role: string,
): Pairing {
  return {
    id,
    foreground,
    background,
    size,
    archetypes: ARCHETYPES,
    minRatio: AA_THRESHOLDS[size],
    role,
  };
}

/**
 * The curated pairing matrix — three categories (text-on-background,
 * text-on-surface, accent-on-neutral), each global across the archetypes and
 * pre-validated at its tagged size. `--accent` is the storefront's link/text
 * colour (WU0 §1A), so its pairings place it as the foreground on the neutral
 * canvas + surface.
 */
export const PAIRINGS: readonly Pairing[] = [
  // text-on-background
  pairing('text-on-background', '--text', '--background', 'body', 'body copy on the page canvas'),
  pairing(
    'heading-on-background',
    '--text-heading',
    '--background',
    'large',
    'headings on the page canvas',
  ),
  pairing(
    'muted-on-background',
    '--text-muted',
    '--background',
    'body',
    'captions / meta on the page canvas',
  ),
  // text-on-surface
  pairing('text-on-surface', '--text', '--surface', 'body', 'body copy on raised surfaces'),
  pairing(
    'heading-on-surface',
    '--text-heading',
    '--surface',
    'large',
    'headings on raised surfaces',
  ),
  // text-on-accent (accent as the link/text foreground on neutral backgrounds)
  pairing(
    'accent-on-background',
    '--accent',
    '--background',
    'body',
    'link text on the page canvas',
  ),
  pairing('accent-on-surface', '--accent', '--surface', 'body', 'link text on raised surfaces'),
];

/** Parse a frozen `R G B` triplet string into an sRGB tuple for contrast maths. */
export function parseTriplet(value: string): RgbTriplet {
  const parts = value.split(' ').map(Number);
  if (parts.length !== 3) {
    throw new Error(`expected an "R G B" triplet, got: ${value}`);
  }
  return [parts[0], parts[1], parts[2]];
}

/** Resolve a pairing endpoint token name to its compiled-default sRGB colour. */
export function colorFor(name: string): RgbTriplet {
  const token = getToken(name);
  if (token?.kind !== 'color') {
    throw new Error(`not a known colour token: ${name}`);
  }
  return parseTriplet(token.compiledDefault);
}

/** The computed WCAG contrast ratio of a pairing (from compiled defaults). */
export function pairingRatio(pair: Pairing): number {
  return contrastRatio(colorFor(pair.foreground), colorFor(pair.background));
}

/** Whether a pairing meets its tagged AA threshold. */
export function pairingPassesAa(pair: Pairing): boolean {
  return passesAa(colorFor(pair.foreground), colorFor(pair.background), pair.size);
}

/**
 * An ON-COLOUR pairing: a contrast-DERIVED foreground on a PRIMARY background.
 * `onColor` names a derived token (`theme-derive.DERIVED_COLOR_NAMES`).
 */
export interface OnColorPairing {
  /** Stable identifier. */
  readonly id: string;
  /** The contrast-derived foreground token name (never admin-editable). */
  readonly onColor: string;
  /** The PRIMARY background token the on-colour is derived to contrast. */
  readonly background: string;
}

/**
 * The ON-COLOUR pairings — DELIBERATELY EXCLUDED from the gated `PAIRINGS` above
 * and from the server gate (`theme_contrast.PRIMARY_PAIRINGS`). They are SAFE BY
 * CONSTRUCTION, not gated: each `onColor` is derived (`theme-derive.bestOnColor`)
 * as black-or-white for maximum WCAG contrast against its background, so
 * `max(contrast(black), contrast(white)) >= 4.58:1` for ANY background — an admin
 * has no editable key to force white-on-white. Kept here so the FE ↔ BE parity is
 * explicit and machine-asserted (see `onColorPairingsAlwaysContrast`).
 */
export const ON_COLOR_PAIRINGS: readonly OnColorPairing[] = [
  {
    id: 'text-inverse-on-surface-inverse',
    onColor: '--text-inverse',
    background: '--surface-inverse',
  },
  { id: 'text-onmedia-on-accent', onColor: '--text-onmedia', background: '--accent' },
];

/** The black/white crossover minimum every on-colour clears by construction. */
export const ON_COLOR_MIN_RATIO = 4.58;

/** Resolve a primary token's triplet from `primaries`, else its compiled default. */
function primaryTriplet(
  primaries: Readonly<Record<string, string>>,
  name: string,
): RgbTriplet {
  return parseTriplet(primaries[name] ?? PRIMARY_DEFAULTS[name]);
}

/**
 * Assert every on-colour pairing clears AA body for `primaries` — TRUE by
 * construction for any primary set (default: the compiled defaults). The
 * derived on-colour is recomputed from the primaries, so this holds even when a
 * background primary is set to white (the on-colour flips to black).
 */
export function onColorPairingsAlwaysContrast(
  primaries: Readonly<Record<string, string>> = PRIMARY_DEFAULTS,
): boolean {
  const derived = deriveColorTokens(primaries);
  return ON_COLOR_PAIRINGS.every((pair) => {
    const onColor = parseTriplet(derived[pair.onColor]);
    const background = primaryTriplet(primaries, pair.background);
    return contrastRatio(onColor, background) >= AA_THRESHOLDS.body;
  });
}

/**
 * A row of the RENDER-COMPLETE publish gate: one `(foreground, background)` pair
 * the storefront actually renders TEXT for, tagged with the STRICTEST size it
 * renders at. Endpoints may be PRIMARY or DERIVED (state shade / on-colour); they
 * are resolved against the DERIVED effective token set, so a derived foreground
 * (`--text-strong`) or derived background (`--surface-inverse-hover`) is a
 * first-class endpoint here — unlike `PAIRINGS`, whose endpoints must be taxonomy
 * primaries (`colorFor`).
 */
export interface RenderPairing {
  readonly id: string;
  readonly foreground: string;
  readonly background: string;
  readonly size: TextSize;
}

/**
 * The RENDER-COMPLETE gate — the byte-for-byte mirror of
 * `theme_contrast.py` `RENDER_PAIRINGS`. Every row is grounded in the audited
 * `frontend/src/**` render map (see the Python docstring for representative
 * file:line). This is the browser twin of the server publish gate: if the two
 * lists diverge, the server gates one thing and the browser renders another —
 * exactly the bypass this closes — so `theme-contrast-fixture.json` locks them
 * together and both suites assert against it.
 *
 * `--text-heading` renders at BOTH large (h1/h2) and body (text-sm meta); gated at
 * BODY, the strictest, which subsumes large. `--text-inverse` is gated on its BASE
 * `--surface-inverse` (safe by construction) AND on the derived
 * `--surface-inverse-hover` STATE shade (the closed bypass).
 */
export const RENDER_PAIRINGS: readonly RenderPairing[] = [
  { id: 'text-on-background', foreground: '--text', background: '--background', size: 'body' },
  { id: 'text-on-surface', foreground: '--text', background: '--surface', size: 'body' },
  { id: 'text-on-surface-muted', foreground: '--text', background: '--surface-muted', size: 'body' },
  { id: 'muted-on-background', foreground: '--text-muted', background: '--background', size: 'body' },
  {
    id: 'secondary-on-background',
    foreground: '--text-secondary',
    background: '--background',
    size: 'body',
  },
  { id: 'secondary-on-surface', foreground: '--text-secondary', background: '--surface', size: 'body' },
  {
    id: 'secondary-on-surface-muted',
    foreground: '--text-secondary',
    background: '--surface-muted',
    size: 'body',
  },
  { id: 'strong-on-background', foreground: '--text-strong', background: '--background', size: 'body' },
  { id: 'strong-on-surface', foreground: '--text-strong', background: '--surface', size: 'body' },
  {
    id: 'strong-on-surface-muted',
    foreground: '--text-strong',
    background: '--surface-muted',
    size: 'body',
  },
  { id: 'heading-on-background', foreground: '--text-heading', background: '--background', size: 'body' },
  { id: 'heading-on-surface', foreground: '--text-heading', background: '--surface', size: 'body' },
  { id: 'heading-on-field', foreground: '--text-heading', background: '--field', size: 'body' },
  {
    id: 'heading-on-surface-muted',
    foreground: '--text-heading',
    background: '--surface-muted',
    size: 'body',
  },
  {
    id: 'heading-on-background-subtle',
    foreground: '--text-heading',
    background: '--background-subtle',
    size: 'body',
  },
  { id: 'accent-on-background', foreground: '--accent', background: '--background', size: 'body' },
  { id: 'accent-on-surface', foreground: '--accent', background: '--surface', size: 'body' },
  {
    id: 'accent-strong-on-background',
    foreground: '--accent-strong',
    background: '--background',
    size: 'body',
  },
  {
    id: 'accent-strong-on-accent-subtle',
    foreground: '--accent-strong',
    background: '--accent-subtle',
    size: 'body',
  },
  {
    id: 'text-inverse-on-surface-inverse',
    foreground: '--text-inverse',
    background: '--surface-inverse',
    size: 'body',
  },
  {
    id: 'text-inverse-on-surface-inverse-hover',
    foreground: '--text-inverse',
    background: '--surface-inverse-hover',
    size: 'body',
  },
  { id: 'text-onmedia-on-accent', foreground: '--text-onmedia', background: '--accent', size: 'body' },
];

/** One render pairing that FAILS its AA target under the evaluated tokens. */
export interface ThemeContrastFailure {
  readonly id: string;
  readonly foreground: string;
  readonly background: string;
  readonly size: TextSize;
  /** The measured WCAG ratio (1..21). */
  readonly ratio: number;
  /** The pinned AA target for the pairing's size. */
  readonly target: number;
}

/**
 * The BROWSER twin of the server publish gate (`theme_service._reject_failing_contrast`
 * → `theme_contrast.evaluate_contrast`). Merges the (possibly partial) editable
 * `primaries` OVER the compiled defaults, derives the full effective token set,
 * then returns every `RENDER_PAIRINGS` row that fails its AA target (empty = the
 * theme would publish). Client and server therefore reject byte-for-byte the same
 * themes — no "passes in the editor, 422 on publish" divergence.
 */
export function evaluateThemeContrast(
  primaries: Readonly<Record<string, string>>,
): ThemeContrastFailure[] {
  const effective = deriveTokens({ ...PRIMARY_DEFAULTS, ...primaries });
  const failures: ThemeContrastFailure[] = [];
  for (const pair of RENDER_PAIRINGS) {
    const ratio = contrastRatio(
      parseTriplet(effective[pair.foreground]),
      parseTriplet(effective[pair.background]),
    );
    if (!meetsAa(ratio, pair.size)) {
      failures.push({
        id: pair.id,
        foreground: pair.foreground,
        background: pair.background,
        size: pair.size,
        ratio,
        target: AA_THRESHOLDS[pair.size],
      });
    }
  }
  return failures;
}
