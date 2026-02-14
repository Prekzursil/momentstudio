import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { ButtonComponent } from '../../shared/button.component';
import { CardComponent } from '../../shared/card.component';
import { CatalogService, Product, FeaturedCollection } from '../../core/catalog.service';
import { RecentlyViewedService } from '../../core/recently-viewed.service';
import { ProductCardComponent } from '../../shared/product-card.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Meta, Title } from '@angular/platform-browser';
import { AuthService } from '../../core/auth.service';
import { ApiService } from '../../core/api.service';
import { MarkdownService } from '../../core/markdown.service';
import { BannerBlockComponent } from '../../shared/banner-block.component';
import { CarouselBlockComponent } from '../../shared/carousel-block.component';
import { CarouselSettings, ColumnsBreakpoint, ColumnsCount, Slide } from '../../shared/page-blocks';
import { SeoHeadLinksService } from '../../core/seo-head-links.service';
import { StructuredDataService } from '../../core/structured-data.service';

type HomeSectionId =
  | 'featured_products'
  | 'sale_products'
  | 'new_arrivals'
  | 'featured_collections'
  | 'story'
  | 'recently_viewed'
  | 'why';

type HomeBlockType = HomeSectionId | 'text' | 'columns' | 'cta' | 'faq' | 'testimonials' | 'image' | 'gallery' | 'banner' | 'carousel';

interface HomeBlockBase {
  key: string;
  type: HomeBlockType;
  enabled: boolean;
}

interface HomeTextBlock extends HomeBlockBase {
  type: 'text';
  title?: string | null;
  body_html: string;
}

interface HomeImageBlock extends HomeBlockBase {
  type: 'image';
  title?: string | null;
  url: string;
  alt?: string | null;
  caption?: string | null;
  link_url?: string | null;
  focal_x: number;
  focal_y: number;
}

interface HomeGalleryImage {
  url: string;
  alt?: string | null;
  caption?: string | null;
  focal_x: number;
  focal_y: number;
}

interface HomeGalleryBlock extends HomeBlockBase {
  type: 'gallery';
  title?: string | null;
  images: HomeGalleryImage[];
}

interface HomeBannerBlock extends HomeBlockBase {
  type: 'banner';
  title?: string | null;
  slide: Slide;
}

interface HomeCarouselBlock extends HomeBlockBase {
  type: 'carousel';
  title?: string | null;
  slides: Slide[];
  settings: CarouselSettings;
}

interface HomeCtaBlock extends HomeBlockBase {
  type: 'cta';
  title?: string | null;
  body_html: string;
  cta_label?: string | null;
  cta_url?: string | null;
  cta_new_tab?: boolean;
}

interface HomeFaqItem {
  question: string;
  answer_html: string;
}

interface HomeFaqBlock extends HomeBlockBase {
  type: 'faq';
  title?: string | null;
  items: HomeFaqItem[];
}

interface HomeTestimonialItem {
  quote_html: string;
  author?: string | null;
  role?: string | null;
}

interface HomeTestimonialsBlock extends HomeBlockBase {
  type: 'testimonials';
  title?: string | null;
  items: HomeTestimonialItem[];
}

interface HomeColumnsColumn {
  title?: string | null;
  body_html: string;
}

interface HomeColumnsBlock extends HomeBlockBase {
  type: 'columns';
  title?: string | null;
  columns: HomeColumnsColumn[];
  columns_count: ColumnsCount;
  breakpoint: ColumnsBreakpoint;
}

type HomeBlock =
  | HomeBlockBase
  | HomeTextBlock
  | HomeImageBlock
  | HomeGalleryBlock
  | HomeBannerBlock
  | HomeCarouselBlock
  | HomeColumnsBlock
  | HomeCtaBlock
  | HomeFaqBlock
  | HomeTestimonialsBlock;

interface ContentImage {
  url: string;
  alt_text?: string | null;
}

interface ContentBlockRead {
  title: string;
  body_markdown: string;
  meta?: Record<string, unknown> | null;
  images: ContentImage[];
}

interface HomePreviewResponse {
  sections: ContentBlockRead;
  story?: ContentBlockRead | null;
}

const DEFAULT_BLOCKS: HomeBlock[] = [
  { key: 'featured_products', type: 'featured_products', enabled: true },
  { key: 'sale_products', type: 'sale_products', enabled: false },
  { key: 'new_arrivals', type: 'new_arrivals', enabled: true },
  { key: 'featured_collections', type: 'featured_collections', enabled: true },
  { key: 'story', type: 'story', enabled: true },
  { key: 'recently_viewed', type: 'recently_viewed', enabled: true },
  { key: 'why', type: 'why', enabled: true }
];

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    ButtonComponent,
    CardComponent,
    ProductCardComponent,
    SkeletonComponent,
    TranslateModule,
    BannerBlockComponent,
    CarouselBlockComponent
  ],
  template: `
    <section class="grid gap-10">
      <ng-container *ngFor="let block of enabledBlocks()">
        <ng-container [ngSwitch]="block.type">
          <ng-container *ngSwitchCase="'banner'">
            <ng-container *ngIf="asBannerBlock(block) as banner">
              <app-banner-block
                [slide]="banner.slide"
                [tagline]="banner.key === firstHeroLikeKey() ? ('app.tagline' | translate) : null"
              ></app-banner-block>
            </ng-container>
          </ng-container>

          <ng-container *ngSwitchCase="'carousel'">
            <ng-container *ngIf="asCarouselBlock(block) as carousel">
              <app-carousel-block
                [slides]="carousel.slides"
                [settings]="carousel.settings"
                [tagline]="carousel.key === firstHeroLikeKey() ? ('app.tagline' | translate) : null"
              ></app-carousel-block>
            </ng-container>
          </ng-container>

          <ng-container *ngSwitchCase="'featured_products'">
            <div class="grid gap-4">
              <div class="flex items-center justify-between">
                <h2 class="text-xl font-semibold text-slate-900 dark:text-slate-50">{{ 'home.featured' | translate }}</h2>
                <app-button [label]="'home.viewAll' | translate" variant="ghost" [routerLink]="['/shop']"></app-button>
              </div>

              <div *ngIf="featuredLoading()" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <app-skeleton *ngFor="let i of skeletons" height="260px"></app-skeleton>
              </div>

              <div
                *ngIf="featuredError()"
                class="border border-amber-200 bg-amber-50 rounded-2xl p-4 flex items-center justify-between dark:border-amber-900/40 dark:bg-amber-950/30"
              >
                <div>
                  <p class="font-semibold text-amber-900 dark:text-amber-100">{{ 'home.featuredError.title' | translate }}</p>
                  <p class="text-sm text-amber-800 dark:text-amber-200">{{ 'home.featuredError.copy' | translate }}</p>
                </div>
                <app-button [label]="'shop.retry' | translate" size="sm" (action)="loadFeatured()"></app-button>
              </div>

              <div *ngIf="!featuredLoading() && !featuredError() && featured.length" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <app-product-card *ngFor="let product of featured" [product]="product"></app-product-card>
              </div>

              <div *ngIf="!featuredLoading() && !featuredError() && !featured.length" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'home.noFeatured' | translate }}
              </div>
            </div>
          </ng-container>

          <ng-container *ngSwitchCase="'sale_products'">
            <div class="grid gap-4">
              <div class="flex items-center justify-between">
                <h2 class="text-xl font-semibold text-slate-900 dark:text-slate-50">{{ 'home.saleProducts' | translate }}</h2>
	                <app-button
	                  [label]="'home.viewAll' | translate"
	                  variant="ghost"
	                  [routerLink]="['/shop']"
	                  [queryParams]="{ on_sale: 1 }"
	                ></app-button>
              </div>

              <div *ngIf="saleLoading()" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <app-skeleton *ngFor="let i of skeletons" height="260px"></app-skeleton>
              </div>

              <div
                *ngIf="saleError()"
                class="border border-amber-200 bg-amber-50 rounded-2xl p-4 flex items-center justify-between dark:border-amber-900/40 dark:bg-amber-950/30"
              >
                <div>
                  <p class="font-semibold text-amber-900 dark:text-amber-100">{{ 'home.saleError.title' | translate }}</p>
                  <p class="text-sm text-amber-800 dark:text-amber-200">{{ 'home.saleError.copy' | translate }}</p>
                </div>
                <app-button [label]="'shop.retry' | translate" size="sm" (action)="loadSaleProducts()"></app-button>
              </div>

              <div
                *ngIf="!saleLoading() && !saleError() && saleProducts.length"
                class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"
              >
                <app-product-card *ngFor="let product of saleProducts" [product]="product"></app-product-card>
              </div>

              <div *ngIf="!saleLoading() && !saleError() && !saleProducts.length" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'home.saleEmpty' | translate }}
              </div>
            </div>
          </ng-container>

          <ng-container *ngSwitchCase="'new_arrivals'">
            <div class="grid gap-4">
              <div class="flex items-center justify-between">
                <h2 class="text-xl font-semibold text-slate-900 dark:text-slate-50">{{ 'home.newArrivals' | translate }}</h2>
                <app-button [label]="'home.viewAll' | translate" variant="ghost" [routerLink]="['/shop']"></app-button>
              </div>

              <div *ngIf="newArrivalsLoading()" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <app-skeleton *ngFor="let i of skeletons" height="260px"></app-skeleton>
              </div>

              <div
                *ngIf="newArrivalsError()"
                class="border border-amber-200 bg-amber-50 rounded-2xl p-4 flex items-center justify-between dark:border-amber-900/40 dark:bg-amber-950/30"
              >
                <div>
                  <p class="font-semibold text-amber-900 dark:text-amber-100">{{ 'home.newArrivalsError.title' | translate }}</p>
                  <p class="text-sm text-amber-800 dark:text-amber-200">{{ 'home.newArrivalsError.copy' | translate }}</p>
                </div>
                <app-button [label]="'shop.retry' | translate" size="sm" (action)="loadNewArrivals()"></app-button>
              </div>

              <div
                *ngIf="!newArrivalsLoading() && !newArrivalsError() && newArrivals.length"
                class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"
              >
                <app-product-card *ngFor="let product of newArrivals" [product]="product"></app-product-card>
              </div>

              <div *ngIf="!newArrivalsLoading() && !newArrivalsError() && !newArrivals.length" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'home.newArrivalsEmpty' | translate }}
              </div>
            </div>
          </ng-container>

          <ng-container *ngSwitchCase="'featured_collections'">
            <div class="grid gap-4">
              <h2 class="text-xl font-semibold text-slate-900 dark:text-slate-50">{{ 'home.collections' | translate }}</h2>

              <div *ngIf="collectionsLoading()" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <app-skeleton *ngFor="let i of skeletons" height="220px"></app-skeleton>
              </div>

              <div
                *ngIf="collectionsError()"
                class="border border-amber-200 bg-amber-50 rounded-2xl p-4 flex items-center justify-between dark:border-amber-900/40 dark:bg-amber-950/30"
              >
                <div>
                  <p class="font-semibold text-amber-900 dark:text-amber-100">{{ 'home.collectionsError.title' | translate }}</p>
                  <p class="text-sm text-amber-800 dark:text-amber-200">{{ 'home.collectionsError.copy' | translate }}</p>
                </div>
                <app-button [label]="'shop.retry' | translate" size="sm" (action)="loadCollections()"></app-button>
              </div>

              <div *ngIf="!collectionsLoading() && !collectionsError() && featuredCollections.length" class="grid gap-8">
                <div *ngFor="let col of featuredCollections" class="grid gap-3">
                  <div class="grid gap-1">
                    <h3 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ col.name }}</h3>
                    <p *ngIf="col.description" class="text-sm text-slate-600 dark:text-slate-300">{{ col.description }}</p>
                  </div>
                  <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <app-product-card *ngFor="let product of col.products.slice(0, 6)" [product]="product"></app-product-card>
                  </div>
                </div>
              </div>

              <div *ngIf="!collectionsLoading() && !collectionsError() && !featuredCollections.length" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'home.collectionsEmpty' | translate }}
              </div>
            </div>
          </ng-container>

          <ng-container *ngSwitchCase="'story'">
            <div class="grid gap-4" *ngIf="!storyLoading() && storyBlock()">
              <h2 class="text-xl font-semibold text-slate-900 dark:text-slate-50">{{ storyBlock()!.title }}</h2>
              <app-card>
                <div class="markdown text-lg text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="storyHtml()"></div>
                <div class="mt-4">
                  <app-button [label]="'nav.about' | translate" variant="ghost" [routerLink]="['/about']"></app-button>
                </div>
              </app-card>
            </div>
          </ng-container>

          <ng-container *ngSwitchCase="'text'">
            <ng-container *ngIf="asTextBlock(block) as tb">
              <div class="grid gap-4">
                <h2 *ngIf="tb.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">{{ tb.title }}</h2>
                <app-card>
                  <div class="markdown text-lg text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="tb.body_html"></div>
                </app-card>
              </div>
            </ng-container>
          </ng-container>

          <ng-container *ngSwitchCase="'image'">
            <ng-container *ngIf="asImageBlock(block) as img">
              <div class="grid gap-4">
                <h2 *ngIf="img.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">{{ img.title }}</h2>
                <app-card>
                  <a *ngIf="img.link_url; else imageOnly" [href]="img.link_url" class="block" target="_blank" rel="noopener noreferrer">
                    <img
                      class="w-full rounded-2xl object-cover"
                      [src]="img.url"
                      [alt]="img.alt || img.title || ''"
                      [style.object-position]="focalPosition(img.focal_x, img.focal_y)"
                      loading="lazy"
                    />
                  </a>
                  <ng-template #imageOnly>
                    <img
                      class="w-full rounded-2xl object-cover"
                      [src]="img.url"
                      [alt]="img.alt || img.title || ''"
                      [style.object-position]="focalPosition(img.focal_x, img.focal_y)"
                      loading="lazy"
                    />
                  </ng-template>
                  <p *ngIf="img.caption" class="mt-3 text-sm text-slate-600 dark:text-slate-300">{{ img.caption }}</p>
                </app-card>
              </div>
            </ng-container>
          </ng-container>

          <ng-container *ngSwitchCase="'gallery'">
            <ng-container *ngIf="asGalleryBlock(block) as gal">
              <div class="grid gap-4">
                <h2 *ngIf="gal.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">{{ gal.title }}</h2>
                <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <app-card *ngFor="let image of gal.images">
                    <img
                      class="w-full rounded-2xl object-cover"
                      [src]="image.url"
                      [alt]="image.alt || gal.title || ''"
                      [style.object-position]="focalPosition(image.focal_x, image.focal_y)"
                      loading="lazy"
                    />
                    <p *ngIf="image.caption" class="mt-2 text-sm text-slate-600 dark:text-slate-300">{{ image.caption }}</p>
                  </app-card>
                </div>
              </div>
            </ng-container>
          </ng-container>

          <ng-container *ngSwitchCase="'columns'">
            <ng-container *ngIf="asColumnsBlock(block) as cols">
              <div class="grid gap-4">
                <h2 *ngIf="cols.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">{{ cols.title }}</h2>
                <app-card>
                  <div [ngClass]="columnsGridClasses(cols)">
                    <div *ngFor="let col of cols.columns" class="grid gap-2">
                      <h3 *ngIf="col.title" class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ col.title }}</h3>
                      <div class="markdown text-lg text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="col.body_html"></div>
                    </div>
                  </div>
                </app-card>
              </div>
            </ng-container>
          </ng-container>

          <ng-container *ngSwitchCase="'cta'">
            <ng-container *ngIf="asCtaBlock(block) as cta">
              <div class="grid gap-4">
                <h2 *ngIf="cta.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">{{ cta.title }}</h2>
                <app-card>
                  <div class="markdown text-lg text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="cta.body_html"></div>
                  <div class="mt-4 flex" *ngIf="cta.cta_label && cta.cta_url">
                    <ng-container *ngIf="isExternalHttpUrl(cta.cta_url); else internalCta">
                      <app-button
                        [label]="cta.cta_label"
                        [href]="cta.cta_url"
                        [target]="cta.cta_new_tab ? '_blank' : null"
                        [rel]="cta.cta_new_tab ? 'noopener noreferrer' : null"
                      ></app-button>
                    </ng-container>
                    <ng-template #internalCta>
                      <app-button [label]="cta.cta_label" [routerLink]="cta.cta_url"></app-button>
                    </ng-template>
                  </div>
                </app-card>
              </div>
            </ng-container>
          </ng-container>

          <ng-container *ngSwitchCase="'faq'">
            <ng-container *ngIf="asFaqBlock(block) as faq">
              <div class="grid gap-4">
                <h2 *ngIf="faq.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">{{ faq.title }}</h2>
                <app-card>
                  <div class="grid gap-2">
                    <details
                      *ngFor="let item of faq.items"
                      class="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
                    >
                      <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                        {{ item.question }}
                      </summary>
                      <div class="mt-2 markdown text-base text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="item.answer_html"></div>
                    </details>
                  </div>
                </app-card>
              </div>
            </ng-container>
          </ng-container>

          <ng-container *ngSwitchCase="'testimonials'">
            <ng-container *ngIf="asTestimonialsBlock(block) as ts">
              <div class="grid gap-4">
                <h2 *ngIf="ts.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">{{ ts.title }}</h2>
                <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <app-card *ngFor="let t of ts.items">
                    <div class="markdown text-lg text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="t.quote_html"></div>
                    <p *ngIf="t.author || t.role" class="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-50">
                      <span *ngIf="t.author">{{ t.author }}</span>
                      <span *ngIf="t.author && t.role"> · </span>
                      <span *ngIf="t.role" class="font-normal text-slate-500 dark:text-slate-400">{{ t.role }}</span>
                    </p>
                  </app-card>
                </div>
              </div>
            </ng-container>
          </ng-container>

          <ng-container *ngSwitchCase="'recently_viewed'">
            <div *ngIf="recentlyViewed.length" class="grid gap-4">
              <div class="flex items-center justify-between">
                <h2 class="text-xl font-semibold text-slate-900 dark:text-slate-50">{{ 'product.recentlyViewed' | translate }}</h2>
                <app-button [label]="'home.viewAll' | translate" variant="ghost" [routerLink]="['/shop']"></app-button>
              </div>
              <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <app-product-card *ngFor="let product of recentlyViewed" [product]="product"></app-product-card>
              </div>
            </div>
          </ng-container>

          <ng-container *ngSwitchCase="'why'">
            <div class="grid gap-4">
              <h2 class="text-xl font-semibold text-slate-900 dark:text-slate-50">{{ 'home.why' | translate }}</h2>
              <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <app-card [title]="'home.cards.strictTitle' | translate">
                  <p>{{ 'home.cards.strict' | translate }}</p>
                </app-card>
                <app-card [title]="'home.cards.tokensTitle' | translate">
                  <p>{{ 'home.cards.tokens' | translate }}</p>
                </app-card>
                <app-card [title]="'home.cards.primitivesTitle' | translate">
                  <p>{{ 'home.cards.primitives' | translate }}</p>
                </app-card>
                <app-card [title]="'home.cards.shellTitle' | translate">
                  <p>{{ 'home.cards.shell' | translate }}</p>
                </app-card>
              </div>
            </div>
          </ng-container>
        </ng-container>
      </ng-container>
    </section>
  `
})
export class HomeComponent implements OnInit, OnDestroy {
  blocks = signal<HomeBlock[]>(DEFAULT_BLOCKS);

  featured: Product[] = [];
  featuredLoading = signal<boolean>(true);
  featuredError = signal<boolean>(false);

  saleProducts: Product[] = [];
  saleLoading = signal<boolean>(true);
  saleError = signal<boolean>(false);

  newArrivals: Product[] = [];
  newArrivalsLoading = signal<boolean>(true);
  newArrivalsError = signal<boolean>(false);

  featuredCollections: FeaturedCollection[] = [];
  collectionsLoading = signal<boolean>(true);
  collectionsError = signal<boolean>(false);

  storyBlock = signal<ContentBlockRead | null>(null);
  storyHtml = signal<string>('');
  storyLoading = signal<boolean>(true);

  recentlyViewed: Product[] = [];

  skeletons = Array.from({ length: 3 });
  readonly isAdmin = computed(() => this.auth.isAdmin());
  readonly enabledBlocks = computed(() => this.blocks().filter((b) => b.enabled));
  readonly firstHeroLikeKey = computed(() => {
    const first = this.enabledBlocks().find((b) => b.type === 'banner' || b.type === 'carousel');
    return first?.key ?? null;
  });

  private langSub?: Subscription;
  private routeSub?: Subscription;
  private previewToken = '';

  constructor(
    private catalog: CatalogService,
    private recentlyViewedService: RecentlyViewedService,
    private title: Title,
    private meta: Meta,
    private seoHeadLinks: SeoHeadLinksService,
    private structuredData: StructuredDataService,
    private translate: TranslateService,
    private auth: AuthService,
    private route: ActivatedRoute,
    private api: ApiService,
    private markdown: MarkdownService
  ) {}

  ngOnInit(): void {
    this.routeSub = this.route.queryParams.subscribe((query) => {
      this.previewToken = typeof query['preview'] === 'string' ? query['preview'] : '';
      this.load();
    });
    this.langSub = this.translate.onLangChange.subscribe(() => this.load());
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
    this.routeSub?.unsubscribe();
    this.structuredData.clearRouteSchemas();
  }

  focalPosition(focalX?: number, focalY?: number): string {
    const x = Math.max(0, Math.min(100, Math.round(Number(focalX ?? 50))));
    const y = Math.max(0, Math.min(100, Math.round(Number(focalY ?? 50))));
    return `${x}% ${y}%`;
  }

  private load(): void {
    this.setMetaTags();
    this.recentlyViewed = this.recentlyViewedService.list().slice(0, 6);
    this.storyBlock.set(null);
    this.storyHtml.set('');
    this.storyLoading.set(true);
    this.loadLayout();
  }

  private loadLayout(): void {
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    if (this.previewToken) {
      this.api.get<HomePreviewResponse>('/content/home/preview', { token: this.previewToken, lang }).subscribe({
        next: (resp) => {
          this.blocks.set(this.parseBlocks(resp?.sections?.meta, lang));
          const story = resp?.story ?? null;
          this.storyBlock.set(story);
          this.storyHtml.set(story ? this.markdown.render(story.body_markdown || '') : '');
          this.storyLoading.set(false);
          this.loadSectionData({ skipStory: true });
        },
        error: () => {
          this.blocks.set(DEFAULT_BLOCKS);
          this.storyBlock.set(null);
          this.storyHtml.set('');
          this.storyLoading.set(false);
          this.loadSectionData({ skipStory: true });
        }
      });
      return;
    }

    this.api.get<ContentBlockRead>('/content/home.sections').subscribe({
      next: (block) => {
        this.blocks.set(this.parseBlocks(block.meta, lang));
        this.loadSectionData();
      },
      error: () => {
        this.blocks.set(DEFAULT_BLOCKS);
        this.loadSectionData();
      }
    });
  }

  private parseBlocks(meta: ContentBlockRead['meta'], lang: 'en' | 'ro'): HomeBlock[] {
    const configured: HomeBlock[] = [];
    const seenKeys = new Set<string>();

    const ensureUniqueKey = (raw: unknown, fallback: string): string | null => {
      const key = (typeof raw === 'string' ? raw.trim() : '') || fallback;
      if (!key) return null;
      if (seenKeys.has(key)) return null;
      seenKeys.add(key);
      return key;
    };

    const readLocalized = (value: unknown): string | null => {
      if (typeof value === 'string') return value.trim() || null;
      if (!value || typeof value !== 'object') return null;
      const record = value as Record<string, unknown>;
      const preferred = typeof record[lang] === 'string' ? String(record[lang]).trim() : '';
      if (preferred) return preferred;
      const otherLang = lang === 'ro' ? 'en' : 'ro';
      const fallback = typeof record[otherLang] === 'string' ? String(record[otherLang]).trim() : '';
      return fallback || null;
    };

    const readString = (value: unknown): string | null => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    };

    const readBoolean = (value: unknown, fallback = false): boolean => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value === 1;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
        if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
      }
      return fallback;
    };

    const readNumber = (value: unknown, fallback: number): number => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) return parsed;
      }
      return fallback;
    };

    const normalizeVariant = (value: unknown): 'full' | 'split' => (readString(value) === 'full' ? 'full' : 'split');

    const normalizeSize = (value: unknown): 'S' | 'M' | 'L' => {
      const raw = readString(value);
      if (raw === 'S' || raw === 'M' || raw === 'L') return raw;
      if (!raw) return 'M';
      const normalized = raw.toLowerCase();
      if (normalized === 's' || normalized === 'small') return 'S';
      if (normalized === 'l' || normalized === 'large') return 'L';
      return 'M';
    };

    const normalizeTextStyle = (value: unknown): 'light' | 'dark' => (readString(value) === 'light' ? 'light' : 'dark');

    const normalizeColumnsBreakpoint = (value: unknown): ColumnsBreakpoint => {
      const raw = readString(value);
      if (raw === 'sm' || raw === 'md' || raw === 'lg') return raw;
      return 'md';
    };

    const parseSlide = (raw: unknown): Slide => {
      const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      return {
        image_url: readString(rec['image_url']) || readString(rec['image']) || '',
        alt: readLocalized(rec['alt']),
        headline: readLocalized(rec['headline']),
        subheadline: readLocalized(rec['subheadline']),
        cta_label: readLocalized(rec['cta_label']),
        cta_url: readString(rec['cta_url']),
        variant: normalizeVariant(rec['variant']),
        size: normalizeSize(rec['size']),
        text_style: normalizeTextStyle(rec['text_style']),
        focal_x: Math.max(0, Math.min(100, Math.round(readNumber(rec['focal_x'], 50)))),
        focal_y: Math.max(0, Math.min(100, Math.round(readNumber(rec['focal_y'], 50))))
      };
    };

    const parseCarouselSettings = (raw: unknown): CarouselSettings => {
      const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      return {
        autoplay: readBoolean(rec['autoplay'], false),
        interval_ms: Math.max(1000, readNumber(rec['interval_ms'], 5000)),
        show_dots: readBoolean(rec['show_dots'], true),
        show_arrows: readBoolean(rec['show_arrows'], true),
        pause_on_hover: readBoolean(rec['pause_on_hover'], true)
      };
    };

    const rawBlocks = meta?.['blocks'];
    if (Array.isArray(rawBlocks) && rawBlocks.length) {
      for (const raw of rawBlocks) {
        if (!raw || typeof raw !== 'object') continue;
        const rec = raw as Record<string, unknown>;
        const typeRaw = typeof rec['type'] === 'string' ? String(rec['type']).trim() : '';
        const enabledRaw = rec['enabled'];
        const enabled = enabledRaw === false ? false : true;
        const normalizedBuiltIn = this.normalizeHomeSectionId(typeRaw);

        const type: HomeBlockType | null =
          normalizedBuiltIn ||
          (typeRaw === 'text' ||
          typeRaw === 'cta' ||
          typeRaw === 'faq' ||
          typeRaw === 'testimonials' ||
          typeRaw === 'image' ||
          typeRaw === 'gallery' ||
          typeRaw === 'banner' ||
          typeRaw === 'carousel' ||
          typeRaw === 'columns'
            ? (typeRaw as HomeBlockType)
            : null);
        if (!type) continue;

        const key = ensureUniqueKey(rec['key'], type);
        if (!key) continue;

        if (type === 'text') {
          const title = readLocalized(rec['title']);
          const body = readLocalized(rec['body_markdown']) || '';
          configured.push({ key, type, enabled, title, body_html: this.markdown.render(body) });
          continue;
        }
        if (type === 'image') {
          const url = typeof rec['url'] === 'string' ? rec['url'].trim() : '';
          if (!url) continue;
          configured.push({
            key,
            type,
            enabled,
            title: readLocalized(rec['title']),
            url,
            alt: readLocalized(rec['alt']),
            caption: readLocalized(rec['caption']),
            link_url: typeof rec['link_url'] === 'string' ? rec['link_url'].trim() : null,
            focal_x: Math.max(0, Math.min(100, Math.round(readNumber(rec['focal_x'], 50)))),
            focal_y: Math.max(0, Math.min(100, Math.round(readNumber(rec['focal_y'], 50))))
          });
          continue;
        }
        if (type === 'gallery') {
          const imagesRaw = rec['images'];
          const images: HomeGalleryImage[] = [];
          if (Array.isArray(imagesRaw)) {
            for (const imgRaw of imagesRaw) {
              if (!imgRaw || typeof imgRaw !== 'object') continue;
              const imgRec = imgRaw as Record<string, unknown>;
              const url = typeof imgRec['url'] === 'string' ? imgRec['url'].trim() : '';
              if (!url) continue;
              images.push({
                url,
                alt: readLocalized(imgRec['alt']),
                caption: readLocalized(imgRec['caption']),
                focal_x: Math.max(0, Math.min(100, Math.round(readNumber(imgRec['focal_x'], 50)))),
                focal_y: Math.max(0, Math.min(100, Math.round(readNumber(imgRec['focal_y'], 50))))
              });
            }
          }
          if (!images.length) continue;
          configured.push({ key, type, enabled, title: readLocalized(rec['title']), images });
          continue;
        }

        if (type === 'banner') {
          configured.push({ key, type, enabled, title: readLocalized(rec['title']), slide: parseSlide(rec['slide']) });
          continue;
        }

        if (type === 'carousel') {
          const slidesRaw = rec['slides'];
          const slides: Slide[] = [];
          if (Array.isArray(slidesRaw)) {
            for (const slideRaw of slidesRaw) slides.push(parseSlide(slideRaw));
          }
          if (!slides.length) slides.push(parseSlide({}));
          configured.push({
            key,
            type,
            enabled,
            title: readLocalized(rec['title']),
            slides,
            settings: parseCarouselSettings(rec['settings'])
          });
          continue;
        }

        if (type === 'columns') {
          const columnsRaw = rec['columns'];
          if (!Array.isArray(columnsRaw)) continue;
          const columns: HomeColumnsColumn[] = [];
          let hasAny = false;
          for (const colRaw of columnsRaw) {
            if (!colRaw || typeof colRaw !== 'object') continue;
            const colRec = colRaw as Record<string, unknown>;
            const colTitle = readLocalized(colRec['title']);
            const body = readLocalized(colRec['body_markdown']) || '';
            if (colTitle || body.trim()) hasAny = true;
            columns.push({ title: colTitle, body_html: this.markdown.render(body) });
            if (columns.length >= 3) break;
          }
          if (columns.length < 2 || !hasAny) continue;
          configured.push({
            key,
            type,
            enabled,
            title: readLocalized(rec['title']),
            columns,
            columns_count: columns.length === 3 ? 3 : 2,
            breakpoint: normalizeColumnsBreakpoint(rec['columns_breakpoint'] ?? rec['breakpoint'] ?? rec['stack_at'])
          });
          continue;
        }

        if (type === 'cta') {
          const title = readLocalized(rec['title']);
          const body = readLocalized(rec['body_markdown']) || '';
          const ctaLabel = readLocalized(rec['cta_label']);
          const ctaUrl = readString(rec['cta_url']);
          const ctaNewTab = readBoolean(rec['cta_new_tab'], false);
          const hasAny = Boolean(title || body.trim() || ctaLabel || ctaUrl);
          if (!hasAny) continue;
          configured.push({
            key,
            type,
            enabled,
            title,
            body_html: this.markdown.render(body),
            cta_label: ctaLabel,
            cta_url: ctaUrl,
            cta_new_tab: ctaNewTab
          });
          continue;
        }

        if (type === 'faq') {
          const itemsRaw = rec['items'];
          if (!Array.isArray(itemsRaw)) continue;
          const items: HomeFaqItem[] = [];
          for (const itemRaw of itemsRaw) {
            if (!itemRaw || typeof itemRaw !== 'object') continue;
            const itemRec = itemRaw as Record<string, unknown>;
            const question = readLocalized(itemRec['question']);
            if (!question) continue;
            const answerMd = readLocalized(itemRec['answer_markdown']) || '';
            items.push({ question, answer_html: this.markdown.render(answerMd) });
            if (items.length >= 20) break;
          }
          if (!items.length) continue;
          configured.push({ key, type, enabled, title: readLocalized(rec['title']), items });
          continue;
        }

        if (type === 'testimonials') {
          const itemsRaw = rec['items'];
          if (!Array.isArray(itemsRaw)) continue;
          const items: HomeTestimonialItem[] = [];
          for (const itemRaw of itemsRaw) {
            if (!itemRaw || typeof itemRaw !== 'object') continue;
            const itemRec = itemRaw as Record<string, unknown>;
            const quoteMd = readLocalized(itemRec['quote_markdown']) || '';
            if (!quoteMd.trim()) continue;
            const author = readLocalized(itemRec['author']);
            const role = readLocalized(itemRec['role']);
            items.push({ quote_html: this.markdown.render(quoteMd), author, role });
            if (items.length >= 12) break;
          }
          if (!items.length) continue;
          configured.push({ key, type, enabled, title: readLocalized(rec['title']), items });
          continue;
        }

        configured.push({ key, type, enabled });
      }
      if (configured.length) {
        return this.ensureAllDefaultBlocks(configured);
      }
    }

    const derived: HomeBlock[] = [];
    const seen = new Set<HomeSectionId>();
    const addSection = (rawId: unknown, enabled: boolean) => {
      const id = this.normalizeHomeSectionId(rawId);
      if (!id || seen.has(id)) return;
      seen.add(id);
      derived.push({ key: id, type: id, enabled });
    };

    const rawSections = meta?.['sections'];
    if (Array.isArray(rawSections)) {
      for (const raw of rawSections) {
        if (!raw || typeof raw !== 'object') continue;
        const id = (raw as { id?: unknown }).id;
        const enabled = (raw as { enabled?: unknown }).enabled;
        addSection(id, enabled === false ? false : true);
      }
      if (derived.length) {
        return this.ensureAllDefaultBlocks(derived);
      }
    }

    const legacyOrder = meta?.['order'];
    if (Array.isArray(legacyOrder) && legacyOrder.length) {
      for (const raw of legacyOrder) {
        addSection(raw, true);
      }
      if (derived.length) {
        return this.ensureAllDefaultBlocks(derived);
      }
    }

    return DEFAULT_BLOCKS;
  }

  private ensureAllDefaultBlocks(blocks: HomeBlock[]): HomeBlock[] {
    const out = [...blocks];
    const existing = new Set(out.filter((b) => this.isHomeSectionId(b.type)).map((b) => b.type as HomeSectionId));
    for (const block of DEFAULT_BLOCKS.filter((b) => this.isHomeSectionId(b.type))) {
      const id = block.type as HomeSectionId;
      if (!existing.has(id)) out.push({ key: id, type: id, enabled: block.enabled });
    }
    return out;
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

  private loadSectionData(opts?: { skipStory?: boolean }): void {
    const ids = new Set(
      this.enabledBlocks()
        .map((b) => (this.isHomeSectionId(b.type) ? (b.type as HomeSectionId) : null))
        .filter((x): x is HomeSectionId => Boolean(x))
    );
    if (ids.has('featured_products')) this.loadFeatured();
    if (ids.has('sale_products')) this.loadSaleProducts();
    if (ids.has('new_arrivals')) this.loadNewArrivals();
    if (ids.has('featured_collections')) this.loadCollections();
    if (ids.has('story') && !opts?.skipStory) this.loadStory();
  }

  asTextBlock(block: HomeBlock): HomeTextBlock | null {
    return block.type === 'text' ? (block as HomeTextBlock) : null;
  }

  asImageBlock(block: HomeBlock): HomeImageBlock | null {
    return block.type === 'image' ? (block as HomeImageBlock) : null;
  }

  asGalleryBlock(block: HomeBlock): HomeGalleryBlock | null {
    return block.type === 'gallery' ? (block as HomeGalleryBlock) : null;
  }

  asBannerBlock(block: HomeBlock): HomeBannerBlock | null {
    return block.type === 'banner' ? (block as HomeBannerBlock) : null;
  }

  asCarouselBlock(block: HomeBlock): HomeCarouselBlock | null {
    return block.type === 'carousel' ? (block as HomeCarouselBlock) : null;
  }

  asColumnsBlock(block: HomeBlock): HomeColumnsBlock | null {
    return block.type === 'columns' ? (block as HomeColumnsBlock) : null;
  }

  asCtaBlock(block: HomeBlock): HomeCtaBlock | null {
    return block.type === 'cta' ? (block as HomeCtaBlock) : null;
  }

  isExternalHttpUrl(url: string | null | undefined): boolean {
    const trimmed = (url || '').trim().toLowerCase();
    return trimmed.startsWith('http://') || trimmed.startsWith('https://');
  }

  asFaqBlock(block: HomeBlock): HomeFaqBlock | null {
    return block.type === 'faq' ? (block as HomeFaqBlock) : null;
  }

  asTestimonialsBlock(block: HomeBlock): HomeTestimonialsBlock | null {
    return block.type === 'testimonials' ? (block as HomeTestimonialsBlock) : null;
  }

  columnsGridClasses(block: HomeColumnsBlock): string {
    const matrix: Record<ColumnsCount, Record<ColumnsBreakpoint, string>> = {
      2: { sm: 'sm:grid-cols-2', md: 'md:grid-cols-2', lg: 'lg:grid-cols-2' },
      3: { sm: 'sm:grid-cols-3', md: 'md:grid-cols-3', lg: 'lg:grid-cols-3' }
    };
    return ['grid', 'gap-6', 'grid-cols-1', matrix[block.columns_count][block.breakpoint]].join(' ');
  }

  loadFeatured(): void {
    this.featuredLoading.set(true);
    this.featuredError.set(false);
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    this.catalog
      .listProducts({
        is_featured: true,
        limit: 6,
        sort: 'newest',
        page: 1,
        lang
      })
      .subscribe({
        next: (resp) => {
          this.featured = resp.items;
          this.featuredLoading.set(false);
        },
        error: () => {
          this.featured = [];
          this.featuredLoading.set(false);
          this.featuredError.set(true);
        }
      });
  }

	  loadSaleProducts(): void {
	    this.saleLoading.set(true);
	    this.saleError.set(false);
      const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
	    this.catalog
	      .listProducts({
	        on_sale: true,
	        limit: 6,
	        sort: 'newest',
	        page: 1,
          lang
	      })
      .subscribe({
        next: (resp) => {
          this.saleProducts = resp.items;
          this.saleLoading.set(false);
        },
        error: () => {
          this.saleProducts = [];
          this.saleLoading.set(false);
          this.saleError.set(true);
        }
      });
  }

  loadNewArrivals(): void {
    this.newArrivalsLoading.set(true);
    this.newArrivalsError.set(false);
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    this.catalog
      .listProducts({
        limit: 6,
        sort: 'newest',
        page: 1,
        lang
      })
      .subscribe({
        next: (resp) => {
          this.newArrivals = resp.items;
          this.newArrivalsLoading.set(false);
        },
        error: () => {
          this.newArrivals = [];
          this.newArrivalsLoading.set(false);
          this.newArrivalsError.set(true);
        }
      });
  }

  loadCollections(): void {
    this.collectionsLoading.set(true);
    this.collectionsError.set(false);
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    this.catalog.listFeaturedCollections(lang).subscribe({
      next: (cols) => {
        this.featuredCollections = cols;
        this.collectionsLoading.set(false);
      },
      error: () => {
        this.featuredCollections = [];
        this.collectionsLoading.set(false);
        this.collectionsError.set(true);
      }
    });
  }

  private loadStory(): void {
    this.storyLoading.set(true);
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    this.api.get<ContentBlockRead>('/content/home.story', { lang }).subscribe({
      next: (block) => {
        this.storyBlock.set(block);
        this.storyHtml.set(this.markdown.render(block.body_markdown || ''));
        this.storyLoading.set(false);
      },
      error: () => {
        this.storyBlock.set(null);
        this.storyHtml.set('');
        this.storyLoading.set(false);
      }
    });
  }

  private setMetaTags(): void {
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    const title = this.translate.instant('home.metaTitle');
    const description = this.translate.instant('home.metaDescription');
    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    const canonical = this.seoHeadLinks.setLocalizedCanonical('/', lang, { lang });
    this.meta.updateTag({ property: 'og:url', content: canonical });
    this.structuredData.setRouteSchemas([
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: title,
        description,
        url: canonical,
        inLanguage: lang
      }
    ]);
  }
}
