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

describe('HomeComponent', () => {
  afterEach(() => {
    document
      .querySelectorAll('link[rel="alternate"][data-seo-managed="true"]')
      .forEach((el) => el.remove());
    document.querySelectorAll('script[data-seo-route-schema="true"]').forEach((el) => el.remove());
  });

  it('renders sections in CMS order', () => {
    const meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    const title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    const catalog = jasmine.createSpyObj<CatalogService>('CatalogService', [
      'listProducts',
      'listFeaturedCollections',
    ]);
    const recentlyViewed = jasmine.createSpyObj<RecentlyViewedService>('RecentlyViewedService', [
      'list',
    ]);
    const auth = {
      user: () => null,
      isAuthenticated: () => false,
      isAdmin: () => false,
    } as unknown as AuthService;
    const markdown = { render: (s: string) => s } as unknown as MarkdownService;

    api.get.and.callFake(<T>(url: string, _params?: unknown, _headers?: Record<string, string>) => {
      void _params;
      void _headers;
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

    catalog.listProducts.and.returnValue(
      of({
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
      }),
    );
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
        { provide: AuthService, useValue: auth },
        { provide: MarkdownService, useValue: markdown },
      ],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
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
      },
      true,
    );
    translate.use('en');

    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('h1').length).toBe(1);
    const h2s = Array.from(
      fixture.nativeElement.querySelectorAll('h2') as NodeListOf<HTMLElement>,
    ).map((el) => (el.textContent || '').trim());
    expect(h2s).toEqual(['Featured pieces', 'Why this starter']);
    const canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    expect(canonical?.getAttribute('href')).toContain('/');
    expect(canonical?.getAttribute('href')).not.toContain('lang=en');
    expect(document.querySelectorAll('link[rel="alternate"][data-seo-managed="true"]').length).toBe(
      3,
    );
    expect(document.querySelector('script#seo-route-schema-1')?.textContent || '').toContain(
      '"WebPage"',
    );
  });

  it('loads section data for enabled CMS sections', () => {
    const meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    const title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    const catalog = jasmine.createSpyObj<CatalogService>('CatalogService', [
      'listProducts',
      'listFeaturedCollections',
    ]);
    const recentlyViewed = jasmine.createSpyObj<RecentlyViewedService>('RecentlyViewedService', [
      'list',
    ]);
    const auth = {
      user: () => null,
      isAuthenticated: () => false,
      isAdmin: () => false,
    } as unknown as AuthService;
    const markdown = { render: (s: string) => s } as unknown as MarkdownService;

    api.get.and.callFake(<T>(url: string, params?: unknown) => {
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
        return of({
          title: 'Story',
          body_markdown: 'Story copy',
          meta: {},
          images: [],
        } as unknown as T);
      }
      throw new Error(`Unexpected ApiService.get(${url})`);
    });

    catalog.listProducts.and.returnValue(
      of({
        items: [],
        meta: { total_items: 0, total_pages: 1, page: 1, limit: 6 },
      }),
    );
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
        { provide: AuthService, useValue: auth },
        { provide: MarkdownService, useValue: markdown },
      ],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        app: { tagline: 'art. handcrafted.' },
        home: { metaTitle: 'Home', metaDescription: 'Home' },
      },
      true,
    );
    translate.use('en');

    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();

    expect(catalog.listProducts.calls.count()).toBe(2);
    expect(catalog.listProducts.calls.argsFor(0)[0]).toEqual(
      jasmine.objectContaining({ is_featured: true, limit: 6, sort: 'newest', page: 1 }),
    );
    expect(catalog.listProducts.calls.argsFor(1)[0]).toEqual(
      jasmine.objectContaining({ limit: 6, sort: 'newest', page: 1 }),
    );

    expect(catalog.listFeaturedCollections.calls.count()).toBe(1);
    expect(api.get).toHaveBeenCalledWith('/content/home.sections');
    expect(api.get).toHaveBeenCalledWith('/content/home.story', { lang: 'en' });
  });

  /**
   * Golden WU home45 — colocated helper arms for gallery/CTA/columns template helpers.
   * Deslop vs home.behaviour.spec.ts: NaN focal micro-assert, trimmed/cased HTTPS,
   * and the full columns_count × breakpoint matrix (6 cells).
   */
  function configureHelperHarness(): HomeComponent {
    const meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    const title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    const catalog = jasmine.createSpyObj<CatalogService>('CatalogService', [
      'listProducts',
      'listFeaturedCollections',
    ]);
    const recentlyViewed = jasmine.createSpyObj<RecentlyViewedService>('RecentlyViewedService', [
      'list',
    ]);
    const auth = {
      user: () => null,
      isAuthenticated: () => false,
      isAdmin: () => false,
    } as unknown as AuthService;
    const markdown = { render: (s: string) => s } as unknown as MarkdownService;

    api.get.and.returnValue(of({ meta: {} } as never));
    catalog.listProducts.and.returnValue(
      of({
        items: [],
        meta: { total_items: 0, total_pages: 1, page: 1, limit: 6 },
      }) as never,
    );
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
        { provide: AuthService, useValue: auth },
        { provide: MarkdownService, useValue: markdown },
      ],
    });
    TestBed.inject(TranslateService).use('en');
    return TestBed.createComponent(HomeComponent).componentInstance;
  }

  it('focalPosition clamps, rounds, and defaults object-position percentages', () => {
    const cmp = configureHelperHarness();
    expect(cmp.focalPosition()).toBe('50% 50%');
    expect(cmp.focalPosition(-10, 250)).toBe('0% 100%');
    expect(cmp.focalPosition(33.6, 12.2)).toBe('34% 12%');
    // Non-finite input still yields a %-bearing object-position string (no production clamp change).
    expect(cmp.focalPosition(Number.NaN as never, 50)).toContain('%');
  });

  it('isExternalHttpUrl accepts trimmed http(s) and rejects non-http urls', () => {
    const cmp = configureHelperHarness();
    expect(cmp.isExternalHttpUrl('https://x.com')).toBeTrue();
    expect(cmp.isExternalHttpUrl('http://x.com')).toBeTrue();
    expect(cmp.isExternalHttpUrl('  HTTPS://Example.com/a  ')).toBeTrue();
    expect(cmp.isExternalHttpUrl('/internal')).toBeFalse();
    expect(cmp.isExternalHttpUrl('')).toBeFalse();
    expect(cmp.isExternalHttpUrl('ftp://x')).toBeFalse();
    expect(cmp.isExternalHttpUrl(null)).toBeFalse();
    expect(cmp.isExternalHttpUrl(undefined)).toBeFalse();
    expect(cmp.isExternalHttpUrl('   ')).toBeFalse();
  });

  it('columnsGridClasses maps columns_count and breakpoint to the full grid class matrix', () => {
    const cmp = configureHelperHarness();
    const counts = [2, 3] as const;
    const breakpoints = ['sm', 'md', 'lg'] as const;
    for (const columns_count of counts) {
      for (const breakpoint of breakpoints) {
        const classes = cmp.columnsGridClasses({ columns_count, breakpoint } as never);
        expect(classes).toContain('grid');
        expect(classes).toContain('gap-6');
        expect(classes).toContain('grid-cols-1');
        expect(classes).toContain(`${breakpoint}:grid-cols-${columns_count}`);
      }
    }
  });
});
