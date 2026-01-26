import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { NgIf } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonComponent } from './button.component';

@Component({
  selector: 'app-error-state',
  standalone: true,
  imports: [NgIf, TranslateModule, ButtonComponent],
  template: `
    <div class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
      <div class="flex items-start justify-between gap-3">
        <div class="grid gap-1 min-w-0">
          <div class="font-semibold text-rose-900 dark:text-rose-100">
            {{ title || ('adminUi.errors.title' | translate) }}
          </div>
          <div class="text-rose-800 dark:text-rose-100">
            {{ message }}
          </div>
        </div>

        <app-button
          *ngIf="showRetry"
          size="sm"
          variant="ghost"
          [label]="'adminUi.actions.retry' | translate"
          (action)="retry.emit()"
        ></app-button>
      </div>

      <div *ngIf="requestId" class="mt-2 flex flex-wrap items-center gap-2 text-xs text-rose-800/90 dark:text-rose-100/80">
        <span class="font-semibold">{{ 'adminUi.errors.requestId' | translate }}:</span>
        <span class="font-mono break-all">{{ requestId }}</span>
        <app-button
          size="sm"
          variant="ghost"
          [label]="'adminUi.actions.copy' | translate"
          (action)="copyRequestId()"
        ></app-button>
        <span *ngIf="copied()" class="text-rose-700 dark:text-rose-200">{{ 'adminUi.errors.copied' | translate }}</span>
      </div>
    </div>
  `
})
export class ErrorStateComponent {
  @Input() title = '';
  @Input() message = '';
  @Input() requestId: string | null = null;
  @Input() showRetry = false;
  @Output() retry = new EventEmitter<void>();

  copied = signal(false);

  async copyRequestId(): Promise<void> {
    const requestId = (this.requestId || '').trim();
    if (!requestId) return;

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(requestId);
      } else {
        this.fallbackCopy(requestId);
      }
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      try {
        this.fallbackCopy(requestId);
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 1500);
      } catch {
        // Ignore clipboard errors.
      }
    }
  }

  private fallbackCopy(value: string): void {
    if (typeof document === 'undefined') throw new Error('No document available');
    const el = document.createElement('textarea');
    el.value = value;
    el.setAttribute('readonly', 'true');
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}
