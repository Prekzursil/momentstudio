import { isColorTriplet, resolveToken } from './token-registry';
import {
  ARCHETYPES,
  colorTokens,
  getToken,
  SEED_TOKENS,
  STATE_TOKENS,
  type TaxonomyToken,
} from './token-taxonomy';

const stateByName = new Map(STATE_TOKENS.map((t) => [t.name, t]));
const light = (name: string): string => {
  const token = stateByName.get(name);
  if (!token) throw new Error(`missing state token ${name}`);
  return token.light;
};

describe('SEED_TOKENS', () => {
  it('is non-empty and every name is unique', () => {
    expect(SEED_TOKENS.length).toBeGreaterThan(0);
    const names = SEED_TOKENS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every token resolves in the frozen WU2 registry', () => {
    for (const token of SEED_TOKENS) {
      expect(resolveToken(token.name))
        .withContext(`${token.name} must be a registry member`)
        .toBeTruthy();
    }
  });

  it('every compiled default passes its registry per-type validator', () => {
    for (const token of SEED_TOKENS) {
      const entry = resolveToken(token.name);
      expect(entry).toBeTruthy();
      expect(entry?.validate(token.compiledDefault))
        .withContext(`${token.name} default '${token.compiledDefault}' must validate`)
        .toBe(true);
    }
  });

  it('pins colour + font compiled defaults to the registry baseline fallback', () => {
    for (const token of SEED_TOKENS) {
      if (token.kind === 'color' || token.kind === 'font') {
        expect(resolveToken(token.name)?.fallback)
          .withContext(`${token.name} default must equal the frozen registry fallback`)
          .toBe(token.compiledDefault);
      }
    }
  });

  it('every token is normal-tier with a non-empty compiled default', () => {
    for (const token of SEED_TOKENS) {
      expect(token.tier).toBe('normal');
      expect(token.compiledDefault.length).toBeGreaterThan(0);
      expect(token.role.length).toBeGreaterThan(0);
    }
  });

  it('every token has a complete surface-coverage entry for all three archetypes', () => {
    for (const token of SEED_TOKENS) {
      for (const archetype of ARCHETYPES) {
        expect(token.surfaces[archetype].length)
          .withContext(`${token.name} must repaint surfaces on ${archetype}`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('seeds the exact backend WU1 colour token set (slate-mono + indigo-accent)', () => {
    const expected = [
      '--background',
      '--surface',
      '--surface-inverse',
      '--text',
      '--text-heading',
      '--text-muted',
      '--border',
      '--accent',
      '--overlay',
    ];
    expect(
      colorTokens()
        .map((t) => t.name)
        .sort(),
    ).toEqual([...expected].sort());
  });
});

describe('STATE_TOKENS (P1a WU5 distinct role + state shades)', () => {
  it('every token resolves in the registry with a valid triplet for both light + dark', () => {
    for (const token of STATE_TOKENS) {
      expect(resolveToken(token.name))
        .withContext(`${token.name} must be a registry member`)
        .toBeTruthy();
      expect(isColorTriplet(token.light))
        .withContext(`${token.name} light '${token.light}'`)
        .toBe(true);
      expect(isColorTriplet(token.dark))
        .withContext(`${token.name} dark '${token.dark}'`)
        .toBe(true);
    }
  });

  it('pins each light default to the registry (light) fallback', () => {
    for (const token of STATE_TOKENS) {
      expect(resolveToken(token.name)?.fallback)
        .withContext(`${token.name} light must equal the registry fallback`)
        .toBe(token.light);
    }
  });

  it('covers every seed colour role', () => {
    const names = new Set(STATE_TOKENS.map((t) => t.name));
    for (const token of colorTokens()) {
      expect(names.has(token.name))
        .withContext(`${token.name} must have a light/dark state entry`)
        .toBe(true);
    }
  });

  it('THE REGRESSION GUARD: base canvas, surface and hover-fill are all DISTINCT', () => {
    // hover:bg-slate-50 (--surface-muted) once collapsed onto base bg-white
    // (--background), erasing light-mode hover feedback. These must never be equal.
    expect(light('--background')).not.toBe(light('--surface-muted'));
    expect(light('--background')).not.toBe(light('--surface'));
    expect(light('--surface')).not.toBe(light('--surface-muted'));
    expect(light('--surface')).not.toBe(light('--surface-raised'));
  });

  it('keeps every text emphasis level distinct in light mode', () => {
    const levels = [
      '--text',
      '--text-secondary',
      '--text-muted',
      '--text-strong',
      '--text-heading',
    ];
    const values = levels.map(light);
    expect(new Set(values).size).toBe(levels.length);
  });

  it('reassigns to a DIFFERENT dark value for every token except intentional constants', () => {
    // --overlay (black scrim) and --text-onmedia (text on colored media) stay the same
    // in both modes by design; everything else must actually re-theme under :root.dark.
    const constant = new Set(['--overlay', '--text-onmedia']);
    for (const token of STATE_TOKENS) {
      if (constant.has(token.name)) {
        expect(token.light).toBe(token.dark);
      } else {
        expect(token.light).withContext(`${token.name} must re-theme in dark`).not.toBe(token.dark);
      }
    }
  });
});

describe('ARCHETYPES', () => {
  it('is exactly home / listing / detail', () => {
    expect(ARCHETYPES).toEqual(['home', 'listing', 'detail']);
  });
});

describe('getToken', () => {
  it('returns the entry for a known token name', () => {
    const token = getToken('--accent') as TaxonomyToken;
    expect(token).toBeTruthy();
    expect(token.name).toBe('--accent');
    expect(token.compiledDefault).toBe('79 70 229');
  });

  it('returns undefined for an unknown token name', () => {
    expect(getToken('--not-a-token')).toBeUndefined();
  });
});

describe('colorTokens', () => {
  it('returns only color-kind tokens (excludes fonts + sizes + spacing)', () => {
    const colors = colorTokens();
    expect(colors.length).toBeGreaterThan(0);
    expect(colors.every((t) => t.kind === 'color')).toBe(true);
    expect(colors.length).toBeLessThan(SEED_TOKENS.length);
  });
});
