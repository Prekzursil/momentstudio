/**
 * Live pairwise-contrast validator + auto-snap (P1a WU8-ux).
 *
 * The admin-facing guardrail that runs on every normal-tier token edit: given a
 * single changed token (name + proposed `R G B` value), it evaluates EVERY
 * curated pairing the token participates in — as foreground OR background —
 * across the home / listing / detail archetypes (the pairings are global, so one
 * pass covers all three), using each pairing's `size` tag (WU3/N-C4) to pick the
 * 4.5:1-body vs 3:1-large AA threshold from the WU8-core maths. A failing pairing
 * is returned ACTIONABLY (never a bare "blocked"): the failing pair, its measured
 * ratio vs the pinned target, and 2-3 candidate replacement swatches that snap the
 * changed token to a passing value in one click — each candidate carrying its
 * before/after swatch pairs so the admin sees the current failing pair and the
 * fixed pair rendered side by side.
 *
 * This module does NOT reimplement the contrast maths (WU8-core `contrast.ts`)
 * nor the pairing matrix (WU3 `pairing-matrix.ts`); it composes them. Values are
 * the frozen `R G B` triplet wire format (WU0 §4); the token validator (WU2)
 * guarantees well-formed input, so a candidate is derived purely by luminance
 * blending toward black/white — the direction that widens contrast.
 */

import { contrastRatio, meetsAa, type RgbTriplet } from './contrast';
import { colorFor, PAIRINGS, type Pairing, parseTriplet } from './pairing-matrix';

/** A single foreground-on-background sample: the two colours and their ratio. */
export interface Swatch {
  readonly foreground: RgbTriplet;
  readonly background: RgbTriplet;
  /** WCAG contrast ratio of the pair (1..21). */
  readonly ratio: number;
}

/** A pairing evaluated at a concrete set of token values. */
export interface PairingResult {
  /** The curated matrix pairing being evaluated. */
  readonly pairing: Pairing;
  /** The pinned AA target for the pairing's tagged size (== `pairing.minRatio`). */
  readonly target: number;
  /** The pair (fg/bg/ratio) at the evaluated values. */
  readonly swatch: Swatch;
  /** Whether the pair meets its tagged AA target. */
  readonly passes: boolean;
}

/** The before/after view of one pairing under a candidate auto-snap value. */
export interface SnapPair {
  /** The pairing this before/after belongs to. */
  readonly pairingId: string;
  /** The pinned AA target for the pairing. */
  readonly target: number;
  /** The pair as it renders now (the proposed, failing value). */
  readonly before: Swatch;
  /** The pair after applying the candidate value. */
  readonly after: Swatch;
}

/** A one-click auto-snap option for the changed token. */
export interface SnapCandidate {
  /** The token this candidate replaces (the changed token). */
  readonly token: string;
  /** The proposed replacement value, in the frozen `R G B` wire format. */
  readonly value: string;
  /** The minimum ratio across ALL the token's pairings under this candidate. */
  readonly minRatio: number;
  /** Before/after swatches for every pairing the token participates in. */
  readonly pairs: readonly SnapPair[];
}

/** The result of validating a single token change. */
export interface ChangeValidation {
  /** True when no pairing the token participates in fails its AA target. */
  readonly ok: boolean;
  /** The changed token's name. */
  readonly token: string;
  /** The proposed value under evaluation. */
  readonly value: string;
  /** The pairings that FAIL at the proposed value (empty when `ok`). */
  readonly failures: readonly PairingResult[];
  /**
   * Up to three auto-snap candidates that make EVERY participating pairing pass,
   * gentlest change first (empty when `ok`, or when no single value can satisfy
   * every participating pairing at once).
   */
  readonly candidates: readonly SnapCandidate[];
}

/** A map of token name -> current `R G B` value (a draft-in-progress overlay). */
export type TokenValues = Readonly<Record<string, string>>;

/** Blend-toward strengths (ascending), used to derive auto-snap candidates. */
const BLEND_STEPS: readonly number[] = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

/** The two luminance extremes a candidate blends toward to widen contrast. */
const EXTREMES: readonly RgbTriplet[] = [
  [0, 0, 0],
  [255, 255, 255],
];

/** The most auto-snap candidates offered per failing change. */
const MAX_CANDIDATES = 3;

/** The curated pairings a token participates in, as foreground or background. */
export function pairingsForToken(name: string): readonly Pairing[] {
  return PAIRINGS.filter((pair) => pair.foreground === name || pair.background === name);
}

/** Clamp a raw channel value into the sRGB integer range 0-255. */
function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, value));
}

/** Render an sRGB tuple back to the frozen space-separated `R G B` wire format. */
function formatTriplet([r, g, b]: RgbTriplet): string {
  return `${r} ${g} ${b}`;
}

/** Total absolute channel change between two colours (a gentleness proxy). */
function channelDelta(a: RgbTriplet, b: RgbTriplet): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/** Interpolate a colour a fraction `t` (0..1) of the way toward `extreme`. */
function blendToward(color: RgbTriplet, extreme: RgbTriplet, t: number): RgbTriplet {
  return [
    clampChannel(Math.round(color[0] + (extreme[0] - color[0]) * t)),
    clampChannel(Math.round(color[1] + (extreme[1] - color[1]) * t)),
    clampChannel(Math.round(color[2] + (extreme[2] - color[2]) * t)),
  ];
}

/**
 * Resolve a token to its sRGB colour under this evaluation: the changed token
 * takes `changedValue`; any other token is read from the in-progress `current`
 * overlay if present, else from its compiled default (WU3 taxonomy).
 */
function resolverFor(
  name: string,
  changedValue: RgbTriplet,
  current: TokenValues | undefined,
): (token: string) => RgbTriplet {
  return (token: string): RgbTriplet => {
    if (token === name) {
      return changedValue;
    }
    const override = current?.[token];
    return override === undefined ? colorFor(token) : parseTriplet(override);
  };
}

/** Evaluate one pairing against a resolver. */
function evaluatePairing(pairing: Pairing, resolve: (token: string) => RgbTriplet): PairingResult {
  const foreground = resolve(pairing.foreground);
  const background = resolve(pairing.background);
  const ratio = contrastRatio(foreground, background);
  return {
    pairing,
    target: pairing.minRatio,
    swatch: { foreground, background, ratio },
    passes: meetsAa(ratio, pairing.size),
  };
}

/** Whether a candidate value makes every participating pairing pass. */
function candidatePasses(
  candidate: RgbTriplet,
  name: string,
  pairings: readonly Pairing[],
  current: TokenValues | undefined,
): boolean {
  const resolve = resolverFor(name, candidate, current);
  return pairings.every((pair) => evaluatePairing(pair, resolve).passes);
}

/** Deduplicate a list of triplets by their wire-format string, preserving order. */
function distinct(colors: readonly RgbTriplet[]): RgbTriplet[] {
  return [...new Map(colors.map((color) => [formatTriplet(color), color])).values()];
}

/** Build a full auto-snap candidate (value + per-pairing before/after) from a triplet. */
function toCandidate(
  candidate: RgbTriplet,
  name: string,
  proposed: RgbTriplet,
  pairings: readonly Pairing[],
  current: TokenValues | undefined,
): SnapCandidate {
  const beforeResolve = resolverFor(name, proposed, current);
  const afterResolve = resolverFor(name, candidate, current);
  const pairs = pairings.map((pair) => ({
    pairingId: pair.id,
    target: pair.minRatio,
    before: evaluatePairing(pair, beforeResolve).swatch,
    after: evaluatePairing(pair, afterResolve).swatch,
  }));
  const minRatio = Math.min(...pairs.map((pair) => pair.after.ratio));
  return { token: name, value: formatTriplet(candidate), minRatio, pairs };
}

/**
 * Derive the auto-snap candidates for the changed token: blend the proposed
 * value toward both black and white across the step grid, keep the blends that
 * make EVERY participating pairing pass, then offer the three gentlest (closest
 * to the admin's intent). Empty when no single value satisfies all pairings.
 */
function candidatesFor(
  name: string,
  proposed: RgbTriplet,
  pairings: readonly Pairing[],
  current: TokenValues | undefined,
): SnapCandidate[] {
  const passing: RgbTriplet[] = [];
  for (const extreme of EXTREMES) {
    for (const t of BLEND_STEPS) {
      const candidate = blendToward(proposed, extreme, t);
      if (candidatePasses(candidate, name, pairings, current)) {
        passing.push(candidate);
      }
    }
  }
  return distinct(passing)
    .sort((a, b) => channelDelta(a, proposed) - channelDelta(b, proposed))
    .slice(0, MAX_CANDIDATES)
    .map((candidate) => toCandidate(candidate, name, proposed, pairings, current));
}

/**
 * Validate a single token change against the curated pairing matrix.
 *
 * Non-colour tokens (font / size / space) and colour tokens that appear in no
 * pairing participate in no contrast check and return `ok` immediately — their
 * `value` is never parsed, so a font-family string is safe input.
 */
export function validateTokenChange(
  name: string,
  value: string,
  current?: TokenValues,
): ChangeValidation {
  const pairings = pairingsForToken(name);
  if (pairings.length === 0) {
    return { ok: true, token: name, value, failures: [], candidates: [] };
  }

  const proposed = parseTriplet(value);
  const resolve = resolverFor(name, proposed, current);
  const results = pairings.map((pair) => evaluatePairing(pair, resolve));
  const failures = results.filter((result) => !result.passes);

  if (failures.length === 0) {
    return { ok: true, token: name, value, failures: [], candidates: [] };
  }

  const candidates = candidatesFor(name, proposed, pairings, current);
  return { ok: false, token: name, value, failures, candidates };
}
