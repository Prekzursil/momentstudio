import { Component, Input, signal } from '@angular/core';
import { NgIf } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonComponent } from './button.component';

type ButtonVariant = 'primary' | 'ghost';
type ButtonSize = 'md' | 'sm';

@Component({
  selector: 'app-copy-button',
  standalone: true,
  imports: [NgIf, TranslateModule, ButtonComponent],
  template: `
    <span class="inline-flex items-center gap-2">
      <app-button
        [size]="size"
        [variant]="variant"
        [label]="labelKey | translate"
        [disabled]="disabled || !(value || '').trim()"
        (action)="copy()"
      ></app-button>
      <span *ngIf="copied()" class="text-xs text-slate-500 dark:text-slate-400">
        {{ copiedKey | translate }}
      </span>
    </span>
  `
})
export class CopyButtonComponent {
  @Input() value = '';
  @Input() disabled = false;
  @Input() size: ButtonSize = 'sm';
  @Input() variant: ButtonVariant = 'ghost';
  @Input() labelKey = 'adminUi.actions.copy';
  @Input() copiedKey = 'adminUi.errors.copied';

  copied = signal(false);

  async copy(): Promise<void> {
    const text = (this.value || '').trim();
    if (!text) return;

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        this.fallbackCopy(text);
      }
      this.flashCopied();
    } catch {
      try {
        this.fallbackCopy(text);
        this.flashCopied();
      } catch {
        // Ignore clipboard errors.
      }
    }
  }

  private flashCopied(): void {
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
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

