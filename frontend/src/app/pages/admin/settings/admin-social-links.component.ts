import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AdminService } from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';

interface SocialPage {
  label: string;
  url: string;
  thumbnail_url: string;
}

interface SocialForm {
  phone: string;
  email: string;
  instagram_pages: SocialPage[];
  facebook_pages: SocialPage[];
}

/**
 * Settings > Social links panel, extracted (behaviour-preserving) from the
 * monolithic AdminComponent. Owns the social/contact form state, the per-link
 * add/remove list handling, thumbnail fetching and the load/save logic. The
 * shared CMS content-version bookkeeping stays on the parent AdminComponent and
 * is threaded in through the four callback inputs so all CMS panels keep sharing
 * one `contentVersions` map.
 */
@Component({
  selector: 'app-admin-social-links',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, TranslateModule, ButtonComponent, InputComponent],
  template: `
    <section
      class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
          {{ 'adminUi.site.social.title' | translate }}
        </h2>
        <div class="flex items-center gap-2">
          <app-button
            size="sm"
            variant="ghost"
            [label]="'adminUi.actions.refresh' | translate"
            (action)="loadSocial()"
          ></app-button>
          <app-button
            size="sm"
            [label]="'adminUi.actions.save' | translate"
            (action)="saveSocial()"
          ></app-button>
        </div>
      </div>
      <div class="grid md:grid-cols-2 gap-3 text-sm">
        <app-input
          [label]="'adminUi.site.social.phone' | translate"
          [(value)]="socialForm.phone"
        ></app-input>
        <app-input
          [label]="'adminUi.site.social.email' | translate"
          [(value)]="socialForm.email"
        ></app-input>
      </div>
      <div class="grid md:grid-cols-2 gap-4">
        <div class="grid gap-2">
          <div class="flex items-center justify-between">
            <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
              {{ 'adminUi.site.social.instagramPages' | translate }}
            </p>
            <button
              class="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300"
              type="button"
              (click)="addSocialLink('instagram')"
            >
              {{ 'adminUi.actions.add' | translate }}
            </button>
          </div>
          <div
            *ngFor="let page of socialForm.instagram_pages; let i = index"
            class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30"
          >
            <app-input
              [label]="'adminUi.site.social.label' | translate"
              [(value)]="page.label"
            ></app-input>
            <app-input
              [label]="'adminUi.site.social.url' | translate"
              [(value)]="page.url"
            ></app-input>
            <app-input
              [label]="'adminUi.site.social.thumbnailUrlOptional' | translate"
              [(value)]="page.thumbnail_url"
            ></app-input>
            <div class="flex items-center gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.site.social.fetchThumbnail' | translate"
                [disabled]="
                  socialThumbLoading[socialThumbKey('instagram', i)] || !(page.url || '').trim()
                "
                (action)="fetchSocialThumbnail('instagram', i)"
              ></app-button>
              <span
                *ngIf="socialThumbLoading[socialThumbKey('instagram', i)]"
                class="text-xs text-slate-600 dark:text-slate-300"
              >
                {{ 'adminUi.site.social.fetching' | translate }}
              </span>
              <span
                *ngIf="socialThumbErrors[socialThumbKey('instagram', i)]"
                class="text-xs text-rose-700 dark:text-rose-300"
              >
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
            <button
              class="text-xs text-rose-700 hover:underline dark:text-rose-300 justify-self-start"
              type="button"
              (click)="removeSocialLink('instagram', i)"
            >
              {{ 'adminUi.actions.remove' | translate }}
            </button>
          </div>
        </div>
        <div class="grid gap-2">
          <div class="flex items-center justify-between">
            <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
              {{ 'adminUi.site.social.facebookPages' | translate }}
            </p>
            <button
              class="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300"
              type="button"
              (click)="addSocialLink('facebook')"
            >
              {{ 'adminUi.actions.add' | translate }}
            </button>
          </div>
          <div
            *ngFor="let page of socialForm.facebook_pages; let i = index"
            class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30"
          >
            <app-input
              [label]="'adminUi.site.social.label' | translate"
              [(value)]="page.label"
            ></app-input>
            <app-input
              [label]="'adminUi.site.social.url' | translate"
              [(value)]="page.url"
            ></app-input>
            <app-input
              [label]="'adminUi.site.social.thumbnailUrlOptional' | translate"
              [(value)]="page.thumbnail_url"
            ></app-input>
            <div class="flex items-center gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.site.social.fetchThumbnail' | translate"
                [disabled]="
                  socialThumbLoading[socialThumbKey('facebook', i)] || !(page.url || '').trim()
                "
                (action)="fetchSocialThumbnail('facebook', i)"
              ></app-button>
              <span
                *ngIf="socialThumbLoading[socialThumbKey('facebook', i)]"
                class="text-xs text-slate-600 dark:text-slate-300"
              >
                {{ 'adminUi.site.social.fetching' | translate }}
              </span>
              <span
                *ngIf="socialThumbErrors[socialThumbKey('facebook', i)]"
                class="text-xs text-rose-700 dark:text-rose-300"
              >
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
            <button
              class="text-xs text-rose-700 hover:underline dark:text-rose-300 justify-self-start"
              type="button"
              (click)="removeSocialLink('facebook', i)"
            >
              {{ 'adminUi.actions.remove' | translate }}
            </button>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="socialMessage">{{
          socialMessage
        }}</span>
        <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="socialError">{{
          socialError
        }}</span>
      </div>
    </section>
  `,
})
export class AdminSocialLinksComponent implements OnInit {
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

  socialForm: SocialForm = {
    phone: '+40723204204',
    email: 'momentstudio.ro@gmail.com',
    instagram_pages: [
      {
        label: 'Moments in Clay - Studio',
        url: 'https://www.instagram.com/moments_in_clay_studio?igsh=ZmdnZTdudnNieDQx',
        thumbnail_url: '',
      },
      {
        label: 'momentstudio',
        url: 'https://www.instagram.com/adrianaartizanat?igsh=ZmZmaDU1MGcxZHEy',
        thumbnail_url: '',
      },
    ],
    facebook_pages: [
      {
        label: 'Moments in Clay - Studio',
        url: 'https://www.facebook.com/share/17YqBmfX5x/',
        thumbnail_url: '',
      },
      {
        label: 'momentstudio',
        url: 'https://www.facebook.com/share/1APqKJM6Zi/',
        thumbnail_url: '',
      },
    ],
  };
  socialMessage: string | null = null;
  socialError: string | null = null;
  socialThumbLoading: Record<string, boolean> = {};
  socialThumbErrors: Record<string, string> = {};

  constructor(
    private readonly admin: AdminService,
    private readonly translate: TranslateService,
    private readonly toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.loadSocial();
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
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
        this.socialForm.instagram_pages = this.parseSocialPages(
          meta['instagram_pages'],
          this.socialForm.instagram_pages,
        );
        this.socialForm.facebook_pages = this.parseSocialPages(
          meta['facebook_pages'],
          this.socialForm.facebook_pages,
        );
      },
      error: () => {
        this.forgetContentVersion('site.social');
        // Keep defaults.
      },
    });
  }

  addSocialLink(platform: 'instagram' | 'facebook'): void {
    const item = { label: '', url: '', thumbnail_url: '' };
    if (platform === 'instagram')
      this.socialForm.instagram_pages = [...this.socialForm.instagram_pages, item];
    else this.socialForm.facebook_pages = [...this.socialForm.facebook_pages, item];
  }

  removeSocialLink(platform: 'instagram' | 'facebook', index: number): void {
    if (platform === 'instagram') {
      this.socialForm.instagram_pages = this.socialForm.instagram_pages.filter(
        (_, i) => i !== index,
      );
      return;
    }
    this.socialForm.facebook_pages = this.socialForm.facebook_pages.filter((_, i) => i !== index);
  }

  socialThumbKey(platform: 'instagram' | 'facebook', index: number): string {
    return `${platform}-${index}`;
  }

  fetchSocialThumbnail(platform: 'instagram' | 'facebook', index: number): void {
    const key = this.socialThumbKey(platform, index);
    const pages =
      platform === 'instagram' ? this.socialForm.instagram_pages : this.socialForm.facebook_pages;
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
          (page.label || '').trim() ||
            (page.url || '').trim() ||
            this.t('adminUi.site.social.socialLink'),
        );
      },
      error: (err) => {
        this.socialThumbLoading[key] = false;
        const msg = err?.error?.detail
          ? String(err.error.detail)
          : this.t('adminUi.site.social.errors.fetchFailed');
        this.socialThumbErrors[key] = msg;
      },
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
        contact: {
          phone: (this.socialForm.phone || '').trim(),
          email: (this.socialForm.email || '').trim(),
        },
        instagram_pages,
        facebook_pages,
      },
    };
    const onSuccess = (block?: { version?: number } | null) => {
      this.rememberContentVersion('site.social', block);
      this.socialMessage = this.t('adminUi.site.social.success.save');
      this.socialError = null;
    };
    this.admin
      .updateContentBlock('site.social', this.withExpectedVersion('site.social', payload))
      .subscribe({
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
            },
          });
        },
      });
  }

  private parseSocialPages(raw: unknown, fallback: SocialPage[]): SocialPage[] {
    if (!Array.isArray(raw)) return fallback;
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const label = String(item.label ?? '').trim();
        const url = String(item.url ?? '').trim();
        const thumb = String(item.thumbnail_url ?? '').trim();
        return { label, url, thumbnail_url: thumb };
      })
      .filter((x): x is SocialPage => !!x);
  }

  private sanitizeSocialPages(
    pages: SocialPage[],
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
}
