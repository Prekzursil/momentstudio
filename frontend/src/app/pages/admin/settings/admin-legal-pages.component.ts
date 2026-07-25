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
import { catchError, forkJoin, of } from 'rxjs';

import { AdminService } from '../../../core/admin.service';
import { ButtonComponent } from '../../../shared/button.component';
import { RichEditorComponent } from '../../../shared/rich-editor.component';
import { CmsEditorPrefsService } from '../shared/cms-editor-prefs.service';

type UiLang = 'en' | 'ro';
type LocalizedText = { en: string; ro: string };

/** The four editable legal/policy documents surfaced by the pages workspace. */
export type LegalPageKey =
  | 'page.terms'
  | 'page.terms-and-conditions'
  | 'page.privacy-policy'
  | 'page.anpc';

/**
 * Pages > Legal pages editor, extracted (behaviour-preserving) from the
 * monolithic AdminComponent. Owns the legal-document form + meta state and the
 * load/save (with last-updated meta sync and conflict-aware markdown save)
 * behaviour. `legalPageKey` is threaded back to the parent via two-way binding
 * so the selected document survives leaving and re-entering the pages section
 * (the parent retains the field across the *ngIf remount). The shared CMS
 * content-version bookkeeping stays on the parent AdminComponent and is threaded
 * in through the callback inputs so all CMS panels keep sharing one
 * `contentVersions` map; `applyPageBlockSaved` threads the parent's
 * needs-translation + content-pages bookkeeping after a successful markdown save.
 */
@Component({
  selector: 'app-admin-legal-pages',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, TranslateModule, ButtonComponent, RichEditorComponent],
  template: `
    <details
      class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30"
    >
      <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
        {{ 'adminUi.site.pages.legal.title' | translate }}
      </summary>
      <div class="mt-3 grid gap-3">
        <p class="text-sm text-slate-600 dark:text-slate-300">
          {{ 'adminUi.site.pages.legal.hint' | translate }}
        </p>

        <div class="grid gap-3 md:grid-cols-[1fr_auto] items-end">
          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.site.pages.legal.documentLabel' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="legalPageKey"
              (ngModelChange)="onLegalPageKeyChange($event)"
            >
              <option [ngValue]="'page.terms'">
                {{ 'adminUi.site.pages.legal.documents.termsIndex' | translate }}
              </option>
              <option [ngValue]="'page.terms-and-conditions'">
                {{ 'adminUi.site.pages.legal.documents.terms' | translate }}
              </option>
              <option [ngValue]="'page.privacy-policy'">
                {{ 'adminUi.site.pages.legal.documents.privacy' | translate }}
              </option>
              <option [ngValue]="'page.anpc'">
                {{ 'adminUi.site.pages.legal.documents.anpc' | translate }}
              </option>
            </select>
          </label>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <a
              class="inline-flex h-10 items-center justify-center rounded-full px-3 text-sm font-medium bg-white text-slate-900 border border-slate-200 hover:border-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:bg-slate-800 dark:text-slate-50 dark:border-slate-700 dark:hover:border-slate-600"
              [attr.href]="pagePublicUrlForKey(legalPageKey)"
              target="_blank"
              rel="noopener"
            >
              {{ 'adminUi.site.pages.legal.open' | translate }}
            </a>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'adminUi.actions.refresh' | translate"
              (action)="loadLegalPage(legalPageKey)"
            ></app-button>
          </div>
        </div>

        <div class="grid gap-3 md:grid-cols-[260px_1fr] items-end">
          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.site.pages.legal.lastUpdatedLabel' | translate }}
            <input
              type="date"
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="legalPageLastUpdated"
            />
            <span class="text-xs text-slate-500 dark:text-slate-400">{{
              'adminUi.site.pages.legal.lastUpdatedHint' | translate
            }}</span>
          </label>
        </div>

        <div
          *ngIf="legalPageError"
          class="rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
        >
          {{ legalPageError }}
        </div>
        <div *ngIf="legalPageLoading" class="text-sm text-slate-600 dark:text-slate-300">
          {{ 'notifications.loading' | translate }}
        </div>

        <ng-container *ngIf="cmsPrefs.translationLayout() === 'sideBySide'; else legalPagesSingle">
          <div class="grid gap-3 md:grid-cols-2">
            <div class="grid gap-1">
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">RO</span>
              <app-rich-editor height="520px" [(value)]="legalPageForm.ro"></app-rich-editor>
            </div>
            <div class="grid gap-1">
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">EN</span>
              <app-rich-editor height="520px" [(value)]="legalPageForm.en"></app-rich-editor>
            </div>
          </div>
        </ng-container>
        <ng-template #legalPagesSingle>
          <app-rich-editor height="520px" [(value)]="legalPageForm[infoLang]"></app-rich-editor>
        </ng-template>

        <div class="flex flex-wrap items-center gap-2">
          <app-button
            size="sm"
            [label]="'adminUi.actions.save' | translate"
            [disabled]="legalPageSaving"
            (action)="saveLegalPageUi()"
          ></app-button>
          <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="legalPageMessage">{{
            legalPageMessage
          }}</span>
          <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="legalPageError">{{
            legalPageError
          }}</span>
        </div>
      </div>
    </details>
  `,
})
export class AdminLegalPagesComponent implements OnInit {
  /**
   * Currently-selected legal document. Two-way bound so the parent retains the
   * selection across the pages-section *ngIf remount (behaviour-preserving).
   */
  @Input() legalPageKey: LegalPageKey = 'page.terms';
  @Output() legalPageKeyChange = new EventEmitter<LegalPageKey>();

  /** Shared page-editor language, owned by the parent AdminComponent. */
  @Input() infoLang: UiLang = 'en';

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
  /**
   * Applies the parent's needs-translation + content-pages bookkeeping after a
   * legal markdown block is persisted (kept on the parent because it mutates the
   * shared page-builder state).
   */
  @Input({ required: true }) applyPageBlockSaved!: (
    key: string,
    block: { needs_translation_en?: boolean; needs_translation_ro?: boolean } | null | undefined,
  ) => void;

  legalPageForm: LocalizedText = { en: '', ro: '' };
  legalPageLastUpdated = '';
  private legalPageLastUpdatedOriginal = '';
  private legalPageMeta: Record<string, unknown> = {};
  legalPageLoading = false;
  legalPageSaving = false;
  legalPageMessage: string | null = null;
  legalPageError: string | null = null;

  constructor(
    private readonly admin: AdminService,
    private readonly translate: TranslateService,
    public readonly cmsPrefs: CmsEditorPrefsService,
  ) {}

  ngOnInit(): void {
    this.loadLegalPage(this.legalPageKey);
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }

  pagePublicUrlForKey(key: string): string {
    const raw = String(key || '');
    const slug = raw.startsWith('page.') ? raw.slice('page.'.length) : raw;
    if (slug === 'about') return '/about';
    if (slug === 'contact') return '/contact';
    if (!slug) return '/pages';
    return `/pages/${encodeURIComponent(slug)}`;
  }

  onLegalPageKeyChange(next: LegalPageKey): void {
    if (!next || next === this.legalPageKey) return;
    this.legalPageKey = next;
    this.legalPageKeyChange.emit(next);
    this.loadLegalPage(next);
  }

  loadLegalPage(key: LegalPageKey): void {
    this.legalPageLoading = true;
    this.legalPageMessage = null;
    this.legalPageError = null;
    const target = (key || '').trim();
    if (!target) {
      this.legalPageLoading = false;
      this.legalPageError = 'Missing page key.';
      return;
    }

    forkJoin([
      this.admin
        .getContent(target, 'en')
        .pipe(catchError((err) => (err?.status === 404 ? of(null) : of(err)))),
      this.admin
        .getContent(target, 'ro')
        .pipe(catchError((err) => (err?.status === 404 ? of(null) : of(err)))),
    ]).subscribe({
      next: ([enRes, roRes]) => {
        const enBlock =
          enRes && typeof enRes === 'object' && 'body_markdown' in enRes ? enRes : null;
        const roBlock =
          roRes && typeof roRes === 'object' && 'body_markdown' in roRes ? roRes : null;

        if (!enBlock && enRes?.status && enRes.status !== 404) {
          this.legalPageError = this.t('adminUi.site.pages.errors.load');
        }

        if (enBlock) this.rememberContentVersion(target, enBlock);
        if (!enBlock && roBlock) this.rememberContentVersion(target, roBlock);

        this.legalPageForm = {
          en: (enBlock?.body_markdown as string) || '',
          ro: (roBlock?.body_markdown as string) || '',
        };
        const meta = ((enBlock?.meta as Record<string, unknown> | null | undefined) ??
          (roBlock?.meta as Record<string, unknown> | null | undefined) ??
          {}) as Record<string, unknown>;
        this.legalPageMeta = { ...(meta && typeof meta === 'object' ? meta : {}) };
        const lastUpdated =
          typeof this.legalPageMeta['last_updated'] === 'string'
            ? String(this.legalPageMeta['last_updated'])
            : '';
        this.legalPageLastUpdated = lastUpdated;
        this.legalPageLastUpdatedOriginal = lastUpdated;

        this.legalPageLoading = false;
      },
      error: () => {
        this.legalPageLoading = false;
        this.legalPageError = this.t('adminUi.site.pages.errors.load');
      },
    });
  }

  private saveLegalMetaIfNeeded(
    key: LegalPageKey,
    onSuccess: () => void,
    onError: () => void,
  ): void {
    const next = String(this.legalPageLastUpdated || '').trim();
    const prev = String(this.legalPageLastUpdatedOriginal || '').trim();
    if (next === prev) {
      onSuccess();
      return;
    }
    const meta: Record<string, unknown> = { ...this.legalPageMeta };
    if (next) meta['last_updated'] = next;
    else delete meta['last_updated'];

    this.admin.updateContentBlock(key, this.withExpectedVersion(key, { meta })).subscribe({
      next: (updated) => {
        this.rememberContentVersion(key, updated);
        const updatedMeta = ((updated as { meta?: Record<string, unknown> | null }).meta ||
          {}) as Record<string, unknown>;
        this.legalPageMeta = {
          ...(updatedMeta && typeof updatedMeta === 'object' ? updatedMeta : {}),
        };
        const lastUpdated =
          typeof this.legalPageMeta['last_updated'] === 'string'
            ? String(this.legalPageMeta['last_updated'])
            : '';
        this.legalPageLastUpdated = lastUpdated;
        this.legalPageLastUpdatedOriginal = lastUpdated;
        onSuccess();
      },
      error: (err) => {
        if (this.handleContentConflict(err, key, () => this.loadLegalPage(key))) {
          onError();
          return;
        }
        onError();
      },
    });
  }

  saveLegalPageUi(): void {
    const key = this.legalPageKey;
    if (!key) return;
    if (this.cmsPrefs.translationLayout() === 'sideBySide') {
      this.saveLegalPageBoth(key, this.legalPageForm);
      return;
    }
    this.saveLegalPage(key, this.legalPageForm[this.infoLang] || '', this.infoLang);
  }

  private saveLegalPage(key: LegalPageKey, body: string, lang: UiLang): void {
    this.legalPageMessage = null;
    this.legalPageError = null;
    this.legalPageSaving = true;
    this.saveLegalMetaIfNeeded(
      key,
      () => {
        this.savePageMarkdown(
          key,
          body,
          lang,
          () => {
            this.legalPageSaving = false;
            this.legalPageMessage = this.t('adminUi.site.pages.success.save');
          },
          () => {
            this.legalPageSaving = false;
            this.legalPageError = this.t('adminUi.site.pages.errors.save');
          },
        );
      },
      () => {
        this.legalPageSaving = false;
        this.legalPageError = this.t('adminUi.site.pages.errors.save');
      },
    );
  }

  private saveLegalPageBoth(key: LegalPageKey, body: LocalizedText): void {
    this.legalPageMessage = null;
    this.legalPageError = null;
    this.legalPageSaving = true;
    this.saveLegalMetaIfNeeded(
      key,
      () => {
        this.savePageMarkdown(
          key,
          body.en || '',
          'en',
          () => {
            this.savePageMarkdown(
              key,
              body.ro || '',
              'ro',
              () => {
                this.legalPageSaving = false;
                this.legalPageMessage = this.t('adminUi.site.pages.success.save');
              },
              () => {
                this.legalPageSaving = false;
                this.legalPageError = this.t('adminUi.site.pages.errors.save');
              },
            );
          },
          () => {
            this.legalPageSaving = false;
            this.legalPageError = this.t('adminUi.site.pages.errors.save');
          },
        );
      },
      () => {
        this.legalPageSaving = false;
        this.legalPageError = this.t('adminUi.site.pages.errors.save');
      },
    );
  }

  private savePageMarkdown(
    key: string,
    body: string,
    lang: UiLang,
    onSuccess: () => void,
    onError: () => void,
  ): void {
    const payload = { body_markdown: body, status: 'published', lang };
    const createPayload = { title: key, ...payload };

    const onSuccessWithBlock = (block?: any | null) => {
      this.rememberContentVersion(key, block);
      this.applyPageBlockSaved(key, block);
      onSuccess();
    };

    this.admin.updateContentBlock(key, this.withExpectedVersion(key, payload)).subscribe({
      next: (block) => onSuccessWithBlock(block),
      error: (err) => {
        if (this.handleContentConflict(err, key, () => this.loadLegalPage(key as LegalPageKey))) {
          onError();
          return;
        }
        this.admin.createContent(key, createPayload).subscribe({
          next: (created) => onSuccessWithBlock(created),
          error: () => onError(),
        });
      },
    });
  }
}
