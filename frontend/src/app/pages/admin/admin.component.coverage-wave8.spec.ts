import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { AdminComponent } from './admin.component';

type RouteStub = {
  snapshot: { data: Record<string, unknown>; queryParams: Record<string, unknown> };
  data: Subject<Record<string, unknown>>;
  queryParams: Subject<Record<string, unknown>>;
};

function createRouteStub(section: string, query: Record<string, unknown> = {}): RouteStub {
  return {
    snapshot: { data: { section }, queryParams: query },
    data: new Subject<Record<string, unknown>>(),
    queryParams: new Subject<Record<string, unknown>>()
  };
}

function createAdminSpy(): jasmine.SpyObj<any> {
  return jasmine.createSpyObj('AdminService', [
    'products',
    'coupons',
    'lowStock',
    'audit',
    'getMaintenance',
    'getContent',
    'listContentPages',
    'updateContentBlock',
    'createContent',
    'uploadContentImage',
    'updateContentImageFocalPoint'
  ]);
}

function createHarness(): { component: AdminComponent; admin: jasmine.SpyObj<any>; toast: jasmine.SpyObj<any> } {
  const routeStub = createRouteStub('home');
  const admin = createAdminSpy();
  admin.products.and.returnValue(of([]));
  admin.coupons.and.returnValue(of([]));
  admin.lowStock.and.returnValue(of([]));
  admin.audit.and.returnValue(of({ products: [], content: [], security: [] }));
  admin.getMaintenance.and.returnValue(of({ enabled: false }));
  admin.getContent.and.returnValue(of({ body_markdown: '', status: 'published', version: 1, meta: {} }));
  admin.listContentPages.and.returnValue(of([]));
  admin.updateContentBlock.and.returnValue(of({ version: 2, needs_translation_en: false, needs_translation_ro: false }));
  admin.createContent.and.returnValue(of({ version: 3, needs_translation_en: false, needs_translation_ro: false }));
  admin.uploadContentImage.and.returnValue(of({ images: [{ id: 'img-1', url: 'https://cdn.test/1.jpg', sort_order: 0, focal_x: 50, focal_y: 50 }] }));
  admin.updateContentImageFocalPoint.and.returnValue(of({ focal_x: 20, focal_y: 80 }));

  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);

  const component = new AdminComponent(
    {
      snapshot: routeStub.snapshot,
      data: routeStub.data.asObservable(),
      queryParams: routeStub.queryParams.asObservable()
    } as unknown as ActivatedRoute,
    admin as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { role: () => 'owner' } as any,
    {
      mode: () => 'advanced',
      previewDevice: () => 'desktop',
      previewLayout: () => 'split',
      previewLang: () => 'en',
      previewTheme: () => 'light'
    } as any,
    toast as any,
    { instant: (key: string) => key } as any,
    { render: (value: string) => value } as any,
    {
      bypassSecurityTrustHtml: (value: string) => value,
      bypassSecurityTrustResourceUrl: (value: string) => value
    } as unknown as DomSanitizer
  );

  return { component, admin, toast };
}

const GLOBAL_CTX = globalThis as Window & typeof globalThis;

function dragEventWithFiles(files: File[]): DragEvent {
  const event = new DragEvent('drop');
  const dt = {
    files,
    types: ['Files']
  } as unknown as DataTransfer;
  Object.defineProperty(event, 'dataTransfer', { value: dt, configurable: true });
  return event;
}

describe('AdminComponent coverage wave 8 branch matrix', () => {
  it('covers additional revision key and viewport-width switch branches', () => {
    const { component } = createHarness();

    component.pagesRevisionKey = 'page.terms';
    expect(component.pagesRevisionTitleKey()).toBe('adminUi.site.pages.legal.documents.termsIndex');
    component.pagesRevisionKey = 'page.terms-and-conditions';
    expect(component.pagesRevisionTitleKey()).toBe('adminUi.site.pages.legal.documents.terms');
    component.pagesRevisionKey = 'page.anpc';
    expect(component.pagesRevisionTitleKey()).toBe('adminUi.site.pages.legal.documents.anpc');

    component.homeRevisionKey = 'home.story';
    expect(component.homeRevisionTitleKey()).toBe('adminUi.home.story.title');

    component.settingsRevisionKey = 'site.company';
    expect(component.settingsRevisionTitleKey()).toBe('adminUi.site.company.title');
    component.settingsRevisionKey = 'site.navigation';
    expect(component.settingsRevisionTitleKey()).toBe('adminUi.site.navigation.title');
    component.settingsRevisionKey = 'site.checkout';
    expect(component.settingsRevisionTitleKey()).toBe('adminUi.site.checkout.title');
    component.settingsRevisionKey = 'site.reports';
    expect(component.settingsRevisionTitleKey()).toBe('adminUi.reports.title');

    (component as any).cmsPrefs.previewDevice = () => 'mobile';
    expect(component.cmsPreviewViewportWidth()).toBe(390);
    (component as any).cmsPrefs.previewDevice = () => 'tablet';
    expect(component.cmsPreviewViewportWidth()).toBe(768);
    (component as any).cmsPrefs.previewDevice = () => 'desktop';
    expect(component.cmsPreviewViewportWidth()).toBe(1024);
  });

  it('covers applySection/applyContentEditQuery and init-destroy lifecycle paths', () => {
    const { component } = createHarness();
    const loadForSectionSpy = spyOn(component as any, 'loadForSection').and.stub();
    const syncPollerSpy = spyOn(component as any, 'syncCmsDraftPoller').and.stub();
    const loadBlogEditorSpy = spyOn(component as any, 'loadBlogEditor').and.stub();
    const onPageBlocksKeyChangeSpy = spyOn(component, 'onPageBlocksKeyChange').and.stub();

    component.section.set('home');
    (component as any).applySection('home');
    (component as any).applySection('pages');
    expect(loadForSectionSpy).toHaveBeenCalledTimes(2);
    expect(syncPollerSpy).toHaveBeenCalledTimes(2);

    (component as any).applyContentEditQuery('blog', { edit: 'post-demo' });
    expect(loadBlogEditorSpy).toHaveBeenCalledWith('blog.post-demo');
    (component as any).applyContentEditQuery('pages', { edit: 'contact' });
    expect(onPageBlocksKeyChangeSpy).toHaveBeenCalledWith('page.contact');

    component.ngOnInit();
    component.ngOnDestroy();
  });

  it('covers observeCmsDrafts and poller start-stop branches', () => {
    const { component } = createHarness();
    const setIntervalSpy = spyOn(GLOBAL_CTX, 'setInterval').and.returnValue(77 as any);
    const clearIntervalSpy = spyOn(GLOBAL_CTX, 'clearInterval').and.stub();

    component.homeBlocks = [{ key: 'home.hero', type: 'hero', enabled: true }] as any;
    component['cmsHomeDraft'].initFromServer(component.homeBlocks as any);

    component.pageBlocksKey = 'page.contact' as any;
    component.pageBlocks = { 'page.contact': [{ key: 'p-1', type: 'text', enabled: true }] } as any;
    const pageDraft = component['ensurePageDraft']('page.contact');
    pageDraft.initFromServer(component['currentPageDraftState']('page.contact'));

    component.selectedBlogKey = 'blog.sample';
    component.blogEditLang = 'en';
    const blogDraft = component['ensureBlogDraft']('blog.sample', 'en');
    blogDraft.initFromServer(component['currentBlogDraftState']());

    (component as any).observeCmsDrafts();
    expect(component.homeDraftReady()).toBeTrue();
    expect(component.pageDraftReady('page.contact')).toBeTrue();
    expect(component.blogDraftReady()).toBeTrue();

    (component as any).syncCmsDraftPoller('home');
    expect(setIntervalSpy).toHaveBeenCalled();
    (component as any).stopCmsDraftPoller();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('covers loadForSection fan-out with success/error audit branches', () => {
    const { component, admin, toast } = createHarness();
    const pagesSpies = [
      spyOn(component as any, 'loadInfo').and.stub(),
      spyOn(component as any, 'loadLegalPage').and.stub(),
      spyOn(component as any, 'loadCategories').and.stub(),
      spyOn(component as any, 'loadCollections').and.stub(),
      spyOn(component as any, 'loadContentPages').and.stub(),
      spyOn(component as any, 'loadReusableBlocks').and.stub(),
      spyOn(component as any, 'loadPageBlocks').and.stub(),
      spyOn(component as any, 'loadContentRedirects').and.stub()
    ];
    const blogSpies = [
      spyOn(component as any, 'reloadContentBlocks').and.stub(),
      spyOn(component as any, 'loadFlaggedComments').and.stub()
    ];
    const settingsSpies = [
      spyOn(component as any, 'loadTaxGroups').and.stub(),
      spyOn(component as any, 'loadAssets').and.stub(),
      spyOn(component as any, 'loadSocial').and.stub(),
      spyOn(component as any, 'loadCompany').and.stub(),
      spyOn(component as any, 'loadNavigation').and.stub(),
      spyOn(component as any, 'loadCheckoutSettings').and.stub(),
      spyOn(component as any, 'loadReportsSettings').and.stub(),
      spyOn(component as any, 'loadSeo').and.stub(),
      spyOn(component as any, 'loadFxStatus').and.stub()
    ];

    (component as any).loadForSection('pages');
    expect(pagesSpies.every((spyRef) => spyRef.calls.count() > 0)).toBeTrue();
    expect((pagesSpies[7] as any).calls.mostRecent().args[0]).toBe(true);

    (component as any).loadForSection('blog');
    expect(blogSpies.every((spyRef) => spyRef.calls.count() > 0)).toBeTrue();

    admin.audit.and.returnValue(of({ products: [1], content: [2], security: [3] }));
    (component as any).loadForSection('settings');
    expect(component.productAudit).toEqual([1] as any);
    expect(component.contentAudit).toEqual([2] as any);
    expect(component.securityAudit).toEqual([3] as any);
    expect(settingsSpies.every((spyRef) => spyRef.calls.count() > 0)).toBeTrue();

    admin.audit.and.returnValue(throwError(() => new Error('audit-fail')));
    (component as any).loadForSection('settings');
    expect(toast.error).toHaveBeenCalledWith('adminUi.audit.errors.loadTitle', 'adminUi.audit.errors.loadCopy');
  });


  it('covers saveNavigation invalid, update success, create fallback, and fallback error branches', () => {
    const { component, admin } = createHarness();

    component.navigationForm = {
      header_links: [{ id: '', url: '/about', label: { en: '', ro: 'Despre' } }],
      footer_handcrafted_links: [],
      footer_legal_links: []
    } as any;
    component.saveNavigation();
    expect(component.navigationError).toBe('adminUi.site.navigation.errors.invalid');

    component.navigationForm = {
      header_links: [{ id: 'h1', url: '/about', label: { en: 'About', ro: 'Despre' } }],
      footer_handcrafted_links: [{ id: 'f1', url: '/contact', label: { en: 'Contact', ro: 'Contact' } }],
      footer_legal_links: [{ id: 'l1', url: '/privacy', label: { en: 'Privacy', ro: 'Confidentialitate' } }]
    } as any;

    admin.updateContentBlock.and.returnValue(of({ version: 11 }));
    component.saveNavigation();
    expect(component.navigationMessage).toBe('adminUi.site.navigation.success.save');
    expect(admin.updateContentBlock).toHaveBeenCalled();

    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    admin.createContent.and.returnValue(of({ version: 12 }));
    component.saveNavigation();
    expect(admin.createContent).toHaveBeenCalledWith(
      'site.navigation',
      jasmine.objectContaining({
        title: 'Site navigation',
        status: 'published'
      })
    );

    admin.createContent.and.returnValue(throwError(() => ({ status: 500 })));
    component.saveNavigation();
    expect(component.navigationError).toBe('adminUi.site.navigation.errors.save');
  });

  it('covers saveInfo success, conflict, and create fallback branches', () => {
    const { component, admin } = createHarness();
    const loadContentPagesSpy = spyOn(component, 'loadContentPages').and.stub();

    component.infoForm.about = { en: 'About EN', ro: 'Despre RO' } as any;
    component.infoLang = 'en';
    admin.updateContentBlock.and.returnValue(of({ version: 21, needs_translation_en: true, needs_translation_ro: false }));

    component.saveInfo('page.about', 'Body EN', 'en');
    expect(component.infoMessage).toBe('adminUi.site.pages.success.save');
    expect(loadContentPagesSpy).toHaveBeenCalled();

    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    component.saveInfo('page.about', 'Body conflict', 'en');
    expect(component.infoError).toBe('adminUi.site.pages.errors.save');

    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    admin.createContent.and.returnValue(of({ version: 22, needs_translation_en: false, needs_translation_ro: true }));
    component.saveInfo('page.about', 'Body fallback', 'en');
    expect(admin.createContent).toHaveBeenCalledWith(
      'page.about',
      jasmine.objectContaining({
        title: 'page.about',
        status: 'published',
        lang: 'en'
      })
    );
  });


  it('covers starter template defaults and custom-page creation branches', () => {
    const { component, admin, toast } = createHarness();

    const starterText: any = { key: 'b1', type: 'text', enabled: true };
    const starterFaq: any = { key: 'b2', type: 'faq', enabled: true };
    (component as any).applyStarterTemplateToCustomBlock('text', starterText);
    (component as any).applyStarterTemplateToCustomBlock('faq', starterFaq);
    expect(starterText.title.en).toContain('Section');
    expect(starterFaq.faq_items.length).toBeGreaterThan(0);

    component.newCustomPageTitle = 'Checkout';
    component.createCustomPage();
    expect(toast.error).toHaveBeenCalled();

    component.newCustomPageTitle = 'Coverage Page';
    component.newCustomPageTemplate = 'starter' as any;
    component.newCustomPageStatus = 'published';
    component.newCustomPagePublishedAt = '2026-03-04T09:00';
    component.newCustomPagePublishedUntil = '2026-03-05T09:00';
    component.contentPages = [{ slug: 'coverage-page' }] as any;
    component.createCustomPage();
    expect(admin.createContent).toHaveBeenCalledWith('page.coverage-page-2', jasmine.any(Object));
  });

  it('covers page drag-drop reorder/payload/media branches', () => {
    const { component } = createHarness();
    const safeKey = 'page.about';
    component.pageBlocks[safeKey as any] = [
      { key: 'a', type: 'text', enabled: true } as any,
      { key: 'b', type: 'text', enabled: true } as any
    ];
    component.draggingPageBlocksKey = safeKey as any;
    component.draggingPageBlockKey = 'a';
    const dragEndSpy = spyOn(component, 'onPageBlockDragEnd').and.callThrough();
    const insertSpy = spyOn(component as any, 'insertPageBlockAt').and.stub();
    const mediaSpy = spyOn(component as any, 'insertPageMediaFiles').and.returnValue(Promise.resolve());
    const payloadSpy = spyOn(component as any, 'readCmsBlockPayload').and.returnValues(
      null,
      { scope: 'page', type: 'text', template: 'blank' }
    );

    component.onPageBlockDropZone(new DragEvent('drop'), safeKey as any, 1);
    expect(dragEndSpy).toHaveBeenCalled();

    component.onPageBlockDrop(new DragEvent('drop'), safeKey as any, 'b');
    expect(payloadSpy).toHaveBeenCalled();

    const image = new File(['x'], 'cover.jpg', { type: 'image/jpeg' });
    component.onPageBlockDrop(dragEventWithFiles([image]), safeKey as any, 'b');
    expect(mediaSpy).toHaveBeenCalled();
    expect(insertSpy).toHaveBeenCalledTimes(0);
  });

  it('covers savePageBlocks checklist, update, and 404-create fallback', () => {
    const { component, admin } = createHarness();
    const key = 'page.about';
    const openChecklistSpy = spyOn(component as any, 'openPagePublishChecklist').and.stub();
    const conflictSpy = spyOn(component as any, 'handleContentConflict').and.returnValue(false);
    spyOn(component as any, 'ensurePageDraft').and.returnValue({ markServerSaved: () => undefined, initFromServer: () => undefined });
    spyOn(component as any, 'buildPageBlocksMeta').and.returnValue({ blocks: [] });
    spyOn(component, 'loadPageBlocks').and.stub();

    component.pageBlocksStatus[key as any] = 'published';
    component.savePageBlocks(key as any);
    expect(openChecklistSpy).toHaveBeenCalledWith(key);

    component.savePageBlocks(key as any, { bypassChecklist: true });
    expect(admin.updateContentBlock).toHaveBeenCalled();

    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 404 })));
    component.savePageBlocks(key as any, { bypassChecklist: true });
    expect(admin.createContent).toHaveBeenCalled();
    expect(conflictSpy).toHaveBeenCalled();
  });

  it('covers blog image upload/drop helpers and focal-point edit branches', async () => {
    const { component, admin, toast } = createHarness();
    const area = document.createElement('textarea');
    component.selectedBlogKey = 'blog.coverage';
    component.blogForm = { body_markdown: '' } as any;
    component.blogImageLayout = 'wide';

    const file = new File(['abc'], 'photo.jpg', { type: 'image/jpeg' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    component.uploadAndInsertBlogImage(area, { target: input } as any);
    expect(admin.uploadContentImage).toHaveBeenCalled();

    await component.onBlogImageDrop(area, dragEventWithFiles([file]));
    expect(component.blogImages.length).toBeGreaterThan(0);
    expect(toast.success).toHaveBeenCalled();

    component.blogEditLang = 'en';
    component.blogBaseLang = 'en';
    component.blogImages = [{ id: 'img-1', url: 'https://cdn.test/1.jpg', focal_x: 50, focal_y: 50 }] as any;
    spyOn(component, 'blogCoverPreviewAsset').and.returnValue(component.blogImages[0]);
    spyOn(globalThis, 'prompt').and.returnValues('bad', '20,80');
    component.editBlogCoverFocalPoint();
    component.editBlogCoverFocalPoint();
    expect(admin.updateContentImageFocalPoint).toHaveBeenCalledWith('img-1', 20, 80);
  });

  it('covers saveBlogPost base-lang and translation branches', () => {
    const { component, admin } = createHarness();
    component.selectedBlogKey = 'blog.sample';
    component.blogBaseLang = 'en';
    component.blogEditLang = 'en';
    component.blogForm = { title: 'New title', body_markdown: 'Body', status: 'draft', published_at: '', published_until: '' } as any;
    component.blogMeta = {};
    spyOn(component as any, 'buildBlogMeta').and.returnValue({});
    spyOn(component as any, 'blogA11yIssues').and.returnValue([]);
    spyOn(component as any, 'reloadContentBlocks').and.stub();
    spyOn(component as any, 'loadBlogEditor').and.stub();
    spyOn(component as any, 'ensureBlogDraft').and.returnValue({ markServerSaved: () => undefined, initFromServer: () => undefined });
    spyOn(component as any, 'currentBlogDraftState').and.returnValue({});
    spyOn(component as any, 'handleContentConflict').and.returnValue(false);

    component.saveBlogPost();
    expect(admin.updateContentBlock).toHaveBeenCalled();

    component.blogEditLang = 'ro';
    component.saveBlogPost();
    expect(admin.updateContentBlock.calls.count()).toBeGreaterThan(1);
  });


  it('covers preview-link fallback and error branches', () => {
    const { component } = createHarness();
    const adminAny = (component as any).admin;
    const toast = (component as any).toast as jasmine.SpyObj<any>;
    spyOn(component as any, 'copyToClipboard').and.returnValue(Promise.resolve(false));
    spyOn(component as any, 'pagePreviewShareUrl').and.returnValue(null);
    spyOn(component as any, 'homePreviewShareUrl').and.returnValue(null);

    adminAny.createPagePreviewToken = jasmine
      .createSpy('createPagePreviewToken')
      .and.returnValue(of({ token: 'page-token', expires_at: '2026-03-05T00:00:00Z', url: '::::invalid-url::::' }));
    component.generatePagePreviewLink('page.about');
    expect(toast.success).toHaveBeenCalledWith('adminUi.content.previewLinks.success.ready');

    adminAny.createHomePreviewToken = jasmine
      .createSpy('createHomePreviewToken')
      .and.returnValue(of({ token: 'home-token', expires_at: '2026-03-05T00:00:00Z', url: '::::invalid-url::::' }));
    component.generateHomePreviewLink();
    expect(toast.success).toHaveBeenCalledWith('adminUi.content.previewLinks.success.ready');

    adminAny.createPagePreviewToken.and.returnValue(throwError(() => new Error('preview-fail')));
    component.generatePagePreviewLink('page.about');
    expect(toast.error).toHaveBeenCalledWith('adminUi.content.previewLinks.errors.generate');

    adminAny.createHomePreviewToken.and.returnValue(throwError(() => new Error('home-preview-fail')));
    component.generateHomePreviewLink();
    expect(toast.error).toHaveBeenCalledWith('adminUi.content.previewLinks.errors.generate');
  });

  it('covers markdown heading extraction guards and embed insertion paths', () => {
    const { component } = createHarness();
    const richEditor = { insertMarkdown: jasmine.createSpy('insertMarkdown') } as any;
    const area = document.createElement('textarea');
    area.value = `# First\n#### Skip\n## [Link](https://x.y)\n### ![img](https://img.y/z.jpg)\n`;

    const headings = (component as any).extractMarkdownHeadings(area.value);
    expect(headings.length).toBeGreaterThan(0);
    expect(headings.every((item: { level: number }) => item.level <= 3)).toBeTrue();

    const promptSpy = spyOn(globalThis, 'prompt').and.returnValues('sample-slug', 'sample-slug', 'Descriptive alt');
    spyOn(component as any, 'insertAtCursor').and.callFake(() => undefined);
    component.insertBlogEmbed(area, 'product');
    expect((component as any).insertAtCursor).toHaveBeenCalledWith(area, '{{product:sample-slug}}');
    component.insertBlogEmbed(richEditor, 'collection');
    expect(richEditor.insertMarkdown).toHaveBeenCalledWith('{{collection:sample-slug}}');

    const sparseMarkdown = `![image](https://cdn/a.jpg)\n![two](https://cdn/b.jpg)\n`;
    component.blogForm = { body_markdown: sparseMarkdown } as any;
    spyOn(component as any, 'setBlogMarkdownImageAlt').and.stub();
    component.promptFixBlogImageAlt(1);
    expect(promptSpy.calls.count()).toBeGreaterThan(1);
    expect((component as any).setBlogMarkdownImageAlt).toHaveBeenCalledWith(1, 'Descriptive alt');
  });

  it('covers blog image upload/drop error handling and sorted image updates', async () => {
    const { component, admin } = createHarness();
    component.selectedBlogKey = 'blog.coverage';
    component.blogForm = { body_markdown: '' } as any;

    const imageA = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const imageB = new File(['b'], 'b.jpg', { type: 'image/jpeg' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [imageA], configurable: true });

    admin.uploadContentImage.and.returnValue(
      of({
        images: [
          { id: '2', url: 'https://cdn.test/2.jpg', sort_order: 2 },
          { id: '1', url: 'https://cdn.test/1.jpg', sort_order: 1 }
        ]
      } as any)
    );
    component.uploadAndInsertBlogImage(document.createElement('textarea'), { target: input } as any);
    expect(component.blogImages.map((img) => img.id)).toEqual(['1', '2']);

    admin.uploadContentImage.and.returnValue(throwError(() => new Error('upload-fail')));
    component.uploadAndInsertBlogImage(document.createElement('textarea'), { target: input } as any);
    expect((component as any).toast.error).toHaveBeenCalledWith('adminUi.blog.images.errors.upload');

    admin.uploadContentImage.and.returnValue(
      of({
        images: [
          { id: '10', url: 'https://cdn.test/10.jpg', sort_order: 10 },
          { id: '5', url: 'https://cdn.test/5.jpg', sort_order: 5 }
        ]
      } as any)
    );
    await component.onBlogImageDrop(document.createElement('textarea'), dragEventWithFiles([imageA, imageB]));
    expect(component.blogImages.map((img) => img.id)).toEqual(['5', '10']);
  });

  it('covers report/settings parsing and create fallbacks', () => {
    const { component, admin } = createHarness();

    admin.getContent.and.returnValue(
      of({
        meta: {
          reports_weekly_enabled: 'off',
          reports_monthly_enabled: 'yes',
          reports_recipients: 'one@example.com; two@example.com\nthree@example.com'
        }
      } as any)
    );
    component.loadReportsSettings();
    expect(component.reportsSettingsForm.weekly_enabled).toBeFalse();
    expect(component.reportsSettingsForm.monthly_enabled).toBeTrue();
    expect(component.reportsSettingsForm.recipients).toContain('one@example.com');

    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    admin.createContent.and.returnValue(of({ version: 33, meta: {} } as any));
    component.saveCheckoutSettings();
    expect(admin.createContent).toHaveBeenCalledWith(
      'site.checkout',
      jasmine.objectContaining({ title: 'Checkout settings' })
    );

    component.reportsSettingsForm.recipients = 'valid@example.com, invalid, valid@example.com';
    component.saveReportsSettings();
    expect(admin.createContent).toHaveBeenCalledWith(
      'site.reports',
      jasmine.objectContaining({ title: 'Reports settings' })
    );
  });


});
