import { NgClass, NgIf } from '@angular/common';
import { Component, Input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

export type PasswordStrength = 'weak' | 'moderate' | 'strong';

export function computePasswordStrength(password: string): PasswordStrength {
  const value = (password ?? '').trim();
  if (value.length < 6) return 'weak';

  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasDigit = /\d/.test(value);
  const hasSymbol = /[^A-Za-z0-9]/.test(value);

  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (value.length >= 16) score += 1;

  const variety = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
  score += Math.min(variety, 3);

  if (/^(.)\1+$/.test(value)) score = Math.max(0, score - 3);
  if (/^(?:1234|2345|3456|4567|5678|6789|0123)/.test(value)) score = Math.max(0, score - 1);

  if (score >= 5) return 'strong';
  if (score >= 3) return 'moderate';
  return 'weak';
}

@Component({
  selector: 'app-password-strength',
  standalone: true,
  imports: [NgIf, NgClass, TranslateModule],
  template: `
    <div *ngIf="(password || '').trim()" class="grid gap-2">
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'auth.passwordStrength' | translate }}</span>
        <span class="text-xs font-semibold" [ngClass]="labelClass()">{{ labelKey() | translate }}</span>
      </div>
      <input
        type="range"
        min="0"
        max="2"
        [value]="strengthValue()"
        disabled
        class="w-full h-2 rounded-lg accent-slate-400 disabled:opacity-100"
        [ngClass]="rangeClass()"
        [attr.aria-label]="'auth.passwordStrength' | translate"
        [attr.aria-valuetext]="labelKey() | translate"
      />
      <div class="grid grid-cols-3 text-[11px] text-slate-500 dark:text-slate-400">
        <span>{{ 'auth.strengthWeak' | translate }}</span>
        <span class="text-center">{{ 'auth.strengthModerate' | translate }}</span>
        <span class="text-right">{{ 'auth.strengthStrong' | translate }}</span>
      </div>
    </div>
  `
})
export class PasswordStrengthComponent {
  @Input() password = '';

  private strength(): PasswordStrength {
    return computePasswordStrength(this.password);
  }

  strengthValue(): number {
    const level = this.strength();
    if (level === 'strong') return 2;
    if (level === 'moderate') return 1;
    return 0;
  }

  labelKey(): string {
    const level = this.strength();
    if (level === 'strong') return 'auth.strengthStrong';
    if (level === 'moderate') return 'auth.strengthModerate';
    return 'auth.strengthWeak';
  }

  labelClass(): string {
    const level = this.strength();
    if (level === 'strong') return 'text-emerald-600 dark:text-emerald-300';
    if (level === 'moderate') return 'text-amber-700 dark:text-amber-300';
    return 'text-rose-700 dark:text-rose-300';
  }

  rangeClass(): string {
    const level = this.strength();
    if (level === 'strong') return 'accent-emerald-500';
    if (level === 'moderate') return 'accent-amber-500';
    return 'accent-rose-500';
  }
}

