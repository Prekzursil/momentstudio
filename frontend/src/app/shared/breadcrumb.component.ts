import { Component, Input } from '@angular/core';
import { NgForOf, NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

export interface Crumb {
  label: string;
  url?: string;
}

@Component({
  selector: 'app-breadcrumb',
  standalone: true,
  imports: [NgForOf, NgIf, RouterLink, TranslateModule],
  template: `
    <nav aria-label="Breadcrumb">
      <ol class="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <li *ngFor="let crumb of crumbs; let last = last" class="flex items-center gap-2">
          <ng-container *ngIf="crumb.url && !last; else lastCrumb">
            <a [routerLink]="crumb.url" class="hover:text-slate-900 font-medium">{{ crumb.label | translate }}</a>
            <span aria-hidden="true" class="text-slate-400">/</span>
          </ng-container>
          <ng-template #lastCrumb>
            <span class="font-semibold text-slate-900">{{ crumb.label | translate }}</span>
          </ng-template>
        </li>
      </ol>
    </nav>
  `
})
export class BreadcrumbComponent {
  @Input() crumbs: Crumb[] = [];
}
