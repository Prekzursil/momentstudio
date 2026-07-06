import {
  AA_THRESHOLDS,
  contrastRatio,
  meetsAa,
  passesAa,
  relativeLuminance,
  type RgbTriplet,
  type TextSize,
} from './contrast';

const BLACK: RgbTriplet = [0, 0, 0];
const WHITE: RgbTriplet = [255, 255, 255];
// Mid grey #808080 — independently-computed WCAG luminance ~0.2158 and
// contrast-on-white ~3.95:1 (above the 3:1 large threshold, below 4.5:1 body).
const GREY: RgbTriplet = [128, 128, 128];

describe('AA_THRESHOLDS', () => {
  it('pins the WCAG AA ratios (4.5:1 body, 3:1 large)', () => {
    expect(AA_THRESHOLDS.body).toBe(4.5);
    expect(AA_THRESHOLDS.large).toBe(3);
  });
});

describe('relativeLuminance', () => {
  it('is 0 for black (the low sRGB branch)', () => {
    expect(relativeLuminance(BLACK)).toBe(0);
  });

  it('is 1 for white (the high sRGB branch)', () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 10);
  });

  it('matches the independently-computed mid-grey luminance', () => {
    expect(relativeLuminance(GREY)).toBeCloseTo(0.2158, 3);
  });

  it('weights the green channel most heavily (0.7152)', () => {
    const green = relativeLuminance([0, 255, 0]);
    const red = relativeLuminance([255, 0, 0]);
    const blue = relativeLuminance([0, 0, 255]);
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
  });
});

describe('contrastRatio', () => {
  it('is exactly 21:1 for black on white', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 10);
  });

  it('is symmetric regardless of argument order', () => {
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(contrastRatio(BLACK, WHITE), 10);
  });

  it('is 1:1 for identical colours', () => {
    expect(contrastRatio(GREY, GREY)).toBeCloseTo(1, 10);
  });

  it('computes ~3.95:1 for mid-grey on white', () => {
    expect(contrastRatio(GREY, WHITE)).toBeCloseTo(3.95, 1);
  });
});

describe('meetsAa', () => {
  it('accepts a ratio exactly at the body threshold (inclusive)', () => {
    expect(meetsAa(4.5, 'body')).toBe(true);
  });

  it('rejects a ratio just below the body threshold', () => {
    expect(meetsAa(4.4999, 'body')).toBe(false);
  });

  it('accepts a ratio exactly at the large threshold (inclusive)', () => {
    expect(meetsAa(3, 'large')).toBe(true);
  });

  it('rejects a ratio just below the large threshold', () => {
    expect(meetsAa(2.9999, 'large')).toBe(false);
  });
});

describe('passesAa', () => {
  it('passes both sizes for maximum contrast (black on white)', () => {
    expect(passesAa(BLACK, WHITE, 'body')).toBe(true);
    expect(passesAa(BLACK, WHITE, 'large')).toBe(true);
  });

  it('selects the size-specific threshold (grey/white passes large, fails body)', () => {
    expect(passesAa(GREY, WHITE, 'large')).toBe(true);
    expect(passesAa(GREY, WHITE, 'body')).toBe(false);
  });

  it('fails both sizes for a low-contrast pair', () => {
    const faintGrey: RgbTriplet = [200, 200, 200];
    expect(passesAa(faintGrey, WHITE, 'body')).toBe(false);
    expect(passesAa(faintGrey, WHITE, 'large')).toBe(false);
  });

  it('is order-independent for the pair', () => {
    const size: TextSize = 'body';
    expect(passesAa(WHITE, BLACK, size)).toBe(passesAa(BLACK, WHITE, size));
  });
});
