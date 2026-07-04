import { resolveToken } from './token-registry';
import {
  ARCHETYPES,
  colorTokens,
  getToken,
  SEED_TOKENS,
  type TaxonomyToken,
} from './token-taxonomy';

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
