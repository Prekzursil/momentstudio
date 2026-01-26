import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { CmsEditorPrefsService } from '../shared/cms-editor-prefs.service';

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
        <div class="flex flex-wrap items-center justify-between gap-3">
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

          <div class="flex flex-wrap items-center gap-4">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">{{ 'adminUi.content.editorMode.label' | translate }}</span>
              <div class="inline-flex overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs font-semibold"
                  [class.bg-slate-900]="prefs.mode() === 'simple'"
                  [class.text-white]="prefs.mode() === 'simple'"
                  [class.text-slate-700]="prefs.mode() !== 'simple'"
                  [class.dark:text-slate-200]="prefs.mode() !== 'simple'"
                  (click)="prefs.setMode('simple')"
                >
                  {{ 'adminUi.content.editorMode.simple' | translate }}
                </button>
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs font-semibold"
                  [class.bg-slate-900]="prefs.mode() === 'advanced'"
                  [class.text-white]="prefs.mode() === 'advanced'"
                  [class.text-slate-700]="prefs.mode() !== 'advanced'"
                  [class.dark:text-slate-200]="prefs.mode() !== 'advanced'"
                  (click)="prefs.setMode('advanced')"
                >
                  {{ 'adminUi.content.editorMode.advanced' | translate }}
                </button>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">{{ 'adminUi.content.preview.deviceLabel' | translate }}</span>
              <div class="inline-flex overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs font-semibold"
                  [class.bg-slate-900]="prefs.previewDevice() === 'desktop'"
                  [class.text-white]="prefs.previewDevice() === 'desktop'"
                  [class.text-slate-700]="prefs.previewDevice() !== 'desktop'"
                  [class.dark:text-slate-200]="prefs.previewDevice() !== 'desktop'"
                  (click)="prefs.setPreviewDevice('desktop')"
                >
                  {{ 'adminUi.content.preview.desktop' | translate }}
                </button>
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs font-semibold"
                  [class.bg-slate-900]="prefs.previewDevice() === 'tablet'"
                  [class.text-white]="prefs.previewDevice() === 'tablet'"
                  [class.text-slate-700]="prefs.previewDevice() !== 'tablet'"
                  [class.dark:text-slate-200]="prefs.previewDevice() !== 'tablet'"
                  (click)="prefs.setPreviewDevice('tablet')"
                >
                  {{ 'adminUi.content.preview.tablet' | translate }}
                </button>
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs font-semibold"
                  [class.bg-slate-900]="prefs.previewDevice() === 'mobile'"
                  [class.text-white]="prefs.previewDevice() === 'mobile'"
                  [class.text-slate-700]="prefs.previewDevice() !== 'mobile'"
                  [class.dark:text-slate-200]="prefs.previewDevice() !== 'mobile'"
                  (click)="prefs.setPreviewDevice('mobile')"
                >
                  {{ 'adminUi.content.preview.mobile' | translate }}
                </button>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">{{ 'adminUi.content.preview.layoutLabel' | translate }}</span>
              <div class="inline-flex overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs font-semibold"
                  [class.bg-slate-900]="prefs.previewLayout() === 'stacked'"
                  [class.text-white]="prefs.previewLayout() === 'stacked'"
                  [class.text-slate-700]="prefs.previewLayout() !== 'stacked'"
                  [class.dark:text-slate-200]="prefs.previewLayout() !== 'stacked'"
                  (click)="prefs.setPreviewLayout('stacked')"
                >
                  {{ 'adminUi.content.preview.stacked' | translate }}
                </button>
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs font-semibold"
                  [class.bg-slate-900]="prefs.previewLayout() === 'split'"
                  [class.text-white]="prefs.previewLayout() === 'split'"
                  [class.text-slate-700]="prefs.previewLayout() !== 'split'"
                  [class.dark:text-slate-200]="prefs.previewLayout() !== 'split'"
                  (click)="prefs.setPreviewLayout('split')"
                >
                  {{ 'adminUi.content.preview.split' | translate }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{
            (prefs.mode() === 'simple'
              ? 'adminUi.content.editorMode.simpleHint'
              : 'adminUi.content.editorMode.advancedHint') | translate
          }}
        </p>
      </div>

      <router-outlet></router-outlet>
    </div>
  `
})
export class AdminContentLayoutComponent {
  constructor(public prefs: CmsEditorPrefsService) {}

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
