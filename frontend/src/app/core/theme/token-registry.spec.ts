import {
  isColorLiteral,
  isColorTriplet,
  isFontFamily,
  isNumericLength,
  resolveToken,
} from './token-registry';

describe('isColorTriplet', () => {
  it('accepts three in-range channels', () => {
    expect(isColorTriplet('0 0 0')).toBe(true);
    expect(isColorTriplet('255 255 255')).toBe(true);
    expect(isColorTriplet('15 23 42')).toBe(true);
  });

  it('rejects out-of-range, wrong-count and padded channels', () => {
    expect(isColorTriplet('256 0 0')).toBe(false);
    expect(isColorTriplet('15 23')).toBe(false);
    expect(isColorTriplet('15 23 42 44')).toBe(false);
    expect(isColorTriplet('00 0 0')).toBe(false);
    expect(isColorTriplet('15,23,42')).toBe(false);
  });
});

describe('isColorLiteral', () => {
  it('accepts hex, rgb() and hsl() literals', () => {
    expect(isColorLiteral('#fff')).toBe(true);
    expect(isColorLiteral('#ffff')).toBe(true);
    expect(isColorLiteral('#0f172a')).toBe(true);
    expect(isColorLiteral('#0f172aff')).toBe(true);
    expect(isColorLiteral('rgb(15, 23, 42)')).toBe(true);
    expect(isColorLiteral('rgba(15 23 42 / 8%)')).toBe(true);
    expect(isColorLiteral('hsl(210 40% 20%)')).toBe(true);
    expect(isColorLiteral('hsla(210deg 40% 20% / 50%)')).toBe(true);
  });

  it('rejects non-literals', () => {
    expect(isColorLiteral('#12')).toBe(false);
    expect(isColorLiteral('blue')).toBe(false);
    expect(isColorLiteral('rgb()')).toBe(false);
  });
});

describe('isFontFamily', () => {
  it('accepts curated enum members only', () => {
    expect(isFontFamily('Inter, system-ui, -apple-system, sans-serif')).toBe(true);
    expect(isFontFamily('Cinzel, ui-serif, Georgia, serif')).toBe(true);
    expect(isFontFamily('Comic Sans MS')).toBe(false);
  });
});

describe('isNumericLength', () => {
  it('accepts simple numeric+unit values', () => {
    expect(isNumericLength('16px')).toBe(true);
    expect(isNumericLength('1.5rem')).toBe(true);
    expect(isNumericLength('.5em')).toBe(true);
    expect(isNumericLength('10%')).toBe(true);
  });

  it('accepts a safe clamp expression', () => {
    expect(isNumericLength('clamp(15px, 1.2vw + 12px, 18px)')).toBe(true);
  });

  it('rejects unitless, non-math and unsafe-math values', () => {
    expect(isNumericLength('16')).toBe(false);
    expect(isNumericLength('rotate(1turn)')).toBe(false);
    expect(isNumericLength('calc(16px + red)')).toBe(false);
  });
});

describe('resolveToken', () => {
  it('rejects a name that fails the regex', () => {
    expect(resolveToken('--bad name')).toBeUndefined();
    expect(resolveToken('background')).toBeUndefined();
  });

  it('resolves a base token', () => {
    const entry = resolveToken('--background');
    expect(entry).toBeDefined();
    expect(entry?.validate).toBe(isColorTriplet);
  });

  it('resolves a server-emitted color ramp step', () => {
    const entry = resolveToken('--surface-300');
    expect(entry?.kind).toBe('color-triplet');
    expect(entry?.fallback).toBe('241 245 249');
  });

  it('resolves a spacing ramp step', () => {
    const entry = resolveToken('--space-xl');
    expect(entry?.validate).toBe(isNumericLength);
  });

  it('rejects an unknown name and an out-of-enum ramp shade', () => {
    expect(resolveToken('--unknown-token')).toBeUndefined();
    expect(resolveToken('--text-42')).toBeUndefined();
  });
});
