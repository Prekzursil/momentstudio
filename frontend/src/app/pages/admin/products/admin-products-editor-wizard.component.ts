import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonComponent } from '../../../shared/button.component';

type ProductWizardStep = { labelKey: string };

@Component({
  selector: 'app-admin-products-editor-wizard',
  standalone: true,
  imports: [CommonModule, TranslateModule, ButtonComponent],
  template: `
    <div
      class="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="grid gap-1">
          <p class="font-semibold">{{ titleKey | translate }}</p>
          <p class="text-xs text-indigo-800 dark:text-indigo-200">{{ descriptionKey | translate }}</p>
        </div>
        <app-button size="sm" variant="ghost" [label]="'adminUi.actions.exit' | translate" (action)="exit.emit()"></app-button>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button
          *ngFor="let step of steps; let idx = index"
          type="button"
          class="rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-semibold text-indigo-900 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/10 dark:text-indigo-100 dark:hover:bg-indigo-900/30"
          [class.bg-indigo-600]="idx === stepIndex"
          [class.text-white]="idx === stepIndex"
          [class.border-indigo-600]="idx === stepIndex"
          [class.hover:bg-indigo-700]="idx === stepIndex"
          [class.dark:bg-indigo-500/30]="idx === stepIndex"
          [class.dark:hover:bg-indigo-500/40]="idx === stepIndex"
          (click)="stepSelected.emit(idx)"
        >
          {{ step.labelKey | translate }}
        </button>
      </div>

      <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
        <app-button
          size="sm"
          variant="ghost"
          [label]="'adminUi.actions.back' | translate"
          (action)="prev.emit()"
          [disabled]="stepIndex === 0"
        ></app-button>

        <div class="flex flex-wrap items-center gap-2">
          <app-button
            *ngIf="currentStepId === 'save'"
            size="sm"
            [label]="'adminUi.products.form.save' | translate"
            (action)="save.emit()"
          ></app-button>
          <app-button
            *ngIf="currentStepId === 'publish'"
            size="sm"
            [label]="'adminUi.products.wizard.publishNow' | translate"
            (action)="publishNow.emit()"
            [disabled]="!hasEditingSlug"
          ></app-button>
          <app-button
            size="sm"
            [label]="nextLabelKey | translate"
            (action)="next.emit()"
            [disabled]="!canNext"
          ></app-button>
        </div>
      </div>
    </div>
  `
})
export class AdminProductsEditorWizardComponent {
  @Input({ required: true }) titleKey = '';
  @Input({ required: true }) descriptionKey = '';
  @Input({ required: true }) steps: ProductWizardStep[] = [];
  @Input({ required: true }) stepIndex = 0;
  @Input({ required: true }) currentStepId = '';
  @Input({ required: true }) nextLabelKey = '';
  @Input({ required: true }) canNext = false;
  @Input() hasEditingSlug = false;

  @Output() exit = new EventEmitter<void>();
  @Output() stepSelected = new EventEmitter<number>();
  @Output() prev = new EventEmitter<void>();
  @Output() next = new EventEmitter<void>();
  @Output() save = new EventEmitter<void>();
  @Output() publishNow = new EventEmitter<void>();
}

