import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { AdminComponent } from './admin.component';

/**
 * Behavioral coverage for the content-admin AdminComponent.
 *
 * The component is constructed directly (no TestBed) with spy services so each
 * method's real success / error / guard branches can be exercised and asserted
 * against actual state mutations and toast side effects.
 */
describe('AdminComponent behavioral coverage', () => {
  interface Harness {
    component: AdminComponent;
    admin: jasmine.SpyObj<any>;
    adminProducts: jasmine.SpyObj<any>;
    blog: jasmine.SpyObj<any>;
    fxAdmin: jasmine.SpyObj<any>;
    taxesAdmin: jasmine.SpyObj<any>;
    auth: jasmine.SpyObj<any>;
    toast: jasmine.SpyObj<any>;
    cms: {
      mode: 'simple' | 'advanced';
      previewDevice: 'desktop' | 'mobile' | 'tablet';
      previewLayout: 'split' | 'stacked';
    };
    route: {
      snapshot: { data: Record<string, unknown>; queryParams: Record<string, unknown> };
      data: Subject<Record<string, unknown>>;
      queryParams: Subject<Record<string, unknown>>;
    };
  }

  const FX_STATUS = {
    override: null,
    effective: { eur_per_ron: '5', usd_per_ron: '4', as_of: '2024-01-01' },
  };

  function createHarness(section = 'home', query: Record<string, unknown> = {}): Harness {
    const admin = jasmine.createSpyObj('AdminService', [
      'products',
      'coupons',
      'lowStock',
      'audit',
      'updateCategory',
      'transferOwner',
      'getMaintenance',
    ]);
    const adminProducts = jasmine.createSpyObj('AdminProductsService', [
      'byIds',
      'duplicateCheck',
      'restore',
      'search',
    ]);
    const blog = jasmine.createSpyObj('BlogService', ['listFlaggedComments', 'listPosts']);
    const fxAdmin = jasmine.createSpyObj('FxAdminService', [
      'clearOverride',
      'getStatus',
      'listOverrideAudit',
      'restoreOverrideFromAudit',
      'setOverride',
    ]);
    const taxesAdmin = jasmine.createSpyObj('TaxesAdminService', [
      'createGroup',
      'deleteGroup',
      'deleteRate',
      'listGroups',
      'updateGroup',
      'upsertRate',
    ]);
    const auth = jasmine.createSpyObj('AuthService', ['role', 'loadCurrentUser']);
    const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);

    fxAdmin.getStatus.and.returnValue(of(FX_STATUS));
    fxAdmin.listOverrideAudit.and.returnValue(of([]));
    auth.loadCurrentUser.and.returnValue(of(null));
    auth.role.and.returnValue('owner');

    const cms = {
      mode: 'simple' as 'simple' | 'advanced',
      previewDevice: 'desktop' as 'desktop' | 'mobile' | 'tablet',
      previewLayout: 'split' as 'split' | 'stacked',
    };
    const cmsPrefs = {
      mode: () => cms.mode,
      previewDevice: () => cms.previewDevice,
      previewLayout: () => cms.previewLayout,
    };

    const route = {
      snapshot: { data: { section }, queryParams: query },
      data: new Subject<Record<string, unknown>>(),
      queryParams: new Subject<Record<string, unknown>>(),
    };

    const component = new AdminComponent(
      {
        snapshot: route.snapshot,
        data: route.data.asObservable(),
        queryParams: route.queryParams.asObservable(),
      } as unknown as ActivatedRoute,
      admin as any,
      adminProducts as any,
      blog as any,
      fxAdmin as any,
      taxesAdmin as any,
      auth as any,
      cmsPrefs as any,
      toast as any,
      { instant: (k: string) => k } as any,
      { render: (value: string) => value } as any,
      { bypassSecurityTrustHtml: (value: string) => value } as unknown as DomSanitizer,
    );

    return { component, admin, adminProducts, blog, fxAdmin, taxesAdmin, auth, toast, cms, route };
  }

  // ---------------------------------------------------------------------------
  // Navigation / lifecycle
  // ---------------------------------------------------------------------------

  describe('section navigation', () => {
    it('normalizes unknown sections to home and keeps known ones', () => {
      const { component } = createHarness();
      const normalize = (v: unknown) => (component as any).normalizeSection(v);
      expect(normalize('home')).toBe('home');
      expect(normalize('pages')).toBe('pages');
      expect(normalize('blog')).toBe('blog');
      expect(normalize('settings')).toBe('settings');
      expect(normalize('garbage')).toBe('home');
      expect(normalize(undefined)).toBe('home');
    });

    it('applySection switches to a new section, sets crumbs and resets state', () => {
      const { component } = createHarness();
      const load = spyOn<any>(component, 'loadForSection').and.stub();
      const reset = spyOn<any>(component, 'resetSectionState').and.stub();
      const poller = spyOn<any>(component, 'syncCmsDraftPoller').and.stub();

      (component as any).applySection('blog');

      expect(component.section()).toBe('blog');
      expect(component.crumbs.length).toBe(2);
      expect(component.crumbs[1].label).toBe('adminUi.content.nav.blog');
      expect(reset).toHaveBeenCalledWith('blog');
      expect(load).toHaveBeenCalledWith('blog');
      expect(poller).toHaveBeenCalledWith('blog');
    });

    it('applySection for the same section reloads without resetting state', () => {
      const { component } = createHarness();
      component.section.set('home');
      const load = spyOn<any>(component, 'loadForSection').and.stub();
      const reset = spyOn<any>(component, 'resetSectionState').and.stub();
      spyOn<any>(component, 'syncCmsDraftPoller').and.stub();

      (component as any).applySection('home');

      expect(reset).not.toHaveBeenCalled();
      expect(load).toHaveBeenCalledWith('home');
    });

    it('applyContentEditQuery loads the blog editor for blog edit query', () => {
      const { component } = createHarness();
      const loadBlog = spyOn<any>(component, 'loadBlogEditor').and.stub();

      (component as any).applyContentEditQuery('blog', { edit: 'welcome' });
      expect(loadBlog).toHaveBeenCalledWith('blog.welcome');

      // Already-prefixed key is preserved.
      (component as any).applyContentEditQuery('blog', { edit: 'blog.other' });
      expect(loadBlog).toHaveBeenCalledWith('blog.other');
    });

    it('applyContentEditQuery skips reload when blog key already selected', () => {
      const { component } = createHarness();
      component.selectedBlogKey = 'blog.welcome';
      const loadBlog = spyOn<any>(component, 'loadBlogEditor').and.stub();
      (component as any).applyContentEditQuery('blog', { edit: 'welcome' });
      expect(loadBlog).not.toHaveBeenCalled();
    });

    it('applyContentEditQuery routes page edit queries to onPageBlocksKeyChange', () => {
      const { component } = createHarness();
      component.pageBlocksKey = 'page.other' as any;
      const change = spyOn<any>(component, 'onPageBlocksKeyChange').and.stub();
      (component as any).applyContentEditQuery('pages', { edit: 'about' });
      expect(change).toHaveBeenCalledWith('page.about');
    });

    it('applyContentEditQuery ignores empty edit values', () => {
      const { component } = createHarness();
      const loadBlog = spyOn<any>(component, 'loadBlogEditor').and.stub();
      const change = spyOn<any>(component, 'onPageBlocksKeyChange').and.stub();
      (component as any).applyContentEditQuery('blog', { edit: '   ' });
      (component as any).applyContentEditQuery('pages', {});
      expect(loadBlog).not.toHaveBeenCalled();
      expect(change).not.toHaveBeenCalled();
    });

    it('applyContentEditQuery ignores page key that normalizes to empty', () => {
      const { component } = createHarness();
      component.pageBlocksKey = 'page.about' as any;
      const change = spyOn<any>(component, 'onPageBlocksKeyChange').and.stub();
      (component as any).applyContentEditQuery('pages', { edit: 'about' });
      expect(change).not.toHaveBeenCalled();
    });

    it('loadAll and retryLoadAll delegate to loadForSection for the active section', () => {
      const { component } = createHarness();
      component.section.set('pages');
      const load = spyOn<any>(component, 'loadForSection').and.stub();
      component.loadAll();
      component.retryLoadAll();
      expect(load).toHaveBeenCalledTimes(2);
      expect(load).toHaveBeenCalledWith('pages');
    });

    it('ngOnInit applies snapshot then reacts to stream emissions', () => {
      const { component, route } = createHarness('blog', { edit: 'welcome' });
      const applySection = spyOn<any>(component, 'applySection').and.stub();
      const applyQuery = spyOn<any>(component, 'applyContentEditQuery').and.stub();

      component.ngOnInit();
      expect(applySection).toHaveBeenCalledWith('blog');
      expect(applyQuery).toHaveBeenCalledWith('blog', { edit: 'welcome' });

      route.data.next({ section: 'pages' });
      route.queryParams.next({ edit: 'about' });
      expect(applySection).toHaveBeenCalledWith('pages');

      component.ngOnDestroy();
    });
  });

  describe('resetSectionState', () => {
    it('clears blog state when leaving blog', () => {
      const { component } = createHarness();
      const closeBlog = spyOn<any>(component, 'closeBlogEditor').and.stub();
      component.showBlogCreate = true;
      component.flaggedComments.set([{ id: 'c1' } as any]);
      (component as any).flaggedCommentsError = 'boom';

      (component as any).resetSectionState('home');

      expect(closeBlog).toHaveBeenCalled();
      expect(component.showBlogCreate).toBe(false);
      expect(component.flaggedComments()).toEqual([]);
      expect((component as any).flaggedCommentsError).toBeNull();
    });

    it('clears content preview when leaving settings but keeps blog state for blog', () => {
      const { component } = createHarness();
      const closeBlog = spyOn<any>(component, 'closeBlogEditor').and.stub();
      component.selectedContent = { key: 'x' } as any;
      component.showContentPreview = true;

      (component as any).resetSectionState('blog');

      expect(closeBlog).not.toHaveBeenCalled();
      expect(component.selectedContent).toBeNull();
      expect(component.showContentPreview).toBe(false);
    });
  });

  describe('loadForSection routing', () => {
    function stubChildren(component: AdminComponent): Record<string, jasmine.Spy> {
      const names = [
        'loadSections',
        'loadCollections',
        'loadInfo',
        'loadLegalPage',
        'loadCategories',
        'loadContentPages',
        'loadReusableBlocks',
        'loadPageBlocks',
        'loadContentRedirects',
        'reloadContentBlocks',
        'loadFlaggedComments',
        'loadTaxGroups',
        'loadAssets',
        'loadSocial',
        'loadCompany',
        'loadNavigation',
        'loadCheckoutSettings',
        'loadReportsSettings',
        'loadSeo',
        'loadFxStatus',
      ];
      const spies: Record<string, jasmine.Spy> = {};
      for (const n of names) spies[n] = spyOn<any>(component, n).and.stub();
      return spies;
    }

    it('home loads products, sections and collections', () => {
      const { component, admin } = createHarness();
      admin.products.and.returnValue(of([{ id: 'p1' }]));
      const spies = stubChildren(component);

      (component as any).loadForSection('home');

      expect(component.products).toEqual([{ id: 'p1' }] as any);
      expect(spies['loadSections']).toHaveBeenCalled();
      expect(spies['loadCollections']).toHaveBeenCalled();
      expect(component.loading()).toBe(false);
    });

    it('home products error path resets products to empty array', () => {
      const { component, admin } = createHarness();
      admin.products.and.returnValue(throwError(() => new Error('nope')));
      stubChildren(component);
      component.products = [{ id: 'old' } as any];

      (component as any).loadForSection('home');

      expect(component.products).toEqual([]);
    });

    it('pages loads the page-builder data set', () => {
      const { component } = createHarness();
      const spies = stubChildren(component);
      (component as any).loadForSection('pages');
      expect(spies['loadInfo']).toHaveBeenCalled();
      expect(spies['loadContentPages']).toHaveBeenCalled();
      expect(spies['loadContentRedirects']).toHaveBeenCalledWith(true);
      expect(component.loading()).toBe(false);
    });

    it('blog loads content blocks and flagged comments', () => {
      const { component } = createHarness();
      const spies = stubChildren(component);
      (component as any).loadForSection('blog');
      expect(spies['reloadContentBlocks']).toHaveBeenCalled();
      expect(spies['loadFlaggedComments']).toHaveBeenCalled();
      expect(component.loading()).toBe(false);
    });

    it('settings loads coupons, low stock, audit and maintenance', () => {
      const { component, admin } = createHarness();
      admin.coupons.and.returnValue(of([{ code: 'X' }]));
      admin.lowStock.and.returnValue(of([{ id: 'i1' }]));
      admin.audit.and.returnValue(
        of({ products: [{ id: 'a' }], content: [{ id: 'b' }], security: [{ id: 'c' }] }),
      );
      admin.getMaintenance.and.returnValue(of({ enabled: true }));
      stubChildren(component);

      (component as any).loadForSection('settings');

      expect(component.coupons).toEqual([{ code: 'X' }] as any);
      expect(component.lowStock).toEqual([{ id: 'i1' }] as any);
      expect(component.productAudit).toEqual([{ id: 'a' }] as any);
      expect(component.securityAudit).toEqual([{ id: 'c' }] as any);
      expect(component.maintenanceEnabled()).toBe(true);
      expect(component.loading()).toBe(false);
    });

    it('settings error paths fall back to empty collections and toast', () => {
      const { component, admin, toast } = createHarness();
      admin.coupons.and.returnValue(throwError(() => new Error('e')));
      admin.lowStock.and.returnValue(throwError(() => new Error('e')));
      admin.audit.and.returnValue(throwError(() => new Error('e')));
      admin.getMaintenance.and.returnValue(of({ enabled: false }));
      stubChildren(component);

      (component as any).loadForSection('settings');

      expect(component.coupons).toEqual([]);
      expect(component.lowStock).toEqual([]);
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.audit.errors.loadTitle',
        'adminUi.audit.errors.loadCopy',
      );
    });

    it('settings audit without security key defaults to empty array', () => {
      const { component, admin } = createHarness();
      admin.coupons.and.returnValue(of([]));
      admin.lowStock.and.returnValue(of([]));
      admin.audit.and.returnValue(of({ products: [], content: [] }));
      admin.getMaintenance.and.returnValue(of({ enabled: false }));
      stubChildren(component);

      (component as any).loadForSection('settings');
      expect(component.securityAudit).toEqual([]);
    });
  });

  describe('loadAudit', () => {
    it('stores the three audit buckets on success', () => {
      const { component, admin } = createHarness();
      admin.audit.and.returnValue(of({ products: [1], content: [2], security: [3] }) as any);
      component.loadAudit();
      expect(component.productAudit).toEqual([1] as any);
      expect(component.contentAudit).toEqual([2] as any);
      expect(component.securityAudit).toEqual([3] as any);
    });

    it('toasts on error', () => {
      const { component, admin, toast } = createHarness();
      admin.audit.and.returnValue(throwError(() => new Error('e')));
      component.loadAudit();
      expect(toast.error).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // FX overrides
  // ---------------------------------------------------------------------------

  describe('FX overrides', () => {
    it('loadFxStatus populates status and override form, clears loading', () => {
      const { component, fxAdmin } = createHarness();
      fxAdmin.getStatus.and.returnValue(
        of({
          override: { eur_per_ron: '6', usd_per_ron: '5', as_of: '2025-02-02' },
          effective: FX_STATUS.effective,
        }),
      );
      component.loadFxStatus();
      expect(component.fxStatus()).toBeTruthy();
      expect(component.fxOverrideForm.eur_per_ron).toBe(6);
      expect(component.fxOverrideForm.usd_per_ron).toBe(5);
      expect(component.fxOverrideForm.as_of).toBe('2025-02-02');
      expect(component.fxLoading()).toBe(false);
    });

    it('loadFxStatus sets an error message on failure', () => {
      const { component, fxAdmin } = createHarness();
      fxAdmin.getStatus.and.returnValue(throwError(() => new Error('e')));
      component.loadFxStatus();
      expect(component.fxError()).toBe('adminUi.fx.errors.load');
      // complete() only runs on success, so the loading flag remains set on error.
      expect(component.fxLoading()).toBe(true);
    });

    it('loadFxAudit stores audit entries and tolerates non-array payloads', () => {
      const { component, fxAdmin } = createHarness();
      fxAdmin.listOverrideAudit.and.returnValue(of([{ id: 'a1' }]));
      component.loadFxAudit();
      expect(component.fxAudit()).toEqual([{ id: 'a1' }] as any);

      fxAdmin.listOverrideAudit.and.returnValue(of('not-an-array' as any));
      component.loadFxAudit();
      expect(component.fxAudit()).toEqual([]);
    });

    it('loadFxAudit sets error and empties on failure', () => {
      const { component, fxAdmin } = createHarness();
      fxAdmin.listOverrideAudit.and.returnValue(throwError(() => new Error('e')));
      component.loadFxAudit();
      expect(component.fxAudit()).toEqual([]);
      expect(component.fxAuditError()).toBe('adminUi.fx.audit.errors.load');
      // complete() only runs on success, so the loading flag remains set on error.
      expect(component.fxAuditLoading()).toBe(true);
    });

    it('fxAuditActionLabel returns translation when present else raw action', () => {
      const { component } = createHarness();
      // translate stub echoes the key, so the key path returns the raw action.
      expect(component.fxAuditActionLabel('  Set  ')).toBe('  Set  ');
    });

    it('restoreFxOverrideFromAudit ignores entries without id', () => {
      const { component, fxAdmin } = createHarness();
      component.restoreFxOverrideFromAudit({ id: '' } as any);
      expect(fxAdmin.restoreOverrideFromAudit).not.toHaveBeenCalled();
    });

    it('restoreFxOverrideFromAudit aborts when not confirmed', () => {
      const { component, fxAdmin } = createHarness();
      spyOn(window, 'confirm').and.returnValue(false);
      component.restoreFxOverrideFromAudit({ id: 'x1' } as any);
      expect(fxAdmin.restoreOverrideFromAudit).not.toHaveBeenCalled();
    });

    it('restoreFxOverrideFromAudit restores on confirm + success', () => {
      const { component, fxAdmin, toast } = createHarness();
      spyOn(window, 'confirm').and.returnValue(true);
      fxAdmin.restoreOverrideFromAudit.and.returnValue(of(FX_STATUS));
      component.restoreFxOverrideFromAudit({ id: 'x1' } as any);
      expect(fxAdmin.restoreOverrideFromAudit).toHaveBeenCalledWith('x1');
      expect(toast.success).toHaveBeenCalledWith('adminUi.fx.success.overrideRestored');
      expect(component.fxAuditRestoring()).toBeNull();
    });

    it('restoreFxOverrideFromAudit toasts on error', () => {
      const { component, fxAdmin, toast } = createHarness();
      spyOn(window, 'confirm').and.returnValue(true);
      fxAdmin.restoreOverrideFromAudit.and.returnValue(throwError(() => new Error('e')));
      component.restoreFxOverrideFromAudit({ id: 'x1' } as any);
      expect(toast.error).toHaveBeenCalledWith('adminUi.fx.audit.errors.restore');
      // complete() only runs on success, so the restoring marker remains set on error.
      expect(component.fxAuditRestoring()).toBe('x1');
    });

    it('resetFxOverrideForm is a no-op without a status', () => {
      const { component } = createHarness();
      component.fxStatus.set(null);
      component.fxOverrideForm = { eur_per_ron: 9, usd_per_ron: 9, as_of: 'keep' };
      component.resetFxOverrideForm();
      expect(component.fxOverrideForm.as_of).toBe('keep');
    });

    it('resetFxOverrideForm restores values from the current status', () => {
      const { component } = createHarness();
      component.fxStatus.set(FX_STATUS as any);
      component.resetFxOverrideForm();
      expect(component.fxOverrideForm.eur_per_ron).toBe(5);
      expect(component.fxOverrideForm.usd_per_ron).toBe(4);
    });

    it('saveFxOverride rejects non-positive rates', () => {
      const { component, fxAdmin, toast } = createHarness();
      component.fxOverrideForm = { eur_per_ron: 0, usd_per_ron: 1, as_of: '' };
      component.saveFxOverride();
      expect(fxAdmin.setOverride).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('adminUi.fx.errors.invalid');
    });

    it('saveFxOverride sends override and refreshes on success', () => {
      const { component, fxAdmin, toast } = createHarness();
      const reload = spyOn(component, 'loadFxStatus').and.stub();
      fxAdmin.setOverride.and.returnValue(of(FX_STATUS));
      component.fxOverrideForm = { eur_per_ron: 5, usd_per_ron: 4, as_of: ' 2025-01-01 ' };
      component.saveFxOverride();
      expect(fxAdmin.setOverride).toHaveBeenCalledWith({
        eur_per_ron: 5,
        usd_per_ron: 4,
        as_of: '2025-01-01',
      });
      expect(toast.success).toHaveBeenCalledWith('adminUi.fx.success.overrideSet');
      expect(reload).toHaveBeenCalled();
    });

    it('saveFxOverride sends null as_of when blank and toasts on error', () => {
      const { component, fxAdmin, toast } = createHarness();
      fxAdmin.setOverride.and.returnValue(throwError(() => new Error('e')));
      component.fxOverrideForm = { eur_per_ron: 5, usd_per_ron: 4, as_of: '' };
      component.saveFxOverride();
      expect(fxAdmin.setOverride).toHaveBeenCalledWith({
        eur_per_ron: 5,
        usd_per_ron: 4,
        as_of: null,
      });
      expect(toast.error).toHaveBeenCalledWith('adminUi.fx.errors.overrideSet');
    });

    it('clearFxOverride does nothing without an active override', () => {
      const { component, fxAdmin } = createHarness();
      component.fxStatus.set({ override: null, effective: FX_STATUS.effective } as any);
      component.clearFxOverride();
      expect(fxAdmin.clearOverride).not.toHaveBeenCalled();
    });

    it('clearFxOverride aborts when not confirmed', () => {
      const { component, fxAdmin } = createHarness();
      component.fxStatus.set({
        override: FX_STATUS.effective,
        effective: FX_STATUS.effective,
      } as any);
      spyOn(window, 'confirm').and.returnValue(false);
      component.clearFxOverride();
      expect(fxAdmin.clearOverride).not.toHaveBeenCalled();
    });

    it('clearFxOverride clears on confirm + success', () => {
      const { component, fxAdmin, toast } = createHarness();
      component.fxStatus.set({
        override: FX_STATUS.effective,
        effective: FX_STATUS.effective,
      } as any);
      spyOn(window, 'confirm').and.returnValue(true);
      fxAdmin.clearOverride.and.returnValue(of(FX_STATUS));
      const reload = spyOn(component, 'loadFxStatus').and.stub();
      component.clearFxOverride();
      expect(toast.success).toHaveBeenCalledWith('adminUi.fx.success.overrideCleared');
      expect(reload).toHaveBeenCalled();
    });

    it('clearFxOverride toasts on error', () => {
      const { component, fxAdmin, toast } = createHarness();
      component.fxStatus.set({
        override: FX_STATUS.effective,
        effective: FX_STATUS.effective,
      } as any);
      spyOn(window, 'confirm').and.returnValue(true);
      fxAdmin.clearOverride.and.returnValue(throwError(() => new Error('e')));
      component.clearFxOverride();
      expect(toast.error).toHaveBeenCalledWith('adminUi.fx.errors.overrideCleared');
    });
  });

  // ---------------------------------------------------------------------------
  // Owner transfer
  // ---------------------------------------------------------------------------

  describe('submitOwnerTransfer', () => {
    it('does nothing when current user is not the owner', () => {
      const { component, admin, auth } = createHarness();
      auth.role.and.returnValue('staff');
      component.submitOwnerTransfer();
      expect(admin.transferOwner).not.toHaveBeenCalled();
    });

    it('requires an identifier', () => {
      const { component, admin } = createHarness();
      component.ownerTransferIdentifier = '   ';
      component.submitOwnerTransfer();
      expect(component.ownerTransferError).toBe('adminUi.ownerTransfer.errors.identifier');
      expect(admin.transferOwner).not.toHaveBeenCalled();
    });

    it('requires a password from the prompt', () => {
      const { component, admin } = createHarness();
      component.ownerTransferIdentifier = 'user@example.com';
      spyOn(window, 'prompt').and.returnValue('');
      component.submitOwnerTransfer();
      expect(component.ownerTransferError).toBe('adminUi.ownerTransfer.passwordRequired');
      expect(admin.transferOwner).not.toHaveBeenCalled();
    });

    it('transfers ownership on success and reloads audit', () => {
      const { component, admin, toast } = createHarness();
      component.ownerTransferIdentifier = 'user@example.com';
      component.ownerTransferConfirm = 'CONFIRM';
      spyOn(window, 'prompt').and.returnValue('secret');
      admin.transferOwner.and.returnValue(of({}));
      const loadAudit = spyOn(component, 'loadAudit').and.stub();

      component.submitOwnerTransfer();

      expect(admin.transferOwner).toHaveBeenCalledWith({
        identifier: 'user@example.com',
        confirm: 'CONFIRM',
        password: 'secret',
      });
      expect(toast.success).toHaveBeenCalled();
      expect(component.ownerTransferIdentifier).toBe('');
      expect(component.ownerTransferLoading).toBe(false);
      expect(loadAudit).toHaveBeenCalled();
    });

    it('surfaces server detail message on error', () => {
      const { component, admin } = createHarness();
      component.ownerTransferIdentifier = 'user@example.com';
      spyOn(window, 'prompt').and.returnValue('secret');
      admin.transferOwner.and.returnValue(throwError(() => ({ error: { detail: 'nope' } })));
      component.submitOwnerTransfer();
      expect(component.ownerTransferError).toBe('nope');
      expect(component.ownerTransferLoading).toBe(false);
    });

    it('falls back to generic error when no detail provided', () => {
      const { component, admin } = createHarness();
      component.ownerTransferIdentifier = 'user@example.com';
      spyOn(window, 'prompt').and.returnValue('secret');
      admin.transferOwner.and.returnValue(throwError(() => ({})));
      component.submitOwnerTransfer();
      expect(component.ownerTransferError).toBe('adminUi.ownerTransfer.errors.generic');
    });
  });

  // ---------------------------------------------------------------------------
  // Category helpers
  // ---------------------------------------------------------------------------

  describe('category helpers', () => {
    it('categoryParentLabel resolves parent name, none, or missing', () => {
      const { component } = createHarness();
      component.categories = [
        { id: 'p', name: 'Parent', slug: 'parent' } as any,
        { id: 'c', name: 'Child', slug: 'child', parent_id: 'p' } as any,
      ];
      expect(component.categoryParentLabel(component.categories[1])).toBe('Parent');
      expect(component.categoryParentLabel(component.categories[0])).toBe(
        'adminUi.categories.parentNone',
      );
      expect(component.categoryParentLabel({ id: 'x', parent_id: 'missing' } as any)).toBe(
        'adminUi.categories.parentNone',
      );
    });

    it('categoryParentOptions excludes self and descendants, sorted by name', () => {
      const { component } = createHarness();
      component.categories = [
        { id: 'a', name: 'Alpha', slug: 'a' } as any,
        { id: 'b', name: 'Bravo', slug: 'b', parent_id: 'a' } as any,
        { id: 'c', name: 'Charlie', slug: 'c', parent_id: 'b' } as any,
        { id: 'd', name: 'Delta', slug: 'd' } as any,
      ];
      const options = component.categoryParentOptions(component.categories[0]);
      const ids = options.map((o) => o.id);
      expect(ids).toContain('d');
      expect(ids).not.toContain('a');
      expect(ids).not.toContain('b');
      expect(ids).not.toContain('c');
    });

    it('updateCategoryParent skips when parent is unchanged', () => {
      const { component, admin } = createHarness();
      const cat = { id: 'c', slug: 'child', parent_id: null } as any;
      component.updateCategoryParent(cat, '');
      expect(admin.updateCategory).not.toHaveBeenCalled();
    });

    it('updateCategoryParent updates and confirms on success', () => {
      const { component, admin, toast } = createHarness();
      admin.updateCategory.and.returnValue(of({ parent_id: 'p' }));
      const cat = { id: 'c', slug: 'child', parent_id: null } as any;
      component.updateCategoryParent(cat, 'p');
      expect(admin.updateCategory).toHaveBeenCalledWith('child', { parent_id: 'p' });
      expect(cat.parent_id).toBe('p');
      expect(toast.success).toHaveBeenCalledWith('adminUi.categories.success.updateParent');
    });

    it('updateCategoryParent rolls back on error', () => {
      const { component, admin, toast } = createHarness();
      admin.updateCategory.and.returnValue(throwError(() => new Error('e')));
      const cat = { id: 'c', slug: 'child', parent_id: 'old' } as any;
      component.updateCategoryParent(cat, 'p');
      expect(cat.parent_id).toBe('old');
      expect(toast.error).toHaveBeenCalledWith('adminUi.categories.errors.updateParent');
    });

    it('updateCategoryLowStockThreshold rejects invalid numbers', () => {
      const { component, admin, toast } = createHarness();
      const cat = { id: 'c', slug: 'child', low_stock_threshold: 3 } as any;
      component.updateCategoryLowStockThreshold(cat, '-2');
      expect(admin.updateCategory).not.toHaveBeenCalled();
      expect(cat.low_stock_threshold).toBe(3);
      expect(toast.error).toHaveBeenCalledWith('adminUi.categories.errors.updateLowStockThreshold');
    });

    it('updateCategoryLowStockThreshold no-ops when unchanged', () => {
      const { component, admin } = createHarness();
      const cat = { id: 'c', slug: 'child', low_stock_threshold: null } as any;
      component.updateCategoryLowStockThreshold(cat, '');
      expect(admin.updateCategory).not.toHaveBeenCalled();
    });

    it('updateCategoryLowStockThreshold updates on success and rolls back on error', () => {
      const { component, admin, toast } = createHarness();
      admin.updateCategory.and.returnValue(of({ low_stock_threshold: 7 }));
      const cat = { id: 'c', slug: 'child', low_stock_threshold: null } as any;
      component.updateCategoryLowStockThreshold(cat, '7');
      expect(cat.low_stock_threshold).toBe(7);
      expect(toast.success).toHaveBeenCalled();

      admin.updateCategory.and.returnValue(throwError(() => new Error('e')));
      const cat2 = { id: 'd', slug: 'd', low_stock_threshold: 2 } as any;
      component.updateCategoryLowStockThreshold(cat2, '9');
      expect(cat2.low_stock_threshold).toBe(2);
      expect(toast.error).toHaveBeenCalled();
    });

    it('updateCategoryTaxGroup no-ops, succeeds and rolls back', () => {
      const { component, admin, toast } = createHarness();
      const same = { id: 'c', slug: 'child', tax_group_id: null } as any;
      component.updateCategoryTaxGroup(same, '');
      expect(admin.updateCategory).not.toHaveBeenCalled();

      admin.updateCategory.and.returnValue(of({ tax_group_id: 'g1' }));
      const ok = { id: 'c', slug: 'child', tax_group_id: null } as any;
      component.updateCategoryTaxGroup(ok, 'g1');
      expect(ok.tax_group_id).toBe('g1');
      expect(toast.success).toHaveBeenCalledWith('adminUi.taxes.success.categoryAssign');

      admin.updateCategory.and.returnValue(throwError(() => new Error('e')));
      const bad = { id: 'd', slug: 'd', tax_group_id: 'prev' } as any;
      component.updateCategoryTaxGroup(bad, 'g2');
      expect(bad.tax_group_id).toBe('prev');
      expect(toast.error).toHaveBeenCalledWith('adminUi.taxes.errors.categoryAssign');
    });

    it('deleteTaxRate ignores empty country codes', () => {
      const { component, taxesAdmin } = createHarness();
      component.deleteTaxRate({ id: 'g' } as any, '   ');
      expect(taxesAdmin.deleteRate).not.toHaveBeenCalled();
    });

    it('deleteTaxRate deletes and reloads on success', () => {
      const { component, taxesAdmin, toast } = createHarness();
      taxesAdmin.deleteRate.and.returnValue(of({}));
      const reload = spyOn(component, 'loadTaxGroups').and.stub();
      component.deleteTaxRate({ id: 'g' } as any, 'RO');
      expect(taxesAdmin.deleteRate).toHaveBeenCalledWith('g', 'RO');
      expect(toast.success).toHaveBeenCalledWith('adminUi.taxes.success.rateDelete');
      expect(reload).toHaveBeenCalled();
    });

    it('deleteTaxRate toasts server detail on error', () => {
      const { component, taxesAdmin, toast } = createHarness();
      taxesAdmin.deleteRate.and.returnValue(throwError(() => ({ error: { detail: 'bad' } })));
      component.deleteTaxRate({ id: 'g' } as any, 'RO');
      expect(toast.error).toHaveBeenCalledWith('bad');
    });
  });

  // ---------------------------------------------------------------------------
  // Pure helpers
  // ---------------------------------------------------------------------------

  describe('pure helpers', () => {
    it('buildTags merges bestseller flag with product detail tags', () => {
      const { component } = createHarness();
      component.form.is_bestseller = true;
      component.productDetail = { tags: ['new', 'sale'] } as any;
      expect(component.buildTags().sort()).toEqual(['bestseller', 'new', 'sale']);

      component.form.is_bestseller = false;
      component.productDetail = null;
      expect(component.buildTags()).toEqual([]);
    });

    it('upcomingProducts filters future publish dates and sorts ascending', () => {
      const { component } = createHarness();
      const future1 = new Date(Date.now() + 86400000).toISOString();
      const future2 = new Date(Date.now() + 172800000).toISOString();
      const past = new Date(Date.now() - 86400000).toISOString();
      component.products = [
        { id: 'b', publish_at: future2 } as any,
        { id: 'a', publish_at: future1 } as any,
        { id: 'p', publish_at: past } as any,
        { id: 'n', publish_at: null } as any,
      ];
      expect(component.upcomingProducts().map((p) => p.id)).toEqual(['a', 'b']);
    });

    it('toLocalDateTime returns a 16-char local datetime string', () => {
      const { component } = createHarness();
      const result = component.toLocalDateTime('2025-03-04T10:20:00.000Z');
      expect(result.length).toBe(16);
      expect(result).toContain('2025-03-0');
    });

    it('isOwner reflects the auth role', () => {
      const { component, auth } = createHarness();
      expect(component.isOwner()).toBe(true);
      auth.role.and.returnValue('staff');
      expect(component.isOwner()).toBe(false);
    });

    it('cmsAdvanced reflects the editor prefs mode', () => {
      const { component, cms } = createHarness();
      expect(component.cmsAdvanced()).toBe(false);
      cms.mode = 'advanced';
      expect(component.cmsAdvanced()).toBe(true);
    });

    it('cmsPreviewMaxWidthClass maps preview devices to width classes', () => {
      const { component, cms } = createHarness();
      cms.previewDevice = 'mobile';
      expect(component.cmsPreviewMaxWidthClass()).toBe('max-w-[390px]');
      cms.previewDevice = 'tablet';
      expect(component.cmsPreviewMaxWidthClass()).toBe('max-w-[768px]');
      cms.previewDevice = 'desktop';
      expect(component.cmsPreviewMaxWidthClass()).toBe('max-w-[1024px]');
    });

    it('cmsPreviewViewportWidth maps preview devices to numeric widths', () => {
      const { component, cms } = createHarness();
      cms.previewDevice = 'mobile';
      expect(component.cmsPreviewViewportWidth()).toBe(390);
      cms.previewDevice = 'tablet';
      expect(component.cmsPreviewViewportWidth()).toBe(768);
      cms.previewDevice = 'desktop';
      expect(component.cmsPreviewViewportWidth()).toBe(1024);
    });
  });

  describe('syncSplitScroll', () => {
    function el(scrollHeight: number, clientHeight: number, scrollTop = 0): HTMLElement {
      const node = { scrollHeight, clientHeight, scrollTop } as unknown as HTMLElement;
      return node;
    }

    it('does nothing outside split layout', () => {
      const { component, cms } = createHarness();
      cms.previewLayout = 'stacked';
      const target = el(1000, 100, 0);
      component.syncSplitScroll(el(1000, 100, 50), target);
      expect(target.scrollTop).toBe(0);
    });

    it('does nothing when content is not scrollable', () => {
      const { component } = createHarness();
      const target = el(100, 100, 0);
      component.syncSplitScroll(el(100, 100, 0), target);
      expect(target.scrollTop).toBe(0);
    });

    it('mirrors scroll ratio from source to target in split layout', () => {
      const { component } = createHarness();
      spyOn(window, 'requestAnimationFrame').and.callFake((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });
      const target = el(2000, 1000); // scrollable range 1000
      component.syncSplitScroll(el(1100, 100, 50), target); // ratio 50/1000 = 0.05
      expect(target.scrollTop).toBeCloseTo(50, 5);
    });
  });

  describe('unsaved changes', () => {
    it('hasUnsavedChanges is false when no draft is dirty', () => {
      const { component } = createHarness();
      expect(component.hasUnsavedChanges()).toBe(false);
    });

    it('discardUnsavedChanges runs without active drafts', () => {
      const { component } = createHarness();
      expect(() => component.discardUnsavedChanges()).not.toThrow();
    });
  });
});
