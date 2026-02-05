import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';

type BulkPricePreview = { old_min: string; old_max: string; new_min: string; new_max: string; currency: string };

@Component({
  selector: 'app-admin-products-bulk-actions',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, ButtonComponent, InputComponent],
  template: `
    <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 grid gap-3 dark:border-slate-800 dark:bg-slate-950/20">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
          {{ 'adminUi.products.bulk.selected' | translate: { count: selectedCount } }}
        </p>
        <app-button
          size="sm"
          variant="ghost"
          [label]="'adminUi.products.bulk.clearSelection' | translate"
          (action)="clearSelection.emit()"
          [disabled]="disabled"
        ></app-button>
      </div>

      <div class="grid gap-3 lg:grid-cols-[200px_240px_auto_auto] items-end">
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'adminUi.products.sale.type' | translate }}
          <select
            class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            [ngModel]="bulkSaleType"
            (ngModelChange)="bulkSaleTypeChange.emit($event)"
            [disabled]="disabled"
          >
            <option [ngValue]="'percent'">{{ 'adminUi.products.sale.typePercent' | translate }}</option>
            <option [ngValue]="'amount'">{{ 'adminUi.products.sale.typeAmount' | translate }}</option>
          </select>
        </label>

        <app-input
          [label]="'adminUi.products.bulk.saleValue' | translate"
          [placeholder]="bulkSaleType === 'percent' ? '10' : '5.00'"
          type="text"
          inputMode="decimal"
          [value]="bulkSaleValue"
          (valueChange)="bulkSaleValueChange.emit($event)"
          [disabled]="disabled"
        ></app-input>

        <app-button
          size="sm"
          [label]="'adminUi.products.bulk.applySale' | translate"
          (action)="applySale.emit()"
          [disabled]="disabled"
        ></app-button>

        <div class="flex flex-wrap gap-2 justify-end">
          <app-button
            size="sm"
            variant="ghost"
            [label]="'adminUi.products.bulk.clearSale' | translate"
            (action)="clearSale.emit()"
            [disabled]="disabled"
          ></app-button>
        </div>
      </div>

      <div class="grid gap-3 lg:grid-cols-[240px_auto] items-end">
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'adminUi.products.table.status' | translate }}
          <select
            class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            [ngModel]="bulkStatusTarget"
            (ngModelChange)="bulkStatusTargetChange.emit($event)"
            [disabled]="disabled"
          >
            <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
            <option value="published">{{ 'adminUi.status.published' | translate }}</option>
            <option value="archived">{{ 'adminUi.status.archived' | translate }}</option>
          </select>
        </label>

        <div class="flex flex-wrap items-center justify-end gap-2">
          <app-button
            size="sm"
            [label]="'adminUi.products.bulk.status.apply' | translate"
            (action)="applyStatus.emit()"
            [disabled]="disabled"
          ></app-button>
        </div>
      </div>

      <div class="h-px bg-slate-200 dark:bg-slate-800/70"></div>

      <div class="grid gap-3 lg:grid-cols-[260px_auto] items-end">
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'adminUi.products.bulk.category.label' | translate }}
          <select
            class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            [ngModel]="bulkCategoryId"
            (ngModelChange)="bulkCategoryIdChange.emit($event)"
            [disabled]="disabled"
          >
            <option value="">{{ 'adminUi.products.bulk.category.placeholder' | translate }}</option>
            <option *ngFor="let cat of categories" [value]="cat.id">{{ cat.name }}</option>
          </select>
        </label>

        <div class="flex flex-wrap items-center justify-end gap-2">
          <app-button
            size="sm"
            [label]="'adminUi.products.bulk.category.apply' | translate"
            (action)="applyCategory.emit()"
            [disabled]="disabled"
          ></app-button>
          <app-button
            size="sm"
            variant="ghost"
            [label]="'adminUi.products.bulk.category.addAndApply' | translate"
            (action)="addAndApplyCategory.emit()"
            [disabled]="disabled"
          ></app-button>
        </div>
      </div>

      <div class="h-px bg-slate-200 dark:bg-slate-800/70"></div>

      <div class="grid gap-3 lg:grid-cols-[240px_240px_auto] items-end">
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'adminUi.products.bulk.schedule.publishAt' | translate }}
          <input
            class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            type="datetime-local"
            [ngModel]="bulkPublishScheduledFor"
            (ngModelChange)="bulkPublishScheduledForChange.emit($event)"
            [disabled]="disabled"
          />
        </label>

        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'adminUi.products.bulk.schedule.unpublishAt' | translate }}
          <input
            class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            type="datetime-local"
            [ngModel]="bulkUnpublishScheduledFor"
            (ngModelChange)="bulkUnpublishScheduledForChange.emit($event)"
            [disabled]="disabled"
          />
        </label>

        <app-button
          size="sm"
          [label]="'adminUi.products.bulk.schedule.apply' | translate"
          (action)="applySchedule.emit()"
          [disabled]="disabled"
        ></app-button>
      </div>

      <div class="flex flex-wrap items-center justify-end gap-2">
        <app-button
          size="sm"
          variant="ghost"
          [label]="'adminUi.products.bulk.schedule.clearPublish' | translate"
          (action)="clearPublishSchedule.emit()"
          [disabled]="disabled"
        ></app-button>
        <app-button
          size="sm"
          variant="ghost"
          [label]="'adminUi.products.bulk.schedule.clearUnpublish' | translate"
          (action)="clearUnpublishSchedule.emit()"
          [disabled]="disabled"
        ></app-button>
      </div>

      <div class="h-px bg-slate-200 dark:bg-slate-800/70"></div>

      <div class="grid gap-3 lg:grid-cols-[200px_200px_240px_auto] items-end">
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'adminUi.products.bulk.priceAdjust.mode' | translate }}
          <select
            class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            [ngModel]="bulkPriceMode"
            (ngModelChange)="bulkPriceModeChange.emit($event)"
            [disabled]="disabled"
          >
            <option [ngValue]="'percent'">{{ 'adminUi.products.bulk.priceAdjust.modePercent' | translate }}</option>
            <option [ngValue]="'amount'">{{ 'adminUi.products.bulk.priceAdjust.modeAmount' | translate }}</option>
          </select>
        </label>

        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'adminUi.products.bulk.priceAdjust.direction' | translate }}
          <select
            class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            [ngModel]="bulkPriceDirection"
            (ngModelChange)="bulkPriceDirectionChange.emit($event)"
            [disabled]="disabled"
          >
            <option [ngValue]="'increase'">
              {{ 'adminUi.products.bulk.priceAdjust.directionIncrease' | translate }}
            </option>
            <option [ngValue]="'decrease'">
              {{ 'adminUi.products.bulk.priceAdjust.directionDecrease' | translate }}
            </option>
          </select>
        </label>

        <app-input
          [label]="'adminUi.products.bulk.priceAdjust.value' | translate"
          [placeholder]="bulkPriceMode === 'percent' ? '10' : '5.00'"
          type="text"
          inputMode="decimal"
          [value]="bulkPriceValue"
          (valueChange)="bulkPriceValueChange.emit($event)"
          [disabled]="disabled"
        ></app-input>

        <app-button
          size="sm"
          [label]="'adminUi.products.bulk.priceAdjust.apply' | translate"
          (action)="applyPriceAdjustment.emit()"
          [disabled]="disabled"
        ></app-button>
      </div>

      <p *ngIf="bulkPricePreview" class="text-xs text-slate-600 dark:text-slate-300">
        {{ 'adminUi.products.bulk.priceAdjust.preview' | translate: bulkPricePreview }}
      </p>

      <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.products.bulk.note' | translate }}</p>

      <div
        *ngIf="bulkError"
        class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-2 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
      >
        {{ bulkError }}
      </div>
    </div>
  `
})
export class AdminProductsBulkActionsComponent {
  @Input({ required: true }) selectedCount = 0;
  @Input() disabled = false;
  @Input() categories: Array<{ id: string; name: string }> = [];

  @Input() bulkSaleType: 'percent' | 'amount' = 'percent';
  @Output() bulkSaleTypeChange = new EventEmitter<'percent' | 'amount'>();
  @Input() bulkSaleValue = '';
  @Output() bulkSaleValueChange = new EventEmitter<string | number>();

  @Input() bulkStatusTarget: 'draft' | 'published' | 'archived' = 'published';
  @Output() bulkStatusTargetChange = new EventEmitter<'draft' | 'published' | 'archived'>();

  @Input() bulkCategoryId = '';
  @Output() bulkCategoryIdChange = new EventEmitter<string>();

  @Input() bulkPublishScheduledFor = '';
  @Output() bulkPublishScheduledForChange = new EventEmitter<string>();
  @Input() bulkUnpublishScheduledFor = '';
  @Output() bulkUnpublishScheduledForChange = new EventEmitter<string>();

  @Input() bulkPriceMode: 'percent' | 'amount' = 'percent';
  @Output() bulkPriceModeChange = new EventEmitter<'percent' | 'amount'>();
  @Input() bulkPriceDirection: 'increase' | 'decrease' = 'increase';
  @Output() bulkPriceDirectionChange = new EventEmitter<'increase' | 'decrease'>();
  @Input() bulkPriceValue = '';
  @Output() bulkPriceValueChange = new EventEmitter<string | number>();
  @Input() bulkPricePreview: BulkPricePreview | null = null;

  @Input() bulkError: string | null = null;

  @Output() clearSelection = new EventEmitter<void>();
  @Output() applySale = new EventEmitter<void>();
  @Output() clearSale = new EventEmitter<void>();
  @Output() applyStatus = new EventEmitter<void>();
  @Output() applyCategory = new EventEmitter<void>();
  @Output() addAndApplyCategory = new EventEmitter<void>();
  @Output() applySchedule = new EventEmitter<void>();
  @Output() clearPublishSchedule = new EventEmitter<void>();
  @Output() clearUnpublishSchedule = new EventEmitter<void>();
  @Output() applyPriceAdjustment = new EventEmitter<void>();
}

