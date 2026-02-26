import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { HomeComponent } from './home.component';
import { ApiService } from '../../core/api.service';
import { CatalogService } from '../../core/catalog.service';
import { RecentlyViewedService } from '../../core/recently-viewed.service';
import { AuthService } from '../../core/auth.service';
import { MarkdownService } from '../../core/markdown.service';

type HomeTestContext = {
  fixture: any;
  api: jasmine.SpyObj<ApiService>;
  catalog: jasmine.SpyObj<CatalogService>;
};

const HOME_TRANSLATIONS = {
  app: { tagline: 'art. handcrafted.' },
  home: {
    metaTitle: 'Home',
    metaDescription: 'Home',
    featured: 'Featured pieces',
    viewAll: 'View all',
    noFeatured: 'No featured products right now.',
    featuredError: { title: 'Err', copy: 'Err' },
    why: 'Why this starter',
    cards: {
      strictTitle: 'A',
      strict: 'A',
      tokensTitle: 'B',
      tokens: 'B',
      primitivesTitle: 'C',
      primitives: 'C',
      shellTitle: 'D',
      shell: 'D',
    },
  },
  shop: { retry: 'Retry' },
};

const DEFAULT_LIST_RESPONSE = {
  items: [
    {
      id: 'p1',
      slug: 'p1',
      name: 'Product',
      base_price: 10,
      currency: 'USD',
      images: [],
    },
  ],
  meta: { total_items: 1, total_pages: 1, page: 1, limit: 6 },
};

function createAuthStub(): AuthService {
  return { user: () => null, isAuthenticated: () => false, isAdmin: () => false } as unknown as AuthService;
}

function createMarkdownStub(): MarkdownService {
  return { render: (value: string) => value } as unknown as MarkdownService;
}

function initializeEnglishTranslations(translate: TranslateService): void {
  translate.setTranslation('en', HOME_TRANSLATIONS, true);
  translate.use('en');
}

function createHomeContext(apiGet: <T>(url: string, params?: unknown, headers?: Record<string, string>) => any): HomeTestContext {
  const meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
  const title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
  const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
  const catalog = jasmine.createSpyObj<CatalogService>('CatalogService', ['listProducts', 'listFeaturedCollections']);
  const recentlyViewed = jasmine.createSpyObj<RecentlyViewedService>('RecentlyViewedService', ['list']);

  api.get.and.callFake(apiGet);
  catalog.listProducts.and.returnValue(of(DEFAULT_LIST_RESPONSE));
  catalog.listFeaturedCollections.and.returnValue(of([]));
  recentlyViewed.list.and.returnValue([]);

  TestBed.configureTestingModule({
    imports: [RouterTestingModule, HomeComponent, TranslateModule.forRoot()],
    providers: [
      { provide: Title, useValue: title },
      { provide: Meta, useValue: meta },
      { provide: ApiService, useValue: api },
      { provide: CatalogService, useValue: catalog },
      { provide: RecentlyViewedService, useValue: recentlyViewed },
      { provide: AuthService, useValue: createAuthStub() },
      { provide: MarkdownService, useValue: createMarkdownStub() },
    ],
  });

  const translate = TestBed.inject(TranslateService);
  initializeEnglishTranslations(translate);

  const fixture = TestBed.createComponent(HomeComponent);
  fixture.detectChanges();
  return { fixture, api, catalog };
}

function assertSeoMarkupForHomePage(): void {
  const canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  expect(canonical?.getAttribute('href')).toContain('/');
  expect(canonical?.getAttribute('href')).not.toContain('lang=en');
  expect(document.querySelectorAll('link[rel="alternate"][data-seo-managed="true"]').length).toBe(3);
  expect(document.querySelector('script#seo-route-schema-1')?.textContent || '').toContain('"WebPage"');
}

function cleanupSeoNodes(): void {
  document.querySelectorAll('link[rel="alternate"][data-seo-managed="true"]').forEach((el) => el.remove());
  document.querySelectorAll('script[data-seo-route-schema="true"]').forEach((el) => el.remove());
}

describe('HomeComponent section rendering', () => {
  afterEach(() => {
    cleanupSeoNodes();
  });

  it('renders sections in CMS order', () => {
    const { fixture } = createHomeContext(<T>(url: string) => {
      if (url === '/content/home.sections') {
        return of({
          title: 'Home layout',
          body_markdown: '',
          meta: {
            sections: [
              { id: 'featured_products', enabled: true },
              { id: 'why', enabled: true },
              { id: 'hero', enabled: false },
              { id: 'new_arrivals', enabled: false },
              { id: 'featured_collections', enabled: false },
              { id: 'story', enabled: false },
              { id: 'recently_viewed', enabled: false },
            ],
          },
          images: [],
        } as unknown as T);
      }
      throw new Error(`Unexpected ApiService.get(${url})`);
    });

    expect(fixture.nativeElement.querySelectorAll('h1').length).toBe(1);
    const headings = Array.from(fixture.nativeElement.querySelectorAll('h2') as NodeListOf<HTMLElement>).map((el) =>
      (el.textContent || '').trim(),
    );
    expect(headings).toEqual(['Featured pieces', 'Why this starter']);
    assertSeoMarkupForHomePage();
  });
});

describe('HomeComponent CMS data loading', () => {
  afterEach(() => {
    cleanupSeoNodes();
  });

  it('loads section data for enabled CMS sections', () => {
    const { api, catalog } = createHomeContext(<T>(url: string, params?: unknown) => {
      if (url === '/content/home.sections') {
        return of({
          title: 'Home layout',
          body_markdown: '',
          meta: {
            sections: [
              { id: 'featured_products', enabled: true },
              { id: 'new_arrivals', enabled: true },
              { id: 'featured_collections', enabled: true },
              { id: 'story', enabled: true },
            ],
          },
          images: [],
        } as unknown as T);
      }
      if (url === '/content/home.story') {
        expect(params).toEqual({ lang: 'en' });
        return of({ title: 'Story', body_markdown: 'Story copy', meta: {}, images: [] } as unknown as T);
      }
      throw new Error(`Unexpected ApiService.get(${url})`);
    });

    expect(catalog.listProducts.calls.count()).toBe(2);
    expect(catalog.listProducts.calls.argsFor(0)[0]).toEqual(
      jasmine.objectContaining({ is_featured: true, limit: 6, sort: 'newest', page: 1 }),
    );
    expect(catalog.listProducts.calls.argsFor(1)[0]).toEqual(jasmine.objectContaining({ limit: 6, sort: 'newest', page: 1 }));
    expect(catalog.listFeaturedCollections.calls.count()).toBe(1);
    expect(api.get).toHaveBeenCalledWith('/content/home.sections');
    expect(api.get).toHaveBeenCalledWith('/content/home.story', { lang: 'en' });
  });
});
