import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { combineLatest, Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { CardComponent } from '../../shared/card.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MarkdownService } from '../../core/markdown.service';
import { ColumnsBreakpoint, ColumnsCount, PageBlock, pageBlockInnerClasses, pageBlockOuterClasses, pageBlocksToPlainText, parsePageBlocks } from '../../shared/page-blocks';
import { BannerBlockComponent } from '../../shared/banner-block.component';
import { CarouselBlockComponent } from '../../shared/carousel-block.component';
import { ButtonComponent } from '../../shared/button.component';

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
    BannerBlockComponent,
    CarouselBlockComponent
  ],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-4xl">
      <app-breadcrumb [crumbs]="crumbs()"></app-breadcrumb>
      <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ block()?.title || ('nav.page' | translate) }}</h1>

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
            <div class="grid gap-6">
              <ng-container *ngFor="let b of pageBlocks()">
                <div class="w-full" [ngClass]="pageBlockOuterClasses(b.layout)">
                  <div [ngClass]="pageBlockInnerClasses(b.layout)">
                    <ng-container [ngSwitch]="b.type">
                      <div *ngSwitchCase="'text'" class="grid gap-2">
                        <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                          {{ b.title }}
                        </h2>
                        <div class="markdown text-lg text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="b.body_html"></div>
                      </div>

                      <div *ngSwitchCase="'cta'" class="grid gap-3">
                        <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                          {{ b.title }}
                        </h2>
                        <div class="markdown text-lg text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="b.body_html"></div>
                        <div class="flex" *ngIf="b.cta_label && b.cta_url">
                          <app-button [label]="b.cta_label" [routerLink]="b.cta_url"></app-button>
                        </div>
                      </div>

                      <div *ngSwitchCase="'faq'" class="grid gap-3">
                        <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                          {{ b.title }}
                        </h2>
                        <div class="grid gap-2">
                          <details
                            *ngFor="let item of b.items"
                            class="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
                          >
                            <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                              {{ item.question }}
                            </summary>
                            <div
                              class="mt-2 markdown text-base text-slate-700 leading-relaxed dark:text-slate-200"
                              [innerHTML]="item.answer_html"
                            ></div>
                          </details>
                        </div>
                      </div>

                      <div *ngSwitchCase="'testimonials'" class="grid gap-3">
                        <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                          {{ b.title }}
                        </h2>
                        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          <div
                            *ngFor="let t of b.items"
                            class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                          >
                            <div class="markdown text-lg text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="t.quote_html"></div>
                            <p *ngIf="t.author || t.role" class="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-50">
                              <span *ngIf="t.author">{{ t.author }}</span>
                              <span *ngIf="t.author && t.role"> · </span>
                              <span *ngIf="t.role" class="font-normal text-slate-500 dark:text-slate-400">{{ t.role }}</span>
                            </p>
                          </div>
                        </div>
                      </div>

                      <div *ngSwitchCase="'image'" class="grid gap-2">
                        <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                          {{ b.title }}
                        </h2>
                        <a
                          *ngIf="b.link_url; else plainImage"
                          class="block"
                          [href]="b.link_url"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <img
                            [src]="b.url"
                            [alt]="b.alt || b.title || ''"
                            class="w-full rounded-2xl border border-slate-200 bg-slate-50 object-cover dark:border-slate-800 dark:bg-slate-800"
                            [style.object-position]="focalPosition(b.focal_x, b.focal_y)"
                            loading="lazy"
                          />
                        </a>
                        <ng-template #plainImage>
                          <img
                            [src]="b.url"
                            [alt]="b.alt || b.title || ''"
                            class="w-full rounded-2xl border border-slate-200 bg-slate-50 object-cover dark:border-slate-800 dark:bg-slate-800"
                            [style.object-position]="focalPosition(b.focal_x, b.focal_y)"
                            loading="lazy"
                          />
                        </ng-template>
                        <p *ngIf="b.caption" class="text-sm text-slate-600 dark:text-slate-300">{{ b.caption }}</p>
                      </div>

                      <div *ngSwitchCase="'gallery'" class="grid gap-2">
                        <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                          {{ b.title }}
                        </h2>
                        <div class="grid gap-3 sm:grid-cols-2">
                          <div *ngFor="let img of b.images" class="grid gap-2">
                            <img
                              [src]="img.url"
                              [alt]="img.alt || b.title || ''"
                              class="w-full rounded-2xl border border-slate-200 bg-slate-50 object-cover dark:border-slate-800 dark:bg-slate-800"
                              [style.object-position]="focalPosition(img.focal_x, img.focal_y)"
                              loading="lazy"
                            />
                            <p *ngIf="img.caption" class="text-sm text-slate-600 dark:text-slate-300">{{ img.caption }}</p>
                          </div>
                        </div>
                      </div>

                      <div *ngSwitchCase="'banner'" class="grid gap-2">
                        <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                          {{ b.title }}
                        </h2>
                        <app-banner-block [slide]="b.slide"></app-banner-block>
                      </div>

                      <div *ngSwitchCase="'carousel'" class="grid gap-2">
                        <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                          {{ b.title }}
                        </h2>
                        <app-carousel-block [slides]="b.slides" [settings]="b.settings"></app-carousel-block>
                      </div>

                      <div *ngSwitchCase="'columns'" class="grid gap-2">
                        <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                          {{ b.title }}
                        </h2>
                        <div [ngClass]="columnsGridClasses(b)">
                          <div *ngFor="let col of b.columns" class="grid gap-2">
                            <h3 *ngIf="col.title" class="text-lg font-semibold text-slate-900 dark:text-slate-50">
                              {{ col.title }}
                            </h3>
                            <div class="markdown text-lg text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="col.body_html"></div>
                          </div>
                        </div>
                      </div>
                    </ng-container>
                  </div>
                </div>
              </ng-container>
            </div>
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
          </ng-template>
        </div>
      </app-card>
    </app-container>
  `
})
export class CmsPageComponent implements OnInit, OnDestroy {
  block = signal<ContentBlock | null>(null);
  loading = signal<boolean>(true);
  hasError = signal<boolean>(false);
  requiresLogin = signal<boolean>(false);
  bodyHtml = signal<string>('');
  pageBlocks = signal<PageBlock[]>([]);
  pageBlockOuterClasses = pageBlockOuterClasses;
  pageBlockInnerClasses = pageBlockInnerClasses;
  crumbs = signal<{ label: string; url?: string }[]>([
    { label: 'nav.home', url: '/' },
    { label: 'nav.page' }
  ]);

  private langSub?: Subscription;
  private slugSub?: Subscription;
  private slug = '';
  private previewToken = '';
  private suppressNextLoad = false;

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
    private router: Router,
    private translate: TranslateService,
    private title: Title,
    private meta: Meta,
    private markdown: MarkdownService
  ) {}

  columnsGridClasses(block: PageBlock): string {
    if (block.type !== 'columns') return '';
    const count: ColumnsCount = block.columns_count;
    const breakpoint: ColumnsBreakpoint = block.breakpoint;
    const matrix: Record<ColumnsCount, Record<ColumnsBreakpoint, string>> = {
      2: { sm: 'sm:grid-cols-2', md: 'md:grid-cols-2', lg: 'lg:grid-cols-2' },
      3: { sm: 'sm:grid-cols-3', md: 'md:grid-cols-3', lg: 'lg:grid-cols-3' }
    };
    return ['grid', 'gap-6', 'grid-cols-1', matrix[count][breakpoint]].join(' ');
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
      return;
    }

    this.loading.set(true);
    this.hasError.set(false);
    this.requiresLogin.set(false);
    this.pageBlocks.set([]);
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    const req = this.previewToken
      ? this.api.get<ContentBlock>(`/content/pages/${encodeURIComponent(slug)}/preview`, { token: this.previewToken, lang })
      : this.api.get<ContentBlock>(`/content/pages/${encodeURIComponent(slug)}`, { lang });
    req.subscribe({
      next: (block) => {
        const canonicalSlug = this.slugFromKey(block.key);
        this.block.set(block);
        this.bodyHtml.set(this.markdown.render(block.body_markdown));
        this.pageBlocks.set(parsePageBlocks(block.meta, lang, (md) => this.markdown.render(md)));
        this.loading.set(false);
        this.hasError.set(false);
        if (canonicalSlug && canonicalSlug !== slug) {
          this.suppressNextLoad = true;
          void this.router.navigate(['/pages', canonicalSlug], { replaceUrl: true, queryParamsHandling: 'preserve' });
        }
        const metaBody = this.pageBlocks().length ? pageBlocksToPlainText(this.pageBlocks()) : block.body_markdown;
        this.crumbs.set([
          { label: 'nav.home', url: '/' },
          { label: block.title || slug }
        ]);
        this.setMetaTags(block.title || slug, metaBody);
      },
      error: (err) => {
        if (err?.status === 401) {
          this.block.set(null);
          this.bodyHtml.set('');
          this.pageBlocks.set([]);
          this.loading.set(false);
          this.hasError.set(false);
          this.requiresLogin.set(true);
          this.crumbs.set([
            { label: 'nav.home', url: '/' },
            { label: slug }
          ]);
          return;
        }
        this.block.set(null);
        this.bodyHtml.set('');
        this.pageBlocks.set([]);
        this.loading.set(false);
        this.hasError.set(true);
        this.requiresLogin.set(false);
        this.crumbs.set([
          { label: 'nav.home', url: '/' },
          { label: slug }
        ]);
        this.setMetaTags(slug, this.translate.instant('about.metaDescription'));
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

  private setMetaTags(title: string, body: string): void {
    const pageTitle = title ? `${title} | momentstudio` : 'Page | momentstudio';
    const description = (body || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    this.title.setTitle(pageTitle);
    if (description) {
      this.meta.updateTag({ name: 'description', content: description });
      this.meta.updateTag({ name: 'og:description', content: description });
    }
    this.meta.updateTag({ name: 'og:title', content: pageTitle });
  }
}
