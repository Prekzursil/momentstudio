/**
 * In-editor live theme-preview (P1a WU11).
 *
 * An ALWAYS-PRESENT, READ-ONLY, THEME-ONLY representative render of a storefront
 * surface (home / listing / detail cues) that the theme editor (WU10) drives as
 * the admin edits. On construction it seeds itself from the WU7
 * {@link ThemeTokensService} in-memory hydrated token map — the current
 * server-resolved theme — mirroring those values onto its OWN host element.
 *
 * `applyToken(name, value)` pushes an IN-PROGRESS edit: it routes the value
 * through the SAME strict admin-editable validator the WU7 service uses
 * (`validateAdminEditable`) and then writes the accepted (or compiled-default)
 * value to the SCOPED preview root —
 * this component's host element via `setProperty` — and NEVER to the global
 * `:root`. Scoping is deliberate: the storefront tokens cascade only to the
 * preview's own subtree, so the surrounding admin chrome is never repainted, and
 * the preview stays a self-contained sandbox. There is NO save call, NO service
 * publish, and NO backend round-trip — the preview never mutates the draft doc.
 *
 * Mini-canvas-creep guard (plan §5): this surface is theme-only. It intentionally
 * exposes NO block selection, drag-drop, or inline-edit affordance (any such
 * affordance IS the P3 canvas, out of P1a scope) — enforced by the spec.
 */

import { Component, ElementRef, inject } from '@angular/core';

import { ThemeTokensService } from '../../../core/theme/theme-tokens.service';
import {
  validateAdminEditable,
  type ValidationResult,
} from '../../../core/theme/token-validation';

@Component({
  selector: 'app-theme-live-preview',
  standalone: true,
  host: {
    role: 'group',
    'aria-label': 'Theme live preview',
    class: 'ms-theme-preview',
  },
  template: `
    <div class="ms-theme-preview__chrome">
      <span class="ms-theme-preview__wordmark" data-preview="wordmark">Moment Studio</span>
      <span class="ms-theme-preview__chip">Shop</span>
    </div>

    <h3 class="ms-theme-preview__heading" data-preview="heading">A themed storefront</h3>
    <p class="ms-theme-preview__body" data-preview="body">
      Colours, typography, and spacing update live as you edit — before you save.
    </p>

    <div class="ms-theme-preview__grid">
      <article class="ms-theme-preview__card" data-preview="card">
        <div class="ms-theme-preview__thumb"></div>
        <span class="ms-theme-preview__title">Product one</span>
        <span class="ms-theme-preview__meta">$24.00</span>
        <span class="ms-theme-preview__cta">Add to cart</span>
      </article>
      <article class="ms-theme-preview__card" data-preview="card">
        <div class="ms-theme-preview__thumb"></div>
        <span class="ms-theme-preview__title">Product two</span>
        <span class="ms-theme-preview__meta">$32.00</span>
        <span class="ms-theme-preview__cta">Add to cart</span>
      </article>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        background: rgb(var(--background));
        color: rgb(var(--text));
        font-family: var(--font-body);
        font-size: var(--font-size-base);
        padding: var(--space-lg);
        border: 1px solid rgb(var(--border));
        border-radius: 12px;
      }
      .ms-theme-preview__chrome {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-md);
      }
      .ms-theme-preview__wordmark {
        font-family: var(--font-heading);
        color: rgb(var(--text-heading));
        font-weight: 700;
      }
      .ms-theme-preview__chip {
        background: rgb(var(--surface-inverse));
        color: #fff;
        padding: var(--space-xs) var(--space-sm);
        border-radius: 999px;
        font-size: 0.75em;
      }
      .ms-theme-preview__heading {
        font-family: var(--font-heading);
        color: rgb(var(--text-heading));
        margin: 0 0 var(--space-xs);
      }
      .ms-theme-preview__body {
        color: rgb(var(--text));
        margin: 0 0 var(--space-lg);
      }
      .ms-theme-preview__grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-md);
      }
      .ms-theme-preview__card {
        display: grid;
        gap: var(--space-xs);
        background: rgb(var(--surface));
        border: 1px solid rgb(var(--border));
        border-radius: 10px;
        padding: var(--space-md);
      }
      .ms-theme-preview__thumb {
        height: 3rem;
        border-radius: 8px;
        background: rgb(var(--surface-inverse));
      }
      .ms-theme-preview__title {
        font-family: var(--font-heading);
        color: rgb(var(--text-heading));
      }
      .ms-theme-preview__meta {
        color: rgb(var(--text-muted));
        font-size: 0.85em;
      }
      .ms-theme-preview__cta {
        margin-top: var(--space-xs);
        background: rgb(var(--accent));
        color: #fff;
        text-align: center;
        padding: var(--space-xs) var(--space-sm);
        border-radius: 8px;
        font-size: 0.85em;
      }
    `,
  ],
})
export class ThemeLivePreviewComponent {
  /** The scoped preview root — token writes are confined to this host subtree. */
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  /** WU7 in-memory service — the hydration source (no re-fetch, no backend). */
  private readonly themeTokens = inject(ThemeTokensService);

  constructor() {
    // Seed the scoped root from the current server-resolved tokens so the preview
    // opens on today's live theme, then takes in-progress edits on top.
    const root = this.host.nativeElement;
    for (const [name, value] of this.themeTokens.tokens()()) {
      root.style.setProperty(name, value);
    }
  }

  /**
   * Push an in-progress token edit into the preview. Validates via the strict
   * admin-editable gate (identical semantics to WU7's `applyToken`) then applies
   * the accepted value — or the compiled default for a known editable key with a
   * bad value — to the SCOPED host only. A non-admin-editable / unknown name never
   * touches the DOM. Returns the {@link ValidationResult} so the editor can
   * surface the outcome.
   */
  applyToken(name: string, value: string): ValidationResult {
    const result = validateAdminEditable(name, value);
    if (result.ok || result.value !== '') {
      this.host.nativeElement.style.setProperty(name, result.value);
    }
    return result;
  }
}
