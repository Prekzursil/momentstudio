/**
 * Theme token validation entry point (P1a WU2).
 *
 * `validateToken(name, value)` is the SOLE client-side guard (Angular does not
 * sanitize `--*` custom-property bindings) and the shape the SSR sink
 * re-validates against on save. It composes the closed name registry, the
 * per-type value validators (both from `token-registry`) and the CSS-safe
 * encoder (`css-safe-encode`):
 *
 *   resolve name -> decode-first CSS-safe encode -> per-type validate -> emit
 *
 * Any failure degrades to a compiled default and never emits the input value.
 *
 * Mirrors `backend/app/services/theme_validation.py`.
 */

import { encodeCssSafe } from './css-safe-encode';
import { resolveToken } from './token-registry';

/** Outcome of validating a token: accepted value, or a compiled default. */
export interface ValidationResult {
  readonly ok: boolean;
  readonly value: string;
}

/**
 * Validate a single token. Returns the accepted (CSS-safe) value on success, or
 * a compiled default on failure — a per-token fallback for a known key with a
 * bad value, or an empty string for an unknown/invalid name (never emitted).
 */
export function validateToken(name: string, value: string): ValidationResult {
  const entry = resolveToken(name);
  if (!entry) {
    return { ok: false, value: '' };
  }
  const encoded = encodeCssSafe(value, { allowUrl: entry.allowUrl });
  if (!encoded.ok) {
    return { ok: false, value: entry.fallback };
  }
  if (!entry.validate(encoded.value)) {
    return { ok: false, value: entry.fallback };
  }
  return { ok: true, value: encoded.value };
}
