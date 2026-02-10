import { CommonModule } from '@angular/common';
import { Component, ContentChild, Input, TemplateRef } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-admin-page-header',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  template: `
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="grid gap-1 min-w-0">
        <h1
          class="text-2xl font-semibold text-slate-900 dark:text-slate-50"
          data-route-heading="true"
          tabindex="-1"
        >
          {{ titleKey | translate }}
        </h1>
        <p *ngIf="hintKey" class="text-sm text-slate-600 dark:text-slate-300">
          {{ hintKey | translate }}
        </p>
        <ng-container *ngIf="metaTpl" [ngTemplateOutlet]="metaTpl"></ng-container>
      </div>

      <div class="flex flex-wrap items-center justify-end gap-2">
        <ng-container *ngIf="primaryActionsTpl" [ngTemplateOutlet]="primaryActionsTpl"></ng-container>

        <div class="hidden md:flex flex-wrap items-center justify-end gap-2">
          <ng-container *ngIf="secondaryActionsTpl" [ngTemplateOutlet]="secondaryActionsTpl"></ng-container>
        </div>

        <details *ngIf="secondaryActionsTpl" class="group relative md:hidden">
          <summary
            class="inline-flex items-center justify-center rounded-full font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 bg-white text-slate-900 border border-slate-200 hover:border-slate-300 focus-visible:outline-slate-900 dark:bg-slate-800 dark:text-slate-50 dark:border-slate-700 dark:hover:border-slate-600 px-3 py-2 text-sm cursor-pointer select-none [&::-webkit-details-marker]:hidden"
            [attr.aria-label]="'adminUi.actions.more' | translate"
          >
            <span class="mr-1" aria-hidden="true">⋯</span>
            <span>{{ 'adminUi.actions.more' | translate }}</span>
          </summary>

          <div class="absolute right-0 top-full mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-800 dark:bg-slate-900">
            <div class="grid gap-2" (click)="closeDetailsMenu($event)">
              <ng-container [ngTemplateOutlet]="secondaryActionsTpl"></ng-container>
            </div>
          </div>
        </details>
      </div>
    </div>
  `
})
export class AdminPageHeaderComponent {
  @Input({ required: true }) titleKey!: string;
  @Input() hintKey = '';

  @ContentChild('primaryActions', { read: TemplateRef }) primaryActionsTpl?: TemplateRef<unknown>;
  @ContentChild('secondaryActions', { read: TemplateRef }) secondaryActionsTpl?: TemplateRef<unknown>;
  @ContentChild('meta', { read: TemplateRef }) metaTpl?: TemplateRef<unknown>;

  closeDetailsMenu(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const details = target?.closest('details') as HTMLDetailsElement | null;
    if (!details) return;
    details.open = false;
  }
}
