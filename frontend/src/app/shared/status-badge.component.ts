import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

type BadgeTone = 'slate' | 'blue' | 'green' | 'amber' | 'rose';

@Component({
  selector: 'app-status-badge',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  template: `
    <span class="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide uppercase" [ngClass]="classes">
      {{ label || (labelKey ? (labelKey | translate) : (value || '—')) }}
    </span>
  `
})
export class StatusBadgeComponent {
  @Input() value = '';
  @Input() label = '';
  @Input() labelKey = '';

  get classes(): string {
    switch (this.resolveTone()) {
      case 'green':
        return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200';
      case 'blue':
        return 'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-200';
      case 'amber':
        return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200';
      case 'rose':
        return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200';
      default:
        return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200';
    }
  }

  private resolveTone(): BadgeTone {
    const raw = `${this.value}`.toLowerCase();
    if (['paid', 'completed', 'active', 'published', 'verified', 'success'].includes(raw)) return 'green';
    if (['processing', 'accepted', 'shipped', 'pending_acceptance'].includes(raw)) return 'blue';
    if (['pending', 'pending_payment', 'draft', 'warning'].includes(raw)) return 'amber';
    if (['cancelled', 'failed', 'error', 'archived', 'blocked', 'refunded'].includes(raw)) return 'rose';
    return 'slate';
  }
}

