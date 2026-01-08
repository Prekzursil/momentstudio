import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ButtonComponent } from '../../shared/button.component';
import { CardComponent } from '../../shared/card.component';
import { ContainerComponent } from '../../layout/container.component';
import { CatalogService, Product, FeaturedCollection } from '../../core/catalog.service';
import { RecentlyViewedService } from '../../core/recently-viewed.service';
import { ProductCardComponent } from '../../shared/product-card.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Meta, Title } from '@angular/platform-browser';
import { AuthService } from '../../core/auth.service';
import { ApiService } from '../../core/api.service';
import { MarkdownService } from '../../core/markdown.service';

type HomeSectionId =
  | 'hero'
  | 'featured_products'
  | 'new_arrivals'
  | 'featured_collections'
  | 'story'
  | 'recently_viewed'
  | 'why';

interface HomeSectionConfig {
  id: HomeSectionId;
  enabled: boolean;
}

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

const DEFAULT_SECTIONS: HomeSectionConfig[] = [
  { id: 'hero', enabled: true },
  { id: 'featured_products', enabled: true },
  { id: 'new_arrivals', enabled: true },
  { id: 'featured_collections', enabled: true },
  { id: 'story', enabled: true },
  { id: 'recently_viewed', enabled: true },
  { id: 'why', enabled: true }
];

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, ButtonComponent, CardComponent, ContainerComponent, ProductCardComponent, SkeletonComponent, TranslateModule],
  template: `
    <section class="grid gap-10">
      <ng-container *ngFor="let section of enabledSections()">
        <ng-container [ngSwitch]="section.id">
          <ng-container *ngSwitchCase="'hero'">
            <div class="grid gap-6 lg:grid-cols-[1.2fr_1fr] items-center">
              <div class="grid gap-4">
                <p class="font-cinzel font-semibold text-[28px] tracking-[0.3em] text-slate-500 dark:text-slate-400">
                  {{ 'app.tagline' | translate }}
                </p>
                <h1 class="text-3xl sm:text-4xl lg:text-5xl font-semibold leading-tight text-slate-900 dark:text-slate-50">
                  {{ heroHeadline() || ('home.headline' | translate) }}
                </h1>
                <p class="text-lg text-slate-600 dark:text-slate-300">
                  {{ heroSubtitle() || ('home.subhead' | translate) }}
                </p>
                <div class="flex flex-wrap gap-3">
                  <app-button [label]="heroCtaLabel() || ('home.ctaShop' | translate)" [routerLink]="[heroCtaUrl() || '/shop']"></app-button>
                  <app-button
                    *ngIf="isAdmin()"
                    [label]="'home.ctaAdmin' | translate"
                    variant="ghost"
                    [routerLink]="['/admin']"
                  ></app-button>
                </div>
              </div>
              <div class="relative">
                <div class="absolute -inset-4 rounded-3xl bg-slate-900/5 blur-xl dark:bg-slate-50/10"></div>
                <app-card class="relative">
                  <img
                    *ngIf="heroImage()"
                    class="aspect-video w-full rounded-2xl object-cover"
                    [src]="heroImage()"
                    [alt]="heroHeadline() || ('home.headline' | translate)"
                    loading="lazy"
                  />
                  <div
                    *ngIf="!heroImage()"
                    class="aspect-video rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 grid place-items-center text-white text-xl font-semibold"
                  >
                    Hero image slot
                  </div>
                </app-card>
              </div>
            </div>
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
  sections = signal<HomeSectionConfig[]>(DEFAULT_SECTIONS);

  heroBlock = signal<ContentBlockRead | null>(null);
  heroLoading = signal<boolean>(true);

  featured: Product[] = [];
  featuredLoading = signal<boolean>(true);
  featuredError = signal<boolean>(false);

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
  readonly isAdmin = computed(() => this.auth.role() === 'admin');
  readonly enabledSections = computed(() => this.sections().filter((s) => s.enabled));

  private langSub?: Subscription;

  constructor(
    private catalog: CatalogService,
    private recentlyViewedService: RecentlyViewedService,
    private title: Title,
    private meta: Meta,
    private translate: TranslateService,
    private auth: AuthService,
    private api: ApiService,
    private markdown: MarkdownService
  ) {}

  ngOnInit(): void {
    this.load();
    this.langSub = this.translate.onLangChange.subscribe(() => this.load());
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
  }

  private load(): void {
    this.setMetaTags();
    this.recentlyViewed = this.recentlyViewedService.list().slice(0, 6);
    this.loadLayout();
  }

  private loadLayout(): void {
    this.api.get<ContentBlockRead>('/content/home.sections').subscribe({
      next: (block) => {
        this.sections.set(this.parseSections(block.meta));
        this.loadSectionData();
      },
      error: () => {
        this.sections.set(DEFAULT_SECTIONS);
        this.loadSectionData();
      }
    });
  }

  private parseSections(meta: ContentBlockRead['meta']): HomeSectionConfig[] {
    const configured: HomeSectionConfig[] = [];
    const seen = new Set<HomeSectionId>();

    const addSection = (rawId: unknown, enabled: boolean) => {
      const id = this.normalizeHomeSectionId(rawId);
      if (!id || seen.has(id)) return;
      seen.add(id);
      configured.push({ id, enabled });
    };

    const rawSections = meta?.['sections'];
    if (Array.isArray(rawSections)) {
      for (const raw of rawSections) {
        if (!raw || typeof raw !== 'object') continue;
        const id = (raw as { id?: unknown }).id;
        const enabled = (raw as { enabled?: unknown }).enabled;
        addSection(id, enabled === false ? false : true);
      }
      if (configured.length) {
        return configured;
      }
    }

    const legacyOrder = meta?.['order'];
    if (Array.isArray(legacyOrder) && legacyOrder.length) {
      for (const raw of legacyOrder) {
        addSection(raw, true);
      }
      if (configured.length) {
        return configured;
      }
    }

    return DEFAULT_SECTIONS;
  }

  private isHomeSectionId(value: unknown): value is HomeSectionId {
    return (
      value === 'hero' ||
      value === 'featured_products' ||
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
    if (key === 'new') return 'new_arrivals';
    if (key === 'recent') return 'recently_viewed';
    if (key === 'recentlyviewed') return 'recently_viewed';
    return null;
  }

  private loadSectionData(): void {
    const ids = new Set(this.enabledSections().map((s) => s.id));
    if (ids.has('hero')) this.loadHero();
    if (ids.has('featured_products')) this.loadFeatured();
    if (ids.has('new_arrivals')) this.loadNewArrivals();
    if (ids.has('featured_collections')) this.loadCollections();
    if (ids.has('story')) this.loadStory();
  }

  loadFeatured(): void {
    this.featuredLoading.set(true);
    this.featuredError.set(false);
    this.catalog
      .listProducts({
        is_featured: true,
        limit: 6,
        sort: 'newest',
        page: 1
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

  loadNewArrivals(): void {
    this.newArrivalsLoading.set(true);
    this.newArrivalsError.set(false);
    this.catalog
      .listProducts({
        limit: 6,
        sort: 'newest',
        page: 1
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
    this.catalog.listFeaturedCollections().subscribe({
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

  private loadHero(): void {
    this.heroLoading.set(true);
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    this.api.get<ContentBlockRead>('/content/home.hero', { lang }).subscribe({
      next: (block) => {
        this.heroBlock.set(block);
        this.heroLoading.set(false);
      },
      error: () => {
        this.heroBlock.set(null);
        this.heroLoading.set(false);
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

  heroHeadline(): string {
    const block = this.heroBlock();
    const meta = (block?.meta ?? {}) as Record<string, unknown>;
    const headline = (meta['headline'] ?? block?.title ?? '') as string;
    return typeof headline === 'string' ? headline.trim() : '';
  }

  heroSubtitle(): string {
    const subtitle = (this.heroBlock()?.body_markdown ?? '') as string;
    return typeof subtitle === 'string' ? subtitle.trim() : '';
  }

  heroCtaLabel(): string {
    const meta = (this.heroBlock()?.meta ?? {}) as Record<string, unknown>;
    const label = meta['cta_label'] ?? meta['cta'];
    return typeof label === 'string' ? label.trim() : '';
  }

  heroCtaUrl(): string {
    const meta = (this.heroBlock()?.meta ?? {}) as Record<string, unknown>;
    const url = meta['cta_url'] ?? meta['cta_link'];
    return typeof url === 'string' ? url.trim() : '';
  }

  heroImage(): string {
    const block = this.heroBlock();
    if (!block) return '';
    const fromImages = block.images?.[0]?.url;
    if (typeof fromImages === 'string' && fromImages.trim()) {
      return fromImages.trim();
    }
    const meta = (block.meta ?? {}) as Record<string, unknown>;
    const img = meta['image'];
    return typeof img === 'string' ? img.trim() : '';
  }

  private setMetaTags(): void {
    const title = this.translate.instant('home.metaTitle');
    const description = this.translate.instant('home.metaDescription');
    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
  }
}
