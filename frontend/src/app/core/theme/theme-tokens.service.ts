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
 * `applyToken(name, value)` routes EVERY change through the STRICT admin-editable
 * validator (`validateAdminEditable`) BEFORE it reaches `element.style.setProperty`,
 * so a tainted, corpus-invalid, or non-admin-settable value (a derived shade, a
 * numeric ramp step, a wider `--space-*` step) can never be written to the DOM: a
 * valid editable value is applied verbatim, a known editable key with a bad value
 * falls back to its compiled default, and any non-admin-editable / unknown name is
 * dropped without touching the DOM.
 *
 * Colours/typography/spacing live here; the light/dark class toggle stays in
 * `theme.service.ts`. SSR-safe throughout: every DOM access is guarded by
 * `typeof document !== 'undefined'`, mirroring `theme.service.ts`.
 */

import { Injectable, Signal, signal } from '@angular/core';
import { deriveColorTokens, PRIMARY_COLOR_NAMES } from './theme-derive';
import { SEED_TOKENS } from './token-taxonomy';
import { validateAdminEditable, type ValidationResult } from './token-validation';

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
   * Validate `value` for `name` through the STRICT admin-editable gate, then apply
   * the result to `:root`. On success the accepted value is written; on a known
   * editable key with an invalid value the compiled default is written instead; a
   * non-admin-editable / unknown name never touches the DOM. The tainted input
   * value is NEVER passed to `setProperty`. Returns the {@link ValidationResult}
   * so callers can surface the outcome.
   */
  applyToken(name: string, value: string): ValidationResult {
    const result = validateAdminEditable(name, value);
    const committed = result.ok || result.value !== '';
    if (committed) {
      this.commit(name, result.value);
    }
    if (committed && PRIMARY_COLOR_NAMES.includes(name)) {
      this.applyDerived();
    }
    return result;
  }

  /**
   * Recompute the fourteen derived shade / state tokens from the CURRENT primary
   * values and apply them to `:root`, so the live preview repaints every derived
   * surface (and every on-colour re-contrasts) the instant a primary changes.
   * Derived tokens are never accepted from input — always computed here.
   */
  private applyDerived(): void {
    const current = this.tokensSignal();
    const primaries: Record<string, string> = {};
    for (const name of PRIMARY_COLOR_NAMES) {
      const value = current.get(name);
      if (value !== undefined) primaries[name] = value;
    }
    const derived = deriveColorTokens(primaries);
    const next = new Map(current);
    for (const [name, value] of Object.entries(derived)) {
      next.set(name, value);
      if (typeof document !== 'undefined') document.documentElement.style.setProperty(name, value);
    }
    this.tokensSignal.set(next);
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
