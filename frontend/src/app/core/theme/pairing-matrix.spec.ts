import { AA_THRESHOLDS } from './contrast';
import {
  colorFor,
  PAIRINGS,
  pairingPassesAa,
  pairingRatio,
  parseTriplet,
  type Pairing,
} from './pairing-matrix';
import { ARCHETYPES, getToken } from './token-taxonomy';

describe('PAIRINGS', () => {
  it('is non-empty with unique ids', () => {
    expect(PAIRINGS.length).toBeGreaterThan(0);
    const ids = PAIRINGS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('references only known colour tokens for both endpoints', () => {
    for (const pair of PAIRINGS) {
      for (const name of [pair.foreground, pair.background]) {
        const token = getToken(name);
        expect(token).withContext(`${name} must be a taxonomy token`).toBeTruthy();
        expect(token?.kind).withContext(`${name} must be a colour token`).toBe('color');
      }
    }
  });

  it('pins each minRatio to the AA threshold for its tagged size', () => {
    for (const pair of PAIRINGS) {
      expect(pair.minRatio).toBe(AA_THRESHOLDS[pair.size]);
    }
  });

  it('every pairing meets its tagged AA target (pre-validated)', () => {
    for (const pair of PAIRINGS) {
      expect(pairingPassesAa(pair))
        .withContext(`${pair.id} must pass AA at size ${pair.size}`)
        .toBe(true);
    }
  });

  it('every computed ratio is at or above its pinned minimum', () => {
    for (const pair of PAIRINGS) {
      expect(pairingRatio(pair))
        .withContext(`${pair.id} ratio must clear ${pair.minRatio}`)
        .toBeGreaterThanOrEqual(pair.minRatio);
    }
  });

  it('applies globally to all three archetypes', () => {
    for (const pair of PAIRINGS) {
      expect(pair.archetypes).toEqual(ARCHETYPES);
    }
  });

  it('covers the text-on-background / -surface / -accent categories', () => {
    const backgrounds = new Set(PAIRINGS.map((p) => p.background));
    const foregrounds = new Set(PAIRINGS.map((p) => p.foreground));
    expect(backgrounds.has('--background')).toBe(true);
    expect(backgrounds.has('--surface')).toBe(true);
    expect(foregrounds.has('--accent')).toBe(true);
  });

  it('tags both body and large sizes across the matrix', () => {
    const sizes = new Set(PAIRINGS.map((p) => p.size));
    expect(sizes.has('body')).toBe(true);
    expect(sizes.has('large')).toBe(true);
  });
});

describe('parseTriplet', () => {
  it('parses a valid "R G B" triplet into a numeric tuple', () => {
    expect(parseTriplet('79 70 229')).toEqual([79, 70, 229]);
  });

  it('throws on a string without exactly three channels', () => {
    expect(() => parseTriplet('15 23')).toThrowError(/R G B/);
  });
});

describe('colorFor', () => {
  it('resolves a colour token name to its compiled-default sRGB tuple', () => {
    expect(colorFor('--background')).toEqual([255, 255, 255]);
  });

  it('throws for an unknown token name', () => {
    expect(() => colorFor('--nope')).toThrowError(/known colour token/);
  });

  it('throws for a non-colour token (e.g. a font token)', () => {
    expect(() => colorFor('--font-body')).toThrowError(/known colour token/);
  });
});

describe('pairingPassesAa (fail path)', () => {
  it('reports false for a deliberately low-contrast pairing', () => {
    // muted text on the raised surface is ~4.35:1 — below the 4.5 body target,
    // which is exactly why it is EXCLUDED from the curated matrix.
    const bad: Pairing = {
      id: 'muted-on-surface',
      foreground: '--text-muted',
      background: '--surface',
      size: 'body',
      archetypes: ARCHETYPES,
      minRatio: AA_THRESHOLDS.body,
      role: 'excluded — fails body AA',
    };
    expect(pairingPassesAa(bad)).toBe(false);
    expect(pairingRatio(bad)).toBeLessThan(AA_THRESHOLDS.body);
  });
});
