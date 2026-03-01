import { of, throwError } from 'rxjs';

import { HomeComponent } from './home.component';

const RICH_BLOCK_PAYLOAD = {
  blocks: [
    { type: 'text', key: 'intro', title: { en: 'Intro' }, body_markdown: { en: 'Body' }, enabled: true },
    {
      type: 'image',
      key: 'hero-image',
      title: { en: 'Hero' },
      url: 'https://cdn.example/hero.jpg',
      alt: { en: 'Hero alt' },
      caption: { ro: 'Legenda' },
      focal_x: '80',
      focal_y: '-20',
    },
    {
      type: 'gallery',
      key: 'gallery-main',
      images: [{ url: 'https://cdn.example/1.jpg', alt: { en: 'One' }, focal_x: 40, focal_y: 60 }, { url: '   ' }],
    },
    {
      type: 'banner',
      key: 'hero-banner',
      slide: { image: '/hero.webp', headline: { en: 'Head' }, size: 'large', text_style: 'light' },
    },
    {
      type: 'carousel',
      key: 'hero-carousel',
      slides: [{ image_url: '/slide-1.webp', subheadline: { en: 'Sub' }, variant: 'full', focal_x: '10', focal_y: '95' }],
      settings: { autoplay: 'yes', interval_ms: '1200', show_dots: '0', show_arrows: '1', pause_on_hover: 'off' },
    },
    {
      type: 'columns',
      key: 'three-cols',
      columns: [
        { title: { en: 'A' }, body_markdown: { en: 'MA' } },
        { title: { en: 'B' }, body_markdown: { en: 'MB' } },
        { title: { en: 'C' }, body_markdown: { en: 'MC' } },
      ],
      breakpoint: 'lg',
    },
    { type: 'cta', key: 'cta-1', title: { en: 'Shop now' }, cta_url: '/shop', cta_new_tab: 'true' },
    { type: 'faq', key: 'faq-1', items: [{ question: { en: 'Q1' }, answer_markdown: { en: 'A1' } }] },
    { type: 'testimonials', key: 'test-1', items: [{ quote_markdown: { en: 'Quote' }, author: { en: 'A' } }] },
    { type: 'sales', key: 'sales-section', enabled: false },
    { type: 'featured_products', key: 'sales-section', enabled: true },
  ],
};

function parseRichBlocks(component: HomeComponent) {
  return (component as any).parseBlocks(RICH_BLOCK_PAYLOAD as any, 'en');
}

function blocksByKey(blocks: any[]) {
  return new Map<string, any>(blocks.map((block: any) => [block.key, block]));
}

function createComponent() {
  const catalog = jasmine.createSpyObj('CatalogService', ['listProducts', 'listFeaturedCollections']);
  const recentlyViewedService = jasmine.createSpyObj('RecentlyViewedService', ['list']);
  const title = jasmine.createSpyObj('Title', ['setTitle']);
  const meta = jasmine.createSpyObj('Meta', ['updateTag']);
  const seoHeadLinks = jasmine.createSpyObj('SeoHeadLinksService', ['setLocalizedCanonical']);
  const structuredData = jasmine.createSpyObj('StructuredDataService', ['setRouteSchemas', 'clearRouteSchemas']);
  const auth = jasmine.createSpyObj('AuthService', ['isAdmin']);
  const api = jasmine.createSpyObj('ApiService', ['get']);
  const markdown = jasmine.createSpyObj('MarkdownService', ['render']);

  const translate = {
    currentLang: 'en',
    instant: (key: string) => key,
    onLangChange: {
      subscribe: () => ({ unsubscribe: () => undefined }),
    },
  };
  const route = {
    queryParams: {
      subscribe: () => ({ unsubscribe: () => undefined }),
    },
  };

  auth.isAdmin.and.returnValue(false);
  recentlyViewedService.list.and.returnValue([]);
  catalog.listProducts.and.returnValue(of({ items: [], meta: {} } as any));
  catalog.listFeaturedCollections.and.returnValue(of([]));
  api.get.and.returnValue(of({ title: '', body_markdown: '', meta: {}, images: [] } as any));
  markdown.render.and.callFake((value: string) => `<p>${value}</p>`);
  seoHeadLinks.setLocalizedCanonical.and.returnValue('https://example.test/');

  const component = new HomeComponent(
    catalog as any,
    recentlyViewedService as any,
    title as any,
    meta as any,
    seoHeadLinks as any,
    structuredData as any,
    translate as any,
    auth as any,
    route as any,
    api as any,
    markdown as any
  );

  return { component, catalog, api, markdown };
}

describe('HomeComponent coverage wave 1', () => {
  it('parses localized text and media blocks', () => {
    const { component, markdown } = createComponent();
    const byKey = blocksByKey(parseRichBlocks(component));
    const intro = byKey.get('intro');
    const heroImage = byKey.get('hero-image');
    const gallery = byKey.get('gallery-main');

    expect(intro.type).toBe('text');
    expect(heroImage.focal_x).toBe(80);
    expect(heroImage.focal_y).toBe(0);
    expect(gallery.images.length).toBe(1);
    expect(heroImage.alt).toBe('Hero alt');
    expect(markdown.render).toHaveBeenCalled();
  });

  it('parses banner and carousel metadata with aliases', () => {
    const { component } = createComponent();
    const byKey = blocksByKey(parseRichBlocks(component));
    const heroBanner = byKey.get('hero-banner');
    const heroCarousel = byKey.get('hero-carousel');
    const threeColumns = byKey.get('three-cols');
    const salesAlias = byKey.get('sales-section');

    expect(heroBanner.slide.size).toBe('L');
    expect(heroCarousel.settings.autoplay).toBeTrue();
    expect(heroCarousel.settings.show_dots).toBeFalse();
    expect(threeColumns.columns_count).toBe(3);
    expect(salesAlias.type).toBe('sale_products');
  });

  it('parses CTA, FAQ, and testimonials blocks', () => {
    const { component } = createComponent();
    const byKey = blocksByKey(parseRichBlocks(component));
    const cta = byKey.get('cta-1');
    const faq = byKey.get('faq-1');
    const testimonials = byKey.get('test-1');

    expect(cta.cta_new_tab).toBeTrue();
    expect(faq.items.length).toBe(1);
    expect(testimonials.items.length).toBe(1);
  });

  it('falls back to sections, legacy order, and defaults when blocks are missing', () => {
    const { component } = createComponent();

    const fromSections = (component as any).parseBlocks(
      { sections: [{ id: 'collections', enabled: true }, { id: 'new', enabled: false }, { id: 'collections', enabled: true }] } as any,
      'en'
    );
    expect(fromSections.some((block: any) => block.type === 'featured_collections')).toBeTrue();
    expect(fromSections.some((block: any) => block.type === 'new_arrivals' && block.enabled === false)).toBeTrue();

    const fromLegacyOrder = (component as any).parseBlocks({ order: ['sale', 'recentlyViewed'] } as any, 'en');
    expect(fromLegacyOrder.some((block: any) => block.type === 'sale_products')).toBeTrue();
    expect(fromLegacyOrder.some((block: any) => block.type === 'recently_viewed')).toBeTrue();

    const defaults = (component as any).parseBlocks({} as any, 'en');
    expect(defaults.some((block: any) => block.type === 'featured_products')).toBeTrue();
    expect(defaults.some((block: any) => block.type === 'why')).toBeTrue();
  });

  it('loads preview layout and handles preview API errors', () => {
    const { component, api } = createComponent();
    const loadSectionData = spyOn<any>(component, 'loadSectionData').and.stub();
    (component as any).previewToken = 'preview-token';

    api.get.and.returnValue(
      of({
        sections: { title: '', body_markdown: '', meta: { sections: [{ id: 'featured_products', enabled: true }] }, images: [] },
        story: { title: 'Story', body_markdown: 'Story body', meta: {}, images: [] },
      } as any)
    );
    (component as any).loadLayout();
    expect(component.storyBlock()?.title).toBe('Story');
    expect(component.storyHtml()).toContain('Story body');
    expect(loadSectionData).toHaveBeenCalledWith({ skipStory: true });

    api.get.and.returnValue(throwError(() => new Error('preview-failed')));
    (component as any).loadLayout();
    expect(component.storyBlock()).toBeNull();
    expect(component.storyHtml()).toBe('');
  });

  it('loads non-preview layout and falls back to defaults on API failure', () => {
    const { component, api } = createComponent();
    const loadSectionData = spyOn<any>(component, 'loadSectionData').and.stub();
    (component as any).previewToken = '';

    api.get.and.returnValue(of({ title: '', body_markdown: '', meta: { sections: [{ id: 'featured_products', enabled: true }] }, images: [] } as any));
    (component as any).loadLayout();
    expect(loadSectionData).toHaveBeenCalled();

    api.get.and.returnValue(throwError(() => new Error('sections-failed')));
    (component as any).loadLayout();
    expect(component.blocks().some((block) => block.type === 'featured_products')).toBeTrue();
  });

  it('dispatches enabled section loaders and respects skipStory option', () => {
    const { component } = createComponent();
    const loadFeatured = spyOn(component, 'loadFeatured').and.stub();
    const loadSaleProducts = spyOn(component, 'loadSaleProducts').and.stub();
    const loadNewArrivals = spyOn(component, 'loadNewArrivals').and.stub();
    const loadCollections = spyOn(component, 'loadCollections').and.stub();
    const loadStory = spyOn<any>(component, 'loadStory').and.stub();

    component.blocks.set([
      { key: 'featured_products', type: 'featured_products', enabled: true },
      { key: 'sale_products', type: 'sale_products', enabled: true },
      { key: 'new_arrivals', type: 'new_arrivals', enabled: true },
      { key: 'featured_collections', type: 'featured_collections', enabled: true },
      { key: 'story', type: 'story', enabled: true },
      { key: 'custom', type: 'text' as any, enabled: true },
    ] as any);

    (component as any).loadSectionData({ skipStory: true });
    expect(loadFeatured).toHaveBeenCalled();
    expect(loadSaleProducts).toHaveBeenCalled();
    expect(loadNewArrivals).toHaveBeenCalled();
    expect(loadCollections).toHaveBeenCalled();
    expect(loadStory).not.toHaveBeenCalled();

    (component as any).loadSectionData();
    expect(loadStory).toHaveBeenCalled();
  });

  it('loads product/collection sections and sets error flags on failure', () => {
    const { component, catalog } = createComponent();
    catalog.listProducts.and.returnValue(of({ items: [{ id: 'p1' }], meta: {} } as any));
    catalog.listFeaturedCollections.and.returnValue(of([{ id: 'c1' }] as any));

    component.loadFeatured();
    expect(component.featured.length).toBe(1);
    expect(component.featuredError()).toBeFalse();

    component.loadSaleProducts();
    expect(component.saleProducts.length).toBe(1);
    expect(component.saleError()).toBeFalse();

    component.loadNewArrivals();
    expect(component.newArrivals.length).toBe(1);
    expect(component.newArrivalsError()).toBeFalse();

    component.loadCollections();
    expect(component.featuredCollections.length).toBe(1);
    expect(component.collectionsError()).toBeFalse();

    catalog.listProducts.and.returnValue(throwError(() => new Error('products-failed')));
    component.loadFeatured();
    component.loadSaleProducts();
    component.loadNewArrivals();
    expect(component.featuredError()).toBeTrue();
    expect(component.saleError()).toBeTrue();
    expect(component.newArrivalsError()).toBeTrue();

    catalog.listFeaturedCollections.and.returnValue(throwError(() => new Error('collections-failed')));
    component.loadCollections();
    expect(component.collectionsError()).toBeTrue();
  });

  it('normalizes helpers and utility accessors for block rendering', () => {
    const { component } = createComponent();
    expect(component.focalPosition(150, -20)).toBe('100% 0%');
    expect((component as any).normalizeHomeSectionId('collections')).toBe('featured_collections');
    expect((component as any).normalizeHomeSectionId('recentlyViewed')).toBe('recently_viewed');
    expect((component as any).normalizeHomeSectionId('unknown')).toBeNull();
    expect(component.isExternalHttpUrl(' https://example.test/x ')).toBeTrue();
    expect(component.isExternalHttpUrl('mailto:test@example.test')).toBeFalse();
    expect(component.columnsGridClasses({ columns_count: 3, breakpoint: 'lg' } as any)).toContain('lg:grid-cols-3');

    const textBlock = { type: 'text' } as any;
    const faqBlock = { type: 'faq' } as any;
    expect(component.asTextBlock(textBlock)).toBe(textBlock);
    expect(component.asFaqBlock(faqBlock)).toBe(faqBlock);
    expect(component.asImageBlock(textBlock)).toBeNull();
    expect(component.asTestimonialsBlock(faqBlock)).toBeNull();
  });

  it('computes first hero key from enabled banner/carousel blocks', () => {
    const { component } = createComponent();
    component.blocks.set([
      { key: 'intro', type: 'text', enabled: true },
      { key: 'hero-banner', type: 'banner', enabled: false },
      { key: 'hero-carousel', type: 'carousel', enabled: true },
      { key: 'secondary', type: 'banner', enabled: true },
    ] as any);
    expect(component.firstHeroLikeKey()).toBe('hero-carousel');
  });
});
