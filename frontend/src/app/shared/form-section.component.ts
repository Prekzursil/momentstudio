import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-form-section',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  template: `
    <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="grid gap-1 min-w-0">
          <p class="text-sm font-semibold uppercase tracking-[0.2em] text-slate-700 dark:text-slate-300">
            {{ title || (titleKey ? (titleKey | translate) : '') }}
          </p>
          <p *ngIf="description || descriptionKey" class="text-xs text-slate-600 dark:text-slate-400">
            {{ description || (descriptionKey ? (descriptionKey | translate) : '') }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <ng-content select="[formSectionActions]"></ng-content>
        </div>
      </div>

      <div class="grid gap-3">
        <ng-content></ng-content>
      </div>
    </section>
  `
})
export class FormSectionComponent {
  @Input() title = '';
  @Input() titleKey = '';
  @Input() description = '';
  @Input() descriptionKey = '';
}

