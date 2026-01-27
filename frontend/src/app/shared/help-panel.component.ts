import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-help-panel',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  template: `
    <details
      class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-200"
      [open]="open"
    >
      <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
        {{ titleKey | translate }}
      </summary>

      <div class="mt-2 grid gap-2">
        <p *ngIf="subtitleKey" class="text-xs text-slate-600 dark:text-slate-300">
          {{ subtitleKey | translate }}
        </p>
        <ng-content></ng-content>
      </div>
    </details>
  `
})
export class HelpPanelComponent {
  @Input() titleKey = 'adminUi.help.title';
  @Input() subtitleKey = '';
  @Input() open = false;
}

