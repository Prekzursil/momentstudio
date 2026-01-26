import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonComponent } from '../../../shared/button.component';
import { ModalComponent } from '../../../shared/modal.component';
import {
  AdminTableColumn,
  AdminTableDensity,
  AdminTableLayoutV1,
  defaultAdminTableLayout,
  sanitizeAdminTableLayout,
} from './admin-table-layout';

export type AdminTableLayoutColumnDef = AdminTableColumn & {
  labelKey: string;
};

@Component({
  selector: 'app-table-layout-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, ModalComponent, ButtonComponent],
  template: `
    <app-modal
      [open]="open"
      [title]="'adminUi.tableLayout.title' | translate"
      [subtitle]="'adminUi.tableLayout.subtitle' | translate"
      [showActions]="false"
      [closeLabel]="'adminUi.actions.cancel' | translate"
      (closed)="closed.emit()"
    >
      <div class="grid gap-4">
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'adminUi.tableLayout.densityLabel' | translate }}</span>
          <select
            class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
            [(ngModel)]="draftDensity"
          >
            <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="comfortable">
              {{ 'adminUi.tableLayout.density.comfortable' | translate }}
            </option>
            <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="compact">
              {{ 'adminUi.tableLayout.density.compact' | translate }}
            </option>
          </select>
        </label>

        <div class="grid gap-2">
          <div class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            {{ 'adminUi.tableLayout.columnsLabel' | translate }}
          </div>
          <div class="grid gap-2">
            <div
              *ngFor="let colId of draftOrder; let i = index"
              class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <label class="flex items-center gap-2 min-w-0">
                <input
                  type="checkbox"
                  class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-900"
                  [checked]="!draftHidden.has(colId)"
                  [disabled]="isRequired(colId)"
                  (change)="toggleColumn(colId)"
                />
                <span class="truncate text-slate-800 dark:text-slate-100">{{ labelKey(colId) | translate }}</span>
                <span *ngIf="isRequired(colId)" class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.tableLayout.required' | translate }}
                </span>
              </label>
              <div class="flex items-center gap-2">
                <app-button size="sm" variant="ghost" [disabled]="i === 0" [label]="'adminUi.actions.up' | translate" (action)="move(i, -1)"></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [disabled]="i === draftOrder.length - 1"
                  [label]="'adminUi.actions.down' | translate"
                  (action)="move(i, 1)"
                ></app-button>
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 pt-1">
          <app-button size="sm" variant="ghost" [label]="'adminUi.tableLayout.reset' | translate" (action)="resetToDefaults()"></app-button>
          <div class="flex items-center gap-2">
            <app-button size="sm" variant="ghost" [label]="'adminUi.actions.cancel' | translate" (action)="closed.emit()"></app-button>
            <app-button size="sm" [label]="'adminUi.actions.save' | translate" (action)="applyDraft()"></app-button>
          </div>
        </div>
      </div>
    </app-modal>
  `,
})
export class TableLayoutModalComponent implements OnChanges {
  @Input() open = false;
  @Input() columns: AdminTableLayoutColumnDef[] = [];
  @Input() layout: AdminTableLayoutV1 | null = null;

  @Output() applied = new EventEmitter<AdminTableLayoutV1>();
  @Output() closed = new EventEmitter<void>();

  draftOrder: string[] = [];
  draftHidden = new Set<string>();
  draftDensity: AdminTableDensity = 'comfortable';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] || changes['columns'] || changes['layout']) {
      if (this.open) this.resetDraft();
    }
  }

  resetToDefaults(): void {
    const next = defaultAdminTableLayout(this.columns);
    this.draftOrder = [...next.order];
    this.draftHidden = new Set<string>();
    this.draftDensity = next.density;
  }

  toggleColumn(id: string): void {
    if (this.isRequired(id)) return;
    if (this.draftHidden.has(id)) this.draftHidden.delete(id);
    else this.draftHidden.add(id);
  }

  move(index: number, delta: number): void {
    const next = [...this.draftOrder];
    const j = index + delta;
    if (j < 0 || j >= next.length) return;
    const tmp = next[index];
    next[index] = next[j];
    next[j] = tmp;
    this.draftOrder = next;
  }

  applyDraft(): void {
    const candidate: AdminTableLayoutV1 = {
      version: 1,
      order: [...this.draftOrder],
      hidden: Array.from(this.draftHidden),
      density: this.draftDensity,
    };
    const sanitized = sanitizeAdminTableLayout(candidate, this.columns);
    this.applied.emit({ ...sanitized, updated_at: new Date().toISOString() });
    this.closed.emit();
  }

  isRequired(id: string): boolean {
    const def = this.columns.find((c) => c.id === id);
    return Boolean(def?.required);
  }

  labelKey(id: string): string {
    const def = this.columns.find((c) => c.id === id);
    return def?.labelKey || id;
  }

  private resetDraft(): void {
    const base = this.layout ? sanitizeAdminTableLayout(this.layout, this.columns) : defaultAdminTableLayout(this.columns);
    this.draftOrder = [...base.order];
    this.draftHidden = new Set<string>(base.hidden || []);
    this.draftDensity = base.density;
  }
}

