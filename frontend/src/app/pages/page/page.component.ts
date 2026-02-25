import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { combineLatest, forkJoin, of, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { CardComponent } from '../../shared/card.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MarkdownService } from '../../core/markdown.service';
import { PageBlock, pageBlocksToPlainText, parsePageBlocks } from '../../shared/page-blocks';
import { ButtonComponent } from '../../shared/button.component';
import { CmsPageBlocksComponent } from '../../shared/cms-page-blocks.component';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';
import { SeoHeadLinksService } from '../../core/seo-head-links.service';
import { resolveRouteSeoDescription } from '../../core/route-seo-defaults';
import { SeoCopyFallbackService } from '../../core/seo-copy-fallback.service';

interface ContentImage {
  url: string;
  alt_text?: string | null;
  focal_x?: number;
  focal_y?: number;
}

interface ContentBlock {
  key: string;
  title: string;
  body_markdown: string;
  meta?: Record<string, unknown> | null;
  images: ContentImage[];
}

interface LegalIndexDoc {
  slug: string;
  title: string;
  lastUpdated: string | null;
}

@Component({
  selector: 'app-cms-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ContainerComponent,
    BreadcrumbComponent,
    CardComponent,
    TranslateModule,
    ButtonComponent,
    CmsPageBlocksComponent
  ],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-4xl">
      <app-breadcrumb [crumbs]="crumbs()"></app-breadcrumb>

      <div class="flex flex-wrap items-start justify-between gap-3">
        <h1
          class="text-2xl font-semibold text-slate-900 dark:text-slate-50"
          data-route-heading="true"
          tabindex="-1"
        >
          {{ block()?.title || ('nav.page' | translate) }}
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
        <div *ngIf="loading()" class="text-sm text-slate-600 dark:text-slate-300">
          {{ 'about.loading' | translate }}
        </div>

        <div *ngIf="!loading() && hasError()" class="grid gap-2">
          <p class="font-semibold text-amber-900 dark:text-amber-100">{{ 'about.errorTitle' | translate }}</p>
          <p class="text-sm text-amber-800 dark:text-amber-200">{{ 'about.errorCopy' | translate }}</p>
        </div>

        <div *ngIf="!loading() && requiresLogin()" class="grid gap-2">
          <p class="font-semibold text-amber-900 dark:text-amber-100">{{ 'page.restricted.title' | translate }}</p>
          <p class="text-sm text-amber-800 dark:text-amber-200">{{ 'page.restricted.copy' | translate }}</p>
          <div class="flex">
            <a
              [routerLink]="['/login']"
              [queryParams]="{ next: loginNextUrl() }"
              class="inline-flex items-center justify-center rounded-full font-semibold transition px-3 py-2 text-sm bg-slate-900 text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-white"
            >
              {{ 'auth.login' | translate }}
            </a>
          </div>
        </div>

	        <div *ngIf="!loading() && !hasError() && block()" class="grid gap-5">
	          <ng-container *ngIf="pageBlocks().length; else markdownContent">
	            <app-cms-page-blocks [blocks]="pageBlocks()"></app-cms-page-blocks>
	          </ng-container>

          <ng-template #markdownContent>
            <img
              *ngIf="block()!.images?.length"
              [src]="block()!.images[0].url"
              [alt]="block()!.images[0].alt_text || block()!.title"
              class="w-full rounded-2xl border border-slate-200 bg-slate-50 object-cover dark:border-slate-800 dark:bg-slate-800"
              [style.object-position]="focalPosition(block()!.images[0].focal_x, block()!.images[0].focal_y)"
              loading="lazy"
	            />
	            <div class="markdown text-lg text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="bodyHtml()"></div>
              <p
                *ngIf="!hasMeaningfulBodyContent()"
                class="text-base text-slate-700 leading-relaxed dark:text-slate-200"
              >
                {{ fallbackIntro() }}
              </p>
	          </ng-template>

	          <div *ngIf="legalIndexLoading()" class="text-sm text-slate-600 dark:text-slate-300">
	            {{ 'notifications.loading' | translate }}
	          </div>
	          <div *ngIf="!legalIndexLoading() && legalIndexDocs().length" class="grid gap-2">
	            <a
	              *ngFor="let doc of legalIndexDocs()"
	              [routerLink]="['/pages', doc.slug]"
	              class="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/30 dark:text-slate-200 dark:hover:border-slate-700 dark:hover:bg-slate-900"
	            >
	              <span class="font-medium text-slate-900 dark:text-slate-50">{{ doc.title }}</span>
	              <span class="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
	                {{ doc.lastUpdated ? formatLegalIndexDate(doc.lastUpdated) : '—' }}
	              </span>
	            </a>
	          </div>
	        </div>
	      </app-card>

      <div
        *ngIf="!loading() && !hasError() && block() && showSeoLinkCluster()"
        class="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/40"
      >
        <h2 class="text-base font-semibold text-slate-900 dark:text-slate-50">{{ 'page.exploreMore' | translate }}</h2>
        <p class="mt-2 text-sm text-slate-600 dark:text-slate-300">{{ 'page.exploreMoreCopy' | translate }}</p>
        <div class="mt-4 flex flex-wrap gap-3 text-sm">
          <a class="font-medium text-indigo-600 hover:underline dark:text-indigo-300" [routerLink]="['/shop']">
            {{ 'nav.shop' | translate }}
          </a>
          <a class="font-medium text-indigo-600 hover:underline dark:text-indigo-300" [routerLink]="['/blog']">
            {{ 'nav.blog' | translate }}
          </a>
          <a class="font-medium text-indigo-600 hover:underline dark:text-indigo-300" [routerLink]="['/contact']">
            {{ 'nav.contact' | translate }}
          </a>
        </div>
      </div>
	    </app-container>
	  `
})
export class CmsPageComponent implements OnInit, OnDestroy {
  block = signal<ContentBlock | null>(null);
  loading = signal<boolean>(true);
  hasError = signal<boolean>(false);
  requiresLogin = signal<boolean>(false);
  bodyHtml = signal<string>('');
  fallbackIntro = signal<string>('');
  pageBlocks = signal<PageBlock[]>([]);
  legalIndexDocs = signal<LegalIndexDoc[]>([]);
  legalIndexLoading = signal<boolean>(false);
  crumbs = signal<{ label: string; url?: string }[]>([
    { label: 'nav.home', url: '/' },
    { label: 'nav.page' }
  ]);

  private langSub?: Subscription;
  private slugSub?: Subscription;
  private legalIndexSub?: Subscription;
  private slug = '';
  private previewToken = '';
  private suppressNextLoad = false;

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly storefrontAdminMode: StorefrontAdminModeService,
    private readonly translate: TranslateService,
    private readonly title: Title,
    private readonly meta: Meta,
    private readonly markdown: MarkdownService,
    private readonly seoHeadLinks: SeoHeadLinksService,
    private readonly seoCopyFallback: SeoCopyFallbackService
  ) {}

  canEditPage(): boolean {
    return this.storefrontAdminMode.enabled();
  }

  editPage(): void {
    const slug = String(this.slug || '').trim();
    if (!slug) return;
    void this.router.navigate(['/admin/content/pages'], { queryParams: { edit: slug } });
  }

  ngOnInit(): void {
    this.slugSub = combineLatest([this.route.paramMap, this.route.queryParams]).subscribe(([params, query]) => {
      this.slug = params.get('slug') || '';
      this.previewToken = typeof query['preview'] === 'string' ? query['preview'] : '';
      if (this.suppressNextLoad) {
        this.suppressNextLoad = false;
        return;
      }
      this.load();
    });
    this.langSub = this.translate.onLangChange.subscribe(() => this.load());
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
    this.slugSub?.unsubscribe();
    this.legalIndexSub?.unsubscribe();
  }

  focalPosition(focalX?: number, focalY?: number): string {
    const x = Math.max(0, Math.min(100, Math.round(Number(focalX ?? 50))));
    const y = Math.max(0, Math.min(100, Math.round(Number(focalY ?? 50))));
    return `${x}% ${y}%`;
  }

  private load(): void {
    const slug = (this.slug || '').trim();
    if (!slug) {
      this.block.set(null);
      this.loading.set(false);
      this.hasError.set(true);
      this.requiresLogin.set(false);
      this.legalIndexDocs.set([]);
      this.legalIndexLoading.set(false);
      this.legalIndexSub?.unsubscribe();
      return;
    }

    this.loading.set(true);
    this.hasError.set(false);
    this.requiresLogin.set(false);
    this.fallbackIntro.set('');
    this.pageBlocks.set([]);
    this.legalIndexDocs.set([]);
    this.legalIndexLoading.set(false);
    this.legalIndexSub?.unsubscribe();
    this.legalIndexSub = undefined;
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    const req = this.previewToken
      ? this.api.get<ContentBlock>(`/content/pages/${encodeURIComponent(slug)}/preview`, { token: this.previewToken, lang })
      : this.api.get<ContentBlock>(`/content/pages/${encodeURIComponent(slug)}`, { lang });
    req.subscribe({
      next: (block) => this.handlePageLoadSuccess(block, slug, lang),
      error: (err) => this.handlePageLoadError(err, slug, lang)
    });
  }

  private handlePageLoadSuccess(block: ContentBlock, slug: string, lang: string): void {
    const canonicalSlug = this.slugFromKey(block.key);
    this.block.set(block);
    const bodyMarkdown = canonicalSlug === 'terms' ? this.stripLegalIndexTable(block.body_markdown) : block.body_markdown;
    this.bodyHtml.set(this.markdown.render(bodyMarkdown));
    this.pageBlocks.set(parsePageBlocks(block.meta, lang, (md) => this.markdown.render(md)));
    this.fallbackIntro.set(this.seoCopyFallback.pageIntro(lang, block.title || slug));
    this.loading.set(false);
    this.hasError.set(false);
    this.loadLegalIndexDocs(canonicalSlug, lang);
    if (canonicalSlug && canonicalSlug !== slug) {
      this.suppressNextLoad = true;
      void this.router.navigate(['/pages', canonicalSlug], { replaceUrl: true, queryParamsHandling: 'preserve' });
    }
    const metaBody = this.pageBlocks().length ? pageBlocksToPlainText(this.pageBlocks()) : bodyMarkdown;
    this.crumbs.set([
      { label: 'nav.home', url: '/' },
      { label: block.title || slug }
    ]);
    this.setMetaTags(block.title || slug, metaBody, canonicalSlug || slug);
  }

  private setRestrictedPageState(slug: string, lang: string): void {
    this.block.set(null);
    this.bodyHtml.set('');
    this.pageBlocks.set([]);
    this.loading.set(false);
    this.hasError.set(false);
    this.requiresLogin.set(true);
    this.fallbackIntro.set(this.seoCopyFallback.pageIntro(lang, slug));
    this.crumbs.set([
      { label: 'nav.home', url: '/' },
      { label: slug }
    ]);
  }

  private setPageErrorState(slug: string, lang: string): void {
    this.block.set(null);
    this.bodyHtml.set('');
    this.pageBlocks.set([]);
    this.loading.set(false);
    this.hasError.set(true);
    this.requiresLogin.set(false);
    this.fallbackIntro.set(this.seoCopyFallback.pageIntro(lang, slug));
    this.crumbs.set([
      { label: 'nav.home', url: '/' },
      { label: slug }
    ]);
    this.setMetaTags(slug, this.translate.instant('about.metaDescription'), slug);
  }

  private handlePageLoadError(err: any, slug: string, lang: string): void {
    if (err?.status === 401) {
      this.setRestrictedPageState(slug, lang);
      return;
    }
    this.setPageErrorState(slug, lang);
  }

  formatLegalIndexDate(value: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parts = raw.split('-').map((p) => Number(p));
    if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return raw;
    const [y, m, d] = parts;
    const dt = new Date(Date.UTC(y, m - 1, d));
    const locale = this.translate.currentLang === 'ro' ? 'ro-RO' : 'en-US';
    try {
      return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' }).format(dt);
    } catch {
      return raw;
    }
  }

  private stripLegalIndexTable(body: string): string {
    const lines = String(body || '')
      .replace(/\r\n/g, '\n')
      .split('\n');
    const out: string[] = [];
    let inTable = false;
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      if (!inTable) {
        if (trimmed.startsWith('|') && (trimmed.includes('last updated') || trimmed.includes('ultima actualizare'))) {
          inTable = true;
          continue;
        }
        out.push(line);
        continue;
      }
      if (line.trim().startsWith('|')) continue;
      inTable = false;
      out.push(line);
    }
    return out.join('\n').trim();
  }

  private loadLegalIndexDocs(slug: string, lang: string): void {
    if (slug !== 'terms') return;
    const docs = [
      { slug: 'terms-and-conditions', fallbackKey: 'nav.terms' },
      { slug: 'privacy-policy', fallbackKey: 'footer.privacyPolicy' },
      { slug: 'anpc', fallbackKey: 'footer.anpc' }
    ];

    this.legalIndexLoading.set(true);
    this.legalIndexSub?.unsubscribe();
    this.legalIndexSub = forkJoin(
      docs.map((doc) =>
        this.api
          .get<ContentBlock>(`/content/pages/${encodeURIComponent(doc.slug)}`, { lang })
          .pipe(catchError(() => of(null)))
      )
    ).subscribe({
      next: (blocks) => {
        const rows: LegalIndexDoc[] = docs.map((doc, idx) => {
          const block = (blocks?.[idx] as ContentBlock | null) || null;
          const meta = (block?.meta || {}) as Record<string, unknown>;
          const lastUpdated = typeof meta['last_updated'] === 'string' ? String(meta['last_updated']) : null;
          const title = (block?.title || '').trim() || this.translate.instant(doc.fallbackKey);
          return { slug: doc.slug, title, lastUpdated };
        });
        this.legalIndexDocs.set(rows);
        this.legalIndexLoading.set(false);
      },
      error: () => {
        this.legalIndexDocs.set([]);
        this.legalIndexLoading.set(false);
      }
    });
  }

  loginNextUrl(): string {
    return typeof window === 'undefined' ? `/pages/${this.slug}` : this.router.url;
  }

  private slugFromKey(key: string): string {
    const raw = (key || '').trim();
    return raw.startsWith('page.') ? raw.slice('page.'.length) : '';
  }

  private setMetaTags(title: string, body: string, slug: string): void {
    const pageTitle = title ? `${title} | momentstudio` : 'Page | momentstudio';
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    const description = resolveRouteSeoDescription(
      'page',
      lang,
      (body || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      this.translate.instant('meta.descriptions.page'),
      this.translate.instant('about.metaDescription')
    );
    const safeSlug = encodeURIComponent(String(slug || '').trim());
    const path = safeSlug ? `/pages/${safeSlug}` : '/pages';
    const canonical = this.seoHeadLinks.setLocalizedCanonical(path, lang, {});
    this.title.setTitle(pageTitle);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:title', content: pageTitle });
    this.meta.updateTag({ property: 'og:url', content: canonical });
  }

  hasMeaningfulBodyContent(): boolean {
    const text = String(this.bodyHtml() || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length >= 80;
  }

  showSeoLinkCluster(): boolean {
    if (this.requiresLogin()) return false;
    return !this.legalIndexDocs().length;
  }
}
