import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonComponent } from './button.component';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, ButtonComponent],
  template: `
    <div class="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
      <div *ngIf="icon" class="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-lg dark:bg-slate-800" aria-hidden="true">
        {{ icon }}
      </div>
      <p class="text-lg font-semibold text-slate-900 dark:text-slate-50">
        {{ title || (titleKey ? (titleKey | translate) : '') }}
      </p>
      <p *ngIf="copy || copyKey" class="mt-2 text-sm text-slate-600 dark:text-slate-300">
        {{ copy || (copyKey ? (copyKey | translate) : '') }}
      </p>
      <div *ngIf="primaryActionLabelKey || secondaryActionLabelKey" class="mt-5 flex flex-wrap justify-center gap-3">
        <app-button
          *ngIf="primaryActionLabelKey"
          [routerLink]="primaryActionUrl || null"
          [label]="primaryActionLabelKey | translate"
          (action)="onPrimaryAction()"
        ></app-button>
        <app-button
          *ngIf="secondaryActionLabelKey"
          variant="ghost"
          [routerLink]="secondaryActionUrl || null"
          [label]="secondaryActionLabelKey | translate"
          (action)="onSecondaryAction()"
        ></app-button>
      </div>
    </div>
  `
})
export class EmptyStateComponent {
  @Input() icon = '';
  @Input() title = '';
  @Input() titleKey = '';
  @Input() copy = '';
  @Input() copyKey = '';
  @Input() primaryActionLabelKey = '';
  @Input() primaryActionUrl: string | readonly string[] | null = null;
  @Input() secondaryActionLabelKey = '';
  @Input() secondaryActionUrl: string | readonly string[] | null = null;

  @Output() primaryAction = new EventEmitter<void>();
  @Output() secondaryAction = new EventEmitter<void>();

  onPrimaryAction(): void {
    if (!this.primaryActionUrl) this.primaryAction.emit();
  }

  onSecondaryAction(): void {
    if (!this.secondaryActionUrl) this.secondaryAction.emit();
  }
}
