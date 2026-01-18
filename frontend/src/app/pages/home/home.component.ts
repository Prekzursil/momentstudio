import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
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

type HomeSectionId =
  | 'hero'
  | 'featured_products'
  | 'new_arrivals'
  | 'featured_collections'
  | 'story'
  | 'recently_viewed'
  | 'why';

type HomeBlockType = HomeSectionId | 'text' | 'image' | 'gallery';

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
}

interface HomeGalleryImage {
  url: string;
  alt?: string | null;
  caption?: string | null;
}

interface HomeGalleryBlock extends HomeBlockBase {
  type: 'gallery';
  title?: string | null;
  images: HomeGalleryImage[];
}

type HomeBlock = HomeBlockBase | HomeTextBlock | HomeImageBlock | HomeGalleryBlock;

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

const DEFAULT_BLOCKS: HomeBlock[] = [
  { key: 'hero', type: 'hero', enabled: true },
  { key: 'featured_products', type: 'featured_products', enabled: true },
  { key: 'new_arrivals', type: 'new_arrivals', enabled: true },
  { key: 'featured_collections', type: 'featured_collections', enabled: true },
  { key: 'story', type: 'story', enabled: true },
  { key: 'recently_viewed', type: 'recently_viewed', enabled: true },
  { key: 'why', type: 'why', enabled: true }
];

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, ButtonComponent, CardComponent, ProductCardComponent, SkeletonComponent, TranslateModule],
  template: `
    <section class="grid gap-10">
      <ng-container *ngFor="let block of enabledBlocks()">
        <ng-container [ngSwitch]="block.type">
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
                    <img class="w-full rounded-2xl object-cover" [src]="img.url" [alt]="img.alt || img.title || ''" loading="lazy" />
                  </a>
                  <ng-template #imageOnly>
                    <img class="w-full rounded-2xl object-cover" [src]="img.url" [alt]="img.alt || img.title || ''" loading="lazy" />
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
                    <img class="w-full rounded-2xl object-cover" [src]="image.url" [alt]="image.alt || gal.title || ''" loading="lazy" />
                    <p *ngIf="image.caption" class="mt-2 text-sm text-slate-600 dark:text-slate-300">{{ image.caption }}</p>
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
  readonly isAdmin = computed(() => this.auth.isAdmin());
  readonly enabledBlocks = computed(() => this.blocks().filter((b) => b.enabled));

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
        const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
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
          (typeRaw === 'text' || typeRaw === 'image' || typeRaw === 'gallery' ? (typeRaw as HomeBlockType) : null);
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
            link_url: typeof rec['link_url'] === 'string' ? rec['link_url'].trim() : null
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
              images.push({ url, alt: readLocalized(imgRec['alt']), caption: readLocalized(imgRec['caption']) });
            }
          }
          if (!images.length) continue;
          configured.push({ key, type, enabled, title: readLocalized(rec['title']), images });
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
    for (const id of DEFAULT_BLOCKS.filter((b) => this.isHomeSectionId(b.type)).map((b) => b.type as HomeSectionId)) {
      if (!existing.has(id)) out.push({ key: id, type: id, enabled: true });
    }
    return out;
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
    const ids = new Set(
      this.enabledBlocks()
        .map((b) => (this.isHomeSectionId(b.type) ? (b.type as HomeSectionId) : null))
        .filter((x): x is HomeSectionId => Boolean(x))
    );
    if (ids.has('hero')) this.loadHero();
    if (ids.has('featured_products')) this.loadFeatured();
    if (ids.has('new_arrivals')) this.loadNewArrivals();
    if (ids.has('featured_collections')) this.loadCollections();
    if (ids.has('story')) this.loadStory();
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
