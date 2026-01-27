import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { InputComponent } from '../../shared/input.component';
import { RichEditorComponent } from '../../shared/rich-editor.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { SkeletonComponent } from '../../shared/skeleton.component';
import {
  AdminService,
  AdminSummary,
  AdminProduct,
  AdminOrder,
  AdminUser,
  AdminUserAliasesResponse,
  AdminContent,
  AdminCoupon,
  AdminAudit,
  LowStockItem,
  AdminCategory,
  AdminProductDetail,
  FeaturedCollection,
  ContentImageAssetRead,
  ContentBlockVersionListItem,
  ContentBlockVersionRead,
  ContentPageListItem,
  ContentRedirectRead,
  ContentRedirectImportResult,
  StructuredDataValidationResponse,
  ContentLinkCheckIssue
} from '../../core/admin.service';
import { AdminBlogComment, BlogService } from '../../core/blog.service';
import { FxAdminService, FxAdminStatus, FxOverrideAuditEntry } from '../../core/fx-admin.service';
import { TaxGroupRead, TaxesAdminService } from '../../core/taxes-admin.service';
import { ToastService } from '../../core/toast.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { combineLatest, firstValueFrom, forkJoin, of, Subscription } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { MarkdownService } from '../../core/markdown.service';
import { AuthService } from '../../core/auth.service';
import { appConfig } from '../../core/app-config';
import { diffLines } from 'diff';
import { formatIdentity } from '../../shared/user-identity';
import { ContentRevisionsComponent } from './shared/content-revisions.component';
import { AssetLibraryComponent } from './shared/asset-library.component';
import { BannerBlockComponent } from '../../shared/banner-block.component';
import { CarouselBlockComponent } from '../../shared/carousel-block.component';
import { CmsEditorPrefsService } from './shared/cms-editor-prefs.service';
import { CmsBlockLibraryBlockType, CmsBlockLibraryComponent, CmsBlockLibraryTemplate } from './shared/cms-block-library.component';

type AdminContentSection = 'home' | 'pages' | 'blog' | 'settings';
type UiLang = 'en' | 'ro';
type ContentStatusUi = 'draft' | 'review' | 'published';

type HomeSectionId =
  | 'featured_products'
  | 'sale_products'
  | 'new_arrivals'
  | 'featured_collections'
  | 'story'
  | 'recently_viewed'
  | 'why';

type HomeBlockType = HomeSectionId | 'text' | 'image' | 'gallery' | 'banner' | 'carousel';

type LocalizedText = { en: string; ro: string };

type HomeGalleryImageDraft = {
  url: string;
  alt: LocalizedText;
  caption: LocalizedText;
  focal_x: number;
  focal_y: number;
};

type SlideDraft = {
  image_url: string;
  alt: LocalizedText;
  headline: LocalizedText;
  subheadline: LocalizedText;
  cta_label: LocalizedText;
  cta_url: string;
  variant: 'full' | 'split';
  size: 'S' | 'M' | 'L';
  text_style: 'light' | 'dark';
  focal_x: number;
  focal_y: number;
};

type CarouselSettingsDraft = {
  autoplay: boolean;
  interval_ms: number;
  show_dots: boolean;
  show_arrows: boolean;
  pause_on_hover: boolean;
};

type HomeBlockDraft = {
  key: string;
  type: HomeBlockType;
  enabled: boolean;
  title: LocalizedText;
  body_markdown: LocalizedText;
  url: string;
  link_url: string;
  focal_x: number;
  focal_y: number;
  alt: LocalizedText;
  caption: LocalizedText;
  images: HomeGalleryImageDraft[];
  slide: SlideDraft;
  slides: SlideDraft[];
  settings: CarouselSettingsDraft;
};

type PageBuilderKey = `page.${string}`;
type PageBlockType = 'text' | 'image' | 'gallery' | 'banner' | 'carousel';
type PageBlockDraft = Omit<HomeBlockDraft, 'type'> & { type: PageBlockType };

type PageBlocksDraftState = {
  blocks: PageBlockDraft[];
  status: ContentStatusUi;
  publishedAt: string;
  publishedUntil: string;
  requiresAuth: boolean;
};

type BlogDraftState = {
  title: string;
  body_markdown: string;
  status: ContentStatusUi;
  published_at: string;
  published_until: string;
  summary: string;
  tags: string;
  series: string;
  cover_image_url: string;
  reading_time_minutes: string;
  pinned: boolean;
  pin_order: string;
};

type CmsAutosaveEnvelope = {
  v: 1;
  ts: string;
  state_json: string;
};

class CmsDraftManager<T> {
  private initialized = false;
  private past: string[] = [];
  private future: string[] = [];
  private present = '';
  private server = '';
  private restoreCandidate: CmsAutosaveEnvelope | null = null;
  private pending: string | null = null;
  private pendingTimer: number | null = null;
  dirty = false;
  autosavePending = false;
  lastAutosavedAt: string | null = null;

  constructor(
    private readonly storageKey: string,
    private readonly opts: { debounceMs: number; limit: number } = { debounceMs: 650, limit: 60 }
  ) {}

  get hasRestorableAutosave(): boolean {
    return Boolean(this.restoreCandidate?.state_json);
  }

  get restorableAutosaveAt(): string | null {
    return this.restoreCandidate?.ts || null;
  }

  isReady(): boolean {
    return this.initialized;
  }

  initFromServer(state: T): void {
    const serialized = this.serialize(state);
    this.initialized = true;
    this.past = [];
    this.future = [];
    this.present = serialized;
    this.server = serialized;
    this.pending = null;
    this.clearPendingTimer();
    this.dirty = false;
    this.autosavePending = false;
    this.lastAutosavedAt = null;
    this.restoreCandidate = this.readAutosaveCandidate(serialized);
  }

  markServerSaved(state: T, clearAutosave = true): void {
    if (!this.initialized) return;
    this.commitNow(state);
    this.server = this.present;
    this.dirty = false;
    if (clearAutosave) this.clearAutosave();
  }

  observe(state: T): void {
    if (!this.initialized) return;
    const serialized = this.serialize(state);
    this.dirty = serialized !== this.server;
    if (serialized === this.present) return;
    this.pending = serialized;
    this.autosavePending = true;
    this.resetCommitTimer();
  }

  canUndo(current: T): boolean {
    if (!this.initialized) return false;
    const serialized = this.serialize(current);
    return this.past.length > 0 || serialized !== this.present;
  }

  canRedo(current: T): boolean {
    if (!this.initialized) return false;
    const serialized = this.serialize(current);
    if (serialized !== this.present) return false;
    return this.future.length > 0;
  }

  undo(current: T): T | null {
    if (!this.initialized) return null;
    this.commitNow(current);
    if (!this.past.length) return null;
    this.future.push(this.present);
    const prev = this.past.pop()!;
    this.present = prev;
    this.dirty = this.present !== this.server;
    this.writeAutosave(this.present);
    return this.deserialize(prev);
  }

  redo(current: T): T | null {
    if (!this.initialized) return null;
    this.commitNow(current);
    if (!this.future.length) return null;
    this.past.push(this.present);
    const next = this.future.pop()!;
    this.present = next;
    this.dirty = this.present !== this.server;
    this.writeAutosave(this.present);
    return this.deserialize(next);
  }

	  restoreAutosave(current: T): T | null {
	    if (!this.initialized) return null;
	    const candidate = this.restoreCandidate;
	    if (!candidate?.state_json) return null;
	    const restored = candidate.state_json;
	    this.commitNow(current);
	    if (restored === this.present) {
	      this.restoreCandidate = null;
	      return null;
	    }
	    this.past.push(this.present);
	    this.trimPast();
	    this.present = restored;
	    this.lastAutosavedAt = candidate.ts;
    this.dirty = this.present !== this.server;
    this.restoreCandidate = null;
    this.writeAutosave(restored, candidate.ts);
    return this.deserialize(restored);
  }

  discardAutosave(): void {
    this.clearAutosave();
    this.restoreCandidate = null;
  }

  dispose(): void {
    this.clearPendingTimer();
  }

  private commitNow(state: T): void {
    const serialized = this.serialize(state);
    this.clearPendingTimer();
    this.pending = null;
    this.autosavePending = false;
    this.dirty = serialized !== this.server;
    if (serialized === this.present) return;
    if (this.present) {
      this.past.push(this.present);
      this.trimPast();
    }
    this.present = serialized;
    this.future = [];
    this.writeAutosave(serialized);
  }

  private resetCommitTimer(): void {
    this.clearPendingTimer();
    this.pendingTimer = window.setTimeout(() => this.commitPending(), this.opts.debounceMs);
  }

  private commitPending(): void {
    if (!this.pending) {
      this.autosavePending = false;
      return;
    }
    const next = this.pending;
    this.pending = null;
    this.pendingTimer = null;
    this.autosavePending = false;
    if (next === this.present) return;
    if (this.present) {
      this.past.push(this.present);
      this.trimPast();
    }
    this.present = next;
    this.future = [];
    this.dirty = this.present !== this.server;
    this.writeAutosave(next);
  }

  private trimPast(): void {
    if (this.past.length <= this.opts.limit) return;
    this.past.splice(0, this.past.length - this.opts.limit);
  }

  private clearPendingTimer(): void {
    if (this.pendingTimer !== null) {
      window.clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  private serialize(state: T): string {
    return JSON.stringify(state);
  }

  private deserialize(raw: string): T {
    return JSON.parse(raw) as T;
  }

  private writeAutosave(stateJson: string, tsOverride?: string): void {
    if (typeof window === 'undefined') return;
    const ts = tsOverride || new Date().toISOString();
    this.lastAutosavedAt = ts;
    try {
      const payload: CmsAutosaveEnvelope = { v: 1, ts, state_json: stateJson };
      window.localStorage.setItem(this.storageKey, JSON.stringify(payload));
    } catch {
      // ignore quota / browser storage errors
    }
  }

  private clearAutosave(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(this.storageKey);
    } catch {
      // ignore
    }
    this.lastAutosavedAt = null;
  }

  private readAutosaveCandidate(serverStateJson: string): CmsAutosaveEnvelope | null {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(this.storageKey);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<CmsAutosaveEnvelope> | null;
      if (!parsed || parsed.v !== 1) return null;
      const ts = typeof parsed.ts === 'string' ? parsed.ts : '';
      const stateJson = typeof parsed.state_json === 'string' ? parsed.state_json : '';
      if (!ts || !stateJson) return null;
      if (stateJson === serverStateJson) {
        window.localStorage.removeItem(this.storageKey);
        return null;
      }
      return { v: 1, ts, state_json: stateJson };
    } catch {
      return null;
    }
  }
}

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    BreadcrumbComponent,
    ButtonComponent,
    ErrorStateComponent,
    InputComponent,
    RichEditorComponent,
    LocalizedCurrencyPipe,
    SkeletonComponent,
    ContentRevisionsComponent,
    AssetLibraryComponent,
    CmsBlockLibraryComponent,
    BannerBlockComponent,
    CarouselBlockComponent,
    TranslateModule
  ],
 template: `
	    <div class="grid gap-6">
	      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
	      <div class="sr-only" aria-live="polite" aria-atomic="true">{{ cmsAriaAnnouncement }}</div>
	      <app-error-state
	        *ngIf="error()"
	        [message]="error()!"
	        [requestId]="errorRequestId()"
        [showRetry]="true"
        (retry)="retryLoadAll()"
      ></app-error-state>
      <div class="grid gap-6" *ngIf="!loading(); else loadingTpl">
	          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	            <div class="flex items-center justify-between">
	              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.site.assets.title' | translate }}</h2>
	              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadAssets()"></app-button>
	            </div>
	            <div class="grid md:grid-cols-3 gap-3 text-sm">
	              <app-input [label]="'adminUi.site.assets.logoUrl' | translate" [(value)]="assetsForm.logo_url"></app-input>
	              <app-input [label]="'adminUi.site.assets.faviconUrl' | translate" [(value)]="assetsForm.favicon_url"></app-input>
	              <app-input [label]="'adminUi.site.assets.socialImageUrl' | translate" [(value)]="assetsForm.social_image_url"></app-input>
            </div>
            <div class="flex items-center gap-2 text-sm">
              <app-button size="sm" [label]="'adminUi.site.assets.save' | translate" (action)="saveAssets()"></app-button>
              <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="assetsMessage">{{ assetsMessage }}</span>
              <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="assetsError">{{ assetsError }}</span>
            </div>

            <details class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30">
              <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                {{ 'adminUi.site.assets.library.title' | translate }}
              </summary>
              <div class="mt-3">
                <app-asset-library [initialKey]="'site.assets'" [allowSelect]="false"></app-asset-library>
              </div>
            </details>
          </section>

	          <section *ngIf="section() === 'settings'" class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	            <div class="flex items-center justify-between gap-3">
	              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.site.social.title' | translate }}</h2>
	              <div class="flex items-center gap-2">
	                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadSocial()"></app-button>
	                <app-button size="sm" [label]="'adminUi.actions.save' | translate" (action)="saveSocial()"></app-button>
	              </div>
	            </div>
            <div class="grid md:grid-cols-2 gap-3 text-sm">
              <app-input [label]="'adminUi.site.social.phone' | translate" [(value)]="socialForm.phone"></app-input>
              <app-input [label]="'adminUi.site.social.email' | translate" [(value)]="socialForm.email"></app-input>
            </div>
            <div class="grid md:grid-cols-2 gap-4">
              <div class="grid gap-2">
                <div class="flex items-center justify-between">
                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.site.social.instagramPages' | translate }}</p>
                  <button class="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300" type="button" (click)="addSocialLink('instagram')">
                    {{ 'adminUi.actions.add' | translate }}
                  </button>
                </div>
                <div *ngFor="let page of socialForm.instagram_pages; let i = index" class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30">
                  <app-input [label]="'adminUi.site.social.label' | translate" [(value)]="page.label"></app-input>
                  <app-input [label]="'adminUi.site.social.url' | translate" [(value)]="page.url"></app-input>
                  <app-input [label]="'adminUi.site.social.thumbnailUrlOptional' | translate" [(value)]="page.thumbnail_url"></app-input>
                  <div class="flex items-center gap-2">
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.site.social.fetchThumbnail' | translate"
                      [disabled]="socialThumbLoading[socialThumbKey('instagram', i)] || !(page.url || '').trim()"
                      (action)="fetchSocialThumbnail('instagram', i)"
                    ></app-button>
                    <span *ngIf="socialThumbLoading[socialThumbKey('instagram', i)]" class="text-xs text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.site.social.fetching' | translate }}
                    </span>
                    <span *ngIf="socialThumbErrors[socialThumbKey('instagram', i)]" class="text-xs text-rose-700 dark:text-rose-300">
                      {{ socialThumbErrors[socialThumbKey('instagram', i)] }}
                    </span>
                  </div>
                  <img
                    *ngIf="(page.thumbnail_url || '').trim()"
                    [src]="page.thumbnail_url"
                    [alt]="page.label"
                    class="h-10 w-10 rounded-full border border-slate-200 object-cover dark:border-slate-800"
                    loading="lazy"
                  />
                  <button class="text-xs text-rose-700 hover:underline dark:text-rose-300 justify-self-start" type="button" (click)="removeSocialLink('instagram', i)">
                    {{ 'adminUi.actions.remove' | translate }}
                  </button>
                </div>
              </div>
              <div class="grid gap-2">
                <div class="flex items-center justify-between">
                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.site.social.facebookPages' | translate }}</p>
                  <button class="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300" type="button" (click)="addSocialLink('facebook')">
                    {{ 'adminUi.actions.add' | translate }}
                  </button>
                </div>
                <div *ngFor="let page of socialForm.facebook_pages; let i = index" class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30">
                  <app-input [label]="'adminUi.site.social.label' | translate" [(value)]="page.label"></app-input>
                  <app-input [label]="'adminUi.site.social.url' | translate" [(value)]="page.url"></app-input>
                  <app-input [label]="'adminUi.site.social.thumbnailUrlOptional' | translate" [(value)]="page.thumbnail_url"></app-input>
                  <div class="flex items-center gap-2">
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.site.social.fetchThumbnail' | translate"
                      [disabled]="socialThumbLoading[socialThumbKey('facebook', i)] || !(page.url || '').trim()"
                      (action)="fetchSocialThumbnail('facebook', i)"
                    ></app-button>
                    <span *ngIf="socialThumbLoading[socialThumbKey('facebook', i)]" class="text-xs text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.site.social.fetching' | translate }}
                    </span>
                    <span *ngIf="socialThumbErrors[socialThumbKey('facebook', i)]" class="text-xs text-rose-700 dark:text-rose-300">
                      {{ socialThumbErrors[socialThumbKey('facebook', i)] }}
                    </span>
                  </div>
                  <img
                    *ngIf="(page.thumbnail_url || '').trim()"
                    [src]="page.thumbnail_url"
                    [alt]="page.label"
                    class="h-10 w-10 rounded-full border border-slate-200 object-cover dark:border-slate-800"
                    loading="lazy"
                  />
                  <button class="text-xs text-rose-700 hover:underline dark:text-rose-300 justify-self-start" type="button" (click)="removeSocialLink('facebook', i)">
                    {{ 'adminUi.actions.remove' | translate }}
                  </button>
                </div>
              </div>
            </div>
	            <div class="flex items-center gap-2 text-sm">
	              <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="socialMessage">{{ socialMessage }}</span>
	              <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="socialError">{{ socialError }}</span>
	            </div>
	          </section>

          <section *ngIf="section() === 'settings'" class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.site.company.title' | translate }}</h2>
              <div class="flex items-center gap-2">
                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadCompany()"></app-button>
                <app-button size="sm" [label]="'adminUi.actions.save' | translate" (action)="saveCompany()"></app-button>
              </div>
            </div>
            <p class="text-xs text-slate-600 dark:text-slate-300">
              {{ 'adminUi.site.company.hint' | translate }}
            </p>
            <div class="grid md:grid-cols-2 gap-3 text-sm">
              <app-input [label]="'adminUi.site.company.fields.name' | translate" [(value)]="companyForm.name"></app-input>
              <app-input [label]="'adminUi.site.company.fields.registrationNumber' | translate" [(value)]="companyForm.registration_number"></app-input>
              <app-input [label]="'adminUi.site.company.fields.cui' | translate" [(value)]="companyForm.cui"></app-input>
              <app-input [label]="'adminUi.site.company.fields.phone' | translate" [(value)]="companyForm.phone"></app-input>
              <app-input [label]="'adminUi.site.company.fields.email' | translate" [(value)]="companyForm.email"></app-input>
              <app-input [label]="'adminUi.site.company.fields.address' | translate" [(value)]="companyForm.address"></app-input>
            </div>

            <div
              *ngIf="companyMissingFields().length"
              class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <p class="text-xs font-semibold uppercase tracking-[0.2em]">{{ 'adminUi.site.company.missing.title' | translate }}</p>
              <ul class="mt-2 list-disc pl-5 text-xs">
                <li *ngFor="let fieldKey of companyMissingFields()">{{ fieldKey | translate }}</li>
              </ul>
            </div>

            <div class="flex items-center gap-2 text-sm">
              <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="companyMessage">{{ companyMessage }}</span>
              <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="companyError">{{ companyError }}</span>
            </div>
          </section>

	          <section *ngIf="section() === 'settings'" class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	            <div class="flex items-center justify-between gap-3">
	              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.site.checkout.title' | translate }}</h2>
	              <div class="flex items-center gap-2">
                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadCheckoutSettings()"></app-button>
                <app-button size="sm" [label]="'adminUi.actions.save' | translate" (action)="saveCheckoutSettings()"></app-button>
              </div>
            </div>
            <p class="text-xs text-slate-600 dark:text-slate-300">
              {{ 'adminUi.site.checkout.hint' | translate }}
            </p>
            <div class="grid md:grid-cols-2 gap-3 text-sm">
              <app-input
                [label]="'adminUi.site.checkout.shippingFee' | translate"
                type="number"
                [min]="0"
                [step]="0.01"
                placeholder="20.00"
                [(value)]="checkoutSettingsForm.shipping_fee_ron"
              ></app-input>
              <app-input
                [label]="'adminUi.site.checkout.freeShippingThreshold' | translate"
                type="number"
                [min]="0"
                [step]="0.01"
                placeholder="300.00"
                [(value)]="checkoutSettingsForm.free_shipping_threshold_ron"
              ></app-input>
            </div>

            <div class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950">
              <p class="text-xs font-semibold text-slate-600 uppercase tracking-[0.2em] dark:text-slate-300">
                {{ 'adminUi.site.checkout.roundingTitle' | translate }}
              </p>
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.site.checkout.roundingMode' | translate }}
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="checkoutSettingsForm.money_rounding"
                >
                  <option value="half_up">{{ 'adminUi.site.checkout.roundingModeHalfUp' | translate }}</option>
                  <option value="half_even">{{ 'adminUi.site.checkout.roundingModeHalfEven' | translate }}</option>
                  <option value="up">{{ 'adminUi.site.checkout.roundingModeUp' | translate }}</option>
                  <option value="down">{{ 'adminUi.site.checkout.roundingModeDown' | translate }}</option>
                </select>
                <span class="text-xs font-normal text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.site.checkout.roundingHint' | translate }}
                </span>
              </label>
            </div>

            <div class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950">
              <p class="text-xs font-semibold text-slate-600 uppercase tracking-[0.2em] dark:text-slate-300">
                {{ 'adminUi.site.checkout.phoneRequirementsTitle' | translate }}
              </p>
              <label class="flex items-center gap-2">
                <input type="checkbox" [(ngModel)]="checkoutSettingsForm.phone_required_home" />
                <span class="text-slate-700 dark:text-slate-200">{{ 'adminUi.site.checkout.phoneRequiredHome' | translate }}</span>
              </label>
              <label class="flex items-center gap-2">
                <input type="checkbox" [(ngModel)]="checkoutSettingsForm.phone_required_locker" />
                <span class="text-slate-700 dark:text-slate-200">{{ 'adminUi.site.checkout.phoneRequiredLocker' | translate }}</span>
              </label>
            </div>

            <div class="grid gap-3 text-sm">
              <label class="flex items-center gap-2">
                <input type="checkbox" [(ngModel)]="checkoutSettingsForm.fee_enabled" />
                <span class="text-slate-700 dark:text-slate-200">{{ 'adminUi.site.checkout.feeEnabled' | translate }}</span>
              </label>
              <div class="grid md:grid-cols-2 gap-3" *ngIf="checkoutSettingsForm.fee_enabled">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.site.checkout.feeType' | translate }}
                  <select
                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="checkoutSettingsForm.fee_type"
                  >
                    <option value="flat">{{ 'adminUi.site.checkout.feeTypeFlat' | translate }}</option>
                    <option value="percent">{{ 'adminUi.site.checkout.feeTypePercent' | translate }}</option>
                  </select>
                </label>
                <app-input
                  [label]="'adminUi.site.checkout.feeValue' | translate"
                  type="number"
                  [min]="0"
                  [step]="0.01"
                  placeholder="0.00"
                  [(value)]="checkoutSettingsForm.fee_value"
                ></app-input>
              </div>
            </div>

            <div class="grid gap-3 text-sm">
              <label class="flex items-center gap-2">
                <input type="checkbox" [(ngModel)]="checkoutSettingsForm.vat_enabled" />
                <span class="text-slate-700 dark:text-slate-200">{{ 'adminUi.site.checkout.vatEnabled' | translate }}</span>
              </label>
              <div class="grid md:grid-cols-2 gap-3" *ngIf="checkoutSettingsForm.vat_enabled">
                <app-input
                  [label]="'adminUi.site.checkout.vatRatePercent' | translate"
                  type="number"
                  [min]="0"
                  [max]="100"
                  [step]="0.01"
                  placeholder="10.00"
                  [(value)]="checkoutSettingsForm.vat_rate_percent"
                ></app-input>
                <div class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                  <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input type="checkbox" [(ngModel)]="checkoutSettingsForm.vat_apply_to_shipping" />
                    <span>{{ 'adminUi.site.checkout.vatApplyToShipping' | translate }}</span>
                  </label>
                  <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input type="checkbox" [(ngModel)]="checkoutSettingsForm.vat_apply_to_fee" />
                    <span>{{ 'adminUi.site.checkout.vatApplyToFee' | translate }}</span>
                  </label>
                </div>
              </div>
            </div>

            <div class="grid md:grid-cols-2 gap-3 text-sm">
              <app-input
                [label]="'adminUi.site.checkout.receiptShareDays' | translate"
                type="number"
                [min]="1"
                [step]="1"
                placeholder="365"
                [(value)]="checkoutSettingsForm.receipt_share_days"
              ></app-input>
            </div>
            <div class="flex items-center gap-2 text-sm">
              <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="checkoutSettingsMessage">{{ checkoutSettingsMessage }}</span>
              <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="checkoutSettingsError">{{ checkoutSettingsError }}</span>
            </div>
          </section>

          <section *ngIf="section() === 'settings'" class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.reports.title' | translate }}</h2>
                <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.reports.hint' | translate }}</p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.reports.weekly.sendNow' | translate"
                  [disabled]="reportsSending"
                  (action)="sendReportNow('weekly')"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.reports.monthly.sendNow' | translate"
                  [disabled]="reportsSending"
                  (action)="sendReportNow('monthly')"
                ></app-button>
                <app-button size="sm" [label]="'adminUi.actions.save' | translate" [disabled]="reportsSending" (action)="saveReportsSettings()"></app-button>
              </div>
            </div>

            <div class="grid lg:grid-cols-2 gap-4">
              <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 grid gap-3 dark:border-slate-800 dark:bg-slate-950/30">
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.reports.weekly.title' | translate }}</div>
                <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" [(ngModel)]="reportsSettingsForm.weekly_enabled" />
                  <span>{{ 'adminUi.reports.weekly.enabled' | translate }}</span>
                </label>
                <div class="grid md:grid-cols-2 gap-3" *ngIf="reportsSettingsForm.weekly_enabled">
                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.reports.weekly.weekday' | translate }}
                    <select
                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="reportsSettingsForm.weekly_weekday"
                    >
                      <option
                        *ngFor="let wd of reportsWeekdays"
                        class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"
                        [value]="wd.value"
                      >
                        {{ wd.labelKey | translate }}
                      </option>
                    </select>
                  </label>
                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.reports.weekly.hourUtc' | translate }}
                    <select
                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="reportsSettingsForm.weekly_hour_utc"
                    >
                      <option
                        *ngFor="let h of reportsHours"
                        class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"
                        [value]="h"
                      >
                        {{ (h < 10 ? '0' + h : h) + ':00' }}
                      </option>
                    </select>
                  </label>
                </div>
                <div class="grid gap-1 text-xs text-slate-500 dark:text-slate-400">
                  <div>
                    {{ 'adminUi.reports.weekly.lastSent' | translate }}:
                    <span *ngIf="reportsWeeklyLastSent; else weeklyNone">{{ reportsWeeklyLastSent | date: 'medium' }}</span>
                    <ng-template #weeklyNone>—</ng-template>
                  </div>
                  <div *ngIf="reportsWeeklyLastError" class="text-rose-700 dark:text-rose-300">
                    {{ 'adminUi.reports.weekly.lastError' | translate }}: {{ reportsWeeklyLastError }}
                  </div>
                </div>
              </div>

              <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 grid gap-3 dark:border-slate-800 dark:bg-slate-950/30">
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.reports.monthly.title' | translate }}</div>
                <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" [(ngModel)]="reportsSettingsForm.monthly_enabled" />
                  <span>{{ 'adminUi.reports.monthly.enabled' | translate }}</span>
                </label>
                <div class="grid md:grid-cols-2 gap-3" *ngIf="reportsSettingsForm.monthly_enabled">
                  <app-input
                    [label]="'adminUi.reports.monthly.day' | translate"
                    type="number"
                    [min]="1"
                    [max]="28"
                    [step]="1"
                    placeholder="1"
                    [(value)]="reportsSettingsForm.monthly_day"
                  ></app-input>
                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.reports.monthly.hourUtc' | translate }}
                    <select
                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="reportsSettingsForm.monthly_hour_utc"
                    >
                      <option
                        *ngFor="let h of reportsHours"
                        class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"
                        [value]="h"
                      >
                        {{ (h < 10 ? '0' + h : h) + ':00' }}
                      </option>
                    </select>
                  </label>
                </div>
                <div class="grid gap-1 text-xs text-slate-500 dark:text-slate-400">
                  <div>
                    {{ 'adminUi.reports.monthly.lastSent' | translate }}:
                    <span *ngIf="reportsMonthlyLastSent; else monthlyNone">{{ reportsMonthlyLastSent | date: 'medium' }}</span>
                    <ng-template #monthlyNone>—</ng-template>
                  </div>
                  <div *ngIf="reportsMonthlyLastError" class="text-rose-700 dark:text-rose-300">
                    {{ 'adminUi.reports.monthly.lastError' | translate }}: {{ reportsMonthlyLastError }}
                  </div>
                </div>
              </div>
            </div>

            <div class="grid gap-2 text-sm">
              <app-input
                [label]="'adminUi.reports.recipients' | translate"
                [placeholder]="'adminUi.reports.recipientsPlaceholder' | translate"
                [(value)]="reportsSettingsForm.recipients"
              ></app-input>
              <div class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.reports.recipientsHint' | translate }}</div>
            </div>

            <div class="flex items-center gap-2 text-sm">
              <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="reportsSettingsMessage">{{ reportsSettingsMessage }}</span>
              <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="reportsSettingsError">{{ reportsSettingsError }}</span>
            </div>
          </section>

          <section *ngIf="section() === 'settings' && cmsAdvanced()" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.site.seo.title' | translate }}</h2>
              <div class="flex gap-2 text-sm">
                <label class="flex items-center gap-2">
                  {{ 'adminUi.site.seo.page' | translate }}
                  <select
                    class="rounded border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="seoPage"
                    (ngModelChange)="loadSeo()"
                  >
                    <option value="home">{{ 'adminUi.site.seo.pages.home' | translate }}</option>
                    <option value="shop">{{ 'adminUi.site.seo.pages.shop' | translate }}</option>
                    <option value="product">{{ 'adminUi.site.seo.pages.product' | translate }}</option>
                    <option value="category">{{ 'adminUi.site.seo.pages.category' | translate }}</option>
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
              <app-input [label]="'adminUi.site.seo.metaTitle' | translate" [(value)]="seoForm.title"></app-input>
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
	              <app-button size="sm" [label]="'adminUi.site.seo.save' | translate" (action)="saveSeo()"></app-button>
	              <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="seoMessage">{{ seoMessage }}</span>
	              <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="seoError">{{ seoError }}</span>
	            </div>

	            <details class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30">
	              <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
	                {{ 'adminUi.site.seo.sitemapPreview.title' | translate }}
	              </summary>
	              <div class="mt-3 grid gap-3">
	                <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.site.seo.sitemapPreview.hint' | translate }}</p>
	                <div class="flex flex-wrap items-center gap-2">
	                  <app-button
	                    size="sm"
	                    variant="ghost"
	                    [disabled]="sitemapPreviewLoading"
	                    [label]="'adminUi.site.seo.sitemapPreview.load' | translate"
	                    (action)="loadSitemapPreview()"
	                  ></app-button>
	                  <span *ngIf="sitemapPreviewError" class="text-xs text-rose-700 dark:text-rose-300">{{ sitemapPreviewError }}</span>
	                </div>
	                <div *ngIf="sitemapPreviewLoading" class="text-sm text-slate-600 dark:text-slate-300">
	                  {{ 'notifications.loading' | translate }}
	                </div>
	                <div *ngIf="!sitemapPreviewLoading && sitemapPreviewByLang" class="grid gap-3 md:grid-cols-2">
	                  <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
	                    <h3 class="font-semibold text-slate-900 dark:text-slate-50">
	                      EN ({{ sitemapPreviewByLang['en']?.length || 0 }})
	                    </h3>
	                    <div class="mt-2 grid gap-1 text-[11px]">
	                      <a
	                        *ngFor="let url of (sitemapPreviewByLang['en'] || [])"
	                        [href]="url"
	                        target="_blank"
	                        rel="noopener noreferrer"
	                        class="truncate text-indigo-600 hover:underline dark:text-indigo-300"
	                      >
	                        {{ url }}
	                      </a>
	                    </div>
	                  </div>
	                  <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
	                    <h3 class="font-semibold text-slate-900 dark:text-slate-50">
	                      RO ({{ sitemapPreviewByLang['ro']?.length || 0 }})
	                    </h3>
	                    <div class="mt-2 grid gap-1 text-[11px]">
	                      <a
	                        *ngFor="let url of (sitemapPreviewByLang['ro'] || [])"
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

	            <details class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30">
	              <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
	                {{ 'adminUi.site.seo.structuredData.title' | translate }}
	              </summary>
	              <div class="mt-3 grid gap-3">
	                <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.site.seo.structuredData.hint' | translate }}</p>
	                <div class="flex flex-wrap items-center gap-2">
	                  <app-button
	                    size="sm"
	                    variant="ghost"
	                    [disabled]="structuredDataLoading"
	                    [label]="'adminUi.site.seo.structuredData.run' | translate"
	                    (action)="runStructuredDataValidation()"
	                  ></app-button>
	                  <span *ngIf="structuredDataError" class="text-xs text-rose-700 dark:text-rose-300">{{ structuredDataError }}</span>
	                </div>
	                <div *ngIf="structuredDataLoading" class="text-sm text-slate-600 dark:text-slate-300">
	                  {{ 'notifications.loading' | translate }}
	                </div>
	                <div *ngIf="!structuredDataLoading && structuredDataResult" class="grid gap-3">
	                  <p class="text-xs text-slate-700 dark:text-slate-200">
	                    {{ 'adminUi.site.seo.structuredData.summary' | translate:{ products: structuredDataResult.checked_products, pages: structuredDataResult.checked_pages, errors: structuredDataResult.errors, warnings: structuredDataResult.warnings } }}
	                  </p>
	                  <div *ngIf="structuredDataResult.issues?.length; else noStructuredDataIssues" class="grid gap-2">
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
	                    <p class="text-sm text-emerald-700 dark:text-emerald-300">{{ 'adminUi.site.seo.structuredData.ok' | translate }}</p>
	                  </ng-template>
	                </div>
	              </div>
	            </details>
	          </section>

          <section *ngIf="section() === 'pages'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.site.pages.title' | translate }}</h2>
              <div class="flex gap-2 text-sm">
                <button
                  type="button"
                  class="px-3 py-1 rounded border"
                  [class.bg-slate-900]="infoLang === 'en'"
                  [class.text-white]="infoLang === 'en'"
                  (click)="selectInfoLang('en')"
                >
                  EN
                </button>
                <button
                  type="button"
                  class="px-3 py-1 rounded border"
                  [class.bg-slate-900]="infoLang === 'ro'"
                  [class.text-white]="infoLang === 'ro'"
                  (click)="selectInfoLang('ro')"
                >
                  RO
                </button>
              </div>
            </div>
            <div class="grid gap-3 text-sm">
              <label class="grid gap-1 font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.site.pages.aboutLabel' | translate }}
                <textarea
                  rows="3"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="infoForm.about[infoLang]"
                ></textarea>
              </label>
              <div class="flex gap-2">
                <app-button size="sm" [label]="'adminUi.site.pages.saveAbout' | translate" (action)="saveInfo('page.about', infoForm.about[infoLang])"></app-button>
              </div>
              <label class="grid gap-1 font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.site.pages.faqLabel' | translate }}
                <textarea
                  rows="3"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="infoForm.faq[infoLang]"
                ></textarea>
              </label>
              <div class="flex gap-2">
                <app-button size="sm" [label]="'adminUi.site.pages.saveFaq' | translate" (action)="saveInfo('page.faq', infoForm.faq[infoLang])"></app-button>
              </div>
              <label class="grid gap-1 font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.site.pages.shippingLabel' | translate }}
                <textarea
                  rows="3"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="infoForm.shipping[infoLang]"
                ></textarea>
              </label>
              <div class="flex gap-2">
                <app-button size="sm" [label]="'adminUi.site.pages.saveShipping' | translate" (action)="saveInfo('page.shipping', infoForm.shipping[infoLang])"></app-button>
              </div>
              <label class="grid gap-1 font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.site.pages.contactLabel' | translate }}
                <textarea
                  rows="3"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="infoForm.contact[infoLang]"
                ></textarea>
              </label>
              <div class="flex gap-2">
                <app-button size="sm" [label]="'adminUi.site.pages.saveContact' | translate" (action)="saveInfo('page.contact', infoForm.contact[infoLang])"></app-button>
                <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="infoMessage">{{ infoMessage }}</span>
                <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="infoError">{{ infoError }}</span>
              </div>

              <details class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30">
                <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                  {{ 'adminUi.site.pages.builder.title' | translate }}
                </summary>
                <div class="mt-3 grid gap-3">
                  <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.site.pages.builder.hint' | translate }}</p>

                  <div class="grid gap-3 md:grid-cols-[1fr_180px_auto] items-end">
                    <app-input [label]="'adminUi.site.pages.builder.newPageTitle' | translate" [(value)]="newCustomPageTitle"></app-input>
                    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                      {{ 'adminUi.site.pages.builder.status' | translate }}
                      <select
                        class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        [(ngModel)]="newCustomPageStatus"
                      >
                        <option [ngValue]="'draft'">{{ 'adminUi.status.draft' | translate }}</option>
                        <option [ngValue]="'review'">{{ 'adminUi.status.review' | translate }}</option>
                        <option [ngValue]="'published'">{{ 'adminUi.status.published' | translate }}</option>
                      </select>
                    </label>
                    <app-button
                      size="sm"
                      [label]="'adminUi.site.pages.builder.createPage' | translate"
                      [disabled]="creatingCustomPage || !(newCustomPageTitle || '').trim()"
                      (action)="createCustomPage()"
                    ></app-button>
                  </div>

                  <div *ngIf="cmsAdvanced()" class="grid gap-3 md:grid-cols-2">
                    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                      {{ 'adminUi.site.pages.builder.publishAtOptional' | translate }}
                      <input
                        type="datetime-local"
                        class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        [(ngModel)]="newCustomPagePublishedAt"
                        [disabled]="newCustomPageStatus !== 'published'"
                      />
                      <span class="text-xs text-slate-500 dark:text-slate-400">
                        {{ 'adminUi.site.pages.builder.publishAtHint' | translate }}
                      </span>
                    </label>
                    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                      {{ 'adminUi.site.pages.builder.unpublishAtOptional' | translate }}
                      <input
                        type="datetime-local"
                        class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        [(ngModel)]="newCustomPagePublishedUntil"
                        [disabled]="newCustomPageStatus !== 'published'"
                      />
                      <span class="text-xs text-slate-500 dark:text-slate-400">
                        {{ 'adminUi.site.pages.builder.unpublishAtHint' | translate }}
                      </span>
                    </label>
                  </div>

                  <div *ngIf="contentPagesError" class="rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
                    {{ contentPagesError }}
                  </div>

                  <div class="grid gap-3 md:grid-cols-[1fr_auto] items-end">
                    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                      {{ 'adminUi.site.pages.builder.page' | translate }}
                      <select
                        class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        [(ngModel)]="pageBlocksKey"
                        (ngModelChange)="onPageBlocksKeyChange($event)"
                      >
                        <ng-container *ngIf="contentPages.length; else defaultPages">
                          <option *ngFor="let p of contentPages" [ngValue]="p.key">
                            {{ p.title || p.slug }} · {{ p.slug }}
                            <ng-container *ngIf="p.needs_translation_en || p.needs_translation_ro">
                              ·
                              <ng-container *ngIf="p.needs_translation_en">EN</ng-container>
                              <ng-container *ngIf="p.needs_translation_en && p.needs_translation_ro">/</ng-container>
                              <ng-container *ngIf="p.needs_translation_ro">RO</ng-container>
                            </ng-container>
                          </option>
                        </ng-container>
                        <ng-template #defaultPages>
                          <option [ngValue]="'page.about'">{{ 'adminUi.site.pages.aboutLabel' | translate }}</option>
                          <option [ngValue]="'page.contact'">{{ 'adminUi.site.pages.contactLabel' | translate }}</option>
                        </ng-template>
                      </select>
                    </label>

                    <div class="flex flex-wrap items-end gap-2">
                      <app-button
                        *ngIf="cmsAdvanced() && canRenamePageKey(pageBlocksKey)"
                        size="sm"
                        variant="ghost"
                        [label]="'adminUi.actions.changeUrl' | translate"
                        (action)="renameCustomPageUrl()"
                      ></app-button>
                      <ng-container *ngIf="cmsAdvanced()">
                        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                          {{ 'adminUi.site.pages.builder.addBlock' | translate }}
                          <select
                            class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            [(ngModel)]="newPageBlockType"
                          >
                            <option [ngValue]="'text'">{{ 'adminUi.home.sections.blocks.text' | translate }}</option>
                            <option [ngValue]="'image'">{{ 'adminUi.home.sections.blocks.image' | translate }}</option>
                            <option [ngValue]="'gallery'">{{ 'adminUi.home.sections.blocks.gallery' | translate }}</option>
                            <option [ngValue]="'banner'">{{ 'adminUi.home.sections.blocks.banner' | translate }}</option>
                            <option [ngValue]="'carousel'">{{ 'adminUi.home.sections.blocks.carousel' | translate }}</option>
                          </select>
                        </label>
                        <app-button size="sm" [label]="'adminUi.actions.add' | translate" (action)="addPageBlock(pageBlocksKey)"></app-button>
                      </ng-container>
                    </div>
                  </div>

                  <app-cms-block-library
                    context="page"
                    (add)="addPageBlockFromLibrary(pageBlocksKey, $event.type, $event.template)"
                    (dragActive)="setPageInsertDragActive($event)"
                  ></app-cms-block-library>

                  <div
                    *ngIf="contentPages.length"
                    class="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white/60 px-3 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200"
                  >
                    <span class="font-semibold">{{ 'adminUi.site.pages.builder.translation.title' | translate }}</span>
                    <label class="flex items-center gap-2">
                      <input
                        type="checkbox"
                        [disabled]="pageBlocksTranslationSaving[pageBlocksKey]"
                        [checked]="pageBlocksNeedsTranslationEn[pageBlocksKey]"
                        (change)="togglePageNeedsTranslation(pageBlocksKey, 'en', $event)"
                      />
                      EN {{ 'adminUi.site.pages.builder.translation.needsLabel' | translate }}
                    </label>
                    <label class="flex items-center gap-2">
                      <input
                        type="checkbox"
                        [disabled]="pageBlocksTranslationSaving[pageBlocksKey]"
                        [checked]="pageBlocksNeedsTranslationRo[pageBlocksKey]"
                        (change)="togglePageNeedsTranslation(pageBlocksKey, 'ro', $event)"
                      />
                      RO {{ 'adminUi.site.pages.builder.translation.needsLabel' | translate }}
                    </label>
                    <span *ngIf="pageBlocksTranslationSaving[pageBlocksKey]" class="text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.site.pages.builder.translation.saving' | translate }}
                    </span>
                  </div>

                  <div class="grid gap-2">
                    <div
                      *ngIf="pageInsertDragActive"
                      class="rounded-xl border border-dashed border-slate-300 bg-white/60 px-3 py-2 text-xs font-semibold text-slate-600 flex items-center justify-center dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-300"
                      (dragover)="onPageBlockDragOver($event)"
                      (drop)="onPageBlockDropZone($event, pageBlocksKey, 0)"
                    >
                      {{ 'adminUi.content.blockLibrary.dropHere' | translate }}
                    </div>

	                  <ng-container *ngFor="let block of (pageBlocks[pageBlocksKey] || []); let i = index">
	                      <div
	                        class="rounded-xl border border-dashed border-slate-300 p-3 text-sm bg-white dark:border-slate-700 dark:bg-slate-900"
	                        draggable="true"
                        (dragstart)="onPageBlockDragStart(pageBlocksKey, block.key)"
                        (dragend)="onPageBlockDragEnd()"
                        (dragover)="onPageBlockDragOver($event)"
                        (drop)="onPageBlockDrop($event, pageBlocksKey, block.key)"
                      >
                        <div class="flex items-start justify-between gap-3">
                          <div class="grid gap-1 min-w-0">
                            <span class="font-semibold text-slate-900 dark:text-slate-50 truncate">
                              {{ ('adminUi.home.sections.blocks.' + block.type) | translate }}
                            </span>
                            <span class="text-[11px] text-slate-500 dark:text-slate-400 truncate">{{ block.type }} · {{ block.key }}</span>
	                          </div>
	                          <div class="flex items-center gap-3 shrink-0">
	                          <label class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
	                            <input type="checkbox" [checked]="block.enabled" (change)="togglePageBlockEnabled(pageBlocksKey, block.key, $event)" />
	                            {{ 'adminUi.home.sections.enabled' | translate }}
	                          </label>
	                          <div class="flex items-center gap-1">
	                            <button
	                              type="button"
	                              class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/40"
	                              [attr.title]="('adminUi.content.reorder.moveUp' | translate) + ': ' + pageBlockLabel(block)"
	                              [attr.aria-label]="('adminUi.content.reorder.moveUp' | translate) + ': ' + pageBlockLabel(block)"
	                              [disabled]="i === 0"
	                              (click)="movePageBlock(pageBlocksKey, block.key, -1)"
	                            >
	                              ↑
	                            </button>
	                            <button
	                              type="button"
	                              class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/40"
	                              [attr.title]="('adminUi.content.reorder.moveDown' | translate) + ': ' + pageBlockLabel(block)"
	                              [attr.aria-label]="('adminUi.content.reorder.moveDown' | translate) + ': ' + pageBlockLabel(block)"
	                              [disabled]="i === (pageBlocks[pageBlocksKey] || []).length - 1"
	                              (click)="movePageBlock(pageBlocksKey, block.key, 1)"
	                            >
	                              ↓
	                            </button>
	                          </div>
	                          <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.home.sections.drag' | translate }}</span>
	                          <app-button size="sm" variant="ghost" [label]="'adminUi.actions.delete' | translate" (action)="removePageBlock(pageBlocksKey, block.key)"></app-button>
	                          </div>
	                        </div>

                      <div class="mt-3 grid gap-3" *ngIf="block.enabled">
                        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                          {{ 'adminUi.home.sections.fields.title' | translate }}
                          <input
                            class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            [(ngModel)]="block.title[infoLang]"
                          />
                        </label>

                        <ng-container [ngSwitch]="block.type">
                          <ng-container *ngSwitchCase="'text'">
                            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                              {{ 'adminUi.home.sections.fields.body' | translate }}
                              <textarea
                                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                rows="4"
                                [(ngModel)]="block.body_markdown[infoLang]"
                              ></textarea>
                            </label>
                            <details class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30">
                              <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                                {{ 'adminUi.home.sections.fields.preview' | translate }}
                              </summary>
                              <div class="mt-2 mx-auto w-full" [ngClass]="cmsPreviewMaxWidthClass()">
                                <div
                                  class="markdown rounded-2xl border border-slate-200 bg-white p-3 text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                                  [innerHTML]="renderMarkdown(block.body_markdown[infoLang] || '')"
                                ></div>
                              </div>
                            </details>
                          </ng-container>

                          <ng-container *ngSwitchCase="'image'">
                            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                              {{ 'adminUi.home.sections.fields.imageUrl' | translate }}
                              <input
                                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                [(ngModel)]="block.url"
                              />
                            </label>
                            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                              {{ 'adminUi.home.sections.fields.linkUrl' | translate }}
                              <input
                                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                [(ngModel)]="block.link_url"
                              />
                            </label>
                            <div class="grid gap-3 sm:grid-cols-2">
                              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                {{ 'adminUi.home.sections.fields.alt' | translate }}
                                <input
                                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                  [(ngModel)]="block.alt[infoLang]"
                                />
                              </label>
                              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                {{ 'adminUi.home.sections.fields.caption' | translate }}
                                <input
                                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                  [(ngModel)]="block.caption[infoLang]"
                                />
                              </label>
                            </div>
                            <div class="grid gap-3 sm:grid-cols-2">
                              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                {{ 'adminUi.home.sections.fields.focalX' | translate }}
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                  [(ngModel)]="block.focal_x"
                                />
                              </label>
                              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                {{ 'adminUi.home.sections.fields.focalY' | translate }}
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                  [(ngModel)]="block.focal_y"
                                />
                              </label>
                            </div>
                            <img
                              *ngIf="(block.url || '').trim()"
                              class="mt-2 w-full max-h-[260px] rounded-2xl border border-slate-200 object-cover dark:border-slate-800"
                              [src]="block.url"
                              [alt]="block.alt[infoLang] || block.title[infoLang] || ''"
                              [style.object-position]="focalPosition(block.focal_x, block.focal_y)"
                              loading="lazy"
                            />
                            <details class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30">
                              <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                                {{ 'adminUi.site.assets.library.title' | translate }}
                              </summary>
                              <div class="mt-3">
                                <app-asset-library
                                  [allowUpload]="true"
                                  [allowSelect]="true"
                                  [uploadKey]="pageBlocksKey"
                                  [initialKey]="pageBlocksKey"
                                  (selectAsset)="setPageImageBlockUrl(pageBlocksKey, block.key, $event)"
                                ></app-asset-library>
                              </div>
                            </details>
                          </ng-container>

                          <ng-container *ngSwitchCase="'gallery'">
                            <div class="flex items-center justify-between">
                              <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                                {{ 'adminUi.home.sections.fields.gallery' | translate }}
                              </p>
                              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.add' | translate" (action)="addPageGalleryImage(pageBlocksKey, block.key)"></app-button>
                            </div>
                            <div *ngIf="block.images.length === 0" class="text-sm text-slate-500 dark:text-slate-400">
                              {{ 'adminUi.home.sections.fields.galleryEmpty' | translate }}
                            </div>
                            <div *ngIf="block.images.length" class="grid gap-3">
                              <div *ngFor="let img of block.images; let idx = index" class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30">
                                <div class="flex items-center justify-between gap-2">
                                  <p class="text-xs font-semibold text-slate-700 dark:text-slate-200">{{ 'adminUi.home.sections.fields.image' | translate }} {{ idx + 1 }}</p>
                                  <app-button size="sm" variant="ghost" [label]="'adminUi.actions.remove' | translate" (action)="removePageGalleryImage(pageBlocksKey, block.key, idx)"></app-button>
                                </div>
                                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  {{ 'adminUi.home.sections.fields.imageUrl' | translate }}
                                  <input
                                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    [(ngModel)]="img.url"
                                  />
                                </label>
                                <div class="grid gap-3 sm:grid-cols-2">
                                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {{ 'adminUi.home.sections.fields.alt' | translate }}
                                    <input
                                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                      [(ngModel)]="img.alt[infoLang]"
                                    />
                                  </label>
                                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {{ 'adminUi.home.sections.fields.caption' | translate }}
                                    <input
                                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                      [(ngModel)]="img.caption[infoLang]"
                                    />
                                  </label>
                                </div>
                                <div class="grid gap-3 sm:grid-cols-2">
                                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {{ 'adminUi.home.sections.fields.focalX' | translate }}
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                      [(ngModel)]="img.focal_x"
                                    />
                                  </label>
                                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {{ 'adminUi.home.sections.fields.focalY' | translate }}
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                      [(ngModel)]="img.focal_y"
                                    />
                                  </label>
                                </div>
                                <div class="flex items-center gap-3">
                                  <img
                                    *ngIf="(img.url || '').trim()"
                                    class="h-16 w-16 rounded-xl border border-slate-200 object-cover dark:border-slate-800"
                                    [src]="img.url"
                                    [alt]="img.alt[infoLang] || ''"
                                    [style.object-position]="focalPosition(img.focal_x, img.focal_y)"
                                    loading="lazy"
                                  />
                                </div>
                              </div>

                              <details class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30">
                                <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                                  {{ 'adminUi.site.assets.library.title' | translate }}
                                </summary>
                                <div class="mt-3">
                                  <app-asset-library
                                    [allowUpload]="true"
                                    [allowSelect]="true"
                                    [uploadKey]="pageBlocksKey"
                                    [initialKey]="pageBlocksKey"
                                    (selectAsset)="addPageGalleryImageFromAsset(pageBlocksKey, block.key, $event)"
                                  ></app-asset-library>
                                </div>
                              </details>
                            </div>
                          </ng-container>

                          <ng-container *ngSwitchCase="'banner'">
                            <div class="grid gap-3">
                              <div class="grid gap-3 md:grid-cols-2">
                                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                                  {{ 'adminUi.home.sections.fields.imageUrl' | translate }}
                                  <input
                                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    [(ngModel)]="block.slide.image_url"
                                  />
                                </label>
                                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  {{ 'adminUi.home.sections.fields.alt' | translate }}
                                  <input
                                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    [(ngModel)]="block.slide.alt[infoLang]"
                                  />
                                </label>
                                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  {{ 'adminUi.home.hero.headline' | translate }}
                                  <input
                                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    [(ngModel)]="block.slide.headline[infoLang]"
                                  />
                                </label>
                                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                                  {{ 'adminUi.home.hero.subtitle' | translate }}
                                  <input
                                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    [(ngModel)]="block.slide.subheadline[infoLang]"
                                  />
                                </label>
                                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  {{ 'adminUi.home.hero.ctaLabel' | translate }}
                                  <input
                                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    [(ngModel)]="block.slide.cta_label[infoLang]"
                                  />
                                </label>
                                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  {{ 'adminUi.home.hero.ctaUrl' | translate }}
                                  <input
                                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    [(ngModel)]="block.slide.cta_url"
                                  />
                                </label>
                                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  {{ 'adminUi.home.sections.fields.focalX' | translate }}
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    [(ngModel)]="block.slide.focal_x"
                                  />
                                </label>
                                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  {{ 'adminUi.home.sections.fields.focalY' | translate }}
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    [(ngModel)]="block.slide.focal_y"
                                  />
                                </label>
                              </div>

                              <div class="grid gap-3 md:grid-cols-3">
                                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  {{ 'adminUi.home.sections.fields.variant' | translate }}
                                  <select
                                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    [(ngModel)]="block.slide.variant"
                                  >
                                    <option [ngValue]="'split'">{{ 'adminUi.home.sections.variants.split' | translate }}</option>
                                    <option [ngValue]="'full'">{{ 'adminUi.home.sections.variants.full' | translate }}</option>
                                  </select>
                                </label>
                                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  {{ 'adminUi.home.sections.fields.size' | translate }}
                                  <select
                                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    [(ngModel)]="block.slide.size"
                                  >
                                    <option [ngValue]="'S'">{{ 'adminUi.home.sections.sizes.s' | translate }}</option>
                                    <option [ngValue]="'M'">{{ 'adminUi.home.sections.sizes.m' | translate }}</option>
                                    <option [ngValue]="'L'">{{ 'adminUi.home.sections.sizes.l' | translate }}</option>
                                  </select>
                                </label>
                                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  {{ 'adminUi.home.sections.fields.textStyle' | translate }}
                                  <select
                                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    [(ngModel)]="block.slide.text_style"
                                  >
                                    <option [ngValue]="'dark'">{{ 'adminUi.home.sections.textStyle.dark' | translate }}</option>
                                    <option [ngValue]="'light'">{{ 'adminUi.home.sections.textStyle.light' | translate }}</option>
                                  </select>
                                </label>
                              </div>

                              <details class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30">
                                <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                                  {{ 'adminUi.site.assets.library.title' | translate }}
                                </summary>
                                <div class="mt-3">
                                  <app-asset-library
                                    [allowUpload]="true"
                                    [allowSelect]="true"
                                    [uploadKey]="pageBlocksKey"
                                    [initialKey]="pageBlocksKey"
                                    (selectAsset)="setPageBannerSlideImage(pageBlocksKey, block.key, $event)"
                                  ></app-asset-library>
                                </div>
                              </details>

                              <details class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30">
                                <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                                  {{ 'adminUi.home.sections.fields.preview' | translate }}
                                </summary>
                                <div class="mt-3">
                                  <app-banner-block [slide]="toPreviewSlide(block.slide, infoLang)"></app-banner-block>
                                </div>
                              </details>
                            </div>
                          </ng-container>

                          <ng-container *ngSwitchCase="'carousel'">
                            <div class="grid gap-3">
                              <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 grid gap-3 dark:border-slate-800 dark:bg-slate-950/30">
                                <div class="flex items-center justify-between">
                                  <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.home.sections.fields.slides' | translate }}</p>
                                  <app-button size="sm" [label]="'adminUi.actions.add' | translate" (action)="addPageCarouselSlide(pageBlocksKey, block.key)"></app-button>
                                </div>
                                <div *ngFor="let slide of block.slides; let idx = index" class="rounded-xl border border-slate-200 bg-white p-3 grid gap-3 dark:border-slate-800 dark:bg-slate-900">
                                  <div class="flex items-center justify-between gap-2">
                                    <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.home.sections.fields.slide' | translate }} {{ idx + 1 }}</p>
                                    <div class="flex items-center gap-2">
                                      <app-button size="sm" variant="ghost" [label]="'adminUi.actions.up' | translate" (action)="movePageCarouselSlide(pageBlocksKey, block.key, idx, -1)"></app-button>
                                      <app-button size="sm" variant="ghost" [label]="'adminUi.actions.down' | translate" (action)="movePageCarouselSlide(pageBlocksKey, block.key, idx, 1)"></app-button>
                                      <app-button size="sm" variant="ghost" [label]="'adminUi.actions.remove' | translate" (action)="removePageCarouselSlide(pageBlocksKey, block.key, idx)"></app-button>
                                    </div>
                                  </div>
                                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {{ 'adminUi.home.sections.fields.imageUrl' | translate }}
                                    <input
                                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                      [(ngModel)]="slide.image_url"
                                    />
                                  </label>
                                  <div class="grid gap-3 md:grid-cols-2">
                                    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                      {{ 'adminUi.home.sections.fields.alt' | translate }}
                                      <input
                                        class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                        [(ngModel)]="slide.alt[infoLang]"
                                      />
                                    </label>
                                    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                      {{ 'adminUi.home.hero.headline' | translate }}
                                      <input
                                        class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                        [(ngModel)]="slide.headline[infoLang]"
                                      />
                                    </label>
                                    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                                      {{ 'adminUi.home.hero.subtitle' | translate }}
                                      <input
                                        class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                        [(ngModel)]="slide.subheadline[infoLang]"
                                      />
                                    </label>
                                    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                      {{ 'adminUi.home.sections.fields.focalX' | translate }}
                                      <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                        [(ngModel)]="slide.focal_x"
                                      />
                                    </label>
                                    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                      {{ 'adminUi.home.sections.fields.focalY' | translate }}
                                      <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                        [(ngModel)]="slide.focal_y"
                                      />
                                    </label>
                                  </div>
                                  <details class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30">
                                    <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                                      {{ 'adminUi.site.assets.library.title' | translate }}
                                    </summary>
                                    <div class="mt-3">
                                      <app-asset-library
                                        [allowUpload]="true"
                                        [allowSelect]="true"
                                        [uploadKey]="pageBlocksKey"
                                        [initialKey]="pageBlocksKey"
                                        (selectAsset)="setPageCarouselSlideImage(pageBlocksKey, block.key, idx, $event)"
                                      ></app-asset-library>
                                    </div>
                                  </details>
                                </div>
                              </div>

                              <div class="grid gap-3 md:grid-cols-2">
                                <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  <input type="checkbox" [(ngModel)]="block.settings.autoplay" />
                                  <span>{{ 'adminUi.home.sections.fields.autoplay' | translate }}</span>
                                </label>
                                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  {{ 'adminUi.home.sections.fields.interval' | translate }}
                                  <input
                                    type="number"
                                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    [(ngModel)]="block.settings.interval_ms"
                                    [disabled]="!block.settings.autoplay"
                                  />
                                </label>
                                <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  <input type="checkbox" [(ngModel)]="block.settings.show_arrows" />
                                  <span>{{ 'adminUi.home.sections.fields.arrows' | translate }}</span>
                                </label>
                                <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  <input type="checkbox" [(ngModel)]="block.settings.show_dots" />
                                  <span>{{ 'adminUi.home.sections.fields.dots' | translate }}</span>
                                </label>
                              </div>

                              <details class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30">
                                <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                                  {{ 'adminUi.home.sections.fields.preview' | translate }}
                                </summary>
                                <div class="mt-3">
                                  <app-carousel-block [slides]="toPreviewSlides(block.slides, infoLang)" [settings]="block.settings"></app-carousel-block>
                                </div>
                              </details>
                            </div>
                          </ng-container>
                        </ng-container>
                      </div>
                    </div>

                    <div
                      *ngIf="pageInsertDragActive"
                      class="rounded-xl border border-dashed border-slate-300 bg-white/60 px-3 py-2 text-xs font-semibold text-slate-600 flex items-center justify-center dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-300"
                      (dragover)="onPageBlockDragOver($event)"
                      (drop)="onPageBlockDropZone($event, pageBlocksKey, i + 1)"
                    >
                      {{ 'adminUi.content.blockLibrary.dropHere' | translate }}
                    </div>
                  </ng-container>
                  </div>

                <div class="grid gap-3 md:grid-cols-3 items-end">
                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.site.pages.builder.status' | translate }}
                    <select
                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="pageBlocksStatus[pageBlocksKey]"
                    >
                      <option [ngValue]="'draft'">{{ 'adminUi.status.draft' | translate }}</option>
                      <option [ngValue]="'review'">{{ 'adminUi.status.review' | translate }}</option>
                      <option [ngValue]="'published'">{{ 'adminUi.status.published' | translate }}</option>
                    </select>
                  </label>
                  <label *ngIf="cmsAdvanced()" class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.site.pages.builder.publishAtOptional' | translate }}
                    <input
                      type="datetime-local"
                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="pageBlocksPublishedAt[pageBlocksKey]"
                      [disabled]="pageBlocksStatus[pageBlocksKey] !== 'published'"
                    />
                  </label>
                  <label *ngIf="cmsAdvanced()" class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.site.pages.builder.unpublishAtOptional' | translate }}
                    <input
                      type="datetime-local"
                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="pageBlocksPublishedUntil[pageBlocksKey]"
                      [disabled]="pageBlocksStatus[pageBlocksKey] !== 'published'"
                    />
                  </label>
                </div>

	                <div *ngIf="cmsAdvanced()" class="grid gap-1">
	                  <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
	                    <input type="checkbox" [(ngModel)]="pageBlocksRequiresAuth[pageBlocksKey]" />
	                    <span>{{ 'adminUi.site.pages.builder.requiresLogin' | translate }}</span>
	                  </label>
	                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.site.pages.builder.requiresLoginHint' | translate }}</p>
	                </div>

	                <div
	                  *ngIf="pageDraftHasRestore(pageBlocksKey)"
	                  class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
	                >
	                  <div class="flex flex-wrap items-center gap-2">
	                    <span class="font-semibold">{{ 'adminUi.content.autosave.restoreFound' | translate }}</span>
	                    <span *ngIf="pageDraftRestoreAt(pageBlocksKey)" class="text-amber-700 dark:text-amber-200">
	                      {{ pageDraftRestoreAt(pageBlocksKey) | date: 'short' }}
	                    </span>
	                  </div>
	                  <div class="flex flex-wrap items-center gap-2">
	                    <app-button
	                      size="sm"
	                      variant="ghost"
	                      [label]="'adminUi.actions.restore' | translate"
	                      (action)="restorePageDraftAutosave(pageBlocksKey)"
	                    ></app-button>
	                    <app-button
	                      size="sm"
	                      variant="ghost"
	                      [label]="'adminUi.actions.dismiss' | translate"
	                      (action)="dismissPageDraftAutosave(pageBlocksKey)"
	                    ></app-button>
	                  </div>
	                </div>

	                <div class="flex flex-wrap items-center gap-2">
	                  <app-button
	                    size="sm"
	                    variant="ghost"
	                    [label]="'adminUi.actions.undo' | translate"
	                    [disabled]="!pageDraftCanUndo(pageBlocksKey)"
	                    (action)="undoPageDraft(pageBlocksKey)"
	                  ></app-button>
	                  <app-button
	                    size="sm"
	                    variant="ghost"
	                    [label]="'adminUi.actions.redo' | translate"
	                    [disabled]="!pageDraftCanRedo(pageBlocksKey)"
	                    (action)="redoPageDraft(pageBlocksKey)"
	                  ></app-button>
	                  <app-button size="sm" [label]="'adminUi.actions.save' | translate" (action)="savePageBlocks(pageBlocksKey)"></app-button>
	                  <span *ngIf="pageDraftReady(pageBlocksKey)" class="text-xs text-slate-500 dark:text-slate-400">
	                    <ng-container *ngIf="!pageDraftDirty(pageBlocksKey)">
	                      {{ 'adminUi.content.autosave.state.saved' | translate }}
	                    </ng-container>
	                    <ng-container *ngIf="pageDraftDirty(pageBlocksKey) && pageDraftAutosaving(pageBlocksKey)">
	                      {{ 'adminUi.content.autosave.state.autosaving' | translate }}
	                    </ng-container>
	                    <ng-container
	                      *ngIf="
	                        pageDraftDirty(pageBlocksKey) &&
	                        !pageDraftAutosaving(pageBlocksKey) &&
	                        pageDraftLastAutosavedAt(pageBlocksKey)
	                      "
	                    >
	                      {{ 'adminUi.content.autosave.state.autosaved' | translate }}
	                      {{ pageDraftLastAutosavedAt(pageBlocksKey) | date: 'shortTime' }}
	                    </ng-container>
	                    <ng-container
	                      *ngIf="
	                        pageDraftDirty(pageBlocksKey) &&
	                        !pageDraftAutosaving(pageBlocksKey) &&
	                        !pageDraftLastAutosavedAt(pageBlocksKey)
	                      "
	                    >
	                      {{ 'adminUi.content.autosave.state.unsaved' | translate }}
	                    </ng-container>
	                  </span>
	                  <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="pageBlocksMessage[pageBlocksKey]">
	                    {{ pageBlocksMessage[pageBlocksKey] }}
	                  </span>
	                  <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="pageBlocksError[pageBlocksKey]">
	                    {{ pageBlocksError[pageBlocksKey] }}
	                  </span>
	                </div>
	                </div>
	              </details>

              <details *ngIf="cmsAdvanced()" class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30">
                <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                  {{ 'adminUi.site.pages.redirects.title' | translate }}
                </summary>
                <div class="mt-3 grid gap-3">
                  <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.site.pages.redirects.hint' | translate }}</p>

                  <div class="flex flex-wrap gap-2 items-end">
                    <app-input [label]="'adminUi.site.pages.redirects.search' | translate" [(value)]="redirectsQuery"></app-input>
                    <app-button size="sm" variant="ghost" [label]="'adminUi.actions.search' | translate" (action)="loadContentRedirects(true)"></app-button>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.site.pages.redirects.export' | translate"
                      [disabled]="redirectsExporting"
                      (action)="exportContentRedirects()"
                    ></app-button>
                    <label class="grid gap-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                      {{ 'adminUi.site.pages.redirects.import' | translate }}
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:file:bg-slate-700 dark:file:text-slate-100"
                        [disabled]="redirectsImporting"
                        (change)="importContentRedirects($event)"
                      />
                    </label>
                  </div>
                  <div *ngIf="redirectsImportResult" class="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                    <p class="font-semibold">{{ 'adminUi.site.pages.redirects.importResult' | translate:{ created: redirectsImportResult.created, updated: redirectsImportResult.updated, skipped: redirectsImportResult.skipped } }}</p>
                    <div *ngIf="redirectsImportResult.errors?.length" class="mt-1 grid gap-1">
                      <p class="text-rose-700 dark:text-rose-300">{{ 'adminUi.site.pages.redirects.importErrors' | translate }}</p>
                      <p *ngFor="let e of redirectsImportResult.errors" class="text-[11px] text-rose-700 dark:text-rose-300">
                        #{{ e.line }}: {{ e.error }}
                      </p>
                      </div>
                  </div>

                  <div *ngIf="redirectsError" class="rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
                    {{ redirectsError }}
                  </div>

                  <div *ngIf="redirectsLoading" class="text-sm text-slate-600 dark:text-slate-300">
                    {{ 'notifications.loading' | translate }}
                  </div>

                  <div *ngIf="!redirectsLoading && !redirectsError && redirects.length === 0" class="text-sm text-slate-600 dark:text-slate-300">
                    {{ 'adminUi.site.pages.redirects.empty' | translate }}
                  </div>

                  <div *ngIf="!redirectsLoading && redirects.length" class="grid gap-2">
                    <div
                      *ngFor="let r of redirects"
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div class="min-w-0">
                        <p class="text-sm font-medium text-slate-900 dark:text-slate-50 truncate">
                          <span class="font-mono">{{ redirectKeyToUrl(r.from_key) }}</span>
                          <span class="mx-2 text-slate-500 dark:text-slate-400">→</span>
                          <span class="font-mono">{{ redirectKeyToUrl(r.to_key) }}</span>
                        </p>
                        <p *ngIf="!r.target_exists" class="text-xs text-rose-700 dark:text-rose-300">
                          {{ 'adminUi.site.pages.redirects.stale' | translate }}
                        </p>
                        <p *ngIf="r.chain_error === 'loop'" class="text-xs text-rose-700 dark:text-rose-300">
                          {{ 'adminUi.site.pages.redirects.loop' | translate }}
                        </p>
                        <p *ngIf="r.chain_error === 'too_deep'" class="text-xs text-amber-800 dark:text-amber-200">
                          {{ 'adminUi.site.pages.redirects.tooDeep' | translate }}
                        </p>
                        <p class="text-[11px] text-slate-500 dark:text-slate-400">{{ r.created_at | date: 'short' }}</p>
                      </div>
                      <app-button size="sm" variant="ghost" [label]="'adminUi.actions.delete' | translate" (action)="deleteContentRedirect(r.id)"></app-button>
                    </div>
                  </div>

                  <div *ngIf="redirectsMeta.total_pages > 1" class="flex items-center gap-2">
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.actions.prev' | translate"
                      [disabled]="redirectsMeta.page <= 1"
                      (action)="setRedirectsPage(redirectsMeta.page - 1)"
                    ></app-button>
                    <span class="text-xs text-slate-600 dark:text-slate-300">
                      {{ redirectsMeta.page }} / {{ redirectsMeta.total_pages }}
                    </span>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.actions.next' | translate"
                      [disabled]="redirectsMeta.page >= redirectsMeta.total_pages"
                      (action)="setRedirectsPage(redirectsMeta.page + 1)"
                    ></app-button>
                  </div>
                </div>
              </details>

              <details class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30">
                <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                  {{ 'adminUi.content.revisions.title' | translate }}
                </summary>
                <div class="mt-3 grid gap-3">
                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.content.revisions.select' | translate }}
                    <select
                      class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="pagesRevisionKey"
                    >
                      <option [ngValue]="'page.about'">{{ 'adminUi.site.pages.aboutLabel' | translate }}</option>
                      <option [ngValue]="'page.faq'">{{ 'adminUi.site.pages.faqLabel' | translate }}</option>
                      <option [ngValue]="'page.shipping'">{{ 'adminUi.site.pages.shippingLabel' | translate }}</option>
                      <option [ngValue]="'page.contact'">{{ 'adminUi.site.pages.contactLabel' | translate }}</option>
                    </select>
                  </label>
                  <app-content-revisions [contentKey]="pagesRevisionKey" [titleKey]="pagesRevisionTitleKey()"></app-content-revisions>
                </div>
              </details>

              <details class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30">
                <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                  {{ 'adminUi.content.linkCheck.title' | translate }}
                </summary>
                <div class="mt-3 grid gap-3">
                  <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.content.linkCheck.hint' | translate }}</p>

                  <div class="flex flex-wrap gap-2 items-end">
                    <app-input [label]="'adminUi.content.linkCheck.key' | translate" [(value)]="linkCheckKey"></app-input>
                    <app-button size="sm" [label]="'adminUi.content.linkCheck.run' | translate" (action)="runLinkCheck()"></app-button>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.content.linkCheck.useSelectedPage' | translate"
                      (action)="runLinkCheck(pageBlocksKey)"
                    ></app-button>
                  </div>

                  <div *ngIf="linkCheckError" class="rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
                    {{ linkCheckError }}
                  </div>

                  <div *ngIf="linkCheckLoading" class="text-sm text-slate-600 dark:text-slate-300">
                    {{ 'adminUi.content.linkCheck.loading' | translate }}
                  </div>

                  <div *ngIf="!linkCheckLoading && !linkCheckError && linkCheckIssues.length === 0" class="text-sm text-slate-600 dark:text-slate-300">
                    {{ 'adminUi.content.linkCheck.empty' | translate }}
                  </div>

                  <div *ngIf="!linkCheckLoading && linkCheckIssues.length" class="grid gap-2">
                    <div
                      *ngFor="let issue of linkCheckIssues"
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <p class="text-sm font-medium text-slate-900 dark:text-slate-50">{{ issue.reason }}</p>
                      <p class="mt-1 text-xs text-slate-600 dark:text-slate-300 font-mono break-all">{{ issue.url }}</p>
                      <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        {{ issue.kind }} · {{ issue.source }} · {{ issue.field }}
                      </p>
                    </div>
                  </div>
                </div>
              </details>
            </div>
          </section>

          <section *ngIf="section() === 'home'" class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="grid gap-1">
                <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.home.sections.title' | translate }}</h2>
                <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.home.sections.hint' | translate }}</p>
              </div>
	              <div class="flex flex-wrap items-center gap-2 text-sm">
	                <div class="flex gap-2">
	                  <button
	                    class="px-3 py-1 rounded border"
                    [class.bg-slate-900]="homeBlocksLang === 'en'"
                    [class.text-white]="homeBlocksLang === 'en'"
                    (click)="selectHomeBlocksLang('en')"
                    type="button"
                  >
                    EN
                  </button>
                  <button
                    class="px-3 py-1 rounded border"
                    [class.bg-slate-900]="homeBlocksLang === 'ro'"
                    [class.text-white]="homeBlocksLang === 'ro'"
                    (click)="selectHomeBlocksLang('ro')"
                    type="button"
                  >
	                    RO
	                  </button>
	                </div>
	                <app-button
	                  size="sm"
	                  variant="ghost"
	                  [label]="'adminUi.actions.undo' | translate"
	                  [disabled]="!homeDraftCanUndo()"
	                  (action)="undoHomeDraft()"
	                ></app-button>
	                <app-button
	                  size="sm"
	                  variant="ghost"
	                  [label]="'adminUi.actions.redo' | translate"
	                  [disabled]="!homeDraftCanRedo()"
	                  (action)="redoHomeDraft()"
	                ></app-button>
	                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.save' | translate" (action)="saveSections()"></app-button>
	                <span *ngIf="homeDraftReady()" class="text-xs text-slate-500 dark:text-slate-400">
	                  <ng-container *ngIf="!homeDraftDirty()">
	                    {{ 'adminUi.content.autosave.state.saved' | translate }}
	                  </ng-container>
	                  <ng-container *ngIf="homeDraftDirty() && homeDraftAutosaving()">
	                    {{ 'adminUi.content.autosave.state.autosaving' | translate }}
	                  </ng-container>
	                  <ng-container *ngIf="homeDraftDirty() && !homeDraftAutosaving() && homeDraftLastAutosavedAt()">
	                    {{ 'adminUi.content.autosave.state.autosaved' | translate }} {{ homeDraftLastAutosavedAt() | date: 'shortTime' }}
	                  </ng-container>
	                  <ng-container *ngIf="homeDraftDirty() && !homeDraftAutosaving() && !homeDraftLastAutosavedAt()">
	                    {{ 'adminUi.content.autosave.state.unsaved' | translate }}
	                  </ng-container>
	                </span>
	              </div>
	            </div>

	            <div
	              *ngIf="homeDraftHasRestore()"
	              class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
	            >
	              <div class="flex flex-wrap items-center gap-2">
	                <span class="font-semibold">{{ 'adminUi.content.autosave.restoreFound' | translate }}</span>
	                <span *ngIf="homeDraftRestoreAt()" class="text-amber-700 dark:text-amber-200">{{ homeDraftRestoreAt() | date: 'short' }}</span>
	              </div>
	              <div class="flex flex-wrap items-center gap-2">
	                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.restore' | translate" (action)="restoreHomeDraftAutosave()"></app-button>
	                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.dismiss' | translate" (action)="dismissHomeDraftAutosave()"></app-button>
	              </div>
	            </div>

	            <app-cms-block-library
	              context="home"
	              (add)="addHomeBlockFromLibrary($event.type, $event.template)"
	              (dragActive)="setHomeInsertDragActive($event)"
            ></app-cms-block-library>

            <div *ngIf="cmsAdvanced()" class="grid gap-3 md:grid-cols-[1fr_auto] items-end">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.home.sections.addBlock' | translate }}
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="newHomeBlockType"
                >
                  <option [ngValue]="'text'">{{ 'adminUi.home.sections.blocks.text' | translate }}</option>
                  <option [ngValue]="'image'">{{ 'adminUi.home.sections.blocks.image' | translate }}</option>
                  <option [ngValue]="'gallery'">{{ 'adminUi.home.sections.blocks.gallery' | translate }}</option>
                  <option [ngValue]="'banner'">{{ 'adminUi.home.sections.blocks.banner' | translate }}</option>
                  <option [ngValue]="'carousel'">{{ 'adminUi.home.sections.blocks.carousel' | translate }}</option>
                </select>
              </label>
              <app-button size="sm" [label]="'adminUi.actions.add' | translate" (action)="addHomeBlock()"></app-button>
            </div>

            <div class="grid gap-2">
              <div
                *ngIf="homeInsertDragActive"
                class="rounded-xl border border-dashed border-slate-300 bg-white/60 px-3 py-2 text-xs font-semibold text-slate-600 flex items-center justify-center dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-300"
                (dragover)="onHomeBlockDragOver($event)"
                (drop)="onHomeBlockDropZone($event, 0)"
              >
                {{ 'adminUi.content.blockLibrary.dropHere' | translate }}
              </div>

	              <ng-container *ngFor="let block of homeBlocks; let i = index">
	                <div
	                  class="rounded-xl border border-dashed border-slate-300 p-3 text-sm bg-slate-50 dark:border-slate-700 dark:bg-slate-950/30"
	                  draggable="true"
                  (dragstart)="onHomeBlockDragStart(block.key)"
                  (dragend)="onHomeBlockDragEnd()"
                  (dragover)="onHomeBlockDragOver($event)"
                  (drop)="onHomeBlockDrop($event, block.key)"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="grid gap-1 min-w-0">
                      <span class="font-semibold text-slate-900 dark:text-slate-50 truncate">{{ homeBlockLabel(block) }}</span>
                      <span class="text-[11px] text-slate-500 dark:text-slate-400 truncate">{{ block.type }} · {{ block.key }}</span>
	                    </div>
	                    <div class="flex items-center gap-3 shrink-0">
	                      <label class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
	                        <input type="checkbox" [checked]="block.enabled" (change)="toggleHomeBlockEnabled(block, $event)" />
	                        {{ 'adminUi.home.sections.enabled' | translate }}
	                      </label>
	                      <div class="flex items-center gap-1">
	                        <button
	                          type="button"
	                          class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/40"
	                          [attr.title]="('adminUi.content.reorder.moveUp' | translate) + ': ' + homeBlockLabel(block)"
	                          [attr.aria-label]="('adminUi.content.reorder.moveUp' | translate) + ': ' + homeBlockLabel(block)"
	                          [disabled]="i === 0"
	                          (click)="moveHomeBlock(block.key, -1)"
	                        >
	                          ↑
	                        </button>
	                        <button
	                          type="button"
	                          class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/40"
	                          [attr.title]="('adminUi.content.reorder.moveDown' | translate) + ': ' + homeBlockLabel(block)"
	                          [attr.aria-label]="('adminUi.content.reorder.moveDown' | translate) + ': ' + homeBlockLabel(block)"
	                          [disabled]="i === homeBlocks.length - 1"
	                          (click)="moveHomeBlock(block.key, 1)"
	                        >
	                          ↓
	                        </button>
	                      </div>
	                      <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.home.sections.drag' | translate }}</span>
	                      <app-button
	                        *ngIf="isCustomHomeBlock(block)"
	                        size="sm"
                        variant="ghost"
                        [label]="'adminUi.actions.delete' | translate"
                        (action)="removeHomeBlock(block.key)"
                      ></app-button>
                    </div>
                  </div>

                <ng-container *ngIf="isCustomHomeBlock(block)">
                  <div class="mt-3 grid gap-3">
                    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                      {{ 'adminUi.home.sections.fields.title' | translate }}
                      <input
                        class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        [(ngModel)]="block.title[homeBlocksLang]"
                      />
                    </label>

                    <ng-container [ngSwitch]="block.type">
                      <ng-container *ngSwitchCase="'text'">
                        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                          {{ 'adminUi.home.sections.fields.body' | translate }}
                          <textarea
                            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            rows="5"
                            [(ngModel)]="block.body_markdown[homeBlocksLang]"
                          ></textarea>
                        </label>
                        <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                          <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.home.sections.fields.preview' | translate }}</p>
                          <div class="mt-2 mx-auto w-full" [ngClass]="cmsPreviewMaxWidthClass()">
                            <div
                              class="markdown rounded-2xl border border-slate-200 bg-white p-3 text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                              [innerHTML]="renderMarkdown(block.body_markdown[homeBlocksLang])"
                            ></div>
                          </div>
                        </div>
                      </ng-container>

                      <ng-container *ngSwitchCase="'image'">
                        <div class="grid gap-3 md:grid-cols-2">
                          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                            {{ 'adminUi.home.sections.fields.imageUrl' | translate }}
                            <input
                              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                              [(ngModel)]="block.url"
                            />
                          </label>
                          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                            {{ 'adminUi.home.sections.fields.linkUrl' | translate }}
                            <input
                              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                              [(ngModel)]="block.link_url"
                            />
                          </label>
                          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                            {{ 'adminUi.home.sections.fields.alt' | translate }}
                            <input
                              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                              [(ngModel)]="block.alt[homeBlocksLang]"
                            />
                          </label>
                          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                            {{ 'adminUi.home.sections.fields.caption' | translate }}
                            <input
                              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                              [(ngModel)]="block.caption[homeBlocksLang]"
                            />
                          </label>
                          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                            {{ 'adminUi.home.sections.fields.focalX' | translate }}
                            <input
                              type="number"
                              min="0"
                              max="100"
                              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                              [(ngModel)]="block.focal_x"
                            />
                          </label>
                          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                            {{ 'adminUi.home.sections.fields.focalY' | translate }}
                            <input
                              type="number"
                              min="0"
                              max="100"
                              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                              [(ngModel)]="block.focal_y"
                            />
                          </label>
                        </div>

                        <details class="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                          <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                            {{ 'adminUi.site.assets.library.title' | translate }}
                          </summary>
                          <div class="mt-3">
                            <app-asset-library
                              [allowUpload]="true"
                              [allowSelect]="true"
                              [initialKey]="'site.assets'"
                              (selectAsset)="setImageBlockUrl(block.key, $event)"
                            ></app-asset-library>
                          </div>
                        </details>

                        <div *ngIf="block.url" class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                          <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.home.sections.fields.preview' | translate }}</p>
                          <img
                            class="mt-3 w-full max-h-[260px] rounded-2xl object-cover"
                            [src]="block.url"
                            [alt]="block.alt[homeBlocksLang] || block.title[homeBlocksLang] || ''"
                            [style.object-position]="focalPosition(block.focal_x, block.focal_y)"
                            loading="lazy"
                          />
                        </div>
                      </ng-container>

                      <ng-container *ngSwitchCase="'gallery'">
                        <div class="grid gap-3">
                          <div class="flex items-center justify-between">
                            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.home.sections.fields.gallery' | translate }}</p>
                            <app-button size="sm" variant="ghost" [label]="'adminUi.actions.add' | translate" (action)="addGalleryImage(block.key)"></app-button>
                          </div>

                          <div *ngIf="block.images.length === 0" class="text-sm text-slate-600 dark:text-slate-300">
                            {{ 'adminUi.home.sections.fields.galleryEmpty' | translate }}
                          </div>

                          <div *ngIf="block.images.length > 0" class="grid gap-2">
                            <div *ngFor="let img of block.images; let idx = index" class="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                              <div class="flex items-center justify-between gap-3">
                                <span class="text-xs font-semibold text-slate-700 dark:text-slate-200">{{ 'adminUi.home.sections.fields.image' | translate }} {{ idx + 1 }}</span>
                                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.delete' | translate" (action)="removeGalleryImage(block.key, idx)"></app-button>
                              </div>
                              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                {{ 'adminUi.home.sections.fields.imageUrl' | translate }}
                                <input
                                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                  [(ngModel)]="img.url"
                                />
                              </label>
                              <div class="grid gap-3 md:grid-cols-2">
                                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  {{ 'adminUi.home.sections.fields.alt' | translate }}
                                  <input
                                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    [(ngModel)]="img.alt[homeBlocksLang]"
                                  />
                                </label>
                                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  {{ 'adminUi.home.sections.fields.caption' | translate }}
                                  <input
                                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    [(ngModel)]="img.caption[homeBlocksLang]"
                                  />
                                </label>
                                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  {{ 'adminUi.home.sections.fields.focalX' | translate }}
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    [(ngModel)]="img.focal_x"
                                  />
                                </label>
                                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  {{ 'adminUi.home.sections.fields.focalY' | translate }}
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    [(ngModel)]="img.focal_y"
                                  />
                                </label>
                              </div>
                              <div *ngIf="img.url" class="flex items-center gap-3">
                                <img
                                  class="h-16 w-16 rounded-xl object-cover"
                                  [src]="img.url"
                                  [alt]="img.alt[homeBlocksLang] || ''"
                                  [style.object-position]="focalPosition(img.focal_x, img.focal_y)"
                                  loading="lazy"
                                />
                                <span class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ img.url }}</span>
                              </div>
                            </div>
                          </div>

                          <details class="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                            <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                              {{ 'adminUi.site.assets.library.title' | translate }}
                            </summary>
                            <div class="mt-3">
                              <app-asset-library
                                [allowUpload]="true"
                                [allowSelect]="true"
                                [initialKey]="'site.assets'"
                                (selectAsset)="addGalleryImageFromAsset(block.key, $event)"
                              ></app-asset-library>
                            </div>
                          </details>
                        </div>
                      </ng-container>

                      <ng-container *ngSwitchCase="'banner'">
                        <div class="grid gap-3">
                          <div class="grid gap-3 md:grid-cols-2">
                            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                              {{ 'adminUi.home.sections.fields.imageUrl' | translate }}
                              <input
                                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                [(ngModel)]="block.slide.image_url"
                              />
                            </label>
                            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                              {{ 'adminUi.home.sections.fields.alt' | translate }}
                              <input
                                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                [(ngModel)]="block.slide.alt[homeBlocksLang]"
                              />
                            </label>
                            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                              {{ 'adminUi.home.hero.headline' | translate }}
                              <input
                                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                [(ngModel)]="block.slide.headline[homeBlocksLang]"
                              />
                            </label>
                            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                              {{ 'adminUi.home.hero.subtitle' | translate }}
                              <input
                                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                [(ngModel)]="block.slide.subheadline[homeBlocksLang]"
                              />
                            </label>
                            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                              {{ 'adminUi.home.hero.ctaLabel' | translate }}
                              <input
                                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                [(ngModel)]="block.slide.cta_label[homeBlocksLang]"
                              />
                            </label>
                            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                              {{ 'adminUi.home.hero.ctaUrl' | translate }}
                              <input
                                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                [(ngModel)]="block.slide.cta_url"
                              />
                            </label>
                            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                              {{ 'adminUi.home.sections.fields.focalX' | translate }}
                              <input
                                type="number"
                                min="0"
                                max="100"
                                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                [(ngModel)]="block.slide.focal_x"
                              />
                            </label>
                            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                              {{ 'adminUi.home.sections.fields.focalY' | translate }}
                              <input
                                type="number"
                                min="0"
                                max="100"
                                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                [(ngModel)]="block.slide.focal_y"
                              />
                            </label>
                          </div>

                          <div class="grid gap-3 md:grid-cols-3">
                            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                              {{ 'adminUi.home.sections.fields.variant' | translate }}
                              <select
                                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                [(ngModel)]="block.slide.variant"
                              >
                                <option [ngValue]="'split'">{{ 'adminUi.home.sections.variants.split' | translate }}</option>
                                <option [ngValue]="'full'">{{ 'adminUi.home.sections.variants.full' | translate }}</option>
                              </select>
                            </label>
                            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                              {{ 'adminUi.home.sections.fields.size' | translate }}
                              <select
                                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                [(ngModel)]="block.slide.size"
                              >
                                <option [ngValue]="'S'">{{ 'adminUi.home.sections.sizes.s' | translate }}</option>
                                <option [ngValue]="'M'">{{ 'adminUi.home.sections.sizes.m' | translate }}</option>
                                <option [ngValue]="'L'">{{ 'adminUi.home.sections.sizes.l' | translate }}</option>
                              </select>
                            </label>
                            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                              {{ 'adminUi.home.sections.fields.textStyle' | translate }}
                              <select
                                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                [(ngModel)]="block.slide.text_style"
                              >
                                <option [ngValue]="'dark'">{{ 'adminUi.home.sections.textStyle.dark' | translate }}</option>
                                <option [ngValue]="'light'">{{ 'adminUi.home.sections.textStyle.light' | translate }}</option>
                              </select>
                            </label>
                          </div>

                          <details class="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                            <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                              {{ 'adminUi.site.assets.library.title' | translate }}
                            </summary>
                            <div class="mt-3">
                              <app-asset-library
                                [allowUpload]="true"
                                [allowSelect]="true"
                                [initialKey]="'site.assets'"
                                (selectAsset)="setBannerSlideImage(block.key, $event)"
                              ></app-asset-library>
                            </div>
                          </details>

                          <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.home.sections.fields.preview' | translate }}</p>
                            <app-banner-block
                              class="mt-3"
                              [slide]="toPreviewSlide(block.slide)"
                              [tagline]="homeBlocksLang === 'en' ? 'art. handcrafted' : 'artă. meșteșug'"
                            ></app-banner-block>
                          </div>
                        </div>
                      </ng-container>

                      <ng-container *ngSwitchCase="'carousel'">
                        <div class="grid gap-3">
                          <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.home.sections.fields.slides' | translate }}</p>
                            <div class="mt-3 grid gap-3">
                              <div
                                *ngFor="let slide of block.slides; let idx = index"
                                class="rounded-xl border border-slate-200 bg-slate-50 p-3 grid gap-3 dark:border-slate-800 dark:bg-slate-950/30"
                              >
                                <div class="flex items-center justify-between gap-2">
                                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                                    {{ 'adminUi.home.sections.fields.slide' | translate }} {{ idx + 1 }}
                                  </p>
                                  <div class="flex items-center gap-2">
                                    <app-button size="sm" variant="ghost" [label]="'adminUi.actions.up' | translate" (action)="moveCarouselSlide(block.key, idx, -1)"></app-button>
                                    <app-button size="sm" variant="ghost" [label]="'adminUi.actions.down' | translate" (action)="moveCarouselSlide(block.key, idx, 1)"></app-button>
                                    <app-button size="sm" variant="ghost" [label]="'adminUi.actions.delete' | translate" (action)="removeCarouselSlide(block.key, idx)"></app-button>
                                  </div>
                                </div>

                                <div class="grid gap-3 md:grid-cols-2">
                                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                                    {{ 'adminUi.home.sections.fields.imageUrl' | translate }}
                                    <input
                                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                      [(ngModel)]="slide.image_url"
                                    />
                                  </label>
                                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {{ 'adminUi.home.sections.fields.alt' | translate }}
                                    <input
                                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                      [(ngModel)]="slide.alt[homeBlocksLang]"
                                    />
                                  </label>
                                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {{ 'adminUi.home.hero.headline' | translate }}
                                    <input
                                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                      [(ngModel)]="slide.headline[homeBlocksLang]"
                                    />
                                  </label>
                                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                                    {{ 'adminUi.home.hero.subtitle' | translate }}
                                    <input
                                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                      [(ngModel)]="slide.subheadline[homeBlocksLang]"
                                    />
                                  </label>
                                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {{ 'adminUi.home.hero.ctaLabel' | translate }}
                                    <input
                                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                      [(ngModel)]="slide.cta_label[homeBlocksLang]"
                                    />
                                  </label>
                                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {{ 'adminUi.home.hero.ctaUrl' | translate }}
                                    <input
                                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                      [(ngModel)]="slide.cta_url"
                                    />
                                  </label>
                                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {{ 'adminUi.home.sections.fields.focalX' | translate }}
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                      [(ngModel)]="slide.focal_x"
                                    />
                                  </label>
                                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {{ 'adminUi.home.sections.fields.focalY' | translate }}
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                      [(ngModel)]="slide.focal_y"
                                    />
                                  </label>
                                </div>

                                <div class="grid gap-3 md:grid-cols-3">
                                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {{ 'adminUi.home.sections.fields.variant' | translate }}
                                    <select
                                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                      [(ngModel)]="slide.variant"
                                    >
                                      <option [ngValue]="'split'">{{ 'adminUi.home.sections.variants.split' | translate }}</option>
                                      <option [ngValue]="'full'">{{ 'adminUi.home.sections.variants.full' | translate }}</option>
                                    </select>
                                  </label>
                                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {{ 'adminUi.home.sections.fields.size' | translate }}
                                    <select
                                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                      [(ngModel)]="slide.size"
                                    >
                                      <option [ngValue]="'S'">{{ 'adminUi.home.sections.sizes.s' | translate }}</option>
                                      <option [ngValue]="'M'">{{ 'adminUi.home.sections.sizes.m' | translate }}</option>
                                      <option [ngValue]="'L'">{{ 'adminUi.home.sections.sizes.l' | translate }}</option>
                                    </select>
                                  </label>
                                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {{ 'adminUi.home.sections.fields.textStyle' | translate }}
                                    <select
                                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                      [(ngModel)]="slide.text_style"
                                    >
                                      <option [ngValue]="'dark'">{{ 'adminUi.home.sections.textStyle.dark' | translate }}</option>
                                      <option [ngValue]="'light'">{{ 'adminUi.home.sections.textStyle.light' | translate }}</option>
                                    </select>
                                  </label>
                                </div>

                                <details class="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                                  <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                                    {{ 'adminUi.site.assets.library.title' | translate }}
                                  </summary>
                                  <div class="mt-3">
                                    <app-asset-library
                                      [allowUpload]="true"
                                      [allowSelect]="true"
                                      [initialKey]="'site.assets'"
                                      (selectAsset)="setCarouselSlideImage(block.key, idx, $event)"
                                    ></app-asset-library>
                                  </div>
                                </details>
                              </div>
                            </div>

                            <div class="mt-3 flex gap-2">
                              <app-button size="sm" [label]="'adminUi.actions.add' | translate" (action)="addCarouselSlide(block.key)"></app-button>
                            </div>
                          </div>

                          <div class="grid gap-3 md:grid-cols-2">
                            <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                              <input type="checkbox" [(ngModel)]="block.settings.autoplay" />
                              <span>{{ 'adminUi.home.sections.fields.autoplay' | translate }}</span>
                            </label>
                            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                              {{ 'adminUi.home.sections.fields.interval' | translate }}
                              <input
                                type="number"
                                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                [(ngModel)]="block.settings.interval_ms"
                                [disabled]="!block.settings.autoplay"
                              />
                            </label>
                            <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                              <input type="checkbox" [(ngModel)]="block.settings.show_arrows" />
                              <span>{{ 'adminUi.home.sections.fields.arrows' | translate }}</span>
                            </label>
                            <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                              <input type="checkbox" [(ngModel)]="block.settings.show_dots" />
                              <span>{{ 'adminUi.home.sections.fields.dots' | translate }}</span>
                            </label>
                            <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                              <input type="checkbox" [(ngModel)]="block.settings.pause_on_hover" />
                              <span>{{ 'adminUi.home.sections.fields.pauseOnHover' | translate }}</span>
                            </label>
                          </div>

                          <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.home.sections.fields.preview' | translate }}</p>
                            <app-carousel-block
                              class="mt-3"
                              [slides]="toPreviewSlides(block.slides)"
                              [settings]="block.settings"
                              [tagline]="homeBlocksLang === 'en' ? 'art. handcrafted' : 'artă. meșteșug'"
                            ></app-carousel-block>
                          </div>
                        </div>
                      </ng-container>
                    </ng-container>
                  </div>
                </ng-container>
                </div>

                <div
                  *ngIf="homeInsertDragActive"
                  class="rounded-xl border border-dashed border-slate-300 bg-white/60 px-3 py-2 text-xs font-semibold text-slate-600 flex items-center justify-center dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-300"
                  (dragover)="onHomeBlockDragOver($event)"
                  (drop)="onHomeBlockDropZone($event, i + 1)"
                >
                  {{ 'adminUi.content.blockLibrary.dropHere' | translate }}
                </div>
              </ng-container>
              </div>

            <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="sectionsMessage">{{ sectionsMessage }}</span>
          </section>

          <section *ngIf="section() === 'home'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <details class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30">
              <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                {{ 'adminUi.content.revisions.title' | translate }}
              </summary>
              <div class="mt-3 grid gap-3">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.content.revisions.select' | translate }}
                  <select
                    class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="homeRevisionKey"
                  >
                    <option [ngValue]="'home.sections'">{{ 'adminUi.home.sections.title' | translate }}</option>
                    <option [ngValue]="'home.story'">{{ 'adminUi.home.story.title' | translate }}</option>
                  </select>
                </label>
                <app-content-revisions [contentKey]="homeRevisionKey" [titleKey]="homeRevisionTitleKey()"></app-content-revisions>
              </div>
            </details>
          </section>

          <section *ngIf="section() === 'home'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.home.collections.title' | translate }}</h2>
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.reset' | translate" (action)="resetCollectionForm()"></app-button>
            </div>
            <div class="grid md:grid-cols-2 gap-3 text-sm">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.home.collections.slug' | translate }}
                <div class="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 flex items-center font-mono text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200">
                  <span *ngIf="editingCollection; else collectionSlugHint">{{ editingCollection }}</span>
                  <ng-template #collectionSlugHint>
                    <span class="text-slate-500 dark:text-slate-400">{{ 'adminUi.products.form.slugAutoHint' | translate }}</span>
                  </ng-template>
                </div>
              </label>
              <app-input [label]="'adminUi.home.collections.name' | translate" [(value)]="collectionForm.name"></app-input>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                {{ 'adminUi.home.collections.description' | translate }}
                <textarea class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" rows="2" [(ngModel)]="collectionForm.description"></textarea>
              </label>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                {{ 'adminUi.home.collections.products' | translate }}
                <select multiple class="rounded-lg border border-slate-200 bg-white px-3 py-2 min-h-[120px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="collectionForm.product_ids">
                  <option *ngFor="let p of products" [value]="p.id">{{ p.name }} ({{ p.slug }})</option>
                </select>
              </label>
            </div>
            <div class="flex gap-2">
              <app-button
                [label]="editingCollection ? ('adminUi.home.collections.update' | translate) : ('adminUi.home.collections.create' | translate)"
                (action)="saveCollection()"
              ></app-button>
              <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="collectionMessage">{{ collectionMessage }}</span>
            </div>
            <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
                <div *ngFor="let col of featuredCollections" class="rounded-lg border border-slate-200 p-3 flex items-center justify-between dark:border-slate-700">
                  <div>
                    <p class="font-semibold text-slate-900 dark:text-slate-50">{{ col.name }}</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400">{{ col.slug }} · {{ col.description }}</p>
                  </div>
                  <app-button size="sm" variant="ghost" [label]="'adminUi.actions.edit' | translate" (action)="editCollection(col)"></app-button>
                  </div>
            </div>
          </section>

          <section *ngIf="false" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.products.title' | translate }}</h2>
              <div class="flex gap-2">
                <app-button size="sm" [label]="'adminUi.products.new' | translate" (action)="startNewProduct()"></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.products.delete' | translate"
                  [disabled]="!selectedIds.size"
                  (action)="deleteSelected()"
                ></app-button>
                <div class="flex items-center gap-2 text-xs">
                  <app-input label="Bulk stock" type="number" [(value)]="bulkStock"></app-input>
                  <app-button size="sm" label="Apply to selected" [disabled]="!selectedIds.size || bulkStock === null" (action)="saveBulkStock()"></app-button>
                </div>
              </div>
            </div>
            <div class="overflow-auto">
              <table class="min-w-full text-sm text-left">
                <thead>
                  <tr class="border-b border-slate-200 dark:border-slate-800">
                    <th class="py-2">
                      <input type="checkbox" [checked]="allSelected" (change)="toggleAll($event)" />
                    </th>
                    <th class="py-2">{{ 'adminUi.products.table.name' | translate }}</th>
                    <th>{{ 'adminUi.products.table.price' | translate }}</th>
                    <th>{{ 'adminUi.products.table.status' | translate }}</th>
                    <th>{{ 'adminUi.products.table.category' | translate }}</th>
                    <th>{{ 'adminUi.products.table.stock' | translate }}</th>
                    <th>Publish at</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let product of products" class="border-b border-slate-100 dark:border-slate-800">
                    <td class="py-2">
                      <input
                        type="checkbox"
                        [checked]="selectedIds.has(product.id)"
                        (change)="toggleSelect(product.id, $event)"
                      />
                    </td>
                    <td class="py-2 font-semibold text-slate-900 dark:text-slate-50">
                      {{ product.name }}
                      <span *ngIf="product.tags?.includes('bestseller')" class="ml-2 text-[10px] uppercase bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">Bestseller</span>
                    </td>
                    <td>{{ product.price | localizedCurrency : product.currency || 'RON' }}</td>
                    <td><span class="text-xs rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">{{ product.status }}</span></td>
                    <td>{{ product.category }}</td>
                    <td class="flex items-center gap-2">
                      <input
                        class="w-20 rounded border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        type="number"
                        [ngModel]="stockEdits[product.id] ?? product.stock_quantity"
                        (ngModelChange)="setStock(product.id, $event)"
                      />
                      <app-button size="xs" variant="ghost" label="Save" (action)="saveStock(product)"></app-button>
                    </td>
                    <td>
                      <span *ngIf="product.publish_at" class="text-xs text-slate-600 dark:text-slate-300">{{ product.publish_at | date: 'short' }}</span>
                      <span *ngIf="!product.publish_at" class="text-xs text-slate-400 dark:text-slate-500">—</span>
                    </td>
                    <td class="flex gap-2 py-2">
                      <app-button size="sm" variant="ghost" [label]="'adminUi.products.actions.update' | translate" (action)="loadProduct(product.slug)"></app-button>
                      <app-button size="sm" variant="ghost" label="Duplicate" (action)="duplicateProduct(product.slug)"></app-button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div *ngIf="upcomingProducts().length" class="rounded-lg border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
              <p class="font-semibold text-slate-900 dark:text-slate-50 mb-2">Upcoming scheduled products</p>
              <div *ngFor="let p of upcomingProducts()" class="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800 last:border-0">
                <span>{{ p.name }}</span>
                <span class="text-xs text-slate-600 dark:text-slate-300">Publishes {{ p.publish_at | date: 'medium' }}</span>
              </div>
            </div>
          </section>

          <section *ngIf="false" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
                {{ editingId ? ('adminUi.products.edit' | translate) : ('adminUi.products.create' | translate) }}
              </h2>
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.reset' | translate" (action)="startNewProduct()"></app-button>
            </div>
            <div class="grid md:grid-cols-2 gap-3 text-sm">
              <app-input [label]="'adminUi.products.table.name' | translate" [(value)]="form.name"></app-input>
              <app-input [label]="'adminUi.products.form.slug' | translate" [value]="form.slug" [disabled]="true"></app-input>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.products.table.category' | translate }}
                <select class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="form.category_id">
                  <option *ngFor="let c of categories" [value]="c.id">{{ c.name }}</option>
                </select>
              </label>
              <app-input [label]="'adminUi.products.table.price' | translate" type="number" [(value)]="form.price"></app-input>
              <app-input [label]="'adminUi.products.table.stock' | translate" type="number" [(value)]="form.stock"></app-input>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                Publish at (optional)
                <input class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" type="datetime-local" [(ngModel)]="form.publish_at" />
              </label>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.products.table.status' | translate }}
                <select class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="form.status">
                  <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
                  <option value="published">{{ 'adminUi.status.published' | translate }}</option>
                  <option value="archived">{{ 'adminUi.status.archived' | translate }}</option>
                </select>
              </label>
              <app-input [label]="'adminUi.products.form.sku' | translate" [(value)]="form.sku"></app-input>
              <app-input [label]="'adminUi.products.form.imageUrl' | translate" [(value)]="form.image"></app-input>
            </div>
            <div class="flex items-center gap-4 text-sm">
              <label class="flex items-center gap-2">
                <input type="checkbox" [(ngModel)]="form.is_bestseller" /> Bestseller badge
              </label>
            </div>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'adminUi.products.form.description' | translate }}
              <textarea rows="3" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="form.description"></textarea>
            </label>
            <div class="flex gap-3">
              <app-button [label]="'adminUi.products.form.save' | translate" (action)="saveProduct()"></app-button>
              <label class="text-sm text-indigo-600 dark:text-indigo-300 font-medium cursor-pointer">
                {{ 'adminUi.products.form.upload' | translate }}
                <input type="file" class="hidden" accept="image/*" (change)="onImageUpload($event)" />
              </label>
            </div>
            <div class="grid gap-2" *ngIf="productImages().length">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{{ 'adminUi.products.form.images' | translate }}</p>
              <div *ngFor="let img of productImages()" class="flex items-center gap-3 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                <img [src]="img.url" [alt]="img.alt_text || 'image'" class="h-12 w-12 rounded object-cover" />
                <div class="flex-1">
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ img.alt_text || ('adminUi.products.form.image' | translate) }}</p>
                </div>
                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.delete' | translate" (action)="deleteImage(img.id)"></app-button>
              </div>
            </div>
            <p *ngIf="formMessage" class="text-sm text-emerald-700 dark:text-emerald-300">{{ formMessage }}</p>
          </section>

          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.categories.title' | translate }}</h2>
            </div>
            <div class="grid md:grid-cols-[1fr_260px_auto] gap-2 items-end text-sm">
              <app-input [label]="'adminUi.products.table.name' | translate" [(value)]="categoryName"></app-input>
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.categories.parent' | translate }}
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="categoryParentId"
                >
                  <option value="">{{ 'adminUi.categories.parentNone' | translate }}</option>
                  <option *ngFor="let cat of categories" [value]="cat.id">{{ cat.name }}</option>
                </select>
              </label>
              <app-button size="sm" [label]="'adminUi.categories.add' | translate" (action)="addCategory()"></app-button>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.categories.slugAutoHint' | translate }}</p>
	            <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
	              <div
	                *ngFor="let cat of categories"
	                class="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
	                (dragover)="onCategoryDragOver($event)"
	                (drop)="onCategoryDrop(cat.slug)"
	              >
	                <div class="flex items-center justify-between gap-3" draggable="true" (dragstart)="onCategoryDragStart(cat.slug)">
	                  <div>
	                    <p class="font-semibold text-slate-900 dark:text-slate-50">{{ cat.name }}</p>
	                    <p class="text-xs text-slate-500 dark:text-slate-400">
	                      Slug: {{ cat.slug }} · Order: {{ cat.sort_order }} · Parent: {{ categoryParentLabel(cat) }}
	                    </p>
	                  </div>
	                  <div class="flex flex-wrap justify-end gap-2">
	                    <app-button size="sm" variant="ghost" label="↑" (action)="moveCategory(cat, -1)"></app-button>
	                    <app-button size="sm" variant="ghost" label="↓" (action)="moveCategory(cat, 1)"></app-button>
	                    <app-button
	                      size="sm"
	                      variant="ghost"
	                      [label]="'adminUi.categories.translations.button' | translate"
	                      (action)="toggleCategoryTranslations(cat.slug)"
	                    ></app-button>
	                    <app-button
	                      size="sm"
	                      variant="ghost"
	                      [label]="'adminUi.actions.delete' | translate"
	                      (action)="deleteCategory(cat.slug)"
	                    ></app-button>
	                  </div>
	                </div>
                  <label class="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <span class="font-semibold">{{ 'adminUi.categories.parent' | translate }}:</span>
                    <select
                      class="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [ngModel]="cat.parent_id || ''"
                      (ngModelChange)="updateCategoryParent(cat, $event)"
                    >
                      <option value="">{{ 'adminUi.categories.parentNone' | translate }}</option>
                      <option *ngFor="let parent of categoryParentOptions(cat)" [value]="parent.id">{{ parent.name }}</option>
                    </select>
                  </label>

                  <label class="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <span class="font-semibold">{{ 'adminUi.lowStock.thresholdLabel' | translate }}:</span>
                    <input
                      type="number"
                      min="0"
                      class="h-8 w-28 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [ngModel]="cat.low_stock_threshold ?? ''"
                      (ngModelChange)="updateCategoryLowStockThreshold(cat, $event)"
                    />
                    <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.lowStock.thresholdHint' | translate }}</span>
                  </label>

                  <label class="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <span class="font-semibold">{{ 'adminUi.taxes.categoryGroupLabel' | translate }}:</span>
                    <select
                      class="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [ngModel]="cat.tax_group_id || ''"
                      (ngModelChange)="updateCategoryTaxGroup(cat, $event)"
                    >
                      <option value="">{{ 'adminUi.taxes.categoryGroupDefault' | translate }}</option>
                      <option *ngFor="let tg of taxGroups" [value]="tg.id">{{ tg.name }} ({{ tg.code }})</option>
                    </select>
                  </label>

	                <div *ngIf="categoryTranslationsSlug === cat.slug" class="mt-3 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/30">
	                  <div class="flex items-center justify-between gap-3">
	                    <p class="text-xs font-semibold tracking-wide uppercase text-slate-600 dark:text-slate-300">
	                      {{ 'adminUi.categories.translations.title' | translate }}
	                    </p>
	                    <app-button size="sm" variant="ghost" [label]="'adminUi.actions.cancel' | translate" (action)="closeCategoryTranslations()"></app-button>
	                  </div>
	                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.categories.translations.hint' | translate }}</p>

	                  <div
	                    *ngIf="categoryTranslationsError()"
	                    class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
	                  >
	                    {{ categoryTranslationsError() }}
	                  </div>

	                  <div class="grid gap-4 lg:grid-cols-2">
	                    <div class="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	                      <div class="flex items-center justify-between gap-3">
	                        <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">RO</p>
	                        <div class="flex items-center gap-2">
	                          <app-button size="sm" [label]="'adminUi.actions.save' | translate" (action)="saveCategoryTranslation('ro')"></app-button>
	                          <app-button
	                            *ngIf="categoryTranslationExists.ro"
	                            size="sm"
	                            variant="ghost"
	                            [label]="'adminUi.actions.delete' | translate"
	                            (action)="deleteCategoryTranslation('ro')"
	                          ></app-button>
	                        </div>
	                      </div>
	                      <app-input [label]="'adminUi.products.table.name' | translate" [(value)]="categoryTranslations.ro.name"></app-input>
	                      <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                        {{ 'adminUi.categories.description' | translate }}
	                        <textarea
	                          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                          rows="2"
	                          [(ngModel)]="categoryTranslations.ro.description"
	                        ></textarea>
	                      </label>
	                    </div>

	                    <div class="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	                      <div class="flex items-center justify-between gap-3">
	                        <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">EN</p>
	                        <div class="flex items-center gap-2">
	                          <app-button size="sm" [label]="'adminUi.actions.save' | translate" (action)="saveCategoryTranslation('en')"></app-button>
	                          <app-button
	                            *ngIf="categoryTranslationExists.en"
	                            size="sm"
	                            variant="ghost"
	                            [label]="'adminUi.actions.delete' | translate"
	                            (action)="deleteCategoryTranslation('en')"
	                          ></app-button>
	                        </div>
	                      </div>
	                      <app-input [label]="'adminUi.products.table.name' | translate" [(value)]="categoryTranslations.en.name"></app-input>
	                      <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                        {{ 'adminUi.categories.description' | translate }}
	                        <textarea
	                          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                          rows="2"
	                          [(ngModel)]="categoryTranslations.en.description"
	                        ></textarea>
	                      </label>
	                    </div>
	                  </div>
	                </div>
	              </div>
	            </div>

	            <div class="grid gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
	              <div class="flex flex-wrap items-start justify-between gap-2">
	                <div class="grid gap-0.5">
	                  <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
	                    {{ 'adminUi.taxes.groupsTitle' | translate }}
	                  </p>
	                  <p class="text-xs text-slate-500 dark:text-slate-400">
	                    {{ 'adminUi.taxes.groupsHint' | translate }}
	                  </p>
	                </div>
	                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadTaxGroups()"></app-button>
	              </div>

	              <div
	                *ngIf="taxGroupsError"
	                class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
	              >
	                {{ taxGroupsError }}
	              </div>

	              <div *ngIf="taxGroupsLoading" class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.actions.loading' | translate }}</div>

	              <div *ngIf="!taxGroupsLoading" class="grid gap-3">
	                <div class="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
	                  <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
	                    {{ 'adminUi.taxes.createTitle' | translate }}
	                  </p>
	                  <div class="grid gap-2 md:grid-cols-4">
	                    <app-input [label]="'adminUi.taxes.code' | translate" [(value)]="taxGroupCreate.code"></app-input>
	                    <app-input [label]="'adminUi.taxes.name' | translate" [(value)]="taxGroupCreate.name"></app-input>
	                    <app-input [label]="'adminUi.taxes.description' | translate" [(value)]="taxGroupCreate.description"></app-input>
	                    <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
	                      <input type="checkbox" [(ngModel)]="taxGroupCreate.is_default" />
	                      {{ 'adminUi.taxes.default' | translate }}
	                    </label>
	                  </div>
	                  <div class="flex justify-end">
	                    <app-button size="sm" [label]="'adminUi.taxes.create' | translate" (action)="createTaxGroup()"></app-button>
	                  </div>
	                </div>

	                <div *ngIf="taxGroups.length === 0" class="text-sm text-slate-600 dark:text-slate-300">
	                  {{ 'adminUi.taxes.empty' | translate }}
	                </div>

	                <div
	                  *ngFor="let group of taxGroups"
	                  class="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
	                >
	                  <div class="flex flex-wrap items-start justify-between gap-3">
	                    <div class="grid gap-1">
	                      <p class="text-xs text-slate-500 dark:text-slate-400">
	                        <span class="font-semibold">{{ 'adminUi.taxes.code' | translate }}:</span>
	                        <span class="font-mono">{{ group.code }}</span>
	                        <span *ngIf="group.is_default" class="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
	                          {{ 'adminUi.taxes.default' | translate }}
	                        </span>
	                      </p>
	                      <div class="grid gap-2 md:grid-cols-2">
	                        <app-input [label]="'adminUi.taxes.name' | translate" [(value)]="group.name"></app-input>
	                        <app-input [label]="'adminUi.taxes.description' | translate" [(value)]="group.description"></app-input>
	                      </div>
	                    </div>
	                    <div class="flex flex-wrap items-center justify-end gap-2">
	                      <app-button
	                        *ngIf="!group.is_default"
	                        size="sm"
	                        variant="ghost"
	                        [label]="'adminUi.taxes.setDefault' | translate"
	                        (action)="setDefaultTaxGroup(group)"
	                      ></app-button>
	                      <app-button size="sm" variant="ghost" [label]="'adminUi.actions.save' | translate" (action)="saveTaxGroup(group)"></app-button>
	                      <app-button
	                        size="sm"
	                        variant="ghost"
	                        [label]="'adminUi.actions.delete' | translate"
	                        [disabled]="group.is_default"
	                        (action)="deleteTaxGroup(group)"
	                      ></app-button>
	                    </div>
	                  </div>

	                  <div class="grid gap-2">
	                    <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
	                      {{ 'adminUi.taxes.ratesTitle' | translate }}
	                    </p>

	                    <div *ngIf="group.rates?.length" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
	                      <table class="w-full text-left text-sm">
	                        <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
	                          <tr>
	                            <th class="px-3 py-2">{{ 'adminUi.taxes.country' | translate }}</th>
	                            <th class="px-3 py-2">{{ 'adminUi.taxes.vatRate' | translate }}</th>
	                            <th class="px-3 py-2"></th>
	                          </tr>
	                        </thead>
	                        <tbody>
	                          <tr *ngFor="let rate of group.rates" class="border-t border-slate-200 dark:border-slate-800">
	                            <td class="px-3 py-2 font-mono text-slate-700 dark:text-slate-200">{{ rate.country_code }}</td>
	                            <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ rate.vat_rate_percent }}%</td>
	                            <td class="px-3 py-2 text-right">
	                              <app-button
	                                size="sm"
	                                variant="ghost"
	                                [label]="'adminUi.actions.delete' | translate"
	                                (action)="deleteTaxRate(group, rate.country_code)"
	                              ></app-button>
	                            </td>
	                          </tr>
	                        </tbody>
	                      </table>
	                    </div>

	                    <div class="grid gap-2 md:grid-cols-[140px_160px_auto] items-end">
	                      <app-input
	                        [label]="'adminUi.taxes.country' | translate"
	                        [(value)]="taxRateCountry[group.id]"
	                        placeholder="RO"
	                      ></app-input>
	                      <app-input
	                        [label]="'adminUi.taxes.vatRate' | translate"
	                        type="number"
	                        [(value)]="taxRatePercent[group.id]"
	                        placeholder="19"
	                      ></app-input>
	                      <div class="flex justify-end">
	                        <app-button size="sm" [label]="'adminUi.taxes.addRate' | translate" (action)="upsertTaxRate(group)"></app-button>
	                      </div>
	                    </div>
	                  </div>
	                </div>
	              </div>
	            </div>

	            <div class="grid gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
	              <div class="flex flex-wrap items-start justify-between gap-2">
	                <div class="grid gap-0.5">
	                  <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
	                    {{ 'adminUi.fx.audit.title' | translate }}
	                  </p>
	                  <p class="text-xs text-slate-500 dark:text-slate-400">
	                    {{ 'adminUi.fx.audit.hint' | translate }}
	                  </p>
	                </div>
	                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadFxAudit()"></app-button>
	              </div>

	              <div
	                *ngIf="fxAuditError()"
	                class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
	              >
	                {{ fxAuditError() }}
	              </div>

	              <div *ngIf="fxAuditLoading()" class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.actions.loading' | translate }}</div>

	              <div *ngIf="!fxAuditLoading() && fxAudit().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
	                {{ 'adminUi.fx.audit.empty' | translate }}
	              </div>

	              <div
	                *ngIf="fxAudit().length > 0"
	                class="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
	              >
	                <table class="w-full text-left text-sm">
	                  <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
	                    <tr>
	                      <th class="px-3 py-2">{{ 'adminUi.fx.audit.table.when' | translate }}</th>
	                      <th class="px-3 py-2">{{ 'adminUi.fx.audit.table.action' | translate }}</th>
	                      <th class="px-3 py-2">{{ 'adminUi.fx.audit.table.user' | translate }}</th>
	                      <th class="px-3 py-2">{{ 'adminUi.fx.eurPerRon' | translate }}</th>
	                      <th class="px-3 py-2">{{ 'adminUi.fx.usdPerRon' | translate }}</th>
	                      <th class="px-3 py-2">{{ 'adminUi.fx.asOf' | translate }}</th>
	                      <th class="px-3 py-2"></th>
	                    </tr>
	                  </thead>
	                  <tbody>
	                    <tr *ngFor="let entry of fxAudit()" class="border-t border-slate-200 dark:border-slate-800">
	                      <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ entry.created_at | date: 'short' }}</td>
	                      <td class="px-3 py-2 font-semibold text-slate-900 dark:text-slate-50">{{ fxAuditActionLabel(entry.action) }}</td>
	                      <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ entry.user_email || entry.user_id || '—' }}</td>
	                      <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
	                        {{ entry.eur_per_ron ? (entry.eur_per_ron | number: '1.4-6') : '—' }}
	                      </td>
	                      <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
	                        {{ entry.usd_per_ron ? (entry.usd_per_ron | number: '1.4-6') : '—' }}
	                      </td>
	                      <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ entry.as_of || '—' }}</td>
	                      <td class="px-3 py-2">
	                        <app-button
	                          size="sm"
	                          variant="ghost"
	                          [label]="'adminUi.fx.audit.restore' | translate"
	                          (action)="restoreFxOverrideFromAudit(entry)"
	                          [disabled]="fxAuditRestoring() === entry.id || !entry.eur_per_ron || !entry.usd_per_ron || !entry.as_of"
	                        ></app-button>
	                      </td>
	                    </tr>
	                  </tbody>
	                </table>
	              </div>
	            </div>
	          </section>

          <section *ngIf="false" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.orders.title' | translate }}</h2>
              <label class="text-sm text-slate-700 dark:text-slate-200">
                {{ 'adminUi.orders.statusFilter' | translate }}
                <select class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="orderFilter">
                  <option value="">{{ 'adminUi.orders.all' | translate }}</option>
                  <option value="pending_payment">{{ 'adminUi.orders.pending_payment' | translate }}</option>
                  <option value="pending_acceptance">{{ 'adminUi.orders.pending_acceptance' | translate }}</option>
                  <option value="paid">{{ 'adminUi.orders.paid' | translate }}</option>
                  <option value="shipped">{{ 'adminUi.orders.shipped' | translate }}</option>
                  <option value="refunded">{{ 'adminUi.orders.refunded' | translate }}</option>
                </select>
              </label>
            </div>
            <div class="grid md:grid-cols-[1.5fr_1fr] gap-4">
              <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
                <div *ngFor="let order of filteredOrders()" class="rounded-lg border border-slate-200 p-3 cursor-pointer dark:border-slate-700" (click)="selectOrder(order)">
                  <div class="flex items-center justify-between">
                    <span class="font-semibold text-slate-900 dark:text-slate-50">Order #{{ order.id }}</span>
                    <span class="text-xs rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">{{ order.status }}</span>
                  </div>
                  <p>{{ order.customer }} — {{ order.total_amount | localizedCurrency : order.currency || 'RON' }}</p>
                </div>
              </div>
              <div class="rounded-lg border border-slate-200 p-4 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200" *ngIf="activeOrder">
                <div class="flex items-center justify-between">
                  <h3 class="font-semibold text-slate-900 dark:text-slate-50">Order #{{ activeOrder.id }}</h3>
                  <select class="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [ngModel]="activeOrder.status" (ngModelChange)="changeOrderStatus($event)">
                    <option value="pending_payment">{{ 'adminUi.orders.pending_payment' | translate }}</option>
                    <option value="pending_acceptance">{{ 'adminUi.orders.pending_acceptance' | translate }}</option>
                    <option value="paid">{{ 'adminUi.orders.paid' | translate }}</option>
                    <option value="shipped">{{ 'adminUi.orders.shipped' | translate }}</option>
                    <option value="cancelled">{{ 'adminUi.orders.cancelled' | translate }}</option>
                    <option value="refunded">{{ 'adminUi.orders.refunded' | translate }}</option>
                  </select>
                </div>
                <p class="text-xs text-slate-500 dark:text-slate-400">Customer: {{ activeOrder.customer }}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400">Placed: {{ activeOrder.created_at | date: 'medium' }}</p>
                <p class="font-semibold text-slate-900 dark:text-slate-50 mt-2">{{ activeOrder.total_amount | localizedCurrency : activeOrder.currency || 'RON' }}</p>
              </div>
            </div>
          </section>

          <section *ngIf="false" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.users.title' | translate }}</h2>
              <div class="flex gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.users.setRole' | translate"
                  [disabled]="!selectedUserId || !selectedUserRole || selectedUserRole === 'owner'"
                  (action)="updateRole()"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.users.forceLogout' | translate"
                  [disabled]="!selectedUserId"
                  (action)="forceLogout()"
                ></app-button>
              </div>
            </div>
            <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
              <div *ngFor="let user of users" class="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div>
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ userIdentity(user) }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ user.email }}</p>
                </div>
                <div class="flex items-center gap-2 text-xs">
                  <input type="radio" name="userSelect" [value]="user.id" [(ngModel)]="selectedUserId" (ngModelChange)="onSelectedUserIdChange($event)" />
                  <select
                    class="rounded border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [ngModel]="user.role"
                    (ngModelChange)="selectUser(user.id, $event)"
                    [disabled]="user.role === 'owner'"
                  >
                    <option value="customer">{{ 'adminUi.users.roles.customer' | translate }}</option>
                    <option value="admin">{{ 'adminUi.users.roles.admin' | translate }}</option>
                    <option *ngIf="user.role === 'owner'" value="owner">{{ 'adminUi.users.roles.owner' | translate }}</option>
                  </select>
                </div>
              </div>
            </div>

            <div *ngIf="selectedUserId" class="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">User aliases</p>
                <app-button size="sm" variant="ghost" label="Refresh" (action)="loadUserAliases(selectedUserId!)"></app-button>
              </div>

              <div *ngIf="userAliasesLoading" class="mt-2 grid gap-2">
                <app-skeleton height="44px"></app-skeleton>
              </div>

              <div *ngIf="userAliasesError" class="mt-2 text-sm text-rose-700 dark:text-rose-300">
                {{ userAliasesError }}
              </div>

              <div *ngIf="userAliases" class="mt-3 grid gap-3 sm:grid-cols-2 text-sm text-slate-700 dark:text-slate-200">
                <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                  <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">Username history</p>
                  <ul *ngIf="userAliases.usernames?.length; else noAdminUsernamesTpl" class="mt-2 grid gap-2">
                    <li *ngFor="let h of userAliases.usernames" class="flex items-center justify-between gap-2">
                      <span class="font-medium text-slate-900 dark:text-slate-50 truncate">{{ h.username }}</span>
                      <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">{{ h.created_at | date: 'short' }}</span>
                    </li>
                  </ul>
                  <ng-template #noAdminUsernamesTpl>
                    <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">No history yet.</p>
                  </ng-template>
                </div>
                <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                  <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">Display name history</p>
                  <ul *ngIf="userAliases.display_names?.length; else noAdminDisplayNamesTpl" class="mt-2 grid gap-2">
                    <li *ngFor="let h of userAliases.display_names" class="flex items-center justify-between gap-2">
                      <span class="font-medium text-slate-900 dark:text-slate-50 truncate">{{ h.name }}#{{ h.name_tag }}</span>
                      <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">{{ h.created_at | date: 'short' }}</span>
                    </li>
                  </ul>
                  <ng-template #noAdminDisplayNamesTpl>
                    <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">No history yet.</p>
                  </ng-template>
                </div>
              </div>
            </div>
          </section>

          <section *ngIf="section() === 'blog'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.blog.title' | translate }}</h2>
              <div class="flex items-center gap-2">
                <app-button size="sm" variant="ghost" [label]="'adminUi.blog.actions.newPost' | translate" (action)="startBlogCreate()"></app-button>
                <app-button
                  *ngIf="selectedBlogKey"
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.blog.actions.closeEditor' | translate"
                  (action)="closeBlogEditor()"
                ></app-button>
              </div>
            </div>

            <div class="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/40">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex flex-wrap items-center gap-3">
                  <label class="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      [checked]="areAllBlogSelected()"
                      [disabled]="blogPosts().length === 0"
                      (change)="toggleSelectAllBlogs($event)"
                    />
                    {{ 'adminUi.blog.bulk.selectAll' | translate }}
                  </label>
                  <span class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.blog.bulk.selected' | translate : { count: blogBulkSelection.size } }}
                  </span>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.blog.bulk.clear' | translate"
                    (action)="clearBlogBulkSelection()"
                    [disabled]="blogBulkSelection.size === 0"
                  ></app-button>
                </div>
                <div class="text-xs text-rose-600 dark:text-rose-300" *ngIf="blogBulkError">
                  {{ blogBulkError }}
                </div>
              </div>

              <div class="grid gap-3 md:grid-cols-4">
                <label class="grid gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.blog.bulk.actionLabel' | translate }}
                  <select
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogBulkAction"
                  >
                    <option value="publish">{{ 'adminUi.blog.bulk.actionPublish' | translate }}</option>
                    <option value="unpublish">{{ 'adminUi.blog.bulk.actionUnpublish' | translate }}</option>
                    <option value="schedule">{{ 'adminUi.blog.bulk.actionSchedule' | translate }}</option>
                    <option value="tags_add">{{ 'adminUi.blog.bulk.actionTagsAdd' | translate }}</option>
                    <option value="tags_remove">{{ 'adminUi.blog.bulk.actionTagsRemove' | translate }}</option>
                  </select>
                </label>

                <label *ngIf="blogBulkAction === 'schedule'" class="grid gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.blog.bulk.publishAt' | translate }}
                  <input
                    type="datetime-local"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogBulkPublishAt"
                  />
                </label>

                <label *ngIf="blogBulkAction === 'schedule'" class="grid gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.blog.bulk.unpublishAt' | translate }}
                  <input
                    type="datetime-local"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogBulkUnpublishAt"
                  />
                </label>

                <label *ngIf="blogBulkAction === 'tags_add' || blogBulkAction === 'tags_remove'" class="grid gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 md:col-span-2">
                  {{ 'adminUi.blog.bulk.tagsLabel' | translate }}
                  <input
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [placeholder]="'adminUi.blog.bulk.tagsPlaceholder' | translate"
                    [(ngModel)]="blogBulkTags"
                  />
                </label>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3">
                <p class="text-xs text-slate-500 dark:text-slate-400">{{ blogBulkPreview() }}</p>
                <app-button
                  size="sm"
                  [label]="blogBulkSaving ? ('adminUi.common.saving' | translate) : ('adminUi.blog.bulk.apply' | translate)"
                  (action)="applyBlogBulkAction()"
                  [disabled]="!canApplyBlogBulk() || blogBulkSaving"
                ></app-button>
              </div>
            </div>

            <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
              <div *ngIf="blogPosts().length === 0" class="text-sm text-slate-500 dark:text-slate-400">
                {{ 'adminUi.blog.empty' | translate }}
              </div>
              <div
                *ngFor="let post of blogPosts()"
                class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                [ngClass]="isBlogSelected(post.key) ? 'bg-indigo-50/60 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900' : ''"
              >
                <label class="flex items-center gap-2">
                  <input type="checkbox" [checked]="isBlogSelected(post.key)" (change)="toggleBlogSelection(post.key, $event)" />
                </label>
                <div>
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ post.title }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    {{ post.key }} · {{ ('adminUi.status.' + (post.status || 'draft')) | translate }} ·
                    {{ post.author ? commentAuthorLabel(post.author) : '—' }} · v{{ post.version }} · {{ post.updated_at | date: 'short' }}
                  </p>
                </div>
                <div class="flex items-center gap-3">
                  <a
                    class="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
                    [attr.href]="'/blog/' + extractBlogSlug(post.key)"
                    target="_blank"
                    rel="noopener"
                    (click)="$event.stopPropagation()"
                  >
                    {{ 'adminUi.blog.actions.view' | translate }}
                  </a>
                  <app-button size="sm" variant="ghost" [label]="'adminUi.actions.edit' | translate" (action)="selectBlogPost(post)"></app-button>
                </div>
              </div>
            </div>

	            <div *ngIf="showBlogCreate" class="grid gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
	              <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.blog.create.title' | translate }}</p>
	              <div class="grid md:grid-cols-2 gap-3 text-sm">
	                <label *ngIf="cmsAdvanced()" class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                  {{ 'adminUi.blog.fields.slug' | translate }}
	                  <div
	                    class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-300"
	                  >
	                    {{ blogCreateSlug() || '—' }}
	                  </div>
	                  <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.products.form.slugAutoHint' | translate }}</span>
	                </label>
	                <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
	                  {{ 'adminUi.blog.fields.baseLanguage' | translate }}
	                  <select
	                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.baseLang"
                  >
                    <option value="en">EN</option>
                    <option value="ro">RO</option>
                  </select>
                </label>
                <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.blog.fields.status' | translate }}
                  <select
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.status"
                  >
                    <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
                    <option value="review">{{ 'adminUi.status.review' | translate }}</option>
                    <option value="published">{{ 'adminUi.status.published' | translate }}</option>
                  </select>
                </label>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.blog.fields.publishAtOptional' | translate }}
                  <input
                    type="datetime-local"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.published_at"
                    [disabled]="blogCreate.status !== 'published'"
                  />
                  <span class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.blog.fields.publishAtHint' | translate }}
                  </span>
                </label>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.blog.fields.unpublishAtOptional' | translate }}
                  <input
                    type="datetime-local"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.published_until"
                    [disabled]="blogCreate.status !== 'published'"
                  />
                  <span class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.blog.fields.unpublishAtHint' | translate }}
                  </span>
                </label>
                <div class="md:col-span-2">
                  <app-input [label]="'adminUi.blog.fields.title' | translate" [(value)]="blogCreate.title"></app-input>
                </div>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                  {{ 'adminUi.blog.fields.summaryOptional' | translate }}
                  <textarea
                    rows="3"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.summary"
                  ></textarea>
                </label>
	                <app-input
	                  [label]="'adminUi.blog.fields.tags' | translate"
	                  [(value)]="blogCreate.tags"
	                  [placeholder]="'adminUi.blog.fields.tagsPlaceholder' | translate"
	                ></app-input>
	                <app-input
	                  [label]="'adminUi.blog.fields.seriesOptional' | translate"
	                  [(value)]="blogCreate.series"
	                  [placeholder]="'adminUi.blog.fields.seriesPlaceholder' | translate"
	                  [hint]="'adminUi.blog.fields.seriesHint' | translate"
	                ></app-input>
	                <app-input
	                  [label]="'adminUi.blog.fields.coverImageUrlOptional' | translate"
	                  [(value)]="blogCreate.cover_image_url"
	                  [placeholder]="'adminUi.blog.fields.coverImagePlaceholder' | translate"
	                ></app-input>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.blog.fields.readingTimeOptional' | translate }}
                  <input
                    type="number"
                    min="1"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.reading_time_minutes"
                  />
                </label>
                <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" [(ngModel)]="blogCreate.pinned" />
                  {{ 'adminUi.blog.fields.pinned' | translate }}
                </label>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.blog.fields.pinOrder' | translate }}
                  <select
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.pin_order"
                    [disabled]="!blogCreate.pinned"
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                  </select>
                  <span class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.blog.fields.pinOrderHint' | translate }}
                  </span>
                </label>
                <div class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                  {{ 'adminUi.blog.fields.body' | translate }}
                  <app-rich-editor
                    [(value)]="blogCreate.body_markdown"
                    [initialEditType]="'wysiwyg'"
                    [height]="'420px'"
                  ></app-rich-editor>
                </div>
              </div>

              <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" [(ngModel)]="blogCreate.includeTranslation" />
                {{ 'adminUi.blog.create.addTranslation' | translate }}
              </label>

              <div *ngIf="blogCreate.includeTranslation" class="grid md:grid-cols-2 gap-3 text-sm">
                <p class="md:col-span-2 text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.blog.create.translationHint' | translate: { lang: blogCreate.baseLang === 'en' ? 'RO' : 'EN' } }}
                </p>
                <app-input [label]="'adminUi.blog.create.translationTitle' | translate" [(value)]="blogCreate.translationTitle"></app-input>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                  {{ 'adminUi.blog.create.translationBody' | translate }}
                  <textarea
                    rows="5"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogCreate.translationBody"
                  ></textarea>
                </label>
              </div>

              <div class="flex gap-2">
                <app-button [label]="'adminUi.blog.actions.createPost' | translate" (action)="createBlogPost()"></app-button>
                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.cancel' | translate" (action)="cancelBlogCreate()"></app-button>
              </div>
            </div>

            <div *ngIf="selectedBlogKey" class="grid gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="grid gap-1">
                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {{ 'adminUi.blog.editing.title' | translate }}: {{ selectedBlogKey }}
                  </p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.blog.editing.languages' | translate: { base: blogBaseLang.toUpperCase(), edit: blogEditLang.toUpperCase() } }}
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <app-button
                    size="sm"
                    variant="ghost"
                    label="EN"
                    [disabled]="blogEditLang === 'en'"
                    (action)="setBlogEditLang('en')"
                  ></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    label="RO"
                    [disabled]="blogEditLang === 'ro'"
                    (action)="setBlogEditLang('ro')"
                  ></app-button>
                </div>
              </div>

              <div class="grid md:grid-cols-2 gap-3 text-sm">
                <app-input [label]="'adminUi.blog.fields.title' | translate" [(value)]="blogForm.title"></app-input>
                <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.blog.editing.statusBaseOnly' | translate }}
                  <select
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogForm.status"
                    [disabled]="blogEditLang !== blogBaseLang"
                  >
                    <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
                    <option value="review">{{ 'adminUi.status.review' | translate }}</option>
                    <option value="published">{{ 'adminUi.status.published' | translate }}</option>
                  </select>
                </label>
                <label *ngIf="cmsAdvanced()" class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                  {{ 'adminUi.blog.editing.publishAtBaseOnlyOptional' | translate }}
                  <input
                    type="datetime-local"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogForm.published_at"
                    [disabled]="blogEditLang !== blogBaseLang || blogForm.status !== 'published'"
                  />
                  <span class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.blog.editing.publishAtBaseOnlyHint' | translate }}
                  </span>
                </label>
                <label *ngIf="cmsAdvanced()" class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                  {{ 'adminUi.blog.editing.unpublishAtBaseOnlyOptional' | translate }}
                  <input
                    type="datetime-local"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogForm.published_until"
                    [disabled]="blogEditLang !== blogBaseLang || blogForm.status !== 'published'"
                  />
                  <span class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.blog.editing.unpublishAtBaseOnlyHint' | translate }}
                  </span>
                </label>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                  {{ 'adminUi.blog.editing.summaryOptional' | translate: { lang: blogEditLang.toUpperCase() } }}
                  <textarea
                    rows="3"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogForm.summary"
                  ></textarea>
                  <span class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.blog.editing.summaryHint' | translate }}
                  </span>
                </label>
	                <app-input
	                  [label]="'adminUi.blog.fields.tags' | translate"
	                  [(value)]="blogForm.tags"
	                  [placeholder]="'adminUi.blog.fields.tagsPlaceholder' | translate"
	                ></app-input>
		                <app-input
		                  [label]="'adminUi.blog.fields.seriesOptional' | translate"
		                  [(value)]="blogForm.series"
		                  [placeholder]="'adminUi.blog.fields.seriesPlaceholder' | translate"
		                  [hint]="'adminUi.blog.fields.seriesHint' | translate"
		                  [disabled]="blogEditLang !== blogBaseLang"
		                ></app-input>
                    <div class="grid gap-2 md:col-span-2">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <p class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ 'adminUi.blog.cover.title' | translate }}</p>
                        <div class="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600"
                            [disabled]="blogEditLang !== blogBaseLang"
                            (click)="blogCoverUploadInput.click()"
                          >
                            {{ 'adminUi.blog.cover.upload' | translate }}
                          </button>
                          <input #blogCoverUploadInput type="file" accept="image/*" class="hidden" (change)="uploadBlogCoverImage($event)" />
                          <button
                            type="button"
                            class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600"
                            [disabled]="blogEditLang !== blogBaseLang"
                            (click)="showBlogCoverLibrary = !showBlogCoverLibrary"
                          >
                            {{ showBlogCoverLibrary ? ('adminUi.common.close' | translate) : ('adminUi.blog.cover.choose' | translate) }}
                          </button>
                          <button
                            type="button"
                            class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600"
                            [disabled]="blogEditLang !== blogBaseLang || !blogForm.cover_image_url.trim()"
                            (click)="clearBlogCoverOverride()"
                          >
                            {{ 'adminUi.blog.cover.clear' | translate }}
                          </button>
                        </div>
                      </div>

                      <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                        {{ 'adminUi.blog.fields.coverImageUrlOptional' | translate }}
                        <input
                          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          [(ngModel)]="blogForm.cover_image_url"
                          [placeholder]="'adminUi.blog.fields.coverImagePlaceholder' | translate"
                          [disabled]="blogEditLang !== blogBaseLang"
                        />
                        <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.blog.cover.hint' | translate }}</span>
                      </label>

                      <div *ngIf="blogCoverPreviewUrl() as coverUrl" class="grid gap-3 sm:grid-cols-2">
                        <div class="grid gap-2">
                          <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                            {{ 'adminUi.blog.cover.previewDesktop' | translate }}
                          </p>
                          <div class="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800">
                            <img
                              [src]="coverUrl"
                              [alt]="blogForm.title || 'cover'"
                              class="w-full aspect-[16/9] object-cover"
                              [style.object-position]="blogCoverPreviewFocalPosition()"
                              loading="lazy"
                              decoding="async"
                            />
                          </div>
                        </div>
                        <div class="grid gap-2">
                          <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                            {{ 'adminUi.blog.cover.previewMobile' | translate }}
                          </p>
                          <div class="max-w-[280px] relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800">
                            <img
                              [src]="coverUrl"
                              [alt]="blogForm.title || 'cover'"
                              class="w-full aspect-[1/1] object-cover"
                              [style.object-position]="blogCoverPreviewFocalPosition()"
                              loading="lazy"
                              decoding="async"
                            />
                          </div>
                        </div>
                      </div>

                      <div *ngIf="blogCoverPreviewAsset() as coverAsset" class="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>{{ 'adminUi.blog.cover.focalLabel' | translate: { x: coverAsset.focal_x, y: coverAsset.focal_y } }}</span>
                        <button
                          type="button"
                          class="text-xs text-slate-700 hover:underline disabled:opacity-60 dark:text-slate-200"
                          [disabled]="blogEditLang !== blogBaseLang"
                          (click)="editBlogCoverFocalPoint()"
                        >
                          {{ 'adminUi.blog.cover.editFocal' | translate }}
                        </button>
                      </div>

                      <div
                        *ngIf="showBlogCoverLibrary && selectedBlogKey"
                        class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
                      >
                        <app-asset-library
                          titleKey="adminUi.blog.cover.libraryTitle"
                          [allowUpload]="false"
                          [allowSelect]="true"
                          [scopedKeys]="[selectedBlogKey]"
                          [initialKey]="selectedBlogKey"
                          [uploadKey]="selectedBlogKey"
                          (selectAsset)="selectBlogCoverAsset($event)"
                        ></app-asset-library>
                      </div>
                    </div>
	                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                  {{ 'adminUi.blog.fields.readingTimeOptional' | translate }}
	                  <input
	                    type="number"
                    min="1"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogForm.reading_time_minutes"
                  />
                </label>
                <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 md:col-span-2">
                  <input type="checkbox" [(ngModel)]="blogForm.pinned" [disabled]="blogEditLang !== blogBaseLang" />
                  {{ 'adminUi.blog.fields.pinned' | translate }}
                </label>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.blog.fields.pinOrder' | translate }}
                  <select
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogForm.pin_order"
                    [disabled]="blogEditLang !== blogBaseLang || !blogForm.pinned"
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                  </select>
                  <span class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.blog.fields.pinOrderHint' | translate }}
                  </span>
                </label>
                <div class="grid gap-2 md:col-span-2">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <p class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ 'adminUi.blog.fields.body' | translate }}</p>
                    <div class="flex flex-wrap items-center gap-3">
                      <label class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <input type="checkbox" [(ngModel)]="useRichBlogEditor" />
                        {{ 'adminUi.blog.editing.richEditor' | translate }}
                      </label>
                      <label *ngIf="!useRichBlogEditor" class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <input type="checkbox" [(ngModel)]="showBlogPreview" />
                        {{ 'adminUi.blog.editing.livePreview' | translate }}
                      </label>
                    </div>
                  </div>

                  <ng-container *ngIf="useRichBlogEditor; else markdownBlogEditor">
                    <div class="flex flex-wrap items-center gap-2 text-xs">
                      <label class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        {{ 'adminUi.blog.images.layout.label' | translate }}
                        <select
                          class="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          [(ngModel)]="blogImageLayout"
                        >
                          <option value="default">{{ 'adminUi.blog.images.layout.default' | translate }}</option>
                          <option value="wide">{{ 'adminUi.blog.images.layout.wide' | translate }}</option>
                          <option value="left">{{ 'adminUi.blog.images.layout.left' | translate }}</option>
                          <option value="right">{{ 'adminUi.blog.images.layout.right' | translate }}</option>
                          <option value="gallery">{{ 'adminUi.blog.images.layout.gallery' | translate }}</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="blogImageInputRich.click()"
                      >
                        {{ 'adminUi.blog.actions.image' | translate }}
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="insertBlogEmbed(blogEditor, 'product')"
                      >
                        {{ 'adminUi.blog.toolbar.product' | translate }}
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="insertBlogEmbed(blogEditor, 'category')"
                      >
                        {{ 'adminUi.blog.toolbar.category' | translate }}
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="insertBlogEmbed(blogEditor, 'collection')"
                      >
                        {{ 'adminUi.blog.toolbar.collection' | translate }}
                      </button>
                      <input
                        #blogImageInputRich
                        type="file"
                        accept="image/*"
                        class="hidden"
                        (change)="uploadAndInsertBlogImage(blogEditor, $event)"
                      />
                    </div>

	                    <div (dragover)="onBlogImageDragOver($event)" (drop)="onBlogImageDrop(blogEditor, $event)">
	                      <app-rich-editor
	                        #blogEditor
	                        [(value)]="blogForm.body_markdown"
	                        [initialEditType]="'wysiwyg'"
	                        [height]="'520px'"
	                      ></app-rich-editor>
	                    </div>
	                  </ng-container>

                  <ng-template #markdownBlogEditor>
                    <div class="flex flex-wrap items-center gap-2 text-xs">
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="applyBlogHeading(blogBody, 1)"
                      >
                        H1
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="applyBlogHeading(blogBody, 2)"
                      >
                        H2
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="wrapBlogSelection(blogBody, '**', '**', 'bold text')"
                      >
                        B
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 italic text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="wrapBlogSelection(blogBody, '*', '*', 'italic text')"
                      >
                        I
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="insertBlogLink(blogBody)"
                      >
                        {{ 'adminUi.blog.toolbar.link' | translate }}
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="insertBlogCodeBlock(blogBody)"
                      >
                        {{ 'adminUi.blog.toolbar.code' | translate }}
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="insertBlogEmbed(blogBody, 'product')"
                      >
                        {{ 'adminUi.blog.toolbar.product' | translate }}
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="insertBlogEmbed(blogBody, 'category')"
                      >
                        {{ 'adminUi.blog.toolbar.category' | translate }}
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="insertBlogEmbed(blogBody, 'collection')"
                      >
                        {{ 'adminUi.blog.toolbar.collection' | translate }}
                      </button>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="applyBlogList(blogBody)"
                      >
                        {{ 'adminUi.blog.toolbar.list' | translate }}
                      </button>
                      <label class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        {{ 'adminUi.blog.images.layout.label' | translate }}
                        <select
                          class="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          [(ngModel)]="blogImageLayout"
                        >
                          <option value="default">{{ 'adminUi.blog.images.layout.default' | translate }}</option>
                          <option value="wide">{{ 'adminUi.blog.images.layout.wide' | translate }}</option>
                          <option value="left">{{ 'adminUi.blog.images.layout.left' | translate }}</option>
                          <option value="right">{{ 'adminUi.blog.images.layout.right' | translate }}</option>
                          <option value="gallery">{{ 'adminUi.blog.images.layout.gallery' | translate }}</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                        (click)="blogImageInput.click()"
                      >
                        {{ 'adminUi.blog.actions.image' | translate }}
                      </button>
                      <input #blogImageInput type="file" accept="image/*" class="hidden" (change)="uploadAndInsertBlogImage(blogBody, $event)" />
                    </div>

                    <div
                      class="grid gap-3"
                      [ngClass]="showBlogPreview && cmsPrefs.previewLayout() === 'split' ? 'lg:grid-cols-2' : ''"
                    >
	                      <textarea
	                        #blogBody
	                        rows="10"
	                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                        (dragover)="onBlogImageDragOver($event)"
	                        (drop)="onBlogImageDrop(blogBody, $event)"
	                        [(ngModel)]="blogForm.body_markdown"
	                        (scroll)="syncSplitScroll(blogBody, blogPreview)"
	                      ></textarea>

                      <div class="mx-auto w-full" [ngClass]="cmsPreviewMaxWidthClass()" [class.hidden]="!showBlogPreview">
                      <div
                        #blogPreview
                        class="markdown rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-800 shadow-sm max-h-[520px] overflow-auto dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        [innerHTML]="showBlogPreview ? renderMarkdown(blogForm.body_markdown || ('adminUi.blog.editing.previewEmpty' | translate)) : ''"
                        (scroll)="syncSplitScroll(blogPreview, blogBody)"
                      ></div>
                    </div>
                    </div>
                  </ng-template>
                </div>
              </div>

              <ng-container *ngIf="blogA11yIssues() as issues">
                <details
                  *ngIf="issues.length"
                  class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30"
                  [open]="blogA11yOpen"
                >
                  <summary class="cursor-pointer select-none font-semibold text-amber-900 dark:text-amber-100">
                    {{ 'adminUi.blog.a11y.title' | translate }} ({{ issues.length }})
                  </summary>
                  <div class="mt-2 grid gap-2">
                    <p class="text-xs text-amber-900/80 dark:text-amber-100/80">{{ 'adminUi.blog.a11y.hint' | translate }}</p>
                    <div
                      *ngFor="let issue of issues"
                      class="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-white p-2 text-xs dark:border-amber-900/50 dark:bg-slate-900"
                    >
                      <a class="text-indigo-600 dark:text-indigo-300 hover:underline truncate" [href]="issue.url" target="_blank" rel="noopener">
                        {{ issue.url }}
                      </a>
                      <div class="flex items-center gap-2">
                        <span class="text-slate-600 dark:text-slate-300">{{ issue.alt || '—' }}</span>
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.blog.a11y.fixAlt' | translate"
                          (action)="promptFixBlogImageAlt(issue.index)"
                        ></app-button>
                      </div>
                    </div>
                  </div>
                </details>
              </ng-container>

              <div class="grid gap-2">
                <div *ngIf="blogImages.length" class="grid gap-2">
                  <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{{ 'adminUi.blog.images.title' | translate }}</p>
                  <div *ngFor="let img of blogImages" class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <a class="text-xs text-indigo-600 dark:text-indigo-300 hover:underline truncate" [href]="img.url" target="_blank" rel="noopener">
                      {{ img.url }}
                    </a>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.blog.images.insertMarkdown' | translate"
                      (action)="insertBlogImageMarkdown(img.url, img.alt_text)"
                    ></app-button>
                  </div>
                </div>
              </div>

              <div
                *ngIf="blogDraftHasRestore()"
                class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold">{{ 'adminUi.content.autosave.restoreFound' | translate }}</span>
                  <span *ngIf="blogDraftRestoreAt()" class="text-amber-700 dark:text-amber-200">{{ blogDraftRestoreAt() | date: 'short' }}</span>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <app-button size="sm" variant="ghost" [label]="'adminUi.actions.restore' | translate" (action)="restoreBlogDraftAutosave()"></app-button>
                  <app-button size="sm" variant="ghost" [label]="'adminUi.actions.dismiss' | translate" (action)="dismissBlogDraftAutosave()"></app-button>
                </div>
              </div>

              <div class="flex flex-wrap gap-2">
                <app-button [label]="'adminUi.actions.save' | translate" (action)="saveBlogPost()"></app-button>
                <app-button size="sm" variant="ghost" [label]="'adminUi.blog.actions.previewLink' | translate" (action)="generateBlogPreviewLink()"></app-button>
                <a
                  class="inline-flex items-center justify-center rounded-full font-semibold transition px-3 py-2 text-sm bg-white text-slate-900 border border-slate-200 hover:border-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:bg-slate-800 dark:text-slate-50 dark:border-slate-700 dark:hover:border-slate-600"
                  [attr.href]="'/blog/' + currentBlogSlug()"
                  target="_blank"
                  rel="noopener"
                >
                  {{ 'adminUi.blog.actions.view' | translate }}
                </a>
                <span *ngIf="blogDraftReady()" class="text-xs text-slate-500 dark:text-slate-400">
                  <ng-container *ngIf="!blogDraftDirty()">
                    {{ 'adminUi.content.autosave.state.saved' | translate }}
                  </ng-container>
                  <ng-container *ngIf="blogDraftDirty() && blogDraftAutosaving()">
                    {{ 'adminUi.content.autosave.state.autosaving' | translate }}
                  </ng-container>
                  <ng-container *ngIf="blogDraftDirty() && !blogDraftAutosaving() && blogDraftLastAutosavedAt()">
                    {{ 'adminUi.content.autosave.state.autosaved' | translate }} {{ blogDraftLastAutosavedAt() | date: 'shortTime' }}
                  </ng-container>
                  <ng-container *ngIf="blogDraftDirty() && !blogDraftAutosaving() && !blogDraftLastAutosavedAt()">
                    {{ 'adminUi.content.autosave.state.unsaved' | translate }}
                  </ng-container>
                </span>
              </div>
              <div *ngIf="blogPreviewUrl" class="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-950/30">
                <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{{ 'adminUi.blog.preview.title' | translate }}</p>
                <div class="flex items-center gap-2">
                  <input
                    class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [value]="blogPreviewUrl"
                    readonly
                  />
                  <app-button size="sm" variant="ghost" [label]="'adminUi.blog.actions.copy' | translate" (action)="copyBlogPreviewLink()"></app-button>
                </div>
                <p *ngIf="blogPreviewExpiresAt" class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.blog.preview.expires' | translate }} {{ blogPreviewExpiresAt | date: 'short' }}
                </p>
              </div>

              <details class="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
                <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                  {{ 'adminUi.blog.social.title' | translate }}
                </summary>
                <div class="mt-3 grid gap-3">
                  <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.blog.social.hint' | translate }}</p>

                  <div
                    *ngIf="!blogPreviewToken"
                    class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
                  >
                    <p class="font-semibold">{{ 'adminUi.blog.social.previewTokenTitle' | translate }}</p>
                    <p class="text-xs">{{ 'adminUi.blog.social.previewTokenCopy' | translate }}</p>
                    <div class="mt-2">
                      <app-button size="sm" variant="ghost" [label]="'adminUi.blog.actions.previewLink' | translate" (action)="generateBlogPreviewLink()"></app-button>
                    </div>
                  </div>

                  <div class="grid gap-4 md:grid-cols-2">
                    <div
                      *ngFor="let lang of blogSocialLangs"
                      class="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30"
                    >
                      <div class="flex items-center justify-between gap-2">
                        <p class="text-xs font-semibold tracking-wide uppercase text-slate-600 dark:text-slate-300">{{ lang.toUpperCase() }}</p>
                        <div class="flex items-center gap-2">
                          <a
                            class="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
                            [attr.href]="blogPublicUrl(lang)"
                            target="_blank"
                            rel="noopener"
                          >
                            {{ 'adminUi.blog.actions.view' | translate }}
                          </a>
                          <app-button size="sm" variant="ghost" [label]="'adminUi.blog.actions.copy' | translate" (action)="copyText(blogPublicUrl(lang))"></app-button>
                        </div>
                      </div>

                      <img
                        *ngIf="blogPreviewToken || blogForm.status === 'published'"
                        [src]="blogPreviewOgImageUrl(lang) || blogPublishedOgImageUrl(lang)"
                        [alt]="'adminUi.blog.social.ogAlt' | translate"
                        class="w-full rounded-lg border border-slate-200 bg-white object-cover dark:border-slate-800 dark:bg-slate-900"
                        loading="lazy"
                      />

                      <div class="grid gap-2">
                        <label class="grid gap-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                          {{ 'adminUi.blog.social.pageUrl' | translate }}
                          <input
                            class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            [value]="blogPublicUrl(lang)"
                            readonly
                          />
                        </label>

                        <label class="grid gap-1 text-xs font-medium text-slate-700 dark:text-slate-200" *ngIf="blogPreviewToken">
                          {{ 'adminUi.blog.social.previewImageUrl' | translate }}
                          <div class="flex items-center gap-2">
                            <input
                              class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                              [value]="blogPreviewOgImageUrl(lang) || ''"
                              readonly
                            />
                            <app-button
                              size="sm"
                              variant="ghost"
                              [label]="'adminUi.blog.actions.copy' | translate"
                              (action)="copyText(blogPreviewOgImageUrl(lang) || '')"
                            ></app-button>
                          </div>
                        </label>

                        <label class="grid gap-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                          {{ 'adminUi.blog.social.publishedImageUrl' | translate }}
                          <div class="flex items-center gap-2">
                            <input
                              class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                              [value]="blogPublishedOgImageUrl(lang)"
                              readonly
                            />
                            <app-button size="sm" variant="ghost" [label]="'adminUi.blog.actions.copy' | translate" (action)="copyText(blogPublishedOgImageUrl(lang))"></app-button>
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </details>

              <div class="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.blog.revisions.title' | translate }}</p>
                  <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadBlogVersions()"></app-button>
                </div>
                <div *ngIf="blogVersions.length === 0" class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.blog.revisions.empty' | translate }}
                </div>
                <div *ngFor="let v of blogVersions" class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div>
                    <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">v{{ v.version }} · {{ v.created_at | date: 'short' }}</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400">{{ ('adminUi.status.' + v.status) | translate }}</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <app-button size="sm" variant="ghost" [label]="'adminUi.blog.revisions.diff' | translate" (action)="selectBlogVersion(v.version)"></app-button>
                    <app-button size="sm" variant="ghost" [label]="'adminUi.blog.revisions.rollback' | translate" (action)="rollbackBlogVersion(v.version)"></app-button>
                  </div>
                </div>

                <div *ngIf="blogVersionDetail" class="grid gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.blog.revisions.diffVsCurrent' | translate: { version: blogVersionDetail.version } }}
                  </p>
                  <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs whitespace-pre-wrap text-slate-900 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-100">
                    <ng-container *ngFor="let part of blogDiffParts">
                      <span
                        [ngClass]="part.added ? 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100' : part.removed ? 'bg-rose-200 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100' : ''"
                        >{{ part.value }}</span
                      >
                    </ng-container>
                  </div>
                </div>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.blog.editing.toolbarTip' | translate }}</p>
	            </div>
	          </section>

	          <section *ngIf="section() === 'blog'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	            <div class="flex items-center justify-between">
	              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.blog.moderation.title' | translate }}</h2>
	              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadFlaggedComments()"></app-button>
	            </div>
	            <div
	              *ngIf="flaggedCommentsError"
	              class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
	            >
	              {{ flaggedCommentsError }}
	            </div>
	            <div *ngIf="flaggedCommentsLoading()" class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.blog.moderation.loading' | translate }}</div>
	            <div
	              *ngIf="!flaggedCommentsLoading() && !flaggedCommentsError && flaggedComments().length === 0"
	              class="text-sm text-slate-500 dark:text-slate-400"
	            >
	              {{ 'adminUi.blog.moderation.empty' | translate }}
	            </div>
	            <div *ngIf="!flaggedCommentsLoading() && flaggedComments().length" class="grid gap-3">
	              <div *ngFor="let c of flaggedComments()" class="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
	                <div class="flex items-start justify-between gap-3">
	                  <div class="grid gap-0.5">
	                    <p class="font-semibold text-slate-900 dark:text-slate-50">{{ commentAuthorLabel(c.author) }}</p>
	                    <p class="text-xs text-slate-500 dark:text-slate-400">
	                      /blog/{{ c.post_slug }} · {{ c.created_at | date: 'short' }} · {{ 'adminUi.blog.moderation.flagsCount' | translate: { count: c.flag_count } }}
	                    </p>
	                  </div>
	                  <div class="flex items-center gap-2">
	                    <a
	                      class="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
	                      [attr.href]="'/blog/' + c.post_slug"
	                      target="_blank"
	                      rel="noopener"
	                      (click)="$event.stopPropagation()"
	                    >
	                      {{ 'adminUi.blog.actions.view' | translate }}
	                    </a>
	                    <app-button size="sm" variant="ghost" [label]="'adminUi.blog.moderation.actions.resolve' | translate" (action)="resolveFlags(c)"></app-button>
	                    <app-button size="sm" variant="ghost" [label]="c.is_hidden ? ('adminUi.blog.moderation.actions.unhide' | translate) : ('adminUi.blog.moderation.actions.hide' | translate)" (action)="toggleHide(c)"></app-button>
	                    <app-button size="sm" variant="ghost" [label]="'adminUi.actions.delete' | translate" (action)="adminDeleteComment(c)"></app-button>
	                  </div>
	                </div>
	                <p class="mt-2 text-sm whitespace-pre-line text-slate-700 dark:text-slate-200">
	                  {{ c.body || ('adminUi.blog.moderation.deletedBody' | translate) }}
	                </p>
	                <div *ngIf="c.flags?.length" class="mt-2 grid gap-1 text-xs text-slate-600 dark:text-slate-300">
	                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.blog.moderation.flagsTitle' | translate }}</p>
	                  <div *ngFor="let f of c.flags" class="flex items-center justify-between gap-2">
	                    <span>{{ f.reason || '—' }}</span>
	                    <span class="text-slate-500 dark:text-slate-400">{{ f.created_at | date: 'short' }}</span>
	                  </div>
	                </div>
	              </div>
	            </div>
	          </section>

	          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	            <div class="flex items-center justify-between">
	              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.content.title' | translate }}</h2>
	            </div>
            <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
              <div *ngFor="let c of contentBlocks" class="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div>
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ c.title }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ c.key }} · v{{ c.version }} · {{ c.updated_at | date: 'short' }}</p>
                </div>
                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.edit' | translate" (action)="selectContent(c)"></app-button>
              </div>
            </div>
            <div *ngIf="selectedContent" class="grid gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.content.editing' | translate }}: {{ selectedContent.key }}</p>
              <app-input [label]="'adminUi.content.titleLabel' | translate" [(value)]="contentForm.title"></app-input>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.content.status' | translate }}
                <select class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" [(ngModel)]="contentForm.status">
                  <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
                  <option value="review">{{ 'adminUi.status.review' | translate }}</option>
                  <option value="published">{{ 'adminUi.status.published' | translate }}</option>
                </select>
              </label>
              <div
                class="grid gap-3"
                [ngClass]="showContentPreview && cmsPrefs.previewLayout() === 'split' ? 'lg:grid-cols-2' : ''"
              >
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.content.body' | translate }}
                  <textarea
                    #contentBody
                    rows="10"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="contentForm.body_markdown"
                    (scroll)="syncSplitScroll(contentBody, contentPreview)"
                  ></textarea>
                </label>

                <div class="mx-auto w-full" [ngClass]="cmsPreviewMaxWidthClass()" [class.hidden]="!showContentPreview">
                  <div
                    #contentPreview
                    class="markdown rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-800 shadow-sm max-h-[520px] overflow-auto dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    [innerHTML]="showContentPreview ? renderMarkdown(contentForm.body_markdown || ('adminUi.content.previewEmpty' | translate)) : ''"
                    (scroll)="syncSplitScroll(contentPreview, contentBody)"
                  ></div>
                </div>
              </div>

              <div class="flex gap-2">
                <app-button size="sm" [label]="'adminUi.content.save' | translate" (action)="saveContent()"></app-button>
                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.cancel' | translate" (action)="cancelContent()"></app-button>
                <label class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input type="checkbox" [(ngModel)]="showContentPreview" /> {{ 'adminUi.content.livePreview' | translate }}
                </label>
              </div>
            </div>
          </section>

          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.coupons.title' | translate }}</h2>
            </div>
            <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
              <div class="grid md:grid-cols-3 gap-2 items-end">
                <app-input [label]="'adminUi.coupons.code' | translate" [(value)]="newCoupon.code"></app-input>
                <app-input [label]="'adminUi.coupons.percentOff' | translate" type="number" [(value)]="newCoupon.percentage_off"></app-input>
                <app-button size="sm" [label]="'adminUi.coupons.add' | translate" (action)="createCoupon()"></app-button>
              </div>
              <div *ngFor="let coupon of coupons" class="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div>
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ coupon.code }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    <ng-container *ngIf="coupon.percentage_off">-{{ coupon.percentage_off }}%</ng-container>
                    <ng-container *ngIf="coupon.amount_off">-{{ coupon.amount_off | localizedCurrency : coupon.currency || 'RON' }}</ng-container>
                    <ng-container *ngIf="!coupon.percentage_off && !coupon.amount_off">{{ 'adminUi.coupons.none' | translate }}</ng-container>
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <app-button size="sm" variant="ghost" [label]="'adminUi.coupons.invalidateStripe' | translate" (action)="invalidateCouponStripe(coupon)"></app-button>
                  <button
                    type="button"
                    class="text-xs rounded-full px-2 py-1 border border-slate-200 dark:border-slate-700"
                    [class.bg-emerald-100]="coupon.active"
                    [class.text-emerald-800]="coupon.active"
                    (click)="toggleCoupon(coupon)"
                  >
                    {{ coupon.active ? ('adminUi.coupons.active' | translate) : ('adminUi.coupons.inactive' | translate) }}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div class="grid gap-0.5">
                <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.fx.title' | translate }}</h2>
                <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.fx.hint' | translate }}</p>
              </div>
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadFxStatus()"></app-button>
            </div>

            <div
              *ngIf="fxError()"
              class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
            >
              {{ fxError() }}
            </div>
            <div *ngIf="fxLoading()" class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.fx.loading' | translate }}</div>

            <div *ngIf="fxStatus() as fx" class="grid gap-4 md:grid-cols-3 text-sm text-slate-700 dark:text-slate-200">
              <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.fx.effective' | translate }}
                </p>
                <div class="mt-2 grid gap-1">
                  <div class="flex items-center justify-between gap-3">
                    <span>{{ 'adminUi.fx.eurPerRon' | translate }}</span>
                    <span class="font-medium text-slate-900 dark:text-slate-50">{{ fx.effective.eur_per_ron | number: '1.4-6' }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span>{{ 'adminUi.fx.usdPerRon' | translate }}</span>
                    <span class="font-medium text-slate-900 dark:text-slate-50">{{ fx.effective.usd_per_ron | number: '1.4-6' }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span>{{ 'adminUi.fx.asOf' | translate }}</span>
                    <span class="text-slate-600 dark:text-slate-300">{{ fx.effective.as_of }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span>{{ 'adminUi.fx.fetchedAt' | translate }}</span>
                    <span class="text-slate-600 dark:text-slate-300">{{ fx.effective.fetched_at | date: 'short' }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span>{{ 'adminUi.fx.source' | translate }}</span>
                    <span class="text-slate-600 dark:text-slate-300">{{ fx.effective.source }}</span>
                  </div>
                </div>
              </div>

              <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div class="flex items-center justify-between gap-3">
                  <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.fx.override' | translate }}
                  </p>
                  <button
                    *ngIf="fx.override"
                    type="button"
                    class="text-xs font-medium text-rose-600 hover:text-rose-700 dark:text-rose-300 dark:hover:text-rose-200"
                    (click)="clearFxOverride()"
                  >
                    {{ 'adminUi.fx.actions.clear' | translate }}
                  </button>
                </div>

                <ng-container *ngIf="fx.override; else noOverrideTpl">
                  <div class="mt-2 grid gap-1">
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.eurPerRon' | translate }}</span>
                      <span class="font-medium text-slate-900 dark:text-slate-50">{{ fx.override?.eur_per_ron | number: '1.4-6' }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.usdPerRon' | translate }}</span>
                      <span class="font-medium text-slate-900 dark:text-slate-50">{{ fx.override?.usd_per_ron | number: '1.4-6' }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.asOf' | translate }}</span>
                      <span class="text-slate-600 dark:text-slate-300">{{ fx.override?.as_of }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.fetchedAt' | translate }}</span>
                      <span class="text-slate-600 dark:text-slate-300">{{ fx.override?.fetched_at | date: 'short' }}</span>
                    </div>
                  </div>
                </ng-container>
                <ng-template #noOverrideTpl>
                  <p class="mt-2 text-slate-500 dark:text-slate-400">{{ 'adminUi.fx.noOverride' | translate }}</p>
                </ng-template>

                <div class="mt-4 grid gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <div class="grid gap-2 sm:grid-cols-2">
                    <app-input [label]="'adminUi.fx.eurPerRon' | translate" type="number" [(value)]="fxOverrideForm.eur_per_ron"></app-input>
                    <app-input [label]="'adminUi.fx.usdPerRon' | translate" type="number" [(value)]="fxOverrideForm.usd_per_ron"></app-input>
                  </div>
                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <span>{{ 'adminUi.fx.asOf' | translate }}</span>
                    <input
                      type="date"
                      class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
                      [(ngModel)]="fxOverrideForm.as_of"
                    />
                    <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.fx.asOfHint' | translate }}</span>
                  </label>
                  <div class="flex flex-wrap items-center gap-2">
                    <app-button size="sm" [label]="'adminUi.fx.actions.set' | translate" (action)="saveFxOverride()"></app-button>
                    <app-button size="sm" variant="ghost" [label]="'adminUi.fx.actions.reset' | translate" (action)="resetFxOverrideForm()"></app-button>
                  </div>
                </div>
              </div>

              <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.fx.lastKnown' | translate }}
                </p>
                <ng-container *ngIf="fx.last_known; else noLastKnownTpl">
                  <div class="mt-2 grid gap-1">
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.eurPerRon' | translate }}</span>
                      <span class="font-medium text-slate-900 dark:text-slate-50">{{ fx.last_known?.eur_per_ron | number: '1.4-6' }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.usdPerRon' | translate }}</span>
                      <span class="font-medium text-slate-900 dark:text-slate-50">{{ fx.last_known?.usd_per_ron | number: '1.4-6' }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.asOf' | translate }}</span>
                      <span class="text-slate-600 dark:text-slate-300">{{ fx.last_known?.as_of }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.fetchedAt' | translate }}</span>
                      <span class="text-slate-600 dark:text-slate-300">{{ fx.last_known?.fetched_at | date: 'short' }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <span>{{ 'adminUi.fx.source' | translate }}</span>
                      <span class="text-slate-600 dark:text-slate-300">{{ fx.last_known?.source }}</span>
                    </div>
                  </div>
                </ng-container>
                <ng-template #noLastKnownTpl>
                  <p class="mt-2 text-slate-500 dark:text-slate-400">{{ 'adminUi.fx.noLastKnown' | translate }}</p>
                </ng-template>
              </div>
            </div>
          </section>

          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.audit.title' | translate }}</h2>
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadAudit()"></app-button>
            </div>
            <div class="grid md:grid-cols-3 gap-4 text-sm text-slate-700 dark:text-slate-200">
              <div class="grid gap-2">
                <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.products' | translate }}</p>
                <div *ngFor="let log of productAudit" class="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ log.action }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.productId' | translate }} {{ log.product_id }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.at' | translate }} {{ log.created_at | date: 'short' }}</p>
                </div>
              </div>
              <div class="grid gap-2">
                <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.content' | translate }}</p>
                <div *ngFor="let log of contentAudit" class="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ log.action }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.blockId' | translate }} {{ log.block_id }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.at' | translate }} {{ log.created_at | date: 'short' }}</p>
                </div>
              </div>
              <div class="grid gap-2">
                <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.security' | translate }}</p>
                <div *ngFor="let log of securityAudit" class="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ ('adminUi.audit.securityActions.' + log.action) | translate }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.audit.actor' | translate }} {{ log.actor_email || log.actor_user_id }}
                  </p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.audit.subject' | translate }} {{ log.subject_email || log.data?.identifier || log.subject_user_id }}
                  </p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.at' | translate }} {{ log.created_at | date: 'short' }}</p>
                </div>
              </div>
            </div>
          </section>

          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.maintenance.title' | translate }}</h2>
              <app-button size="sm" [label]="'adminUi.actions.save' | translate" (action)="saveMaintenance()"></app-button>
            </div>
            <div class="flex items-center gap-3 text-sm">
              <label class="flex items-center gap-2">
                <input type="checkbox" [(ngModel)]="maintenanceEnabledValue" /> {{ 'adminUi.maintenance.mode' | translate }}
              </label>
              <a class="text-indigo-600 dark:text-indigo-300" href="/api/v1/sitemap.xml" target="_blank" rel="noopener">{{ 'adminUi.maintenance.sitemap' | translate }}</a>
              <a class="text-indigo-600 dark:text-indigo-300" href="/api/v1/robots.txt" target="_blank" rel="noopener">{{ 'adminUi.maintenance.robots' | translate }}</a>
              <a class="text-indigo-600 dark:text-indigo-300" href="/api/v1/feeds/products.json" target="_blank" rel="noopener">{{ 'adminUi.maintenance.feed' | translate }}</a>
            </div>
          </section>

          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.lowStock.title' | translate }}</h2>
              <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.lowStock.hint' | translate }}</span>
            </div>
            <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
              <div *ngFor="let item of lowStock" class="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div>
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ item.name }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">{{ item.sku }} — {{ item.slug }}</p>
                </div>
                <span
                  class="text-xs rounded-full px-2 py-1 font-semibold"
                  [ngClass]="item.is_critical ? 'bg-rose-100 text-rose-900 dark:bg-rose-950/30 dark:text-rose-100' : 'bg-amber-100 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100'"
                >
                  {{ 'adminUi.lowStock.stockWithThreshold' | translate:{count: item.stock_quantity, threshold: item.threshold} }}
                </span>
              </div>
            </div>
          </section>

          <section *ngIf="section() === 'settings'" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <details class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30">
              <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                {{ 'adminUi.content.revisions.title' | translate }}
              </summary>
              <div class="mt-3 grid gap-3">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.content.revisions.select' | translate }}
                  <select
                    class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                    [(ngModel)]="settingsRevisionKey"
	                  >
	                    <option [ngValue]="'site.assets'">{{ 'adminUi.site.assets.title' | translate }}</option>
	                    <option [ngValue]="'site.social'">{{ 'adminUi.site.social.title' | translate }}</option>
	                    <option [ngValue]="'site.company'">{{ 'adminUi.site.company.title' | translate }}</option>
	                    <option [ngValue]="'site.checkout'">{{ 'adminUi.site.checkout.title' | translate }}</option>
	                    <option [ngValue]="'site.reports'">{{ 'adminUi.reports.title' | translate }}</option>
	                    <option [ngValue]="'seo.' + seoPage">{{ ('adminUi.site.seo.title' | translate) + ' · ' + seoPage.toUpperCase() }}</option>
	                  </select>
	                </label>
                <app-content-revisions [contentKey]="settingsRevisionKey" [titleKey]="settingsRevisionTitleKey()"></app-content-revisions>
              </div>
            </details>
          </section>
        </div>
	        <ng-template #loadingTpl>
	          <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	            <app-skeleton [rows]="6"></app-skeleton>
	          </div>
	        </ng-template>
	      </div>
	  `
})
export class AdminComponent implements OnInit, OnDestroy {
  crumbs = [
    { label: 'adminUi.nav.content', url: '/admin/content' },
    { label: 'adminUi.content.nav.home' }
  ];

  section = signal<AdminContentSection>('home');

  private readonly contentVersions: Record<string, number> = {};
  private routeSub?: Subscription;

  pagesRevisionKey = 'page.about';
  homeRevisionKey = 'home.sections';
  settingsRevisionKey = 'site.assets';

  summary = signal<AdminSummary | null>(null);
  loading = signal<boolean>(true);
  error = signal<string | null>(null);
  errorRequestId = signal<string | null>(null);

  products: AdminProduct[] = [];
  categories: AdminCategory[] = [];
  categoryName = '';
  categoryParentId = '';
  categoryTranslationsSlug: string | null = null;
  categoryTranslationsError = signal<string | null>(null);
  categoryTranslationExists: Record<'en' | 'ro', boolean> = { en: false, ro: false };
  categoryTranslations: Record<'en' | 'ro', { name: string; description: string }> = {
    en: this.blankCategoryTranslation(),
    ro: this.blankCategoryTranslation()
  };
  taxGroups: TaxGroupRead[] = [];
  taxGroupsLoading = false;
  taxGroupsError: string | null = null;
  taxGroupCreate = { code: '', name: '', description: '', is_default: false };
  taxRateCountry: Record<string, string> = {};
  taxRatePercent: Record<string, string> = {};
  maintenanceEnabledValue = false;
  maintenanceEnabled = signal<boolean>(false);
  draggingSlug: string | null = null;
  selectedIds = new Set<string>();
  allSelected = false;
  homeBlocksLang: UiLang = 'en';
  newHomeBlockType: 'text' | 'image' | 'gallery' | 'banner' | 'carousel' = 'text';
  homeBlocks: HomeBlockDraft[] = [];
  draggingHomeBlockKey: string | null = null;
  homeInsertDragActive = false;
  sectionsMessage = '';

  featuredCollections: FeaturedCollection[] = [];
  collectionForm: { name: string; description?: string | null; product_ids: string[] } = {
    name: '',
    description: '',
    product_ids: []
  };
  editingCollection: string | null = null;
  collectionMessage = '';

  formMessage = '';
  editingId: string | null = null;
  productDetail: AdminProductDetail | null = null;
  productImages = signal<{ id: string; url: string; alt_text?: string | null }[]>([]);
  form = {
    name: '',
    slug: '',
    category_id: '',
    price: 0,
    stock: 0,
    status: 'draft',
    sku: '',
    image: '',
    description: '',
    publish_at: '',
    is_bestseller: false
  };

  orders: AdminOrder[] = [];
  activeOrder: AdminOrder | null = null;
  orderFilter = '';

  users: AdminUser[] = [];
  selectedUserId: string | null = null;
  selectedUserRole: string | null = null;
  userAliases: AdminUserAliasesResponse | null = null;
  userAliasesLoading = false;
  userAliasesError: string | null = null;

  contentBlocks: AdminContent[] = [];
  selectedContent: AdminContent | null = null;
  contentForm = {
    title: '',
    body_markdown: '',
    status: 'draft'
  };
  showContentPreview = false;

	  showBlogCreate = false;
	  blogCreate: {
	    baseLang: 'en' | 'ro';
	    status: ContentStatusUi;
	    published_at: string;
	    published_until: string;
	    title: string;
    body_markdown: string;
    summary: string;
	    tags: string;
	    series: string;
	    cover_image_url: string;
	    reading_time_minutes: string;
	    pinned: boolean;
	    pin_order: string;
	    includeTranslation: boolean;
	    translationTitle: string;
	    translationBody: string;
	  } = {
	    baseLang: 'en',
	    status: 'draft',
	    published_at: '',
	    published_until: '',
	    title: '',
    body_markdown: '',
	    summary: '',
	    tags: '',
	    series: '',
	    cover_image_url: '',
	    reading_time_minutes: '',
	    pinned: false,
	    pin_order: '1',
    includeTranslation: false,
    translationTitle: '',
    translationBody: ''
  };
  selectedBlogKey: string | null = null;
  blogBaseLang: 'en' | 'ro' = 'en';
  blogEditLang: 'en' | 'ro' = 'en';
  blogForm = {
    title: '',
    body_markdown: '',
    status: 'draft',
    published_at: '',
    published_until: '',
	    summary: '',
	    tags: '',
	    series: '',
	    cover_image_url: '',
	    reading_time_minutes: '',
	    pinned: false,
	    pin_order: '1'
	  };
  blogMeta: Record<string, any> = {};
  blogImages: { id: string; url: string; alt_text?: string | null; sort_order: number; focal_x: number; focal_y: number }[] = [];
  blogBulkSelection = new Set<string>();
  blogBulkAction: 'publish' | 'unpublish' | 'schedule' | 'tags_add' | 'tags_remove' = 'publish';
  blogBulkPublishAt = '';
  blogBulkUnpublishAt = '';
  blogBulkTags = '';
  blogBulkSaving = false;
  blogBulkError = '';
  showBlogCoverLibrary = false;
  showBlogPreview = false;
  blogA11yOpen = false;
  useRichBlogEditor = true;
  blogImageLayout: 'default' | 'wide' | 'left' | 'right' | 'gallery' = 'default';
  blogSocialLangs: UiLang[] = ['en', 'ro'];
  blogPreviewUrl: string | null = null;
  blogPreviewToken: string | null = null;
  blogPreviewExpiresAt: string | null = null;
  blogVersions: ContentBlockVersionListItem[] = [];
  blogVersionDetail: ContentBlockVersionRead | null = null;
  blogDiffParts: { value: string; added?: boolean; removed?: boolean }[] = [];
  flaggedComments = signal<AdminBlogComment[]>([]);
  flaggedCommentsLoading = signal<boolean>(false);
  flaggedCommentsError: string | null = null;

  assetsForm = { logo_url: '', favicon_url: '', social_image_url: '' };
  assetsMessage: string | null = null;
  assetsError: string | null = null;
  socialForm: {
    phone: string;
    email: string;
    instagram_pages: Array<{ label: string; url: string; thumbnail_url: string }>;
    facebook_pages: Array<{ label: string; url: string; thumbnail_url: string }>;
  } = {
    phone: '+40723204204',
    email: 'momentstudio.ro@gmail.com',
    instagram_pages: [
      { label: 'Moments in Clay - Studio', url: 'https://www.instagram.com/moments_in_clay_studio?igsh=ZmdnZTdudnNieDQx', thumbnail_url: '' },
      { label: 'momentstudio', url: 'https://www.instagram.com/adrianaartizanat?igsh=ZmZmaDU1MGcxZHEy', thumbnail_url: '' }
    ],
    facebook_pages: [
      { label: 'Moments in Clay - Studio', url: 'https://www.facebook.com/share/17YqBmfX5x/', thumbnail_url: '' },
      { label: 'momentstudio', url: 'https://www.facebook.com/share/1APqKJM6Zi/', thumbnail_url: '' }
    ]
  };
  socialMessage: string | null = null;
  socialError: string | null = null;
  socialThumbLoading: Record<string, boolean> = {};
  socialThumbErrors: Record<string, string> = {};
  companyForm: {
    name: string;
    registration_number: string;
    cui: string;
    address: string;
    phone: string;
    email: string;
  } = {
    name: '',
    registration_number: '',
    cui: '',
    address: '',
    phone: '',
    email: ''
  };
  companyMessage: string | null = null;
  companyError: string | null = null;
	  checkoutSettingsForm: {
	    shipping_fee_ron: number | string;
	    free_shipping_threshold_ron: number | string;
	    phone_required_home: boolean;
	    phone_required_locker: boolean;
	    fee_enabled: boolean;
	    fee_type: 'flat' | 'percent';
	    fee_value: number | string;
	    vat_enabled: boolean;
	    vat_rate_percent: number | string;
	    vat_apply_to_shipping: boolean;
	    vat_apply_to_fee: boolean;
	    receipt_share_days: number | string;
	    money_rounding: 'half_up' | 'half_even' | 'up' | 'down';
	  } = {
	    shipping_fee_ron: 20,
	    free_shipping_threshold_ron: 300,
	    phone_required_home: true,
	    phone_required_locker: true,
	    fee_enabled: false,
	    fee_type: 'flat',
	    fee_value: 0,
	    vat_enabled: true,
	    vat_rate_percent: 10,
	    vat_apply_to_shipping: false,
	    vat_apply_to_fee: false,
	    receipt_share_days: 365,
	    money_rounding: 'half_up'
	  };
  checkoutSettingsMessage: string | null = null;
  checkoutSettingsError: string | null = null;
  reportsSettingsMeta: Record<string, any> = {};
  reportsSettingsForm: {
    weekly_enabled: boolean;
    weekly_weekday: number;
    weekly_hour_utc: number;
    monthly_enabled: boolean;
    monthly_day: number | string;
    monthly_hour_utc: number;
    recipients: string;
  } = {
    weekly_enabled: false,
    weekly_weekday: 0,
    weekly_hour_utc: 8,
    monthly_enabled: false,
    monthly_day: 1,
    monthly_hour_utc: 8,
    recipients: ''
  };
  reportsWeeklyLastSent: string | null = null;
  reportsWeeklyLastError: string | null = null;
  reportsMonthlyLastSent: string | null = null;
  reportsMonthlyLastError: string | null = null;
  reportsSettingsMessage: string | null = null;
  reportsSettingsError: string | null = null;
  reportsSending = false;
  readonly reportsWeekdays = [
    { value: 0, labelKey: 'adminUi.reports.weekdays.mon' },
    { value: 1, labelKey: 'adminUi.reports.weekdays.tue' },
    { value: 2, labelKey: 'adminUi.reports.weekdays.wed' },
    { value: 3, labelKey: 'adminUi.reports.weekdays.thu' },
    { value: 4, labelKey: 'adminUi.reports.weekdays.fri' },
    { value: 5, labelKey: 'adminUi.reports.weekdays.sat' },
    { value: 6, labelKey: 'adminUi.reports.weekdays.sun' }
  ];
  readonly reportsHours = Array.from({ length: 24 }, (_, hour) => hour);
  seoLang: 'en' | 'ro' = 'en';
  seoPage: 'home' | 'shop' | 'product' | 'category' | 'about' = 'home';
  seoForm = { title: '', description: '' };
  seoMessage: string | null = null;
  seoError: string | null = null;
  sitemapPreviewLoading = false;
  sitemapPreviewError: string | null = null;
  sitemapPreviewByLang: Record<string, string[]> | null = null;
  structuredDataLoading = false;
  structuredDataError: string | null = null;
  structuredDataResult: StructuredDataValidationResponse | null = null;
  infoLang: UiLang = 'en';
  infoForm: { about: LocalizedText; faq: LocalizedText; shipping: LocalizedText; contact: LocalizedText } = {
    about: { en: '', ro: '' },
    faq: { en: '', ro: '' },
    shipping: { en: '', ro: '' },
    contact: { en: '', ro: '' }
  };
  infoMessage: string | null = null;
  infoError: string | null = null;
  contentPages: ContentPageListItem[] = [];
  contentPagesLoading = false;
  contentPagesError: string | null = null;
  redirects: ContentRedirectRead[] = [];
  redirectsMeta = { total_items: 0, total_pages: 1, page: 1, limit: 25 };
  redirectsLoading = false;
  redirectsError: string | null = null;
  redirectsQuery = '';
  redirectsExporting = false;
  redirectsImporting = false;
  redirectsImportResult: ContentRedirectImportResult | null = null;
  linkCheckKey = 'page.about';
  linkCheckLoading = false;
  linkCheckError: string | null = null;
  linkCheckIssues: ContentLinkCheckIssue[] = [];
  newCustomPageTitle = '';
  newCustomPageStatus: ContentStatusUi = 'draft';
  newCustomPagePublishedAt = '';
  newCustomPagePublishedUntil = '';
  creatingCustomPage = false;
  pageBlocksKey: PageBuilderKey = 'page.about';
  newPageBlockType: PageBlockType = 'text';
  pageBlocks: Record<string, PageBlockDraft[]> = {};
  pageBlocksMeta: Record<string, Record<string, unknown>> = {};
  pageBlocksRequiresAuth: Record<string, boolean> = {};
  pageBlocksStatus: Record<string, ContentStatusUi> = {};
  pageBlocksPublishedAt: Record<string, string> = {};
  pageBlocksPublishedUntil: Record<string, string> = {};
  pageBlocksMessage: Record<string, string | null> = {};
  pageBlocksError: Record<string, string | null> = {};
  pageBlocksNeedsTranslationEn: Record<string, boolean> = {};
	  pageBlocksNeedsTranslationRo: Record<string, boolean> = {};
	  pageBlocksTranslationSaving: Record<string, boolean> = {};
	  draggingPageBlockKey: string | null = null;
	  draggingPageBlocksKey: string | null = null;
	  pageInsertDragActive = false;
	  cmsAriaAnnouncement = '';
	  private cmsDraftPoller: number | null = null;
	  private cmsHomeDraft = new CmsDraftManager<HomeBlockDraft[]>('adrianaart.cms.autosave.home.sections');
	  private cmsPageDrafts = new Map<string, CmsDraftManager<PageBlocksDraftState>>();
	  private cmsBlogDrafts = new Map<string, CmsDraftManager<BlogDraftState>>();
	  coupons: AdminCoupon[] = [];
	  newCoupon: Partial<AdminCoupon> = { code: '', percentage_off: 0, active: true, currency: 'RON' };
	  stockEdits: Record<string, number> = {};
	  bulkStock: number | null = null;

  fxStatus = signal<FxAdminStatus | null>(null);
  fxLoading = signal<boolean>(false);
  fxError = signal<string | null>(null);
  fxOverrideForm: { eur_per_ron: number; usd_per_ron: number; as_of: string } = { eur_per_ron: 0, usd_per_ron: 0, as_of: '' };
  fxAudit = signal<FxOverrideAuditEntry[]>([]);
  fxAuditLoading = signal(false);
  fxAuditError = signal<string | null>(null);
  fxAuditRestoring = signal<string | null>(null);

  productAudit: AdminAudit['products'] = [];
  contentAudit: AdminAudit['content'] = [];
  securityAudit: NonNullable<AdminAudit['security']> = [];
  lowStock: LowStockItem[] = [];

  ownerTransferIdentifier = '';
  ownerTransferConfirm = '';
  ownerTransferPassword = '';
  ownerTransferLoading = false;
  ownerTransferError: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private admin: AdminService,
    private blog: BlogService,
    private fxAdmin: FxAdminService,
    private taxesAdmin: TaxesAdminService,
    private auth: AuthService,
    public cmsPrefs: CmsEditorPrefsService,
    private toast: ToastService,
    private translate: TranslateService,
    private markdown: MarkdownService
  ) {}

	  private t(key: string, params?: Record<string, unknown>): string {
	    return this.translate.instant(key, params);
	  }

	  private announceCms(message: string): void {
	    this.cmsAriaAnnouncement = '';
	    window.setTimeout(() => {
	      this.cmsAriaAnnouncement = message;
	    }, 10);
	  }

	  private observeCmsDrafts(): void {
	    if (this.cmsHomeDraft.isReady()) {
	      this.cmsHomeDraft.observe(this.homeBlocks);
	    }

	    const pageKey = this.pageBlocksKey;
	    const pageDraft = this.ensurePageDraft(pageKey);
	    if (pageDraft.isReady()) {
	      pageDraft.observe(this.currentPageDraftState(pageKey));
	    }

	    const blogKey = this.selectedBlogKey;
	    if (blogKey) {
	      const id = this.blogDraftId(blogKey, this.blogEditLang);
	      const manager = this.cmsBlogDrafts.get(id);
	      if (manager?.isReady()) {
	        manager.observe(this.currentBlogDraftState());
	      }
	    }
	  }

	  private ensurePageDraft(pageKey: PageBuilderKey): CmsDraftManager<PageBlocksDraftState> {
	    const existing = this.cmsPageDrafts.get(pageKey);
	    if (existing) return existing;
	    const created = new CmsDraftManager<PageBlocksDraftState>(`adrianaart.cms.autosave.${pageKey}`);
	    this.cmsPageDrafts.set(pageKey, created);
	    return created;
	  }

	  private currentPageDraftState(pageKey: PageBuilderKey): PageBlocksDraftState {
	    return {
	      blocks: this.pageBlocks[pageKey] || [],
	      status: this.pageBlocksStatus[pageKey] || 'draft',
	      publishedAt: this.pageBlocksPublishedAt[pageKey] || '',
	      publishedUntil: this.pageBlocksPublishedUntil[pageKey] || '',
	      requiresAuth: Boolean(this.pageBlocksRequiresAuth[pageKey])
	    };
	  }

	  private applyPageDraftState(pageKey: PageBuilderKey, draft: PageBlocksDraftState): void {
	    this.pageBlocks[pageKey] = Array.isArray(draft?.blocks) ? draft.blocks : [];
	    this.pageBlocksStatus[pageKey] = draft?.status === 'published' ? 'published' : draft?.status === 'review' ? 'review' : 'draft';
	    this.pageBlocksPublishedAt[pageKey] = draft?.publishedAt || '';
	    this.pageBlocksPublishedUntil[pageKey] = draft?.publishedUntil || '';
	    this.pageBlocksRequiresAuth[pageKey] = Boolean(draft?.requiresAuth);
	  }

	  private blogDraftId(key: string, lang: UiLang): string {
	    return `${key}.${lang}`;
	  }

	  private ensureBlogDraft(key: string, lang: UiLang): CmsDraftManager<BlogDraftState> {
	    const id = this.blogDraftId(key, lang);
	    const existing = this.cmsBlogDrafts.get(id);
	    if (existing) return existing;
	    const created = new CmsDraftManager<BlogDraftState>(`adrianaart.cms.autosave.${id}`);
	    this.cmsBlogDrafts.set(id, created);
	    return created;
	  }

	  private currentBlogDraftState(): BlogDraftState {
	    return {
	      title: this.blogForm.title,
	      body_markdown: this.blogForm.body_markdown,
	      status:
	        this.blogForm.status === 'published'
	          ? 'published'
	          : this.blogForm.status === 'review'
	            ? 'review'
	            : 'draft',
	      published_at: this.blogForm.published_at,
	      published_until: this.blogForm.published_until,
	      summary: this.blogForm.summary,
	      tags: this.blogForm.tags,
	      series: this.blogForm.series,
	      cover_image_url: this.blogForm.cover_image_url,
	      reading_time_minutes: this.blogForm.reading_time_minutes,
	      pinned: Boolean(this.blogForm.pinned),
	      pin_order: this.blogForm.pin_order
	    };
	  }

	  private applyBlogDraftState(draft: BlogDraftState): void {
	    this.blogForm = {
	      ...this.blogForm,
	      ...draft
	    };
	  }

	  blogDraftReady(): boolean {
	    if (!this.selectedBlogKey) return false;
	    const id = this.blogDraftId(this.selectedBlogKey, this.blogEditLang);
	    const manager = this.cmsBlogDrafts.get(id);
	    return manager?.isReady() ?? false;
	  }

	  blogDraftDirty(): boolean {
	    if (!this.selectedBlogKey) return false;
	    const id = this.blogDraftId(this.selectedBlogKey, this.blogEditLang);
	    return this.cmsBlogDrafts.get(id)?.dirty ?? false;
	  }

	  blogDraftAutosaving(): boolean {
	    if (!this.selectedBlogKey) return false;
	    const id = this.blogDraftId(this.selectedBlogKey, this.blogEditLang);
	    return this.cmsBlogDrafts.get(id)?.autosavePending ?? false;
	  }

	  blogDraftLastAutosavedAt(): string | null {
	    if (!this.selectedBlogKey) return null;
	    const id = this.blogDraftId(this.selectedBlogKey, this.blogEditLang);
	    return this.cmsBlogDrafts.get(id)?.lastAutosavedAt ?? null;
	  }

	  blogDraftHasRestore(): boolean {
	    if (!this.selectedBlogKey) return false;
	    const manager = this.ensureBlogDraft(this.selectedBlogKey, this.blogEditLang);
	    return manager.hasRestorableAutosave && !manager.dirty;
	  }

	  blogDraftRestoreAt(): string | null {
	    if (!this.selectedBlogKey) return null;
	    const manager = this.ensureBlogDraft(this.selectedBlogKey, this.blogEditLang);
	    return manager.restorableAutosaveAt;
	  }

	  restoreBlogDraftAutosave(): void {
	    if (!this.selectedBlogKey) return;
	    const manager = this.ensureBlogDraft(this.selectedBlogKey, this.blogEditLang);
	    const next = manager.restoreAutosave(this.currentBlogDraftState());
	    if (next) this.applyBlogDraftState(next);
	  }

	  dismissBlogDraftAutosave(): void {
	    if (!this.selectedBlogKey) return;
	    const manager = this.ensureBlogDraft(this.selectedBlogKey, this.blogEditLang);
	    manager.discardAutosave();
	  }

	  homeDraftReady(): boolean {
	    return this.cmsHomeDraft.isReady();
	  }

	  homeDraftDirty(): boolean {
	    return this.cmsHomeDraft.dirty;
	  }

	  homeDraftAutosaving(): boolean {
	    return this.cmsHomeDraft.autosavePending;
	  }

	  homeDraftLastAutosavedAt(): string | null {
	    return this.cmsHomeDraft.lastAutosavedAt;
	  }

	  homeDraftHasRestore(): boolean {
	    return this.cmsHomeDraft.hasRestorableAutosave && !this.cmsHomeDraft.dirty;
	  }

	  homeDraftRestoreAt(): string | null {
	    return this.cmsHomeDraft.restorableAutosaveAt;
	  }

	  homeDraftCanUndo(): boolean {
	    return this.cmsHomeDraft.canUndo(this.homeBlocks);
	  }

	  homeDraftCanRedo(): boolean {
	    return this.cmsHomeDraft.canRedo(this.homeBlocks);
	  }

	  undoHomeDraft(): void {
	    const next = this.cmsHomeDraft.undo(this.homeBlocks);
	    if (next) this.homeBlocks = next;
	  }

	  redoHomeDraft(): void {
	    const next = this.cmsHomeDraft.redo(this.homeBlocks);
	    if (next) this.homeBlocks = next;
	  }

	  restoreHomeDraftAutosave(): void {
	    const next = this.cmsHomeDraft.restoreAutosave(this.homeBlocks);
	    if (next) this.homeBlocks = next;
	  }

	  dismissHomeDraftAutosave(): void {
	    this.cmsHomeDraft.discardAutosave();
	  }

	  pageDraftReady(pageKey: PageBuilderKey): boolean {
	    return this.ensurePageDraft(pageKey).isReady();
	  }

	  pageDraftDirty(pageKey: PageBuilderKey): boolean {
	    return this.ensurePageDraft(pageKey).dirty;
	  }

	  pageDraftAutosaving(pageKey: PageBuilderKey): boolean {
	    return this.ensurePageDraft(pageKey).autosavePending;
	  }

	  pageDraftLastAutosavedAt(pageKey: PageBuilderKey): string | null {
	    return this.ensurePageDraft(pageKey).lastAutosavedAt;
	  }

	  pageDraftHasRestore(pageKey: PageBuilderKey): boolean {
	    const manager = this.ensurePageDraft(pageKey);
	    return manager.hasRestorableAutosave && !manager.dirty;
	  }

	  pageDraftRestoreAt(pageKey: PageBuilderKey): string | null {
	    return this.ensurePageDraft(pageKey).restorableAutosaveAt;
	  }

	  pageDraftCanUndo(pageKey: PageBuilderKey): boolean {
	    const manager = this.ensurePageDraft(pageKey);
	    return manager.canUndo(this.currentPageDraftState(pageKey));
	  }

	  pageDraftCanRedo(pageKey: PageBuilderKey): boolean {
	    const manager = this.ensurePageDraft(pageKey);
	    return manager.canRedo(this.currentPageDraftState(pageKey));
	  }

	  undoPageDraft(pageKey: PageBuilderKey): void {
	    const manager = this.ensurePageDraft(pageKey);
	    const next = manager.undo(this.currentPageDraftState(pageKey));
	    if (next) this.applyPageDraftState(pageKey, next);
	  }

	  redoPageDraft(pageKey: PageBuilderKey): void {
	    const manager = this.ensurePageDraft(pageKey);
	    const next = manager.redo(this.currentPageDraftState(pageKey));
	    if (next) this.applyPageDraftState(pageKey, next);
	  }

	  restorePageDraftAutosave(pageKey: PageBuilderKey): void {
	    const manager = this.ensurePageDraft(pageKey);
	    const next = manager.restoreAutosave(this.currentPageDraftState(pageKey));
	    if (next) this.applyPageDraftState(pageKey, next);
	  }

	  dismissPageDraftAutosave(pageKey: PageBuilderKey): void {
	    this.ensurePageDraft(pageKey).discardAutosave();
	  }

  private rememberContentVersion(key: string, block: { version?: number } | null | undefined): void {
    const version = block?.version;
    if (typeof version === 'number' && Number.isFinite(version) && version > 0) {
      this.contentVersions[key] = version;
    }
  }

  private expectedVersion(key: string): number | undefined {
    const version = this.contentVersions[key];
    return typeof version === 'number' && Number.isFinite(version) && version > 0 ? version : undefined;
  }

  private withExpectedVersion<T extends Record<string, unknown>>(key: string, payload: T): T & { expected_version?: number } {
    const expected = this.expectedVersion(key);
    return expected ? { ...payload, expected_version: expected } : payload;
  }

  private handleContentConflict(err: any, key: string, reload: () => void): boolean {
    if (err?.status !== 409) return false;
    this.toast.error(this.t('adminUi.content.errors.conflictTitle'), this.t('adminUi.content.errors.conflictCopy'));
    delete this.contentVersions[key];
    reload();
    return true;
  }

  pagesRevisionTitleKey(): string {
    switch (this.pagesRevisionKey) {
      case 'page.about':
        return 'adminUi.site.pages.aboutLabel';
      case 'page.faq':
        return 'adminUi.site.pages.faqLabel';
      case 'page.shipping':
        return 'adminUi.site.pages.shippingLabel';
      case 'page.contact':
        return 'adminUi.site.pages.contactLabel';
      default:
        return 'adminUi.content.revisions.title';
    }
  }

  homeRevisionTitleKey(): string {
    switch (this.homeRevisionKey) {
      case 'home.sections':
        return 'adminUi.home.sections.title';
      case 'home.story':
        return 'adminUi.home.story.title';
      default:
        return 'adminUi.content.revisions.title';
    }
  }

  settingsRevisionTitleKey(): string {
    if ((this.settingsRevisionKey || '').startsWith('seo.')) {
      return 'adminUi.site.seo.title';
    }
    switch (this.settingsRevisionKey) {
      case 'site.assets':
        return 'adminUi.site.assets.title';
      case 'site.social':
        return 'adminUi.site.social.title';
      case 'site.company':
        return 'adminUi.site.company.title';
      case 'site.checkout':
        return 'adminUi.site.checkout.title';
      case 'site.reports':
        return 'adminUi.reports.title';
      default:
        return 'adminUi.content.revisions.title';
    }
  }

  isOwner(): boolean {
    return this.auth.role() === 'owner';
  }

  cmsAdvanced(): boolean {
    return this.cmsPrefs.mode() === 'advanced';
  }

  cmsPreviewMaxWidthClass(): string {
    switch (this.cmsPrefs.previewDevice()) {
      case 'mobile':
        return 'max-w-[390px]';
      case 'tablet':
        return 'max-w-[768px]';
      default:
        return 'max-w-[1024px]';
    }
  }

  private previewScrollSyncActive = false;

  syncSplitScroll(source: HTMLElement, target: HTMLElement): void {
    if (this.cmsPrefs.previewLayout() !== 'split') return;
    if (this.previewScrollSyncActive) return;

    const sourceScrollable = source.scrollHeight - source.clientHeight;
    const targetScrollable = target.scrollHeight - target.clientHeight;
    if (sourceScrollable <= 0 || targetScrollable <= 0) return;

    const ratio = sourceScrollable ? source.scrollTop / sourceScrollable : 0;
    this.previewScrollSyncActive = true;
    target.scrollTop = ratio * targetScrollable;

    requestAnimationFrame(() => {
      this.previewScrollSyncActive = false;
    });
  }

	  ngOnInit(): void {
	    this.routeSub = combineLatest([this.route.data, this.route.queryParams]).subscribe(([data, query]) => {
	      const next = this.normalizeSection(data['section']);
	      this.applySection(next);
        if (next !== 'blog') return;
        const raw = typeof query['edit'] === 'string' ? query['edit'] : '';
        const cleaned = raw.trim();
        if (!cleaned) return;
        const key = cleaned.startsWith('blog.') ? cleaned : `blog.${cleaned}`;
        if (this.selectedBlogKey === key) return;
        this.loadBlogEditor(key);
	    });
	    if (typeof window !== 'undefined') {
	      this.cmsDraftPoller = window.setInterval(() => this.observeCmsDrafts(), 250);
	    }
	  }

	  ngOnDestroy(): void {
	    this.routeSub?.unsubscribe();
	    this.routeSub = undefined;
	    if (this.cmsDraftPoller !== null) {
	      window.clearInterval(this.cmsDraftPoller);
	      this.cmsDraftPoller = null;
	    }
	    this.cmsHomeDraft.dispose();
	    for (const manager of this.cmsPageDrafts.values()) manager.dispose();
	    for (const manager of this.cmsBlogDrafts.values()) manager.dispose();
	    for (const key of Object.keys(this.contentVersions)) {
	      delete this.contentVersions[key];
	    }
	  }

  loadAll(): void {
    this.loadForSection(this.section());
  }

  retryLoadAll(): void {
    this.loadAll();
  }

  private normalizeSection(value: unknown): AdminContentSection {
    if (value === 'home' || value === 'pages' || value === 'blog' || value === 'settings') return value;
    return 'home';
  }

  private applySection(next: AdminContentSection): void {
    if (this.section() === next) {
      this.loadForSection(next);
      return;
    }
    this.section.set(next);
    this.crumbs = [
      { label: 'adminUi.nav.content', url: '/admin/content' },
      { label: `adminUi.content.nav.${next}` }
    ];
    this.resetSectionState(next);
    this.loadForSection(next);
  }

  private resetSectionState(next: AdminContentSection): void {
    this.error.set(null);
    this.errorRequestId.set(null);
    if (next !== 'blog') {
      this.closeBlogEditor();
      this.showBlogCreate = false;
      this.flaggedComments.set([]);
      this.flaggedCommentsError = null;
    }
    if (next !== 'settings') {
      this.selectedContent = null;
      this.showContentPreview = false;
    }
  }

  private loadForSection(section: AdminContentSection): void {
    this.loading.set(true);
    this.error.set(null);
    this.errorRequestId.set(null);

    if (section === 'home') {
      this.admin.products().subscribe({ next: (p) => (this.products = p), error: () => (this.products = []) });
      this.loadSections();
      this.loadCollections();
      this.loading.set(false);
      return;
    }

    if (section === 'pages') {
      this.loadInfo();
      this.loadContentPages();
      this.loadPageBlocks(this.pageBlocksKey);
      this.loadContentRedirects(true);
      this.loading.set(false);
      return;
    }

    if (section === 'blog') {
      this.reloadContentBlocks();
      this.loadFlaggedComments();
      this.loading.set(false);
      return;
    }

    // settings
    this.reloadContentBlocks();
    this.admin.coupons().subscribe({ next: (c) => (this.coupons = c), error: () => (this.coupons = []) });
    this.admin.lowStock().subscribe({ next: (items) => (this.lowStock = items), error: () => (this.lowStock = []) });
    this.admin.audit().subscribe({
      next: (logs) => {
        this.productAudit = logs.products;
        this.contentAudit = logs.content;
        this.securityAudit = logs.security ?? [];
      },
      error: () => this.toast.error(this.t('adminUi.audit.errors.loadTitle'), this.t('adminUi.audit.errors.loadCopy'))
    });
    this.admin.getCategories().subscribe({
      next: (cats) => {
        this.categories = cats
          .map((c) => ({ ...c, sort_order: c.sort_order ?? 0 }))
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      },
      error: () => (this.categories = [])
    });
    this.loadTaxGroups();
    this.loadAssets();
    this.loadSocial();
    this.loadCompany();
    this.loadCheckoutSettings();
    this.loadReportsSettings();
    this.loadSeo();
    this.loadFxStatus();
    this.admin.getMaintenance().subscribe({
      next: (m) => {
        this.maintenanceEnabled.set(m.enabled);
        this.maintenanceEnabledValue = m.enabled;
      }
    });
    this.loading.set(false);
  }

  loadAudit(): void {
    this.admin.audit().subscribe({
      next: (logs) => {
        this.productAudit = logs.products;
        this.contentAudit = logs.content;
        this.securityAudit = logs.security ?? [];
      },
      error: () => {
        this.toast.error(this.t('adminUi.audit.errors.loadTitle'), this.t('adminUi.audit.errors.loadCopy'));
      }
    });
  }

  submitOwnerTransfer(): void {
    if (!this.isOwner()) return;
    this.ownerTransferError = null;
    const identifier = this.ownerTransferIdentifier.trim();
    const confirm = this.ownerTransferConfirm.trim();
    const password = this.ownerTransferPassword;
    if (!identifier) {
      this.ownerTransferError = this.t('adminUi.ownerTransfer.errors.identifier');
      return;
    }
    this.ownerTransferLoading = true;
    this.admin.transferOwner({ identifier, confirm, password }).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.ownerTransfer.successTitle'), this.t('adminUi.ownerTransfer.successCopy'));
        this.ownerTransferPassword = '';
        this.ownerTransferConfirm = '';
        this.ownerTransferIdentifier = '';
        this.auth.loadCurrentUser().subscribe();
        this.loadAudit();
      },
      error: (err) => {
        const detail = err?.error?.detail;
        this.ownerTransferError = typeof detail === 'string' && detail ? detail : this.t('adminUi.ownerTransfer.errors.generic');
        this.ownerTransferLoading = false;
      },
      complete: () => {
        this.ownerTransferLoading = false;
      }
    });
  }

  loadFxStatus(): void {
    this.fxLoading.set(true);
    this.fxError.set(null);
    this.loadFxAudit();
    this.fxAdmin.getStatus().subscribe({
      next: (status) => {
        this.fxStatus.set(status);
        const current = status.override ?? status.effective;
        this.fxOverrideForm = {
          eur_per_ron: Number(current.eur_per_ron) || 0,
          usd_per_ron: Number(current.usd_per_ron) || 0,
          as_of: current.as_of || ''
        };
      },
      error: () => {
        this.fxError.set(this.t('adminUi.fx.errors.load'));
      },
      complete: () => {
        this.fxLoading.set(false);
      }
    });
  }

  loadFxAudit(): void {
    this.fxAuditLoading.set(true);
    this.fxAuditError.set(null);
    this.fxAdmin.listOverrideAudit(50).subscribe({
      next: (items) => {
        this.fxAudit.set(Array.isArray(items) ? items : []);
      },
      error: () => {
        this.fxAudit.set([]);
        this.fxAuditError.set(this.t('adminUi.fx.audit.errors.load'));
      },
      complete: () => {
        this.fxAuditLoading.set(false);
      }
    });
  }

  fxAuditActionLabel(action: string): string {
    const normalized = (action || '').trim().toLowerCase();
    const key = `adminUi.fx.audit.actions.${normalized}`;
    const translated = this.t(key);
    return translated === key ? action : translated;
  }

  restoreFxOverrideFromAudit(entry: FxOverrideAuditEntry): void {
    const id = (entry?.id || '').toString().trim();
    if (!id) return;
    if (!confirm(this.t('adminUi.fx.audit.confirmRestore'))) return;
    this.fxAuditRestoring.set(id);
    this.fxAdmin.restoreOverrideFromAudit(id).subscribe({
      next: (status) => {
        this.fxStatus.set(status);
        const current = status.override ?? status.effective;
        this.fxOverrideForm = {
          eur_per_ron: Number(current.eur_per_ron) || 0,
          usd_per_ron: Number(current.usd_per_ron) || 0,
          as_of: current.as_of || ''
        };
        this.toast.success(this.t('adminUi.fx.success.overrideRestored'));
        this.loadFxAudit();
      },
      error: () => {
        this.toast.error(this.t('adminUi.fx.audit.errors.restore'));
      },
      complete: () => {
        this.fxAuditRestoring.set(null);
      }
    });
  }

  resetFxOverrideForm(): void {
    const status = this.fxStatus();
    if (!status) return;
    const current = status.override ?? status.effective;
    this.fxOverrideForm = {
      eur_per_ron: Number(current.eur_per_ron) || 0,
      usd_per_ron: Number(current.usd_per_ron) || 0,
      as_of: current.as_of || ''
    };
  }

  saveFxOverride(): void {
    const eur = Number(this.fxOverrideForm.eur_per_ron);
    const usd = Number(this.fxOverrideForm.usd_per_ron);
    const asOf = (this.fxOverrideForm.as_of || '').trim();
    if (!(eur > 0) || !(usd > 0)) {
      this.toast.error(this.t('adminUi.fx.errors.invalid'));
      return;
    }

    this.fxAdmin
      .setOverride({
        eur_per_ron: eur,
        usd_per_ron: usd,
        as_of: asOf ? asOf : null
      })
      .subscribe({
        next: () => {
          this.toast.success(this.t('adminUi.fx.success.overrideSet'));
          this.loadFxStatus();
        },
        error: () => this.toast.error(this.t('adminUi.fx.errors.overrideSet'))
      });
  }

  clearFxOverride(): void {
    const status = this.fxStatus();
    if (!status?.override) return;
    if (!confirm(this.t('adminUi.fx.confirmClear'))) return;
    this.fxAdmin.clearOverride().subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.fx.success.overrideCleared'));
        this.loadFxStatus();
      },
      error: () => this.toast.error(this.t('adminUi.fx.errors.overrideCleared'))
    });
  }

  startNewProduct(): void {
    this.editingId = null;
    this.productDetail = null;
    this.productImages.set([]);
    this.form = {
      name: '',
      slug: '',
      category_id: this.categories[0]?.id || '',
      price: 0,
      stock: 0,
      status: 'draft',
      sku: '',
      image: '',
      description: '',
      publish_at: '',
      is_bestseller: false
    };
  }

  loadProduct(slug: string): void {
    this.admin.getProduct(slug).subscribe({
      next: (prod) => {
        this.productDetail = prod;
        this.editingId = prod.slug;
        this.form = {
          name: prod.name,
          slug: prod.slug,
          category_id: prod.category_id || '',
          price: prod.price,
          stock: prod.stock_quantity,
          status: prod.status,
          sku: (prod as any).sku || '',
          image: '',
          description: prod.long_description || '',
          publish_at: prod.publish_at ? this.toLocalDateTime(prod.publish_at) : '',
          is_bestseller: (prod.tags || []).includes('bestseller')
        };
        this.productImages.set((prod as any).images || []);
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.load'))
    });
  }

  saveProduct(): void {
    const payload: Partial<AdminProductDetail> = {
      name: this.form.name,
      slug: this.form.slug,
      category_id: this.form.category_id,
      base_price: this.form.price,
      stock_quantity: this.form.stock,
      status: this.form.status as any,
      short_description: this.form.description,
      long_description: this.form.description,
      sku: this.form.sku,
      publish_at: this.form.publish_at ? new Date(this.form.publish_at).toISOString() : null,
      tags: this.buildTags()
    } as any;
    const op = this.editingId
      ? this.admin.updateProduct(this.editingId, payload)
      : this.admin.createProduct(payload);
    op.subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.products.success.save'));
        this.loadAll();
        this.startNewProduct();
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.save'))
    });
  }

  deleteSelected(): void {
    if (!this.selectedIds.size) return;
    const ids = Array.from(this.selectedIds);
    const target = this.products.find((p) => p.id === ids[0]);
    if (!target) return;
    this.admin.deleteProduct(target.slug).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.products.success.delete'));
        this.products = this.products.filter((p) => !this.selectedIds.has(p.id));
        this.selectedIds.clear();
        this.computeAllSelected();
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.delete'))
    });
  }

  addCategory(): void {
    if (!this.categoryName) {
      this.toast.error(this.t('adminUi.products.errors.required'));
      return;
    }
    const parent_id = (this.categoryParentId || '').trim() || null;
    this.admin.createCategory({ name: this.categoryName, parent_id }).subscribe({
      next: (cat) => {
        this.categories = [cat, ...this.categories];
        this.categoryName = '';
        this.categoryParentId = '';
        this.toast.success(this.t('adminUi.categories.success.add'));
      },
      error: () => this.toast.error(this.t('adminUi.categories.errors.add'))
    });
  }

  loadTaxGroups(): void {
    this.taxGroupsLoading = true;
    this.taxGroupsError = null;
    this.taxesAdmin.listGroups().subscribe({
      next: (groups) => {
        this.taxGroups = Array.isArray(groups) ? groups : [];
        this.taxGroupsLoading = false;
      },
      error: (err) => {
        this.taxGroupsLoading = false;
        this.taxGroups = [];
        this.taxGroupsError = err?.error?.detail || this.t('adminUi.taxes.errors.load');
      }
    });
  }

  createTaxGroup(): void {
    const code = (this.taxGroupCreate.code || '').trim();
    const name = (this.taxGroupCreate.name || '').trim();
    if (!code || !name) {
      this.toast.error(this.t('adminUi.taxes.errors.required'));
      return;
    }
    this.taxesAdmin
      .createGroup({
        code,
        name,
        description: (this.taxGroupCreate.description || '').trim() || null,
        is_default: !!this.taxGroupCreate.is_default
      })
      .subscribe({
        next: () => {
          this.taxGroupCreate = { code: '', name: '', description: '', is_default: false };
          this.toast.success(this.t('adminUi.taxes.success.create'));
          this.loadTaxGroups();
        },
        error: (err) => this.toast.error(err?.error?.detail || this.t('adminUi.taxes.errors.create'))
      });
  }

  saveTaxGroup(group: TaxGroupRead): void {
    const name = (group.name || '').trim();
    if (!name) {
      this.toast.error(this.t('adminUi.taxes.errors.required'));
      return;
    }
    this.taxesAdmin
      .updateGroup(group.id, { name, description: (group.description || '').trim() || null })
      .subscribe({
        next: () => {
          this.toast.success(this.t('adminUi.taxes.success.update'));
          this.loadTaxGroups();
        },
        error: (err) => this.toast.error(err?.error?.detail || this.t('adminUi.taxes.errors.update'))
      });
  }

  setDefaultTaxGroup(group: TaxGroupRead): void {
    if (group.is_default) return;
    this.taxesAdmin.updateGroup(group.id, { is_default: true }).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.taxes.success.default'));
        this.loadTaxGroups();
      },
      error: (err) => this.toast.error(err?.error?.detail || this.t('adminUi.taxes.errors.update'))
    });
  }

  deleteTaxGroup(group: TaxGroupRead): void {
    if (group.is_default) {
      this.toast.error(this.t('adminUi.taxes.errors.deleteDefault'));
      return;
    }
    this.taxesAdmin.deleteGroup(group.id).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.taxes.success.delete'));
        this.loadTaxGroups();
      },
      error: (err) => this.toast.error(err?.error?.detail || this.t('adminUi.taxes.errors.delete'))
    });
  }

  upsertTaxRate(group: TaxGroupRead): void {
    const rawCountry = (this.taxRateCountry[group.id] || '').trim();
    const rawRate = String(this.taxRatePercent[group.id] || '').trim();
    const vat = Number(rawRate);
    if (!rawCountry || !Number.isFinite(vat)) {
      this.toast.error(this.t('adminUi.taxes.errors.rateInvalid'));
      return;
    }
    this.taxesAdmin.upsertRate(group.id, { country_code: rawCountry, vat_rate_percent: vat }).subscribe({
      next: () => {
        this.taxRateCountry[group.id] = '';
        this.taxRatePercent[group.id] = '';
        this.toast.success(this.t('adminUi.taxes.success.rate'));
        this.loadTaxGroups();
      },
      error: (err) => this.toast.error(err?.error?.detail || this.t('adminUi.taxes.errors.rate'))
    });
  }

  deleteTaxRate(group: TaxGroupRead, countryCode: string): void {
    const code = (countryCode || '').trim();
    if (!code) return;
    this.taxesAdmin.deleteRate(group.id, code).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.taxes.success.rateDelete'));
        this.loadTaxGroups();
      },
      error: (err) => this.toast.error(err?.error?.detail || this.t('adminUi.taxes.errors.rateDelete'))
    });
  }

  categoryParentLabel(cat: AdminCategory): string {
    const parentId = (cat.parent_id ?? '').trim();
    if (!parentId) return this.t('adminUi.categories.parentNone');
    return this.categories.find((c) => c.id === parentId)?.name ?? this.t('adminUi.categories.parentNone');
  }

  categoryParentOptions(cat: AdminCategory): AdminCategory[] {
    const currentId = cat.id;
    const excluded = this.categoryDescendantIds(currentId);
    excluded.add(currentId);
    return this.categories
      .filter((candidate) => !excluded.has(candidate.id))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }

  private categoryDescendantIds(rootId: string): Set<string> {
    const childrenByParent = new Map<string, string[]>();
    for (const cat of this.categories) {
      const parentId = (cat.parent_id ?? '').trim();
      if (!parentId) continue;
      const bucket = childrenByParent.get(parentId);
      if (bucket) {
        bucket.push(cat.id);
      } else {
        childrenByParent.set(parentId, [cat.id]);
      }
    }
    const resolved = new Set<string>();
    const stack = [...(childrenByParent.get(rootId) ?? [])];
    while (stack.length) {
      const next = stack.pop()!;
      if (resolved.has(next)) continue;
      resolved.add(next);
      const kids = childrenByParent.get(next);
      if (kids?.length) stack.push(...kids);
    }
    return resolved;
  }

  updateCategoryParent(cat: AdminCategory, raw: string): void {
    const nextParentId = (raw ?? '').trim() || null;
    const prevParentId = (cat.parent_id ?? '').trim() || null;
    if (nextParentId === prevParentId) return;
    cat.parent_id = nextParentId;
    this.admin.updateCategory(cat.slug, { parent_id: nextParentId }).subscribe({
      next: (updated) => {
        cat.parent_id = updated.parent_id ?? null;
        this.toast.success(this.t('adminUi.categories.success.updateParent'));
      },
      error: () => {
        cat.parent_id = prevParentId;
        this.toast.error(this.t('adminUi.categories.errors.updateParent'));
      }
    });
  }

  updateCategoryLowStockThreshold(cat: AdminCategory, raw: string | number): void {
    const prevThreshold = cat.low_stock_threshold ?? null;
    const trimmed = String(raw ?? '').trim();
    const nextThreshold = trimmed ? Number(trimmed) : null;
    if (nextThreshold !== null && (!Number.isFinite(nextThreshold) || nextThreshold < 0)) {
      cat.low_stock_threshold = prevThreshold;
      this.toast.error(this.t('adminUi.categories.errors.updateLowStockThreshold'));
      return;
    }
    if (nextThreshold === prevThreshold) return;
    cat.low_stock_threshold = nextThreshold;
    this.admin.updateCategory(cat.slug, { low_stock_threshold: nextThreshold }).subscribe({
      next: (updated) => {
        cat.low_stock_threshold = updated.low_stock_threshold ?? null;
        this.toast.success(this.t('adminUi.categories.success.updateLowStockThreshold'));
      },
      error: () => {
        cat.low_stock_threshold = prevThreshold;
        this.toast.error(this.t('adminUi.categories.errors.updateLowStockThreshold'));
      }
    });
  }

  updateCategoryTaxGroup(cat: AdminCategory, raw: string): void {
    const nextGroupId = (raw ?? '').trim() || null;
    const prevGroupId = (cat.tax_group_id ?? '').trim() || null;
    if (nextGroupId === prevGroupId) return;
    cat.tax_group_id = nextGroupId;
    this.admin.updateCategory(cat.slug, { tax_group_id: nextGroupId }).subscribe({
      next: (updated) => {
        cat.tax_group_id = updated.tax_group_id ?? null;
        this.toast.success(this.t('adminUi.taxes.success.categoryAssign'));
      },
      error: () => {
        cat.tax_group_id = prevGroupId;
        this.toast.error(this.t('adminUi.taxes.errors.categoryAssign'));
      }
    });
  }

  deleteCategory(slug: string): void {
    this.admin.deleteCategory(slug).subscribe({
      next: () => {
        this.categories = this.categories.filter((c) => c.slug !== slug);
        if (this.categoryTranslationsSlug === slug) this.closeCategoryTranslations();
        this.toast.success(this.t('adminUi.categories.success.delete'));
      },
      error: () => this.toast.error(this.t('adminUi.categories.errors.delete'))
    });
  }

  toggleCategoryTranslations(slug: string): void {
    if (this.categoryTranslationsSlug === slug) {
      this.closeCategoryTranslations();
      return;
    }
    this.categoryTranslationsSlug = slug;
    this.loadCategoryTranslations(slug);
  }

  closeCategoryTranslations(): void {
    this.categoryTranslationsSlug = null;
    this.categoryTranslationsError.set(null);
    this.categoryTranslationExists = { en: false, ro: false };
    this.categoryTranslations = { en: this.blankCategoryTranslation(), ro: this.blankCategoryTranslation() };
  }

  saveCategoryTranslation(lang: 'en' | 'ro'): void {
    const slug = this.categoryTranslationsSlug;
    if (!slug) return;
    this.categoryTranslationsError.set(null);

    const name = this.categoryTranslations[lang].name.trim();
    if (!name) {
      this.toast.error(this.t('adminUi.categories.translations.errors.nameRequired'));
      return;
    }

    const payload = {
      name,
      description: this.categoryTranslations[lang].description.trim() ? this.categoryTranslations[lang].description.trim() : null
    };
    this.admin.upsertCategoryTranslation(slug, lang, payload).subscribe({
      next: (updated) => {
        this.categoryTranslationExists[lang] = true;
        this.categoryTranslations[lang] = {
          name: (updated.name || name).toString(),
          description: (updated.description || '').toString()
        };
        this.toast.success(this.t('adminUi.categories.translations.success.save'));
      },
      error: () => this.categoryTranslationsError.set(this.t('adminUi.categories.translations.errors.save'))
    });
  }

  deleteCategoryTranslation(lang: 'en' | 'ro'): void {
    const slug = this.categoryTranslationsSlug;
    if (!slug) return;
    this.categoryTranslationsError.set(null);
    this.admin.deleteCategoryTranslation(slug, lang).subscribe({
      next: () => {
        this.categoryTranslationExists[lang] = false;
        this.categoryTranslations[lang] = this.blankCategoryTranslation();
        this.toast.success(this.t('adminUi.categories.translations.success.delete'));
      },
      error: () => this.categoryTranslationsError.set(this.t('adminUi.categories.translations.errors.delete'))
    });
  }

  private blankCategoryTranslation(): { name: string; description: string } {
    return { name: '', description: '' };
  }

  private loadCategoryTranslations(slug: string): void {
    this.categoryTranslationsError.set(null);
    this.admin.getCategoryTranslations(slug).subscribe({
      next: (items) => {
        const mapped: Record<'en' | 'ro', { name: string; description: string }> = {
          en: this.blankCategoryTranslation(),
          ro: this.blankCategoryTranslation()
        };
        const exists: Record<'en' | 'ro', boolean> = { en: false, ro: false };
        for (const t of items || []) {
          if (t.lang !== 'en' && t.lang !== 'ro') continue;
          exists[t.lang] = true;
          mapped[t.lang] = {
            name: (t.name || '').toString(),
            description: (t.description || '').toString()
          };
        }
        this.categoryTranslationExists = exists;
        this.categoryTranslations = mapped;
      },
      error: () => this.categoryTranslationsError.set(this.t('adminUi.categories.translations.errors.load'))
    });
  }

  duplicateProduct(slug: string): void {
    this.admin.duplicateProduct(slug).subscribe({
      next: (prod) => {
        this.toast.success(this.t('adminUi.products.success.duplicate'));
        this.loadAll();
        this.loadProduct(prod.slug);
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.duplicate'))
    });
  }

  setStock(id: string, value: number): void {
    this.stockEdits[id] = Number(value);
  }

  saveStock(product: AdminProduct): void {
    const newStock = this.stockEdits[product.id] ?? product.stock_quantity;
    this.admin.updateProduct(product.slug, { stock_quantity: newStock } as any).subscribe({
      next: () => {
        product.stock_quantity = newStock;
        this.toast.success(this.t('adminUi.products.success.save'));
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.save'))
    });
  }

  async saveBulkStock(): Promise<void> {
    if (this.bulkStock === null || !this.selectedIds.size) return;
    const tasks = Array.from(this.selectedIds).map((id) => {
      const prod = this.products.find((p) => p.id === id);
      if (!prod) return Promise.resolve();
      return firstValueFrom(this.admin.updateProduct(prod.slug, { stock_quantity: this.bulkStock! } as any)).then(() => {
        prod.stock_quantity = this.bulkStock!;
      });
    });
    try {
      await Promise.all(tasks);
      this.toast.success(this.t('adminUi.products.success.save'));
    } catch {
      this.toast.error(this.t('adminUi.products.errors.save'));
    }
  }

  buildTags(): string[] {
    const tags = new Set<string>();
    if (this.form.is_bestseller) tags.add('bestseller');
    if (this.productDetail?.tags) this.productDetail.tags.forEach((t) => tags.add(t));
    return Array.from(tags);
  }

  upcomingProducts(): AdminProduct[] {
    const now = new Date();
    return this.products
      .filter((p) => p.publish_at && new Date(p.publish_at) > now)
      .sort((a, b) => new Date(a.publish_at || 0).getTime() - new Date(b.publish_at || 0).getTime());
  }

  toLocalDateTime(iso: string): string {
    const d = new Date(iso);
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
  }

  onImageUpload(event: Event): void {
    if (!this.editingId) {
      this.toast.error(this.t('adminUi.products.errors.saveFirst'));
      return;
    }
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.admin.uploadProductImage(this.editingId, file).subscribe({
      next: (prod) => {
        this.productImages.set((prod as any).images || []);
        this.toast.success(this.t('adminUi.products.success.imageUpload'));
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.image'))
    });
  }

  deleteImage(id: string): void {
    if (!this.editingId) return;
    this.admin.deleteProductImage(this.editingId, id).subscribe({
      next: (prod) => {
        this.productImages.set((prod as any).images || []);
        this.toast.success(this.t('adminUi.products.success.imageDelete'));
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.deleteImage'))
    });
  }

  selectOrder(order: AdminOrder): void {
    this.activeOrder = { ...order };
  }

  filteredOrders(): AdminOrder[] {
    return this.orders.filter((o) => (this.orderFilter ? o.status === this.orderFilter : true));
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.allSelected = checked;
    if (checked) this.selectedIds = new Set(this.products.map((p) => p.id));
    else this.selectedIds.clear();
  }

  toggleSelect(id: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) this.selectedIds.add(id);
    else this.selectedIds.delete(id);
    this.computeAllSelected();
  }

  computeAllSelected(): void {
    this.allSelected = this.selectedIds.size > 0 && this.selectedIds.size === this.products.length;
  }

  changeOrderStatus(status: string): void {
    if (!this.activeOrder) return;
    this.admin.updateOrderStatus(this.activeOrder.id, status).subscribe({
      next: (order) => {
        this.toast.success(this.t('adminUi.orders.success.status'));
        this.activeOrder = order;
        this.orders = this.orders.map((o) => (o.id === order.id ? order : o));
      },
      error: () => this.toast.error(this.t('adminUi.orders.errors.status'))
    });
  }

  forceLogout(): void {
    if (!this.selectedUserId) return;
    this.admin.revokeSessions(this.selectedUserId).subscribe({
      next: () => this.toast.success(this.t('adminUi.users.success.revoke')),
      error: () => this.toast.error(this.t('adminUi.users.errors.revoke'))
    });
  }

  selectUser(userId: string, role: string): void {
    this.selectedUserId = userId;
    this.selectedUserRole = role;
    this.loadUserAliases(userId);
  }

  onSelectedUserIdChange(userId: string): void {
    this.selectedUserId = userId;
    const user = this.users.find((u) => u.id === userId);
    this.selectedUserRole = user?.role ?? this.selectedUserRole;
    this.loadUserAliases(userId);
  }

  loadUserAliases(userId: string): void {
    if (!userId) return;
    this.userAliasesLoading = true;
    this.userAliasesError = null;
    this.userAliases = null;
    this.admin.userAliases(userId).subscribe({
      next: (resp) => {
        this.userAliases = resp;
      },
      error: () => {
        this.userAliasesError = 'Could not load alias history.';
      },
      complete: () => {
        this.userAliasesLoading = false;
      }
    });
  }

  userIdentity(user: AdminUser): string {
    return formatIdentity(user, user.email);
  }

  commentAuthorLabel(author: { id: string; name?: string | null; username?: string | null; name_tag?: number | null }): string {
    return formatIdentity(author, author.id);
  }

  updateRole(): void {
    if (!this.selectedUserId || !this.selectedUserRole) return;
    const password = (prompt(this.t('adminUi.users.rolePasswordPrompt')) || '').trim();
    if (!password) return;
    this.admin.updateUserRole(this.selectedUserId, this.selectedUserRole, password).subscribe({
      next: (updated) => {
        this.users = this.users.map((u) => (u.id === updated.id ? updated : u));
        this.toast.success(this.t('adminUi.users.success.role'));
      },
      error: () => this.toast.error(this.t('adminUi.users.errors.role'))
    });
  }

  moveCategory(cat: AdminCategory, delta: number): void {
    const sorted = [...this.categories].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const index = sorted.findIndex((c) => c.slug === cat.slug);
    const swapIndex = index + delta;
    if (index < 0 || swapIndex < 0 || swapIndex >= sorted.length) return;
    const tmp = sorted[index].sort_order ?? 0;
    sorted[index].sort_order = sorted[swapIndex].sort_order ?? 0;
    sorted[swapIndex].sort_order = tmp;
    this.admin
      .reorderCategories(sorted.map((c) => ({ slug: c.slug, sort_order: c.sort_order ?? 0 })))
      .subscribe({
        next: (cats) => {
          this.categories = cats
            .map((c) => ({ ...c, sort_order: c.sort_order ?? 0 }))
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          this.toast.success(this.t('adminUi.categories.success.reorder'));
        },
        error: () => this.toast.error(this.t('adminUi.categories.errors.reorder'))
      });
  }

  onCategoryDragStart(slug: string): void {
    this.draggingSlug = slug;
  }

  onCategoryDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onCategoryDrop(targetSlug: string): void {
    if (!this.draggingSlug || this.draggingSlug === targetSlug) {
      this.draggingSlug = null;
      return;
    }
    const sorted = [...this.categories].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const fromIdx = sorted.findIndex((c) => c.slug === this.draggingSlug);
    const toIdx = sorted.findIndex((c) => c.slug === targetSlug);
    if (fromIdx === -1 || toIdx === -1) {
      this.draggingSlug = null;
      return;
    }
    const [moved] = sorted.splice(fromIdx, 1);
    sorted.splice(toIdx, 0, moved);
    sorted.forEach((c, idx) => (c.sort_order = idx));
    this.admin
      .reorderCategories(sorted.map((c) => ({ slug: c.slug, sort_order: c.sort_order ?? 0 })))
      .subscribe({
        next: (cats) => {
          this.categories = cats
            .map((c) => ({ ...c, sort_order: c.sort_order ?? 0 }))
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          this.toast.success(this.t('adminUi.categories.success.reorder'));
        },
        error: () => this.toast.error(this.t('adminUi.categories.errors.reorder')),
        complete: () => (this.draggingSlug = null)
      });
  }

  createCoupon(): void {
    if (!this.newCoupon.code) {
      this.toast.error(this.t('adminUi.coupons.errors.required'));
      return;
    }
    this.admin.createCoupon(this.newCoupon).subscribe({
      next: (c) => {
        this.coupons = [c, ...this.coupons];
        this.toast.success(this.t('adminUi.coupons.success.create'));
      },
      error: () => this.toast.error(this.t('adminUi.coupons.errors.create'))
    });
  }

  toggleCoupon(coupon: AdminCoupon): void {
    this.admin.updateCoupon(coupon.id, { active: !coupon.active }).subscribe({
      next: (c) => {
        this.coupons = this.coupons.map((x) => (x.id === c.id ? c : x));
        this.toast.success(this.t('adminUi.coupons.success.update'));
      },
      error: () => this.toast.error(this.t('adminUi.coupons.errors.update'))
    });
  }

  invalidateCouponStripe(coupon: AdminCoupon): void {
    this.admin.invalidateCouponStripeMappings(coupon.id).subscribe({
      next: (res) => {
        this.toast.success(this.t('adminUi.coupons.success.invalidateStripe', { count: res.deleted_mappings }));
      },
      error: () => this.toast.error(this.t('adminUi.coupons.errors.invalidateStripe'))
    });
  }

  selectContent(content: AdminContent): void {
    this.selectedContent = content;
    this.contentForm = { title: content.title, body_markdown: '', status: 'draft' };
    this.admin.getContent(content.key).subscribe({
      next: (block) => {
        this.rememberContentVersion(content.key, block);
        this.contentForm = {
          title: block.title,
          body_markdown: block.body_markdown,
          status: block.status
        };
      },
      error: () => this.toast.error(this.t('adminUi.content.errors.update'))
    });
  }

  saveContent(): void {
    if (!this.selectedContent) return;
    const key = this.selectedContent.key;
    const payload = this.withExpectedVersion(key, {
      title: this.contentForm.title,
      body_markdown: this.contentForm.body_markdown,
      status: this.contentForm.status as any
    });
    this.admin.updateContentBlock(key, payload).subscribe({
      next: (block) => {
        this.rememberContentVersion(key, block);
        this.toast.success(this.t('adminUi.content.success.update'));
        this.reloadContentBlocks();
        this.selectedContent = null;
      },
      error: (err) => {
        if (this.handleContentConflict(err, key, () => this.selectContent(this.selectedContent!))) return;
        this.toast.error(this.t('adminUi.content.errors.update'));
      }
    });
  }

  cancelContent(): void {
    this.selectedContent = null;
  }

  blogPosts(): AdminContent[] {
    return this.contentBlocks.filter((c) => c.key.startsWith('blog.'));
  }

  isBlogSelected(key: string): boolean {
    return this.blogBulkSelection.has(key);
  }

  toggleBlogSelection(key: string, event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (target?.checked) {
      this.blogBulkSelection.add(key);
    } else {
      this.blogBulkSelection.delete(key);
    }
    this.blogBulkError = '';
  }

  areAllBlogSelected(): boolean {
    const posts = this.blogPosts();
    if (!posts.length) return false;
    return posts.every((post) => this.blogBulkSelection.has(post.key));
  }

  toggleSelectAllBlogs(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    if (target.checked) {
      this.blogPosts().forEach((post) => this.blogBulkSelection.add(post.key));
    } else {
      this.blogBulkSelection.clear();
    }
    this.blogBulkError = '';
  }

  clearBlogBulkSelection(): void {
    this.blogBulkSelection.clear();
    this.blogBulkError = '';
  }

  canApplyBlogBulk(): boolean {
    if (this.blogBulkSelection.size === 0) return false;
    if (this.blogBulkAction === 'schedule') {
      const publishIso = this.toIsoFromLocal(this.blogBulkPublishAt);
      if (!publishIso) return false;
      if (this.blogBulkUnpublishAt) {
        const unpublishIso = this.toIsoFromLocal(this.blogBulkUnpublishAt);
        if (!unpublishIso) return false;
        if (new Date(unpublishIso).getTime() <= new Date(publishIso).getTime()) return false;
      }
    }
    if (this.blogBulkAction === 'tags_add' || this.blogBulkAction === 'tags_remove') {
      return this.parseTags(this.blogBulkTags).length > 0;
    }
    return true;
  }

  blogBulkPreview(): string {
    const count = this.blogBulkSelection.size;
    if (!count) return this.t('adminUi.blog.bulk.previewEmpty');
    switch (this.blogBulkAction) {
      case 'publish':
        return this.t('adminUi.blog.bulk.previewPublish', { count });
      case 'unpublish':
        return this.t('adminUi.blog.bulk.previewUnpublish', { count });
      case 'schedule': {
        const publishIso = this.toIsoFromLocal(this.blogBulkPublishAt);
        const publishLabel = publishIso ? new Date(publishIso).toLocaleString() : '—';
        const unpublishIso = this.toIsoFromLocal(this.blogBulkUnpublishAt);
        const unpublishLabel = unpublishIso ? new Date(unpublishIso).toLocaleString() : '—';
        return this.t('adminUi.blog.bulk.previewSchedule', { count, publish: publishLabel, unpublish: unpublishLabel });
      }
      case 'tags_add':
        return this.t('adminUi.blog.bulk.previewTagsAdd', { count, tags: this.parseTags(this.blogBulkTags).join(', ') });
      case 'tags_remove':
        return this.t('adminUi.blog.bulk.previewTagsRemove', { count, tags: this.parseTags(this.blogBulkTags).join(', ') });
      default:
        return this.t('adminUi.blog.bulk.previewEmpty');
    }
  }

  applyBlogBulkAction(): void {
    if (!this.canApplyBlogBulk()) return;
    this.blogBulkSaving = true;
    this.blogBulkError = '';
    const keys = Array.from(this.blogBulkSelection);
    const detailRequests = keys.map((key) =>
      this.admin.getContent(key).pipe(
        map((block) => ({ key, block })),
        catchError(() => of({ key, block: null }))
      )
    );
    forkJoin(detailRequests).subscribe({
      next: (rows) => {
        const updates = rows
          .map(({ key, block }) => {
            if (!block) return { key, update$: null };
            this.rememberContentVersion(key, block);
            const payload = this.buildBlogBulkPayload(block);
            if (!payload) return { key, update$: null };
            return {
              key,
              update$: this.admin.updateContentBlock(key, this.withExpectedVersion(key, payload)).pipe(
                map((res) => ({ key, res })),
                catchError((error) => of({ key, error }))
              )
            };
          })
          .filter((row) => row.update$ !== null) as Array<{ key: string; update$: any }>;

        if (!updates.length) {
          this.blogBulkSaving = false;
          this.blogBulkError = this.t('adminUi.blog.bulk.noChanges');
          return;
        }

        forkJoin(updates.map((row) => row.update$)).subscribe({
          next: (results) => {
            const failures = results.filter((r: any) => r?.error);
            const successCount = results.length - failures.length;
            if (successCount) {
              this.toast.success(this.t('adminUi.blog.bulk.success', { count: successCount }));
            }
            if (failures.length) {
              this.toast.error(this.t('adminUi.blog.bulk.errors', { count: failures.length }));
            }
            this.blogBulkSaving = false;
            this.reloadContentBlocks();
          },
          error: () => {
            this.blogBulkSaving = false;
            this.blogBulkError = this.t('adminUi.blog.bulk.errors', { count: keys.length });
          }
        });
      },
      error: () => {
        this.blogBulkSaving = false;
        this.blogBulkError = this.t('adminUi.blog.bulk.loadError');
      }
    });
  }

  extractBlogSlug(key: string): string {
    return key.startsWith('blog.') ? key.slice('blog.'.length) : key;
  }

  currentBlogSlug(): string {
    return this.selectedBlogKey ? this.extractBlogSlug(this.selectedBlogKey) : '';
  }

	  startBlogCreate(): void {
	    this.showBlogCreate = true;
	    this.selectedBlogKey = null;
	    this.blogImages = [];
	    this.showBlogCoverLibrary = false;
	    this.blogCreate = {
	      baseLang: 'en',
	      status: 'draft',
	      published_at: '',
	      published_until: '',
	      title: '',
      body_markdown: '',
	      summary: '',
	      tags: '',
	      series: '',
	      cover_image_url: '',
	      reading_time_minutes: '',
	      pinned: false,
      pin_order: '1',
      includeTranslation: false,
      translationTitle: '',
      translationBody: ''
    };
	  }

  cancelBlogCreate(): void {
    this.showBlogCreate = false;
  }

  closeBlogEditor(): void {
    this.selectedBlogKey = null;
    this.blogImages = [];
    this.showBlogCoverLibrary = false;
    this.blogPreviewUrl = null;
    this.blogPreviewToken = null;
    this.blogPreviewExpiresAt = null;
    this.blogVersions = [];
    this.blogVersionDetail = null;
    this.blogDiffParts = [];
    this.resetBlogForm();
  }

	  async createBlogPost(): Promise<void> {
	    const baseSlug = this.blogCreateSlug();
	    if (!baseSlug) {
	      this.toast.error(this.t('adminUi.blog.errors.slugRequiredTitle'), this.t('adminUi.blog.errors.slugRequiredCopy'));
	      return;
	    }
	    if (!this.blogCreate.title.trim() || !this.blogCreate.body_markdown.trim()) {
	      this.toast.error(this.t('adminUi.blog.errors.titleBodyRequired'));
	      return;
	    }

	    const baseLang = this.blogCreate.baseLang;
	    const translationLang: 'en' | 'ro' = baseLang === 'en' ? 'ro' : 'en';
	    const meta: Record<string, any> = {};
    const summary = this.blogCreate.summary.trim();
    if (summary) {
      meta['summary'] = { [baseLang]: summary };
    }
	    const tags = this.parseTags(this.blogCreate.tags);
	    if (tags.length) {
	      meta['tags'] = tags;
	    }
	    const series = this.blogCreate.series.trim();
	    if (series) {
	      meta['series'] = series;
	    }
	    const cover = this.blogCreate.cover_image_url.trim();
	    if (cover) {
	      meta['cover_image_url'] = cover;
	    }
	    const rt = Number(String(this.blogCreate.reading_time_minutes || '').trim());
	    if (Number.isFinite(rt) && rt > 0) {
	      meta['reading_time_minutes'] = Math.trunc(rt);
	    }
	    if (this.blogCreate.pinned) {
	      meta['pinned'] = true;
	      const rawOrder = Number(String(this.blogCreate.pin_order || '').trim());
	      const normalized = Number.isFinite(rawOrder) ? Math.min(3, Math.max(1, Math.trunc(rawOrder))) : 1;
	      meta['pin_order'] = normalized;
	    }
	    const published_at = this.blogCreate.published_at ? new Date(this.blogCreate.published_at).toISOString() : undefined;
	    const published_until = this.blogCreate.published_until ? new Date(this.blogCreate.published_until).toISOString() : undefined;

	    try {
	      const payload = {
	        title: this.blogCreate.title.trim(),
	        body_markdown: this.blogCreate.body_markdown,
	        status: this.blogCreate.status,
	        lang: baseLang,
	        published_at,
	        published_until,
	        meta: Object.keys(meta).length ? meta : undefined
	      };

	      let slug = baseSlug;
	      let key = `blog.${slug}`;
	      let created = null as any;
	      for (let attempt = 0; attempt < 5; attempt += 1) {
	        try {
	          created = await firstValueFrom(this.admin.createContent(key, payload));
	          break;
	        } catch (err: any) {
	          const detail = String(err?.error?.detail || '').trim();
	          if (detail === 'Content key exists' && attempt < 4) {
	            slug = `${baseSlug}-${attempt + 2}`;
	            key = `blog.${slug}`;
	            continue;
	          }
	          throw err;
	        }
	      }
	      this.rememberContentVersion(key, created);

	      if (this.blogCreate.includeTranslation) {
        const tTitle = this.blogCreate.translationTitle.trim();
        const tBody = this.blogCreate.translationBody.trim();
        if (tTitle || tBody) {
          await firstValueFrom(
            this.admin.updateContentBlock(
              key,
              this.withExpectedVersion(key, {
                title: tTitle || this.blogCreate.title.trim(),
                body_markdown: tBody || this.blogCreate.body_markdown,
                lang: translationLang
              })
            )
          );
        }
      }

      this.toast.success(this.t('adminUi.blog.success.created'));
      this.showBlogCreate = false;
      this.reloadContentBlocks();
      this.loadBlogEditor(key);
    } catch {
      this.toast.error(this.t('adminUi.blog.errors.create'));
    }
  }

  selectBlogPost(post: AdminContent): void {
    this.showBlogCreate = false;
    this.loadBlogEditor(post.key);
  }

  setBlogEditLang(lang: 'en' | 'ro'): void {
    if (!this.selectedBlogKey) return;
    this.blogEditLang = lang;
    const key = this.selectedBlogKey;
    const wantsBase = lang === this.blogBaseLang;
    this.admin.getContent(key, wantsBase ? undefined : lang).subscribe({
      next: (block) => {
        this.rememberContentVersion(key, block);
        this.blogForm.title = block.title;
        this.blogForm.body_markdown = block.body_markdown;
        if (wantsBase) {
          this.blogForm.status = block.status;
        }
        this.blogForm.published_at = block.published_at ? this.toLocalDateTime(block.published_at) : '';
        this.blogForm.published_until = block.published_until ? this.toLocalDateTime(block.published_until) : '';
        this.blogMeta = block.meta || this.blogMeta || {};
        this.syncBlogMetaToForm(lang);
        this.ensureBlogDraft(key, lang).initFromServer(this.currentBlogDraftState());
      },
      error: () => this.toast.error(this.t('adminUi.blog.errors.loadContent'))
    });
  }

  saveBlogPost(): void {
    if (!this.selectedBlogKey) return;
    if (!this.blogForm.title.trim() || !this.blogForm.body_markdown.trim()) {
      this.toast.error(this.t('adminUi.blog.errors.titleBodyRequired'));
      return;
    }

    const key = this.selectedBlogKey;
    const nextMeta = this.buildBlogMeta(this.blogEditLang);
    const metaChanged = JSON.stringify(nextMeta) !== JSON.stringify(this.blogMeta || {});
    const isBase = this.blogEditLang === this.blogBaseLang;
    if (isBase && this.blogForm.status === 'published') {
      const issues = this.blogA11yIssues();
      if (issues.length) {
        this.blogA11yOpen = true;
        const ok = confirm(this.t('adminUi.blog.a11y.confirmPublishAnyway', { count: issues.length }));
        if (!ok) return;
      }
    }
    const published_at = isBase
      ? this.blogForm.published_at
        ? new Date(this.blogForm.published_at).toISOString()
        : null
      : undefined;
    const published_until = isBase
      ? this.blogForm.published_until
        ? new Date(this.blogForm.published_until).toISOString()
        : null
      : undefined;
    if (isBase) {
      const payload = this.withExpectedVersion(key, {
        title: this.blogForm.title.trim(),
        body_markdown: this.blogForm.body_markdown,
        status: this.blogForm.status as any,
        published_at,
        published_until,
        meta: nextMeta
      });
      this.admin.updateContentBlock(key, payload).subscribe({
        next: (block) => {
          this.rememberContentVersion(key, block);
          this.blogMeta = nextMeta;
          this.ensureBlogDraft(key, this.blogEditLang).markServerSaved(this.currentBlogDraftState());
          this.toast.success(this.t('adminUi.blog.success.saved'));
          this.reloadContentBlocks();
          this.loadBlogEditor(key);
        },
        error: (err) => {
          if (this.handleContentConflict(err, key, () => this.loadBlogEditor(key))) return;
          this.toast.error(this.t('adminUi.blog.errors.save'));
        }
      });
      return;
    }

    this.admin.updateContentBlock(
      key,
      this.withExpectedVersion(key, {
        title: this.blogForm.title.trim(),
        body_markdown: this.blogForm.body_markdown,
        lang: this.blogEditLang
      })
    ).subscribe({
      next: (block) => {
        this.rememberContentVersion(key, block);
        const onDone = () => {
          this.toast.success(this.t('adminUi.blog.success.translationSaved'));
          this.reloadContentBlocks();
          this.setBlogEditLang(this.blogEditLang);
        };
        if (!metaChanged) {
          this.ensureBlogDraft(key, this.blogEditLang).markServerSaved(this.currentBlogDraftState());
          onDone();
          return;
        }
        this.admin.updateContentBlock(key, this.withExpectedVersion(key, { meta: nextMeta })).subscribe({
          next: (metaBlock) => {
            this.rememberContentVersion(key, metaBlock);
            this.blogMeta = nextMeta;
            this.ensureBlogDraft(key, this.blogEditLang).markServerSaved(this.currentBlogDraftState());
            onDone();
          },
          error: (err) => {
            if (this.handleContentConflict(err, key, () => this.setBlogEditLang(this.blogEditLang))) return;
            this.toast.error(this.t('adminUi.blog.errors.translationMetaSave'));
            onDone();
          }
        });
      },
      error: (err) => {
        if (this.handleContentConflict(err, key, () => this.setBlogEditLang(this.blogEditLang))) return;
        this.toast.error(this.t('adminUi.blog.errors.translationSave'));
      }
    });
  }

  generateBlogPreviewLink(): void {
    if (!this.selectedBlogKey) return;
    const slug = this.currentBlogSlug();
    this.blog.createPreviewToken(slug, { lang: this.blogEditLang }).subscribe({
      next: (resp) => {
        this.blogPreviewUrl = resp.url;
        this.blogPreviewToken = resp.token;
        this.blogPreviewExpiresAt = resp.expires_at;
        this.toast.success(this.t('adminUi.blog.preview.success.ready'));
        void this.copyToClipboard(resp.url).then((ok) => {
          if (ok) this.toast.info(this.t('adminUi.blog.preview.success.copied'));
        });
      },
      error: () => this.toast.error(this.t('adminUi.blog.preview.errors.generate'))
    });
  }

  copyBlogPreviewLink(): void {
    if (!this.blogPreviewUrl) return;
    void this.copyToClipboard(this.blogPreviewUrl).then((ok) => {
      if (ok) this.toast.info(this.t('adminUi.blog.preview.success.copied'));
      else this.toast.error(this.t('adminUi.blog.preview.errors.copy'));
    });
  }

  blogPublicUrl(lang: UiLang): string {
    if (typeof window === 'undefined') return `/blog/${this.currentBlogSlug()}?lang=${lang}`;
    return `${window.location.origin}/blog/${this.currentBlogSlug()}?lang=${lang}`;
  }

  blogPublishedOgImageUrl(lang: UiLang): string {
    const apiBaseUrl = (appConfig.apiBaseUrl || '/api/v1').replace(/\/$/, '');
    const ogPath = `${apiBaseUrl}/blog/posts/${this.currentBlogSlug()}/og.png?lang=${lang}`;
    if (ogPath.startsWith('http://') || ogPath.startsWith('https://') || typeof window === 'undefined') return ogPath;
    return `${window.location.origin}${ogPath}`;
  }

  blogPreviewOgImageUrl(lang: UiLang): string | null {
    if (!this.blogPreviewToken) return null;
    const apiBaseUrl = (appConfig.apiBaseUrl || '/api/v1').replace(/\/$/, '');
    const token = encodeURIComponent(this.blogPreviewToken);
    const ogPath = `${apiBaseUrl}/blog/posts/${this.currentBlogSlug()}/og-preview.png?lang=${lang}&token=${token}`;
    if (ogPath.startsWith('http://') || ogPath.startsWith('https://') || typeof window === 'undefined') return ogPath;
    return `${window.location.origin}${ogPath}`;
  }

  copyText(text: string): void {
    const value = (text || '').trim();
    if (!value) return;
    void this.copyToClipboard(value).then((ok) => {
      if (ok) this.toast.info(this.t('adminUi.blog.social.success.copied'));
      else this.toast.error(this.t('adminUi.blog.social.errors.copy'));
    });
  }

  loadBlogVersions(): void {
    if (!this.selectedBlogKey) return;
    this.admin.listContentVersions(this.selectedBlogKey).subscribe({
      next: (items) => {
        this.blogVersions = items;
        this.blogVersionDetail = null;
        this.blogDiffParts = [];
      },
      error: () => this.toast.error(this.t('adminUi.blog.revisions.errors.load'))
    });
  }

  loadFlaggedComments(): void {
    this.flaggedCommentsLoading.set(true);
    this.flaggedCommentsError = null;
    this.blog.listFlaggedComments().subscribe({
      next: (resp) => {
        this.flaggedComments.set(resp.items || []);
      },
      error: () => {
        this.flaggedComments.set([]);
        this.flaggedCommentsError = this.t('adminUi.blog.moderation.errors.load');
      },
      complete: () => this.flaggedCommentsLoading.set(false)
    });
  }

  resolveFlags(comment: AdminBlogComment): void {
    this.blog.resolveCommentFlagsAdmin(comment.id).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.blog.moderation.success.flagsResolved'));
        this.loadFlaggedComments();
      },
      error: () => this.toast.error(this.t('adminUi.blog.moderation.errors.resolveFlags'))
    });
  }

  toggleHide(comment: AdminBlogComment): void {
    if (comment.is_hidden) {
      this.blog.unhideCommentAdmin(comment.id).subscribe({
        next: () => {
          this.toast.success(this.t('adminUi.blog.moderation.success.commentUnhidden'));
          this.loadFlaggedComments();
        },
        error: () => this.toast.error(this.t('adminUi.blog.moderation.errors.unhide'))
      });
      return;
    }
    const reason = prompt(this.t('adminUi.blog.moderation.prompts.hideReason')) || '';
    this.blog.hideCommentAdmin(comment.id, { reason: reason.trim() || null }).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.blog.moderation.success.commentHidden'));
        this.loadFlaggedComments();
      },
      error: () => this.toast.error(this.t('adminUi.blog.moderation.errors.hide'))
    });
  }

  adminDeleteComment(comment: AdminBlogComment): void {
    const ok = confirm(this.t('adminUi.blog.moderation.confirms.deleteComment'));
    if (!ok) return;
    this.blog.deleteComment(comment.id).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.blog.moderation.success.commentDeleted'));
        this.loadFlaggedComments();
      },
      error: () => this.toast.error(this.t('adminUi.blog.moderation.errors.delete'))
    });
  }

  selectBlogVersion(version: number): void {
    if (!this.selectedBlogKey) return;
    this.admin.getContentVersion(this.selectedBlogKey, version).subscribe({
      next: (v) => {
        this.blogVersionDetail = v;
        this.blogDiffParts = diffLines(v.body_markdown || '', this.blogForm.body_markdown || '');
      },
      error: () => this.toast.error(this.t('adminUi.blog.revisions.errors.loadVersion'))
    });
  }

  rollbackBlogVersion(version: number): void {
    if (!this.selectedBlogKey) return;
    const ok = confirm(this.t('adminUi.blog.revisions.confirms.rollback', { version }));
    if (!ok) return;
    const key = this.selectedBlogKey;
    this.admin.rollbackContentVersion(key, version).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.blog.revisions.success.rolledBack'));
        this.reloadContentBlocks();
        this.loadBlogEditor(key);
        this.loadBlogVersions();
      },
      error: () => this.toast.error(this.t('adminUi.blog.revisions.errors.rollback'))
    });
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
      } catch {
        return false;
      }
    }
  }

  renderMarkdown(markdown: string): string {
    return this.markdown.render(markdown);
  }

  applyBlogHeading(textarea: HTMLTextAreaElement, level: 1 | 2): void {
    const prefix = `${'#'.repeat(level)} `;
    this.prefixBlogLines(textarea, prefix);
  }

  applyBlogList(textarea: HTMLTextAreaElement): void {
    this.prefixBlogLines(textarea, '- ');
  }

  wrapBlogSelection(textarea: HTMLTextAreaElement, before: string, after: string, placeholder: string): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const hasSelection = end > start;
    const selected = hasSelection ? value.slice(start, end) : placeholder;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    const selStart = start + before.length;
    const selEnd = selStart + selected.length;
    this.updateBlogBody(textarea, next, selStart, selEnd);
  }

  insertBlogLink(textarea: HTMLTextAreaElement): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const hasSelection = end > start;
    const text = hasSelection ? value.slice(start, end) : 'link text';
    const url = 'https://';
    const snippet = `[${text}](${url})`;
    const next = value.slice(0, start) + snippet + value.slice(end);
    const urlStart = start + text.length + 3;
    this.updateBlogBody(textarea, next, urlStart, urlStart + url.length);
  }

  insertBlogCodeBlock(textarea: HTMLTextAreaElement): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const hasSelection = end > start;
    const selected = hasSelection ? value.slice(start, end) : 'code';
    const snippet = `\n\`\`\`\n${selected}\n\`\`\`\n`;
    const next = value.slice(0, start) + snippet + value.slice(end);
    const codeStart = start + 5;
    this.updateBlogBody(textarea, next, codeStart, codeStart + selected.length);
  }

  insertBlogEmbed(target: HTMLTextAreaElement | RichEditorComponent, kind: 'product' | 'category' | 'collection'): void {
    const hintKey =
      kind === 'product'
        ? 'adminUi.blog.embeds.prompt.product'
        : kind === 'category'
          ? 'adminUi.blog.embeds.prompt.category'
          : 'adminUi.blog.embeds.prompt.collection';
    const raw = prompt(this.t(hintKey), '') || '';
    const slug = raw.trim();
    if (!slug) return;
    const snippet = `{{${kind}:${slug}}}`;
    if (target instanceof HTMLTextAreaElement) {
      this.insertAtCursor(target, snippet);
    } else {
      target.insertMarkdown(snippet);
    }
  }

  uploadAndInsertBlogImage(target: HTMLTextAreaElement | RichEditorComponent, event: Event): void {
    if (!this.selectedBlogKey) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.admin.uploadContentImage(this.selectedBlogKey, file).subscribe({
      next: (block) => {
        const images = (block.images || [])
          .map((img) => ({
            id: img.id,
            url: img.url,
            alt_text: img.alt_text,
            sort_order: img.sort_order ?? 0,
            focal_x: img.focal_x ?? 50,
            focal_y: img.focal_y ?? 50
          }))
          .sort((a, b) => a.sort_order - b.sort_order);
        this.blogImages = images;
        this.toast.success(this.t('adminUi.blog.images.success.uploaded'));
        const inserted = images[images.length - 1];
        if (inserted?.url) {
          const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\r\n]+/g, ' ').trim() || 'image';
          const layoutToken = this.blogImageLayout === 'default' ? '' : this.blogImageLayout;
          const snippet = layoutToken ? `![${alt}](${inserted.url} "${layoutToken}")` : `![${alt}](${inserted.url})`;
          if (target instanceof HTMLTextAreaElement) {
            this.insertAtCursor(target, snippet);
          } else {
            target.insertMarkdown(snippet);
          }
          this.toast.info(this.t('adminUi.blog.images.success.insertedMarkdown'));
        }
        input.value = '';
      },
      error: () => this.toast.error(this.t('adminUi.blog.images.errors.upload'))
    });
  }

  onBlogImageDragOver(event: DragEvent): void {
    const transfer = event?.dataTransfer;
    const types = Array.from(transfer?.types || []);
    if (!types.includes('Files')) return;
    event.preventDefault();
    if (transfer) transfer.dropEffect = 'copy';
  }

  async onBlogImageDrop(target: HTMLTextAreaElement | RichEditorComponent, event: DragEvent): Promise<void> {
    const transfer = event?.dataTransfer;
    const files = Array.from(transfer?.files || []).filter((file) => file && file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();

    if (!this.selectedBlogKey) return;
    let insertedCount = 0;

    for (const file of files) {
      try {
        const block = await firstValueFrom(this.admin.uploadContentImage(this.selectedBlogKey, file));
        const images = (block.images || [])
          .map((img) => ({
            id: img.id,
            url: img.url,
            alt_text: img.alt_text,
            sort_order: img.sort_order ?? 0,
            focal_x: img.focal_x ?? 50,
            focal_y: img.focal_y ?? 50
          }))
          .sort((a, b) => a.sort_order - b.sort_order);
        this.blogImages = images;
        const inserted = images[images.length - 1];
        if (!inserted?.url) continue;

        const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\r\n]+/g, ' ').trim() || 'image';
        const layoutToken = this.blogImageLayout === 'default' ? '' : this.blogImageLayout;
        const snippet = layoutToken ? `![${alt}](${inserted.url} "${layoutToken}")` : `![${alt}](${inserted.url})`;
        if (target instanceof HTMLTextAreaElement) {
          this.insertAtCursor(target, snippet);
        } else {
          target.insertMarkdown(snippet);
        }
        insertedCount += 1;
      } catch {
        this.toast.error(this.t('adminUi.blog.images.errors.upload'));
        return;
      }
    }

    if (insertedCount) {
      this.toast.success(this.t('adminUi.blog.images.success.uploaded'));
      this.toast.info(this.t('adminUi.blog.images.success.insertedMarkdown'));
    }
  }

  insertBlogImageMarkdown(url: string, altText?: string | null): void {
    const alt = (altText || 'image').replace(/[\r\n]+/g, ' ').trim();
    const snippet = `\n\n![${alt}](${url})\n`;
    this.blogForm.body_markdown = (this.blogForm.body_markdown || '').trimEnd() + snippet;
    this.toast.info(this.t('adminUi.blog.images.success.insertedMarkdown'));
  }

  blogA11yIssues(): Array<{ index: number; url: string; alt: string }> {
    const markdown = this.blogForm.body_markdown || '';
    const issues: Array<{ index: number; url: string; alt: string }> = [];
    const re = /!\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g;
    let match: RegExpExecArray | null;
    let idx = 0;
    while ((match = re.exec(markdown))) {
      const alt = String(match[1] || '').trim();
      const url = String(match[2] || '').trim();
      const altKey = alt.toLowerCase();
      const missing = !alt || altKey === 'image' || altKey === 'photo' || altKey === 'picture';
      if (url && missing) issues.push({ index: idx, url, alt });
      idx += 1;
    }
    return issues;
  }

  promptFixBlogImageAlt(imageIndex: number): void {
    const markdown = this.blogForm.body_markdown || '';
    const re = /!\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g;
    let match: RegExpExecArray | null;
    let idx = 0;
    while ((match = re.exec(markdown))) {
      if (idx !== imageIndex) {
        idx += 1;
        continue;
      }
      const url = String(match[2] || '').trim();
      const suggestion = this.suggestAltFromUrl(url);
      const next = (prompt(this.t('adminUi.blog.a11y.promptAlt'), suggestion) || '').trim();
      if (!next) return;
      this.setBlogMarkdownImageAlt(imageIndex, next);
      this.toast.success(this.t('adminUi.blog.a11y.fixed'));
      this.blogA11yOpen = true;
      return;
    }
  }

  private suggestAltFromUrl(url: string): string {
    const cleaned = String(url || '').split('?')[0].split('#')[0].trim();
    const filename = cleaned.split('/').pop() || '';
    const base = filename.replace(/\.[^.]+$/, '');
    return base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'image';
  }

  private setBlogMarkdownImageAlt(imageIndex: number, alt: string): void {
    const markdown = this.blogForm.body_markdown || '';
    const safeAlt = String(alt || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!safeAlt) return;

    const re = /!\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g;
    let match: RegExpExecArray | null;
    let idx = 0;
    let out = '';
    let lastIndex = 0;
    while ((match = re.exec(markdown))) {
      const start = match.index;
      const end = re.lastIndex;
      out += markdown.slice(lastIndex, start);
      if (idx === imageIndex) {
        out += `![${safeAlt}](${match[2]}${match[3]})`;
      } else {
        out += markdown.slice(start, end);
      }
      lastIndex = end;
      idx += 1;
    }
    out += markdown.slice(lastIndex);
    this.blogForm.body_markdown = out;
  }

  blogCoverPreviewUrl(): string | null {
    const explicit = (this.blogForm.cover_image_url || '').trim();
    if (explicit) return explicit;
    const first = this.blogImages[0];
    return first?.url ? String(first.url) : null;
  }

  blogCoverPreviewAsset():
    | { id: string; url: string; sort_order: number; focal_x: number; focal_y: number; alt_text?: string | null }
    | null {
    const url = this.blogCoverPreviewUrl();
    if (!url) return null;
    return this.blogImages.find((img) => img.url === url) ?? null;
  }

  blogCoverPreviewFocalPosition(): string {
    const img = this.blogCoverPreviewAsset();
    const x = Math.max(0, Math.min(100, Math.round(Number(img?.focal_x ?? 50))));
    const y = Math.max(0, Math.min(100, Math.round(Number(img?.focal_y ?? 50))));
    return `${x}% ${y}%`;
  }

  clearBlogCoverOverride(): void {
    this.blogForm.cover_image_url = '';
  }

  uploadBlogCoverImage(event: Event): void {
    if (!this.selectedBlogKey) return;
    if (this.blogEditLang !== this.blogBaseLang) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.admin.uploadContentImage(this.selectedBlogKey, file).subscribe({
      next: (block) => {
        const images = (block.images || [])
          .map((img) => ({
            id: img.id,
            url: img.url,
            alt_text: img.alt_text,
            sort_order: img.sort_order ?? 0,
            focal_x: img.focal_x ?? 50,
            focal_y: img.focal_y ?? 50
          }))
          .sort((a, b) => a.sort_order - b.sort_order);
        this.blogImages = images;
        const inserted = images[images.length - 1];
        if (inserted?.url) {
          this.blogForm.cover_image_url = inserted.url;
        }
        this.toast.success(this.t('adminUi.blog.images.success.uploaded'));
        input.value = '';
      },
      error: () => this.toast.error(this.t('adminUi.blog.images.errors.upload'))
    });
  }

  selectBlogCoverAsset(asset: ContentImageAssetRead): void {
    const url = (asset?.url || '').trim();
    if (!url) return;
    if (this.blogEditLang !== this.blogBaseLang) return;
    this.blogForm.cover_image_url = url;
    const id = String(asset.id || '').trim();
    if (!id) return;
    const next = [...this.blogImages];
    const idx = next.findIndex((img) => img.id === id);
    const row = {
      id,
      url,
      alt_text: asset.alt_text ?? null,
      sort_order: Number.isFinite(asset.sort_order as any) ? Number(asset.sort_order) : 0,
      focal_x: Number.isFinite(asset.focal_x as any) ? Number(asset.focal_x) : 50,
      focal_y: Number.isFinite(asset.focal_y as any) ? Number(asset.focal_y) : 50
    };
    if (idx >= 0) next[idx] = { ...next[idx], ...row };
    else next.push(row);
    next.sort((a, b) => a.sort_order - b.sort_order);
    this.blogImages = next;
    this.showBlogCoverLibrary = false;
  }

  editBlogCoverFocalPoint(): void {
    if (this.blogEditLang !== this.blogBaseLang) return;
    const img = this.blogCoverPreviewAsset();
    if (!img) return;
    const entered = window.prompt(this.t('adminUi.site.assets.library.focalPrompt'), `${img.focal_x}, ${img.focal_y}`);
    if (entered === null) return;
    const parts = entered
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length < 2) {
      this.toast.error(this.t('adminUi.site.assets.library.focalErrorsFormat'));
      return;
    }
    const focalX = Math.max(0, Math.min(100, Math.round(Number(parts[0]))));
    const focalY = Math.max(0, Math.min(100, Math.round(Number(parts[1]))));
    if (!Number.isFinite(focalX) || !Number.isFinite(focalY)) {
      this.toast.error(this.t('adminUi.site.assets.library.focalErrorsFormat'));
      return;
    }
    this.admin.updateContentImageFocalPoint(img.id, focalX, focalY).subscribe({
      next: (updated) => {
        this.blogImages = this.blogImages.map((item) =>
          item.id === img.id ? { ...item, focal_x: updated.focal_x, focal_y: updated.focal_y } : item
        );
        this.toast.success(this.t('adminUi.site.assets.library.focalSaved'));
      },
      error: () => this.toast.error(this.t('adminUi.site.assets.library.focalErrorsSave'))
    });
  }

  private prefixBlogLines(textarea: HTMLTextAreaElement, prefix: string): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = end === start ? value.indexOf('\n', start) : value.indexOf('\n', end);
    const safeLineEnd = lineEnd === -1 ? value.length : lineEnd;
    const segment = value.slice(lineStart, safeLineEnd);
    const lines = segment.split('\n');
    const nextSegment = lines
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (line.startsWith(prefix)) return line;
        return prefix + line;
      })
      .join('\n');
    const nextValue = value.slice(0, lineStart) + nextSegment + value.slice(safeLineEnd);
    const added = nextSegment.length - segment.length;
    this.updateBlogBody(textarea, nextValue, start + added, end + added);
  }

  private insertAtCursor(textarea: HTMLTextAreaElement, text: string): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const next = value.slice(0, start) + text + value.slice(end);
    const pos = start + text.length;
    this.updateBlogBody(textarea, next, pos, pos);
  }

  private updateBlogBody(textarea: HTMLTextAreaElement, nextValue: string, selectionStart: number, selectionEnd: number): void {
    this.blogForm.body_markdown = nextValue;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  private loadBlogEditor(key: string): void {
    this.selectedBlogKey = key;
    this.resetBlogForm();
    this.showBlogCoverLibrary = false;
    this.blogPreviewUrl = null;
    this.blogPreviewExpiresAt = null;
    this.blogVersions = [];
    this.blogVersionDetail = null;
    this.blogDiffParts = [];
    this.admin.getContent(key).subscribe({
      next: (block) => {
        this.rememberContentVersion(key, block);
        this.blogBaseLang = (block.lang === 'ro' ? 'ro' : 'en') as 'en' | 'ro';
        this.blogEditLang = this.blogBaseLang;
        this.blogMeta = block.meta || {};
	        this.blogForm = {
	          title: block.title,
	          body_markdown: block.body_markdown,
	          status: block.status,
	          published_at: block.published_at ? this.toLocalDateTime(block.published_at) : '',
	          published_until: block.published_until ? this.toLocalDateTime(block.published_until) : '',
	          summary: '',
	          tags: '',
	          series: '',
	          cover_image_url: '',
	          reading_time_minutes: '',
	          pinned: false,
	          pin_order: '1'
	        };
        this.syncBlogMetaToForm(this.blogEditLang);
        this.ensureBlogDraft(key, this.blogEditLang).initFromServer(this.currentBlogDraftState());
        const images = (block.images || [])
          .map((img) => ({
            id: img.id,
            url: img.url,
            alt_text: img.alt_text,
            sort_order: img.sort_order ?? 0,
            focal_x: img.focal_x ?? 50,
            focal_y: img.focal_y ?? 50
          }))
          .sort((a, b) => a.sort_order - b.sort_order);
        this.blogImages = images;
        this.loadBlogVersions();
      },
      error: () => this.toast.error(this.t('adminUi.blog.errors.loadPost'))
    });
  }

  private reloadContentBlocks(): void {
    this.admin.content().subscribe({
      next: (c) => {
        this.contentBlocks = c;
        this.syncContentVersions(c);
        this.pruneBlogBulkSelection();
      }
    });
  }

  private resetBlogForm(): void {
	    this.blogForm = {
	      title: '',
	      body_markdown: '',
	      status: 'draft',
	      published_at: '',
	      published_until: '',
	      summary: '',
	      tags: '',
	      series: '',
	      cover_image_url: '',
	      reading_time_minutes: '',
	      pinned: false,
	      pin_order: '1'
	    };
    this.blogMeta = {};
  }

	  private normalizeBlogSlug(raw: string): string {
	    return raw
	      .normalize('NFD')
	      .replace(/[\u0300-\u036f]/g, '')
	      .trim()
	      .toLowerCase()
	      .replace(/\s+/g, '-')
	      .replace(/[^a-z0-9-]/g, '')
	      .replace(/-+/g, '-')
	      .replace(/^-|-$/g, '');
	  }

	  blogCreateSlug(): string {
	    return this.normalizeBlogSlug(this.blogCreate.title || '');
	  }

  private parseTags(raw: string): string[] {
    const parts = (raw || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of parts) {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(part);
    }
    return out;
  }

  private toIsoFromLocal(value: string): string | null {
    const trimmed = (value || '').trim();
    if (!trimmed) return null;
    const date = new Date(trimmed);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toISOString();
  }

  private buildBlogBulkPayload(block: { meta?: Record<string, any> | null }): Record<string, unknown> | null {
    switch (this.blogBulkAction) {
      case 'publish':
        return { status: 'published', published_at: null };
      case 'unpublish':
        return { status: 'draft' };
      case 'schedule': {
        const publishIso = this.toIsoFromLocal(this.blogBulkPublishAt);
        if (!publishIso) return null;
        const unpublishIso = this.toIsoFromLocal(this.blogBulkUnpublishAt);
        if (unpublishIso && new Date(unpublishIso).getTime() <= new Date(publishIso).getTime()) {
          this.blogBulkError = this.t('adminUi.blog.bulk.invalidSchedule');
          return null;
        }
        return {
          status: 'published',
          published_at: publishIso,
          published_until: unpublishIso ?? null
        };
      }
      case 'tags_add':
      case 'tags_remove': {
        const tagsInput = this.parseTags(this.blogBulkTags);
        if (!tagsInput.length) return null;
        const meta = { ...(block.meta || {}) } as Record<string, unknown>;
        const existingRaw = meta['tags'];
        const existing = Array.isArray(existingRaw)
          ? existingRaw.map((t) => String(t))
          : typeof existingRaw === 'string'
          ? this.parseTags(existingRaw)
          : [];
        const merged = this.blogBulkAction === 'tags_add' ? this.mergeTags(existing, tagsInput) : this.removeTags(existing, tagsInput);
        if (merged.length) meta['tags'] = merged;
        else delete meta['tags'];
        return { meta };
      }
      default:
        return null;
    }
  }

  private mergeTags(existing: string[], incoming: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of [...existing, ...incoming]) {
      const trimmed = String(value || '').trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
    return out;
  }

  private removeTags(existing: string[], remove: string[]): string[] {
    const removeSet = new Set(remove.map((t) => String(t || '').trim().toLowerCase()).filter(Boolean));
    return existing.filter((t) => !removeSet.has(String(t || '').trim().toLowerCase()));
  }

  private pruneBlogBulkSelection(): void {
    const blogKeys = new Set(this.blogPosts().map((p) => p.key));
    for (const key of Array.from(this.blogBulkSelection)) {
      if (!blogKeys.has(key)) this.blogBulkSelection.delete(key);
    }
  }

  private syncContentVersions(blocks: AdminContent[]): void {
    blocks.forEach((block) => this.rememberContentVersion(block.key, block));
  }

  private getBlogSummary(meta: Record<string, any>, lang: 'en' | 'ro'): string {
    const summary = meta?.['summary'];
    if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
      const value = summary[lang];
      return typeof value === 'string' ? value : '';
    }
    if (typeof summary === 'string') {
      return lang === this.blogBaseLang ? summary : '';
    }
    return '';
  }

  private syncBlogMetaToForm(lang: 'en' | 'ro'): void {
    const meta = this.blogMeta || {};
    this.blogForm.summary = this.getBlogSummary(meta, lang);
    const tags = meta['tags'];
    if (Array.isArray(tags)) {
      this.blogForm.tags = tags.join(', ');
    } else if (typeof tags === 'string') {
      this.blogForm.tags = tags;
	    } else {
	      this.blogForm.tags = '';
	    }

	    const series = meta['series'];
	    this.blogForm.series = typeof series === 'string' ? series : '';

	    const cover = meta['cover_image_url'] || meta['cover_image'] || '';
	    this.blogForm.cover_image_url = typeof cover === 'string' ? cover : '';
	    const rt = meta['reading_time_minutes'] ?? meta['reading_time'] ?? '';
	    this.blogForm.reading_time_minutes = rt ? String(rt) : '';

    const pinned = meta['pinned'];
    this.blogForm.pinned = pinned === true || pinned === 'true';
    const rawPinOrder = meta['pin_order'];
    const parsedPinOrder = Number(
      typeof rawPinOrder === 'number' ? rawPinOrder : typeof rawPinOrder === 'string' ? rawPinOrder.trim() : '1'
    );
    const normalized = Number.isFinite(parsedPinOrder) ? Math.min(3, Math.max(1, Math.trunc(parsedPinOrder))) : 1;
    this.blogForm.pin_order = String(normalized);
  }

  private buildBlogMeta(lang: 'en' | 'ro'): Record<string, any> {
    const meta: Record<string, any> = { ...(this.blogMeta || {}) };

	    const tags = this.parseTags(this.blogForm.tags);
	    if (tags.length) meta['tags'] = tags;
	    else delete meta['tags'];

	    const series = this.blogForm.series.trim();
	    if (series) meta['series'] = series;
	    else delete meta['series'];

	    const cover = this.blogForm.cover_image_url.trim();
	    if (cover) meta['cover_image_url'] = cover;
	    else delete meta['cover_image_url'];

    const rt = Number(String(this.blogForm.reading_time_minutes || '').trim());
    if (Number.isFinite(rt) && rt > 0) meta['reading_time_minutes'] = Math.trunc(rt);
    else delete meta['reading_time_minutes'];

    const summaryValue = this.blogForm.summary.trim();
    const existing = meta['summary'];
    let summary: Record<string, any> = {};
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      summary = { ...existing };
    } else if (typeof existing === 'string' && existing.trim()) {
      summary = { [this.blogBaseLang]: existing.trim() };
    }
    if (summaryValue) summary[lang] = summaryValue;
    else delete summary[lang];
    if (Object.keys(summary).length) meta['summary'] = summary;
    else delete meta['summary'];

    if (this.blogForm.pinned) {
      meta['pinned'] = true;
      const rawOrder = Number(String(this.blogForm.pin_order || '').trim());
      const normalized = Number.isFinite(rawOrder) ? Math.min(3, Math.max(1, Math.trunc(rawOrder))) : 1;
      meta['pin_order'] = normalized;
    } else {
      delete meta['pinned'];
      delete meta['pin_order'];
    }

    return meta;
  }

  loadAssets(): void {
    this.assetsError = null;
    this.assetsMessage = null;
    this.admin.getContent('site.assets').subscribe({
      next: (block) => {
        this.rememberContentVersion('site.assets', block);
        this.assetsForm = {
          logo_url: block.meta?.['logo_url'] || '',
          favicon_url: block.meta?.['favicon_url'] || '',
          social_image_url: block.meta?.['social_image_url'] || ''
        };
        this.assetsMessage = null;
      },
      error: () => {
        delete this.contentVersions['site.assets'];
        this.assetsForm = { logo_url: '', favicon_url: '', social_image_url: '' };
      }
    });
  }

  loadCheckoutSettings(): void {
    this.checkoutSettingsError = null;
    this.checkoutSettingsMessage = null;
    this.admin.getContent('site.checkout').subscribe({
      next: (block) => {
        this.rememberContentVersion('site.checkout', block);
        const meta = (block.meta || {}) as Record<string, any>;
        const parseBool = (value: any, fallback: boolean) => {
          if (typeof value === 'boolean') return value;
          if (typeof value === 'number') return Boolean(value);
          if (typeof value === 'string') {
            const v = value.trim().toLowerCase();
            if (['1', 'true', 'yes', 'on'].includes(v)) return true;
            if (['0', 'false', 'no', 'off'].includes(v)) return false;
          }
          return fallback;
        };
        const shipping = Number(meta['shipping_fee_ron']);
        const threshold = Number(meta['free_shipping_threshold_ron']);
        const phoneRequiredHome = parseBool(meta['phone_required_home'], true);
        const phoneRequiredLocker = parseBool(meta['phone_required_locker'], true);
        const feeEnabled = parseBool(meta['fee_enabled'], false);
        const feeTypeRaw = String(meta['fee_type'] ?? 'flat').trim().toLowerCase();
        const feeType = feeTypeRaw === 'percent' ? 'percent' : 'flat';
        const feeValueRaw = Number(meta['fee_value']);
        const feeValue = Number.isFinite(feeValueRaw) && feeValueRaw >= 0 ? feeValueRaw : 0;
        const vatEnabled = parseBool(meta['vat_enabled'], true);
        const vatRateRaw = Number(meta['vat_rate_percent']);
        const vatRate = Number.isFinite(vatRateRaw) && vatRateRaw >= 0 && vatRateRaw <= 100 ? vatRateRaw : 10;
        const vatApplyToShipping = parseBool(meta['vat_apply_to_shipping'], false);
        const vatApplyToFee = parseBool(meta['vat_apply_to_fee'], false);
        const receiptDaysRaw = Number(meta['receipt_share_days']);
        const receiptShareDays =
          Number.isFinite(receiptDaysRaw) && receiptDaysRaw >= 1 && receiptDaysRaw <= 3650 ? Math.trunc(receiptDaysRaw) : 365;
        const roundingRaw = String(meta['money_rounding'] ?? 'half_up').trim().toLowerCase();
        const moneyRounding: 'half_up' | 'half_even' | 'up' | 'down' =
          roundingRaw === 'half_even' || roundingRaw === 'up' || roundingRaw === 'down' ? roundingRaw : 'half_up';
        this.checkoutSettingsForm = {
          shipping_fee_ron: Number.isFinite(shipping) && shipping >= 0 ? shipping : 20,
          free_shipping_threshold_ron: Number.isFinite(threshold) && threshold >= 0 ? threshold : 300,
          phone_required_home: phoneRequiredHome,
          phone_required_locker: phoneRequiredLocker,
          fee_enabled: feeEnabled,
          fee_type: feeType,
          fee_value: feeValue,
          vat_enabled: vatEnabled,
          vat_rate_percent: vatRate,
          vat_apply_to_shipping: vatApplyToShipping,
          vat_apply_to_fee: vatApplyToFee,
          receipt_share_days: receiptShareDays,
          money_rounding: moneyRounding
        };
      },
      error: () => {
        delete this.contentVersions['site.checkout'];
        this.checkoutSettingsForm = {
          shipping_fee_ron: 20,
          free_shipping_threshold_ron: 300,
          phone_required_home: true,
          phone_required_locker: true,
          fee_enabled: false,
          fee_type: 'flat',
          fee_value: 0,
          vat_enabled: true,
          vat_rate_percent: 10,
          vat_apply_to_shipping: false,
          vat_apply_to_fee: false,
          receipt_share_days: 365,
          money_rounding: 'half_up'
        };
      }
    });
  }

  saveCheckoutSettings(): void {
    this.checkoutSettingsMessage = null;
    this.checkoutSettingsError = null;
    const shippingRaw = Number(this.checkoutSettingsForm.shipping_fee_ron);
    const thresholdRaw = Number(this.checkoutSettingsForm.free_shipping_threshold_ron);
    const shipping = Number.isFinite(shippingRaw) && shippingRaw >= 0 ? Math.round(shippingRaw * 100) / 100 : 20;
    const threshold = Number.isFinite(thresholdRaw) && thresholdRaw >= 0 ? Math.round(thresholdRaw * 100) / 100 : 300;

    const phoneRequiredHome = Boolean(this.checkoutSettingsForm.phone_required_home);
    const phoneRequiredLocker = Boolean(this.checkoutSettingsForm.phone_required_locker);

    const feeEnabled = Boolean(this.checkoutSettingsForm.fee_enabled);
    const feeType = this.checkoutSettingsForm.fee_type === 'percent' ? 'percent' : 'flat';
    const feeValueRaw = Number(this.checkoutSettingsForm.fee_value);
    const feeValue = Number.isFinite(feeValueRaw) && feeValueRaw >= 0 ? Math.round(feeValueRaw * 100) / 100 : 0;

    const vatEnabled = Boolean(this.checkoutSettingsForm.vat_enabled);
    const vatRateRaw = Number(this.checkoutSettingsForm.vat_rate_percent);
    const vatRate =
      Number.isFinite(vatRateRaw) && vatRateRaw >= 0 && vatRateRaw <= 100 ? Math.round(vatRateRaw * 100) / 100 : 10;
    const vatApplyToShipping = Boolean(this.checkoutSettingsForm.vat_apply_to_shipping);
    const vatApplyToFee = Boolean(this.checkoutSettingsForm.vat_apply_to_fee);

    const receiptDaysRaw = Number(this.checkoutSettingsForm.receipt_share_days);
    const receiptShareDays =
      Number.isFinite(receiptDaysRaw) && receiptDaysRaw >= 1 && receiptDaysRaw <= 3650 ? Math.trunc(receiptDaysRaw) : 365;

    const roundingRaw = String(this.checkoutSettingsForm.money_rounding || 'half_up').trim().toLowerCase();
    const moneyRounding: 'half_up' | 'half_even' | 'up' | 'down' =
      roundingRaw === 'half_even' || roundingRaw === 'up' || roundingRaw === 'down' ? roundingRaw : 'half_up';

    const payload = {
      title: 'Checkout settings',
      body_markdown:
        'Checkout pricing settings (shipping, discounts, VAT, additional fees, and receipt sharing).',
      status: 'published',
      meta: {
        version: 1,
        shipping_fee_ron: shipping,
        free_shipping_threshold_ron: threshold,
        phone_required_home: phoneRequiredHome,
        phone_required_locker: phoneRequiredLocker,
        fee_enabled: feeEnabled,
        fee_type: feeType,
        fee_value: feeValue,
        vat_enabled: vatEnabled,
        vat_rate_percent: vatRate,
        vat_apply_to_shipping: vatApplyToShipping,
        vat_apply_to_fee: vatApplyToFee,
        receipt_share_days: receiptShareDays,
        money_rounding: moneyRounding
      }
    };

    const onSuccess = (block?: { version?: number } | null) => {
      this.rememberContentVersion('site.checkout', block);
      this.checkoutSettingsMessage = this.t('adminUi.site.checkout.success.save');
      this.checkoutSettingsError = null;
    };

    this.admin.updateContentBlock('site.checkout', this.withExpectedVersion('site.checkout', payload)).subscribe({
      next: (block) => onSuccess(block),
      error: (err) => {
        if (this.handleContentConflict(err, 'site.checkout', () => this.loadCheckoutSettings())) {
          this.checkoutSettingsError = this.t('adminUi.site.checkout.errors.save');
          this.checkoutSettingsMessage = null;
          return;
        }
        this.admin.createContent('site.checkout', payload).subscribe({
          next: (created) => onSuccess(created),
          error: () => {
            this.checkoutSettingsError = this.t('adminUi.site.checkout.errors.save');
            this.checkoutSettingsMessage = null;
          }
        });
      }
    });
  }

  loadReportsSettings(): void {
    this.reportsSettingsError = null;
    this.reportsSettingsMessage = null;
    this.reportsWeeklyLastSent = null;
    this.reportsWeeklyLastError = null;
    this.reportsMonthlyLastSent = null;
    this.reportsMonthlyLastError = null;
    this.admin.getContent('site.reports').subscribe({
      next: (block) => {
        this.rememberContentVersion('site.reports', block);
        const meta = (block.meta || {}) as Record<string, any>;
        this.reportsSettingsMeta = { ...meta };

        const parseBool = (value: any, fallback: boolean) => {
          if (typeof value === 'boolean') return value;
          if (typeof value === 'number') return Boolean(value);
          if (typeof value === 'string') {
            const v = value.trim().toLowerCase();
            if (['1', 'true', 'yes', 'on'].includes(v)) return true;
            if (['0', 'false', 'no', 'off'].includes(v)) return false;
          }
          return fallback;
        };

        const parseIntSafe = (value: any, fallback: number) => {
          const n = Number(value);
          return Number.isFinite(n) ? Math.trunc(n) : fallback;
        };

        this.reportsSettingsForm.weekly_enabled = parseBool(meta['reports_weekly_enabled'], false);
        this.reportsSettingsForm.weekly_weekday = Math.min(6, Math.max(0, parseIntSafe(meta['reports_weekly_weekday'], 0)));
        this.reportsSettingsForm.weekly_hour_utc = Math.min(23, Math.max(0, parseIntSafe(meta['reports_weekly_hour_utc'], 8)));
        this.reportsSettingsForm.monthly_enabled = parseBool(meta['reports_monthly_enabled'], false);
        this.reportsSettingsForm.monthly_day = String(
          Math.min(28, Math.max(1, parseIntSafe(meta['reports_monthly_day'], 1)))
        );
        this.reportsSettingsForm.monthly_hour_utc = Math.min(23, Math.max(0, parseIntSafe(meta['reports_monthly_hour_utc'], 8)));

        const rawRecipients = meta['reports_recipients'];
        let recipients: string[] = [];
        if (Array.isArray(rawRecipients)) {
          recipients = rawRecipients.map((v) => String(v || '').trim()).filter(Boolean);
        } else if (typeof rawRecipients === 'string') {
          recipients = rawRecipients
            .split(/[,;\n]+/)
            .map((v) => String(v || '').trim())
            .filter(Boolean);
        }
        this.reportsSettingsForm.recipients = recipients.join(', ');

        this.reportsWeeklyLastSent = meta['reports_weekly_last_sent_period_end']
          ? String(meta['reports_weekly_last_sent_period_end'])
          : null;
        this.reportsWeeklyLastError = meta['reports_weekly_last_error'] ? String(meta['reports_weekly_last_error']) : null;
        this.reportsMonthlyLastSent = meta['reports_monthly_last_sent_period_end']
          ? String(meta['reports_monthly_last_sent_period_end'])
          : null;
        this.reportsMonthlyLastError = meta['reports_monthly_last_error'] ? String(meta['reports_monthly_last_error']) : null;
      },
      error: () => {
        delete this.contentVersions['site.reports'];
        this.reportsSettingsMeta = {};
        this.reportsSettingsForm = {
          weekly_enabled: false,
          weekly_weekday: 0,
          weekly_hour_utc: 8,
          monthly_enabled: false,
          monthly_day: 1,
          monthly_hour_utc: 8,
          recipients: ''
        };
      }
    });
  }

  saveReportsSettings(): void {
    this.reportsSettingsMessage = null;
    this.reportsSettingsError = null;

    const meta: Record<string, any> = { ...(this.reportsSettingsMeta || {}) };
    meta['reports_weekly_enabled'] = Boolean(this.reportsSettingsForm.weekly_enabled);
    meta['reports_weekly_weekday'] = Math.min(6, Math.max(0, Number(this.reportsSettingsForm.weekly_weekday || 0)));
    meta['reports_weekly_hour_utc'] = Math.min(23, Math.max(0, Number(this.reportsSettingsForm.weekly_hour_utc || 0)));
    meta['reports_monthly_enabled'] = Boolean(this.reportsSettingsForm.monthly_enabled);
    const monthlyDayRaw = Number(String(this.reportsSettingsForm.monthly_day || '').trim());
    meta['reports_monthly_day'] = Number.isFinite(monthlyDayRaw) ? Math.min(28, Math.max(1, Math.trunc(monthlyDayRaw))) : 1;
    meta['reports_monthly_hour_utc'] = Math.min(23, Math.max(0, Number(this.reportsSettingsForm.monthly_hour_utc || 0)));

    const recipients = String(this.reportsSettingsForm.recipients || '')
      .split(/[,;\n]+/)
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
      .filter((email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
    const uniqueRecipients = Array.from(new Set(recipients));
    if (uniqueRecipients.length) meta['reports_recipients'] = uniqueRecipients;
    else delete meta['reports_recipients'];

    if (!('reports_top_products_limit' in meta)) meta['reports_top_products_limit'] = 5;
    if (!('reports_low_stock_limit' in meta)) meta['reports_low_stock_limit'] = 20;
    if (!('reports_retry_cooldown_minutes' in meta)) meta['reports_retry_cooldown_minutes'] = 60;

    const payload = {
      title: 'Reports settings',
      body_markdown: 'Admin scheduled email reports (weekly/monthly summaries).',
      status: 'published',
      meta
    };

    const onSuccess = (block?: { version?: number; meta?: Record<string, any> | null } | null) => {
      this.rememberContentVersion('site.reports', block);
      this.reportsSettingsMeta = { ...(block?.meta || meta) };
      this.reportsSettingsMessage = this.t('adminUi.reports.success.save');
      this.reportsSettingsError = null;
    };

    this.admin.updateContentBlock('site.reports', this.withExpectedVersion('site.reports', payload)).subscribe({
      next: (block) => onSuccess(block),
      error: (err) => {
        if (this.handleContentConflict(err, 'site.reports', () => this.loadReportsSettings())) {
          this.reportsSettingsError = this.t('adminUi.reports.errors.save');
          this.reportsSettingsMessage = null;
          return;
        }
        this.admin.createContent('site.reports', payload).subscribe({
          next: (created) => onSuccess(created),
          error: () => {
            this.reportsSettingsError = this.t('adminUi.reports.errors.save');
            this.reportsSettingsMessage = null;
          }
        });
      }
    });
  }

  sendReportNow(kind: 'weekly' | 'monthly', force = false): void {
    if (this.reportsSending) return;
    this.reportsSending = true;
    this.reportsSettingsError = null;
    this.reportsSettingsMessage = null;
    this.admin.sendScheduledReport({ kind, force }).subscribe({
      next: (res) => {
        this.reportsSending = false;
        this.reportsSettingsMessage = res.skipped ? this.t('adminUi.reports.success.skipped') : this.t('adminUi.reports.success.sent');
        this.loadReportsSettings();
      },
      error: () => {
        this.reportsSending = false;
        this.reportsSettingsError = this.t('adminUi.reports.errors.send');
      }
    });
  }

	  saveAssets(): void {
	    const payload = {
	      title: 'Site assets',
	      status: 'published',
	      meta: { ...this.assetsForm }
	    };
	    const onSuccess = (block?: { version?: number } | null) => {
        this.rememberContentVersion('site.assets', block);
	      this.assetsMessage = this.t('adminUi.site.assets.success.save');
	      this.assetsError = null;
	    };
	    this.admin.updateContentBlock('site.assets', this.withExpectedVersion('site.assets', payload)).subscribe({
	      next: (block) => onSuccess(block),
	      error: (err) => {
          if (this.handleContentConflict(err, 'site.assets', () => this.loadAssets())) {
            this.assetsError = this.t('adminUi.site.assets.errors.save');
            this.assetsMessage = null;
            return;
          }
	        this.admin.createContent('site.assets', payload).subscribe({
	          next: (created) => onSuccess(created),
	          error: () => {
	            this.assetsError = this.t('adminUi.site.assets.errors.save');
	            this.assetsMessage = null;
	          }
	        })
        }
	    });
		  }

  loadCompany(): void {
    this.companyError = null;
    this.companyMessage = null;
    this.admin.getContent('site.company').subscribe({
      next: (block) => {
        this.rememberContentVersion('site.company', block);
        const meta = (block.meta || {}) as Record<string, any>;
        const company = (meta['company'] || {}) as Record<string, any>;
        this.companyForm = {
          name: String(company['name'] || '').trim(),
          registration_number: String(company['registration_number'] || '').trim(),
          cui: String(company['cui'] || '').trim(),
          address: String(company['address'] || '').trim(),
          phone: String(company['phone'] || '').trim(),
          email: String(company['email'] || '').trim()
        };
        this.companyMessage = null;
      },
      error: () => {
        delete this.contentVersions['site.company'];
        this.companyForm = {
          name: '',
          registration_number: '',
          cui: '',
          address: '',
          phone: '',
          email: ''
        };
      }
    });
  }

  companyMissingFields(): string[] {
    const missing: string[] = [];
    if (!(this.companyForm.name || '').trim()) missing.push('adminUi.site.company.fields.name');
    if (!(this.companyForm.registration_number || '').trim()) missing.push('adminUi.site.company.fields.registrationNumber');
    if (!(this.companyForm.cui || '').trim()) missing.push('adminUi.site.company.fields.cui');
    if (!(this.companyForm.address || '').trim()) missing.push('adminUi.site.company.fields.address');
    if (!(this.companyForm.phone || '').trim()) missing.push('adminUi.site.company.fields.phone');
    if (!(this.companyForm.email || '').trim()) missing.push('adminUi.site.company.fields.email');
    return missing;
  }

  saveCompany(): void {
    this.companyMessage = null;
    this.companyError = null;
    if (this.companyMissingFields().length) {
      this.companyError = this.t('adminUi.site.company.errors.required');
      return;
    }
    const payload = {
      title: 'Company information',
      body_markdown: 'Company identification details (used in footer).',
      status: 'published',
      meta: {
        version: 1,
        company: {
          name: (this.companyForm.name || '').trim(),
          registration_number: (this.companyForm.registration_number || '').trim(),
          cui: (this.companyForm.cui || '').trim(),
          address: (this.companyForm.address || '').trim(),
          phone: (this.companyForm.phone || '').trim(),
          email: (this.companyForm.email || '').trim()
        }
      }
    };
    const onSuccess = (block?: { version?: number } | null) => {
      this.rememberContentVersion('site.company', block);
      this.companyMessage = this.t('adminUi.site.company.success.save');
      this.companyError = null;
    };
    this.admin.updateContentBlock('site.company', this.withExpectedVersion('site.company', payload)).subscribe({
      next: (block) => onSuccess(block),
      error: (err) => {
        if (this.handleContentConflict(err, 'site.company', () => this.loadCompany())) {
          this.companyError = this.t('adminUi.site.company.errors.save');
          this.companyMessage = null;
          return;
        }
        this.admin.createContent('site.company', payload).subscribe({
          next: (created) => onSuccess(created),
          error: () => {
            this.companyError = this.t('adminUi.site.company.errors.save');
            this.companyMessage = null;
          }
        });
      }
    });
  }

	  loadSocial(): void {
	    this.socialError = null;
	    this.socialMessage = null;
	    this.admin.getContent('site.social').subscribe({
	      next: (block) => {
        this.rememberContentVersion('site.social', block);
        const meta = (block.meta || {}) as Record<string, any>;
        const contact = (meta['contact'] || {}) as Record<string, any>;
        this.socialForm.phone = String(contact['phone'] || this.socialForm.phone || '').trim();
        this.socialForm.email = String(contact['email'] || this.socialForm.email || '').trim();
        this.socialForm.instagram_pages = this.parseSocialPages(meta['instagram_pages'], this.socialForm.instagram_pages);
        this.socialForm.facebook_pages = this.parseSocialPages(meta['facebook_pages'], this.socialForm.facebook_pages);
      },
      error: () => {
        delete this.contentVersions['site.social'];
        // Keep defaults.
      }
    });
  }

  addSocialLink(platform: 'instagram' | 'facebook'): void {
    const item = { label: '', url: '', thumbnail_url: '' };
    if (platform === 'instagram') this.socialForm.instagram_pages = [...this.socialForm.instagram_pages, item];
    else this.socialForm.facebook_pages = [...this.socialForm.facebook_pages, item];
  }

  removeSocialLink(platform: 'instagram' | 'facebook', index: number): void {
    if (platform === 'instagram') {
      this.socialForm.instagram_pages = this.socialForm.instagram_pages.filter((_, i) => i !== index);
      return;
    }
    this.socialForm.facebook_pages = this.socialForm.facebook_pages.filter((_, i) => i !== index);
  }

  socialThumbKey(platform: 'instagram' | 'facebook', index: number): string {
    return `${platform}-${index}`;
  }

	  fetchSocialThumbnail(platform: 'instagram' | 'facebook', index: number): void {
	    const key = this.socialThumbKey(platform, index);
	    const pages = platform === 'instagram' ? this.socialForm.instagram_pages : this.socialForm.facebook_pages;
	    const page = pages[index];
	    const url = String(page?.url || '').trim();
	    if (!url) {
	      this.socialThumbErrors[key] = this.t('adminUi.site.social.errors.urlRequired');
	      return;
	    }

    this.socialThumbErrors[key] = '';
    this.socialThumbLoading[key] = true;

	    this.admin.fetchSocialThumbnail(url).subscribe({
	      next: (res) => {
	        this.socialThumbLoading[key] = false;
	        const thumb = String(res?.thumbnail_url || '').trim();
	        if (!thumb) {
	          this.socialThumbErrors[key] = this.t('adminUi.site.social.errors.noThumbnail');
	          return;
	        }
	        page.thumbnail_url = thumb;
	        this.toast.success(
	          this.t('adminUi.site.social.success.thumbnailUpdated'),
	          (page.label || '').trim() || (page.url || '').trim() || this.t('adminUi.site.social.socialLink')
	        );
	      },
	      error: (err) => {
	        this.socialThumbLoading[key] = false;
	        const msg = err?.error?.detail
	          ? String(err.error.detail)
	          : this.t('adminUi.site.social.errors.fetchFailed');
	        this.socialThumbErrors[key] = msg;
	      }
	    });
	  }

	  saveSocial(): void {
	    this.socialMessage = null;
	    this.socialError = null;
	    const instagram_pages = this.sanitizeSocialPages(this.socialForm.instagram_pages);
	    const facebook_pages = this.sanitizeSocialPages(this.socialForm.facebook_pages);
    const payload = {
      title: 'Site social links',
      body_markdown: 'Social pages and contact details used across the storefront.',
      status: 'published',
      meta: {
        version: 1,
        contact: { phone: (this.socialForm.phone || '').trim(), email: (this.socialForm.email || '').trim() },
        instagram_pages,
        facebook_pages
      }
	    };
	    const onSuccess = (block?: { version?: number } | null) => {
        this.rememberContentVersion('site.social', block);
	      this.socialMessage = this.t('adminUi.site.social.success.save');
	      this.socialError = null;
	    };
	    this.admin.updateContentBlock('site.social', this.withExpectedVersion('site.social', payload)).subscribe({
	      next: (block) => onSuccess(block),
	      error: (err) => {
          if (this.handleContentConflict(err, 'site.social', () => this.loadSocial())) {
            this.socialError = this.t('adminUi.site.social.errors.save');
            this.socialMessage = null;
            return;
          }
	        this.admin.createContent('site.social', payload).subscribe({
	          next: (created) => onSuccess(created),
	          error: () => {
	            this.socialError = this.t('adminUi.site.social.errors.save');
	            this.socialMessage = null;
	          }
	        })
        }
	    });
	  }

  private parseSocialPages(
    raw: unknown,
    fallback: Array<{ label: string; url: string; thumbnail_url: string }>
  ): Array<{ label: string; url: string; thumbnail_url: string }> {
    if (!Array.isArray(raw)) return fallback;
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const label = String((item as any).label ?? '').trim();
        const url = String((item as any).url ?? '').trim();
        const thumb = String((item as any).thumbnail_url ?? '').trim();
        return { label, url, thumbnail_url: thumb };
      })
      .filter((x): x is { label: string; url: string; thumbnail_url: string } => !!x);
  }

  private sanitizeSocialPages(
    pages: Array<{ label: string; url: string; thumbnail_url: string }>
  ): Array<{ label: string; url: string; thumbnail_url?: string | null }> {
    const out: Array<{ label: string; url: string; thumbnail_url?: string | null }> = [];
    for (const page of pages) {
      const label = String(page.label || '').trim();
      const url = String(page.url || '').trim();
      const thumb = String(page.thumbnail_url || '').trim();
      if (!label || !url) continue;
      out.push({ label, url, thumbnail_url: thumb || null });
    }
    return out;
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
          description: block.meta?.['description'] || ''
        };
        this.seoMessage = null;
      },
      error: () => {
        delete this.contentVersions[`seo.${this.seoPage}`];
        this.seoForm = { title: '', description: '' };
      }
    });
  }

	  saveSeo(): void {
    const payload = {
      title: this.seoForm.title,
      status: 'published',
      lang: this.seoLang,
      meta: { description: this.seoForm.description }
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
	          }
	        })
        }
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
      }
    });
  }

  structuredDataIssueUrl(issue: { entity_type: string; entity_key: string }): string {
    const type = String(issue?.entity_type || '').trim().toLowerCase();
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
      }
    });
  }

	  selectInfoLang(lang: UiLang): void {
	    this.infoLang = lang;
	  }

  loadInfo(): void {
    const loadKey = async (key: string, target: 'about' | 'faq' | 'shipping' | 'contact'): Promise<void> => {
      const next: LocalizedText = { ...this.infoForm[target] };
      let meta: Record<string, unknown> | null | undefined;

      try {
        const enBlock = await firstValueFrom(this.admin.getContent(key, 'en'));
        this.rememberContentVersion(key, enBlock);
        next.en = enBlock.body_markdown || '';
        meta = (enBlock as { meta?: Record<string, unknown> | null }).meta;
        this.infoForm[target] = { ...this.infoForm[target], en: next.en };
      } catch {
        delete this.contentVersions[key];
      }

      try {
        const roBlock = await firstValueFrom(this.admin.getContent(key, 'ro'));
        next.ro = roBlock.body_markdown || '';
        if (!meta) {
          meta = (roBlock as { meta?: Record<string, unknown> | null }).meta;
        }
        this.infoForm[target] = { ...this.infoForm[target], ro: next.ro };
      } catch {
        // ignore
      }

    };

    void loadKey('page.about', 'about');
    void loadKey('page.faq', 'faq');
    void loadKey('page.shipping', 'shipping');
    void loadKey('page.contact', 'contact');
  }

	  saveInfo(key: 'page.about' | 'page.faq' | 'page.shipping' | 'page.contact', body: string): void {
    this.infoMessage = null;
    this.infoError = null;
    const payload = {
      body_markdown: body,
      status: 'published',
      lang: this.infoLang
	    };
    const createPayload = {
      title: key,
      ...payload
    };
	    const onSuccess = (block?: any | null) => {
        this.rememberContentVersion(key, block);
        this.pageBlocksNeedsTranslationEn[key] = Boolean(block?.needs_translation_en);
        this.pageBlocksNeedsTranslationRo[key] = Boolean(block?.needs_translation_ro);
        this.loadContentPages();
	      this.infoMessage = this.t('adminUi.site.pages.success.save');
	      this.infoError = null;
	    };
	    this.admin.updateContentBlock(key, this.withExpectedVersion(key, payload)).subscribe({
	      next: (block) => onSuccess(block),
	      error: (err) => {
          if (this.handleContentConflict(err, key, () => this.loadInfo())) {
            this.infoError = this.t('adminUi.site.pages.errors.save');
            this.infoMessage = null;
            return;
          }
	        this.admin.createContent(key, createPayload).subscribe({
	          next: (created) => onSuccess(created),
	          error: () => {
	            this.infoError = this.t('adminUi.site.pages.errors.save');
	            this.infoMessage = null;
	          }
	        })
        }
	    });
	  }

  togglePageNeedsTranslation(pageKey: PageBuilderKey, lang: UiLang, event: Event): void {
    const key = (pageKey || '').trim();
    if (!key) return;
    const target = event.target as HTMLInputElement | null;
    const checked = Boolean(target?.checked);
    const payload = lang === 'en' ? { needs_translation_en: checked } : { needs_translation_ro: checked };
    this.pageBlocksTranslationSaving[key] = true;
    this.admin.updateContentTranslationStatus(key, payload).subscribe({
      next: (block) => {
        this.pageBlocksNeedsTranslationEn[key] = Boolean(block.needs_translation_en);
        this.pageBlocksNeedsTranslationRo[key] = Boolean(block.needs_translation_ro);
        this.pageBlocksTranslationSaving[key] = false;
        this.toast.success(this.t('adminUi.site.pages.builder.translation.success'));
        this.loadContentPages();
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.pageBlocksTranslationSaving[key] = false;
        this.toast.error(detail || this.t('adminUi.site.pages.builder.translation.errors.save'));
      }
    });
  }

  loadContentPages(): void {
    this.contentPagesLoading = true;
    this.contentPagesError = null;
    this.admin.listContentPages().subscribe({
      next: (pages) => {
        this.contentPages = [...(pages || [])].sort((a, b) => (a.slug || '').localeCompare(b.slug || ''));
        this.pageBlocksNeedsTranslationEn = {};
        this.pageBlocksNeedsTranslationRo = {};
        for (const page of this.contentPages) {
          this.pageBlocksNeedsTranslationEn[page.key] = Boolean(page.needs_translation_en);
          this.pageBlocksNeedsTranslationRo[page.key] = Boolean(page.needs_translation_ro);
        }
        this.contentPagesLoading = false;
        if (!this.contentPages.length) return;
        const exists = this.contentPages.some((p) => p.key === this.pageBlocksKey);
        if (!exists) {
          const preferred = this.contentPages.find((p) => p.key === 'page.about')?.key || this.contentPages[0].key;
          this.pageBlocksKey = preferred as PageBuilderKey;
        }
      },
      error: () => {
        this.contentPagesLoading = false;
        this.contentPages = [];
        this.contentPagesError = this.t('adminUi.site.pages.errors.load');
      }
    });
  }

  onPageBlocksKeyChange(next: PageBuilderKey): void {
    if (!next || this.pageBlocksKey === next) return;
    this.pageBlocksKey = next;
    this.loadPageBlocks(next);
  }

  loadPageBlocks(pageKey: PageBuilderKey): void {
    this.pageBlocksMessage[pageKey] = null;
    this.pageBlocksError[pageKey] = null;
    this.admin.getContent(pageKey).subscribe({
	      next: (block) => {
	        this.rememberContentVersion(pageKey, block);
	        this.pageBlocksNeedsTranslationEn[pageKey] = Boolean(block.needs_translation_en);
	        this.pageBlocksNeedsTranslationRo[pageKey] = Boolean(block.needs_translation_ro);
        this.pageBlocksStatus[pageKey] =
          block.status === 'published' ? 'published' : block.status === 'review' ? 'review' : 'draft';
        this.pageBlocksPublishedAt[pageKey] = block.published_at ? this.toLocalDateTime(block.published_at) : '';
        this.pageBlocksPublishedUntil[pageKey] = block.published_until ? this.toLocalDateTime(block.published_until) : '';
	        const metaObj = ((block as { meta?: Record<string, unknown> | null }).meta || {}) as Record<string, unknown>;
	        this.pageBlocksMeta[pageKey] = metaObj;
	        this.pageBlocksRequiresAuth[pageKey] = Boolean(metaObj['requires_auth']);
	        this.pageBlocks[pageKey] = this.parsePageBlocksDraft(metaObj);
	        this.ensurePageDraft(pageKey).initFromServer(this.currentPageDraftState(pageKey));
	      },
	      error: (err) => {
	        if (err?.status === 404) {
	          delete this.contentVersions[pageKey];
          this.pageBlocksNeedsTranslationEn[pageKey] = false;
          this.pageBlocksNeedsTranslationRo[pageKey] = false;
          this.pageBlocksStatus[pageKey] = 'draft';
          this.pageBlocksPublishedAt[pageKey] = '';
          this.pageBlocksPublishedUntil[pageKey] = '';
	          this.pageBlocksMeta[pageKey] = {};
	          this.pageBlocksRequiresAuth[pageKey] = false;
	          this.pageBlocks[pageKey] = [];
	          this.ensurePageDraft(pageKey).initFromServer(this.currentPageDraftState(pageKey));
	          return;
	        }
	        this.pageBlocksError[pageKey] = this.t('adminUi.site.pages.builder.errors.load');
	      }
    });
  }

  createCustomPage(): void {
    const title = (this.newCustomPageTitle || '').trim();
    if (!title) return;
    const baseSlug = this.slugifyPageSlug(title);
    if (this.isReservedPageSlug(baseSlug)) {
      this.toast.error(this.t('adminUi.site.pages.errors.reservedTitle'), this.t('adminUi.site.pages.errors.reservedCopy'));
      return;
    }
    const existing = new Set((this.contentPages || []).map((p) => p.slug));
    let slug = baseSlug;
    let counter = 2;
    while (existing.has(slug)) {
      slug = `${baseSlug}-${counter++}`;
    }
    const key = `page.${slug}` as PageBuilderKey;
    this.creatingCustomPage = true;
    const published_at =
      this.newCustomPageStatus === 'published'
        ? this.newCustomPagePublishedAt
          ? new Date(this.newCustomPagePublishedAt).toISOString()
          : null
        : null;
    const published_until =
      this.newCustomPageStatus === 'published'
        ? this.newCustomPagePublishedUntil
          ? new Date(this.newCustomPagePublishedUntil).toISOString()
          : null
        : null;
    const payload = {
      title,
      body_markdown: 'Page builder',
      status: this.newCustomPageStatus,
      published_at,
      published_until,
      meta: { version: 2, blocks: [] }
    };
    const done = () => {
      this.creatingCustomPage = false;
    };
    this.admin.createContent(key, payload).subscribe({
      next: () => {
        done();
        this.toast.success(this.t('adminUi.site.pages.success.created'));
        this.newCustomPageTitle = '';
        this.newCustomPageStatus = 'draft';
        this.newCustomPagePublishedAt = '';
        this.newCustomPagePublishedUntil = '';
        this.loadContentPages();
        this.pageBlocksKey = key;
        this.loadPageBlocks(key);
      },
      error: (err) => {
        done();
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.toast.error(detail || this.t('adminUi.site.pages.errors.create'));
      }
    });
  }

  loadContentRedirects(reset: boolean = false): void {
    if (reset) {
      this.redirectsMeta = { ...this.redirectsMeta, page: 1 };
    }
    this.redirectsLoading = true;
    this.redirectsError = null;
    const q = (this.redirectsQuery || '').trim();
    this.admin
      .listContentRedirects({
        q: q || undefined,
        page: this.redirectsMeta.page,
        limit: this.redirectsMeta.limit
      })
      .subscribe({
        next: (res) => {
          this.redirects = res?.items || [];
          this.redirectsMeta = res?.meta || { total_items: 0, total_pages: 1, page: 1, limit: this.redirectsMeta.limit };
          this.redirectsLoading = false;
        },
        error: () => {
          this.redirectsLoading = false;
          this.redirects = [];
          this.redirectsMeta = { ...this.redirectsMeta, total_items: 0, total_pages: 1 };
          this.redirectsError = this.t('adminUi.site.pages.redirects.errors.load');
        }
      });
  }

  setRedirectsPage(page: number): void {
    const next = Math.max(1, Math.min(Number(page) || 1, this.redirectsMeta.total_pages || 1));
    if (next === this.redirectsMeta.page) return;
    this.redirectsMeta = { ...this.redirectsMeta, page: next };
    this.loadContentRedirects();
  }

  deleteContentRedirect(id: string): void {
    const value = (id || '').trim();
    if (!value) return;
    if (!window.confirm(this.t('adminUi.site.pages.redirects.deleteConfirm'))) return;
    this.admin.deleteContentRedirect(value).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.site.pages.redirects.success.deleted'));
        this.loadContentRedirects(true);
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.toast.error(detail || this.t('adminUi.site.pages.redirects.errors.delete'));
      }
    });
  }

  exportContentRedirects(): void {
    if (this.redirectsExporting) return;
    this.redirectsExporting = true;
    const q = (this.redirectsQuery || '').trim();
    this.admin.exportContentRedirects({ q: q || undefined }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const stamp = new Date().toISOString().slice(0, 10);
        a.download = `content-redirects-${stamp}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        this.redirectsExporting = false;
        this.toast.success(this.t('adminUi.site.pages.redirects.success.export'));
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.redirectsExporting = false;
        this.toast.error(detail || this.t('adminUi.site.pages.redirects.errors.export'));
      }
    });
  }

  importContentRedirects(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] || null;
    if (input) input.value = '';
    if (!file) return;
    if (this.redirectsImporting) return;
    this.redirectsImporting = true;
    this.redirectsImportResult = null;
    this.admin.importContentRedirects(file).subscribe({
      next: (res) => {
        this.redirectsImportResult = res || null;
        this.redirectsImporting = false;
        this.toast.success(this.t('adminUi.site.pages.redirects.success.import'));
        this.loadContentRedirects(true);
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.redirectsImporting = false;
        this.toast.error(detail || this.t('adminUi.site.pages.redirects.errors.import'));
      }
    });
  }

  runLinkCheck(keyOverride?: string): void {
    const key = (keyOverride ?? this.linkCheckKey ?? '').trim();
    if (!key) return;
    this.linkCheckKey = key;
    this.linkCheckLoading = true;
    this.linkCheckError = null;
    this.linkCheckIssues = [];
    this.admin.linkCheckContent(key).subscribe({
      next: (resp) => {
        this.linkCheckIssues = resp?.issues || [];
        this.linkCheckLoading = false;
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.linkCheckError = detail || this.t('adminUi.content.linkCheck.errors.load');
        this.linkCheckIssues = [];
        this.linkCheckLoading = false;
      }
    });
  }

  redirectKeyToUrl(key: string): string {
    const value = (key || '').trim();
    if (value.startsWith('page.')) {
      const slug = value.split('.', 2)[1] || '';
      return `/pages/${slug}`;
    }
    return value;
  }

  canRenamePageKey(key: string): boolean {
    const value = (key || '').trim();
    if (!value.startsWith('page.')) return false;
    if (value === 'page.about' || value === 'page.contact' || value === 'page.faq' || value === 'page.shipping') return false;
    return true;
  }

  renameCustomPageUrl(): void {
    const pageKey = this.pageBlocksKey;
    if (!this.canRenamePageKey(pageKey)) return;
    const oldSlug = pageKey.split('.', 2)[1] || '';
    const entered = window.prompt(this.t('adminUi.site.pages.builder.changeUrlPrompt'), oldSlug);
    if (entered === null) return;
    const nextSlug = this.slugifyPageSlug(entered);
    if (!nextSlug || nextSlug === oldSlug) {
      this.toast.error(this.t('adminUi.site.pages.builder.errors.rename'));
      return;
    }
    if (this.isReservedPageSlug(nextSlug)) {
      this.toast.error(this.t('adminUi.site.pages.errors.reservedTitle'), this.t('adminUi.site.pages.errors.reservedCopy'));
      return;
    }
    if (
      !window.confirm(
        this.t('adminUi.site.pages.builder.changeUrlConfirm', { old: oldSlug, next: nextSlug })
      )
    ) {
      return;
    }
    this.admin.renameContentPage(oldSlug, nextSlug).subscribe({
      next: (res) => {
        this.toast.success(this.t('adminUi.site.pages.builder.success.rename'));
        this.pageBlocksKey = res.new_key as PageBuilderKey;
        this.loadContentPages();
        this.loadPageBlocks(this.pageBlocksKey);
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.toast.error(detail || this.t('adminUi.site.pages.builder.errors.rename'));
      }
    });
  }

  private isReservedPageSlug(slug: string): boolean {
    const value = (slug || '').trim().toLowerCase();
    if (!value) return true;
    const reserved = new Set([
      'admin',
      'account',
      'auth',
      'blog',
      'cart',
      'checkout',
      'contact',
      'error',
      'home',
      'login',
      'register',
      'receipt',
      'pages',
      'products',
      'shop',
      'tickets',
      'about',
      'password-reset'
    ]);
    return reserved.has(value);
  }

  private slugifyPageSlug(value: string): string {
    const raw = (value || '').trim().toLowerCase();
    if (!raw) return 'page';
    const cleaned = raw
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-');
    return cleaned || 'page';
  }

  private parsePageBlocksDraft(meta: Record<string, unknown> | null | undefined): PageBlockDraft[] {
    const rawBlocks = meta?.['blocks'];
    if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) return [];

    const configured: PageBlockDraft[] = [];
    const seen = new Set<string>();

    for (const [idx, raw] of rawBlocks.entries()) {
      if (!raw || typeof raw !== 'object') continue;
      const rec = raw as Record<string, unknown>;
      const typeRaw = typeof rec['type'] === 'string' ? String(rec['type']).trim() : '';
      if (
        typeRaw !== 'text' &&
        typeRaw !== 'image' &&
        typeRaw !== 'gallery' &&
        typeRaw !== 'banner' &&
        typeRaw !== 'carousel'
      ) {
        continue;
      }
      const key = typeof rec['key'] === 'string' ? String(rec['key']).trim() : '';
      const finalKey = key || `${typeRaw}_${idx + 1}`;
      if (!finalKey || seen.has(finalKey)) continue;
      seen.add(finalKey);

      const enabled = rec['enabled'] === false ? false : true;
      const draft: PageBlockDraft = {
        key: finalKey,
        type: typeRaw,
        enabled,
        title: this.toLocalizedText(rec['title']),
        body_markdown: this.emptyLocalizedText(),
        url: '',
        link_url: '',
        focal_x: 50,
        focal_y: 50,
        alt: this.emptyLocalizedText(),
        caption: this.emptyLocalizedText(),
        images: [],
        slide: this.emptySlideDraft(),
        slides: [this.emptySlideDraft()],
        settings: this.defaultCarouselSettings()
      };

      if (typeRaw === 'text') {
        draft.body_markdown = this.toLocalizedText(rec['body_markdown']);
      } else if (typeRaw === 'image') {
        draft.url = typeof rec['url'] === 'string' ? String(rec['url']).trim() : '';
        draft.link_url = typeof rec['link_url'] === 'string' ? String(rec['link_url']).trim() : '';
        draft.alt = this.toLocalizedText(rec['alt']);
        draft.caption = this.toLocalizedText(rec['caption']);
        draft.focal_x = this.toFocalValue(rec['focal_x']);
        draft.focal_y = this.toFocalValue(rec['focal_y']);
      } else if (typeRaw === 'gallery') {
        const imagesRaw = rec['images'];
        if (Array.isArray(imagesRaw)) {
          for (const imgRaw of imagesRaw) {
            if (!imgRaw || typeof imgRaw !== 'object') continue;
            const imgRec = imgRaw as Record<string, unknown>;
            const url = typeof imgRec['url'] === 'string' ? String(imgRec['url']).trim() : '';
            if (!url) continue;
            draft.images.push({
              url,
              alt: this.toLocalizedText(imgRec['alt']),
              caption: this.toLocalizedText(imgRec['caption']),
              focal_x: this.toFocalValue(imgRec['focal_x']),
              focal_y: this.toFocalValue(imgRec['focal_y'])
            });
          }
        }
      } else if (typeRaw === 'banner') {
        draft.slide = this.toSlideDraft(rec['slide']);
      } else if (typeRaw === 'carousel') {
        const slidesRaw = rec['slides'];
        const slides: SlideDraft[] = [];
        if (Array.isArray(slidesRaw)) {
          for (const slideRaw of slidesRaw) slides.push(this.toSlideDraft(slideRaw));
        }
        draft.slides = slides.length ? slides : [this.emptySlideDraft()];
        draft.settings = this.toCarouselSettingsDraft(rec['settings']);
      }

      configured.push(draft);
    }

    return configured;
  }

  setPageInsertDragActive(active: boolean): void {
    this.pageInsertDragActive = active;
  }

  addPageBlockFromLibrary(pageKey: PageBuilderKey, type: CmsBlockLibraryBlockType, template: CmsBlockLibraryTemplate): void {
    const current = [...(this.pageBlocks[pageKey] || [])];
    this.insertPageBlockAt(pageKey, type, current.length, template);
  }

  private insertPageBlockAt(pageKey: PageBuilderKey, type: CmsBlockLibraryBlockType, index: number, template: CmsBlockLibraryTemplate): void {
    const current = [...(this.pageBlocks[pageKey] || [])];
    const existing = new Set(current.map((b) => b.key));
    const base = `${type}_${Date.now()}`;
    let key = base;
    let suffix = 1;
    while (existing.has(key)) {
      key = `${base}_${suffix++}`;
    }
    const draft: PageBlockDraft = {
      key,
      type,
      enabled: true,
      title: this.emptyLocalizedText(),
      body_markdown: this.emptyLocalizedText(),
      url: '',
      link_url: '',
      focal_x: 50,
      focal_y: 50,
      alt: this.emptyLocalizedText(),
      caption: this.emptyLocalizedText(),
      images: [],
      slide: this.emptySlideDraft(),
      slides: [this.emptySlideDraft()],
      settings: this.defaultCarouselSettings()
    };

    if (template === 'starter') {
      this.applyStarterTemplateToCustomBlock(type, draft);
    }

    const safeIndex = Math.max(0, Math.min(index, current.length));
    current.splice(safeIndex, 0, draft);
    this.pageBlocks[pageKey] = current;
  }

  private applyStarterTemplateToCustomBlock(type: CmsBlockLibraryBlockType, block: PageBlockDraft | HomeBlockDraft): void {
    if (type === 'text') {
      block.title = { en: 'Section title', ro: 'Titlu secțiune' };
      block.body_markdown = { en: 'Write your content here...', ro: 'Scrie conținutul aici...' };
      return;
    }

    if (type === 'image') {
      block.title = { en: 'Image section', ro: 'Secțiune imagine' };
      block.alt = { en: 'Image description', ro: 'Descriere imagine' };
      block.caption = { en: 'Optional caption', ro: 'Legendă opțională' };
      block.link_url = '/shop';
      return;
    }

    if (type === 'gallery') {
      block.title = { en: 'Gallery', ro: 'Galerie' };
      const makeImage = (): HomeGalleryImageDraft => ({
        url: '',
        alt: { en: 'Image description', ro: 'Descriere imagine' },
        caption: { en: 'Caption', ro: 'Legendă' },
        focal_x: 50,
        focal_y: 50
      });
      block.images = [makeImage(), makeImage(), makeImage()];
      return;
    }

    if (type === 'banner') {
      block.title = { en: 'Banner', ro: 'Banner' };
      block.slide = {
        ...block.slide,
        headline: { en: 'Headline', ro: 'Titlu' },
        subheadline: { en: 'Supporting text', ro: 'Text de suport' },
        cta_label: { en: 'Shop now', ro: 'Cumpără acum' },
        cta_url: '/shop',
        alt: { en: 'Banner image', ro: 'Imagine banner' }
      };
      return;
    }

    const makeSlide = (idx: number): SlideDraft => {
      const slide = this.emptySlideDraft();
      const n = idx + 1;
      slide.headline = { en: `Slide ${n}`, ro: `Slide ${n}` };
      slide.subheadline = { en: 'Supporting text', ro: 'Text de suport' };
      slide.cta_label = { en: 'Shop', ro: 'Cumpără' };
      slide.cta_url = '/shop';
      slide.alt = { en: 'Carousel image', ro: 'Imagine carusel' };
      return slide;
    };

    block.title = { en: 'Carousel', ro: 'Carusel' };
    block.slides = [makeSlide(0), makeSlide(1), makeSlide(2)];
    block.settings = { ...block.settings, autoplay: true, interval_ms: 5000 };
  }

  private readCmsBlockPayload(event: DragEvent): { scope: 'home' | 'page'; type: CmsBlockLibraryBlockType; template: CmsBlockLibraryTemplate } | null {
    const raw = event.dataTransfer?.getData('text/plain');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as any;
      if (!parsed || typeof parsed !== 'object') return null;
      if (parsed.kind !== 'cms-block') return null;
      const scope = parsed.scope;
      if (scope !== 'home' && scope !== 'page') return null;
      const type = parsed.type;
      if (type !== 'text' && type !== 'image' && type !== 'gallery' && type !== 'banner' && type !== 'carousel') return null;
      const template = parsed.template === 'starter' ? 'starter' : 'blank';
      return { scope, type, template };
    } catch {
      return null;
    }
  }

  addPageBlock(pageKey: PageBuilderKey): void {
    const current = [...(this.pageBlocks[pageKey] || [])];
    this.insertPageBlockAt(pageKey, this.newPageBlockType, current.length, 'blank');
  }

  removePageBlock(pageKey: PageBuilderKey, blockKey: string): void {
    this.pageBlocks[pageKey] = (this.pageBlocks[pageKey] || []).filter((b) => b.key !== blockKey);
  }

	  togglePageBlockEnabled(pageKey: PageBuilderKey, blockKey: string, event: Event): void {
	    const target = event.target as HTMLInputElement | null;
	    const enabled = target?.checked !== false;
	    this.pageBlocks[pageKey] = (this.pageBlocks[pageKey] || []).map((b) => (b.key === blockKey ? { ...b, enabled } : b));
	  }

	  pageBlockLabel(block: PageBlockDraft): string {
	    const key = `adminUi.home.sections.blocks.${block.type}`;
	    const translated = this.t(key);
	    return translated !== key ? translated : String(block.type);
	  }

	  movePageBlock(pageKey: PageBuilderKey, blockKey: string, delta: number): void {
	    const current = [...(this.pageBlocks[pageKey] || [])];
	    const from = current.findIndex((b) => b.key === blockKey);
	    if (from === -1) return;
	    const to = from + delta;
	    if (to < 0 || to >= current.length) return;
	    const [moved] = current.splice(from, 1);
	    current.splice(to, 0, moved);
	    this.pageBlocks[pageKey] = current;
	    this.announceCms(
	      this.t('adminUi.content.reorder.moved', { label: this.pageBlockLabel(moved), pos: to + 1, count: current.length })
	    );
	  }

  onPageBlockDragStart(pageKey: PageBuilderKey, blockKey: string): void {
    this.pageInsertDragActive = true;
    this.draggingPageBlocksKey = pageKey;
    this.draggingPageBlockKey = blockKey;
  }

  onPageBlockDragEnd(): void {
    this.draggingPageBlocksKey = null;
    this.draggingPageBlockKey = null;
    this.pageInsertDragActive = false;
  }

  onPageBlockDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onPageBlockDropZone(event: DragEvent, pageKey: PageBuilderKey, index: number): void {
    event.preventDefault();
    const current = [...(this.pageBlocks[pageKey] || [])];

    if (this.draggingPageBlocksKey === pageKey && this.draggingPageBlockKey) {
      const from = current.findIndex((b) => b.key === this.draggingPageBlockKey);
      if (from === -1) {
        this.onPageBlockDragEnd();
        return;
      }
      const safeIndex = Math.max(0, Math.min(index, current.length));
      const [moved] = current.splice(from, 1);
      const nextIndex = from < safeIndex ? safeIndex - 1 : safeIndex;
      current.splice(nextIndex, 0, moved);
      this.pageBlocks[pageKey] = current;
      this.onPageBlockDragEnd();
      return;
    }

    const payload = this.readCmsBlockPayload(event);
    if (!payload || payload.scope !== 'page') {
      this.onPageBlockDragEnd();
      return;
    }

    this.insertPageBlockAt(pageKey, payload.type, index, payload.template);
    this.pageInsertDragActive = false;
  }

  onPageBlockDrop(event: DragEvent, pageKey: PageBuilderKey, targetKey: string): void {
    event.preventDefault();

    const payload = this.readCmsBlockPayload(event);
    if (payload && payload.scope === 'page') {
      const current = [...(this.pageBlocks[pageKey] || [])];
      const to = current.findIndex((b) => b.key === targetKey);
      if (to !== -1) {
        this.insertPageBlockAt(pageKey, payload.type, to, payload.template);
      }
      this.pageInsertDragActive = false;
      return;
    }

    if (!this.draggingPageBlocksKey || !this.draggingPageBlockKey) return;
    if (this.draggingPageBlocksKey !== pageKey) return;
    if (this.draggingPageBlockKey === targetKey) return;

    const current = [...(this.pageBlocks[pageKey] || [])];
    const from = current.findIndex((b) => b.key === this.draggingPageBlockKey);
    const to = current.findIndex((b) => b.key === targetKey);
    if (from === -1 || to === -1) return;

    const [moved] = current.splice(from, 1);
    const nextIndex = from < to ? to - 1 : to;
    current.splice(nextIndex, 0, moved);
    this.pageBlocks[pageKey] = current;
    this.onPageBlockDragEnd();
  }

  setPageImageBlockUrl(pageKey: PageBuilderKey, blockKey: string, asset: ContentImageAssetRead): void {
    const value = (asset?.url || '').trim();
    if (!value) return;
    const focalX = this.toFocalValue(asset.focal_x);
    const focalY = this.toFocalValue(asset.focal_y);
    this.pageBlocks[pageKey] = (this.pageBlocks[pageKey] || []).map((b) =>
      b.key === blockKey ? { ...b, url: value, focal_x: focalX, focal_y: focalY } : b
    );
    this.toast.success(this.t('adminUi.site.assets.library.success.selected'));
  }

  setPageBannerSlideImage(pageKey: PageBuilderKey, blockKey: string, asset: ContentImageAssetRead): void {
    const value = (asset?.url || '').trim();
    if (!value) return;
    const focalX = this.toFocalValue(asset.focal_x);
    const focalY = this.toFocalValue(asset.focal_y);
    this.pageBlocks[pageKey] = (this.pageBlocks[pageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'banner') return b;
      return { ...b, slide: { ...b.slide, image_url: value, focal_x: focalX, focal_y: focalY } };
    });
    this.toast.success(this.t('adminUi.site.assets.library.success.selected'));
  }

  addPageCarouselSlide(pageKey: PageBuilderKey, blockKey: string): void {
    this.pageBlocks[pageKey] = (this.pageBlocks[pageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'carousel') return b;
      return { ...b, slides: [...(b.slides || []), this.emptySlideDraft()] };
    });
  }

  removePageCarouselSlide(pageKey: PageBuilderKey, blockKey: string, idx: number): void {
    this.pageBlocks[pageKey] = (this.pageBlocks[pageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'carousel') return b;
      const next = [...(b.slides || [])];
      next.splice(idx, 1);
      return { ...b, slides: next.length ? next : [this.emptySlideDraft()] };
    });
  }

  movePageCarouselSlide(pageKey: PageBuilderKey, blockKey: string, idx: number, delta: number): void {
    this.pageBlocks[pageKey] = (this.pageBlocks[pageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'carousel') return b;
      const slides = [...(b.slides || [])];
      const from = idx;
      const to = idx + delta;
      if (from < 0 || from >= slides.length) return b;
      if (to < 0 || to >= slides.length) return b;
      const [moved] = slides.splice(from, 1);
      slides.splice(to, 0, moved);
      return { ...b, slides };
    });
  }

  setPageCarouselSlideImage(pageKey: PageBuilderKey, blockKey: string, idx: number, asset: ContentImageAssetRead): void {
    const value = (asset?.url || '').trim();
    if (!value) return;
    const focalX = this.toFocalValue(asset.focal_x);
    const focalY = this.toFocalValue(asset.focal_y);
    this.pageBlocks[pageKey] = (this.pageBlocks[pageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'carousel') return b;
      const slides = [...(b.slides || [])];
      const target = slides[idx];
      if (!target) return b;
      slides[idx] = { ...target, image_url: value, focal_x: focalX, focal_y: focalY };
      return { ...b, slides };
    });
    this.toast.success(this.t('adminUi.site.assets.library.success.selected'));
  }

  addPageGalleryImage(pageKey: PageBuilderKey, blockKey: string): void {
    this.pageBlocks[pageKey] = (this.pageBlocks[pageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'gallery') return b;
      return {
        ...b,
        images: [
          ...b.images,
          {
            url: '',
            alt: this.emptyLocalizedText(),
            caption: this.emptyLocalizedText(),
            focal_x: 50,
            focal_y: 50
          }
        ]
      };
    });
  }

  addPageGalleryImageFromAsset(pageKey: PageBuilderKey, blockKey: string, asset: ContentImageAssetRead): void {
    const value = (asset?.url || '').trim();
    if (!value) return;
    const focalX = this.toFocalValue(asset.focal_x);
    const focalY = this.toFocalValue(asset.focal_y);
    this.pageBlocks[pageKey] = (this.pageBlocks[pageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'gallery') return b;
      return {
        ...b,
        images: [
          ...b.images,
          {
            url: value,
            alt: this.emptyLocalizedText(),
            caption: this.emptyLocalizedText(),
            focal_x: focalX,
            focal_y: focalY
          }
        ]
      };
    });
    this.toast.success(this.t('adminUi.site.assets.library.success.selected'));
  }

  removePageGalleryImage(pageKey: PageBuilderKey, blockKey: string, idx: number): void {
    this.pageBlocks[pageKey] = (this.pageBlocks[pageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'gallery') return b;
      const next = [...b.images];
      next.splice(idx, 1);
      return { ...b, images: next };
    });
  }

  savePageBlocks(pageKey: PageBuilderKey): void {
    this.pageBlocksMessage[pageKey] = null;
    this.pageBlocksError[pageKey] = null;
    const blocks = (this.pageBlocks[pageKey] || []).map((b) => {
      const base: Record<string, unknown> = { key: b.key, type: b.type, enabled: b.enabled };
      base['title'] = b.title;
      if (b.type === 'text') {
        base['body_markdown'] = b.body_markdown;
      } else if (b.type === 'image') {
        base['url'] = b.url;
        base['link_url'] = b.link_url;
        base['alt'] = b.alt;
        base['caption'] = b.caption;
        base['focal_x'] = this.toFocalValue(b.focal_x);
        base['focal_y'] = this.toFocalValue(b.focal_y);
      } else if (b.type === 'gallery') {
        base['images'] = b.images.map((img) => ({
          url: img.url,
          alt: img.alt,
          caption: img.caption,
          focal_x: this.toFocalValue(img.focal_x),
          focal_y: this.toFocalValue(img.focal_y)
        }));
      } else if (b.type === 'banner') {
        base['slide'] = this.serializeSlideDraft(b.slide);
      } else if (b.type === 'carousel') {
        base['slides'] = (b.slides || []).map((slide) => this.serializeSlideDraft(slide));
        base['settings'] = b.settings;
      }
      return base;
    });

    const meta = { ...(this.pageBlocksMeta[pageKey] || {}), blocks } as Record<string, unknown>;
    if (this.pageBlocksRequiresAuth[pageKey]) {
      meta['requires_auth'] = true;
    } else {
      delete meta['requires_auth'];
    }
    const status: ContentStatusUi = this.pageBlocksStatus[pageKey] || 'draft';
    const published_at =
      status === 'published'
        ? this.pageBlocksPublishedAt[pageKey]
          ? new Date(this.pageBlocksPublishedAt[pageKey]).toISOString()
          : null
        : null;
    const published_until =
      status === 'published'
        ? this.pageBlocksPublishedUntil[pageKey]
          ? new Date(this.pageBlocksPublishedUntil[pageKey]).toISOString()
          : null
        : null;
    const payload: Record<string, unknown> = { meta, status, published_at, published_until, lang: this.infoLang };

    const ok = this.t('adminUi.site.pages.builder.success.save');
    const errMsg = this.t('adminUi.site.pages.builder.errors.save');

    const reload = () => this.loadPageBlocks(pageKey);

    this.admin.updateContentBlock(pageKey, this.withExpectedVersion(pageKey, payload)).subscribe({
      next: (block) => {
        this.rememberContentVersion(pageKey, block);
        this.pageBlocksNeedsTranslationEn[pageKey] = Boolean(block.needs_translation_en);
        this.pageBlocksNeedsTranslationRo[pageKey] = Boolean(block.needs_translation_ro);
        this.pageBlocksStatus[pageKey] =
          block.status === 'published' ? 'published' : block.status === 'review' ? 'review' : 'draft';
        this.pageBlocksPublishedAt[pageKey] = block.published_at ? this.toLocalDateTime(block.published_at) : '';
        this.pageBlocksPublishedUntil[pageKey] = block.published_until ? this.toLocalDateTime(block.published_until) : '';
        this.pageBlocksMeta[pageKey] = ((block as { meta?: Record<string, unknown> | null }).meta || {}) as Record<string, unknown>;
	        this.pageBlocksRequiresAuth[pageKey] = Boolean(this.pageBlocksMeta[pageKey]?.['requires_auth']);
	        this.pageBlocksMessage[pageKey] = ok;
	        this.pageBlocksError[pageKey] = null;
	        this.ensurePageDraft(pageKey).markServerSaved(this.currentPageDraftState(pageKey), true);
	      },
      error: (err) => {
        if (this.handleContentConflict(err, pageKey, reload)) {
          this.pageBlocksError[pageKey] = errMsg;
          this.pageBlocksMessage[pageKey] = null;
          return;
        }
        if (err?.status === 404) {
          const createPayload = {
            title: this.contentPages.find((p) => p.key === pageKey)?.title || pageKey,
            body_markdown: 'Page builder',
            status,
            lang: this.infoLang,
            published_at,
            published_until,
            meta
          };
          this.admin.createContent(pageKey, createPayload).subscribe({
	            next: (created) => {
	              this.rememberContentVersion(pageKey, created);
	              this.pageBlocksNeedsTranslationEn[pageKey] = Boolean(created.needs_translation_en);
	              this.pageBlocksNeedsTranslationRo[pageKey] = Boolean(created.needs_translation_ro);
              this.pageBlocksStatus[pageKey] =
                created.status === 'published' ? 'published' : created.status === 'review' ? 'review' : 'draft';
              this.pageBlocksPublishedAt[pageKey] = created.published_at ? this.toLocalDateTime(created.published_at) : '';
              this.pageBlocksPublishedUntil[pageKey] = created.published_until ? this.toLocalDateTime(created.published_until) : '';
              this.pageBlocksMeta[pageKey] = ((created as { meta?: Record<string, unknown> | null }).meta || {}) as Record<string, unknown>;
	              this.pageBlocksRequiresAuth[pageKey] = Boolean(this.pageBlocksMeta[pageKey]?.['requires_auth']);
	              this.pageBlocksMessage[pageKey] = ok;
	              this.pageBlocksError[pageKey] = null;
	              this.ensurePageDraft(pageKey).markServerSaved(this.currentPageDraftState(pageKey), true);
	            },
            error: () => {
              this.pageBlocksError[pageKey] = errMsg;
              this.pageBlocksMessage[pageKey] = null;
            }
          });
          return;
        }
        this.pageBlocksError[pageKey] = errMsg;
        this.pageBlocksMessage[pageKey] = null;
      }
    });
  }

  // Homepage sections (page builder blocks)
  selectHomeBlocksLang(lang: UiLang): void {
    this.homeBlocksLang = lang;
  }

  private emptyLocalizedText(): LocalizedText {
    return { en: '', ro: '' };
  }

  private toLocalizedText(value: unknown): LocalizedText {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return { en: trimmed, ro: trimmed };
    }
    if (!value || typeof value !== 'object') {
      return this.emptyLocalizedText();
    }
    const record = value as Record<string, unknown>;
    return {
      en: typeof record['en'] === 'string' ? String(record['en']).trim() : '',
      ro: typeof record['ro'] === 'string' ? String(record['ro']).trim() : ''
    };
  }

  private toFocalValue(value: unknown, fallback = 50): number {
    const raw = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(raw)) return fallback;
    return Math.max(0, Math.min(100, Math.round(raw)));
  }

  focalPosition(focalX: unknown, focalY: unknown): string {
    return `${this.toFocalValue(focalX)}% ${this.toFocalValue(focalY)}%`;
  }

  private emptySlideDraft(): SlideDraft {
    return {
      image_url: '',
      alt: this.emptyLocalizedText(),
      headline: this.emptyLocalizedText(),
      subheadline: this.emptyLocalizedText(),
      cta_label: this.emptyLocalizedText(),
      cta_url: '',
      variant: 'split',
      size: 'M',
      text_style: 'dark',
      focal_x: 50,
      focal_y: 50
    };
  }

  private toSlideDraft(value: unknown): SlideDraft {
    if (!value || typeof value !== 'object') return this.emptySlideDraft();
    const rec = value as Record<string, unknown>;
    const draft = this.emptySlideDraft();
    draft.image_url =
      typeof rec['image_url'] === 'string'
        ? String(rec['image_url']).trim()
        : typeof rec['image'] === 'string'
          ? String(rec['image']).trim()
          : draft.image_url;
    draft.alt = this.toLocalizedText(rec['alt']);
    draft.headline = this.toLocalizedText(rec['headline']);
    draft.subheadline = this.toLocalizedText(rec['subheadline']);
    draft.cta_label = this.toLocalizedText(rec['cta_label']);
    draft.cta_url = typeof rec['cta_url'] === 'string' ? String(rec['cta_url']).trim() : '';
    draft.variant = rec['variant'] === 'full' ? 'full' : 'split';
    draft.size = rec['size'] === 'S' || rec['size'] === 'L' ? (rec['size'] as any) : 'M';
    draft.text_style = rec['text_style'] === 'light' ? 'light' : 'dark';
    draft.focal_x = this.toFocalValue(rec['focal_x']);
    draft.focal_y = this.toFocalValue(rec['focal_y']);
    return draft;
  }

  private toCarouselSettingsDraft(value: unknown): CarouselSettingsDraft {
    const rec = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const base = this.defaultCarouselSettings();
    base.autoplay = rec['autoplay'] === true;
    const interval = typeof rec['interval_ms'] === 'number' ? rec['interval_ms'] : Number(rec['interval_ms']);
    base.interval_ms = Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : base.interval_ms;
    base.show_dots = rec['show_dots'] === false ? false : true;
    base.show_arrows = rec['show_arrows'] === false ? false : true;
    base.pause_on_hover = rec['pause_on_hover'] === false ? false : true;
    return base;
  }

  private serializeSlideDraft(slide: SlideDraft): Record<string, unknown> {
    return {
      image_url: (slide.image_url || '').trim(),
      alt: slide.alt,
      headline: slide.headline,
      subheadline: slide.subheadline,
      cta_label: slide.cta_label,
      cta_url: (slide.cta_url || '').trim(),
      variant: slide.variant,
      size: slide.size,
      text_style: slide.text_style,
      focal_x: this.toFocalValue(slide.focal_x),
      focal_y: this.toFocalValue(slide.focal_y)
    };
  }

  private defaultCarouselSettings(): CarouselSettingsDraft {
    return {
      autoplay: false,
      interval_ms: 5000,
      show_dots: true,
      show_arrows: true,
      pause_on_hover: true
    };
  }

  toPreviewSlide(slide: SlideDraft, lang: UiLang = this.homeBlocksLang): any {
    const other: UiLang = lang === 'ro' ? 'en' : 'ro';
    const pick = (text: LocalizedText | null | undefined): string => {
      if (!text) return '';
      const preferred = (text[lang] || '').trim();
      if (preferred) return preferred;
      return (text[other] || '').trim();
    };
    return {
      image_url: (slide.image_url || '').trim(),
      alt: pick(slide.alt) || null,
      headline: pick(slide.headline) || null,
      subheadline: pick(slide.subheadline) || null,
      cta_label: pick(slide.cta_label) || null,
      cta_url: (slide.cta_url || '').trim() || null,
      variant: slide.variant,
      size: slide.size,
      text_style: slide.text_style,
      focal_x: this.toFocalValue(slide.focal_x),
      focal_y: this.toFocalValue(slide.focal_y)
    };
  }

  toPreviewSlides(slides: SlideDraft[], lang: UiLang = this.homeBlocksLang): any[] {
    return (slides || []).map((s) => this.toPreviewSlide(s, lang));
  }

  private isHomeSectionId(value: unknown): value is HomeSectionId {
    return (
      value === 'featured_products' ||
      value === 'sale_products' ||
      value === 'new_arrivals' ||
      value === 'featured_collections' ||
      value === 'story' ||
      value === 'recently_viewed' ||
      value === 'why'
    );
  }

  private normalizeHomeSectionId(value: unknown): HomeSectionId | null {
    if (this.isHomeSectionId(value)) return value;
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    if (!raw) return null;
    const key = raw
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    if (this.isHomeSectionId(key)) return key;
    if (key === 'collections') return 'featured_collections';
    if (key === 'featured') return 'featured_products';
    if (key === 'bestsellers') return 'featured_products';
    if (key === 'sale' || key === 'sales') return 'sale_products';
    if (key === 'new') return 'new_arrivals';
    if (key === 'recent') return 'recently_viewed';
    if (key === 'recentlyviewed') return 'recently_viewed';
    return null;
  }

  private defaultHomeSections(): { id: HomeSectionId; enabled: boolean }[] {
    return [
      { id: 'featured_products', enabled: true },
      { id: 'sale_products', enabled: false },
      { id: 'new_arrivals', enabled: true },
      { id: 'featured_collections', enabled: true },
      { id: 'story', enabled: true },
      { id: 'recently_viewed', enabled: true },
      { id: 'why', enabled: true }
    ];
  }

  private makeHomeBlockDraft(key: string, type: HomeBlockType, enabled: boolean): HomeBlockDraft {
    return {
      key,
      type,
      enabled,
      title: this.emptyLocalizedText(),
      body_markdown: this.emptyLocalizedText(),
      url: '',
      link_url: '',
      focal_x: 50,
      focal_y: 50,
      alt: this.emptyLocalizedText(),
      caption: this.emptyLocalizedText(),
      images: [],
      slide: this.emptySlideDraft(),
      slides: [this.emptySlideDraft()],
      settings: this.defaultCarouselSettings()
    };
  }

  private ensureAllDefaultHomeBlocks(blocks: HomeBlockDraft[]): HomeBlockDraft[] {
    const out = [...blocks];
    const existing = new Set(out.filter((b) => this.isHomeSectionId(b.type)).map((b) => b.type as HomeSectionId));
    for (const { id, enabled } of this.defaultHomeSections()) {
      if (existing.has(id)) continue;
      out.push(this.makeHomeBlockDraft(id, id, enabled));
    }
    return out;
  }

  isCustomHomeBlock(block: HomeBlockDraft): boolean {
    return (
      block.type === 'text' ||
      block.type === 'image' ||
      block.type === 'gallery' ||
      block.type === 'banner' ||
      block.type === 'carousel'
    );
  }

  homeBlockLabel(block: HomeBlockDraft): string {
    const key = `adminUi.home.sections.blocks.${block.type}`;
    const translated = this.t(key);
    return translated !== key ? translated : String(block.type);
  }

	  toggleHomeBlockEnabled(block: HomeBlockDraft, event: Event): void {
	    const target = event.target as HTMLInputElement | null;
	    const enabled = target?.checked !== false;
	    this.homeBlocks = this.homeBlocks.map((b) => (b.key === block.key ? { ...b, enabled } : b));
	  }

	  moveHomeBlock(blockKey: string, delta: number): void {
	    const current = [...this.homeBlocks];
	    const from = current.findIndex((b) => b.key === blockKey);
	    if (from === -1) return;
	    const to = from + delta;
	    if (to < 0 || to >= current.length) return;
	    const [moved] = current.splice(from, 1);
	    current.splice(to, 0, moved);
	    this.homeBlocks = current;
	    this.announceCms(
	      this.t('adminUi.content.reorder.moved', { label: this.homeBlockLabel(moved), pos: to + 1, count: current.length })
	    );
	  }

  setHomeInsertDragActive(active: boolean): void {
    this.homeInsertDragActive = active;
  }

  addHomeBlockFromLibrary(type: CmsBlockLibraryBlockType, template: CmsBlockLibraryTemplate): void {
    this.insertHomeBlockAt(type, this.homeBlocks.length, template);
  }

  private insertHomeBlockAt(type: CmsBlockLibraryBlockType, index: number, template: CmsBlockLibraryTemplate): void {
    const key = this.nextCustomBlockKey(type);
    const draft = this.makeHomeBlockDraft(key, type, true);
    if (template === 'starter') {
      this.applyStarterTemplateToCustomBlock(type, draft);
    }
    const current = [...this.homeBlocks];
    const safeIndex = Math.max(0, Math.min(index, current.length));
    current.splice(safeIndex, 0, draft);
    this.homeBlocks = current;
  }

  onHomeBlockDragStart(key: string): void {
    this.homeInsertDragActive = true;
    this.draggingHomeBlockKey = key;
  }

  onHomeBlockDragEnd(): void {
    this.draggingHomeBlockKey = null;
    this.homeInsertDragActive = false;
  }

  onHomeBlockDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onHomeBlockDropZone(event: DragEvent, index: number): void {
    event.preventDefault();
    const current = [...this.homeBlocks];

    if (this.draggingHomeBlockKey) {
      const from = current.findIndex((b) => b.key === this.draggingHomeBlockKey);
      if (from === -1) {
        this.onHomeBlockDragEnd();
        return;
      }
      const safeIndex = Math.max(0, Math.min(index, current.length));
      const [moved] = current.splice(from, 1);
      const nextIndex = from < safeIndex ? safeIndex - 1 : safeIndex;
      current.splice(nextIndex, 0, moved);
      this.homeBlocks = current;
      this.onHomeBlockDragEnd();
      return;
    }

    const payload = this.readCmsBlockPayload(event);
    if (!payload || payload.scope !== 'home') {
      this.onHomeBlockDragEnd();
      return;
    }

    this.insertHomeBlockAt(payload.type, index, payload.template);
    this.homeInsertDragActive = false;
  }

  onHomeBlockDrop(event: DragEvent, targetKey: string): void {
    event.preventDefault();

    const payload = this.readCmsBlockPayload(event);
    if (payload && payload.scope === 'home') {
      const to = this.homeBlocks.findIndex((b) => b.key === targetKey);
      if (to !== -1) {
        this.insertHomeBlockAt(payload.type, to, payload.template);
      }
      this.homeInsertDragActive = false;
      return;
    }

    if (!this.draggingHomeBlockKey || this.draggingHomeBlockKey === targetKey) return;
    const current = [...this.homeBlocks];
    const from = current.findIndex((b) => b.key === this.draggingHomeBlockKey);
    const to = current.findIndex((b) => b.key === targetKey);
    if (from === -1 || to === -1) {
      this.onHomeBlockDragEnd();
      return;
    }
    const [moved] = current.splice(from, 1);
    const nextIndex = from < to ? to - 1 : to;
    current.splice(nextIndex, 0, moved);
    this.homeBlocks = current;
    this.onHomeBlockDragEnd();
  }

  private nextCustomBlockKey(type: string): string {
    const base = `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    let key = base;
    let i = 1;
    while (this.homeBlocks.some((b) => b.key === key)) {
      key = `${base}-${i}`;
      i += 1;
    }
    return key;
  }

  addHomeBlock(): void {
    this.insertHomeBlockAt(this.newHomeBlockType, this.homeBlocks.length, 'blank');
  }

  removeHomeBlock(key: string): void {
    const target = this.homeBlocks.find((b) => b.key === key);
    if (!target || !this.isCustomHomeBlock(target)) return;
    this.homeBlocks = this.homeBlocks.filter((b) => b.key !== key);
  }

  setImageBlockUrl(blockKey: string, asset: ContentImageAssetRead): void {
    const value = (asset?.url || '').trim();
    if (!value) return;
    const focalX = this.toFocalValue(asset.focal_x);
    const focalY = this.toFocalValue(asset.focal_y);
    this.homeBlocks = this.homeBlocks.map((b) => (b.key === blockKey ? { ...b, url: value, focal_x: focalX, focal_y: focalY } : b));
    this.toast.success(this.t('adminUi.site.assets.library.success.selected'));
  }

  addGalleryImage(blockKey: string): void {
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'gallery') return b;
      return {
        ...b,
        images: [
          ...b.images,
          {
            url: '',
            alt: this.emptyLocalizedText(),
            caption: this.emptyLocalizedText(),
            focal_x: 50,
            focal_y: 50
          }
        ]
      };
    });
  }

  addGalleryImageFromAsset(blockKey: string, asset: ContentImageAssetRead): void {
    const value = (asset?.url || '').trim();
    if (!value) return;
    const focalX = this.toFocalValue(asset.focal_x);
    const focalY = this.toFocalValue(asset.focal_y);
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'gallery') return b;
      return {
        ...b,
        images: [
          ...b.images,
          {
            url: value,
            alt: this.emptyLocalizedText(),
            caption: this.emptyLocalizedText(),
            focal_x: focalX,
            focal_y: focalY
          }
        ]
      };
    });
    this.toast.success(this.t('adminUi.site.assets.library.success.selected'));
  }

  removeGalleryImage(blockKey: string, idx: number): void {
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'gallery') return b;
      const next = [...b.images];
      next.splice(idx, 1);
      return { ...b, images: next };
    });
  }

  setBannerSlideImage(blockKey: string, asset: ContentImageAssetRead): void {
    const value = (asset?.url || '').trim();
    if (!value) return;
    const focalX = this.toFocalValue(asset.focal_x);
    const focalY = this.toFocalValue(asset.focal_y);
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'banner') return b;
      return { ...b, slide: { ...b.slide, image_url: value, focal_x: focalX, focal_y: focalY } };
    });
    this.toast.success(this.t('adminUi.site.assets.library.success.selected'));
  }

  addCarouselSlide(blockKey: string): void {
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'carousel') return b;
      return { ...b, slides: [...(b.slides || []), this.emptySlideDraft()] };
    });
  }

  removeCarouselSlide(blockKey: string, idx: number): void {
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'carousel') return b;
      const next = [...(b.slides || [])];
      next.splice(idx, 1);
      return { ...b, slides: next.length ? next : [this.emptySlideDraft()] };
    });
  }

  moveCarouselSlide(blockKey: string, idx: number, delta: number): void {
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'carousel') return b;
      const slides = [...(b.slides || [])];
      const from = idx;
      const to = idx + delta;
      if (from < 0 || from >= slides.length) return b;
      if (to < 0 || to >= slides.length) return b;
      const [moved] = slides.splice(from, 1);
      slides.splice(to, 0, moved);
      return { ...b, slides };
    });
  }

  setCarouselSlideImage(blockKey: string, idx: number, asset: ContentImageAssetRead): void {
    const value = (asset?.url || '').trim();
    if (!value) return;
    const focalX = this.toFocalValue(asset.focal_x);
    const focalY = this.toFocalValue(asset.focal_y);
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'carousel') return b;
      const slides = [...(b.slides || [])];
      const target = slides[idx];
      if (!target) return b;
      slides[idx] = { ...target, image_url: value, focal_x: focalX, focal_y: focalY };
      return { ...b, slides };
    });
    this.toast.success(this.t('adminUi.site.assets.library.success.selected'));
  }

  loadSections(): void {
    this.admin.getContent('home.sections').subscribe({
      next: (block) => {
        this.rememberContentVersion('home.sections', block);
        const meta = block.meta || {};
        const rawBlocks = meta['blocks'];
        if (Array.isArray(rawBlocks) && rawBlocks.length) {
          const configured: HomeBlockDraft[] = [];
          const seenKeys = new Set<string>();
          const seenBuiltIns = new Set<HomeSectionId>();

          const ensureUniqueKey = (raw: unknown, fallback: string): string => {
            const base = (typeof raw === 'string' ? raw.trim() : '') || fallback;
            let key = base;
            let i = 1;
            while (!key || seenKeys.has(key)) {
              key = `${base}-${i}`;
              i += 1;
            }
            seenKeys.add(key);
            return key;
          };

          for (const raw of rawBlocks) {
            if (!raw || typeof raw !== 'object') continue;
            const rec = raw as Record<string, unknown>;
            const typeRaw = typeof rec['type'] === 'string' ? String(rec['type']).trim() : '';
            const enabledRaw = rec['enabled'];
            const enabled = enabledRaw === false ? false : true;
            const builtIn = this.normalizeHomeSectionId(typeRaw);
            const type: HomeBlockType | null =
              builtIn ||
              (typeRaw === 'text' ||
              typeRaw === 'image' ||
              typeRaw === 'gallery' ||
              typeRaw === 'banner' ||
              typeRaw === 'carousel'
                ? (typeRaw as HomeBlockType)
                : null);
            if (!type) continue;

            if (builtIn) {
              if (seenBuiltIns.has(builtIn)) continue;
              seenBuiltIns.add(builtIn);
              seenKeys.add(builtIn);
              configured.push(this.makeHomeBlockDraft(builtIn, builtIn, enabled));
              continue;
            }

            const key = ensureUniqueKey(rec['key'], this.nextCustomBlockKey(type));
            const draft = this.makeHomeBlockDraft(key, type, enabled);
            draft.title = this.toLocalizedText(rec['title']);
            if (type === 'text') {
              draft.body_markdown = this.toLocalizedText(rec['body_markdown']);
            } else if (type === 'image') {
              draft.url = typeof rec['url'] === 'string' ? String(rec['url']).trim() : '';
              draft.link_url = typeof rec['link_url'] === 'string' ? String(rec['link_url']).trim() : '';
              draft.alt = this.toLocalizedText(rec['alt']);
              draft.caption = this.toLocalizedText(rec['caption']);
              draft.focal_x = this.toFocalValue(rec['focal_x']);
              draft.focal_y = this.toFocalValue(rec['focal_y']);
            } else if (type === 'gallery') {
              const imagesRaw = rec['images'];
              if (Array.isArray(imagesRaw)) {
                for (const imgRaw of imagesRaw) {
                  if (!imgRaw || typeof imgRaw !== 'object') continue;
                  const imgRec = imgRaw as Record<string, unknown>;
                  const url = typeof imgRec['url'] === 'string' ? String(imgRec['url']).trim() : '';
                  if (!url) continue;
                  draft.images.push({
                    url,
                    alt: this.toLocalizedText(imgRec['alt']),
                    caption: this.toLocalizedText(imgRec['caption']),
                    focal_x: this.toFocalValue(imgRec['focal_x']),
                    focal_y: this.toFocalValue(imgRec['focal_y'])
                  });
                }
              }
            } else if (type === 'banner') {
              draft.slide = this.toSlideDraft(rec['slide']);
            } else if (type === 'carousel') {
              const slidesRaw = rec['slides'];
              const slides: SlideDraft[] = [];
              if (Array.isArray(slidesRaw)) {
                for (const slideRaw of slidesRaw) slides.push(this.toSlideDraft(slideRaw));
              }
              draft.slides = slides.length ? slides : [this.emptySlideDraft()];
              draft.settings = this.toCarouselSettingsDraft(rec['settings']);
            }
            configured.push(draft);
          }

	          if (configured.length) {
	            this.homeBlocks = this.ensureAllDefaultHomeBlocks(configured);
	            this.cmsHomeDraft.initFromServer(this.homeBlocks);
	            return;
	          }
	        }

        const derived: HomeBlockDraft[] = [];
        const seen = new Set<HomeSectionId>();
        const addSection = (rawId: unknown, enabled: boolean) => {
          const id = this.normalizeHomeSectionId(rawId);
          if (!id || seen.has(id)) return;
          seen.add(id);
          derived.push(this.makeHomeBlockDraft(id, id, enabled));
        };

        const rawSections = meta['sections'];
        if (Array.isArray(rawSections)) {
          for (const raw of rawSections) {
            if (!raw || typeof raw !== 'object') continue;
            addSection((raw as { id?: unknown }).id, (raw as { enabled?: unknown }).enabled === false ? false : true);
          }
	          if (derived.length) {
	            this.homeBlocks = this.ensureAllDefaultHomeBlocks(derived);
	            this.cmsHomeDraft.initFromServer(this.homeBlocks);
	            return;
	          }
	        }

        const legacyOrder = meta['order'];
        if (Array.isArray(legacyOrder) && legacyOrder.length) {
          for (const raw of legacyOrder) {
            addSection(raw, true);
          }
	          if (derived.length) {
	            this.homeBlocks = this.ensureAllDefaultHomeBlocks(derived);
	            this.cmsHomeDraft.initFromServer(this.homeBlocks);
	            return;
	          }
	        }

	        this.homeBlocks = this.ensureAllDefaultHomeBlocks([]);
	        this.cmsHomeDraft.initFromServer(this.homeBlocks);
	      },
	      error: () => {
	        delete this.contentVersions['home.sections'];
	        this.homeBlocks = this.ensureAllDefaultHomeBlocks([]);
	        this.cmsHomeDraft.initFromServer(this.homeBlocks);
	      }
	    });
	  }

  saveSections(): void {
    const blocks = this.homeBlocks.map((b) => {
      const base: Record<string, unknown> = { key: b.key, type: b.type, enabled: b.enabled };
      if (b.type === 'text') {
        base['title'] = b.title;
        base['body_markdown'] = b.body_markdown;
      } else if (b.type === 'image') {
        base['title'] = b.title;
        base['url'] = b.url;
        base['link_url'] = b.link_url;
        base['alt'] = b.alt;
        base['caption'] = b.caption;
        base['focal_x'] = this.toFocalValue(b.focal_x);
        base['focal_y'] = this.toFocalValue(b.focal_y);
      } else if (b.type === 'gallery') {
        base['title'] = b.title;
        base['images'] = b.images.map((img) => ({
          url: img.url,
          alt: img.alt,
          caption: img.caption,
          focal_x: this.toFocalValue(img.focal_x),
          focal_y: this.toFocalValue(img.focal_y)
        }));
      } else if (b.type === 'banner') {
        base['title'] = b.title;
        base['slide'] = this.serializeSlideDraft(b.slide);
      } else if (b.type === 'carousel') {
        base['title'] = b.title;
        base['slides'] = (b.slides || []).map((slide) => this.serializeSlideDraft(slide));
        base['settings'] = b.settings;
      }
      return base;
    });

    const sections: Array<{ id: HomeSectionId; enabled: boolean }> = [];
    const seen = new Set<HomeSectionId>();
    for (const block of this.homeBlocks) {
      if (!this.isHomeSectionId(block.type)) continue;
      const id = block.type as HomeSectionId;
      if (seen.has(id)) continue;
      seen.add(id);
      sections.push({ id, enabled: block.enabled });
    }

    const payload = {
      title: 'Home sections',
      body_markdown: 'Home layout order',
      meta: { version: 2, blocks, sections, order: sections.map((s) => s.id) },
      status: 'published'
    };
    const ok = this.t('adminUi.home.sections.success.save');
    const errMsg = this.t('adminUi.home.sections.errors.save');
	    this.admin.updateContentBlock('home.sections', this.withExpectedVersion('home.sections', payload)).subscribe({
	      next: (block) => {
	        this.rememberContentVersion('home.sections', block);
	        this.sectionsMessage = ok;
	        this.cmsHomeDraft.markServerSaved(this.homeBlocks, true);
	      },
	      error: (err) => {
	        if (this.handleContentConflict(err, 'home.sections', () => this.loadSections())) {
	          this.sectionsMessage = errMsg;
	          return;
        }
        if (err?.status === 404) {
	          this.admin.createContent('home.sections', payload).subscribe({
	            next: (created) => {
	              this.rememberContentVersion('home.sections', created);
	              this.sectionsMessage = ok;
	              this.cmsHomeDraft.markServerSaved(this.homeBlocks, true);
	            },
	            error: () => (this.sectionsMessage = errMsg)
	          });
	        } else {
	          this.sectionsMessage = errMsg;
        }
      }
    });
  }

  // Featured collections
  loadCollections(): void {
    this.admin.listFeaturedCollections().subscribe({
      next: (cols) => (this.featuredCollections = cols),
      error: () => (this.featuredCollections = [])
    });
  }

  resetCollectionForm(): void {
    this.editingCollection = null;
    this.collectionForm = { name: '', description: '', product_ids: [] };
    this.collectionMessage = '';
  }

  editCollection(col: FeaturedCollection): void {
    this.editingCollection = col.slug;
    this.collectionForm = {
      name: col.name,
      description: col.description || '',
      product_ids: col.product_ids || []
    };
  }

  saveCollection(): void {
    if (!this.collectionForm.name) {
      this.toast.error(this.t('adminUi.home.collections.errors.required'));
      return;
    }
    const payload = {
      name: this.collectionForm.name,
      description: this.collectionForm.description,
      product_ids: this.collectionForm.product_ids
    };
    const obs = this.editingCollection
      ? this.admin.updateFeaturedCollection(this.editingCollection, payload)
      : this.admin.createFeaturedCollection(payload);
    obs.subscribe({
      next: (col) => {
        const existing = this.featuredCollections.find((c) => c.slug === col.slug);
        if (existing) {
          this.featuredCollections = this.featuredCollections.map((c) => (c.slug === col.slug ? col : c));
        } else {
          this.featuredCollections = [col, ...this.featuredCollections];
        }
        this.collectionMessage = this.t('adminUi.home.collections.success.saved');
        this.editingCollection = null;
      },
      error: () => this.toast.error(this.t('adminUi.home.collections.errors.save'))
    });
  }

  saveMaintenance(): void {
    this.admin.setMaintenance(this.maintenanceEnabledValue).subscribe({
      next: (res) => {
        this.maintenanceEnabled.set(res.enabled);
        this.maintenanceEnabledValue = res.enabled;
        this.toast.success(this.t('adminUi.maintenance.success.update'));
      },
      error: () => this.toast.error(this.t('adminUi.maintenance.errors.update'))
    });
  }
}
