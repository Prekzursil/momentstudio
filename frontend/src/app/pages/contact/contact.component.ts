import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { Subscription, finalize } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { appConfig } from '../../core/app-config';
import { MarkdownService } from '../../core/markdown.service';
import { SiteSocialLink, SiteSocialService } from '../../core/site-social.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';
import { ContactSubmissionTopic, SupportService } from '../../core/support.service';
import { SeoHeadLinksService } from '../../core/seo-head-links.service';
import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { CaptchaTurnstileComponent } from '../../shared/captcha-turnstile.component';
import { CardComponent } from '../../shared/card.component';
import { CmsPageBlocksComponent } from '../../shared/cms-page-blocks.component';
import { ImgFallbackDirective } from '../../shared/img-fallback.directive';
import { PageBlock, pageBlocksToPlainText, parsePageBlocks } from '../../shared/page-blocks';
import { resolveRouteSeoDescription } from '../../core/route-seo-defaults';

interface ContentBlock {
  title: string;
  body_markdown: string;
  meta?: Record<string, unknown> | null;
}

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ContainerComponent,
    BreadcrumbComponent,
    CardComponent,
    TranslateModule,
    ImgFallbackDirective,
    CmsPageBlocksComponent,
    ButtonComponent,
    CaptchaTurnstileComponent
  ],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-3xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div class="flex flex-wrap items-start justify-between gap-3">
        <h1
          class="text-2xl font-semibold text-slate-900 dark:text-slate-50"
          data-route-heading="true"
          tabindex="-1"
        >
          {{ block()?.title || ('contact.title' | translate) }}
        </h1>
        <app-button
          *ngIf="canEditPage()"
          class="no-print"
          size="sm"
          variant="ghost"
          [label]="'page.admin.edit' | translate"
          (action)="editPage()"
        ></app-button>
      </div>

      <app-card>
        <div class="grid gap-5 text-slate-700 dark:text-slate-200">
          <div *ngIf="loading()" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'contact.loading' | translate }}
          </div>

          <div *ngIf="!loading() && hasError()" class="grid gap-2">
            <p class="font-semibold text-amber-900 dark:text-amber-100">{{ 'contact.errorTitle' | translate }}</p>
            <p class="text-sm text-amber-800 dark:text-amber-200">{{ 'contact.errorCopy' | translate }}</p>
          </div>

          <ng-container *ngIf="!loading()">
            <ng-container *ngIf="pageBlocks().length; else markdownIntro">
              <app-cms-page-blocks [blocks]="pageBlocks()"></app-cms-page-blocks>
            </ng-container>
            <ng-template #markdownIntro>
              <div class="markdown text-lg text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="bodyHtml()"></div>
            </ng-template>
          </ng-container>

          <div class="grid gap-3 sm:grid-cols-2">
            <a
              class="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              [href]="'tel:' + (phone() || '')"
            >
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {{ 'contact.phoneLabel' | translate }}
              </p>
              <p class="mt-1 font-semibold text-slate-900 group-hover:text-slate-950 dark:text-slate-50">
                {{ phone() }}
              </p>
            </a>
            <a
              class="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              [href]="'mailto:' + (email() || '')"
            >
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {{ 'contact.emailLabel' | translate }}
              </p>
              <p class="mt-1 font-semibold text-slate-900 group-hover:text-slate-950 dark:text-slate-50 break-all">
                {{ email() }}
              </p>
            </a>
          </div>

          <div *ngIf="instagramPages().length || facebookPages().length" class="grid gap-3">
            <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {{ 'contact.followUs' | translate }}
            </p>
            <div class="grid gap-3 sm:grid-cols-2">
              <div *ngIf="instagramPages().length" class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'footer.instagram' | translate }}</p>
                <div class="mt-2 grid gap-2">
                  <a
                    *ngFor="let page of instagramPages()"
                    class="flex items-center gap-3 rounded-xl px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
                    [href]="page.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ng-container *ngIf="page.thumbnail_url; else instagramAvatar">
                      <img
                        [src]="page.thumbnail_url"
                        [alt]="page.label"
                        class="h-8 w-8 rounded-full border border-slate-200 object-cover dark:border-slate-700"
                        appImgFallback="assets/placeholder/avatar-placeholder.svg"
                        loading="lazy"
                      />
                    </ng-container>
                    <ng-template #instagramAvatar>
                      <span class="h-8 w-8 rounded-full bg-gradient-to-br from-fuchsia-500 to-rose-500 grid place-items-center text-xs font-semibold text-white">
                        {{ initialsForLabel(page.label) }}
                      </span>
                    </ng-template>
                    <span class="truncate">{{ page.label }}</span>
                  </a>
                </div>
              </div>
              <div *ngIf="facebookPages().length" class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'footer.facebook' | translate }}</p>
                <div class="mt-2 grid gap-2">
                  <a
                    *ngFor="let page of facebookPages()"
                    class="flex items-center gap-3 rounded-xl px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
                    [href]="page.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ng-container *ngIf="page.thumbnail_url; else facebookAvatar">
                      <img
                        [src]="page.thumbnail_url"
                        [alt]="page.label"
                        class="h-8 w-8 rounded-full border border-slate-200 object-cover dark:border-slate-700"
                        appImgFallback="assets/placeholder/avatar-placeholder.svg"
                        loading="lazy"
                      />
                    </ng-container>
                    <ng-template #facebookAvatar>
                      <span class="h-8 w-8 rounded-full bg-gradient-to-br from-blue-600 to-sky-500 grid place-items-center text-xs font-semibold text-white">
                        {{ initialsForLabel(page.label) }}
                      </span>
                    </ng-template>
                    <span class="truncate">{{ page.label }}</span>
                  </a>
                </div>
              </div>
            </div>
          </div>

          <div class="border-t border-slate-200 pt-6 grid gap-4 dark:border-slate-800">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'contact.form.title' | translate }}</h2>

            <div
              *ngIf="submitSuccess()"
              class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
            >
              <p class="font-semibold">{{ 'contact.form.successTitle' | translate }}</p>
              <p class="text-sm">{{ 'contact.form.successCopy' | translate }}</p>
            </div>

            <div *ngIf="submitError()" class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
              {{ submitError() }}
            </div>

            <form class="grid gap-4" (ngSubmit)="submit()" #contactForm="ngForm">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'contact.form.topicLabel' | translate }}
                <select
                  class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
                  name="topic"
                  [(ngModel)]="formTopic"
                  required
                >
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="contact">{{ 'contact.form.topicContact' | translate }}</option>
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="support">{{ 'contact.form.topicSupport' | translate }}</option>
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="refund">{{ 'contact.form.topicRefund' | translate }}</option>
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="dispute">{{ 'contact.form.topicDispute' | translate }}</option>
                </select>
              </label>

              <div class="grid gap-4 sm:grid-cols-2">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'contact.form.nameLabel' | translate }}
                  <input
                    class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                    name="name"
                    [(ngModel)]="formName"
                    required
                    minlength="1"
                    maxlength="255"
                    autocomplete="name"
                  />
                </label>

                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'contact.form.emailLabel' | translate }}
                  <input
                    class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                    name="email"
                    [(ngModel)]="formEmail"
                    required
                    maxlength="255"
                    autocomplete="email"
                    type="email"
                  />
                </label>
              </div>

              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'contact.form.orderLabel' | translate }}
                <input
                  class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                  name="order_reference"
                  [(ngModel)]="formOrderRef"
                  maxlength="50"
                  [placeholder]="'contact.form.orderPlaceholder' | translate"
                />
              </label>

              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'contact.form.messageLabel' | translate }}
                <textarea
                  class="min-h-[140px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                  name="message"
                  [(ngModel)]="formMessage"
                  required
                  minlength="1"
                  maxlength="10000"
                  [placeholder]="'contact.form.messagePlaceholder' | translate"
                ></textarea>
              </label>

              <app-captcha-turnstile
                #contactCaptcha
                *ngIf="captchaEnabled"
                [siteKey]="captchaSiteKey"
                (tokenChange)="captchaToken = $event"
              ></app-captcha-turnstile>

              <div class="flex items-center justify-end gap-3">
                <button
                  type="submit"
                  class="h-11 px-5 rounded-xl bg-slate-900 text-white font-semibold shadow-sm hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                  [disabled]="submitting() || !contactForm.form.valid || (captchaEnabled && !captchaToken)"
                >
                  {{ submitting() ? ('contact.form.sending' | translate) : ('contact.form.submit' | translate) }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </app-card>
    </app-container>
  `
})
export class ContactComponent implements OnInit, OnDestroy {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.contact' }
  ];

  block = signal<ContentBlock | null>(null);
  loading = signal<boolean>(true);
  hasError = signal<boolean>(false);
  bodyHtml = signal<string>('');
  pageBlocks = signal<PageBlock[]>([]);

  phone = signal<string>('+40723204204');
  email = signal<string>('momentstudio.ro@gmail.com');
  instagramPages = signal<SiteSocialLink[]>([]);
  facebookPages = signal<SiteSocialLink[]>([]);

  submitting = signal<boolean>(false);
  submitSuccess = signal<boolean>(false);
  submitError = signal<string>('');

  formTopic: ContactSubmissionTopic = 'contact';
  formName = '';
  formEmail = '';
  formOrderRef = '';
  formMessage = '';

  captchaSiteKey = appConfig.captchaSiteKey || '';
  captchaEnabled = Boolean(this.captchaSiteKey);
  captchaToken: string | null = null;

  @ViewChild('contactCaptcha') contactCaptcha?: CaptchaTurnstileComponent;

  private langSub?: Subscription;
  private socialSub?: Subscription;
  private querySub?: Subscription;
  private previewToken = '';

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
    private router: Router,
    private storefrontAdminMode: StorefrontAdminModeService,
    private translate: TranslateService,
    private title: Title,
    private meta: Meta,
    private seoHeadLinks: SeoHeadLinksService,
    private markdown: MarkdownService,
    private social: SiteSocialService,
    private auth: AuthService,
    private support: SupportService
  ) {}

  ngOnInit(): void {
    this.querySub = this.route.queryParams.subscribe((query) => {
      this.previewToken = typeof query['preview'] === 'string' ? query['preview'] : '';
      this.load();
    });
    this.langSub = this.translate.onLangChange.subscribe(() => this.load());
    this.socialSub = this.social.get().subscribe((data) => {
      if (data.contact.phone) this.phone.set(data.contact.phone);
      if (data.contact.email) this.email.set(data.contact.email);
      this.instagramPages.set(data.instagramPages);
      this.facebookPages.set(data.facebookPages);
    });
    const current = this.auth.user();
    if (current) {
      this.formEmail = (current.email || '').trim();
      this.formName = (current.name || '').trim() || this.formEmail;
    }
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
    this.socialSub?.unsubscribe();
    this.querySub?.unsubscribe();
  }

  private load(): void {
    this.loading.set(true);
    this.hasError.set(false);
    this.pageBlocks.set([]);
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    const req = (this.previewToken || '').trim()
      ? this.api.get<ContentBlock>('/content/pages/contact/preview', { token: this.previewToken, lang })
      : this.api.get<ContentBlock>('/content/pages/contact', { lang });
    req.subscribe({
      next: (block) => {
        this.block.set(block);
        this.bodyHtml.set(this.markdown.render(block.body_markdown));
        this.pageBlocks.set(parsePageBlocks(block.meta, lang, (md) => this.markdown.render(md)));
        this.loading.set(false);
        this.hasError.set(false);
        const metaBody = this.pageBlocks().length ? pageBlocksToPlainText(this.pageBlocks()) : block.body_markdown;
        this.setMetaTags(block.title, metaBody);
      },
      error: () => {
        this.block.set(null);
        const fallbackBody = `${this.translate.instant('contact.intro')}\n\n${this.translate.instant('contact.replyTime')}`;
        this.bodyHtml.set(this.markdown.render(fallbackBody));
        this.pageBlocks.set([]);
        this.loading.set(false);
        this.hasError.set(true);
        this.setMetaTags(this.translate.instant('contact.metaTitle'), this.translate.instant('contact.metaDescription'));
      }
    });
  }

  private setMetaTags(title: string, body: string): void {
    const baseTitle = (title || '').includes('|') ? title : `${title} | momentstudio`;
    const pageTitle = title ? baseTitle : this.translate.instant('contact.metaTitle');
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    const description = resolveRouteSeoDescription(
      'contact',
      lang,
      (body || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      this.translate.instant('meta.descriptions.contact'),
      this.translate.instant('contact.metaDescription')
    );
    const canonical = this.seoHeadLinks.setLocalizedCanonical('/contact', lang, {});
    this.title.setTitle(pageTitle);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:title', content: pageTitle });
    this.meta.updateTag({ property: 'og:url', content: canonical });
  }

  initialsForLabel(label: string): string {
    const cleaned = (label || '').trim();
    if (!cleaned) return 'MS';
    const parts = cleaned.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? cleaned[0] ?? 'M';
    const second = parts[1]?.[0] ?? parts[0]?.[1] ?? 'S';
    return `${first}${second}`.toUpperCase();
  }

  focalPosition(focalX?: number, focalY?: number): string {
    const x = Math.max(0, Math.min(100, Math.round(Number(focalX ?? 50))));
    const y = Math.max(0, Math.min(100, Math.round(Number(focalY ?? 50))));
    return `${x}% ${y}%`;
  }

  canEditPage(): boolean {
    return this.storefrontAdminMode.enabled();
  }

  editPage(): void {
    void this.router.navigate(['/admin/content/pages'], { queryParams: { edit: 'contact' } });
  }

  submit(): void {
    if (this.submitting()) return;
    this.submitError.set('');
    this.submitSuccess.set(false);

    if (this.captchaEnabled && !this.captchaToken) {
      this.submitError.set(this.translate.instant('auth.captchaRequired'));
      return;
    }

    const payload = {
      topic: this.formTopic,
      name: this.formName.trim(),
      email: this.formEmail.trim(),
      message: this.formMessage.trim(),
      order_reference: this.formOrderRef.trim() ? this.formOrderRef.trim() : null,
      captcha_token: this.captchaToken
    };
    this.submitting.set(true);
    this.support
      .submitContact(payload)
      .pipe(
        finalize(() => {
          this.submitting.set(false);
        })
      )
      .subscribe({
        next: () => {
          this.submitSuccess.set(true);
          this.formMessage = '';
          this.formOrderRef = '';
          this.captchaToken = null;
          this.contactCaptcha?.reset();
        },
        error: (err) => {
          const msg = err?.error?.detail || this.translate.instant('contact.form.error');
          this.submitError.set(msg);
          this.captchaToken = null;
          this.contactCaptcha?.reset();
        }
      });
  }
}
