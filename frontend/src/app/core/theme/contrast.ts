/**
 * WCAG 2.x pairwise contrast maths (WU8-core).
 *
 * PURE by contract: no Angular / DOM / browser dependencies. This module is the
 * single source of truth for the contrast algorithm and is ported faithfully to
 * Python (`backend/app/services/theme_contrast.py`, WU4b) so the client guardrail
 * and the server enforcement boundary compute identical ratios. Keep both sides
 * byte-for-byte equivalent in behaviour when editing.
 *
 * Channels are integers 0-255 (the frozen `R G B` triplet wire format, WU0 §4);
 * values are assumed pre-validated by the token validator (WU2), so this module
 * performs no range/format validation — it is arithmetic only.
 */

/** An sRGB colour as space-separated `R G B` channels, each an integer 0-255. */
export type RgbTriplet = readonly [number, number, number];

/** WCAG AA minimum contrast ratios, selected by text size. */
export const AA_THRESHOLDS = {
  /** Normal body text: 4.5:1. */
  body: 4.5,
  /** Large text (>=18pt, or >=14pt bold): 3:1. */
  large: 3,
} as const;

/** Text-size tag choosing which AA threshold applies. */
export type TextSize = keyof typeof AA_THRESHOLDS;

/**
 * Linearise a single sRGB channel (0-255) to its 0-1 light-intensity value,
 * per the WCAG relative-luminance definition.
 */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG relative luminance of a colour: the perceived light intensity in 0-1
 * (0 = black, 1 = white), green-weighted per the sRGB coefficients.
 */
export function relativeLuminance([r, g, b]: RgbTriplet): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * WCAG contrast ratio between two colours, in the range 1:1 .. 21:1. Symmetric:
 * the result does not depend on which colour is the foreground.
 */
export function contrastRatio(a: RgbTriplet, b: RgbTriplet): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Whether a raw contrast ratio meets the AA threshold for the given text size.
 * The threshold is inclusive (a ratio exactly equal to the target passes).
 */
export function meetsAa(ratio: number, size: TextSize): boolean {
  return ratio >= AA_THRESHOLDS[size];
}

/**
 * Whether a foreground/background pair meets WCAG AA contrast for the given
 * text size. Order-independent (contrast is symmetric).
 */
export function passesAa(foreground: RgbTriplet, background: RgbTriplet, size: TextSize): boolean {
  return meetsAa(contrastRatio(foreground, background), size);
}
