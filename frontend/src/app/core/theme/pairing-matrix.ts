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

import { AA_THRESHOLDS, contrastRatio, passesAa, type RgbTriplet, type TextSize } from './contrast';
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
