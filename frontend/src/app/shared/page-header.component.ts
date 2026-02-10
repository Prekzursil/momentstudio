import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { BreadcrumbComponent } from './breadcrumb.component';

export type PageHeaderCrumb = {
  label: string;
  url?: string;
};

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [CommonModule, TranslateModule, BreadcrumbComponent],
  template: `
    <div class="grid gap-4">
      <app-breadcrumb *ngIf="crumbs?.length" [crumbs]="crumbs"></app-breadcrumb>

      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="grid gap-1 min-w-0">
          <h1
            class="text-2xl font-semibold text-slate-900 dark:text-slate-50"
            data-route-heading="true"
            tabindex="-1"
          >
            {{ title || (titleKey ? (titleKey | translate) : '') }}
          </h1>
          <p *ngIf="subtitle || subtitleKey" class="text-sm text-slate-600 dark:text-slate-300">
            {{ subtitle || (subtitleKey ? (subtitleKey | translate) : '') }}
          </p>
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2">
          <ng-content select="[pageHeaderActions]"></ng-content>
        </div>
      </div>
    </div>
  `
})
export class PageHeaderComponent {
  @Input() title = '';
  @Input() titleKey = '';
  @Input() subtitle = '';
  @Input() subtitleKey = '';
  @Input() crumbs: PageHeaderCrumb[] = [];
}
