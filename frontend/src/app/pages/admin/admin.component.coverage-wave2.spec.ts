import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { AdminComponent } from './admin.component';

type AdminSpy = jasmine.SpyObj<any>;

type ObserverLike<T> = {
  next?: (value: T) => void;
  error?: (err: unknown) => void;
};

function throwErrorSync(err: unknown): { subscribe: (observer: ObserverLike<unknown>) => void } {
  return {
    subscribe: (observer: ObserverLike<unknown>) => {
      if (observer.error) observer.error(err);
    }
  };
}

function createComponent(): {
  component: AdminComponent;
  admin: AdminSpy;
  toast: jasmine.SpyObj<any>;
  translate: { currentLang: string; instant: jasmine.Spy<(key: string, params?: Record<string, unknown>) => string> };
} {
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
    'setMaintenance',
    'listContentRedirects',
    'deleteContentRedirect',
    'exportContentRedirects',
    'importContentRedirects',
    'upsertContentRedirect',
    'linkCheckContentPreview'
  ]);

  admin.content.and.returnValue(of([]));
  admin.products.and.returnValue(of([]));
  admin.coupons.and.returnValue(of([]));
  admin.lowStock.and.returnValue(of([]));
  admin.getContent.and.returnValue(of({ title: '', body_markdown: '', meta: {} }));
  admin.updateContentBlock.and.returnValue(of({ meta: {}, status: 'draft' }));
  admin.createContent.and.returnValue(of({ meta: {}, status: 'draft' }));
  admin.getCategories.and.returnValue(of([]));
  admin.listFeaturedCollections.and.returnValue(of([]));
  admin.setMaintenance.and.returnValue(of({ enabled: false }));
  admin.listContentRedirects.and.returnValue(of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 25 } }));
  admin.deleteContentRedirect.and.returnValue(of({}));
  admin.exportContentRedirects.and.returnValue(of(new Blob(['from,to'])));
  admin.importContentRedirects.and.returnValue(of({ created: 0, updated: 0, skipped: 0, errors: [] }));
  admin.upsertContentRedirect.and.returnValue(of({}));
  admin.linkCheckContentPreview.and.returnValue(of({ issues: [] }));

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
  const translate = {
    currentLang: 'en',
    instant: jasmine.createSpy('instant').and.callFake((key: string) => key)
  };

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
    translate as any,
    { render: (value: string) => value } as any,
    {
      bypassSecurityTrustHtml: (value: string) => value,
      bypassSecurityTrustResourceUrl: (value: string) => value
    } as unknown as DomSanitizer
  );

  return { component, admin, toast, translate };
}

describe('AdminComponent coverage wave 2', () => {
  it('parses checkout settings values from content metadata', () => {
    const { component, admin } = createComponent();

    admin.getContent.and.returnValue(
      of({
        version: 3,
        meta: {
          shipping_fee_ron: '45.5',
          free_shipping_threshold_ron: 'bad-value',
          phone_required_home: 'off',
          phone_required_locker: 1,
          fee_enabled: 'yes',
          fee_type: 'percent',
          fee_value: '-2',
          vat_enabled: 0,
          vat_rate_percent: '101',
          vat_apply_to_shipping: 'on',
          vat_apply_to_fee: '0',
          receipt_share_days: 5000,
          money_rounding: 'half_even'
        }
      })
    );

    component.loadCheckoutSettings();

    expect(component.checkoutSettingsForm.shipping_fee_ron).toBe(45.5);
    expect(component.checkoutSettingsForm.free_shipping_threshold_ron).toBe(300);
    expect(component.checkoutSettingsForm.phone_required_home).toBeFalse();
    expect(component.checkoutSettingsForm.phone_required_locker).toBeTrue();
    expect(component.checkoutSettingsForm.fee_enabled).toBeTrue();
    expect(component.checkoutSettingsForm.fee_type).toBe('percent');
    expect(component.checkoutSettingsForm.fee_value).toBe(0);
    expect(component.checkoutSettingsForm.vat_enabled).toBeFalse();
    expect(component.checkoutSettingsForm.vat_rate_percent).toBe(10);
    expect(component.checkoutSettingsForm.vat_apply_to_shipping).toBeTrue();
    expect(component.checkoutSettingsForm.vat_apply_to_fee).toBeFalse();
    expect(component.checkoutSettingsForm.receipt_share_days).toBe(365);
    expect(component.checkoutSettingsForm.money_rounding).toBe('half_even');
  });

  it('restores checkout setting defaults on load failure', () => {
    const { component, admin } = createComponent();

    admin.getContent.and.returnValue(throwErrorSync({ status: 500 }) as any);
    component.checkoutSettingsForm.shipping_fee_ron = 999;
    component.checkoutSettingsForm.fee_enabled = true;
    (component as any).contentVersions['site.checkout'] = 99;

    component.loadCheckoutSettings();

    expect(component.checkoutSettingsForm).toEqual({
      shipping_fee_ron: 20,
      free_shipping_threshold_ron: 300,
      phone_required_home: true,
      phone_required_locker: true,
      fee_enabled: false,
      fee_type: 'flat',
      fee_value: 0,
      vat_enabled: true,
      vat_rate_percent: 10,
      vat_apply_to_shipping: false,
      vat_apply_to_fee: false,
      receipt_share_days: 365,
      money_rounding: 'half_up'
    });
    expect((component as any).contentVersions['site.checkout']).toBeUndefined();
  });

  it('loads navigation links, supports drag/drop reorder, and persists with 404 create fallback', () => {
    const { component, admin } = createComponent();

    admin.getContent.and.returnValue(
      of({
        version: 11,
        meta: {
          header_links: [
            { id: 'a', url: '/shop', label: { en: 'Shop', ro: 'Magazin' } },
            { id: 'a', url: '/dupe', label: { en: 'Duplicate', ro: 'Duplicat' } },
            { id: '', url: '/contact', label: { en: 'Contact', ro: 'Contact' } },
            { id: 'bad', url: '/broken', label: { en: 'Missing ro', ro: '' } }
          ],
          footer_handcrafted_links: [{ id: 'x', url: '/about', label: { en: 'About', ro: 'Despre' } }],
          footer_legal_links: 'invalid'
        }
      })
    );

    component.loadNavigation();

    expect(component.navigationForm.header_links.map((link) => link.id)).toEqual(['a', 'nav_3']);
    expect(component.navigationForm.footer_handcrafted_links.length).toBe(1);
    expect(component.navigationForm.footer_legal_links.length).toBe(0);

    component.onNavigationDragStart('header', 'a');
    component.onNavigationDrop('header', 'nav_3');
    expect(component.navigationForm.header_links.map((link) => link.id)).toEqual(['nav_3', 'a']);

    const dragEvent = jasmine.createSpyObj<DragEvent>('dragEvent', ['preventDefault']);
    component.onNavigationDragOver(dragEvent);
    expect(dragEvent.preventDefault).toHaveBeenCalled();

    component.onNavigationDragStart('header', 'a');
    component.onNavigationDrop('footer_legal', 'x');
    expect((component as any).draggingNavList).toBeNull();
    expect((component as any).draggingNavId).toBeNull();

    component.navigationForm = {
      header_links: [
        { id: 'a', url: '/shop', label: { en: 'Shop', ro: 'Magazin' } },
        { id: 'a', url: '/dup', label: { en: 'Dup', ro: 'Dublura' } },
        { id: 'blank', url: '', label: { en: '', ro: '' } }
      ],
      footer_handcrafted_links: [{ id: 'b', url: '/about', label: { en: 'About', ro: 'Despre' } }],
      footer_legal_links: [{ id: 'c', url: '/terms', label: { en: 'Terms', ro: 'Termeni' } }]
    };

    admin.updateContentBlock.and.returnValue(throwErrorSync({ status: 404 }) as any);
    admin.createContent.and.returnValue(of({ version: 12, meta: {} }));

    component.saveNavigation();

    expect(admin.updateContentBlock).toHaveBeenCalled();
    expect(admin.createContent).toHaveBeenCalled();
    expect(component.navigationError).toBeNull();
    expect(component.navigationMessage).toBe('adminUi.site.navigation.success.save');
  });

  it('blocks invalid navigation payloads before save', () => {
    const { component, admin } = createComponent();

    component.navigationForm = {
      header_links: [{ id: 'broken', url: '/broken', label: { en: 'Broken', ro: '' } }],
      footer_handcrafted_links: [],
      footer_legal_links: []
    };

    component.saveNavigation();

    expect(component.navigationError).toBe('adminUi.site.navigation.errors.invalid');
    expect(admin.updateContentBlock).not.toHaveBeenCalled();
    expect(admin.createContent).not.toHaveBeenCalled();
  });

  it('parses, loads, and persists reusable blocks in update and create modes', () => {
    const { component, admin, toast } = createComponent();

    const parsed = (component as any).parseReusableBlocks({
      snippets: [
        { id: 'hero', title: 'Hero', block: { type: 'text', title: { en: 'Hero', ro: 'Hero' } } },
        { id: 'hero', title: 'Duplicate', block: { type: 'text' } },
        { id: 'missing-title', title: '', block: { type: 'text' } },
        { id: 'missing-block', title: 'No Block' }
      ]
    }) as Array<{ id: string; title: string; block: Record<string, unknown> }>;
    expect(parsed.length).toBe(1);
    expect(parsed[0].id).toBe('hero');
    expect(parsed[0].title).toBe('Hero');
    expect(parsed[0].block['type']).toBe('text');

    admin.getContent.and.returnValues(
      of({ meta: { snippets: [{ id: 'hero', title: 'Hero', block: { type: 'text' } }] } }),
      throwErrorSync({ status: 404 }) as any,
      throwErrorSync({ status: 500 }) as any
    );

    component.loadReusableBlocks();
    expect((component as any).reusableBlocksExists).toBeTrue();
    expect(component.reusableBlocks.length).toBe(1);

    component.loadReusableBlocks();
    expect((component as any).reusableBlocksExists).toBeFalse();
    expect(component.reusableBlocksError).toBeNull();

    component.loadReusableBlocks();
    expect((component as any).reusableBlocksExists).toBeFalse();
    expect(component.reusableBlocksError).toBe('adminUi.content.reusableBlocks.errors.load');

    (component as any).reusableBlocksExists = true;
    (component as any).reusableBlocksMeta = { existing: true };
    admin.updateContentBlock.and.returnValue(
      of({
        meta: {
          snippets: [{ id: 'faq', title: 'FAQ', block: { type: 'faq', faq_items: [] } }]
        }
      })
    );

    (component as any).persistReusableBlocks(
      [{ id: 'faq', title: 'FAQ', block: { type: 'faq', faq_items: [] } }],
      { successKey: 'adminUi.content.reusableBlocks.success.saved' }
    );

    expect(admin.updateContentBlock).toHaveBeenCalled();
    expect(component.reusableBlocks.length).toBe(1);
    expect(toast.success).toHaveBeenCalledWith('adminUi.content.reusableBlocks.success.saved');

    (component as any).reusableBlocksExists = false;
    admin.createContent.and.returnValue(
      of({
        meta: {
          snippets: [{ id: 'cta', title: 'CTA', block: { type: 'cta', cta_url: '/shop' } }]
        }
      })
    );

    (component as any).persistReusableBlocks([{ id: 'cta', title: 'CTA', block: { type: 'cta', cta_url: '/shop' } }]);

    expect(admin.createContent).toHaveBeenCalled();
    expect(component.reusableBlocks.length).toBe(1);
    expect(component.reusableBlocks[0].id).toBe('cta');
  });

  it('resets page builder state when page content is missing (404)', () => {
    const { component, admin } = createComponent();

    const pageKey = 'page.missing';
    component.pageBlocks[pageKey] = [{ key: 'x', type: 'text' } as any];
    component.pageBlocksNeedsTranslationEn[pageKey] = true;
    component.pageBlocksNeedsTranslationRo[pageKey] = true;
    component.pageBlocksStatus[pageKey] = 'published';
    component.pageBlocksPublishedAt[pageKey] = '2026-02-27T10:00';
    component.pageBlocksPublishedUntil[pageKey] = '2026-03-01T10:00';
    component.pageBlocksMeta[pageKey] = { requires_auth: true };
    component.pageBlocksRequiresAuth[pageKey] = true;
    (component as any).contentVersions[pageKey] = 9;

    admin.getContent.and.returnValue(throwErrorSync({ status: 404 }) as any);

    component.loadPageBlocks(pageKey as any);

    expect(component.pageBlocks[pageKey]).toEqual([]);
    expect(component.pageBlocksNeedsTranslationEn[pageKey]).toBeFalse();
    expect(component.pageBlocksNeedsTranslationRo[pageKey]).toBeFalse();
    expect(component.pageBlocksStatus[pageKey]).toBe('draft');
    expect(component.pageBlocksPublishedAt[pageKey]).toBe('');
    expect(component.pageBlocksPublishedUntil[pageKey]).toBe('');
    expect(component.pageBlocksMeta[pageKey]).toEqual({});
    expect(component.pageBlocksRequiresAuth[pageKey]).toBeFalse();
    expect((component as any).contentVersions[pageKey]).toBeUndefined();
  });

  it('exports and imports redirects including success and error branches', () => {
    const { component, admin, toast } = createComponent();

    const exportBlob = new Blob(['from,to\nold,new']);
    admin.exportContentRedirects.and.returnValues(
      of(exportBlob),
      throwErrorSync({ error: { detail: 'export failed' } }) as any
    );

    const originalCreateElement = document.createElement.bind(document);
    const anchor = originalCreateElement('a');
    const clickSpy = spyOn(anchor, 'click').and.callFake(() => undefined);
    const removeSpy = spyOn(anchor, 'remove').and.callFake(() => undefined);

    spyOn(document, 'createElement').and.callFake((tagName: string): HTMLElement => {
      if (tagName.toLowerCase() === 'a') {
        return anchor;
      }
      return originalCreateElement(tagName);
    });

    const appendSpy = spyOn(document.body, 'appendChild').and.callFake(<T extends Node>(node: T) => node);
    const createObjectUrlSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:test-url');
    const revokeSpy = spyOn(URL, 'revokeObjectURL').and.stub();

    component.exportContentRedirects();

    expect(createObjectUrlSpy).toHaveBeenCalledWith(exportBlob);
    expect(appendSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalledWith('blob:test-url');
    expect(component.redirectsExporting).toBeFalse();
    expect(toast.success).toHaveBeenCalledWith('adminUi.site.pages.redirects.success.export');

    component.exportContentRedirects();

    expect(component.redirectsExporting).toBeFalse();
    expect(toast.error).toHaveBeenCalledWith('export failed');

    const file = new File(['from,to'], 'redirects.csv', { type: 'text/csv' });
    const importInput = document.createElement('input');
    Object.defineProperty(importInput, 'files', { value: [file] });
    importInput.value = 'non-empty';

    const secondFile = new File(['from,to'], 'redirects-2.csv', { type: 'text/csv' });
    const importInput2 = document.createElement('input');
    Object.defineProperty(importInput2, 'files', { value: [secondFile] });

    admin.importContentRedirects.and.returnValues(
      of({ created: 1, updated: 2, skipped: 0, errors: [] }),
      throwErrorSync({ error: { detail: 'import failed' } }) as any
    );

    const loadRedirectsSpy = spyOn(component, 'loadContentRedirects').and.stub();

    component.importContentRedirects({ target: importInput } as unknown as Event);

    expect(importInput.value).toBe('');
    expect(component.redirectsImportResult).toEqual({ created: 1, updated: 2, skipped: 0, errors: [] });
    expect(component.redirectsImporting).toBeFalse();
    expect(toast.success).toHaveBeenCalledWith('adminUi.site.pages.redirects.success.import');
    expect(loadRedirectsSpy).toHaveBeenCalledWith(true);

    component.importContentRedirects({ target: importInput2 } as unknown as Event);

    expect(component.redirectsImporting).toBeFalse();
    expect(toast.error).toHaveBeenCalledWith('import failed');
  });

  it('maps page block type labels including fallback default', () => {
    const { component } = createComponent();

    expect(component.pageBlockTypeLabelKey('text')).toBe('adminUi.home.sections.blocks.text');
    expect(component.pageBlockTypeLabelKey('columns')).toBe('adminUi.home.sections.blocks.columns');
    expect(component.pageBlockTypeLabelKey('cta')).toBe('adminUi.home.sections.blocks.cta');
    expect(component.pageBlockTypeLabelKey('faq')).toBe('adminUi.home.sections.blocks.faq');
    expect(component.pageBlockTypeLabelKey('testimonials')).toBe('adminUi.home.sections.blocks.testimonials');
    expect(component.pageBlockTypeLabelKey('product_grid')).toBe('adminUi.home.sections.blocks.product_grid');
    expect(component.pageBlockTypeLabelKey('form')).toBe('adminUi.home.sections.blocks.form');
    expect(component.pageBlockTypeLabelKey('image')).toBe('adminUi.home.sections.blocks.image');
    expect(component.pageBlockTypeLabelKey('gallery')).toBe('adminUi.home.sections.blocks.gallery');
    expect(component.pageBlockTypeLabelKey('banner')).toBe('adminUi.home.sections.blocks.banner');
    expect(component.pageBlockTypeLabelKey('carousel')).toBe('adminUi.home.sections.blocks.carousel');
    expect(component.pageBlockTypeLabelKey('unknown' as any)).toBe('adminUi.home.sections.blocks.text');
  });

  it('parses page block drafts for all supported types', () => {
    const { component } = createComponent();

    const parsed = (component as any).parsePageBlocksDraft({
      blocks: [
        { type: 'text', key: 't1', title: { en: 'Text' }, body_markdown: { en: 'Body' } },
        {
          type: 'columns',
          key: 'c1',
          title: { en: 'Columns' },
          columns: [
            { title: { en: 'A' }, body_markdown: { en: 'a' } },
            { title: { en: 'B' }, body_markdown: { en: 'b' } },
            { title: { en: 'C' }, body_markdown: { en: 'c' } }
          ],
          columns_breakpoint: 'lg'
        },
        { type: 'cta', key: 'cta1', body_markdown: { en: 'Desc' }, cta_label: { en: 'Go' }, cta_url: '/go', cta_new_tab: 'true' },
        { type: 'faq', key: 'faq1', items: [{ question: { en: 'Q' }, answer_markdown: { en: 'A' } }] },
        { type: 'testimonials', key: 'test1', items: [{ quote_markdown: { en: 'Wow' }, author: { en: 'A' }, role: { en: 'B' } }] },
        { type: 'product_grid', key: 'grid1', source: 'products', product_slugs: 'a, b\na', limit: 26 },
        { type: 'form', key: 'form1', form_type: 'newsletter', topic: 'refund' },
        {
          type: 'image',
          key: 'img1',
          url: '/img.jpg',
          link_url: '/shop',
          alt: { en: 'Alt' },
          caption: { en: 'Caption' },
          focal_x: 20,
          focal_y: 80
        },
        {
          type: 'gallery',
          key: 'gal1',
          images: [
            { url: ' ', alt: { en: 'ignore' } },
            { url: '/g1.jpg', alt: { en: 'G1' }, caption: { en: 'Cap' }, focal_x: 11, focal_y: 89 }
          ]
        },
        { type: 'banner', key: 'ban1', slide: { image_url: '/banner.jpg', variant: 'full', size: 'L', text_style: 'light' } },
        {
          type: 'carousel',
          key: 'car1',
          slides: [{ image_url: '/s1.jpg', focal_x: 5, focal_y: 95 }],
          settings: { autoplay: true, interval_ms: 1200, show_dots: false, show_arrows: false, pause_on_hover: false }
        },
        { type: 'unsupported', key: 'skip-me' },
        { type: 'text', key: 't1', title: { en: 'Duplicate key' } }
      ]
    }) as Array<Record<string, any>>;

    expect(parsed.length).toBe(11);
    expect(parsed.find((b) => b['key'] === 't1')?.['body_markdown']).toEqual({ en: 'Body', ro: '' });
    expect(parsed.find((b) => b['key'] === 'c1')?.['columns_breakpoint']).toBe('lg');
    expect(parsed.find((b) => b['key'] === 'cta1')?.['cta_new_tab']).toBeTrue();
    expect(parsed.find((b) => b['key'] === 'faq1')?.['faq_items'].length).toBe(1);
    expect(parsed.find((b) => b['key'] === 'test1')?.['testimonials'].length).toBe(1);
    expect(parsed.find((b) => b['key'] === 'grid1')?.['product_grid_source']).toBe('products');
    expect(parsed.find((b) => b['key'] === 'grid1')?.['product_grid_product_slugs']).toBe('a\nb');
    expect(parsed.find((b) => b['key'] === 'grid1')?.['product_grid_limit']).toBe(24);
    expect(parsed.find((b) => b['key'] === 'form1')?.['form_type']).toBe('newsletter');
    expect(parsed.find((b) => b['key'] === 'img1')?.['url']).toBe('/img.jpg');
    expect(parsed.find((b) => b['key'] === 'gal1')?.['images'].length).toBe(1);
    expect(parsed.find((b) => b['key'] === 'ban1')?.['slide']['image_url']).toBe('/banner.jpg');
    expect(parsed.find((b) => b['key'] === 'car1')?.['slides'].length).toBe(1);
    expect(parsed.find((b) => b['key'] === 'car1')?.['settings']['autoplay']).toBeTrue();
  });

  it('applies page carousel add/remove/move/image update operations', () => {
    const { component, toast } = createComponent();

    const pageKey = 'page.about';
    component.pageBlocks[pageKey] = [
      {
        key: 'carousel-1',
        type: 'carousel',
        enabled: true,
        title: { en: '', ro: '' },
        body_markdown: { en: '', ro: '' },
        columns: [],
        columns_breakpoint: 'md',
        cta_label: { en: '', ro: '' },
        cta_url: '',
        cta_new_tab: false,
        faq_items: [],
        testimonials: [],
        product_grid_source: 'category',
        product_grid_category_slug: '',
        product_grid_collection_slug: '',
        product_grid_product_slugs: '',
        product_grid_limit: 6,
        form_type: 'contact',
        form_topic: 'contact',
        url: '',
        link_url: '',
        focal_x: 50,
        focal_y: 50,
        alt: { en: '', ro: '' },
        caption: { en: '', ro: '' },
        images: [],
        slide: (component as any).emptySlideDraft(),
        slides: [
          (component as any).toSlideDraft({ image_url: '/s1.jpg' }),
          (component as any).toSlideDraft({ image_url: '/s2.jpg' })
        ],
        settings: (component as any).defaultCarouselSettings(),
        layout: (component as any).defaultCmsBlockLayout()
      } as any
    ];

    component.addPageCarouselSlide(pageKey as any, 'carousel-1');
    expect((component.pageBlocks[pageKey][0] as any).slides.length).toBe(3);

    component.movePageCarouselSlide(pageKey as any, 'carousel-1', 0, 1);
    expect((component.pageBlocks[pageKey][0] as any).slides[0].image_url).toBe('/s2.jpg');

    component.removePageCarouselSlide(pageKey as any, 'carousel-1', 0);
    component.removePageCarouselSlide(pageKey as any, 'carousel-1', 0);
    component.removePageCarouselSlide(pageKey as any, 'carousel-1', 0);
    expect((component.pageBlocks[pageKey][0] as any).slides.length).toBe(1);

    component.setPageCarouselSlideImage(pageKey as any, 'carousel-1', 0, { url: ' /new.jpg ', focal_x: 12, focal_y: 89 } as any);
    expect((component.pageBlocks[pageKey][0] as any).slides[0].image_url).toBe('/new.jpg');
    expect(toast.success).toHaveBeenCalledWith('adminUi.site.assets.library.success.selected');

    component.setPageCarouselSlideImage(pageKey as any, 'carousel-1', 0, { url: '   ', focal_x: 99, focal_y: 99 } as any);
    expect((component.pageBlocks[pageKey][0] as any).slides[0].image_url).toBe('/new.jpg');
  });

  it('builds page metadata with type-specific writers and requires_auth control', () => {
    const { component } = createComponent();

    const base = {
      key: 'base',
      enabled: true,
      title: { en: 'Title', ro: 'Titlu' },
      body_markdown: { en: 'Body', ro: '' },
      columns: [
        { title: { en: 'A', ro: '' }, body_markdown: { en: 'a', ro: '' } },
        { title: { en: 'B', ro: '' }, body_markdown: { en: 'b', ro: '' } }
      ],
      columns_breakpoint: 'md',
      cta_label: { en: 'Go', ro: '' },
      cta_url: '/go',
      cta_new_tab: true,
      faq_items: [{ question: { en: 'Q', ro: '' }, answer_markdown: { en: 'A', ro: '' } }],
      testimonials: [{ quote_markdown: { en: 'Nice', ro: '' }, author: { en: 'A', ro: '' }, role: { en: 'B', ro: '' } }],
      product_grid_source: 'category',
      product_grid_category_slug: 'rings',
      product_grid_collection_slug: 'featured',
      product_grid_product_slugs: 'a\nb\na',
      product_grid_limit: 30,
      form_type: 'contact',
      form_topic: 'support',
      url: '/image.jpg',
      link_url: '/shop',
      focal_x: 17,
      focal_y: 83,
      alt: { en: 'Alt', ro: '' },
      caption: { en: 'Caption', ro: '' },
      images: [{ url: '/g1.jpg', alt: { en: 'G1', ro: '' }, caption: { en: '', ro: '' }, focal_x: 10, focal_y: 90 }],
      slide: (component as any).toSlideDraft({ image_url: '/banner.jpg' }),
      slides: [(component as any).toSlideDraft({ image_url: '/s1.jpg' })],
      settings: (component as any).defaultCarouselSettings(),
      layout: (component as any).defaultCmsBlockLayout()
    };

    const textMeta = (component as any).buildPageBlockMeta({ ...base, key: 't', type: 'text' });
    const columnsMeta = (component as any).buildPageBlockMeta({ ...base, key: 'cols', type: 'columns' });
    const ctaMeta = (component as any).buildPageBlockMeta({ ...base, key: 'cta', type: 'cta' });
    const faqMeta = (component as any).buildPageBlockMeta({ ...base, key: 'faq', type: 'faq' });
    const testimonialsMeta = (component as any).buildPageBlockMeta({ ...base, key: 'test', type: 'testimonials' });
    const productCategoryMeta = (component as any).buildPageBlockMeta({
      ...base,
      key: 'grid-category',
      type: 'product_grid',
      product_grid_source: 'category'
    });
    const productCollectionMeta = (component as any).buildPageBlockMeta({
      ...base,
      key: 'grid-collection',
      type: 'product_grid',
      product_grid_source: 'collection'
    });
    const productProductsMeta = (component as any).buildPageBlockMeta({
      ...base,
      key: 'grid-products',
      type: 'product_grid',
      product_grid_source: 'products'
    });
    const formContactMeta = (component as any).buildPageBlockMeta({ ...base, key: 'form-contact', type: 'form', form_type: 'contact' });
    const formNewsletterMeta = (component as any).buildPageBlockMeta({
      ...base,
      key: 'form-news',
      type: 'form',
      form_type: 'newsletter'
    });
    const imageMeta = (component as any).buildPageBlockMeta({ ...base, key: 'image', type: 'image' });
    const galleryMeta = (component as any).buildPageBlockMeta({ ...base, key: 'gallery', type: 'gallery' });
    const bannerMeta = (component as any).buildPageBlockMeta({ ...base, key: 'banner', type: 'banner' });
    const carouselMeta = (component as any).buildPageBlockMeta({ ...base, key: 'carousel', type: 'carousel' });

    expect(textMeta['body_markdown']).toEqual({ en: 'Body', ro: '' });
    expect(columnsMeta['columns_breakpoint']).toBe('md');
    expect(ctaMeta['cta_new_tab']).toBeTrue();
    expect(faqMeta['items']).toEqual([{ question: { en: 'Q', ro: '' }, answer_markdown: { en: 'A', ro: '' } }]);
    expect(testimonialsMeta['items']).toEqual([{ quote_markdown: { en: 'Nice', ro: '' }, author: { en: 'A', ro: '' }, role: { en: 'B', ro: '' } }]);
    expect(productCategoryMeta['category_slug']).toBe('rings');
    expect(productCollectionMeta['collection_slug']).toBe('featured');
    expect(productProductsMeta['product_slugs']).toEqual(['a', 'b']);
    expect(productProductsMeta['limit']).toBe(24);
    expect(formContactMeta['topic']).toBe('support');
    expect(formNewsletterMeta['topic']).toBeUndefined();
    expect(imageMeta['url']).toBe('/image.jpg');
    expect(galleryMeta['images']).toEqual([
      { url: '/g1.jpg', alt: { en: 'G1', ro: '' }, caption: { en: '', ro: '' }, focal_x: 10, focal_y: 90 }
    ]);
    expect((bannerMeta['slide'] as Record<string, unknown>)['image_url']).toBe('/banner.jpg');
    expect((carouselMeta['slides'] as Array<Record<string, unknown>>).length).toBe(1);

    const pageKey = 'page.private';
    component.pageBlocks[pageKey] = [{ ...base, key: 't', type: 'text' } as any];
    component.pageBlocksMeta[pageKey] = { persisted: 'yes' };
    component.pageBlocksRequiresAuth[pageKey] = true;
    const withAuth = (component as any).buildPageBlocksMeta(pageKey);
    expect(withAuth['version']).toBe(2);
    expect(withAuth['requires_auth']).toBeTrue();

    component.pageBlocksRequiresAuth[pageKey] = false;
    const withoutAuth = (component as any).buildPageBlocksMeta(pageKey);
    expect(withoutAuth['requires_auth']).toBeUndefined();
  });

  it('computes publish checklist issues via type-specific writers', () => {
    const { component, translate } = createComponent();

    translate.instant.and.callFake((key: string) => {
      if (key === 'adminUi.content.publishChecklist.imageLabel') return 'Image';
      if (key === 'adminUi.content.publishChecklist.slideLabel') return 'Slide';
      return key;
    });

    const pageKey = 'page.checklist';
    component.pageBlocksNeedsTranslationEn[pageKey] = true;
    component.pageBlocksNeedsTranslationRo[pageKey] = true;

    const mk = (type: string, extra: Record<string, unknown> = {}) => ({
      key: `${type}-1`,
      type,
      enabled: true,
      title: { en: '', ro: '' },
      body_markdown: { en: '', ro: '' },
      columns: [
        { title: { en: '', ro: '' }, body_markdown: { en: '', ro: '' } },
        { title: { en: '', ro: '' }, body_markdown: { en: '', ro: '' } }
      ],
      columns_breakpoint: 'md',
      cta_label: { en: '', ro: '' },
      cta_url: '',
      cta_new_tab: false,
      faq_items: [{ question: { en: '', ro: '' }, answer_markdown: { en: '', ro: '' } }],
      testimonials: [{ quote_markdown: { en: '', ro: '' }, author: { en: '', ro: '' }, role: { en: '', ro: '' } }],
      product_grid_source: 'category',
      product_grid_category_slug: '',
      product_grid_collection_slug: '',
      product_grid_product_slugs: '',
      product_grid_limit: 6,
      form_type: 'contact',
      form_topic: 'contact',
      url: '',
      link_url: '',
      focal_x: 50,
      focal_y: 50,
      alt: { en: '', ro: '' },
      caption: { en: '', ro: '' },
      images: [],
      slide: (component as any).emptySlideDraft(),
      slides: [(component as any).emptySlideDraft()],
      settings: (component as any).defaultCarouselSettings(),
      layout: (component as any).defaultCmsBlockLayout(),
      ...extra
    });

    component.pageBlocks[pageKey] = [
      mk('text'),
      mk('columns'),
      mk('cta'),
      mk('faq'),
      mk('testimonials'),
      mk('product_grid', { product_grid_source: 'category', product_grid_category_slug: '' }),
      mk('form'),
      mk('image', { url: '/img.jpg', alt: { en: '', ro: '' } }),
      mk('gallery', {
        images: [
          { url: '/g1.jpg', alt: { en: 'Alt EN', ro: '' }, caption: { en: '', ro: '' }, focal_x: 50, focal_y: 50 },
          { url: '', alt: { en: '', ro: '' }, caption: { en: '', ro: '' }, focal_x: 50, focal_y: 50 }
        ]
      }),
      mk('banner', { slide: { ...(component as any).emptySlideDraft(), image_url: '/banner.jpg', alt: { en: '', ro: '' } } }),
      mk('carousel', {
        slides: [
          {
            ...(component as any).emptySlideDraft(),
            image_url: '/slide.jpg',
            alt: { en: 'Slide EN', ro: '' }
          }
        ]
      })
    ] as any;

    const checklist = (component as any).computePagePublishChecklistLocal(pageKey) as {
      missingTranslations: string[];
      missingAlt: string[];
      emptySections: string[];
    };

    expect(checklist.missingTranslations).toEqual(['en', 'ro']);
    expect(checklist.emptySections.length).toBe(6);
    expect(checklist.emptySections.join('|')).toContain('1. text');
    expect(checklist.emptySections.join('|')).toContain('2. columns');
    expect(checklist.emptySections.join('|')).toContain('3. cta');
    expect(checklist.emptySections.join('|')).toContain('4. faq');
    expect(checklist.emptySections.join('|')).toContain('5. testimonials');
    expect(checklist.emptySections.join('|')).toContain('6. product_grid');

    expect(checklist.missingAlt.length).toBe(6);
    expect(checklist.missingAlt.join('|')).toContain('8. image (EN)');
    expect(checklist.missingAlt.join('|')).toContain('8. image (RO)');
    expect(checklist.missingAlt.join('|')).toContain('9. gallery · Image (RO)');
    expect(checklist.missingAlt.join('|')).toContain('10. banner (EN)');
    expect(checklist.missingAlt.join('|')).toContain('10. banner (RO)');
    expect(checklist.missingAlt.join('|')).toContain('11. carousel · Slide (RO)');

    component.pageBlocks[pageKey] = [mk('text', { enabled: false })] as any;
    const allDisabled = (component as any).computePagePublishChecklistLocal(pageKey) as { emptySections: string[] };
    expect(allDisabled.emptySections).toContain('adminUi.content.publishChecklist.emptyAllDisabled');
  });
});
