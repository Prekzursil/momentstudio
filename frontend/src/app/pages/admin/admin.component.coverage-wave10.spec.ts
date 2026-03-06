import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { AdminComponent } from './admin.component';

type RouteStub = {
  snapshot: { data: Record<string, unknown>; queryParams: Record<string, unknown> };
  data: Subject<Record<string, unknown>>;
  queryParams: Subject<Record<string, unknown>>;
};

function createRouteStub(section: string): RouteStub {
  return {
    snapshot: { data: { section }, queryParams: {} },
    data: new Subject<Record<string, unknown>>(),
    queryParams: new Subject<Record<string, unknown>>(),
  };
}

function createHarness(): {
  component: AdminComponent;
  admin: jasmine.SpyObj<any>;
  blog: jasmine.SpyObj<any>;
  fxAdmin: jasmine.SpyObj<any>;
  taxesAdmin: jasmine.SpyObj<any>;
  toast: jasmine.SpyObj<any>;
} {
  const route = createRouteStub('blog');
  const admin = jasmine.createSpyObj('AdminService', [
    'products',
    'coupons',
    'lowStock',
    'audit',
    'getMaintenance',
    'getContent',
    'getContentVersion',
    'updateContentBlock',
    'createContent',
    'rollbackContentVersion',
    'uploadContentImage',
    'updateContentImageFocalPoint',
    'createCategory',
    'sendScheduledReport',
  ]);
  const blog = jasmine.createSpyObj('BlogService', [
    'listFlaggedComments',
    'hideCommentAdmin',
    'unhideCommentAdmin',
    'deleteComment',
  ]);
  const fxAdmin = jasmine.createSpyObj('FxAdminService', ['getStatus', 'listOverrideAudit', 'clearOverride']);
  const taxesAdmin = jasmine.createSpyObj('TaxesAdminService', ['createGroup', 'listGroups']);
  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);

  admin.products.and.returnValue(of([]));
  admin.coupons.and.returnValue(of([]));
  admin.lowStock.and.returnValue(of([]));
  admin.audit.and.returnValue(of({ products: [], content: [], security: [] }));
  admin.getMaintenance.and.returnValue(of({ enabled: false }));
  admin.getContent.and.returnValue(of({ title: 'T', body_markdown: 'Body', status: 'draft', lang: 'en', meta: {} }));
  admin.getContentVersion.and.returnValue(of({ body_markdown: 'old' }));
  admin.updateContentBlock.and.returnValue(of({ version: 2, meta: {} }));
  admin.createContent.and.returnValue(of({ version: 3, meta: {} }));
  admin.rollbackContentVersion.and.returnValue(of({}));
  admin.uploadContentImage.and.returnValue(
    of({
      images: [{ id: 'img-1', url: 'https://cdn.test/image.jpg', sort_order: 0, focal_x: 50, focal_y: 50 }],
    }),
  );
  admin.updateContentImageFocalPoint.and.returnValue(of({ focal_x: 25, focal_y: 75 }));
  admin.createCategory.and.returnValue(of({ id: 'cat-1', slug: 'new-cat', name: 'New Cat' }));
  admin.sendScheduledReport.and.returnValue(of({ skipped: false }));

  blog.listFlaggedComments.and.returnValue(of({ items: [] }));
  blog.hideCommentAdmin.and.returnValue(of({}));
  blog.unhideCommentAdmin.and.returnValue(of({}));
  blog.deleteComment.and.returnValue(of({}));

  fxAdmin.getStatus.and.returnValue(of({ effective: { eur_per_ron: 5, usd_per_ron: 4.6, as_of: '' }, override: null }));
  fxAdmin.listOverrideAudit.and.returnValue(of([]));
  fxAdmin.clearOverride.and.returnValue(of({}));

  taxesAdmin.createGroup.and.returnValue(of({}));
  taxesAdmin.listGroups.and.returnValue(of([]));

  const component = new AdminComponent(
    {
      snapshot: route.snapshot,
      data: route.data.asObservable(),
      queryParams: route.queryParams.asObservable(),
    } as unknown as ActivatedRoute,
    admin as any,
    {} as any,
    blog as any,
    fxAdmin as any,
    taxesAdmin as any,
    { role: () => 'owner', loadCurrentUser: () => of(null) } as any,
    {
      mode: () => 'advanced',
      previewDevice: () => 'desktop',
      previewLayout: () => 'split',
      previewLang: () => 'en',
      previewTheme: () => 'light',
      translationLayout: () => 'stacked',
    } as any,
    toast as any,
    { instant: (k: string) => k } as any,
    { render: (value: string) => value } as any,
    {
      bypassSecurityTrustHtml: (value: string) => value,
      bypassSecurityTrustResourceUrl: (value: string) => value,
    } as unknown as DomSanitizer,
  );

  const cmp: any = component;
  cmp.selectedBlogKey = 'blog.sample';
  cmp.blogBaseLang = 'en';
  cmp.blogEditLang = 'en';
  cmp.blogForm = {
    title: 'Title',
    body_markdown: 'Body',
    status: 'draft',
    published_at: '',
    published_until: '',
    summary: '',
    tags: '',
    series: '',
    cover_image_url: '',
    cover_fit: 'cover',
    reading_time_minutes: '',
    pinned: false,
    pin_order: '1',
  };
  cmp.blogMeta = {};
  cmp.blogBulkSelection = new Set<string>();
  cmp.blogBulkAction = 'publish';
  cmp.blogBulkTags = '';
  cmp.blogBulkPublishAt = '';
  cmp.blogBulkUnpublishAt = '';
  cmp.blogImages = [];

  return { component, admin, blog, fxAdmin, taxesAdmin, toast };
}

describe('AdminComponent coverage wave 10 targeted branch closures', () => {
  it('covers saveBlogPost publish confirmation refusal and conflict callback branch', () => {
    const { component, admin, toast } = createHarness();
    const cmp: any = component;
    cmp.blogForm.status = 'published';
    spyOn(cmp, 'blogA11yIssues').and.returnValue([{ i: 1 }]);
    spyOn(globalThis, 'confirm').and.returnValue(false);

    cmp.saveBlogPost();
    expect(admin.updateContentBlock).not.toHaveBeenCalled();

    (globalThis.confirm as jasmine.Spy).and.returnValue(true);
    cmp.handleContentConflict = jasmine.createSpy('handleContentConflict').and.returnValue(true);
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    cmp.saveBlogPost();
    expect(cmp.handleContentConflict).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalledWith('adminUi.blog.errors.save');
  });

  it('covers blog bulk preview schedule/tags branches and no-changes apply branch', () => {
    const { component, admin } = createHarness();
    const cmp: any = component;
    cmp.blogBulkSelection.add('blog.a');
    cmp.blogBulkAction = 'schedule';
    cmp.blogBulkPublishAt = '2026-03-05T12:30';
    cmp.blogBulkUnpublishAt = '2026-03-06T12:30';
    expect(cmp.blogBulkPreview()).toBe('adminUi.blog.bulk.previewSchedule');

    cmp.blogBulkAction = 'tags_add';
    cmp.blogBulkTags = 'one,two';
    expect(cmp.blogBulkPreview()).toBe('adminUi.blog.bulk.previewTagsAdd');

    admin.getContent.and.returnValue(throwError(() => new Error('missing')));
    cmp.applyBlogBulkAction();
    expect(cmp.blogBulkSaving).toBeFalse();
    expect(cmp.blogBulkError).toBe('adminUi.blog.bulk.noChanges');
  });

  it('covers moderation toggle hide/unhide and delete guard branches', () => {
    const { component, blog, toast } = createHarness();
    const cmp: any = component;
    const comment = { id: 'c-1', is_hidden: true } as any;
    cmp.flaggedComments.set([comment]);

    blog.unhideCommentAdmin.and.returnValue(throwError(() => new Error('fail')));
    cmp.toggleHide(comment);
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.moderation.errors.unhide');

    const visible = { id: 'c-2', is_hidden: false } as any;
    cmp.flaggedComments.set([visible]);
    spyOn(globalThis, 'prompt').and.returnValue(null);
    cmp.toggleHide(visible);
    expect(blog.hideCommentAdmin).not.toHaveBeenCalled();

    (globalThis.prompt as jasmine.Spy).and.returnValue('reason');
    blog.hideCommentAdmin.and.returnValue(throwError(() => new Error('hide-fail')));
    cmp.toggleHide(visible);
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.moderation.errors.hide');

    cmp.blogCommentModerationBusy.add('busy');
    cmp.adminDeleteComment({ id: 'busy' } as any);
    cmp.blogCommentModerationBusy.clear();
    spyOn(globalThis, 'confirm').and.returnValue(false);
    cmp.adminDeleteComment({ id: 'c-3' } as any);
    expect(blog.deleteComment).not.toHaveBeenCalled();
  });

  it('covers select/rollback blog version error and success branches', () => {
    const { component, admin, toast } = createHarness();
    const cmp: any = component;
    cmp.blogForm.body_markdown = 'Current';

    cmp.selectBlogVersion(2);
    expect(cmp.blogVersionDetail).toBeTruthy();
    expect(Array.isArray(cmp.blogDiffParts)).toBeTrue();

    admin.getContentVersion.and.returnValue(throwError(() => new Error('version-fail')));
    cmp.selectBlogVersion(3);
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.revisions.errors.loadVersion');

    spyOn(globalThis, 'confirm').and.returnValues(false, true);
    cmp.rollbackBlogVersion(4);
    expect(admin.rollbackContentVersion).not.toHaveBeenCalled();

    admin.rollbackContentVersion.and.returnValue(of({}));
    spyOn(cmp, 'reloadContentBlocks').and.stub();
    spyOn(cmp, 'loadBlogVersions').and.stub();
    spyOn(cmp, 'loadBlogEditor').and.stub();
    cmp.rollbackBlogVersion(5);
    expect(cmp.loadBlogEditor).toHaveBeenCalledWith('blog.sample');
  });

  it('covers blog image upload/drop and drag-over guard branches', async () => {
    const { component, admin, toast } = createHarness();
    const cmp: any = component;
    const textarea = document.createElement('textarea');
    textarea.value = '';
    textarea.setSelectionRange(0, 0);

    admin.uploadContentImage.and.returnValue(throwError(() => new Error('upload-fail')));
    const failedInput = document.createElement('input');
    const failedFile = new File(['x'], 'bad.png', { type: 'image/png' });
    Object.defineProperty(failedInput, 'files', { value: [failedFile], configurable: true });
    cmp.uploadAndInsertBlogImage(textarea, { target: failedInput } as any);
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.images.errors.upload');

    admin.uploadContentImage.and.returnValue(
      of({
        images: [{ id: 'img-ok', url: 'https://cdn.test/ok.png', sort_order: 1, focal_x: 50, focal_y: 50 }],
      }),
    );
    const okInput = document.createElement('input');
    const okFile = new File(['y'], 'ok-file.png', { type: 'image/png' });
    Object.defineProperty(okInput, 'files', { value: [okFile], configurable: true });
    cmp.uploadAndInsertBlogImage(textarea, { target: okInput } as any);
    expect(cmp.blogImages.length).toBe(1);
    expect(toast.info).toHaveBeenCalledWith('adminUi.blog.images.success.insertedMarkdown');

    const dragNoFiles: any = { dataTransfer: { types: [] }, preventDefault: jasmine.createSpy('pd') };
    cmp.onBlogImageDragOver(dragNoFiles);
    expect(dragNoFiles.preventDefault).not.toHaveBeenCalled();

    const dragWithFiles: any = { dataTransfer: { types: ['Files'] }, preventDefault: jasmine.createSpy('pd') };
    cmp.onBlogImageDragOver(dragWithFiles);
    expect(dragWithFiles.preventDefault).toHaveBeenCalled();

    const dropEvent: any = {
      dataTransfer: { files: [new File(['z'], 'drop.png', { type: 'image/png' })] },
      preventDefault: jasmine.createSpy('pd'),
      stopPropagation: jasmine.createSpy('sp'),
    };
    admin.uploadContentImage.and.returnValue(throwError(() => new Error('drop-fail')));
    await cmp.onBlogImageDrop(textarea, dropEvent as DragEvent);
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.images.errors.upload');
  });

  it('covers promptFixBlogImageAlt, heading extraction, and blog-meta sync/build branches', () => {
    const { component, admin, toast } = createHarness();
    const cmp: any = component;
    cmp.blogForm.body_markdown = '![image](https://cdn.test/my-file.png)';

    spyOn(globalThis, 'prompt').and.returnValue('  Better alt  ');
    spyOn(cmp, 'setBlogMarkdownImageAlt').and.callThrough();
    cmp.promptFixBlogImageAlt(0);
    expect(cmp.setBlogMarkdownImageAlt).toHaveBeenCalledWith(0, 'Better alt');
    expect(toast.success).toHaveBeenCalledWith('adminUi.blog.a11y.fixed');

    const headings = cmp.extractMarkdownHeadings('# One\n#### Skip me\n```md\n## hidden\n```\n## [Two](x)');
    expect(headings.length).toBe(2);
    expect(headings[0].level).toBe(1);

    cmp.blogMeta = { tags: ['a', 'b'], summary: 'base summary', pinned: 'true', pin_order: '0' };
    cmp.syncBlogMetaToForm('en');
    expect(cmp.blogForm.tags).toBe('a, b');
    expect(cmp.blogForm.pinned).toBeTrue();

    cmp.blogForm.tags = 'x, y';
    cmp.blogForm.summary = 'localized';
    cmp.blogForm.pinned = true;
    cmp.blogForm.pin_order = '3';
    const nextMeta = cmp.buildBlogMeta('ro');
    expect(nextMeta.tags).toEqual(['x', 'y']);
    expect(nextMeta.summary.ro).toBe('localized');
    expect(nextMeta.pin_order).toBe(3);

    admin.getContent.and.callFake((key: string) => {
      if (key === 'blog.sample') {
        return of({
          title: 'T',
          body_markdown: 'B',
          status: 'draft',
          lang: 'ro',
          meta: {},
          images: [{ id: '2', url: 'https://cdn.test/2.png', sort_order: 2 }],
        });
      }
      return of({ title: 'x', body_markdown: 'y', status: 'draft', lang: 'en', meta: {} });
    });
    spyOn(cmp, 'loadBlogVersions').and.stub();
    cmp.loadBlogEditor('blog.sample');
    expect(cmp.blogBaseLang).toBe('ro');
    expect(cmp.blogImages.length).toBe(1);
  });

  it('covers audit/fx/category/tax/reports residual guard and error branches', () => {
    const { component, admin, fxAdmin, taxesAdmin, toast } = createHarness();
    const cmp: any = component;

    admin.audit.and.returnValue(throwError(() => new Error('audit')));
    cmp.loadAudit();
    expect(toast.error).toHaveBeenCalledWith('adminUi.audit.errors.loadTitle', 'adminUi.audit.errors.loadCopy');

    cmp.fxStatus.set({ effective: { eur_per_ron: 5, usd_per_ron: 4.5, as_of: '' }, override: null } as any);
    cmp.clearFxOverride();
    expect(fxAdmin.clearOverride).not.toHaveBeenCalled();
    cmp.fxStatus.set({ effective: { eur_per_ron: 5, usd_per_ron: 4.5, as_of: '' }, override: { eur_per_ron: 5 } } as any);
    spyOn(globalThis, 'confirm').and.returnValues(false, true);
    cmp.clearFxOverride();
    expect(fxAdmin.clearOverride).not.toHaveBeenCalled();
    fxAdmin.clearOverride.and.returnValue(throwError(() => new Error('clear-fail')));
    cmp.clearFxOverride();
    expect(toast.error).toHaveBeenCalledWith('adminUi.fx.errors.overrideCleared');

    cmp.categoryWizardStep.set(0);
    cmp.categoryWizardPrev();
    expect(cmp.categoryWizardStep()).toBe(0);
    cmp.categoryWizardStep.set(2);
    cmp.categoryWizardPrev();
    expect(cmp.categoryWizardStep()).toBe(1);

    cmp.categoryName = '';
    cmp.addCategory();
    expect(toast.error).toHaveBeenCalledWith('adminUi.categories.errors.required');

    cmp.categoryWizardOpen.set(true);
    cmp.categoryWizardStep.set(0);
    cmp.categoryName = 'New';
    spyOn(cmp, 'openCategoryWizardTranslations').and.stub();
    cmp.addCategory();
    expect(cmp.categoryWizardSlug()).toBe('new-cat');
    expect(cmp.categoryWizardStep()).toBe(1);

    cmp.taxGroupCreate = { code: '', name: '', description: '', is_default: false };
    cmp.createTaxGroup();
    expect(toast.error).toHaveBeenCalledWith('adminUi.taxes.errors.required');
    cmp.taxGroupCreate = { code: 'STD', name: 'Standard', description: '', is_default: false };
    taxesAdmin.createGroup.and.returnValue(throwError(() => ({ error: { detail: 'group-failed' } })));
    cmp.createTaxGroup();
    expect(toast.error).toHaveBeenCalledWith('group-failed');

    admin.getContent.and.callFake((key: string) => {
      if (key === 'site.reports') return throwError(() => new Error('reports-fail'));
      return of({ title: 'x', body_markdown: 'y', status: 'draft', lang: 'en', meta: {} });
    });
    cmp.loadReportsSettings();
    expect(cmp.reportsSettingsForm.weekly_enabled).toBeFalse();
  });

  it('covers checkout settings normalization, fallback create, and conflict save branches', () => {
    const { component, admin } = createHarness();
    const cmp: any = component;
    cmp.handleContentConflict = jasmine.createSpy('handleContentConflict').and.returnValue(false);
    cmp.checkoutSettingsForm = {
      shipping_fee_ron: '-1',
      free_shipping_threshold_ron: 'NaN',
      phone_required_home: 0,
      phone_required_locker: 1,
      fee_enabled: true,
      fee_type: 'nope',
      fee_value: '-4',
      vat_enabled: true,
      vat_rate_percent: '500',
      vat_apply_to_shipping: 0,
      vat_apply_to_fee: 1,
      receipt_share_days: '99999',
      money_rounding: 'unknown',
    };

    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    admin.createContent.and.returnValue(of({ version: 11 }));
    cmp.saveCheckoutSettings();

    const payload = admin.createContent.calls.mostRecent().args[1];
    expect(payload.meta.shipping_fee_ron).toBe(20);
    expect(payload.meta.free_shipping_threshold_ron).toBe(300);
    expect(payload.meta.fee_type).toBe('flat');
    expect(payload.meta.fee_value).toBe(0);
    expect(payload.meta.vat_rate_percent).toBe(10);
    expect(payload.meta.receipt_share_days).toBe(365);
    expect(payload.meta.money_rounding).toBe('half_up');
    expect(cmp.checkoutSettingsMessage).toBe('adminUi.site.checkout.success.save');

    cmp.handleContentConflict.and.returnValue(true);
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    cmp.saveCheckoutSettings();
    expect(cmp.checkoutSettingsError).toBe('adminUi.site.checkout.errors.save');
  });

  it('covers reports settings sanitize/create fallback, conflict, and send-now branches', () => {
    const { component, admin } = createHarness();
    const cmp: any = component;
    cmp.handleContentConflict = jasmine.createSpy('handleContentConflict').and.returnValue(false);
    cmp.reportsSettingsMeta = {};
    cmp.reportsSettingsForm = {
      weekly_enabled: true,
      weekly_weekday: 99,
      weekly_hour_utc: -5,
      monthly_enabled: true,
      monthly_day: '99',
      monthly_hour_utc: 77,
      recipients: 'A@EXAMPLE.COM; bad; a@example.com; B@example.com',
    };
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    admin.createContent.and.returnValue(of({ version: 2, meta: {} }));
    cmp.saveReportsSettings();

    const payload = admin.createContent.calls.mostRecent().args[1];
    expect(payload.meta.reports_weekly_weekday).toBe(6);
    expect(payload.meta.reports_weekly_hour_utc).toBe(0);
    expect(payload.meta.reports_monthly_day).toBe(28);
    expect(payload.meta.reports_monthly_hour_utc).toBe(23);
    expect(payload.meta.reports_recipients).toEqual(['a@example.com', 'b@example.com']);

    cmp.handleContentConflict.and.returnValue(true);
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    cmp.saveReportsSettings();
    expect(cmp.reportsSettingsError).toBe('adminUi.reports.errors.save');

    spyOn(cmp, 'loadReportsSettings').and.stub();
    admin.sendScheduledReport.and.returnValue(of({ skipped: true }));
    cmp.sendReportNow('weekly');
    expect(cmp.reportsSettingsMessage).toBe('adminUi.reports.success.skipped');
    expect(cmp.loadReportsSettings).toHaveBeenCalled();

    cmp.reportsSending = true;
    cmp.sendReportNow('monthly');
    expect(admin.sendScheduledReport.calls.count()).toBe(1);
    cmp.reportsSending = false;

    admin.sendScheduledReport.and.returnValue(throwError(() => new Error('send-fail')));
    cmp.sendReportNow('monthly');
    expect(cmp.reportsSettingsError).toBe('adminUi.reports.errors.send');
  });

  it('covers legal-page save chains, page-load 404/general error, and custom-page create branches', () => {
    const { component, admin, toast } = createHarness();
    const cmp: any = component;

    spyOn(cmp, 'saveLegalMetaIfNeeded').and.callFake((_key: any, onOk: () => void) => onOk());
    spyOn(cmp, 'savePageMarkdownInternal').and.callFake(
      (_key: string, _body: string, lang: string, onSuccess: () => void, onError: () => void) => {
        if (lang === 'ro') onError();
        else onSuccess();
      },
    );
    cmp.legalPageForm = { en: 'EN', ro: 'RO' };
    cmp.saveLegalPageBoth('legal.terms', cmp.legalPageForm);
    expect(cmp.savePageMarkdownInternal.calls.count()).toBe(2);
    expect(cmp.legalPageError).toBe('adminUi.site.pages.errors.save');

    admin.getContent.and.returnValue(throwError(() => ({ status: 404 })));
    cmp.loadPageBlocks('page.faq');
    expect(cmp.pageBlocks['page.faq']).toEqual([]);

    admin.getContent.and.returnValue(throwError(() => ({ status: 500 })));
    cmp.loadPageBlocks('page.faq');
    expect(cmp.pageBlocksError['page.faq']).toBe('adminUi.site.pages.builder.errors.load');

    cmp.newCustomPageTitle = 'New Page';
    cmp.newCustomPageTemplate = 'blank';
    cmp.newCustomPageStatus = 'draft';
    cmp.contentPages = [{ slug: 'new-page' }];
    spyOn(cmp, 'isReservedPageSlug').and.returnValue(true);
    cmp.createCustomPage();
    expect(toast.error).toHaveBeenCalledWith('adminUi.site.pages.errors.reservedTitle', 'adminUi.site.pages.errors.reservedCopy');

    (cmp.isReservedPageSlug as jasmine.Spy).and.returnValue(false);
    spyOn(cmp, 'loadContentPages').and.stub();
    spyOn(cmp, 'loadPageBlocks').and.stub();
    admin.createContent.and.returnValue(of({}));
    cmp.createCustomPage();
    expect(cmp.loadPageBlocks).toHaveBeenCalled();

    admin.createContent.and.returnValue(throwError(() => ({ error: { detail: 'bad-create' } })));
    cmp.newCustomPageTitle = 'Another Page';
    cmp.createCustomPage();
    expect(toast.error).toHaveBeenCalledWith('bad-create');
  });

});
