 
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { AdminComponent } from './admin.component';

/**
 * Branch-fill behavioural suite for AdminComponent.
 *
 * Drives the (very large) admin content component through the remaining
 * untaken branch paths left by the existing specs. The component is
 * instantiated directly (same pattern as the sibling specs) so individual
 * methods can be exercised in isolation with focused service mocks. Every
 * test asserts real behaviour — returned values, mutated component state,
 * service calls with concrete arguments, or toast/error side effects — and
 * targets a specific previously-untaken branch (the "other" side of a
 * default/guard/ternary), never a no-assert coverage probe.
 */

type RouteStub = {
  snapshot: { data: Record<string, unknown>; queryParams: Record<string, unknown> };
  data: Subject<Record<string, unknown>>;
  queryParams: Subject<Record<string, unknown>>;
};

function createRouteStub(section = 'home', query: Record<string, unknown> = {}): RouteStub {
  return {
    snapshot: { data: { section }, queryParams: query },
    data: new Subject<Record<string, unknown>>(),
    queryParams: new Subject<Record<string, unknown>>(),
  };
}

interface Harness {
  component: AdminComponent;
  admin: any;
  adminProducts: any;
  blog: any;
  fxAdmin: any;
  taxesAdmin: any;
  auth: any;
  cmsPrefs: any;
  toast: jasmine.SpyObj<any>;
  translate: any;
  markdown: any;
  sanitizer: any;
  route: RouteStub;
}

function makeAdminSpy(): any {
  const methods = [
    'products',
    'coupons',
    'lowStock',
    'audit',
    'getMaintenance',
    'setMaintenance',
    'content',
    'getContent',
    'createContent',
    'updateContentBlock',
    'deleteContent',
    'getCategories',
    'createCategory',
    'updateCategory',
    'deleteCategory',
    'getCategoryTranslations',
    'upsertCategoryTranslation',
    'deleteCategoryTranslation',
    'createProduct',
    'updateProduct',
    'getProduct',
    'deleteProduct',
    'duplicateProduct',
    'uploadProductImage',
    'deleteProductImage',
    'transferOwner',
    'revokeSessions',
    'userAliases',
    'updateUserRole',
    'updateOrderStatus',
    'createCoupon',
    'updateCoupon',
    'invalidateCouponStripeMappings',
    'listContentVersions',
    'getContentVersion',
    'rollbackContentVersion',
    'uploadContentImage',
    'updateContentImageFocalPoint',
    'listContentPages',
    'renameContentPage',
    'updateContentTranslationStatus',
    'getSitemapPreview',
    'validateStructuredData',
    'deleteContentRedirect',
    'exportContentRedirects',
    'importContentRedirects',
    'upsertContentRedirect',
    'previewFindReplaceContent',
    'applyFindReplaceContent',
    'linkCheckContent',
    'fetchSocialThumbnail',
    'sendScheduledReport',
    'createPagePreviewToken',
    'createHomePreviewToken',
    'listFeaturedCollections',
    'createFeaturedCollection',
    'updateFeaturedCollection',
    'reorderCategories',
    'listContentRedirects',
    'linkCheckContentPreview',
  ];
  const spy: any = jasmine.createSpyObj('AdminService', methods);
  for (const m of methods) spy[m].and.returnValue(of(undefined));
  spy.products.and.returnValue(of([]));
  spy.coupons.and.returnValue(of([]));
  spy.lowStock.and.returnValue(of([]));
  spy.audit.and.returnValue(of({ products: [], content: [], security: [] }));
  spy.getMaintenance.and.returnValue(of({ enabled: false }));
  spy.content.and.returnValue(of([]));
  spy.getCategories.and.returnValue(of([]));
  spy.listFeaturedCollections.and.returnValue(of([]));
  spy.userAliases.and.returnValue(of({ aliases: [] }));
  return spy;
}

function makeCmsPrefs(): any {
  return {
    mode: jasmine.createSpy('mode').and.returnValue('basic'),
    previewDevice: jasmine.createSpy('previewDevice').and.returnValue('desktop'),
    previewLayout: jasmine.createSpy('previewLayout').and.returnValue('stacked'),
    previewLang: jasmine.createSpy('previewLang').and.returnValue('en'),
    previewTheme: jasmine.createSpy('previewTheme').and.returnValue('light'),
    translationLayout: jasmine.createSpy('translationLayout').and.returnValue('tabbed'),
    setMode: jasmine.createSpy('setMode'),
    setPreviewDevice: jasmine.createSpy('setPreviewDevice'),
    setPreviewLayout: jasmine.createSpy('setPreviewLayout'),
  };
}

function createComponent(route: RouteStub = createRouteStub()): Harness {
  const admin = makeAdminSpy();
  const adminProducts = jasmine.createSpyObj('AdminProductsService', ['search']);
  adminProducts.search.and.returnValue(of({ items: [], total: 0 }));
  const blog = jasmine.createSpyObj('BlogService', [
    'listFlaggedComments',
    'resolveCommentFlagsAdmin',
    'hideCommentAdmin',
    'unhideCommentAdmin',
    'deleteComment',
    'createPreviewToken',
  ]);
  blog.listFlaggedComments.and.returnValue(of([]));
  blog.createPreviewToken.and.returnValue(of({ token: 't', expires_at: '' }));
  const fxAdmin = jasmine.createSpyObj('FxAdminService', [
    'getStatus',
    'listOverrideAudit',
    'restoreOverrideFromAudit',
    'clearOverride',
    'setOverride',
  ]);
  fxAdmin.getStatus.and.returnValue(of({ override: null }));
  fxAdmin.listOverrideAudit.and.returnValue(of([]));
  const taxesAdmin = jasmine.createSpyObj('TaxesAdminService', [
    'listGroups',
    'createGroup',
    'updateGroup',
    'deleteGroup',
    'upsertRate',
    'deleteRate',
  ]);
  taxesAdmin.listGroups.and.returnValue(of([]));
  const auth = {
    role: jasmine.createSpy('role').and.returnValue('owner'),
    loadCurrentUser: jasmine.createSpy('loadCurrentUser').and.returnValue(of(null)),
  };
  const cmsPrefs = makeCmsPrefs();
  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);
  const translate = { instant: (k: string, p?: any) => (p ? `${k}:${JSON.stringify(p)}` : k) };
  const markdown = { render: (v: string) => `<p>${v}</p>` };
  const sanitizer = {
    bypassSecurityTrustHtml: (v: string) => v,
    bypassSecurityTrustResourceUrl: (v: string) => `safe:${v}`,
  } as unknown as DomSanitizer;

  const component = new AdminComponent(
    {
      snapshot: route.snapshot,
      data: route.data.asObservable(),
      queryParams: route.queryParams.asObservable(),
    } as unknown as ActivatedRoute,
    admin,
    adminProducts,
    blog,
    fxAdmin,
    taxesAdmin,
    auth as any,
    cmsPrefs,
    toast,
    translate as any,
    markdown as any,
    sanitizer,
  );

  return {
    component,
    admin,
    adminProducts,
    blog,
    fxAdmin,
    taxesAdmin,
    auth,
    cmsPrefs,
    toast,
    translate,
    markdown,
    sanitizer,
    route,
  };
}

describe('AdminComponent — branch fill', () => {
  let h: Harness;
  let c: any;

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    h = createComponent();
    c = h.component as any;
  });

  describe('parsePageBlocksDraft', () => {
    it('returns [] for non-array / empty blocks', () => {
      expect(c.parsePageBlocksDraft(null)).toEqual([]);
      expect(c.parsePageBlocksDraft({ blocks: 'nope' })).toEqual([]);
      expect(c.parsePageBlocksDraft({ blocks: [] })).toEqual([]);
    });

    it('skips non-object entries, unknown types and duplicate keys', () => {
      const result = c.parsePageBlocksDraft({
        blocks: [
          null,
          'string-entry',
          { type: 'unknown_kind' },
          { type: 'text', key: 'dup', body_markdown: { en: 'A', ro: '' } },
          { type: 'text', key: 'dup', body_markdown: { en: 'B', ro: '' } },
        ],
      });
      expect(result.length).toBe(1);
      expect(result[0].key).toBe('dup');
    });

    it('derives a fallback key from type + index and honours enabled:false', () => {
      const result = c.parsePageBlocksDraft({
        blocks: [{ type: 'text', enabled: false, body_markdown: { en: 'x', ro: '' } }],
      });
      expect(result[0].key).toBe('text_1');
      expect(result[0].enabled).toBe(false);
    });

    it('parses columns with breakpoint and a custom 3-column layout', () => {
      const result = c.parsePageBlocksDraft({
        blocks: [
          {
            type: 'columns',
            key: 'cols',
            breakpoint: 'lg',
            columns: [
              null,
              { title: { en: 'c1', ro: '' }, body_markdown: { en: 'b1', ro: '' } },
              { title: { en: 'c2', ro: '' }, body_markdown: { en: 'b2', ro: '' } },
              { title: { en: 'c3', ro: '' }, body_markdown: { en: 'b3', ro: '' } },
              { title: { en: 'c4', ro: '' }, body_markdown: { en: 'b4', ro: '' } },
            ],
          },
        ],
      });
      expect(result[0].columns.length).toBe(3);
      expect(result[0].columns_breakpoint).toBe('lg');
    });

    it('falls back to md breakpoint when invalid and keeps default columns when fewer than 2', () => {
      const result = c.parsePageBlocksDraft({
        blocks: [
          {
            type: 'columns',
            key: 'cols2',
            columns_breakpoint: 'xx',
            columns: [{ title: { en: 'only', ro: '' }, body_markdown: { en: '', ro: '' } }],
          },
        ],
      });
      expect(result[0].columns_breakpoint).toBe('md');
      expect(result[0].columns.length).toBe(2);
    });

    it('parses cta with new-tab flag', () => {
      const result = c.parsePageBlocksDraft({
        blocks: [
          {
            type: 'cta',
            key: 'cta',
            cta_url: '  /go  ',
            cta_new_tab: true,
            cta_label: { en: 'Go', ro: '' },
          },
        ],
      });
      expect(result[0].cta_url).toBe('/go');
      expect(result[0].cta_new_tab).toBe(true);
    });

    it('parses faq and testimonials items (and ignores invalid item entries)', () => {
      const faq = c.parsePageBlocksDraft({
        blocks: [
          {
            type: 'faq',
            key: 'faq',
            items: [null, { question: { en: 'q', ro: '' }, answer_markdown: { en: 'a', ro: '' } }],
          },
        ],
      });
      expect(faq[0].faq_items.length).toBe(1);
      const test = c.parsePageBlocksDraft({
        blocks: [
          {
            type: 'testimonials',
            key: 't',
            items: [
              3,
              {
                quote_markdown: { en: 'q', ro: '' },
                author: { en: 'me', ro: '' },
                role: { en: 'r', ro: '' },
              },
            ],
          },
        ],
      });
      expect(test[0].testimonials.length).toBe(1);
    });

    it('parses product_grid with collection source and array slugs', () => {
      const result = c.parsePageBlocksDraft({
        blocks: [
          {
            type: 'product_grid',
            key: 'pg',
            source: 'COLLECTION',
            collection_slug: ' col ',
            category_slug: ' cat ',
            product_slugs: ['a', 'a', 'b', 3],
            limit: 100,
          },
        ],
      });
      expect(result[0].product_grid_source).toBe('collection');
      expect(result[0].product_grid_collection_slug).toBe('col');
      expect(result[0].product_grid_product_slugs).toBe('a\nb');
      expect(result[0].product_grid_limit).toBe(24);
    });

    it('parses product_grid with products source and comma/newline string slugs and non-finite limit', () => {
      const result = c.parsePageBlocksDraft({
        blocks: [
          {
            type: 'product_grid',
            key: 'pg2',
            source: 'products',
            product_slugs: 'a, b\nc',
            limit: 'NaN',
          },
        ],
      });
      expect(result[0].product_grid_source).toBe('products');
      expect(result[0].product_grid_product_slugs).toBe('a\nb\nc');
      expect(result[0].product_grid_limit).toBe(6);
    });

    it('parses form block with newsletter type and support topic', () => {
      const result = c.parsePageBlocksDraft({
        blocks: [{ type: 'form', key: 'f', form_type: 'NEWSLETTER', topic: 'support' }],
      });
      expect(result[0].form_type).toBe('newsletter');
      expect(result[0].form_topic).toBe('support');
    });

    it('parses image, gallery (skipping urlless entries), banner and carousel blocks', () => {
      const image = c.parsePageBlocksDraft({
        blocks: [
          { type: 'image', key: 'img', url: ' /u ', link_url: ' /l ', focal_x: 10, focal_y: 20 },
        ],
      });
      expect(image[0].url).toBe('/u');
      expect(image[0].link_url).toBe('/l');

      const gallery = c.parsePageBlocksDraft({
        blocks: [{ type: 'gallery', key: 'g', images: [null, { url: '' }, { url: ' /pic ' }] }],
      });
      expect(gallery[0].images.length).toBe(1);
      expect(gallery[0].images[0].url).toBe('/pic');

      const banner = c.parsePageBlocksDraft({ blocks: [{ type: 'banner', key: 'b', slide: {} }] });
      expect(banner[0].type).toBe('banner');

      const carousel = c.parsePageBlocksDraft({
        blocks: [{ type: 'carousel', key: 'car', slides: [{}, {}], settings: {} }],
      });
      expect(carousel[0].slides.length).toBe(2);

      const carouselEmpty = c.parsePageBlocksDraft({
        blocks: [{ type: 'carousel', key: 'car2', slides: 'nope' }],
      });
      expect(carouselEmpty[0].slides.length).toBe(1);
    });
  });

  describe('insertPageMediaFiles', () => {
    const png = (name = 'My Photo.png') => new File(['x'], name, { type: 'image/png' });

    beforeEach(() => {
      h.admin.uploadContentImage.and.returnValue(
        of({ images: [{ url: 'https://cdn/test.png', focal_x: 40, focal_y: 60 }] }),
      );
    });

    it('returns early when no valid image files survive normalisation', async () => {
      await c.insertPageMediaFiles('page.about', 0, [
        new File(['x'], 'x.txt', { type: 'text/plain' }),
      ]);
      expect(h.toast.error).toHaveBeenCalled();
      expect(h.admin.uploadContentImage).not.toHaveBeenCalled();
    });

    it('inserts a single image block when one file is dropped on an image-capable page', async () => {
      c.pageBlocks['page.about'] = [];
      await c.insertPageMediaFiles('page.about', 0, [png()]);
      const blocks = c.pageBlocks['page.about'];
      expect(blocks.length).toBe(1);
      expect(blocks[0].type).toBe('image');
      expect(blocks[0].url).toBe('https://cdn/test.png');
      expect(blocks[0].alt.en).toBe('My Photo');
      expect(h.toast.success).toHaveBeenCalled();
    });

    it('inserts a gallery block when multiple files are dropped and gallery is allowed', async () => {
      c.pageBlocks['page.about'] = [];
      await c.insertPageMediaFiles('page.about', 0, [png('a.png'), png('b.png')]);
      const block = c.pageBlocks['page.about'].find((b: any) => b.type === 'gallery');
      expect(block).toBeTruthy();
      expect(block.images.length).toBe(2);
    });

    it('inserts multiple image blocks when gallery is disallowed but image is allowed', async () => {
      spyOn(c, 'allowedPageBlockTypesForKey').and.returnValue(['image']);
      c.pageBlocks['page.about'] = [];
      await c.insertPageMediaFiles('page.about', 0, [png('a.png'), png('b.png')]);
      const imgs = c.pageBlocks['page.about'].filter((b: any) => b.type === 'image');
      expect(imgs.length).toBe(2);
    });

    it('rejects a single file when neither image nor gallery is allowed', async () => {
      spyOn(c, 'allowedPageBlockTypesForKey').and.returnValue(['text']);
      c.pageBlocks['page.about'] = [];
      await c.insertPageMediaFiles('page.about', 0, [png()]);
      expect(c.pageBlocks['page.about'].length).toBe(0);
      expect(h.toast.error).toHaveBeenCalledWith(
        'adminUi.site.pages.builder.errors.blockTypeNotAllowed',
      );
    });

    it('rejects multiple files when neither image nor gallery is allowed', async () => {
      spyOn(c, 'allowedPageBlockTypesForKey').and.returnValue(['text']);
      c.pageBlocks['page.about'] = [];
      await c.insertPageMediaFiles('page.about', 0, [png('a.png'), png('b.png')]);
      expect(c.pageBlocks['page.about'].length).toBe(0);
      expect(h.toast.error).toHaveBeenCalled();
    });

    it('returns without inserting when uploads all fail to yield an image url', async () => {
      h.admin.uploadContentImage.and.returnValue(of({ images: [] }));
      c.pageBlocks['page.about'] = [];
      await c.insertPageMediaFiles('page.about', 0, [png()]);
      expect(c.pageBlocks['page.about'].length).toBe(0);
    });
  });

  describe('insertHomeMediaFiles', () => {
    const png = (name = 'Home Pic.png') => new File(['x'], name, { type: 'image/png' });

    beforeEach(() => {
      h.admin.uploadContentImage.and.returnValue(
        of({ images: [{ url: 'https://cdn/home.png', focal_x: 50, focal_y: 50 }] }),
      );
    });

    it('returns early when normalisation removes every file', async () => {
      await c.insertHomeMediaFiles(0, [new File(['x'], 'x.pdf', { type: 'application/pdf' })]);
      expect(h.admin.uploadContentImage).not.toHaveBeenCalled();
    });

    it('inserts a single home image block for one file', async () => {
      c.homeBlocks = [];
      await c.insertHomeMediaFiles(0, [png()]);
      expect(c.homeBlocks.length).toBe(1);
      expect(c.homeBlocks[0].url).toBe('https://cdn/home.png');
      expect(c.homeBlocks[0].alt.en).toBe('Home Pic');
    });

    it('inserts a home gallery block for multiple files', async () => {
      c.homeBlocks = [];
      await c.insertHomeMediaFiles(0, [png('a.png'), png('b.png')]);
      const gallery = c.homeBlocks.find((b: any) => b.type === 'gallery');
      expect(gallery.images.length).toBe(2);
    });

    it('returns without inserting when no upload produced a url', async () => {
      h.admin.uploadContentImage.and.returnValue(of({ images: [] }));
      c.homeBlocks = [];
      await c.insertHomeMediaFiles(0, [png()]);
      expect(c.homeBlocks.length).toBe(0);
    });
  });

  describe('drag helpers', () => {
    function dragEvent(dt: Partial<DataTransfer> | null): DragEvent {
      return { preventDefault: () => undefined, dataTransfer: dt } as unknown as DragEvent;
    }

    it('dragEventHasFiles detects files, Files type, and absence', () => {
      expect(c.dragEventHasFiles(dragEvent(null))).toBe(false);
      expect(c.dragEventHasFiles(dragEvent({ files: [new File(['x'], 'a.png')] } as any))).toBe(
        true,
      );
      expect(c.dragEventHasFiles(dragEvent({ files: [], types: ['Files'] } as any))).toBe(true);
      expect(c.dragEventHasFiles(dragEvent({ files: [], types: ['text/plain'] } as any))).toBe(
        false,
      );
    });

    it('dragEventHasFiles swallows errors thrown while reading types', () => {
      const dt = {
        files: { length: 0 } as any,
        get types(): string[] {
          throw new Error('boom');
        },
      };
      expect(c.dragEventHasFiles(dragEvent(dt as any))).toBe(false);
    });
  });

  // A meta payload that yields one populated draft of every block type.
  function richBlocksMeta(): Record<string, unknown> {
    return {
      blocks: [
        { type: 'text', key: 'text_b', body_markdown: { en: 'B', ro: 'b' } },
        {
          type: 'columns',
          key: 'cols_b',
          breakpoint: 'sm',
          columns: [
            { title: { en: 't1', ro: '' }, body_markdown: { en: 'x1', ro: '' } },
            { title: { en: 't2', ro: '' }, body_markdown: { en: 'x2', ro: '' } },
          ],
        },
        {
          type: 'cta',
          key: 'cta_b',
          title: { en: 'T', ro: '' },
          body_markdown: { en: 'B', ro: '' },
          cta_label: { en: 'L', ro: '' },
          cta_url: '/u',
          cta_new_tab: true,
        },
        {
          type: 'faq',
          key: 'faq_b',
          items: [{ question: { en: 'q', ro: '' }, answer_markdown: { en: 'a', ro: '' } }],
        },
        {
          type: 'testimonials',
          key: 'test_b',
          items: [
            {
              quote_markdown: { en: 'q', ro: '' },
              author: { en: 'me', ro: '' },
              role: { en: 'r', ro: '' },
            },
          ],
        },
        { type: 'product_grid', key: 'pg_cat', source: 'category', category_slug: 'cat', limit: 8 },
        { type: 'product_grid', key: 'pg_col', source: 'collection', collection_slug: 'col' },
        { type: 'product_grid', key: 'pg_prd', source: 'products', product_slugs: 'a,b,a' },
        { type: 'form', key: 'form_c', form_type: 'contact', topic: 'support' },
        { type: 'form', key: 'form_n', form_type: 'newsletter' },
        {
          type: 'image',
          key: 'img_b',
          url: '/img',
          alt: { en: 'a', ro: 'r' },
          caption: { en: 'c', ro: '' },
          link_url: '/l',
          focal_x: 10,
          focal_y: 20,
        },
        { type: 'gallery', key: 'gal_b', images: [{ url: '/g', alt: { en: 'a', ro: 'r' } }] },
        { type: 'banner', key: 'ban_b', slide: { image_url: '/b', alt: { en: 'a', ro: 'r' } } },
        {
          type: 'carousel',
          key: 'car_b',
          slides: [{ image_url: '/c', alt: { en: 'a', ro: 'r' } }],
          settings: {},
        },
      ],
    };
  }

  describe('buildPageBlocksMeta', () => {
    it('serialises every block type and keeps requires_auth when supported and flagged', () => {
      c.pageBlocks['page.about'] = c.parsePageBlocksDraft(richBlocksMeta());
      c.pageBlocks['page.about'][0].layout = null; // exercise layout default fallback
      c.pageBlocksRequiresAuth['page.about'] = true;
      const meta = c.buildPageBlocksMeta('page.about');
      const blocks = meta['blocks'] as any[];
      expect(blocks.length).toBe(14);
      expect(meta['version']).toBe(2);
      expect(meta['requires_auth']).toBe(true);
      const pgPrd = blocks.find((b) => b.key === 'pg_prd');
      expect(pgPrd.product_slugs).toEqual(['a', 'b']);
      const catB = blocks.find((b) => b.key === 'pg_cat');
      expect(catB.category_slug).toBe('cat');
      const colB = blocks.find((b) => b.key === 'pg_col');
      expect(colB.collection_slug).toBe('col');
      const formC = blocks.find((b) => b.key === 'form_c');
      expect(formC.topic).toBe('support');
    });

    it('drops requires_auth when the flag is unset', () => {
      c.pageBlocks['page.about'] = c.parsePageBlocksDraft({
        blocks: [{ type: 'text', key: 't', body_markdown: { en: 'x', ro: '' } }],
      });
      c.pageBlocksRequiresAuth['page.about'] = false;
      const meta = c.buildPageBlocksMeta('page.about');
      expect('requires_auth' in meta).toBe(false);
    });
  });

  describe('computePagePublishChecklistLocal', () => {
    it('flags empty sections and missing translations for every empty block type', () => {
      c.pageBlocksNeedsTranslationEn['page.about'] = true;
      c.pageBlocksNeedsTranslationRo['page.about'] = true;
      c.pageBlocks['page.about'] = c.parsePageBlocksDraft({
        blocks: [
          { type: 'text', key: 'text_e' },
          { type: 'columns', key: 'cols_e' },
          { type: 'cta', key: 'cta_e' },
          { type: 'faq', key: 'faq_e' },
          { type: 'testimonials', key: 'test_e' },
          { type: 'product_grid', key: 'pg_cat_e', source: 'category' },
          { type: 'product_grid', key: 'pg_col_e', source: 'collection' },
          { type: 'product_grid', key: 'pg_prd_e', source: 'products' },
          { type: 'image', key: 'img_e' },
          { type: 'gallery', key: 'gal_e' },
          { type: 'banner', key: 'ban_e' },
          { type: 'carousel', key: 'car_e' },
        ],
      });
      const res = c.computePagePublishChecklistLocal('page.about');
      expect(res.missingTranslations).toEqual(['en', 'ro']);
      expect(res.emptySections.length).toBeGreaterThanOrEqual(12);
    });

    it('reports an all-disabled page as a single empty section', () => {
      const blocks = c.parsePageBlocksDraft({
        blocks: [{ type: 'text', key: 'x', enabled: false, body_markdown: { en: 'hi', ro: '' } }],
      });
      c.pageBlocks['page.about'] = blocks;
      const res = c.computePagePublishChecklistLocal('page.about');
      expect(res.emptySections).toEqual(['adminUi.content.publishChecklist.emptyAllDisabled']);
    });

    it('flags missing alt text for populated media blocks with blank alt', () => {
      c.pageBlocks['page.about'] = c.parsePageBlocksDraft({
        blocks: [
          { type: 'image', key: 'img_a', url: '/i' },
          { type: 'gallery', key: 'gal_a', images: [{ url: '/g' }] },
          { type: 'banner', key: 'ban_a', slide: { image_url: '/b' } },
          { type: 'carousel', key: 'car_a', slides: [{ image_url: '/c' }] },
          { type: 'form', key: 'form_ok' },
        ],
      });
      const res = c.computePagePublishChecklistLocal('page.about');
      expect(res.missingAlt.length).toBeGreaterThanOrEqual(8);
      expect(res.emptySections.length).toBe(0);
    });

    it('treats fully populated content blocks as complete', () => {
      c.pageBlocks['page.about'] = c.parsePageBlocksDraft(richBlocksMeta());
      const res = c.computePagePublishChecklistLocal('page.about');
      expect(res.emptySections.length).toBe(0);
    });
  });

  describe('publish checklist modal flow', () => {
    it('computes a local checklist and merges link issues from the preview endpoint', () => {
      h.admin.linkCheckContentPreview.and.returnValue(of({ issues: [{ url: '/x', status: 404 }] }));
      c.pageBlocks['page.about'] = c.parsePageBlocksDraft({
        blocks: [{ type: 'text', key: 't', body_markdown: { en: 'hi', ro: '' } }],
      });
      c.openPagePublishChecklist('page.about');
      expect(c.pagePublishChecklistOpen).toBe(true);
      expect(c.pagePublishChecklistLoading).toBe(false);
      expect(c.pagePublishChecklistResult.linkIssues.length).toBe(1);
      expect(c.pagePublishChecklistHasIssues()).toBe(true);
    });

    it('falls back to empty link issues when the preview returns none', () => {
      h.admin.linkCheckContentPreview.and.returnValue(of({}));
      c.openPagePublishChecklist('page.about');
      expect(c.pagePublishChecklistResult.linkIssues).toEqual([]);
    });

    it('surfaces a link-check error detail', () => {
      h.admin.linkCheckContentPreview.and.returnValue(
        throwError(() => ({ error: { detail: 'nope' } })),
      );
      c.openPagePublishChecklist('page.about');
      expect(c.pagePublishChecklistError).toBe('nope');
    });

    it('uses the default link-check error when no detail is present', () => {
      h.admin.linkCheckContentPreview.and.returnValue(throwError(() => ({})));
      c.openPagePublishChecklist('page.about');
      expect(c.pagePublishChecklistError).toBe('adminUi.content.publishChecklist.errors.linkCheck');
    });

    it('hasIssues returns false without a result', () => {
      c.pagePublishChecklistResult = null;
      expect(c.pagePublishChecklistHasIssues()).toBe(false);
    });

    it('confirm saves with the checklist bypass; no-op without a key', () => {
      const save = spyOn(c, 'savePageBlocks');
      c.pagePublishChecklistKey = null;
      c.confirmPagePublishChecklist();
      expect(save).not.toHaveBeenCalled();
      c.pagePublishChecklistKey = 'page.about';
      c.confirmPagePublishChecklist();
      expect(save).toHaveBeenCalledWith('page.about', { bypassChecklist: true });
      expect(c.pagePublishChecklistOpen).toBe(false);
    });
  });

  describe('savePageBlocks', () => {
    beforeEach(() => {
      c.pageBlocks['page.about'] = c.parsePageBlocksDraft({
        blocks: [{ type: 'text', key: 't', body_markdown: { en: 'hi', ro: '' } }],
      });
    });

    it('opens the publish checklist when publishing without bypass', () => {
      const open = spyOn(c, 'openPagePublishChecklist');
      c.pageBlocksStatus['page.about'] = 'published';
      c.savePageBlocks('page.about');
      expect(open).toHaveBeenCalledWith('page.about');
    });

    it('saves a published page (bypassing checklist) with ISO publish window and maps a published response', () => {
      c.pageBlocksStatus['page.about'] = 'published';
      c.pageBlocksPublishedAt['page.about'] = '2026-01-01T10:00';
      c.pageBlocksPublishedUntil['page.about'] = '2026-02-01T10:00';
      h.admin.updateContentBlock.and.returnValue(
        of({
          status: 'published',
          published_at: '2026-01-01T10:00:00Z',
          published_until: '2026-02-01T10:00:00Z',
          meta: { requires_auth: true },
        }),
      );
      c.savePageBlocks('page.about', { bypassChecklist: true });
      const payload = h.admin.updateContentBlock.calls.mostRecent().args[1];
      expect(payload.published_at).toContain('2026-01-01');
      expect(c.pageBlocksStatus['page.about']).toBe('published');
      expect(c.pageBlocksRequiresAuth['page.about']).toBe(true);
      expect(c.pageBlocksMessage['page.about']).toBe('adminUi.site.pages.builder.success.save');
    });

    it('maps a review response and clears the publish window for drafts', () => {
      c.pageBlocksStatus['page.about'] = 'draft';
      h.admin.updateContentBlock.and.returnValue(of({ status: 'review', meta: {} }));
      c.savePageBlocks('page.about');
      const payload = h.admin.updateContentBlock.calls.mostRecent().args[1];
      expect(payload.published_at).toBeNull();
      expect(c.pageBlocksStatus['page.about']).toBe('review');
    });

    it('maps an unknown response status to draft', () => {
      c.pageBlocksStatus['page.about'] = 'draft';
      h.admin.updateContentBlock.and.returnValue(of({ status: 'weird', meta: {} }));
      c.savePageBlocks('page.about');
      expect(c.pageBlocksStatus['page.about']).toBe('draft');
    });

    it('handles a 409 conflict by surfacing the save error', () => {
      h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
      h.admin.getContent.and.returnValue(of({ status: 'draft', meta: {} }));
      c.savePageBlocks('page.about');
      expect(c.pageBlocksError['page.about']).toBe('adminUi.site.pages.builder.errors.save');
    });

    it('creates the page on a 404 and maps the created review response', () => {
      h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 404 })));
      h.admin.createContent.and.returnValue(
        of({ status: 'review', meta: { requires_auth: true } }),
      );
      c.savePageBlocks('page.about');
      expect(h.admin.createContent).toHaveBeenCalled();
      expect(c.pageBlocksStatus['page.about']).toBe('review');
      expect(c.pageBlocksMessage['page.about']).toBe('adminUi.site.pages.builder.success.save');
    });

    it('reports an error when the 404 create path also fails', () => {
      h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 404 })));
      h.admin.createContent.and.returnValue(throwError(() => ({ status: 500 })));
      c.savePageBlocks('page.about');
      expect(c.pageBlocksError['page.about']).toBe('adminUi.site.pages.builder.errors.save');
    });

    it('reports a generic save error for other failures', () => {
      h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
      c.savePageBlocks('page.about');
      expect(c.pageBlocksError['page.about']).toBe('adminUi.site.pages.builder.errors.save');
    });

    it('publishes with an empty publish window (null dates) and a null response meta, refreshing a matching preview', () => {
      c.pageBlocksStatus['page.about'] = 'published';
      c.pageBlocksPublishedAt['page.about'] = '';
      c.pageBlocksPublishedUntil['page.about'] = '';
      c.pagePreviewForSlug = 'about';
      const refresh = spyOn(c, 'refreshPagePreview');
      h.admin.updateContentBlock.and.returnValue(of({ status: 'published', meta: null }));
      c.savePageBlocks('page.about', { bypassChecklist: true });
      const payload = h.admin.updateContentBlock.calls.mostRecent().args[1];
      expect(payload.published_at).toBeNull();
      expect(c.pageBlocksRequiresAuth['page.about']).toBe(false);
      expect(refresh).toHaveBeenCalled();
    });

    it('maps a created published response with a publish window and refreshes a matching preview', () => {
      c.pagePreviewForSlug = 'about';
      const refresh = spyOn(c, 'refreshPagePreview');
      h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 404 })));
      h.admin.createContent.and.returnValue(
        of({
          status: 'published',
          published_at: '2026-01-01T00:00:00Z',
          published_until: '2026-02-01T00:00:00Z',
          meta: null,
        }),
      );
      c.savePageBlocks('page.about');
      expect(c.pageBlocksStatus['page.about']).toBe('published');
      expect(c.pageBlocksPublishedAt['page.about']).toBeTruthy();
      expect(refresh).toHaveBeenCalled();
    });

    it('maps a created draft response for an unknown status', () => {
      h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 404 })));
      h.admin.createContent.and.returnValue(of({ status: 'mystery', meta: {} }));
      c.savePageBlocks('page.about');
      expect(c.pageBlocksStatus['page.about']).toBe('draft');
    });
  });

  describe('loadSections', () => {
    it('parses meta.blocks with built-ins, duplicates, every custom type and key collisions', () => {
      h.admin.getContent.and.returnValue(
        of({
          meta: {
            blocks: [
              null,
              { type: 'story' },
              { type: 'story' }, // duplicate built-in skipped
              { type: 'bogus_type' }, // unknown -> skipped
              { type: 'text', key: 'dup', body_markdown: { en: 'B', ro: '' } },
              { type: 'text', key: 'dup' }, // key collision -> dup-1
              {
                type: 'columns',
                breakpoint: 'lg',
                columns: [
                  { title: { en: 'a', ro: '' }, body_markdown: { en: 'x', ro: '' } },
                  { title: { en: 'b', ro: '' }, body_markdown: { en: 'y', ro: '' } },
                ],
              },
              { type: 'cta', cta_url: '/u', cta_new_tab: true },
              {
                type: 'faq',
                items: [{ question: { en: 'q', ro: '' }, answer_markdown: { en: 'a', ro: '' } }],
              },
              {
                type: 'testimonials',
                items: [
                  {
                    quote_markdown: { en: 'q', ro: '' },
                    author: { en: 'me', ro: '' },
                    role: { en: 'r', ro: '' },
                  },
                ],
              },
              { type: 'image', url: '/i', link_url: '/l' },
              { type: 'gallery', images: [null, { url: '' }, { url: '/g' }] },
              { type: 'banner', slide: {} },
              { type: 'carousel', slides: [{}, {}], settings: {} },
            ],
          },
        }),
      );
      c.loadSections();
      const keys = c.homeBlocks.map((b: any) => b.key);
      expect(keys).toContain('dup');
      expect(keys).toContain('dup-1');
      expect(c.homeBlocks.some((b: any) => b.type === 'story')).toBe(true);
      expect(c.cmsHomeDraft.isReady()).toBe(true);
    });

    it('derives sections from meta.sections when no blocks are present', () => {
      h.admin.getContent.and.returnValue(
        of({ meta: { sections: [null, { id: 'story', enabled: false }, { id: 'collections' }] } }),
      );
      c.loadSections();
      const story = c.homeBlocks.find((b: any) => b.type === 'story');
      expect(story.enabled).toBe(false);
      expect(c.homeBlocks.some((b: any) => b.type === 'featured_collections')).toBe(true);
    });

    it('falls back to legacy meta.order', () => {
      h.admin.getContent.and.returnValue(of({ meta: { order: ['story', 'new'] } }));
      c.loadSections();
      expect(c.homeBlocks.some((b: any) => b.type === 'new_arrivals')).toBe(true);
    });

    it('uses defaults when meta has no usable layout', () => {
      h.admin.getContent.and.returnValue(of({ meta: { blocks: ['only-a-string'] } }));
      c.loadSections();
      expect(c.homeBlocks.length).toBeGreaterThan(0);
    });

    it('falls back to defaults and forgets the version on error', () => {
      c.contentVersions['home.sections'] = { version: 5 };
      h.admin.getContent.and.returnValue(throwError(() => ({ status: 500 })));
      c.loadSections();
      expect(c.contentVersions['home.sections']).toBeUndefined();
      expect(c.homeBlocks.length).toBeGreaterThan(0);
    });
  });

  describe('saveSections', () => {
    function populateHomeBlocks(): void {
      h.admin.getContent.and.returnValue(
        of({
          meta: {
            blocks: [
              { type: 'story' },
              { type: 'text', key: 'tx', body_markdown: { en: 'B', ro: '' } },
              {
                type: 'columns',
                key: 'co',
                columns: [
                  { title: { en: 'a', ro: '' }, body_markdown: { en: 'x', ro: '' } },
                  { title: { en: 'b', ro: '' }, body_markdown: { en: 'y', ro: '' } },
                ],
              },
              { type: 'cta', key: 'ct', cta_url: '/u' },
              {
                type: 'faq',
                key: 'fa',
                items: [{ question: { en: 'q', ro: '' }, answer_markdown: { en: 'a', ro: '' } }],
              },
              {
                type: 'testimonials',
                key: 'te',
                items: [
                  {
                    quote_markdown: { en: 'q', ro: '' },
                    author: { en: 'me', ro: '' },
                    role: { en: 'r', ro: '' },
                  },
                ],
              },
              { type: 'image', key: 'im', url: '/i' },
              { type: 'gallery', key: 'ga', images: [{ url: '/g' }] },
              { type: 'banner', key: 'ba', slide: { image_url: '/b' } },
              { type: 'carousel', key: 'ca', slides: [{ image_url: '/c' }], settings: {} },
            ],
          },
        }),
      );
      c.loadSections();
    }

    it('serialises every block type and built-in section then persists', () => {
      populateHomeBlocks();
      h.admin.updateContentBlock.and.returnValue(of({ meta: {} }));
      const refresh = spyOn(c, 'refreshHomePreview');
      c.saveSections();
      const payload = h.admin.updateContentBlock.calls.mostRecent().args[1];
      expect(payload.meta.version).toBe(2);
      expect(payload.meta.sections.some((s: any) => s.id === 'story')).toBe(true);
      expect(c.sectionsMessage).toBe('adminUi.home.sections.success.save');
      expect(refresh).toHaveBeenCalled();
    });

    it('surfaces a conflict error', () => {
      populateHomeBlocks();
      h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
      h.admin.getContent.and.returnValue(of({ meta: {} }));
      c.saveSections();
      expect(c.sectionsMessage).toBe('adminUi.home.sections.errors.save');
    });

    it('creates content on a 404 and reports success', () => {
      populateHomeBlocks();
      h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 404 })));
      h.admin.createContent.and.returnValue(of({ meta: {} }));
      c.saveSections();
      expect(c.sectionsMessage).toBe('adminUi.home.sections.success.save');
    });

    it('reports an error when the 404 create path fails', () => {
      populateHomeBlocks();
      h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 404 })));
      h.admin.createContent.and.returnValue(throwError(() => ({ status: 500 })));
      c.saveSections();
      expect(c.sectionsMessage).toBe('adminUi.home.sections.errors.save');
    });

    it('reports a generic error for other failures', () => {
      populateHomeBlocks();
      h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
      c.saveSections();
      expect(c.sectionsMessage).toBe('adminUi.home.sections.errors.save');
    });
  });

  describe('normalizeHomeSectionId aliases', () => {
    it('maps legacy aliases to canonical section ids', () => {
      expect(c.normalizeHomeSectionId('collections')).toBe('featured_collections');
      expect(c.normalizeHomeSectionId('featured')).toBe('featured_products');
      expect(c.normalizeHomeSectionId('bestsellers')).toBe('featured_products');
      expect(c.normalizeHomeSectionId('sales')).toBe('sale_products');
      expect(c.normalizeHomeSectionId('new')).toBe('new_arrivals');
      expect(c.normalizeHomeSectionId('recent')).toBe('recently_viewed');
      expect(c.normalizeHomeSectionId('recentlyViewed')).toBe('recently_viewed');
      expect(c.normalizeHomeSectionId('totally-unknown')).toBeNull();
      expect(c.normalizeHomeSectionId(42)).toBeNull();
      expect(c.normalizeHomeSectionId('   ')).toBeNull();
    });
  });

  describe('collections', () => {
    it('loads collections and resets to empty on error', () => {
      h.admin.listFeaturedCollections.and.returnValue(of([{ slug: 's', name: 'n' }]));
      c.loadCollections();
      expect(c.featuredCollections.length).toBe(1);
      h.admin.listFeaturedCollections.and.returnValue(throwError(() => ({})));
      c.loadCollections();
      expect(c.featuredCollections).toEqual([]);
    });

    it('editCollection copies a collection into the form with description/product fallbacks', () => {
      c.editCollection({ slug: 's', name: 'n', description: null, product_ids: null } as any);
      expect(c.editingCollection).toBe('s');
      expect(c.collectionForm.description).toBe('');
      expect(c.collectionForm.product_ids).toEqual([]);
    });

    it('saveCollection requires a name', () => {
      c.collectionForm = { name: '', description: '', product_ids: [] };
      c.saveCollection();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.home.collections.errors.required');
    });

    it('saveCollection creates a new collection and prepends it', () => {
      c.editingCollection = null;
      c.collectionForm = { name: 'New', description: 'd', product_ids: [] };
      h.admin.createFeaturedCollection.and.returnValue(of({ slug: 'new', name: 'New' }));
      c.saveCollection();
      expect(c.featuredCollections[0].slug).toBe('new');
      expect(c.collectionMessage).toBe('adminUi.home.collections.success.saved');
    });

    it('saveCollection updates an existing collection in place', () => {
      c.featuredCollections = [{ slug: 'x', name: 'old' }];
      c.editingCollection = 'x';
      c.collectionForm = { name: 'upd', description: '', product_ids: [] };
      h.admin.updateFeaturedCollection.and.returnValue(of({ slug: 'x', name: 'upd' }));
      c.saveCollection();
      expect(c.featuredCollections[0].name).toBe('upd');
    });

    it('saveCollection reports an error toast on failure', () => {
      c.editingCollection = null;
      c.collectionForm = { name: 'New', description: '', product_ids: [] };
      h.admin.createFeaturedCollection.and.returnValue(throwError(() => ({})));
      c.saveCollection();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.home.collections.errors.save');
    });
  });

  describe('loadCategories', () => {
    it('sorts categories by sort_order with a default of 0 and resets on error', () => {
      h.admin.getCategories.and.returnValue(of([{ slug: 'b', sort_order: 2 }, { slug: 'a' }]));
      c.loadCategories();
      expect(c.categories[0].slug).toBe('a');
      expect(c.categories[0].sort_order).toBe(0);
      h.admin.getCategories.and.returnValue(throwError(() => ({})));
      c.loadCategories();
      expect(c.categories).toEqual([]);
    });
  });

  describe('parse/serialise edge cases', () => {
    it('parsePageBlocksDraft handles non-string type/source, limit breaks and empty slugs', () => {
      const manySlugs = Array.from({ length: 60 }, (_, i) => `s${i}`);
      const result = c.parsePageBlocksDraft({
        blocks: [
          { type: 123 }, // non-string type -> skipped (covers ternary else)
          {
            type: 'faq',
            key: 'faqmax',
            items: Array.from({ length: 25 }, () => ({
              question: { en: 'q', ro: '' },
              answer_markdown: { en: 'a', ro: '' },
            })),
          },
          {
            type: 'testimonials',
            key: 'tmax',
            items: Array.from({ length: 15 }, () => ({
              quote_markdown: { en: 'q', ro: '' },
              author: { en: 'a', ro: '' },
              role: { en: 'r', ro: '' },
            })),
          },
          {
            type: 'product_grid',
            key: 'pgnum',
            source: 5,
            product_slugs: ['  ', 'ok', ...manySlugs],
          },
          {
            type: 'product_grid',
            key: 'pgstr',
            source: 'products',
            product_slugs: ['x', ...manySlugs].join(','),
          },
        ],
      });
      expect(result.find((b: any) => b.key === 'faqmax').faq_items.length).toBe(20);
      expect(result.find((b: any) => b.key === 'tmax').testimonials.length).toBe(12);
      const pgnum = result.find((b: any) => b.key === 'pgnum');
      expect(pgnum.product_grid_source).toBe('category'); // non-string source falls through
      expect(pgnum.product_grid_product_slugs.split('\n').length).toBe(50);
      expect(
        result.find((b: any) => b.key === 'pgstr').product_grid_product_slugs.split('\n').length,
      ).toBe(50);
    });

    it('buildPageBlocksMeta tolerates blocks with missing array/limit fields', () => {
      const blocks = c.parsePageBlocksDraft({
        blocks: [
          { type: 'columns', key: 'co' },
          { type: 'faq', key: 'fa' },
          { type: 'testimonials', key: 'te' },
          { type: 'carousel', key: 'ca' },
          { type: 'product_grid', key: 'pg', source: 'collection' },
          { type: 'product_grid', key: 'pg2', source: 'products' },
        ],
      });
      // Null out the array/limit fields to exercise the `|| []` / `|| 6` fallbacks.
      const co = blocks.find((b: any) => b.key === 'co');
      co.columns = null;
      const fa = blocks.find((b: any) => b.key === 'fa');
      fa.faq_items = null;
      const te = blocks.find((b: any) => b.key === 'te');
      te.testimonials = null;
      const ca = blocks.find((b: any) => b.key === 'ca');
      ca.slides = null;
      const pg = blocks.find((b: any) => b.key === 'pg');
      pg.product_grid_collection_slug = undefined;
      const pg2 = blocks.find((b: any) => b.key === 'pg2');
      pg2.product_grid_product_slugs = [
        '  ',
        'a',
        ...Array.from({ length: 60 }, (_, i) => `s${i}`),
      ].join(',');
      pg2.product_grid_limit = 'abc';
      c.pageBlocks['page.about'] = blocks;
      const meta = c.buildPageBlocksMeta('page.about');
      const out = meta['blocks'] as any[];
      expect(out.find((b) => b.key === 'co').columns).toEqual([]);
      expect(out.find((b) => b.key === 'pg2').product_slugs.length).toBe(50);
      expect(out.find((b) => b.key === 'pg2').limit).toBe(6);
    });

    it('computePagePublishChecklistLocal tolerates blocks with null collections', () => {
      const blocks = c.parsePageBlocksDraft({
        blocks: [
          { type: 'columns', key: 'co' },
          { type: 'faq', key: 'fa' },
          { type: 'testimonials', key: 'te' },
          { type: 'gallery', key: 'ga' },
          { type: 'carousel', key: 'ca' },
        ],
      });
      blocks.find((b: any) => b.key === 'co').columns = null;
      blocks.find((b: any) => b.key === 'fa').faq_items = null;
      blocks.find((b: any) => b.key === 'te').testimonials = null;
      blocks.find((b: any) => b.key === 'ga').images = null;
      blocks.find((b: any) => b.key === 'ca').slides = null;
      c.pageBlocks['page.about'] = blocks;
      const res = c.computePagePublishChecklistLocal('page.about');
      expect(res.emptySections.length).toBe(5);
    });

    it('loadSections covers limit breaks, non-string fields, null entries and empty carousels', () => {
      h.admin.getContent.and.returnValue(
        of({
          meta: {
            blocks: [
              { type: 456 }, // non-string type
              {
                type: 'columns',
                key: 'co4',
                columns: [
                  null,
                  { title: { en: 'a', ro: '' } },
                  { title: { en: 'b', ro: '' } },
                  { title: { en: 'c', ro: '' } },
                  { title: { en: 'd', ro: '' } },
                ],
              },
              { type: 'cta', key: 'cta_n', cta_url: 99 },
              {
                type: 'faq',
                key: 'faq_max',
                items: [
                  null,
                  ...Array.from({ length: 25 }, () => ({ question: { en: 'q', ro: '' } })),
                ],
              },
              {
                type: 'testimonials',
                key: 't_max',
                items: [
                  3,
                  ...Array.from({ length: 15 }, () => ({ quote_markdown: { en: 'q', ro: '' } })),
                ],
              },
              { type: 'image', key: 'img_n', url: 12, link_url: 7 },
              { type: 'gallery', key: 'gal_n', images: [{ url: 5 }] },
              { type: 'carousel', key: 'car_empty', slides: [] },
            ],
          },
        }),
      );
      c.loadSections();
      expect(c.homeBlocks.find((b: any) => b.key === 'faq_max').faq_items.length).toBe(20);
      expect(c.homeBlocks.find((b: any) => b.key === 't_max').testimonials.length).toBe(12);
      expect(c.homeBlocks.find((b: any) => b.key === 'car_empty').slides.length).toBe(1);
      expect(c.homeBlocks.find((b: any) => b.key === 'co4').columns.length).toBe(3);
    });

    it('loadSections uses an empty meta when the block has no meta', () => {
      h.admin.getContent.and.returnValue(of({}));
      c.loadSections();
      expect(c.homeBlocks.length).toBeGreaterThan(0);
    });
  });

  describe('insertPageMediaFiles createdKey + array fallbacks', () => {
    const png = (n = 'a.png') => new File(['x'], n, { type: 'image/png' });
    beforeEach(() => {
      h.admin.uploadContentImage.and.returnValue(
        of({ images: [{ url: 'https://cdn/x.png', focal_x: 50, focal_y: 50 }] }),
      );
    });

    it('aborts single-image insertion when the block could not be created', async () => {
      spyOn(c, 'insertPageBlockAt').and.returnValue(null);
      delete c.pageBlocks['page.about'];
      await c.insertPageMediaFiles('page.about', 0, [png()]);
      expect(c.pageBlocks['page.about'] || []).toEqual([]);
    });

    it('aborts gallery insertion when the block could not be created', async () => {
      spyOn(c, 'insertPageBlockAt').and.returnValue(null);
      delete c.pageBlocks['page.about'];
      await c.insertPageMediaFiles('page.about', 0, [png('a.png'), png('b.png')]);
      expect(c.pageBlocks['page.about'] || []).toEqual([]);
    });

    it('stops multi-image insertion as soon as a block cannot be created', async () => {
      spyOn(c, 'allowedPageBlockTypesForKey').and.returnValue(['image']);
      spyOn(c, 'insertPageBlockAt').and.returnValue(null);
      delete c.pageBlocks['page.about'];
      await c.insertPageMediaFiles('page.about', 0, [png('a.png'), png('b.png')]);
      expect(c.pageBlocks['page.about'] || []).toEqual([]);
    });

    it('leaves an unrelated block untouched while inserting a single image', async () => {
      const existing = c.parsePageBlocksDraft({
        blocks: [{ type: 'text', key: 'keep', body_markdown: { en: 'x', ro: '' } }],
      });
      c.pageBlocks['page.about'] = existing;
      await c.insertPageMediaFiles('page.about', 0, [png()]);
      expect(c.pageBlocks['page.about'].some((b: any) => b.key === 'keep')).toBe(true);
      expect(c.pageBlocks['page.about'].some((b: any) => b.type === 'image')).toBe(true);
    });
  });

  function blogPost(
    key: string,
    meta: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ): any {
    return { key, title: key, status: 'published', meta, ...extra };
  }

  describe('blog pins', () => {
    it('pinnedSlotFromMeta interprets boolean/number/string pinned flags and pin_order', () => {
      expect(c.pinnedSlotFromMeta(null)).toBeNull();
      expect(c.pinnedSlotFromMeta({ pinned: false })).toBeNull();
      expect(c.pinnedSlotFromMeta({ pinned: 2 })).toBeNull(); // number !== 1 -> not pinned
      expect(c.pinnedSlotFromMeta({ pinned: 1, pin_order: 3 })).toBe(3);
      expect(c.pinnedSlotFromMeta({ pinned: 'yes', pin_order: '4' })).toBe(4);
      expect(c.pinnedSlotFromMeta({ pinned: 'no' })).toBeNull();
      expect(c.pinnedSlotFromMeta({ pinned: true, pin_order: 'bad' })).toBe(1);
      expect(c.pinnedSlotFromMeta({ pinned: true, pin_order: -5 })).toBe(1);
    });

    it('blogPinnedPosts sorts by order then publish date then updated_at', () => {
      c.contentBlocks = [
        blogPost(
          'blog.a',
          { pinned: true, pin_order: 1 },
          { published_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01' },
        ),
        blogPost(
          'blog.b',
          { pinned: true, pin_order: 1 },
          { published_at: '2026-03-01T00:00:00Z', updated_at: '2026-02-01' },
        ),
        blogPost('blog.c', { pinned: true, pin_order: 1 }, { updated_at: '2026-05-01' }),
        blogPost('blog.d', { pinned: true, pin_order: 1 }, { updated_at: '2026-04-01' }),
        blogPost('blog.x', {}),
      ];
      const order = c.blogPinnedPosts().map((p: any) => p.key);
      // Same order: newest published first (b), then those without a date sorted by updated_at desc (c before d), then a.
      expect(order[0]).toBe('blog.b');
      expect(order).not.toContain('blog.x');
      expect(order.indexOf('blog.c')).toBeLessThan(order.indexOf('blog.d'));
    });

    it('nextBlogPinOrder returns one past the max pinned order', () => {
      c.contentBlocks = [
        blogPost('blog.a', { pinned: true, pin_order: 2 }),
        blogPost('blog.b', { pinned: true, pin_order: 5 }),
        blogPost('blog.c', {}),
      ];
      expect(c.nextBlogPinOrder()).toBe(6);
      c.contentBlocks = [blogPost('blog.z', {})];
      expect(c.nextBlogPinOrder()).toBe(1);
    });

    it('onBlogPinDrop ignores empty / identical / in-flight drops', async () => {
      c.draggingBlogPinKey = null;
      await c.onBlogPinDrop('blog.a');
      expect(h.admin.updateContentBlock).not.toHaveBeenCalled();

      c.draggingBlogPinKey = 'blog.a';
      c.blogPinsSaving = true;
      await c.onBlogPinDrop('blog.b');
      expect(h.admin.updateContentBlock).not.toHaveBeenCalled();
      c.blogPinsSaving = false;

      c.draggingBlogPinKey = 'blog.a';
      await c.onBlogPinDrop('blog.a');
      expect(h.admin.updateContentBlock).not.toHaveBeenCalled();
    });

    it('onBlogPinDrop returns when a key is not among the pinned posts', async () => {
      c.contentBlocks = [blogPost('blog.a', { pinned: true, pin_order: 1 })];
      c.draggingBlogPinKey = 'blog.a';
      await c.onBlogPinDrop('blog.missing');
      expect(h.admin.updateContentBlock).not.toHaveBeenCalled();
    });

    it('onBlogPinDrop reorders pinned posts and persists changed orders', async () => {
      c.contentBlocks = [
        blogPost('blog.a', { pinned: true, pin_order: 1 }),
        blogPost('blog.b', { pinned: true, pin_order: 2 }),
        blogPost('blog.c', { pinned: true, pin_order: 3 }),
      ];
      h.admin.updateContentBlock.and.returnValue(of({ key: 'blog.a' }));
      const reload = spyOn(c, 'reloadContentBlocks');
      c.draggingBlogPinKey = 'blog.a';
      await c.onBlogPinDrop('blog.c');
      expect(h.admin.updateContentBlock).toHaveBeenCalled();
      expect(h.toast.success).toHaveBeenCalledWith('adminUi.blog.pins.success.reordered');
      expect(reload).toHaveBeenCalled();
    });

    it('onBlogPinDrop reports an error when persistence fails', async () => {
      c.contentBlocks = [
        blogPost('blog.a', { pinned: true, pin_order: 1 }),
        blogPost('blog.b', { pinned: true, pin_order: 2 }),
      ];
      h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
      spyOn(c, 'reloadContentBlocks');
      c.draggingBlogPinKey = 'blog.b';
      await c.onBlogPinDrop('blog.a');
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.blog.pins.errors.reorder');
      expect(c.blogPinsSaving).toBe(false);
    });

    it('onBlogPinDrop is a no-op when the new ordering matches the current one', async () => {
      c.contentBlocks = [
        blogPost('blog.a', { pinned: true, pin_order: 1 }),
        blogPost('blog.b', { pinned: true, pin_order: 2 }),
        blogPost('blog.c', { pinned: true, pin_order: 3 }),
      ];
      c.draggingBlogPinKey = 'blog.a';
      // Dropping a (index 0) onto its immediate successor b reinserts a at index 0,
      // so every order is unchanged and no update request is issued.
      await c.onBlogPinDrop('blog.b');
      expect(h.admin.updateContentBlock).not.toHaveBeenCalled();
    });
  });

  describe('createBlogPost', () => {
    function primeCreate(over: Record<string, unknown> = {}): void {
      c.blogCreate = {
        baseLang: 'en',
        status: 'draft',
        published_at: '',
        published_until: '',
        title: 'My Post',
        body_markdown: 'Body',
        summary: '',
        tags: '',
        series: '',
        cover_image_url: '',
        reading_time_minutes: '',
        pinned: false,
        pin_order: '',
        includeTranslation: false,
        translationTitle: '',
        translationBody: '',
        ...over,
      };
    }

    it('requires a slug derived from the title', async () => {
      primeCreate({ title: '' });
      await c.createBlogPost();
      expect(h.toast.error).toHaveBeenCalledWith(
        'adminUi.blog.errors.slugRequiredTitle',
        'adminUi.blog.errors.slugRequiredCopy',
      );
      expect(h.admin.createContent).not.toHaveBeenCalled();
    });

    it('requires both a title and a body', async () => {
      primeCreate({ body_markdown: '   ' });
      await c.createBlogPost();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.blog.errors.titleBodyRequired');
    });

    it('creates a fully populated post with meta, publish window and translation', async () => {
      primeCreate({
        summary: 'Sum',
        tags: 'a, b',
        series: 'S',
        cover_image_url: '/cov',
        reading_time_minutes: '5',
        pinned: true,
        pin_order: '3',
        published_at: '2026-01-01T10:00',
        published_until: '2026-02-01T10:00',
        includeTranslation: true,
        translationTitle: 'TT',
        translationBody: 'TB',
      });
      h.admin.createContent.and.returnValue(of({ key: 'blog.my-post' }));
      h.admin.updateContentBlock.and.returnValue(of({ key: 'blog.my-post' }));
      const load = spyOn(c, 'loadBlogEditor');
      spyOn(c, 'reloadContentBlocks');
      await c.createBlogPost();
      const meta = h.admin.createContent.calls.mostRecent().args[1].meta;
      expect(meta.summary).toEqual({ en: 'Sum' });
      expect(meta.tags).toEqual(['a', 'b']);
      expect(meta.series).toBe('S');
      expect(meta.cover_image_url).toBe('/cov');
      expect(meta.reading_time_minutes).toBe(5);
      expect(meta.pin_order).toBe(3);
      expect(h.admin.updateContentBlock).toHaveBeenCalled();
      expect(h.toast.success).toHaveBeenCalledWith('adminUi.blog.success.created');
      expect(load).toHaveBeenCalledWith('blog.my-post');
    });

    it('falls back to nextBlogPinOrder when pinned without a valid order, and to base title/body for an empty translation', async () => {
      c.contentBlocks = [blogPost('blog.z', { pinned: true, pin_order: 4 })];
      primeCreate({
        pinned: true,
        pin_order: '',
        includeTranslation: true,
        translationTitle: '',
        translationBody: 'only body',
      });
      h.admin.createContent.and.returnValue(of({ key: 'blog.my-post' }));
      h.admin.updateContentBlock.and.returnValue(of({}));
      spyOn(c, 'loadBlogEditor');
      spyOn(c, 'reloadContentBlocks');
      await c.createBlogPost();
      expect(h.admin.createContent.calls.mostRecent().args[1].meta.pin_order).toBe(5);
      expect(h.admin.updateContentBlock.calls.mostRecent().args[1].title).toBe('My Post');
    });

    it('retries with a suffixed slug when the key already exists', async () => {
      primeCreate();
      let calls = 0;
      h.admin.createContent.and.callFake((key: string) => {
        calls += 1;
        if (calls === 1) return throwError(() => ({ error: { detail: 'Content key exists' } }));
        return of({ key });
      });
      spyOn(c, 'loadBlogEditor');
      spyOn(c, 'reloadContentBlocks');
      await c.createBlogPost();
      expect(calls).toBe(2);
      expect(h.admin.createContent.calls.mostRecent().args[0]).toBe('blog.my-post-2');
    });

    it('reports a create error for non-conflict failures', async () => {
      primeCreate();
      h.admin.createContent.and.returnValue(throwError(() => ({ error: { detail: 'boom' } })));
      await c.createBlogPost();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.blog.errors.create');
    });

    it('skips the translation request when both translation fields are empty', async () => {
      primeCreate({ includeTranslation: true, translationTitle: '', translationBody: '' });
      h.admin.createContent.and.returnValue(of({ key: 'blog.my-post' }));
      spyOn(c, 'loadBlogEditor');
      spyOn(c, 'reloadContentBlocks');
      await c.createBlogPost();
      expect(h.admin.updateContentBlock).not.toHaveBeenCalled();
    });
  });

  describe('setBlogEditLang', () => {
    it('returns immediately without a selected post', () => {
      c.selectedBlogKey = null;
      c.setBlogEditLang('ro');
      expect(h.admin.getContent).not.toHaveBeenCalled();
    });

    it('loads the base language and applies status + publish window', () => {
      c.selectedBlogKey = 'blog.a';
      c.blogBaseLang = 'en';
      h.admin.getContent.and.returnValue(
        of({
          title: 'T',
          body_markdown: 'B',
          status: 'published',
          published_at: '2026-01-01T00:00:00Z',
          published_until: '2026-02-01T00:00:00Z',
          meta: { summary: { en: 's' } },
        }),
      );
      c.setBlogEditLang('en');
      expect(c.blogForm.status).toBe('published');
      expect(c.blogForm.published_at).toBeTruthy();
      expect(h.admin.getContent).toHaveBeenCalledWith('blog.a', undefined);
    });

    it('loads a translation language without touching status and falls back to existing meta', () => {
      c.selectedBlogKey = 'blog.a';
      c.blogBaseLang = 'en';
      c.blogForm.status = 'draft';
      c.blogMeta = { existing: true };
      h.admin.getContent.and.returnValue(
        of({ title: 'T', body_markdown: 'B', status: 'published', meta: null }),
      );
      c.setBlogEditLang('ro');
      expect(c.blogForm.status).toBe('draft');
      expect(c.blogMeta).toEqual({ existing: true });
      expect(h.admin.getContent).toHaveBeenCalledWith('blog.a', 'ro');
    });

    it('reports a load error', () => {
      c.selectedBlogKey = 'blog.a';
      h.admin.getContent.and.returnValue(throwError(() => ({})));
      c.setBlogEditLang('en');
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.blog.errors.loadContent');
    });
  });

  describe('saveBlogPost', () => {
    beforeEach(() => {
      c.selectedBlogKey = 'blog.a';
      c.blogBaseLang = 'en';
      c.blogEditLang = 'en';
      c.blogForm = {
        ...c.blogForm,
        title: 'Title',
        body_markdown: 'Body',
        status: 'draft',
        published_at: '',
        published_until: '',
      };
      c.blogMeta = {};
      spyOn(c, 'reloadContentBlocks');
      spyOn(c, 'loadBlogEditor');
    });

    it('returns without a selected post', () => {
      c.selectedBlogKey = null;
      c.saveBlogPost();
      expect(h.admin.updateContentBlock).not.toHaveBeenCalled();
    });

    it('requires a title and body', () => {
      c.blogForm.body_markdown = '  ';
      c.saveBlogPost();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.blog.errors.titleBodyRequired');
    });

    it('saves the base language with an ISO publish window and reloads', () => {
      c.blogForm.published_at = '2026-01-01T10:00';
      c.blogForm.published_until = '2026-02-01T10:00';
      h.admin.updateContentBlock.and.returnValue(of({ key: 'blog.a' }));
      c.saveBlogPost();
      const payload = h.admin.updateContentBlock.calls.mostRecent().args[1];
      expect(payload.published_at).toContain('2026-01-01');
      expect(h.toast.success).toHaveBeenCalledWith('adminUi.blog.success.saved');
      expect(c.loadBlogEditor).toHaveBeenCalledWith('blog.a');
    });

    it('aborts a published save when a11y issues are present and the user cancels', () => {
      c.blogForm.status = 'published';
      spyOn(c, 'blogA11yIssues').and.returnValue([{ key: 'x' }]);
      spyOn(window, 'confirm').and.returnValue(false);
      c.saveBlogPost();
      expect(h.admin.updateContentBlock).not.toHaveBeenCalled();
      expect(c.blogA11yOpen).toBe(true);
    });

    it('continues a published save when the user confirms despite a11y issues', () => {
      c.blogForm.status = 'published';
      spyOn(c, 'blogA11yIssues').and.returnValue([{ key: 'x' }]);
      spyOn(window, 'confirm').and.returnValue(true);
      h.admin.updateContentBlock.and.returnValue(of({ key: 'blog.a' }));
      c.saveBlogPost();
      expect(h.admin.updateContentBlock).toHaveBeenCalled();
    });

    it('handles a base-save 409 conflict silently', () => {
      h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
      c.saveBlogPost();
      expect(h.toast.error).not.toHaveBeenCalledWith('adminUi.blog.errors.save');
    });

    it('reports a base-save error', () => {
      h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
      c.saveBlogPost();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.blog.errors.save');
    });

    it('saves a translation without a meta change', () => {
      c.blogEditLang = 'ro';
      spyOn(c, 'buildBlogMeta').and.returnValue({});
      spyOn(c, 'setBlogEditLang');
      h.admin.updateContentBlock.and.returnValue(of({ key: 'blog.a' }));
      c.saveBlogPost();
      expect(h.admin.updateContentBlock).toHaveBeenCalledTimes(1);
      expect(h.toast.success).toHaveBeenCalledWith('adminUi.blog.success.translationSaved');
    });

    it('saves a translation and its changed meta in a second request', () => {
      c.blogEditLang = 'ro';
      spyOn(c, 'buildBlogMeta').and.returnValue({ changed: true });
      spyOn(c, 'setBlogEditLang');
      h.admin.updateContentBlock.and.returnValue(of({ key: 'blog.a' }));
      c.saveBlogPost();
      expect(h.admin.updateContentBlock).toHaveBeenCalledTimes(2);
      expect(h.toast.success).toHaveBeenCalledWith('adminUi.blog.success.translationSaved');
    });

    it('reports a translation meta-save error but still finishes', () => {
      c.blogEditLang = 'ro';
      spyOn(c, 'buildBlogMeta').and.returnValue({ changed: true });
      spyOn(c, 'setBlogEditLang');
      let n = 0;
      h.admin.updateContentBlock.and.callFake(() => {
        n += 1;
        return n === 1 ? of({ key: 'blog.a' }) : throwError(() => ({ status: 500 }));
      });
      c.saveBlogPost();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.blog.errors.translationMetaSave');
    });

    it('handles a translation meta-save 409 conflict silently', () => {
      c.blogEditLang = 'ro';
      spyOn(c, 'buildBlogMeta').and.returnValue({ changed: true });
      spyOn(c, 'setBlogEditLang');
      let n = 0;
      h.admin.updateContentBlock.and.callFake(() => {
        n += 1;
        return n === 1 ? of({ key: 'blog.a' }) : throwError(() => ({ status: 409 }));
      });
      c.saveBlogPost();
      expect(h.toast.error).not.toHaveBeenCalledWith('adminUi.blog.errors.translationMetaSave');
    });

    it('reports a translation-save error', () => {
      c.blogEditLang = 'ro';
      spyOn(c, 'buildBlogMeta').and.returnValue({ changed: true });
      h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
      c.saveBlogPost();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.blog.errors.translationSave');
    });
  });

  describe('blog SEO', () => {
    function keysOf(issues: any[]): string[] {
      return issues.map((i) => i.key);
    }

    it('flags short title, short description, derived summary and missing preview token', () => {
      spyOn(c, 'blogSeoTitleFull').and.returnValue('Tiny');
      spyOn(c, 'blogSeoDescriptionFull').and.returnValue('short desc');
      spyOn(c, 'blogSeoDescriptionSource').and.returnValue('x');
      spyOn(c, 'getBlogSummary').and.returnValue('');
      c.blogForm = { ...c.blogForm, status: 'draft' };
      c.blogPreviewToken = '';
      const keys = keysOf(c.blogSeoIssues('en'));
      expect(keys).toContain('adminUi.blog.seo.issues.titleTooShort');
      expect(keys).toContain('adminUi.blog.seo.issues.descriptionTooShort');
      expect(keys).toContain('adminUi.blog.seo.issues.derivedFromBody');
      expect(keys).toContain('adminUi.blog.seo.issues.previewTokenRecommended');
    });

    it('flags missing title/description and an over-long source description', () => {
      spyOn(c, 'blogSeoTitleFull').and.returnValue('   ');
      spyOn(c, 'blogSeoDescriptionFull').and.returnValue('');
      spyOn(c, 'blogSeoDescriptionSource').and.returnValue('a'.repeat(200));
      spyOn(c, 'getBlogSummary').and.returnValue('has summary');
      c.blogForm = { ...c.blogForm, status: 'published' };
      c.blogPreviewToken = 'tok';
      const keys = keysOf(c.blogSeoIssues('en'));
      expect(keys).toContain('adminUi.blog.seo.issues.missingTitle');
      expect(keys).toContain('adminUi.blog.seo.issues.missingDescription');
      expect(keys).toContain('adminUi.blog.seo.issues.descriptionTooLong');
      expect(keys).not.toContain('adminUi.blog.seo.issues.derivedFromBody');
      expect(keys).not.toContain('adminUi.blog.seo.issues.previewTokenRecommended');
    });

    it('flags an over-long title', () => {
      spyOn(c, 'blogSeoTitleFull').and.returnValue('a'.repeat(80));
      spyOn(c, 'blogSeoDescriptionFull').and.returnValue(
        'a fully sufficient meta description that is comfortably beyond seventy characters total',
      );
      spyOn(c, 'blogSeoDescriptionSource').and.returnValue('short source');
      spyOn(c, 'getBlogSummary').and.returnValue('summary');
      const keys = keysOf(c.blogSeoIssues('en'));
      expect(keys).toContain('adminUi.blog.seo.issues.titleTooLong');
    });

    it('blogSeoDescriptionSource prefers the summary, then the editing-language body', () => {
      c.blogEditLang = 'en';
      c.blogMeta = { summary: { en: 'A crafted summary' } };
      c.blogForm = { ...c.blogForm, body_markdown: 'Body text' };
      expect(c.blogSeoDescriptionSource('en')).toBe('A crafted summary');
      c.blogMeta = {};
      expect(c.blogSeoDescriptionSource('en')).toBe('Body text');
    });

    it('blogSeoDescriptionSource uses the snapshot body for a non-editing language', () => {
      c.blogEditLang = 'en';
      c.blogMeta = {};
      c.blogSeoSnapshots = { ro: { body_markdown: 'Ro snapshot body' } } as any;
      expect(c.blogSeoDescriptionSource('ro')).toBe('Ro snapshot body');
      c.blogSeoSnapshots = {} as any;
      expect(c.blogSeoDescriptionSource('ro')).toBe('');
    });
  });

  describe('extractMarkdownHeadings', () => {
    it('skips fenced code, deep levels and empty headings, and caps at 40', () => {
      const many = Array.from({ length: 45 }, (_, i) => `# Heading ${i}`).join('\n');
      const md = ['```', '# inside code', '```', '#### too deep', '# ![](http://x)', many].join(
        '\n',
      );
      const headings = c.extractMarkdownHeadings(md);
      expect(headings.length).toBe(40);
      expect(headings.every((h: any) => h.text !== 'inside code')).toBe(true);
      expect(headings[0].text).toBe('Heading 0');
    });
  });

  describe('blog cover helpers', () => {
    it('blogCoverPreviewUrl prefers an explicit url, then the first image, else null', () => {
      c.blogForm = { ...c.blogForm, cover_image_url: '  /explicit  ' };
      c.blogImages = [{ url: '/first' }];
      expect(c.blogCoverPreviewUrl()).toBe('/explicit');
      c.blogForm.cover_image_url = '';
      expect(c.blogCoverPreviewUrl()).toBe('/first');
      c.blogImages = [{ url: '' }];
      expect(c.blogCoverPreviewUrl()).toBeNull();
      c.blogImages = [];
      expect(c.blogCoverPreviewUrl()).toBeNull();
    });

    it('blogCoverPreviewAsset returns the matching image or null', () => {
      c.blogForm = { ...c.blogForm, cover_image_url: '' };
      c.blogImages = [];
      expect(c.blogCoverPreviewAsset()).toBeNull();
      c.blogImages = [{ id: 'i', url: '/u', focal_x: 30, focal_y: 70 }];
      c.blogForm.cover_image_url = '/u';
      expect(c.blogCoverPreviewAsset().id).toBe('i');
      c.blogForm.cover_image_url = '/missing';
      expect(c.blogCoverPreviewAsset()).toBeNull();
    });

    it('blogCoverPreviewFocalPosition clamps focal values, defaulting to centre', () => {
      c.blogForm = { ...c.blogForm, cover_image_url: '' };
      c.blogImages = [];
      expect(c.blogCoverPreviewFocalPosition()).toBe('50% 50%');
      c.blogImages = [{ id: 'i', url: '/u', focal_x: 30, focal_y: 70 }];
      c.blogForm.cover_image_url = '/u';
      expect(c.blogCoverPreviewFocalPosition()).toBe('30% 70%');
    });
  });

  describe('uploadBlogCoverImage', () => {
    function evt(file?: File): any {
      return { target: { files: file ? [file] : [], value: 'x' } };
    }
    beforeEach(() => {
      c.selectedBlogKey = 'blog.a';
      c.blogEditLang = 'en';
      c.blogBaseLang = 'en';
    });

    it('returns without a key, on a non-base language, or with no file', () => {
      c.selectedBlogKey = null;
      c.uploadBlogCoverImage(evt(new File(['x'], 'a.png')));
      c.selectedBlogKey = 'blog.a';
      c.blogEditLang = 'ro';
      c.uploadBlogCoverImage(evt(new File(['x'], 'a.png')));
      c.blogEditLang = 'en';
      c.uploadBlogCoverImage(evt());
      expect(h.admin.uploadContentImage).not.toHaveBeenCalled();
    });

    it('sets the cover url from the last uploaded image', () => {
      h.admin.uploadContentImage.and.returnValue(of({ images: [{ id: '1', url: '/cover' }] }));
      c.uploadBlogCoverImage(evt(new File(['x'], 'a.png')));
      expect(c.blogForm.cover_image_url).toBe('/cover');
      expect(h.toast.success).toHaveBeenCalledWith('adminUi.blog.images.success.uploaded');
    });

    it('still toasts success when the response has no usable image', () => {
      c.blogForm.cover_image_url = '';
      h.admin.uploadContentImage.and.returnValue(of({ images: [] }));
      c.uploadBlogCoverImage(evt(new File(['x'], 'a.png')));
      expect(c.blogForm.cover_image_url).toBe('');
      expect(h.toast.success).toHaveBeenCalled();
    });

    it('reports an upload error', () => {
      h.admin.uploadContentImage.and.returnValue(throwError(() => ({})));
      c.uploadBlogCoverImage(evt(new File(['x'], 'a.png')));
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.blog.images.errors.upload');
    });
  });

  describe('selectBlogCoverAsset', () => {
    beforeEach(() => {
      c.blogEditLang = 'en';
      c.blogBaseLang = 'en';
      c.blogImages = [];
    });

    it('ignores assets without a url, a non-base language, or without an id', () => {
      c.selectBlogCoverAsset({ url: '' } as any);
      expect(c.blogForm.cover_image_url).toBeFalsy();
      c.blogEditLang = 'ro';
      c.selectBlogCoverAsset({ url: '/u', id: 'i' } as any);
      c.blogEditLang = 'en';
      c.selectBlogCoverAsset({ url: '/u', id: '' } as any);
      expect(c.blogImages.length).toBe(0);
    });

    it('appends a new image with finite/non-finite focal fallbacks', () => {
      c.selectBlogCoverAsset({
        url: '/u',
        id: 'i',
        sort_order: 'x',
        focal_x: 'y',
        focal_y: 5,
      } as any);
      expect(c.blogImages.length).toBe(1);
      expect(c.blogImages[0].sort_order).toBe(0);
      expect(c.blogImages[0].focal_x).toBe(50);
      expect(c.blogImages[0].focal_y).toBe(5);
    });

    it('merges into an existing image row by id', () => {
      c.blogImages = [{ id: 'i', url: '/old', sort_order: 2, focal_x: 10, focal_y: 10 }];
      c.selectBlogCoverAsset({
        url: '/new',
        id: 'i',
        sort_order: 1,
        focal_x: 20,
        focal_y: 30,
      } as any);
      const row = c.blogImages.find((x: any) => x.id === 'i');
      expect(row.url).toBe('/new');
      expect(row.focal_x).toBe(20);
    });
  });

  describe('editBlogCoverFocalPoint', () => {
    beforeEach(() => {
      c.blogEditLang = 'en';
      c.blogBaseLang = 'en';
      c.blogForm = { ...c.blogForm, cover_image_url: '/u' };
      c.blogImages = [{ id: 'i', url: '/u', focal_x: 40, focal_y: 60 }];
    });

    it('returns on a non-base language or with no cover asset', () => {
      c.blogEditLang = 'ro';
      c.editBlogCoverFocalPoint();
      c.blogEditLang = 'en';
      c.blogImages = [];
      c.editBlogCoverFocalPoint();
      expect(h.admin.updateContentImageFocalPoint).not.toHaveBeenCalled();
    });

    it('returns when the prompt is cancelled or malformed', () => {
      const prompt = spyOn(window, 'prompt').and.returnValue(null);
      c.editBlogCoverFocalPoint();
      expect(h.admin.updateContentImageFocalPoint).not.toHaveBeenCalled();
      prompt.and.returnValue('only-one');
      c.editBlogCoverFocalPoint();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.site.assets.library.focalErrorsFormat');
    });

    it('persists a parsed focal point and updates the matching image', () => {
      spyOn(window, 'prompt').and.returnValue('20, 80');
      h.admin.updateContentImageFocalPoint.and.returnValue(of({ focal_x: 20, focal_y: 80 }));
      c.editBlogCoverFocalPoint();
      expect(h.admin.updateContentImageFocalPoint).toHaveBeenCalledWith('i', 20, 80);
      expect(c.blogImages[0].focal_x).toBe(20);
      expect(h.toast.success).toHaveBeenCalledWith('adminUi.site.assets.library.focalSaved');
    });

    it('reports a focal-point save error', () => {
      spyOn(window, 'prompt').and.returnValue('20, 80');
      h.admin.updateContentImageFocalPoint.and.returnValue(throwError(() => ({})));
      c.editBlogCoverFocalPoint();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.site.assets.library.focalErrorsSave');
    });
  });

  describe('markdown insertion helpers', () => {
    function fakeArea(value: string, selStart: number | null, selEnd: number | null): any {
      return { value, selectionStart: selStart, selectionEnd: selEnd };
    }

    it('insertBlogLink wraps a selection and defaults its text when none is selected', () => {
      const upd = spyOn(c, 'updateBlogBody');
      c.insertBlogLink(fakeArea('hello world', 0, 5));
      expect(upd.calls.mostRecent().args[1]).toBe('[hello](https://) world');
      upd.calls.reset();
      c.insertBlogLink(fakeArea('abc', null, null));
      expect(upd.calls.mostRecent().args[1]).toBe('[link text](https://)abc');
    });

    it('insertBlogCodeBlock fences a selection or a placeholder', () => {
      const upd = spyOn(c, 'updateBlogBody');
      c.insertBlogCodeBlock(fakeArea('xy', 0, 2));
      expect(upd.calls.mostRecent().args[1]).toContain('```\nxy\n```');
      upd.calls.reset();
      c.insertBlogCodeBlock(fakeArea('', null, null));
      expect(upd.calls.mostRecent().args[1]).toContain('```\ncode\n```');
    });

    it('prefixBlogLines prefixes only non-empty, not-yet-prefixed lines across a multi-line selection', () => {
      const upd = spyOn(c, 'updateBlogBody');
      c.prefixBlogLines(fakeArea('one\n\n- two\nthree', 0, 16), '- ');
      const next = upd.calls.mostRecent().args[1];
      expect(next).toContain('- one');
      expect(next).toContain('- three');
      expect(next).toContain('- two'); // already prefixed -> unchanged
    });

    it('prefixBlogLines handles a single caret with no trailing newline', () => {
      const upd = spyOn(c, 'updateBlogBody');
      c.prefixBlogLines(fakeArea('solo line', 2, 2), '> ');
      expect(upd.calls.mostRecent().args[1]).toBe('> solo line');
    });
  });

  describe('uploadAndInsertBlogImage', () => {
    function evt(file?: File): any {
      return { target: { files: file ? [file] : [], value: 'x' } };
    }
    beforeEach(() => {
      c.selectedBlogKey = 'blog.a';
      c.blogImageLayout = 'default';
    });

    it('returns without a selected post or a file', () => {
      c.selectedBlogKey = null;
      c.uploadAndInsertBlogImage(
        { insertMarkdown: () => undefined } as any,
        evt(new File(['x'], 'a.png')),
      );
      c.selectedBlogKey = 'blog.a';
      c.uploadAndInsertBlogImage({ insertMarkdown: () => undefined } as any, evt());
      expect(h.admin.uploadContentImage).not.toHaveBeenCalled();
    });

    it('inserts plain markdown into a rich editor with default layout', () => {
      const editor = { insertMarkdown: jasmine.createSpy('insertMarkdown') };
      h.admin.uploadContentImage.and.returnValue(of({ images: [{ id: '1', url: '/x.png' }] }));
      c.uploadAndInsertBlogImage(editor as any, evt(new File(['x'], 'My Pic.png')));
      expect(editor.insertMarkdown).toHaveBeenCalledWith('![My Pic](/x.png)');
      expect(h.toast.info).toHaveBeenCalledWith('adminUi.blog.images.success.insertedMarkdown');
    });

    it('inserts a layout-tagged snippet into a textarea', () => {
      c.blogImageLayout = 'wide';
      const ta = document.createElement('textarea');
      const insert = spyOn(c, 'insertAtCursor');
      h.admin.uploadContentImage.and.returnValue(
        of({ images: [{ id: '1', url: '/x.png', sort_order: 1, focal_x: 10, focal_y: 20 }] }),
      );
      c.uploadAndInsertBlogImage(ta, evt(new File(['x'], '.png')));
      expect(insert.calls.mostRecent().args[1]).toBe('![image](/x.png "wide")');
    });

    it('skips insertion when the upload has no usable image, and reports errors', () => {
      const editor = { insertMarkdown: jasmine.createSpy('insertMarkdown') };
      h.admin.uploadContentImage.and.returnValue(of({ images: [] }));
      c.uploadAndInsertBlogImage(editor as any, evt(new File(['x'], 'a.png')));
      expect(editor.insertMarkdown).not.toHaveBeenCalled();
      h.admin.uploadContentImage.and.returnValue(throwError(() => ({})));
      c.uploadAndInsertBlogImage(editor as any, evt(new File(['x'], 'a.png')));
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.blog.images.errors.upload');
    });
  });

  describe('onBlogImageDrop', () => {
    function dropEvent(files: File[]): any {
      return {
        dataTransfer: { files, types: ['Files'] },
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
      };
    }
    beforeEach(() => {
      c.selectedBlogKey = 'blog.a';
      c.blogImageLayout = 'default';
    });

    it('ignores drops without image files or without a selected post', async () => {
      await c.onBlogImageDrop(
        { insertMarkdown: () => undefined } as any,
        dropEvent([new File(['x'], 'a.txt', { type: 'text/plain' })]),
      );
      c.selectedBlogKey = null;
      await c.onBlogImageDrop(
        { insertMarkdown: () => undefined } as any,
        dropEvent([new File(['x'], 'a.png', { type: 'image/png' })]),
      );
      expect(h.admin.uploadContentImage).not.toHaveBeenCalled();
    });

    it('uploads and inserts dropped images into a rich editor', async () => {
      const editor = { insertMarkdown: jasmine.createSpy('insertMarkdown') };
      h.admin.uploadContentImage.and.returnValue(of({ images: [{ id: '1', url: '/d.png' }] }));
      await c.onBlogImageDrop(
        editor as any,
        dropEvent([new File(['x'], 'Drop.png', { type: 'image/png' })]),
      );
      expect(editor.insertMarkdown).toHaveBeenCalledWith('![Drop](/d.png)');
      expect(h.toast.success).toHaveBeenCalledWith('adminUi.blog.images.success.uploaded');
    });

    it('continues when an uploaded image lacks a url', async () => {
      const editor = { insertMarkdown: jasmine.createSpy('insertMarkdown') };
      h.admin.uploadContentImage.and.returnValue(of({ images: [] }));
      await c.onBlogImageDrop(
        editor as any,
        dropEvent([new File(['x'], 'a.png', { type: 'image/png' })]),
      );
      expect(editor.insertMarkdown).not.toHaveBeenCalled();
    });

    it('reports an error and aborts when an upload fails', async () => {
      h.admin.uploadContentImage.and.returnValue(throwError(() => ({})));
      await c.onBlogImageDrop(
        { insertMarkdown: () => undefined } as any,
        dropEvent([new File(['x'], 'a.png', { type: 'image/png' })]),
      );
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.blog.images.errors.upload');
    });

    it('inserts a layout-tagged snippet into a textarea target', async () => {
      c.blogImageLayout = 'narrow';
      const ta = document.createElement('textarea');
      const insert = spyOn(c, 'insertAtCursor');
      h.admin.uploadContentImage.and.returnValue(of({ images: [{ id: '1', url: '/d.png' }] }));
      await c.onBlogImageDrop(ta, dropEvent([new File(['x'], 'pic.png', { type: 'image/png' })]));
      expect(insert.calls.mostRecent().args[1]).toBe('![pic](/d.png "narrow")');
    });
  });

  describe('content redirects', () => {
    it('deleteContentRedirect ignores blanks and respects a cancelled confirm', () => {
      c.deleteContentRedirect('  ');
      const confirm = spyOn(window, 'confirm').and.returnValue(false);
      c.deleteContentRedirect('id1');
      expect(h.admin.deleteContentRedirect).not.toHaveBeenCalled();
      confirm.and.returnValue(true);
      spyOn(c, 'loadContentRedirects');
      h.admin.deleteContentRedirect.and.returnValue(of({}));
      c.deleteContentRedirect('id1');
      expect(h.toast.success).toHaveBeenCalledWith('adminUi.site.pages.redirects.success.deleted');
    });

    it('deleteContentRedirect surfaces a detail message then a default', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      h.admin.deleteContentRedirect.and.returnValue(
        throwError(() => ({ error: { detail: 'nope' } })),
      );
      c.deleteContentRedirect('id1');
      expect(h.toast.error).toHaveBeenCalledWith('nope');
      h.admin.deleteContentRedirect.and.returnValue(throwError(() => ({})));
      c.deleteContentRedirect('id1');
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.site.pages.redirects.errors.delete');
    });

    it('exportContentRedirects guards re-entry, downloads a csv and handles errors', () => {
      c.redirectsExporting = true;
      c.exportContentRedirects();
      expect(h.admin.exportContentRedirects).not.toHaveBeenCalled();
      c.redirectsExporting = false;
      c.redirectsQuery = ' term ';
      h.admin.exportContentRedirects.and.returnValue(of(new Blob(['a,b'], { type: 'text/csv' })));
      c.exportContentRedirects();
      expect(h.admin.exportContentRedirects).toHaveBeenCalledWith({ q: 'term' });
      expect(c.redirectsExporting).toBe(false);
      expect(h.toast.success).toHaveBeenCalledWith('adminUi.site.pages.redirects.success.export');
    });

    it('exportContentRedirects reports an error detail and a default, sending undefined for a blank query', () => {
      c.redirectsQuery = '';
      h.admin.exportContentRedirects.and.returnValue(
        throwError(() => ({ error: { detail: 'x' } })),
      );
      c.exportContentRedirects();
      expect(h.admin.exportContentRedirects).toHaveBeenCalledWith({ q: undefined });
      expect(h.toast.error).toHaveBeenCalledWith('x');
      c.redirectsExporting = false;
      h.admin.exportContentRedirects.and.returnValue(throwError(() => ({})));
      c.exportContentRedirects();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.site.pages.redirects.errors.export');
    });

    function importEvent(file?: File): any {
      return { target: { files: file ? [file] : [], value: 'x' } };
    }

    it('importContentRedirects ignores empty input and an in-flight import', () => {
      c.importContentRedirects(importEvent());
      c.redirectsImporting = true;
      c.importContentRedirects(importEvent(new File(['a'], 'r.csv')));
      expect(h.admin.importContentRedirects).not.toHaveBeenCalled();
    });

    it('importContentRedirects imports a file and falls back to null result', () => {
      spyOn(c, 'loadContentRedirects');
      h.admin.importContentRedirects.and.returnValue(of(undefined));
      c.importContentRedirects(importEvent(new File(['a'], 'r.csv')));
      expect(c.redirectsImportResult).toBeNull();
      expect(h.toast.success).toHaveBeenCalledWith('adminUi.site.pages.redirects.success.import');
    });

    it('importContentRedirects reports an error detail and a default', () => {
      h.admin.importContentRedirects.and.returnValue(
        throwError(() => ({ error: { detail: 'bad' } })),
      );
      c.importContentRedirects(importEvent(new File(['a'], 'r.csv')));
      expect(h.toast.error).toHaveBeenCalledWith('bad');
      h.admin.importContentRedirects.and.returnValue(throwError(() => ({})));
      c.importContentRedirects(importEvent(new File(['a'], 'r.csv')));
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.site.pages.redirects.errors.import');
    });

    it('createContentRedirect guards re-entry and missing fields, then creates', () => {
      c.redirectCreateSaving = true;
      c.createContentRedirect();
      expect(h.admin.upsertContentRedirect).not.toHaveBeenCalled();
      c.redirectCreateSaving = false;
      c.redirectCreateFrom = 'a';
      c.redirectCreateTo = '';
      c.createContentRedirect();
      expect(h.admin.upsertContentRedirect).not.toHaveBeenCalled();
      c.redirectCreateFrom = 'from';
      c.redirectCreateTo = 'to';
      spyOn(c, 'loadContentRedirects');
      h.admin.upsertContentRedirect.and.returnValue(of({}));
      c.createContentRedirect();
      expect(h.admin.upsertContentRedirect).toHaveBeenCalledWith({
        from_key: 'from',
        to_key: 'to',
      });
      expect(c.redirectCreateFrom).toBe('');
    });

    it('createContentRedirect reports an error detail and a default', () => {
      c.redirectCreateFrom = 'from';
      c.redirectCreateTo = 'to';
      h.admin.upsertContentRedirect.and.returnValue(
        throwError(() => ({ error: { detail: 'oops' } })),
      );
      c.createContentRedirect();
      expect(h.toast.error).toHaveBeenCalledWith('oops');
      c.redirectCreateFrom = 'from';
      c.redirectCreateTo = 'to';
      h.admin.upsertContentRedirect.and.returnValue(throwError(() => ({})));
      c.createContentRedirect();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.site.pages.redirects.errors.create');
    });
  });

  describe('find & replace', () => {
    it('previewFindReplace guards, validates and derives the key prefix per scope', () => {
      c.findReplaceLoading = true;
      c.previewFindReplace();
      expect(h.admin.previewFindReplaceContent).not.toHaveBeenCalled();
      c.findReplaceLoading = false;
      c.findReplaceFind = '   ';
      c.previewFindReplace();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.content.findReplace.errors.findRequired');

      const scopes: Array<[string, string | undefined]> = [
        ['blog', 'blog.'],
        ['home', 'home.'],
        ['site', 'site.'],
        ['pages', 'page.'],
        ['all', undefined],
      ];
      h.admin.previewFindReplaceContent.and.returnValue(of({ total_items: 1, total_matches: 2 }));
      for (const [scope, prefix] of scopes) {
        c.findReplaceFind = 'foo';
        c.findReplaceScope = scope;
        c.previewFindReplace();
        expect(h.admin.previewFindReplaceContent.calls.mostRecent().args[0].key_prefix).toBe(
          prefix,
        );
      }
      expect(c.findReplacePreviewKey).toBeTruthy();
    });

    it('previewFindReplace reports an error detail and a default', () => {
      c.findReplaceFind = 'foo';
      c.findReplaceScope = 'all';
      h.admin.previewFindReplaceContent.and.returnValue(
        throwError(() => ({ error: { detail: 'pe' } })),
      );
      c.previewFindReplace();
      expect(c.findReplaceError).toBe('pe');
      h.admin.previewFindReplaceContent.and.returnValue(throwError(() => ({})));
      c.previewFindReplace();
      expect(c.findReplaceError).toBe('adminUi.content.findReplace.errors.preview');
    });

    it('applyFindReplace requires a find term and a matching preview first', () => {
      c.findReplaceApplying = true;
      c.applyFindReplace();
      expect(h.admin.applyFindReplaceContent).not.toHaveBeenCalled();
      c.findReplaceApplying = false;
      c.findReplaceFind = '';
      c.applyFindReplace();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.content.findReplace.errors.findRequired');
      c.findReplaceFind = 'foo';
      c.findReplacePreview = null;
      c.applyFindReplace();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.content.findReplace.errors.previewFirst');
    });

    it('applyFindReplace respects a cancelled confirm', () => {
      c.findReplaceFind = 'foo';
      c.findReplaceScope = 'all';
      c.findReplaceReplace = 'bar';
      c.findReplaceCaseSensitive = false;
      c.findReplacePreview = { total_items: 1, total_matches: 1 };
      c.findReplacePreviewKey = c.findReplacePayloadKey({
        find: 'foo',
        replace: 'bar',
        key_prefix: null,
        case_sensitive: false,
      });
      spyOn(window, 'confirm').and.returnValue(false);
      c.applyFindReplace();
      expect(h.admin.applyFindReplaceContent).not.toHaveBeenCalled();
    });

    function primeApply(): void {
      c.findReplaceApplying = false;
      c.findReplaceLoading = false;
      c.findReplaceFind = 'foo';
      c.findReplaceScope = 'all';
      c.findReplaceReplace = 'bar';
      c.findReplaceCaseSensitive = false;
      c.findReplacePreview = { total_items: 1, total_matches: 1 };
      c.findReplacePreviewKey = c.findReplacePayloadKey({
        find: 'foo',
        replace: 'bar',
        key_prefix: null,
        case_sensitive: false,
      });
    }

    it('applyFindReplace applies with default counts on a null response', () => {
      primeApply();
      spyOn(window, 'confirm').and.returnValue(true);
      h.admin.applyFindReplaceContent.and.returnValue(of(null));
      c.applyFindReplace();
      expect(c.findReplaceApplyResult).toBeNull();
      expect(h.toast.success).toHaveBeenCalled();
    });

    it('applyFindReplace surfaces an error detail', () => {
      primeApply();
      spyOn(window, 'confirm').and.returnValue(true);
      h.admin.applyFindReplaceContent.and.returnValue(
        throwError(() => ({ error: { detail: 'ae' } })),
      );
      c.applyFindReplace();
      expect(h.toast.error).toHaveBeenCalledWith('ae');
      expect(c.findReplaceApplying).toBe(false);
    });

    it('applyFindReplace surfaces the default error message', () => {
      primeApply();
      spyOn(window, 'confirm').and.returnValue(true);
      h.admin.applyFindReplaceContent.and.returnValue(throwError(() => ({})));
      c.applyFindReplace();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.content.findReplace.errors.apply');
    });
  });

  describe('runLinkCheck', () => {
    it('ignores a blank key, uses an override, and stores issues', () => {
      c.linkCheckKey = '';
      c.runLinkCheck();
      expect(h.admin.linkCheckContent).not.toHaveBeenCalled();
      h.admin.linkCheckContent.and.returnValue(of({ issues: [{ url: '/a' }] }));
      c.runLinkCheck(' page.about ');
      expect(c.linkCheckKey).toBe('page.about');
      expect(c.linkCheckIssues.length).toBe(1);
      h.admin.linkCheckContent.and.returnValue(of({}));
      c.runLinkCheck('page.about');
      expect(c.linkCheckIssues).toEqual([]);
    });

    it('reports an error detail and a default', () => {
      h.admin.linkCheckContent.and.returnValue(throwError(() => ({ error: { detail: 'lc' } })));
      c.runLinkCheck('page.about');
      expect(c.linkCheckError).toBe('lc');
      h.admin.linkCheckContent.and.returnValue(throwError(() => ({})));
      c.runLinkCheck('page.about');
      expect(c.linkCheckError).toBe('adminUi.content.linkCheck.errors.load');
    });
  });

  describe('page block drop handlers', () => {
    function blockPayloadEvent(payload: unknown, files: File[] = []): any {
      return {
        preventDefault: () => undefined,
        dataTransfer: {
          files,
          types: files.length ? ['Files'] : ['text/plain'],
          getData: () => (payload === undefined ? '' : JSON.stringify(payload)),
        },
      };
    }

    it('onPageBlockDrop inserts dropped media files', () => {
      const insert = spyOn(c, 'insertPageMediaFiles').and.returnValue(Promise.resolve());
      c.pageBlocks['page.about'] = [];
      const png = new File(['x'], 'a.png', { type: 'image/png' });
      c.onPageBlockDrop(blockPayloadEvent(undefined, [png]), 'page.about', 'targetKey');
      expect(insert).toHaveBeenCalled();
      expect(c.pageInsertDragActive).toBe(false);
    });

    it('onPageBlockDrop inserts a library block at the target index', () => {
      c.pageBlocks['page.about'] = c.parsePageBlocksDraft({
        blocks: [{ type: 'text', key: 'k1', body_markdown: { en: 'a', ro: '' } }],
      });
      const insertAt = spyOn(c, 'insertPageBlockAt').and.returnValue('new');
      c.onPageBlockDrop(
        blockPayloadEvent({ kind: 'cms-block', scope: 'page', type: 'cta', template: 'blank' }),
        'page.about',
        'k1',
      );
      expect(insertAt).toHaveBeenCalledWith('page.about', 'cta', 0, 'blank');
    });

    it('onPageBlockDrop does not insert a library block when the target is missing', () => {
      c.pageBlocks['page.about'] = [];
      const insertAt = spyOn(c, 'insertPageBlockAt');
      c.onPageBlockDrop(
        blockPayloadEvent({ kind: 'cms-block', scope: 'page', type: 'cta', template: 'blank' }),
        'page.about',
        'nope',
      );
      expect(insertAt).not.toHaveBeenCalled();
    });

    it('onPageBlockDrop reorders an existing block onto a target', () => {
      c.pageBlocks['page.about'] = c.parsePageBlocksDraft({
        blocks: [
          { type: 'text', key: 'a', body_markdown: { en: '1', ro: '' } },
          { type: 'text', key: 'b', body_markdown: { en: '2', ro: '' } },
          { type: 'text', key: 'c', body_markdown: { en: '3', ro: '' } },
        ],
      });
      c.draggingPageBlocksKey = 'page.about';
      c.draggingPageBlockKey = 'a';
      c.onPageBlockDrop(blockPayloadEvent(undefined), 'page.about', 'c');
      expect(c.pageBlocks['page.about'].map((b: any) => b.key)).toEqual(['b', 'a', 'c']);
    });

    it('onPageBlockDrop ignores reorders with missing drag context, mismatched page or identical key', () => {
      c.pageBlocks['page.about'] = c.parsePageBlocksDraft({
        blocks: [{ type: 'text', key: 'a', body_markdown: { en: '1', ro: '' } }],
      });
      c.draggingPageBlocksKey = null;
      c.draggingPageBlockKey = null;
      c.onPageBlockDrop(blockPayloadEvent(undefined), 'page.about', 'a');
      c.draggingPageBlocksKey = 'page.other';
      c.draggingPageBlockKey = 'a';
      c.onPageBlockDrop(blockPayloadEvent(undefined), 'page.about', 'a');
      c.draggingPageBlocksKey = 'page.about';
      c.draggingPageBlockKey = 'a';
      c.onPageBlockDrop(blockPayloadEvent(undefined), 'page.about', 'a');
      expect(c.pageBlocks['page.about'].length).toBe(1);
    });

    it('onPageBlockDropZone reorders to a zone index and ends the drag', () => {
      c.pageBlocks['page.about'] = c.parsePageBlocksDraft({
        blocks: [
          { type: 'text', key: 'a', body_markdown: { en: '1', ro: '' } },
          { type: 'text', key: 'b', body_markdown: { en: '2', ro: '' } },
        ],
      });
      c.draggingPageBlocksKey = 'page.about';
      c.draggingPageBlockKey = 'a';
      c.onPageBlockDropZone(blockPayloadEvent(undefined), 'page.about', 2);
      expect(c.pageBlocks['page.about'].map((b: any) => b.key)).toEqual(['b', 'a']);
    });

    it('onPageBlockDropZone ends the drag when the dragged block is gone', () => {
      c.pageBlocks['page.about'] = [];
      c.draggingPageBlocksKey = 'page.about';
      c.draggingPageBlockKey = 'ghost';
      const end = spyOn(c, 'onPageBlockDragEnd');
      c.onPageBlockDropZone(blockPayloadEvent(undefined), 'page.about', 0);
      expect(end).toHaveBeenCalled();
    });

    it('onPageBlockDropZone inserts a library block and resets the active flag', () => {
      c.pageBlocks['page.about'] = [];
      const insertAt = spyOn(c, 'insertPageBlockAt').and.returnValue('k');
      c.onPageBlockDropZone(
        blockPayloadEvent({ kind: 'cms-block', scope: 'page', type: 'image', template: 'starter' }),
        'page.about',
        0,
      );
      expect(insertAt).toHaveBeenCalledWith('page.about', 'image', 0, 'starter');
      expect(c.pageInsertDragActive).toBe(false);
    });

    it('onPageBlockDropZone ends the drag for a non-page payload', () => {
      c.pageBlocks['page.about'] = [];
      const end = spyOn(c, 'onPageBlockDragEnd');
      c.onPageBlockDropZone(
        blockPayloadEvent({ kind: 'cms-block', scope: 'home', type: 'text' }),
        'page.about',
        0,
      );
      expect(end).toHaveBeenCalled();
    });
  });

  describe('renameCustomPageUrl', () => {
    beforeEach(() => {
      c.pageBlocksKey = 'page.custom';
    });

    it('returns when the key cannot be renamed', () => {
      c.pageBlocksKey = 'page.about';
      c.renameCustomPageUrl();
      expect(h.admin.renameContentPage).not.toHaveBeenCalled();
    });

    it('returns when the prompt is cancelled', () => {
      spyOn(window, 'prompt').and.returnValue(null);
      c.renameCustomPageUrl();
      expect(h.admin.renameContentPage).not.toHaveBeenCalled();
    });

    it('rejects an unchanged or empty slug', () => {
      spyOn(window, 'prompt').and.returnValue('custom');
      c.renameCustomPageUrl();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.site.pages.builder.errors.rename');
    });

    it('rejects a reserved slug', () => {
      spyOn(window, 'prompt').and.returnValue('about');
      c.renameCustomPageUrl();
      expect(h.toast.error).toHaveBeenCalledWith(
        'adminUi.site.pages.errors.reservedTitle',
        'adminUi.site.pages.errors.reservedCopy',
      );
    });

    it('returns when the change confirm is declined', () => {
      spyOn(window, 'prompt').and.returnValue('renamed');
      spyOn(window, 'confirm').and.returnValue(false);
      c.renameCustomPageUrl();
      expect(h.admin.renameContentPage).not.toHaveBeenCalled();
    });

    it('renames the page and creates a redirect when confirmed', () => {
      spyOn(window, 'prompt').and.returnValue('renamed');
      spyOn(window, 'confirm').and.returnValue(true);
      spyOn(c, 'loadContentPages');
      spyOn(c, 'loadPageBlocks');
      spyOn(c, 'loadContentRedirects');
      h.admin.renameContentPage.and.returnValue(
        of({ new_key: 'page.renamed', old_key: 'page.custom' }),
      );
      h.admin.upsertContentRedirect.and.returnValue(of({}));
      c.renameCustomPageUrl();
      expect(c.pageBlocksKey).toBe('page.renamed');
      expect(h.admin.upsertContentRedirect).toHaveBeenCalledWith({
        from_key: 'page.custom',
        to_key: 'page.renamed',
      });
      expect(h.toast.success).toHaveBeenCalledWith('adminUi.site.pages.redirects.success.created');
    });

    it('renames without a redirect when the redirect confirm is declined and tolerates redirect errors', () => {
      spyOn(window, 'prompt').and.returnValue('renamed');
      const confirm = spyOn(window, 'confirm').and.returnValues(true, false);
      spyOn(c, 'loadContentPages');
      spyOn(c, 'loadPageBlocks');
      h.admin.renameContentPage.and.returnValue(
        of({ new_key: 'page.renamed', old_key: 'page.custom' }),
      );
      c.renameCustomPageUrl();
      expect(h.admin.upsertContentRedirect).not.toHaveBeenCalled();
      expect(confirm).toHaveBeenCalledTimes(2);
    });

    it('reports a redirect creation error after a successful rename', () => {
      spyOn(window, 'prompt').and.returnValue('renamed');
      spyOn(window, 'confirm').and.returnValue(true);
      spyOn(c, 'loadContentPages');
      spyOn(c, 'loadPageBlocks');
      spyOn(c, 'loadContentRedirects');
      h.admin.renameContentPage.and.returnValue(
        of({ new_key: 'page.renamed', old_key: 'page.custom' }),
      );
      h.admin.upsertContentRedirect.and.returnValue(
        throwError(() => ({ error: { detail: 'rdr' } })),
      );
      c.renameCustomPageUrl();
      expect(h.toast.error).toHaveBeenCalledWith('rdr');
    });

    it('reports a rename error detail and a default', () => {
      spyOn(window, 'prompt').and.returnValue('renamed');
      spyOn(window, 'confirm').and.returnValue(true);
      h.admin.renameContentPage.and.returnValue(throwError(() => ({ error: { detail: 'rn' } })));
      c.renameCustomPageUrl();
      expect(h.toast.error).toHaveBeenCalledWith('rn');
      c.pageBlocksKey = 'page.custom';
      h.admin.renameContentPage.and.returnValue(throwError(() => ({})));
      c.renameCustomPageUrl();
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.site.pages.builder.errors.rename');
    });
  });

  describe('category management', () => {
    function cat(over: Record<string, unknown> = {}): any {
      return {
        id: 'id',
        slug: 'slug',
        name: 'name',
        sort_order: 0,
        parent_id: null,
        low_stock_threshold: null,
        tax_group_id: null,
        ...over,
      };
    }

    it('categoryDescendantIds resolves nested children, ignoring cycles', () => {
      c.categories = [
        cat({ id: 'root', slug: 'root' }),
        cat({ id: 'a', slug: 'a', parent_id: 'root' }),
        cat({ id: 'b', slug: 'b', parent_id: 'root' }),
        cat({ id: 'c', slug: 'c', parent_id: 'a' }),
        cat({ id: 'self', slug: 'self', parent_id: 'self' }), // cycle entry
      ];
      const ids = c.categoryDescendantIds('root');
      expect(ids.has('a')).toBe(true);
      expect(ids.has('c')).toBe(true);
      expect(ids.has('root')).toBe(false);
    });

    it('categoryParentLabel resolves none/found/missing parents', () => {
      c.categories = [
        cat({ id: 'p', slug: 'p', name: 'Parent' }),
        cat({ id: 'child', slug: 'child', parent_id: 'p' }),
      ];
      expect(c.categoryParentLabel(cat({ parent_id: null }))).toBe('adminUi.categories.parentNone');
      expect(c.categoryParentLabel(cat({ parent_id: 'p' }))).toBe('Parent');
      expect(c.categoryParentLabel(cat({ parent_id: 'gone' }))).toBe(
        'adminUi.categories.parentNone',
      );
    });

    it('categoryParentOptions excludes self and descendants and sorts by name', () => {
      c.categories = [
        cat({ id: 'root', slug: 'root', name: 'B' }),
        cat({ id: 'child', slug: 'child', name: 'A', parent_id: 'root' }),
        cat({ id: 'other', slug: 'other', name: undefined }),
      ];
      const opts = c.categoryParentOptions(cat({ id: 'root', slug: 'root' }));
      expect(opts.map((o: any) => o.id)).not.toContain('root');
      expect(opts.map((o: any) => o.id)).not.toContain('child');
      expect(opts.map((o: any) => o.id)).toContain('other');
    });

    it('moveCategory ignores out-of-range moves and reorders/persists otherwise', () => {
      c.categories = [
        cat({ slug: 'a', sort_order: 0 }),
        cat({ slug: 'b' /* missing sort_order */ }),
        cat({ slug: 'c', sort_order: 2 }),
      ];
      c.moveCategory(cat({ slug: 'a' }), -1); // swapIndex < 0
      c.moveCategory(cat({ slug: 'c', sort_order: 2 }), 1); // swapIndex >= length
      c.moveCategory(cat({ slug: 'missing' }), 1); // index < 0
      expect(h.admin.reorderCategories).not.toHaveBeenCalled();
      h.admin.reorderCategories.and.returnValue(
        of([cat({ slug: 'b', sort_order: 0 }), cat({ slug: 'a', sort_order: 1 })]),
      );
      c.moveCategory(cat({ slug: 'a', sort_order: 0 }), 1);
      expect(h.toast.success).toHaveBeenCalledWith('adminUi.categories.success.reorder');
    });

    it('moveCategory reports a reorder error', () => {
      c.categories = [cat({ slug: 'a', sort_order: 0 }), cat({ slug: 'b', sort_order: 1 })];
      h.admin.reorderCategories.and.returnValue(throwError(() => ({})));
      c.moveCategory(cat({ slug: 'a', sort_order: 0 }), 1);
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.categories.errors.reorder');
    });

    it('onCategoryDrop ignores empty/identical drags and missing endpoints', () => {
      c.categories = [cat({ slug: 'a', sort_order: 0 }), cat({ slug: 'b', sort_order: 1 })];
      c.draggingSlug = null;
      c.onCategoryDrop('a');
      c.draggingSlug = 'a';
      c.onCategoryDrop('a');
      c.draggingSlug = 'ghost';
      c.onCategoryDrop('b');
      expect(h.admin.reorderCategories).not.toHaveBeenCalled();
    });

    it('onCategoryDrop reorders, persists and clears the dragging slug', () => {
      c.categories = [
        cat({ slug: 'a', sort_order: 0 }),
        cat({ slug: 'b', sort_order: 1 }),
        cat({ slug: 'c', sort_order: 2 }),
      ];
      h.admin.reorderCategories.and.returnValue(of([cat({ slug: 'b', sort_order: 0 })]));
      c.draggingSlug = 'a';
      c.onCategoryDrop('c');
      expect(h.admin.reorderCategories).toHaveBeenCalled();
      expect(c.draggingSlug).toBeNull();
    });

    it('onCategoryDrop reports a reorder error', () => {
      c.categories = [cat({ slug: 'a', sort_order: 0 }), cat({ slug: 'b', sort_order: 1 })];
      h.admin.reorderCategories.and.returnValue(throwError(() => ({})));
      c.draggingSlug = 'a';
      c.onCategoryDrop('b');
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.categories.errors.reorder');
    });

    it('updateCategoryLowStockThreshold validates, ignores no-ops, persists and reverts', () => {
      const bad = cat({ slug: 's', low_stock_threshold: 5 });
      c.updateCategoryLowStockThreshold(bad, '-3');
      expect(bad.low_stock_threshold).toBe(5);
      expect(h.toast.error).toHaveBeenCalledWith(
        'adminUi.categories.errors.updateLowStockThreshold',
      );

      const same = cat({ slug: 's', low_stock_threshold: null });
      c.updateCategoryLowStockThreshold(same, '   ');
      expect(h.admin.updateCategory).not.toHaveBeenCalled();

      const ok = cat({ slug: 's', low_stock_threshold: null });
      h.admin.updateCategory.and.returnValue(of({ low_stock_threshold: 7 }));
      c.updateCategoryLowStockThreshold(ok, '7');
      expect(ok.low_stock_threshold).toBe(7);

      const fail = cat({ slug: 's', low_stock_threshold: 1 });
      h.admin.updateCategory.and.returnValue(throwError(() => ({})));
      c.updateCategoryLowStockThreshold(fail, '9');
      expect(fail.low_stock_threshold).toBe(1);
    });

    it('updateCategoryParent ignores no-ops, persists and reverts', () => {
      const same = cat({ slug: 's', parent_id: null });
      c.updateCategoryParent(same, '  ');
      expect(h.admin.updateCategory).not.toHaveBeenCalled();

      const ok = cat({ slug: 's', parent_id: null });
      h.admin.updateCategory.and.returnValue(of({ parent_id: 'p2' }));
      c.updateCategoryParent(ok, 'p1');
      expect(ok.parent_id).toBe('p2');

      const fail = cat({ slug: 's', parent_id: 'old' });
      h.admin.updateCategory.and.returnValue(throwError(() => ({})));
      c.updateCategoryParent(fail, 'new');
      expect(fail.parent_id).toBe('old');
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.categories.errors.updateParent');
    });

    it('updateCategoryTaxGroup ignores no-ops, persists and reverts', () => {
      const same = cat({ slug: 's', tax_group_id: null });
      c.updateCategoryTaxGroup(same, '');
      expect(h.admin.updateCategory).not.toHaveBeenCalled();

      const ok = cat({ slug: 's', tax_group_id: null });
      h.admin.updateCategory.and.returnValue(of({ tax_group_id: 'g2' }));
      c.updateCategoryTaxGroup(ok, 'g1');
      expect(ok.tax_group_id).toBe('g2');

      const fail = cat({ slug: 's', tax_group_id: 'old' });
      h.admin.updateCategory.and.returnValue(throwError(() => ({})));
      c.updateCategoryTaxGroup(fail, 'new');
      expect(fail.tax_group_id).toBe('old');
      expect(h.toast.error).toHaveBeenCalledWith('adminUi.taxes.errors.categoryAssign');
    });
  });

  describe('reports settings', () => {
    it('loadReportsSettings parses string flags, list/recipients and last-run markers', () => {
      h.admin.getContent.and.returnValue(
        of({
          meta: {
            reports_weekly_enabled: 'yes',
            reports_monthly_enabled: 'off',
            reports_weekly_weekday: '3',
            reports_weekly_hour_utc: '30',
            reports_monthly_day: '50',
            reports_recipients: ['a@b.com', '  ', 'c@d.com'],
            reports_weekly_last_sent_period_end: '2026-01-01',
            reports_weekly_last_error: 'werr',
            reports_monthly_last_sent_period_end: '2026-02-01',
            reports_monthly_last_error: 'merr',
          },
        }),
      );
      c.loadReportsSettings();
      expect(c.reportsSettingsForm.weekly_enabled).toBe(true);
      expect(c.reportsSettingsForm.monthly_enabled).toBe(false);
      expect(c.reportsSettingsForm.weekly_weekday).toBe(3);
      expect(c.reportsSettingsForm.weekly_hour_utc).toBe(23);
      expect(c.reportsSettingsForm.monthly_day).toBe('28');
      expect(c.reportsSettingsForm.recipients).toBe('a@b.com, c@d.com');
      expect(c.reportsMonthlyLastSent).toBe('2026-02-01');
      expect(c.reportsMonthlyLastError).toBe('merr');
    });

    it('loadReportsSettings parses a string recipient list and resets on error', () => {
      h.admin.getContent.and.returnValue(
        of({ meta: { reports_recipients: 'a@b.com; c@d.com\ne@f.com' } }),
      );
      c.loadReportsSettings();
      expect(c.reportsSettingsForm.recipients).toBe('a@b.com, c@d.com, e@f.com');

      c.contentVersions['site.reports'] = { version: 1 };
      h.admin.getContent.and.returnValue(throwError(() => ({})));
      c.loadReportsSettings();
      expect(c.contentVersions['site.reports']).toBeUndefined();
      expect(c.reportsSettingsForm.recipients).toBe('');
    });

    it('saveReportsSettings normalises numbers, dedupes valid recipients and persists', () => {
      c.reportsSettingsMeta = {};
      c.reportsSettingsForm = {
        weekly_enabled: true,
        weekly_weekday: 0,
        weekly_hour_utc: 0,
        monthly_enabled: false,
        monthly_day: '',
        monthly_hour_utc: 0,
        recipients: 'a@b.com, a@b.com, bad, c@d.com',
      };
      h.admin.updateContentBlock.and.returnValue(
        of({ meta: { reports_recipients: ['a@b.com', 'c@d.com'] } }),
      );
      c.saveReportsSettings();
      const meta = h.admin.updateContentBlock.calls.mostRecent().args[1].meta;
      expect(meta.reports_monthly_day).toBe(1);
      expect(meta.reports_recipients).toEqual(['a@b.com', 'c@d.com']);
      expect(meta.reports_top_products_limit).toBe(5);
      expect(c.reportsSettingsMessage).toBe('adminUi.reports.success.save');
    });

    it('saveReportsSettings drops recipients when none are valid and keeps preset limits', () => {
      c.reportsSettingsMeta = {
        reports_top_products_limit: 9,
        reports_low_stock_limit: 9,
        reports_retry_cooldown_minutes: 9,
      };
      c.reportsSettingsForm = {
        weekly_enabled: false,
        weekly_weekday: 9,
        weekly_hour_utc: 9,
        monthly_enabled: true,
        monthly_day: '15',
        monthly_hour_utc: 9,
        recipients: 'not-an-email',
      };
      h.admin.updateContentBlock.and.returnValue(of(null));
      c.saveReportsSettings();
      const meta = h.admin.updateContentBlock.calls.mostRecent().args[1].meta;
      expect('reports_recipients' in meta).toBe(false);
      expect(meta.reports_top_products_limit).toBe(9);
    });

    it('saveReportsSettings surfaces a conflict, then creates on a generic error', () => {
      c.reportsSettingsMeta = {};
      c.reportsSettingsForm = {
        weekly_enabled: false,
        weekly_weekday: 0,
        weekly_hour_utc: 8,
        monthly_enabled: false,
        monthly_day: '1',
        monthly_hour_utc: 8,
        recipients: '',
      };
      h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
      h.admin.getContent.and.returnValue(of({ meta: {} }));
      c.saveReportsSettings();
      expect(c.reportsSettingsError).toBe('adminUi.reports.errors.save');

      h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
      h.admin.createContent.and.returnValue(of({ meta: {} }));
      c.saveReportsSettings();
      expect(c.reportsSettingsMessage).toBe('adminUi.reports.success.save');

      h.admin.createContent.and.returnValue(throwError(() => ({})));
      c.saveReportsSettings();
      expect(c.reportsSettingsError).toBe('adminUi.reports.errors.save');
    });

    it('sendReportNow guards re-entry and maps skipped/sent/error', () => {
      c.reportsSending = true;
      c.sendReportNow('weekly');
      expect(h.admin.sendScheduledReport).not.toHaveBeenCalled();
      c.reportsSending = false;
      spyOn(c, 'loadReportsSettings');
      h.admin.sendScheduledReport.and.returnValue(of({ skipped: true }));
      c.sendReportNow('weekly');
      expect(c.reportsSettingsMessage).toBe('adminUi.reports.success.skipped');
      h.admin.sendScheduledReport.and.returnValue(of({ skipped: false }));
      c.sendReportNow('monthly', true);
      expect(c.reportsSettingsMessage).toBe('adminUi.reports.success.sent');
      h.admin.sendScheduledReport.and.returnValue(throwError(() => ({})));
      c.sendReportNow('weekly');
      expect(c.reportsSettingsError).toBe('adminUi.reports.errors.send');
    });
  });

  describe('social', () => {
    it('parseSocialPages falls back for non-arrays and skips invalid entries', () => {
      const fb = [{ label: 'd', url: 'u', thumbnail_url: '' }];
      expect(c.parseSocialPages('not-array', fb)).toBe(fb);
      const parsed = c.parseSocialPages([null, 5, { label: 1, url: 2, thumbnail_url: 3 }], fb);
      expect(parsed.length).toBe(1);
      expect(parsed[0]).toEqual({ label: '1', url: '2', thumbnail_url: '3' });
    });

    it('loadSocial merges contact info and parses page lists; ignores errors', () => {
      c.socialForm = { phone: 'old', email: '', instagram_pages: [], facebook_pages: [] };
      h.admin.getContent.and.returnValue(
        of({ meta: { contact: { email: 'm@e.co' }, instagram_pages: [{ url: 'ig' }] } }),
      );
      c.loadSocial();
      expect(c.socialForm.phone).toBe('old');
      expect(c.socialForm.email).toBe('m@e.co');
      expect(c.socialForm.instagram_pages.length).toBe(1);
      c.contentVersions['site.social'] = { version: 1 };
      h.admin.getContent.and.returnValue(throwError(() => ({})));
      c.loadSocial();
      expect(c.contentVersions['site.social']).toBeUndefined();
    });

    it('fetchSocialThumbnail validates the url and applies/falls-back/errors', () => {
      c.socialForm = {
        phone: '',
        email: '',
        instagram_pages: [{ label: '', url: '', thumbnail_url: '' }],
        facebook_pages: [],
      };
      c.socialThumbErrors = {};
      c.socialThumbLoading = {};
      c.fetchSocialThumbnail('instagram', 0);
      expect(c.socialThumbErrors['instagram-0']).toBe('adminUi.site.social.errors.urlRequired');

      c.socialForm.instagram_pages = [{ label: '', url: 'http://ig', thumbnail_url: '' }];
      h.admin.fetchSocialThumbnail.and.returnValue(of({ thumbnail_url: ' /thumb ' }));
      c.fetchSocialThumbnail('instagram', 0);
      expect(c.socialForm.instagram_pages[0].thumbnail_url).toBe('/thumb');
      expect(h.toast.success).toHaveBeenCalled();

      h.admin.fetchSocialThumbnail.and.returnValue(of({ thumbnail_url: '' }));
      c.fetchSocialThumbnail('instagram', 0);
      expect(c.socialThumbErrors['instagram-0']).toBe('adminUi.site.social.errors.noThumbnail');

      c.socialForm.facebook_pages = [{ label: '', url: 'http://fb', thumbnail_url: '' }];
      h.admin.fetchSocialThumbnail.and.returnValue(throwError(() => ({ error: { detail: 'fd' } })));
      c.fetchSocialThumbnail('facebook', 0);
      expect(c.socialThumbErrors['facebook-0']).toBe('fd');
      h.admin.fetchSocialThumbnail.and.returnValue(throwError(() => ({})));
      c.fetchSocialThumbnail('facebook', 0);
      expect(c.socialThumbErrors['facebook-0']).toBe('adminUi.site.social.errors.fetchFailed');
    });
  });

  describe('onNavigationDrop', () => {
    function link(id: string): any {
      return { id, url: `/u/${id}`, label: { en: id, ro: id } };
    }
    beforeEach(() => {
      c.navigationForm = {
        header_links: [link('h1'), link('h2'), link('h3')],
        footer_handcrafted_links: [link('f1'), link('f2')],
        footer_legal_links: [link('l1'), link('l2')],
      };
    });

    it('clears drag state for invalid drops', () => {
      c.draggingNavList = null;
      c.draggingNavId = 'h1';
      c.onNavigationDrop('header', 'h2');
      expect(c.draggingNavId).toBeNull();
      c.draggingNavList = 'header';
      c.draggingNavId = 'ghost';
      c.onNavigationDrop('header', 'h2');
      expect(c.navigationForm.header_links.map((l: any) => l.id)).toEqual(['h1', 'h2', 'h3']);
    });

    it('reorders within the header, handcrafted and legal lists', () => {
      c.draggingNavList = 'header';
      c.draggingNavId = 'h1';
      c.onNavigationDrop('header', 'h3');
      expect(c.navigationForm.header_links.map((l: any) => l.id)).toEqual(['h2', 'h3', 'h1']);

      c.draggingNavList = 'footer_handcrafted';
      c.draggingNavId = 'f2';
      c.onNavigationDrop('footer_handcrafted', 'f1');
      expect(c.navigationForm.footer_handcrafted_links.map((l: any) => l.id)).toEqual(['f2', 'f1']);

      c.draggingNavList = 'footer_legal';
      c.draggingNavId = 'l2';
      c.onNavigationDrop('footer_legal', 'l1');
      expect(c.navigationForm.footer_legal_links.map((l: any) => l.id)).toEqual(['l2', 'l1']);
    });
  });

  describe('category branch fill', () => {
    it('categoryParentOptions sorts nullish-name categories and skips descendants/self', () => {
      c.categories = [
        { id: 'a', slug: 'a', name: null, parent_id: null },
        { id: 'b', slug: 'b', name: 'Beta', parent_id: null },
        { id: 'c', slug: 'c', name: 'Alpha', parent_id: 'x' },
      ];
      const opts = c.categoryParentOptions({ id: 'x' });
      // 'x' (self) and 'c' (descendant of x) excluded; '' (null name) sorts before 'Beta'.
      expect(opts.map((o: any) => o.id)).toEqual(['a', 'b']);
    });

    it('categoryDescendantIds resolves a parent cycle without looping forever', () => {
      c.categories = [
        { id: 'p', slug: 'p', name: 'P', parent_id: 'c2' },
        { id: 'c1', slug: 'c1', name: 'C1', parent_id: 'p' },
        { id: 'c2', slug: 'c2', name: 'C2', parent_id: 'c1' },
      ];
      const opts = c.categoryParentOptions({ id: 'p' });
      // p plus its descendants (c1, c2 via the cycle) are all excluded.
      expect(opts).toEqual([]);
    });

    it('updateCategoryParent clears the parent when raw is nullish and echoes a null response', () => {
      const cat: any = { slug: 's', parent_id: 'old' };
      h.admin.updateCategory.and.returnValue(of({ parent_id: null }));
      c.updateCategoryParent(cat, null as any);
      expect(h.admin.updateCategory).toHaveBeenCalledWith('s', { parent_id: null });
      expect(cat.parent_id).toBeNull();
      expect(h.toast.success).toHaveBeenCalled();
    });

    it('updateCategoryLowStockThreshold clears the threshold for nullish input and echoes null', () => {
      const cat: any = { slug: 's', low_stock_threshold: 5 };
      h.admin.updateCategory.and.returnValue(of({ low_stock_threshold: null }));
      c.updateCategoryLowStockThreshold(cat, null as any);
      expect(h.admin.updateCategory).toHaveBeenCalledWith('s', { low_stock_threshold: null });
      expect(cat.low_stock_threshold).toBeNull();
    });

    it('updateCategoryTaxGroup clears the group when raw is nullish and echoes null', () => {
      const cat: any = { slug: 's', tax_group_id: 'g1' };
      h.admin.updateCategory.and.returnValue(of({ tax_group_id: null }));
      c.updateCategoryTaxGroup(cat, null as any);
      expect(h.admin.updateCategory).toHaveBeenCalledWith('s', { tax_group_id: null });
      expect(cat.tax_group_id).toBeNull();
    });

    it('moveCategory reorders categories whose sort_order is undefined', () => {
      c.categories = [
        { slug: 'a', sort_order: undefined },
        { slug: 'b', sort_order: undefined },
      ];
      h.admin.reorderCategories.and.returnValue(of([{ slug: 'b' }, { slug: 'a' }]));
      c.moveCategory(c.categories[0], 1);
      expect(h.admin.reorderCategories).toHaveBeenCalledWith([
        { slug: 'a', sort_order: 0 },
        { slug: 'b', sort_order: 0 },
      ]);
      expect(c.categories.map((x: any) => x.slug)).toEqual(['b', 'a']);
      expect(h.toast.success).toHaveBeenCalled();
    });

    it('onCategoryDrop reorders categories whose sort_order is undefined', () => {
      c.categories = [
        { slug: 'a', sort_order: undefined },
        { slug: 'b', sort_order: undefined },
      ];
      c.draggingSlug = 'a';
      h.admin.reorderCategories.and.returnValue(of([{ slug: 'b' }, { slug: 'a' }]));
      c.onCategoryDrop('b');
      expect(h.admin.reorderCategories).toHaveBeenCalled();
      expect(c.categories.map((x: any) => x.slug)).toEqual(['b', 'a']);
      expect(c.draggingSlug).toBeNull();
    });

    it('deleteTaxRate ignores a blank country code', () => {
      c.deleteTaxRate({ id: 'g' } as any, '   ');
      expect(h.taxesAdmin.deleteRate).not.toHaveBeenCalled();
    });
  });
});
