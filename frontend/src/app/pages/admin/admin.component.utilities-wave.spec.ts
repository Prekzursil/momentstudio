import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { AdminComponent } from './admin.component';

type AdminSpy = jasmine.SpyObj<any>;

function createComponent(): { component: AdminComponent; admin: AdminSpy; toast: jasmine.SpyObj<any> } {
  const route = {
    snapshot: { data: { section: 'home' }, queryParams: {} },
    data: of({ section: 'home' }),
    queryParams: of({})
  } as unknown as ActivatedRoute;

  const admin = jasmine.createSpyObj('AdminService', [
    'content',
    'products',
    'coupons',
    'lowStock',
    'getContent',
    'updateCategory',
    'updateContentBlock',
    'createContent',
    'getCategories',
    'listFeaturedCollections',
    'setMaintenance'
  ]);
  admin.content.and.returnValue(of([]));
  admin.products.and.returnValue(of([]));
  admin.coupons.and.returnValue(of([]));
  admin.lowStock.and.returnValue(of([]));
  admin.getContent.and.returnValue(of({ title: '', body_markdown: '', meta: {} }));
  admin.updateContentBlock.and.returnValue(of({ id: 'home.sections', meta: {} }));
  admin.createContent.and.returnValue(of({ id: 'home.sections', meta: {} }));
  admin.getCategories.and.returnValue(of([]));
  admin.listFeaturedCollections.and.returnValue(of([]));
  admin.setMaintenance.and.returnValue(of({ enabled: false }));

  const auth = {
    role: jasmine.createSpy('role').and.returnValue('owner'),
    user: jasmine.createSpy('user').and.returnValue({ id: 'u-admin' })
  };

  const cmsPrefs = {
    mode: jasmine.createSpy('mode').and.returnValue('basic'),
    previewDevice: jasmine.createSpy('previewDevice').and.returnValue('desktop'),
    previewLayout: jasmine.createSpy('previewLayout').and.returnValue('split')
  };

  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);

  const component = new AdminComponent(
    route,
    admin as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    auth as any,
    cmsPrefs as any,
    toast as any,
    { currentLang: 'en', instant: (key: string) => key } as any,
    { render: (value: string) => value } as any,
    {
      bypassSecurityTrustHtml: (value: string) => value,
      bypassSecurityTrustResourceUrl: (value: string) => value
    } as unknown as DomSanitizer
  );

  component.homeBlocks = [];
  component.newHomeBlockType = 'text';

  return { component, admin, toast };
}

describe('AdminComponent utility coverage wave', () => {
  it('sanitizes and normalizes keys and statuses', () => {
    const { component } = createComponent();

    expect((component as any).safePageRecordKey('page.about')).toBe('page.about');
    expect((component as any).safePageRecordKey('page.__proto__')).toBe('page.about');

    expect((component as any).safeRecordKey('valid.key')).toBe('valid.key');
    expect((component as any).safeRecordKey('__proto__', 'fallback')).toBe('fallback');

    expect((component as any).normalizeContentStatus('published')).toBe('published');
    expect((component as any).normalizeContentStatus('review')).toBe('review');
    expect((component as any).normalizeContentStatus('anything')).toBe('draft');

    const record = { keep: 'x', danger: 'y' } as Record<string, unknown>;
    (component as any).deleteRecordValue(record, 'danger');
    expect(record['danger']).toBeUndefined();
  });

  it('converts records and localized values safely', () => {
    const { component } = createComponent();

    expect((component as any).toRecord(null)).toEqual({});
    expect((component as any).toRecord([])).toEqual({});
    expect((component as any).toRecord({ ok: true })).toEqual({ ok: true });

    expect((component as any).toLocalizedText(' text ')).toEqual({ en: 'text', ro: 'text' });
    expect((component as any).toLocalizedText({ en: ' Hello ', ro: 3 })).toEqual({ en: 'Hello', ro: '' });
    expect((component as any).emptyLocalizedText()).toEqual({ en: '', ro: '' });
  });

  it('coerces focal, boolean and layout helpers', () => {
    const { component } = createComponent();

    expect((component as any).toFocalValue('105')).toBe(100);
    expect((component as any).toFocalValue('-5')).toBe(0);
    expect((component as any).toFocalValue('x', 33)).toBe(33);

    expect((component as any).toBooleanValue('yes')).toBeTrue();
    expect((component as any).toBooleanValue('off', true)).toBeFalse();
    expect((component as any).toBooleanValue('unknown', true)).toBeTrue();

    expect((component as any).defaultCmsBlockLayout()).toEqual({
      spacing: 'none',
      background: 'none',
      align: 'left',
      max_width: 'full'
    });

    expect((component as any).toCmsBlockLayout({ spacing: 'md', background: 'accent', align: 'center', max_width: 'wide' })).toEqual({
      spacing: 'md',
      background: 'accent',
      align: 'center',
      max_width: 'wide'
    });

    expect(component.focalPosition('44', '55')).toBe('44% 55%');
  });

  it('builds slide drafts and preview projections', () => {
    const { component } = createComponent();

    const slide = (component as any).toSlideDraft({
      image: ' /img.jpg ',
      alt: { en: 'Alt EN' },
      headline: { ro: 'Titlu RO' },
      cta_label: { en: 'Open' },
      cta_url: ' /go ',
      variant: 'full',
      size: 'L',
      text_style: 'light',
      focal_x: 77,
      focal_y: 20
    });

    expect(slide.image_url).toBe('/img.jpg');
    expect(slide.variant).toBe('full');
    expect(slide.size).toBe('L');
    expect(slide.text_style).toBe('light');

    const serialized = (component as any).serializeSlideDraft(slide);
    expect(serialized['image_url']).toBe('/img.jpg');
    expect(serialized['focal_x']).toBe(77);

    const previewRo = component.toPreviewSlide(slide, 'ro');
    expect(previewRo.headline).toBe('Titlu RO');
    expect(previewRo.alt).toBe('Alt EN');

    const previewAll = component.toPreviewSlides([slide], 'en');
    expect(previewAll.length).toBe(1);
    expect(previewAll[0].cta_label).toBe('Open');
  });

  it('normalizes home section ids and provides defaults', () => {
    const { component } = createComponent();

    expect((component as any).normalizeHomeSectionId('featuredProducts')).toBe('featured_products');
    expect((component as any).normalizeHomeSectionId('sales')).toBe('sale_products');
    expect((component as any).normalizeHomeSectionId('collections')).toBe('featured_collections');
    expect((component as any).normalizeHomeSectionId('invalid')).toBeNull();

    const defaults = (component as any).defaultHomeSections();
    expect(defaults.some((entry: any) => entry.id === 'featured_products')).toBeTrue();
    expect(defaults.some((entry: any) => entry.id === 'why')).toBeTrue();
  });

  it('creates block drafts and ensures all built-ins are present', () => {
    const { component } = createComponent();

    const custom = (component as any).makeHomeBlockDraft('text-1', 'text', true);
    expect(custom.type).toBe('text');
    expect(custom.columns.length).toBe(2);

    const ensured = (component as any).ensureAllDefaultHomeBlocks([custom]);
    expect(ensured.length).toBeGreaterThan(1);
    expect(ensured.some((block: any) => block.type === 'featured_products')).toBeTrue();
  });

  it('derives sections from meta and order while deduplicating', () => {
    const { component } = createComponent();

    const derivedMeta = (component as any).deriveHomeSectionsFromMeta([
      { id: 'featured', enabled: true },
      { id: 'featured', enabled: false },
      { id: 'new', enabled: true },
      { id: 'bad', enabled: true }
    ]);
    expect(derivedMeta.map((b: any) => b.type)).toEqual(['featured_products', 'new_arrivals']);

    const derivedOrder = (component as any).deriveHomeSectionsFromOrder(['sale', 'sale', 'recent']);
    expect(derivedOrder.map((b: any) => b.type)).toEqual(['sale_products', 'recently_viewed']);
  });

  it('parses configured blocks for built-in and custom types', () => {
    const { component } = createComponent();

    const parsed = (component as any).parseConfiguredHomeBlocks([
      { type: 'featured_products', enabled: true },
      {
        type: 'columns',
        key: 'columns-1',
        enabled: true,
        title: { en: 'Columns' },
        columns: [
          { title: { en: 'A' }, body_markdown: { en: 'a' } },
          { title: { en: 'B' }, body_markdown: { en: 'b' } }
        ],
        columns_breakpoint: 'lg'
      }
    ]);

    expect(parsed.length).toBe(2);
    expect(parsed[0].type).toBe('featured_products');
    expect(parsed[1].type).toBe('columns');
    expect(parsed[1].columns_breakpoint).toBe('lg');
  });

  it('hydrates custom configured block variants', () => {
    const { component } = createComponent();

    const parsed = (component as any).parseConfiguredHomeBlocks([
      { type: 'cta', key: 'cta-1', cta_url: '/cta', cta_new_tab: 'true', cta_label: { en: 'Go' } },
      {
        type: 'faq',
        key: 'faq-1',
        items: [{ question: { en: 'Q?' }, answer_markdown: { en: 'A.' } }]
      },
      {
        type: 'testimonials',
        key: 't-1',
        items: [{ quote_markdown: { en: 'Nice' }, author: { en: 'X' }, role: { en: 'Y' } }]
      },
      {
        type: 'image',
        key: 'img-1',
        url: '/image.jpg',
        link_url: '/go',
        focal_x: 9,
        focal_y: 91
      },
      {
        type: 'gallery',
        key: 'gallery-1',
        images: [{ url: '/g1.jpg', focal_x: 10, focal_y: 20 }]
      },
      { type: 'banner', key: 'banner-1', slide: { image_url: '/banner.jpg' } },
      {
        type: 'carousel',
        key: 'carousel-1',
        slides: [{ image_url: '/slide.jpg', focal_x: 12, focal_y: 88 }],
        settings: { autoplay: true, interval_ms: 1000, show_dots: false, pause_on_hover: false }
      }
    ]);

    expect(parsed.some((b: any) => b.type === 'cta' && b.cta_url === '/cta')).toBeTrue();
    expect(parsed.some((b: any) => b.type === 'faq' && b.faq_items.length === 1)).toBeTrue();
    expect(parsed.some((b: any) => b.type === 'testimonials' && b.testimonials.length === 1)).toBeTrue();
    expect(parsed.some((b: any) => b.type === 'image' && b.url === '/image.jpg')).toBeTrue();
    expect(parsed.some((b: any) => b.type === 'gallery' && b.images.length === 1)).toBeTrue();
    expect(parsed.some((b: any) => b.type === 'banner' && b.slide.image_url === '/banner.jpg')).toBeTrue();
    expect(parsed.some((b: any) => b.type === 'carousel' && b.slides.length === 1)).toBeTrue();
  });

  it('builds section metadata for text and visual block types', () => {
    const { component } = createComponent();

    const text = (component as any).makeHomeBlockDraft('text-1', 'text', true);
    text.title = { en: 'Title', ro: '' };
    text.body_markdown = { en: 'Body', ro: '' };

    const image = (component as any).makeHomeBlockDraft('image-1', 'image', true);
    image.url = '/image.jpg';
    image.focal_x = 60;
    image.focal_y = 40;

    const carousel = (component as any).makeHomeBlockDraft('carousel-1', 'carousel', true);
    carousel.slides = [(component as any).toSlideDraft({ image_url: '/slide.jpg' })];

    const textMeta = (component as any).buildHomeSectionBlockMeta(text);
    const imageMeta = (component as any).buildHomeSectionBlockMeta(image);
    const carouselMeta = (component as any).buildHomeSectionBlockMeta(carousel);

    expect(textMeta['body_markdown']).toEqual({ en: 'Body', ro: '' });
    expect(imageMeta['url']).toBe('/image.jpg');
    expect(Array.isArray(carouselMeta['slides'])).toBeTrue();
  });

  it('toggles and reorders home blocks', () => {
    const { component } = createComponent();

    component.homeBlocks = [
      (component as any).makeHomeBlockDraft('a', 'text', true),
      (component as any).makeHomeBlockDraft('b', 'columns', true),
      (component as any).makeHomeBlockDraft('c', 'faq', true)
    ];

    component.toggleHomeBlockEnabled(component.homeBlocks[0] as any, { target: { checked: false } } as any);
    expect(component.homeBlocks[0].enabled).toBeFalse();

    component.moveHomeBlock('c', -2);
    expect(component.homeBlocks[0].key).toBe('c');

    component.setHomeInsertDragActive(true);
    expect(component.homeInsertDragActive).toBeTrue();

    component.removeHomeBlock('c');
    expect(component.homeBlocks.some((block) => block.key === 'c')).toBeFalse();
  });

  it('manages home block item collections and carousel edges', () => {
    const { component } = createComponent();

    const gallery = (component as any).makeHomeBlockDraft('gallery-1', 'gallery', true);
    const columns = (component as any).makeHomeBlockDraft('cols-1', 'columns', true);
    const faq = (component as any).makeHomeBlockDraft('faq-1', 'faq', true);
    const testimonials = (component as any).makeHomeBlockDraft('test-1', 'testimonials', true);
    const carousel = (component as any).makeHomeBlockDraft('car-1', 'carousel', true);
    carousel.slides = [
      (component as any).toSlideDraft({ image_url: '/1.jpg' }),
      (component as any).toSlideDraft({ image_url: '/2.jpg' })
    ];

    component.homeBlocks = [gallery, columns, faq, testimonials, carousel] as any;

    component.addGalleryImage('gallery-1');
    component.removeGalleryImage('gallery-1', 0);

    component.addHomeColumnsColumn('cols-1');
    component.removeHomeColumnsColumn('cols-1', 2);

    component.addHomeFaqItem('faq-1');
    component.removeHomeFaqItem('faq-1', 1);

    component.addHomeTestimonial('test-1');
    component.removeHomeTestimonial('test-1', 1);

    component.addCarouselSlide('car-1');
    component.moveCarouselSlide('car-1', 0, 1);
    component.removeCarouselSlide('car-1', 1);

    const updated = component.homeBlocks.find((block) => block.key === 'car-1') as any;
    expect(updated.slides.length).toBeGreaterThan(0);
  });

  it('applies media assets to image, gallery, banner and carousel blocks', () => {
    const { component, toast } = createComponent();

    const image = (component as any).makeHomeBlockDraft('image-1', 'image', true);
    const gallery = (component as any).makeHomeBlockDraft('gallery-1', 'gallery', true);
    const banner = (component as any).makeHomeBlockDraft('banner-1', 'banner', true);
    const carousel = (component as any).makeHomeBlockDraft('carousel-1', 'carousel', true);
    component.homeBlocks = [image, gallery, banner, carousel] as any;

    const asset = { url: ' /asset.jpg ', focal_x: 12, focal_y: 77 } as any;

    component.setImageBlockUrl('image-1', asset);
    component.addGalleryImageFromAsset('gallery-1', asset);
    component.setBannerSlideImage('banner-1', asset);
    component.setCarouselSlideImage('carousel-1', 0, asset);

    expect(toast.success).toHaveBeenCalled();

    const updatedImage = component.homeBlocks.find((block) => block.key === 'image-1') as any;
    const updatedGallery = component.homeBlocks.find((block) => block.key === 'gallery-1') as any;
    const updatedBanner = component.homeBlocks.find((block) => block.key === 'banner-1') as any;
    const updatedCarousel = component.homeBlocks.find((block) => block.key === 'carousel-1') as any;

    expect(updatedImage.url).toBe('/asset.jpg');
    expect(updatedGallery.images[0].url).toBe('/asset.jpg');
    expect(updatedBanner.slide.image_url).toBe('/asset.jpg');
    expect(updatedCarousel.slides[0].image_url).toBe('/asset.jpg');
  });

  it('supports drag and drop reordering branches', () => {
    const { component } = createComponent();

    component.homeBlocks = [
      (component as any).makeHomeBlockDraft('a', 'text', true),
      (component as any).makeHomeBlockDraft('b', 'columns', true),
      (component as any).makeHomeBlockDraft('c', 'faq', true)
    ];

    component.onHomeBlockDragStart('a');
    component.onHomeBlockDropZone({ preventDefault: () => undefined } as DragEvent, 3);
    expect(component.homeBlocks[1].key).toBe('c');
    expect(component.homeBlocks[2].key).toBe('a');

    component.onHomeBlockDragStart('b');
    spyOn(component as any, 'extractCmsImageFiles').and.returnValue([]);
    spyOn(component as any, 'readCmsBlockPayload').and.returnValue(null);
    component.onHomeBlockDrop({ preventDefault: () => undefined } as DragEvent, 'c');

    expect(component.draggingHomeBlockKey).toBeNull();
    expect(component.homeInsertDragActive).toBeFalse();
  });

  it('inserts blocks from drag payload and from add helpers', () => {
    const { component } = createComponent();

    component.homeBlocks = [(component as any).makeHomeBlockDraft('x', 'text', true)] as any;
    (component as any).insertHomeBlockAt('cta', 0, 'starter');
    component.addHomeBlockFromLibrary('image', 'blank');
    component.addHomeBlock();

    const types = component.homeBlocks.map((block) => block.type);
    expect(types).toContain('cta');
    expect(types).toContain('image');
    expect(types).toContain(component.newHomeBlockType);
  });

  it('handles saveSections success and 404 fallback branches', () => {
    const { component, admin } = createComponent();

    component.homeBlocks = [
      (component as any).makeHomeBlockDraft('featured_products', 'featured_products', true),
      (component as any).makeHomeBlockDraft('story', 'story', false),
      (component as any).makeHomeBlockDraft('text-1', 'text', true)
    ] as any;

    spyOn(component as any, 'withExpectedVersion').and.callFake((_key: string, payload: any) => payload);
    spyOn(component as any, 'handleContentConflict').and.returnValue(false);
    spyOn(component as any, 'refreshHomePreview').and.stub();

    admin.updateContentBlock.and.returnValue(of({ meta: { version: 3 } }));
    component.saveSections();
    expect(admin.updateContentBlock).toHaveBeenCalled();

    admin.updateContentBlock.and.returnValue(
      ({
        subscribe: (observer: any) => observer.error({ status: 404 })
      }) as any
    );
    admin.createContent.and.returnValue(
      ({
        subscribe: (observer: any) => observer.next({ meta: { version: 4 } })
      }) as any
    );

    component.saveSections();
    expect(admin.createContent).toHaveBeenCalled();
  });
});
