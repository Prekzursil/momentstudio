import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';

type ContentNavItem = {
  path: string;
  labelKey: string;
};

@Component({
  selector: 'app-admin-content-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, TranslateModule, BreadcrumbComponent],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div class="grid gap-2">
        <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.content.title' | translate }}</h1>
        <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.content.subtitle' | translate }}</p>
        <nav class="flex flex-wrap gap-2" aria-label="Content sections">
          <a
            *ngFor="let item of nav"
            [routerLink]="item.path"
            routerLinkActive="bg-slate-100 text-slate-900 dark:bg-slate-800/70 dark:text-white"
            class="rounded-full px-3 py-1.5 text-sm border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/60 dark:hover:text-white"
          >
            {{ item.labelKey | translate }}
          </a>
        </nav>
      </div>

      <router-outlet></router-outlet>
    </div>
  `
})
export class AdminContentLayoutComponent {
  readonly crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin', url: '/admin/dashboard' },
    { label: 'adminUi.content.title' }
  ];

  readonly nav: ContentNavItem[] = [
    { path: '/admin/content/home', labelKey: 'adminUi.content.nav.home' },
    { path: '/admin/content/pages', labelKey: 'adminUi.content.nav.pages' },
    { path: '/admin/content/blog', labelKey: 'adminUi.content.nav.blog' },
    { path: '/admin/content/settings', labelKey: 'adminUi.content.nav.settings' }
  ];
}
