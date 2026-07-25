import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AdminService, StructuredDataValidationResponse } from '../../../core/admin.service';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';

type SeoPage = 'home' | 'shop' | 'product' | 'category' | 'about';

/**
 * Settings > SEO panel (meta title/description per page+language) plus the
 * sitemap preview and structured-data validation tools, extracted
 * (behaviour-preserving) from the monolithic AdminComponent. Owns the SEO form
 * state and the sitemap/structured-data result state. `seoPage` is threaded back
 * to the parent via two-way binding because the settings content-revisions
 * selector also reads it. The shared CMS content-version bookkeeping stays on
 * the parent AdminComponent and is threaded in through the four callback inputs
 * so all CMS panels keep sharing one `contentVersions` map.
 */
@Component({
  selector: 'app-admin-seo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, TranslateModule, ButtonComponent, InputComponent],
  template: `
    <section
      class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
          {{ 'adminUi.site.seo.title' | translate }}
        </h2>
        <div class="flex gap-2 text-sm">
          <label class="flex items-center gap-2">
            {{ 'adminUi.site.seo.page' | translate }}
            <select
              class="rounded border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="seoPage"
              (ngModelChange)="onSeoPageChange()"
            >
              <option value="home">{{ 'adminUi.site.seo.pages.home' | translate }}</option>
              <option value="shop">{{ 'adminUi.site.seo.pages.shop' | translate }}</option>
              <option value="product">
                {{ 'adminUi.site.seo.pages.product' | translate }}
              </option>
              <option value="category">
                {{ 'adminUi.site.seo.pages.category' | translate }}
              </option>
              <option value="about">{{ 'adminUi.site.seo.pages.about' | translate }}</option>
            </select>
          </label>
          <div class="flex items-center gap-2">
            <button
              class="px-3 py-1 rounded border"
              [class.bg-slate-900]="seoLang === 'en'"
              [class.text-white]="seoLang === 'en'"
              (click)="selectSeoLang('en')"
            >
              EN
            </button>
            <button
              class="px-3 py-1 rounded border"
              [class.bg-slate-900]="seoLang === 'ro'"
              [class.text-white]="seoLang === 'ro'"
              (click)="selectSeoLang('ro')"
            >
              RO
            </button>
          </div>
        </div>
      </div>
      <div class="grid md:grid-cols-2 gap-3 text-sm">
        <app-input
          [label]="'adminUi.site.seo.metaTitle' | translate"
          [(value)]="seoForm.title"
        ></app-input>
        <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
          {{ 'adminUi.site.seo.metaDescription' | translate }}
          <textarea
            rows="2"
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            [(ngModel)]="seoForm.description"
          ></textarea>
        </label>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <app-button
          size="sm"
          [label]="'adminUi.site.seo.save' | translate"
          (action)="saveSeo()"
        ></app-button>
        <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="seoMessage">{{
          seoMessage
        }}</span>
        <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="seoError">{{ seoError }}</span>
      </div>

      <details
        class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30"
      >
        <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
          {{ 'adminUi.site.seo.sitemapPreview.title' | translate }}
        </summary>
        <div class="mt-3 grid gap-3">
          <p class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'adminUi.site.seo.sitemapPreview.hint' | translate }}
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <app-button
              size="sm"
              variant="ghost"
              [disabled]="sitemapPreviewLoading"
              [label]="'adminUi.site.seo.sitemapPreview.load' | translate"
              (action)="loadSitemapPreview()"
            ></app-button>
            <span *ngIf="sitemapPreviewError" class="text-xs text-rose-700 dark:text-rose-300">{{
              sitemapPreviewError
            }}</span>
          </div>
          <div *ngIf="sitemapPreviewLoading" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'notifications.loading' | translate }}
          </div>
          <div
            *ngIf="!sitemapPreviewLoading && sitemapPreviewByLang"
            class="grid gap-3 md:grid-cols-2"
          >
            <div
              class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <h3 class="font-semibold text-slate-900 dark:text-slate-50">
                EN ({{ sitemapPreviewByLang['en']?.length || 0 }})
              </h3>
              <div class="mt-2 grid gap-1 text-[11px]">
                <a
                  *ngFor="let url of sitemapPreviewByLang['en'] || []"
                  [href]="url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="truncate text-indigo-600 hover:underline dark:text-indigo-300"
                >
                  {{ url }}
                </a>
              </div>
            </div>
            <div
              class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <h3 class="font-semibold text-slate-900 dark:text-slate-50">
                RO ({{ sitemapPreviewByLang['ro']?.length || 0 }})
              </h3>
              <div class="mt-2 grid gap-1 text-[11px]">
                <a
                  *ngFor="let url of sitemapPreviewByLang['ro'] || []"
                  [href]="url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="truncate text-indigo-600 hover:underline dark:text-indigo-300"
                >
                  {{ url }}
                </a>
              </div>
            </div>
          </div>
        </div>
      </details>

      <details
        class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30"
      >
        <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
          {{ 'adminUi.site.seo.structuredData.title' | translate }}
        </summary>
        <div class="mt-3 grid gap-3">
          <p class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'adminUi.site.seo.structuredData.hint' | translate }}
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <app-button
              size="sm"
              variant="ghost"
              [disabled]="structuredDataLoading"
              [label]="'adminUi.site.seo.structuredData.run' | translate"
              (action)="runStructuredDataValidation()"
            ></app-button>
            <span *ngIf="structuredDataError" class="text-xs text-rose-700 dark:text-rose-300">{{
              structuredDataError
            }}</span>
          </div>
          <div *ngIf="structuredDataLoading" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'notifications.loading' | translate }}
          </div>
          <div *ngIf="!structuredDataLoading && structuredDataResult" class="grid gap-3">
            <p class="text-xs text-slate-700 dark:text-slate-200">
              {{
                'adminUi.site.seo.structuredData.summary'
                  | translate
                    : {
                        products: structuredDataResult.checked_products,
                        pages: structuredDataResult.checked_pages,
                        errors: structuredDataResult.errors,
                        warnings: structuredDataResult.warnings,
                      }
              }}
            </p>
            <div
              *ngIf="structuredDataResult.issues?.length; else noStructuredDataIssues"
              class="grid gap-2"
            >
              <div
                *ngFor="let issue of structuredDataResult.issues"
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span
                    class="font-semibold"
                    [class.text-rose-700]="issue.severity === 'error'"
                    [class.dark:text-rose-300]="issue.severity === 'error'"
                    [class.text-amber-800]="issue.severity === 'warning'"
                    [class.dark:text-amber-200]="issue.severity === 'warning'"
                  >
                    {{ issue.severity.toUpperCase() }}
                  </span>
                  <a
                    class="font-mono text-indigo-600 hover:underline dark:text-indigo-300"
                    [href]="structuredDataIssueUrl(issue)"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ issue.entity_type }} · {{ issue.entity_key }}
                  </a>
                </div>
                <p class="mt-1 text-slate-700 dark:text-slate-200">{{ issue.message }}</p>
              </div>
            </div>
            <ng-template #noStructuredDataIssues>
              <p class="text-sm text-emerald-700 dark:text-emerald-300">
                {{ 'adminUi.site.seo.structuredData.ok' | translate }}
              </p>
            </ng-template>
          </div>
        </div>
      </details>
    </section>
  `,
})
export class AdminSeoComponent implements OnInit {
  /**
   * The currently-selected SEO page. Two-way bound because the settings
   * content-revisions selector on the parent reads the same value.
   */
  @Input() seoPage: SeoPage = 'home';
  @Output() seoPageChange = new EventEmitter<SeoPage>();

  /** Shared CMS version bookkeeping, owned by the parent AdminComponent. */
  @Input({ required: true }) rememberContentVersion!: (
    key: string,
    block: { version?: number } | null | undefined,
  ) => void;
  @Input({ required: true }) withExpectedVersion!: <T extends Record<string, unknown>>(
    key: string,
    payload: T,
  ) => T & { expected_version?: number };
  @Input({ required: true }) handleContentConflict!: (
    err: any,
    key: string,
    reload: () => void,
  ) => boolean;
  @Input({ required: true }) forgetContentVersion!: (key: string) => void;

  seoLang: 'en' | 'ro' = 'en';
  seoForm = { title: '', description: '' };
  seoMessage: string | null = null;
  seoError: string | null = null;
  sitemapPreviewLoading = false;
  sitemapPreviewError: string | null = null;
  sitemapPreviewByLang: Record<string, string[]> | null = null;
  structuredDataLoading = false;
  structuredDataError: string | null = null;
  structuredDataResult: StructuredDataValidationResponse | null = null;

  constructor(
    private readonly admin: AdminService,
    private readonly translate: TranslateService,
  ) {}

  ngOnInit(): void {
    this.loadSeo();
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }

  onSeoPageChange(): void {
    this.seoPageChange.emit(this.seoPage);
    this.loadSeo();
  }

  selectSeoLang(lang: 'en' | 'ro'): void {
    this.seoLang = lang;
    this.loadSeo();
  }

  loadSeo(): void {
    this.seoMessage = null;
    this.seoError = null;
    this.admin.getContent(`seo.${this.seoPage}`, this.seoLang).subscribe({
      next: (block) => {
        this.rememberContentVersion(`seo.${this.seoPage}`, block);
        this.seoForm = {
          title: block.title || '',
          description: block.meta?.['description'] || '',
        };
        this.seoMessage = null;
      },
      error: () => {
        this.forgetContentVersion(`seo.${this.seoPage}`);
        this.seoForm = { title: '', description: '' };
      },
    });
  }

  saveSeo(): void {
    const payload = {
      title: this.seoForm.title,
      status: 'published',
      lang: this.seoLang,
      meta: { description: this.seoForm.description },
    };
    const key = `seo.${this.seoPage}`;
    const onSuccess = () => {
      this.seoMessage = this.t('adminUi.site.seo.success.save');
      this.seoError = null;
    };
    this.admin.updateContentBlock(key, this.withExpectedVersion(key, payload)).subscribe({
      next: (block) => {
        this.rememberContentVersion(key, block);
        onSuccess();
      },
      error: (err) => {
        if (this.handleContentConflict(err, key, () => this.loadSeo())) {
          this.seoError = this.t('adminUi.site.seo.errors.save');
          this.seoMessage = null;
          return;
        }
        this.admin.createContent(key, payload).subscribe({
          next: (created) => {
            this.rememberContentVersion(key, created);
            onSuccess();
          },
          error: () => {
            this.seoError = this.t('adminUi.site.seo.errors.save');
            this.seoMessage = null;
          },
        });
      },
    });
  }

  loadSitemapPreview(): void {
    this.sitemapPreviewLoading = true;
    this.sitemapPreviewError = null;
    this.sitemapPreviewByLang = null;
    this.admin.getSitemapPreview().subscribe({
      next: (res) => {
        this.sitemapPreviewByLang = (res && typeof res === 'object' ? res.by_lang : null) || {};
        this.sitemapPreviewLoading = false;
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.sitemapPreviewLoading = false;
        this.sitemapPreviewByLang = null;
        this.sitemapPreviewError = detail || this.t('adminUi.site.seo.sitemapPreview.errors.load');
      },
    });
  }

  structuredDataIssueUrl(issue: { entity_type: string; entity_key: string }): string {
    const type = String(issue?.entity_type || '')
      .trim()
      .toLowerCase();
    const key = String(issue?.entity_key || '').trim();
    if (type === 'product') {
      return `/products/${encodeURIComponent(key)}`;
    }
    if (type === 'page') {
      const raw = key.startsWith('page.') ? key.slice('page.'.length) : key;
      if (raw === 'about') return '/about';
      if (raw === 'contact') return '/contact';
      if (!raw) return '/pages';
      return `/pages/${encodeURIComponent(raw)}`;
    }
    return '/';
  }

  runStructuredDataValidation(): void {
    this.structuredDataLoading = true;
    this.structuredDataError = null;
    this.structuredDataResult = null;
    this.admin.validateStructuredData().subscribe({
      next: (res) => {
        this.structuredDataLoading = false;
        this.structuredDataResult = res || null;
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.structuredDataLoading = false;
        this.structuredDataResult = null;
        this.structuredDataError = detail || this.t('adminUi.site.seo.structuredData.errors.load');
      },
    });
  }
}
