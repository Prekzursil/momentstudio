/**
 * Client theme-application service (P1a WU7).
 *
 * The runtime counterpart of the WU6 SSR head sink. On construction it HYDRATES
 * from the server-injected `:root` tokens — the `<style id="ms-theme">` block
 * that `server.ts` injects into `<head>` at request time — by reading their
 * computed values off `document.documentElement`. There is NO client re-fetch:
 * the server is the single source of truth and its already-rendered `:root` is
 * the hydration source, so SSR and client agree with no FOUC.
 *
 * `applyToken(name, value)` routes EVERY change through the WU2 validator
 * (`validateToken`) BEFORE it reaches `element.style.setProperty`, so a tainted
 * or corpus-invalid value can never be written to the DOM: a valid value is
 * applied verbatim, a known key with a bad value falls back to its compiled
 * default, and an unknown/non-registry name is dropped without touching the DOM.
 *
 * Colours/typography/spacing live here; the light/dark class toggle stays in
 * `theme.service.ts`. SSR-safe throughout: every DOM access is guarded by
 * `typeof document !== 'undefined'`, mirroring `theme.service.ts`.
 */

import { Injectable, Signal, signal } from '@angular/core';
import { SEED_TOKENS } from './token-taxonomy';
import { validateToken, type ValidationResult } from './token-validation';

@Injectable({ providedIn: 'root' })
export class ThemeTokensService {
  /** The resolved `name -> value` token map, updated immutably on every apply. */
  private readonly tokensSignal = signal<ReadonlyMap<string, string>>(new Map());

  constructor() {
    this.hydrateFromRoot();
  }

  /** Read-only signal of the current resolved token map (for preview/editor). */
  tokens(): Signal<ReadonlyMap<string, string>> {
    return this.tokensSignal.asReadonly();
  }

  /** The current value of a token, or `undefined` if not hydrated/known. */
  getToken(name: string): string | undefined {
    return this.tokensSignal().get(name);
  }

  /**
   * Validate `value` for `name` through the WU2 sink, then apply the result to
   * `:root`. On success the accepted value is written; on a known key with an
   * invalid value the compiled default is written instead; an unknown name never
   * touches the DOM. The tainted input value is NEVER passed to `setProperty`.
   * Returns the {@link ValidationResult} so callers can surface the outcome.
   */
  applyToken(name: string, value: string): ValidationResult {
    const result = validateToken(name, value);
    if (result.ok || result.value !== '') {
      this.commit(name, result.value);
    }
    return result;
  }

  /** Record a resolved value in the map (immutably) and write it to `:root`. */
  private commit(name: string, value: string): void {
    const next = new Map(this.tokensSignal());
    next.set(name, value);
    this.tokensSignal.set(next);
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty(name, value);
    }
  }

  /**
   * Seed the token map from the server-injected `:root` custom properties. Reads
   * the computed value of each seed-token name (exactly the set WU6 emits) and
   * records the non-empty ones — no network call. SSR-safe: under server render
   * (`document` undefined) it is a no-op and the map stays empty.
   */
  private hydrateFromRoot(): void {
    if (typeof document === 'undefined') return;
    const computed = getComputedStyle(document.documentElement);
    const next = new Map<string, string>();
    for (const token of SEED_TOKENS) {
      const value = computed.getPropertyValue(token.name).trim();
      if (value !== '') {
        next.set(token.name, value);
      }
    }
    this.tokensSignal.set(next);
  }
}
