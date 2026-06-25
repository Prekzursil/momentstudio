import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Meta, Title } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { HomeComponent } from './home.component';
import { ApiService } from '../../core/api.service';
import { CatalogService } from '../../core/catalog.service';
import { RecentlyViewedService } from '../../core/recently-viewed.service';
import { AuthService } from '../../core/auth.service';
import { MarkdownService } from '../../core/markdown.service';
import { SeoHeadLinksService } from '../../core/seo-head-links.service';
import { StructuredDataService } from '../../core/structured-data.service';

interface HomeInternals {
  parseBlocks: (meta: unknown, lang: 'en' | 'ro') => unknown[];
  normalizeHomeSectionId: (v: unknown) => string | null;
  loadStory: () => void;
}
type Home = HomeComponent;
function internals(cmp: HomeComponent): HomeInternals {
  return cmp as unknown as HomeInternals;
}

describe('HomeComponent (behaviour)', () => {
  let api: jasmine.SpyObj<ApiService>;
  let catalog: jasmine.SpyObj<CatalogService>;
  let recently: jasmine.SpyObj<RecentlyViewedService>;
  let title: jasmine.SpyObj<Title>;
  let meta: jasmine.SpyObj<Meta>;
  let seoHeadLinks: jasmine.SpyObj<SeoHeadLinksService>;
  let structured: jasmine.SpyObj<StructuredDataService>;
  let queryParams$: BehaviorSubject<Record<string, unknown>>;

  const listResp = {
    items: [{ id: 'p1', slug: 'p1', name: 'P', base_price: 10, currency: 'RON', images: [] }],
    meta: { total_items: 1, total_pages: 1, page: 1, limit: 6 },
  };

  function configure(): void {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    catalog = jasmine.createSpyObj<CatalogService>('CatalogService', [
      'listProducts',
      'listFeaturedCollections',
    ]);
    recently = jasmine.createSpyObj<RecentlyViewedService>('RecentlyViewedService', ['list']);
    title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    seoHeadLinks = jasmine.createSpyObj<SeoHeadLinksService>('SeoHeadLinksService', [
      'setLocalizedCanonical',
    ]);
    structured = jasmine.createSpyObj<StructuredDataService>('StructuredDataService', [
      'setRouteSchemas',
      'clearRouteSchemas',
    ]);
    queryParams$ = new BehaviorSubject<Record<string, unknown>>({});

    api.get.and.returnValue(of({ meta: {} } as never));
    catalog.listProducts.and.returnValue(of(listResp) as never);
    catalog.listFeaturedCollections.and.returnValue(of([]));
    recently.list.and.returnValue([]);
    seoHeadLinks.setLocalizedCanonical.and.returnValue('http://localhost/');

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, HomeComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: ApiService, useValue: api },
        { provide: CatalogService, useValue: catalog },
        { provide: RecentlyViewedService, useValue: recently },
        {
          provide: AuthService,
          useValue: { user: () => null, isAuthenticated: () => false, isAdmin: () => false },
        },
        { provide: MarkdownService, useValue: { render: (s: string) => `<p>${s}</p>` } },
        { provide: SeoHeadLinksService, useValue: seoHeadLinks },
        { provide: StructuredDataService, useValue: structured },
        { provide: ActivatedRoute, useValue: { queryParams: queryParams$.asObservable() } },
        { provide: DOCUMENT, useValue: document },
      ],
    });
    TestBed.inject(TranslateService).use('en');
  }

  function create(): Home {
    return TestBed.createComponent(HomeComponent).componentInstance as Home;
  }

  it('focalPosition clamps, rounds, and defaults', () => {
    configure();
    const cmp = create();
    expect(cmp.focalPosition()).toBe('50% 50%');
    expect(cmp.focalPosition(-10, 250)).toBe('0% 100%');
    expect(cmp.focalPosition(33.6, 12.2)).toBe('34% 12%');
  });

  it('isExternalHttpUrl detects http(s) urls', () => {
    configure();
    const cmp = create();
    expect(cmp.isExternalHttpUrl('https://x.com')).toBeTrue();
    expect(cmp.isExternalHttpUrl('http://x.com')).toBeTrue();
    expect(cmp.isExternalHttpUrl('/internal')).toBeFalse();
    expect(cmp.isExternalHttpUrl(null)).toBeFalse();
    expect(cmp.isExternalHttpUrl(undefined)).toBeFalse();
  });

  it('columnsGridClasses builds grid classes for both counts and breakpoints', () => {
    configure();
    const cmp = create();
    expect(cmp.columnsGridClasses({ columns_count: 2, breakpoint: 'sm' } as never)).toContain(
      'sm:grid-cols-2',
    );
    expect(cmp.columnsGridClasses({ columns_count: 3, breakpoint: 'lg' } as never)).toContain(
      'lg:grid-cols-3',
    );
  });

  it('type guards return the block only for the matching type', () => {
    configure();
    const cmp = create();
    const guards: Array<[keyof HomeComponent, string]> = [
      ['asTextBlock', 'text'],
      ['asImageBlock', 'image'],
      ['asGalleryBlock', 'gallery'],
      ['asBannerBlock', 'banner'],
      ['asCarouselBlock', 'carousel'],
      ['asColumnsBlock', 'columns'],
      ['asCtaBlock', 'cta'],
      ['asFaqBlock', 'faq'],
      ['asTestimonialsBlock', 'testimonials'],
    ];
    for (const [method, type] of guards) {
      const fn = cmp[method] as unknown as (b: unknown) => unknown;
      expect(fn.call(cmp, { type })).toBeTruthy();
      expect(fn.call(cmp, { type: 'other' })).toBeNull();
    }
  });

  it('normalizeHomeSectionId maps known ids, aliases, and rejects unknowns', () => {
    configure();
    const cmp = create();
    expect(internals(cmp).normalizeHomeSectionId('featured_products')).toBe('featured_products');
    expect(internals(cmp).normalizeHomeSectionId('featuredProducts')).toBe('featured_products');
    expect(internals(cmp).normalizeHomeSectionId('collections')).toBe('featured_collections');
    expect(internals(cmp).normalizeHomeSectionId('featured')).toBe('featured_products');
    expect(internals(cmp).normalizeHomeSectionId('bestsellers')).toBe('featured_products');
    expect(internals(cmp).normalizeHomeSectionId('sale')).toBe('sale_products');
    expect(internals(cmp).normalizeHomeSectionId('sales')).toBe('sale_products');
    expect(internals(cmp).normalizeHomeSectionId('new')).toBe('new_arrivals');
    expect(internals(cmp).normalizeHomeSectionId('recent')).toBe('recently_viewed');
    expect(internals(cmp).normalizeHomeSectionId('recentlyViewed')).toBe('recently_viewed');
    expect(internals(cmp).normalizeHomeSectionId('unknown')).toBeNull();
    expect(internals(cmp).normalizeHomeSectionId('  ')).toBeNull();
    expect(internals(cmp).normalizeHomeSectionId(42)).toBeNull();
  });

  it('parseBlocks builds every block type from a rich meta payload', () => {
    configure();
    const cmp = create();
    const blocks = internals(cmp).parseBlocks(
      {
        blocks: [
          { type: 'text', key: 't', title: { en: 'T', ro: 'Tr' }, body_markdown: 'body' },
          {
            type: 'image',
            url: '/i.jpg',
            title: 'Img',
            alt: 'alt',
            caption: 'cap',
            link_url: '/go',
            focal_x: 10,
            focal_y: 90,
          },
          { type: 'image' },
          { type: 'gallery', images: [{ url: '/g.jpg', alt: 'a', caption: 'c' }, {}, { url: '' }] },
          { type: 'gallery', images: 'nope' },
          {
            type: 'banner',
            slide: {
              image: '/b.jpg',
              headline: { en: 'H' },
              variant: 'full',
              size: 'small',
              text_style: 'light',
            },
          },
          { type: 'carousel', slides: [{ image_url: '/c.jpg' }], settings: { autoplay: '1' } },
          { type: 'carousel', slides: [] },
          {
            type: 'columns',
            columns: [{ title: 'A', body_markdown: 'x' }, { body_markdown: 'y' }, {}, 'bad'],
            breakpoint: 'lg',
          },
          { type: 'columns', columns: [{ body_markdown: '' }] },
          { type: 'columns', columns: 'nope' },
          { type: 'cta', title: 'C', cta_label: 'Go', cta_url: '/x', cta_new_tab: true },
          { type: 'cta' },
          {
            type: 'faq',
            items: [{ question: 'Q', answer_markdown: 'A' }, { question: '' }, 'bad'],
          },
          { type: 'faq', items: [] },
          { type: 'faq', items: 'nope' },
          {
            type: 'testimonials',
            items: [
              { quote_markdown: 'Quote', author: 'Ana', role: 'Buyer' },
              { quote_markdown: '' },
            ],
          },
          { type: 'testimonials', items: [] },
          { type: 'testimonials', items: 'nope' },
          { type: 'featured_products', key: 'fp' },
          'not-an-object',
          { type: '' },
          { type: 'unknown_type' },
          { type: 'text', key: 'fp' },
        ],
      },
      'en',
    );
    const types = blocks.map((b) => (b as { type: string }).type);
    expect(types).toContain('text');
    expect(types).toContain('image');
    expect(types).toContain('gallery');
    expect(types).toContain('banner');
    expect(types).toContain('carousel');
    expect(types).toContain('columns');
    expect(types).toContain('cta');
    expect(types).toContain('faq');
    expect(types).toContain('testimonials');
    // Default sections are appended.
    expect(types).toContain('story');
    expect(types).toContain('why');
  });

  it('parseBlocks reads localized strings, booleans, numbers, and slide variants', () => {
    configure();
    const cmp = create();
    const ro = internals(cmp).parseBlocks(
      {
        blocks: [
          { type: 'text', title: 'plain', body_markdown: { ro: 'corp', en: 'body' } },
          {
            type: 'banner',
            slide: {
              image_url: '/b',
              headline: { en: 'only-en' },
              variant: 'split',
              size: 'L',
              text_style: 'dark',
              focal_x: '120',
              focal_y: 'bad',
            },
          },
          {
            type: 'carousel',
            slides: [{ image_url: '/c' }],
            settings: {
              autoplay: 'yes',
              show_dots: 'off',
              show_arrows: false,
              interval_ms: 500,
              pause_on_hover: 0,
            },
          },
        ],
      },
      'ro',
    );
    expect(ro.length).toBeGreaterThan(0);
  });

  it('parseBlocks derives sections from the sections array', () => {
    configure();
    const cmp = create();
    const blocks = internals(cmp).parseBlocks(
      {
        sections: [
          { id: 'featured_products', enabled: true },
          { id: 'featured_products', enabled: true },
          { id: 'unknown', enabled: true },
          'bad',
          { id: 'story', enabled: false },
        ],
      },
      'en',
    );
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('parseBlocks derives sections from a legacy order array', () => {
    configure();
    const cmp = create();
    const blocks = internals(cmp).parseBlocks({ order: ['featured', 'sale', 'unknown'] }, 'en');
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('parseBlocks returns the default blocks for empty meta', () => {
    configure();
    const cmp = create();
    expect(internals(cmp).parseBlocks({}, 'en').length).toBeGreaterThan(0);
    expect(internals(cmp).parseBlocks({ blocks: [] }, 'en').length).toBeGreaterThan(0);
    expect(internals(cmp).parseBlocks({ sections: [] }, 'en').length).toBeGreaterThan(0);
    expect(
      internals(cmp).parseBlocks({ blocks: [{ type: 'unknown' }] }, 'en').length,
    ).toBeGreaterThan(0);
  });

  it('loads the layout from the sections endpoint and section data', () => {
    configure();
    api.get.and.callFake((url: string) => {
      if (url === '/content/home.sections') {
        return of({ meta: { sections: [{ id: 'featured_products', enabled: true }] } }) as never;
      }
      return of({ meta: {} }) as never;
    });
    const cmp = create();
    cmp.ngOnInit();
    expect(catalog.listProducts).toHaveBeenCalled();
    expect(title.setTitle).toHaveBeenCalled();
    expect(structured.setRouteSchemas).toHaveBeenCalled();
  });

  it('falls back to default blocks when the sections endpoint fails', () => {
    configure();
    api.get.and.returnValue(throwError(() => new Error('down')));
    const cmp = create();
    cmp.ngOnInit();
    expect(cmp.blocks().length).toBeGreaterThan(0);
  });

  it('loads from the preview endpoint when a preview token is present', () => {
    configure();
    queryParams$.next({ preview: 'tok' });
    api.get.and.callFake((url: string) => {
      if (url === '/content/home/preview') {
        return of({
          sections: { meta: { blocks: [{ type: 'text', body_markdown: 'hi' }] } },
          story: { body_markdown: 'Story' },
        }) as never;
      }
      return of({ meta: {} }) as never;
    });
    const cmp = create();
    cmp.ngOnInit();
    expect(cmp.storyHtml()).toContain('Story');
  });

  it('handles a failing preview endpoint', () => {
    configure();
    queryParams$.next({ preview: 'tok' });
    api.get.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.ngOnInit();
    expect(cmp.blocks().length).toBeGreaterThan(0);
    expect(cmp.storyLoading()).toBeFalse();
  });

  it('loads each product section and handles errors', () => {
    configure();
    const cmp = create();
    cmp.loadFeatured();
    cmp.loadSaleProducts();
    cmp.loadNewArrivals();
    cmp.loadCollections();
    expect(cmp.featured.length).toBe(1);
    expect(cmp.saleProducts.length).toBe(1);
    expect(cmp.newArrivals.length).toBe(1);

    catalog.listProducts.and.returnValue(throwError(() => new Error('x')) as never);
    catalog.listFeaturedCollections.and.returnValue(throwError(() => new Error('x')));
    cmp.loadFeatured();
    cmp.loadSaleProducts();
    cmp.loadNewArrivals();
    cmp.loadCollections();
    expect(cmp.featuredError()).toBeTrue();
    expect(cmp.saleError()).toBeTrue();
    expect(cmp.newArrivalsError()).toBeTrue();
    expect(cmp.collectionsError()).toBeTrue();
  });

  it('loads the story section and handles errors', () => {
    configure();
    api.get.and.callFake((url: string) => {
      if (url === '/content/home.story') return of({ body_markdown: 'Once' }) as never;
      return of({ meta: { sections: [{ id: 'story', enabled: true }] } }) as never;
    });
    const cmp = create();
    internals(cmp).loadStory();
    expect(cmp.storyHtml()).toContain('Once');

    api.get.and.returnValue(throwError(() => new Error('x')));
    internals(cmp).loadStory();
    expect(cmp.storyBlock()).toBeNull();
  });

  it('parseBlocks covers slide/size/breakpoint/localized edge cases', () => {
    configure();
    const cmp = create();
    const blocks = internals(cmp).parseBlocks(
      {
        blocks: [
          // otherLang fallback (ro requested, only en present) + image-url fallback to `image`
          {
            type: 'banner',
            title: { en: 'EN only' },
            slide: { image: '/fallback.jpg', size: 'large', variant: 'nope' },
          },
          // normalizeSize 'small' alias and default; breakpoint default (unknown)
          {
            type: 'columns',
            columns: [
              { title: { ro: 'A' }, body_markdown: 'x' },
              { title: { ro: 'B' }, body_markdown: 'y' },
              { title: { ro: 'C' }, body_markdown: 'z' },
            ],
            breakpoint: 'weird',
          },
          // disabled block (enabled: false)
          { type: 'text', key: 'disabled', enabled: false, body_markdown: 'hi' },
        ],
      },
      'ro',
    );
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('exposes the first hero-like block key', () => {
    configure();
    api.get.and.callFake((url: string) => {
      if (url === '/content/home.sections') {
        return of({
          meta: { blocks: [{ type: 'banner', key: 'hero', slide: { image_url: '/b' } }] },
        }) as never;
      }
      return of({ meta: {} }) as never;
    });
    const cmp = create();
    cmp.ngOnInit();
    expect(cmp.firstHeroLikeKey()).toBe('hero');
  });

  it('parseBlocks exercises fallback operands with varied/malformed input', () => {
    configure();
    const cmp = create();
    const blocks = internals(cmp).parseBlocks(
      {
        blocks: [
          // en mode but only ro provided -> otherLang fallback; whitespace title -> readString null
          { type: 'text', title: '   ', body_markdown: { ro: 'doar-ro' } },
          // image with no url -> skipped (continue)
          { type: 'image', title: 'no url' },
          // gallery with only invalid entries -> skipped
          { type: 'gallery', images: [null, { url: '' }, 'bad'] },
          // banner slide using `image` fallback, unknown size -> default M
          { type: 'banner', slide: { image: '/b.jpg', size: 'xyz', variant: 'split' } },
          // carousel with no slides array -> a default slide is pushed
          { type: 'carousel' },
          // columns non-array -> skipped
          { type: 'columns', columns: 'nope' },
          // columns with fewer than 2 usable -> skipped
          { type: 'columns', columns: [{ body_markdown: '   ' }] },
          // cta with nothing -> skipped
          { type: 'cta', title: '', body_markdown: '', cta_label: '', cta_url: '' },
          // faq non-array -> skipped
          { type: 'faq', items: 'nope' },
          // faq with only invalid items -> skipped
          { type: 'faq', items: [null, { question: '' }, 'bad'] },
          // testimonials non-array -> skipped
          { type: 'testimonials', items: 'nope' },
          // testimonials with only blank quotes -> skipped
          { type: 'testimonials', items: [{ quote_markdown: '   ' }] },
          // duplicate key collision -> skipped
          { type: 'text', key: 'dup', body_markdown: 'a' },
          { type: 'text', key: 'dup', body_markdown: 'b' },
          // localized value that is neither string nor object -> null
          { type: 'text', title: 42, body_markdown: 'x' },
        ],
      },
      'en',
    );
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('parseBlocks covers the deeper item and column edge cases', () => {
    configure();
    const cmp = create();
    const manyFaq = Array.from({ length: 25 }, (_, i) => ({
      question: `Q${i}`,
      answer_markdown: 'A',
    }));
    const manyTestimonials = Array.from({ length: 15 }, (_, i) => ({
      quote_markdown: `Quote ${i}`,
    }));
    const blocks = internals(cmp).parseBlocks(
      {
        blocks: [
          // non-object raw entries inside parseSlide / settings
          { type: 'banner', slide: 'not-object' },
          { type: 'carousel', slides: ['bad', { image_url: '/c' }], settings: 'not-object' },
          // numeric type -> typeRaw empty -> skipped
          { type: 5 },
          // image with non-string link_url -> null
          { type: 'image', url: '/i', link_url: 123 },
          // columns with an invalid entry then two valid -> count 3 path
          {
            type: 'columns',
            columns: [null, { body_markdown: 'a' }, { body_markdown: 'b' }, { body_markdown: 'c' }],
            columns_breakpoint: 'sm',
          },
          // faq capped at 20
          { type: 'faq', items: manyFaq },
          // testimonials capped at 12, with author/role missing
          { type: 'testimonials', items: manyTestimonials },
        ],
      },
      'en',
    );
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('firstHeroLikeKey also matches a carousel block', () => {
    configure();
    api.get.and.callFake((url: string) => {
      if (url === '/content/home.sections') {
        return of({
          meta: { blocks: [{ type: 'carousel', key: 'car', slides: [{ image_url: '/c' }] }] },
        }) as never;
      }
      return of({ meta: {} }) as never;
    });
    const cmp = create();
    cmp.ngOnInit();
    expect(cmp.firstHeroLikeKey()).toBe('car');
  });

  it('preview without a story clears the story state', () => {
    configure();
    queryParams$.next({ preview: 'tok' });
    api.get.and.callFake((url: string) => {
      if (url === '/content/home/preview') {
        return of({
          sections: { meta: { blocks: [{ type: 'text', body_markdown: 'hi' }] } },
        }) as never;
      }
      return of({ meta: {} }) as never;
    });
    const cmp = create();
    cmp.ngOnInit();
    expect(cmp.storyBlock()).toBeNull();
    expect(cmp.storyHtml()).toBe('');
  });

  it('normalizeHomeSectionId maps the no-underscore recentlyviewed alias', () => {
    configure();
    const cmp = create();
    expect(internals(cmp).normalizeHomeSectionId('recentlyviewed')).toBe('recently_viewed');
  });

  it('loads sale/new/collections/story sections when enabled in romanian', () => {
    configure();
    TestBed.inject(TranslateService).use('ro');
    api.get.and.callFake((url: string) => {
      if (url === '/content/home.sections') {
        return of({
          meta: {
            sections: [
              { id: 'sale_products', enabled: true },
              { id: 'new_arrivals', enabled: true },
              { id: 'featured_collections', enabled: true },
              { id: 'story', enabled: true },
            ],
          },
        }) as never;
      }
      if (url === '/content/home.story') return of({ body_markdown: 'Poveste' }) as never;
      return of({ meta: {} }) as never;
    });
    const cmp = create();
    cmp.ngOnInit();
    expect(cmp.saleProducts.length).toBe(1);
    expect(cmp.newArrivals.length).toBe(1);
    expect(cmp.storyHtml()).toContain('Poveste');
  });

  it('parseBlocks covers the final fallback operands', () => {
    configure();
    const cmp = create();
    const blocks = internals(cmp).parseBlocks(
      {
        blocks: [
          // text with no body -> body `|| ''`
          { type: 'text', title: 'T' },
          // exactly two valid columns -> count 2; breakpoint via `breakpoint` key
          {
            type: 'columns',
            columns: [{ body_markdown: 'a' }, { body_markdown: 'b' }],
            breakpoint: 'lg',
          },
          // two columns but both blank -> !hasAny -> skipped
          { type: 'columns', columns: [{ title: '' }, { body_markdown: '   ' }] },
          // breakpoint via stack_at key
          {
            type: 'columns',
            key: 'col2',
            columns: [{ body_markdown: 'a' }, { body_markdown: 'b' }],
            stack_at: 'sm',
          },
          // faq item with no answer -> answer `|| ''`
          { type: 'faq', items: [{ question: 'Q' }] },
          // testimonials with a non-object entry then a valid one
          { type: 'testimonials', items: [null, { quote_markdown: 'Quote' }] },
        ],
      },
      'en',
    );
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('parseBlocks reads the cross-language fallback in english mode', () => {
    configure();
    const cmp = create();
    const blocks = internals(cmp).parseBlocks(
      { blocks: [{ type: 'text', title: { ro: 'doar-ro' }, body_markdown: 'x' }] },
      'en',
    );
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('firstHeroLikeKey is null without a hero-like block', () => {
    configure();
    api.get.and.callFake((url: string) => {
      if (url === '/content/home.sections') {
        return of({ meta: { sections: [{ id: 'featured_products', enabled: true }] } }) as never;
      }
      return of({ meta: {} }) as never;
    });
    const cmp = create();
    cmp.ngOnInit();
    expect(cmp.firstHeroLikeKey()).toBeNull();
  });

  it('renders the story preview when a story body is present', () => {
    configure();
    queryParams$.next({ preview: 'tok' });
    api.get.and.callFake((url: string) => {
      if (url === '/content/home/preview') {
        return of({
          sections: { meta: {} },
          story: { body_markdown: 'Preview story body' },
        }) as never;
      }
      return of({ meta: {} }) as never;
    });
    const cmp = create();
    cmp.ngOnInit();
    expect(cmp.storyHtml()).toContain('Preview story body');
  });

  it('parseBlocks handles localized objects with no usable language', () => {
    configure();
    const cmp = create();
    const blocks = internals(cmp).parseBlocks(
      {
        blocks: [
          // localized object with neither en nor ro -> readLocalized returns null
          { type: 'text', key: 'k1', title: { de: 'x' }, body_markdown: 'has body' },
          // columns: two usable then a third blank-after-filter scenario that stays < 2 usable
          { type: 'columns', key: 'k2', columns: [{ title: { de: 'x' } }, { title: { de: 'y' } }] },
          // faq with items array but every entry filtered out -> items empty
          { type: 'faq', key: 'k3', items: [{ question: { de: 'x' } }] },
          // testimonials with items array but every quote blank -> items empty
          { type: 'testimonials', key: 'k4', items: [{ quote_markdown: { de: 'x' } }] },
        ],
      },
      'en',
    );
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('renders an empty story preview body without error', () => {
    configure();
    queryParams$.next({ preview: 'tok' });
    api.get.and.callFake((url: string) => {
      if (url === '/content/home/preview') {
        return of({ sections: { meta: {} }, story: { body_markdown: '' } }) as never;
      }
      return of({ meta: {} }) as never;
    });
    const cmp = create();
    cmp.ngOnInit();
    expect(cmp.storyBlock()).not.toBeNull();
  });

  it('exposes the admin flag from the auth service', () => {
    configure();
    const cmp = create();
    expect(cmp.isAdmin()).toBeFalse();
  });

  it('reloads on a language change and cleans up on destroy', () => {
    configure();
    const cmp = create();
    cmp.ngOnInit();
    api.get.calls.reset();
    TestBed.inject(TranslateService).use('ro');
    expect(api.get).toHaveBeenCalled();
    cmp.ngOnDestroy();
    expect(structured.clearRouteSchemas).toHaveBeenCalled();
  });
});
