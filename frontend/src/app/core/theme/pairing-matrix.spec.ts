import contrastFixture from '../../../../../test-fixtures/theme-contrast-fixture.json';
import { AA_THRESHOLDS, contrastRatio } from './contrast';
import {
  colorFor,
  evaluateThemeContrast,
  ON_COLOR_MIN_RATIO,
  ON_COLOR_PAIRINGS,
  onColorPairingsAlwaysContrast,
  PAIRINGS,
  pairingPassesAa,
  pairingRatio,
  parseTriplet,
  RENDER_PAIRINGS,
  type Pairing,
} from './pairing-matrix';
import { deriveColorTokens, DERIVED_COLOR_NAMES, PRIMARY_DEFAULTS } from './theme-derive';
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

describe('ON_COLOR_PAIRINGS (safe by construction)', () => {
  it('references only DERIVED on-colour tokens as the foreground', () => {
    expect(ON_COLOR_PAIRINGS.length).toBeGreaterThan(0);
    for (const pair of ON_COLOR_PAIRINGS) {
      expect(DERIVED_COLOR_NAMES).toContain(pair.onColor);
    }
  });

  it('is disjoint from the gated PAIRINGS (never double-gated)', () => {
    const gatedFg = new Set(PAIRINGS.map((p) => p.foreground));
    for (const pair of ON_COLOR_PAIRINGS) {
      expect(gatedFg.has(pair.onColor)).toBe(false);
    }
  });

  it('always contrasts at the compiled defaults', () => {
    expect(onColorPairingsAlwaysContrast()).toBe(true);
  });

  it('every on-colour clears the black/white crossover minimum at defaults', () => {
    const derived = deriveColorTokens(PRIMARY_DEFAULTS);
    for (const pair of ON_COLOR_PAIRINGS) {
      const ratio = contrastRatio(
        parseTriplet(derived[pair.onColor]),
        parseTriplet(PRIMARY_DEFAULTS[pair.background]),
      );
      expect(ratio).toBeGreaterThanOrEqual(ON_COLOR_MIN_RATIO);
    }
  });

  it('stays AA even when a background primary is set to white (no white-on-white)', () => {
    // Setting --surface-inverse and --accent to white flips the derived on-colour
    // to black, so the pairing still clears AA — white-on-white is unreachable.
    const white = '255 255 255';
    const primaries = {
      ...PRIMARY_DEFAULTS,
      '--surface-inverse': white,
      '--accent': white,
    };
    expect(onColorPairingsAlwaysContrast(primaries)).toBe(true);
    const derived = deriveColorTokens(primaries);
    expect(derived['--text-inverse']).toBe('0 0 0');
    expect(derived['--text-onmedia']).toBe('0 0 0');
  });

  it('falls back to compiled defaults for absent background primaries', () => {
    // An empty primary map exercises the compiled-default fallback on both the
    // derivation and the background lookup — still AA by construction.
    expect(onColorPairingsAlwaysContrast({})).toBe(true);
  });

  it('holds over many random primary sets (property check)', () => {
    let seed = 20260704;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % 256;
    };
    const triplet = (): string => `${rand()} ${rand()} ${rand()}`;
    for (let i = 0; i < 300; i += 1) {
      const primaries: Record<string, string> = {};
      for (const name of Object.keys(PRIMARY_DEFAULTS)) {
        primaries[name] = triplet();
      }
      expect(onColorPairingsAlwaysContrast(primaries)).toBe(true);
    }
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

describe('RENDER_PAIRINGS (render-complete gate) + evaluateThemeContrast', () => {
  const failingIds = (primaries: Record<string, string>): string[] =>
    evaluateThemeContrast(primaries)
      .map((f) => f.id)
      .sort();

  it('matches the shared TS<->Python parity fixture, in order', () => {
    const got = RENDER_PAIRINGS.map((p) => ({
      id: p.id,
      foreground: p.foreground,
      background: p.background,
      size: p.size as string,
    }));
    expect(got).toEqual(contrastFixture.pairings);
  });

  it('passes on the compiled defaults (empty primaries)', () => {
    expect(evaluateThemeContrast({})).toEqual([]);
  });

  it('reproduces every shared-fixture case (server/browser reject the same themes)', () => {
    for (const testCase of contrastFixture.cases) {
      expect(failingIds(testCase.primaries as Record<string, string>))
        .withContext(testCase.name)
        .toEqual([...testCase.failures]);
    }
  });

  it('rejects a near-crossover grey --surface-inverse (bypass #6, state shade)', () => {
    // BASE white --text-inverse on 117 = 4.61 (passes); the derived hover shade
    // 127 renders it at 4.00 — the render-complete gate catches the state shade.
    const failures = evaluateThemeContrast({ '--surface-inverse': '117 117 117' });
    const hover = failures.find((f) => f.id === 'text-inverse-on-surface-inverse-hover');
    expect(hover).withContext('hover state-shade pair must fail').toBeTruthy();
    expect(hover?.ratio).toBeLessThan(4.5);
    expect(hover?.target).toBe(4.5);
    // The BASE pairing stays safe by construction.
    expect(failures.some((f) => f.id === 'text-inverse-on-surface-inverse')).toBe(false);
  });

  it('rejects a mid-grey --text-heading at BODY size (bypass #7, size tier)', () => {
    // 137 clears large (3.0) but colours text-sm body elements needing 4.5.
    const failures = evaluateThemeContrast({ '--text-heading': '137 137 137' });
    const headingFails = failures.filter((f) => f.id.startsWith('heading-on-'));
    expect(headingFails.length).toBeGreaterThan(0);
    for (const f of headingFails) {
      expect(f.size).toBe('body');
      expect(f.target).toBe(4.5);
      expect(f.ratio).toBeLessThan(4.5);
    }
    expect(failures.some((f) => f.id === 'heading-on-field')).toBe(true);
  });

  it('gates every derived surface the storefront renders text on (bypass #8 backstop)', () => {
    const gatedBackgrounds = new Set(RENDER_PAIRINGS.map((p) => p.background));
    for (const surface of [
      '--surface-muted',
      '--field',
      '--background-subtle',
      '--surface-inverse-hover',
      '--accent-subtle',
    ]) {
      expect(gatedBackgrounds.has(surface)).withContext(surface).toBe(true);
    }
  });
});
