import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

type UiLang = 'en' | 'ro';
type LocalizedText = { en: string; ro: string };

@Component({
  selector: 'app-localized-text-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  template: `
    <div class="grid gap-1">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span *ngIf="label" class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ label }}</span>
        <div *ngIf="showCopy" class="flex items-center gap-3">
          <button
            type="button"
            class="text-xs font-semibold text-indigo-700 hover:underline dark:text-indigo-300"
            (click)="copy('ro', 'en')"
          >
            {{ 'adminUi.content.translation.copyRoToEn' | translate }}
          </button>
          <button
            type="button"
            class="text-xs font-semibold text-indigo-700 hover:underline dark:text-indigo-300"
            (click)="copy('en', 'ro')"
          >
            {{ 'adminUi.content.translation.copyEnToRo' | translate }}
          </button>
        </div>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <label class="grid gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
          RO
          <ng-container [ngSwitch]="multiline">
            <textarea
              *ngSwitchCase="true"
              class="min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [attr.rows]="rows"
              [placeholder]="placeholderRo"
              [disabled]="disabled"
              [(ngModel)]="value.ro"
            ></textarea>
            <input
              *ngSwitchDefault
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [placeholder]="placeholderRo"
              [disabled]="disabled"
              [(ngModel)]="value.ro"
            />
          </ng-container>
        </label>

        <label class="grid gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
          EN
          <ng-container [ngSwitch]="multiline">
            <textarea
              *ngSwitchCase="true"
              class="min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [attr.rows]="rows"
              [placeholder]="placeholderEn"
              [disabled]="disabled"
              [(ngModel)]="value.en"
            ></textarea>
            <input
              *ngSwitchDefault
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [placeholder]="placeholderEn"
              [disabled]="disabled"
              [(ngModel)]="value.en"
            />
          </ng-container>
        </label>
      </div>

      <span *ngIf="hint" class="text-xs text-slate-500 dark:text-slate-400">{{ hint }}</span>
    </div>
  `
})
export class LocalizedTextEditorComponent {
  @Input() label = '';
  @Input() hint = '';
  @Input() value: LocalizedText = { en: '', ro: '' };
  @Input() multiline = false;
  @Input() rows = 3;
  @Input() placeholderEn = '';
  @Input() placeholderRo = '';
  @Input() disabled = false;
  @Input() showCopy = true;

  copy(from: UiLang, to: UiLang): void {
    this.value[to] = this.value[from] || '';
  }
}

