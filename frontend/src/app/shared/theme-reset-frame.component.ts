import { Component, EventEmitter, Input, Output, ViewEncapsulation, inject } from '@angular/core';
import { NgIf } from '@angular/common';
import type { Observable } from 'rxjs';

/**
 * Reset-to-safe theme-immune frame (P1a WU9 / brief BC-7).
 *
 * An ALWAYS-MOUNTED panic overlay reachable from any rendered-but-broken state.
 * It restores the KNOWN-SAFE target — the seeded compiled-default theme — via
 * `POST /theme/reset-to-default` (WU4b), NOT a rollback to the immediately-prior
 * snapshot (which may itself be broken).
 *
 * Theme-immunity is achieved two ways: (1) `ViewEncapsulation.ShadowDom` renders
 * the control in a shadow root whose selectors an editable theme cannot target;
 * (2) the baked-in stylesheet below sets every inheritable text property with
 * hardcoded literals and consumes NO `var(--token)` — so a maximally-broken
 * theme that poisons inherited `color`/`font` or `--token` custom properties on
 * `:root` cannot make the reset control illegible or unclickable.
 *
 * The actual HttpClient wiring lives in WU10's `admin-theme.service`. This
 * component depends ONLY on the injectable {@link ThemeResetService} seam.
 */
@Component({
  selector: 'app-theme-reset-frame',
  standalone: true,
  encapsulation: ViewEncapsulation.ShadowDom,
  imports: [NgIf],
  template: `
    <div class="ms-reset-frame" role="region" [attr.aria-label]="ariaLabel">
      <p class="ms-reset-heading">{{ heading }}</p>
      <p class="ms-reset-hint">{{ hint }}</p>
      <button
        type="button"
        class="ms-reset-btn"
        [attr.aria-label]="ariaLabel"
        [disabled]="status === 'pending'"
        (click)="reset()"
      >
        {{ buttonLabel }}
      </button>
      <p class="ms-reset-status ms-reset-status--done" role="status" *ngIf="status === 'done'">
        {{ doneLabel }}
      </p>
      <p class="ms-reset-status ms-reset-status--error" role="alert" *ngIf="status === 'error'">
        {{ errorLabel }}
      </p>
    </div>
  `,
  styles: [
    `
      :host {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        display: block;
        pointer-events: auto;
      }
      .ms-reset-frame {
        box-sizing: border-box;
        max-width: 280px;
        padding: 16px;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        background-color: #ffffff;
        color: #0b1220;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
        font-size: 14px;
        line-height: 1.4;
        font-weight: 400;
        letter-spacing: normal;
        text-align: left;
        text-transform: none;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
      }
      .ms-reset-heading {
        margin: 0 0 4px;
        color: #0b1220;
        font-family: inherit;
        font-size: 15px;
        font-weight: 700;
      }
      .ms-reset-hint {
        margin: 0 0 12px;
        color: #475569;
        font-family: inherit;
        font-size: 13px;
      }
      .ms-reset-btn {
        box-sizing: border-box;
        display: inline-block;
        width: 100%;
        margin: 0;
        padding: 10px 14px;
        border: 0;
        border-radius: 8px;
        background-color: #b91c1c;
        color: #ffffff;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.2;
        text-align: center;
        text-transform: none;
        cursor: pointer;
      }
      .ms-reset-btn:hover {
        background-color: #991b1b;
      }
      .ms-reset-btn:focus-visible {
        outline: 3px solid #1d4ed8;
        outline-offset: 2px;
      }
      .ms-reset-btn:disabled {
        background-color: #9ca3af;
        cursor: progress;
      }
      .ms-reset-status {
        margin: 10px 0 0;
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
      }
      .ms-reset-status--done {
        color: #166534;
      }
      .ms-reset-status--error {
        color: #b91c1c;
      }
    `,
  ],
})
export class ThemeResetFrameComponent {
  private readonly resetService = inject(ThemeResetService);

  /** Bold title of the panic frame. */
  @Input() heading = 'Theme looks broken?';
  /** Supporting one-liner explaining what the reset does. */
  @Input() hint = 'Restore the safe default appearance. Your content is unaffected.';
  /** Visible + accessible label of the reset button. */
  @Input() buttonLabel = 'Reset to safe defaults';
  /** Accessible label for the control / region. */
  @Input() ariaLabel = 'Reset the storefront theme to the safe default';
  /** Confirmation copy shown after a successful reset. */
  @Input() doneLabel = 'Theme reset to safe defaults.';
  /** Failure copy shown when the reset request fails. */
  @Input() errorLabel = 'Reset failed. Please try again.';

  /** Current reset lifecycle state. */
  status: 'idle' | 'pending' | 'done' | 'error' = 'idle';

  /** Emits after the seeded compiled-default theme is successfully restored. */
  @Output() done = new EventEmitter<void>();
  /** Emits when the reset request fails. */
  @Output() failed = new EventEmitter<void>();

  /**
   * Restore the seeded compiled-default theme. Fires the reset seam exactly once
   * per invocation; a second call while a reset is already in flight is ignored.
   */
  reset(): void {
    if (this.status === 'pending') return;
    this.status = 'pending';
    this.resetService.resetToDefault().subscribe({
      next: () => {
        this.status = 'done';
        this.done.emit();
      },
      error: () => {
        this.status = 'error';
        this.failed.emit();
      },
    });
  }
}

/**
 * Injectable seam for the panic reset. The real HttpClient-backed implementation
 * ships in WU10 (`admin-theme.service`) and calls `POST /theme/reset-to-default`,
 * which force-publishes the seeded compiled-defaults through the atomic publish
 * path and writes a `reset-to-default` audit entry. This abstract class is both
 * the DI token and the type contract; tests provide a mock.
 */
export abstract class ThemeResetService {
  /**
   * Force-publish the seeded compiled-default theme (the known-safe target),
   * bypassing the staleness guard. Distinct from any historical rollback.
   */
  abstract resetToDefault(): Observable<unknown>;
}
