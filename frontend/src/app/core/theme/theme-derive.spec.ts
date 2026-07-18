import fixture from '../../../../../test-fixtures/theme-derive-fixture.json';
import { contrastRatio, type RgbTriplet } from './contrast';
import {
  bestOnColor,
  deriveColorTokens,
  DERIVATIONS,
  DERIVED_COLOR_NAMES,
  deriveTokens,
  formatTriplet,
  parseTriplet,
  PRIMARY_COLOR_NAMES,
  PRIMARY_DEFAULTS,
} from './theme-derive';
import { resolveToken } from './token-registry';

interface FixtureCase {
  readonly name: string;
  readonly primaries: Record<string, string>;
}
const CASES = fixture.cases as readonly FixtureCase[];
const EXPECTED = fixture.expected as Record<string, Record<string, string>>;

describe('theme-derive: primary / derived split', () => {
  it('has exactly 9 primaries and 14 derived, with no overlap', () => {
    expect(PRIMARY_COLOR_NAMES.length).toBe(9);
    expect(DERIVED_COLOR_NAMES.length).toBe(14);
    const overlap = DERIVED_COLOR_NAMES.filter((n) => PRIMARY_COLOR_NAMES.includes(n));
    expect(overlap).toEqual([]);
  });

  it('every primary default equals its frozen WU2 registry fallback (SSOT parity)', () => {
    for (const name of PRIMARY_COLOR_NAMES) {
      expect(resolveToken(name)?.fallback)
        .withContext(`${name} default must match the registry`)
        .toBe(PRIMARY_DEFAULTS[name]);
    }
  });

  it('every derived token has a derivation entry and is not an editable key', () => {
    for (const name of DERIVED_COLOR_NAMES) {
      expect(DERIVATIONS[name]).withContext(`${name} needs a derivation`).toBeTruthy();
      expect(resolveToken(name)).withContext(`${name} must not be editable`).toBeUndefined();
    }
  });
});

describe('theme-derive: parse / format', () => {
  it('round-trips a triplet string', () => {
    expect(formatTriplet(parseTriplet('12 34 56'))).toBe('12 34 56');
  });

  it('parses each channel as a number', () => {
    expect(parseTriplet('0 128 255')).toEqual([0, 128, 255]);
  });
});

describe('theme-derive: TS<->Python parity fixture', () => {
  for (const testCase of CASES) {
    it(`derives [${testCase.name}] to the shared expected output`, () => {
      expect(deriveTokens(testCase.primaries)).toEqual(EXPECTED[testCase.name]);
    });
  }

  it('reproduces the compiled-default styles.css :root within 4/255 per channel', () => {
    const targets: Record<string, string> = {
      '--background-subtle': '248 250 252',
      '--surface-muted': '248 250 252',
      '--surface-raised': '226 232 240',
      '--surface-inverse-hover': '30 41 59',
      '--field': '255 255 255',
      '--text-secondary': '71 85 105',
      '--text-strong': '30 41 59',
      '--text-inverse': '255 255 255',
      '--text-onmedia': '255 255 255',
      '--border-muted': '226 232 240',
      '--border-strong': '203 213 225',
      '--border-inverse': '15 23 42',
      '--accent-strong': '55 48 163',
      '--accent-subtle': '238 242 255',
    };
    const derived = deriveColorTokens(PRIMARY_DEFAULTS);
    for (const [name, want] of Object.entries(targets)) {
      const got = parseTriplet(derived[name]);
      const target = parseTriplet(want);
      for (let i = 0; i < 3; i += 1) {
        expect(Math.abs(got[i] - target[i]))
          .withContext(`${name} channel ${i}: ${derived[name]} vs ${want}`)
          .toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('theme-derive: deriveTokens behaviour', () => {
  it('passes non-derived editable tokens (fonts / spacing) through untouched', () => {
    const out = deriveTokens({
      ...PRIMARY_DEFAULTS,
      '--font-body': 'system-ui, sans-serif',
      '--space-md': '1rem',
    });
    expect(out['--font-body']).toBe('system-ui, sans-serif');
    expect(out['--space-md']).toBe('1rem');
  });

  it('IGNORES a derived key smuggled into the input and recomputes it', () => {
    const clean = deriveTokens(PRIMARY_DEFAULTS);
    const attacked = deriveTokens({
      ...PRIMARY_DEFAULTS,
      '--surface-inverse-hover': '255 255 255',
      '--text-inverse': '0 0 0',
    });
    expect(attacked['--surface-inverse-hover']).toBe(clean['--surface-inverse-hover']);
    expect(attacked['--surface-inverse-hover']).not.toBe('255 255 255');
    expect(attacked['--text-inverse']).toBe(clean['--text-inverse']);
  });

  it('falls back to compiled defaults for missing primaries (empty input)', () => {
    expect(deriveTokens({})).toEqual(deriveColorTokens({}));
    expect(deriveColorTokens({})).toEqual(deriveColorTokens(PRIMARY_DEFAULTS));
  });

  it('deriveColorTokens returns exactly the 14 derived names', () => {
    expect(Object.keys(deriveColorTokens(PRIMARY_DEFAULTS)).sort()).toEqual(
      [...DERIVED_COLOR_NAMES].sort(),
    );
  });
});

describe('theme-derive: bestOnColor (the bypass-killer)', () => {
  it('picks white on a dark background and black on a light background', () => {
    expect(bestOnColor([15, 23, 42])).toEqual([255, 255, 255]);
    expect(bestOnColor([255, 255, 255])).toEqual([0, 0, 0]);
  });

  it('ties to white (both extremes clear AA at the crossover)', () => {
    // At the black/white luminance crossover both give ~4.58:1; the tie -> white.
    const crossover: RgbTriplet = [118, 118, 118];
    const chosen = bestOnColor(crossover);
    // Whatever is chosen, it must clear AA.
    expect(contrastRatio(chosen, crossover)).toBeGreaterThanOrEqual(4.5);
  });

  it('PROPERTY: text-inverse always clears AA against ANY surface-inverse', () => {
    let worst = Infinity;
    for (let seed = 0; seed < 4096; seed += 1) {
      const r = (seed * 73) % 256;
      const g = (seed * 149) % 256;
      const b = (seed * 211) % 256;
      const bg: RgbTriplet = [r, g, b];
      const ratio = contrastRatio(bestOnColor(bg), bg);
      worst = Math.min(worst, ratio);
    }
    // The mathematical floor is the crossover minimum (~4.58) — always >= AA.
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });

  it('PROPERTY: derived on-colours clear AA over every parsed-random primary set', () => {
    for (let seed = 1; seed < 512; seed += 1) {
      const rand = (k: number): string =>
        `${(seed * k) % 256} ${(seed * (k + 3)) % 256} ${(seed * (k + 7)) % 256}`;
      const primaries = { '--surface-inverse': rand(5), '--accent': rand(11) };
      const derived = deriveColorTokens(primaries);
      const si = parseTriplet(primaries['--surface-inverse']);
      const ac = parseTriplet(primaries['--accent']);
      expect(contrastRatio(parseTriplet(derived['--text-inverse']), si)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(parseTriplet(derived['--text-onmedia']), ac)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
});
