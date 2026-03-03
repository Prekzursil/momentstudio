import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';

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
    queryParams: new Subject<Record<string, unknown>>(),
  };
}

function createAdminHarness(): AdminComponent {
  const routeStub = createRouteStub('home');
  return new AdminComponent(
    {
      snapshot: routeStub.snapshot,
      data: routeStub.data.asObservable(),
      queryParams: routeStub.queryParams.asObservable(),
    } as unknown as ActivatedRoute,
    {
      products: () => ({ subscribe: ({ next }: any) => next([]) }),
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { role: () => 'owner' } as any,
    {
      mode: () => 'advanced',
      previewDevice: () => 'desktop',
      previewLayout: () => 'split',
    } as any,
    jasmine.createSpyObj('ToastService', ['success', 'error']) as any,
    { instant: (k: string) => k } as any,
    { render: (value: string) => value } as any,
    { bypassSecurityTrustHtml: (value: string) => value } as unknown as DomSanitizer
  );
}

function immediateResult<T>(value: T, emitError = false) {
  return {
    subscribe: (observer: any) => {
      if (emitError) {
        observer?.error?.({ error: { detail: 'boom' } });
      } else {
        observer?.next?.(value);
      }
      observer?.complete?.();
    },
  };
}

describe('AdminComponent fast coverage helpers', () => {
  it('normalizes valid and invalid content sections', () => {
    const component = createAdminHarness() as any;

    expect(component.normalizeSection('home')).toBe('home');
    expect(component.normalizeSection('pages')).toBe('pages');
    expect(component.normalizeSection('blog')).toBe('blog');
    expect(component.normalizeSection('settings')).toBe('settings');
    expect(component.normalizeSection('unknown')).toBe('home');
    expect(component.normalizeSection(null)).toBe('home');
  });

  it('applies same-section reload path without resetting section state', () => {
    const component = createAdminHarness() as any;
    component.section.set('home');
    spyOn(component, 'loadForSection').and.stub();
    spyOn(component, 'syncCmsDraftPoller').and.stub();
    spyOn(component, 'resetSectionState').and.stub();

    component.applySection('home');

    expect(component.loadForSection).toHaveBeenCalledWith('home');
    expect(component.syncCmsDraftPoller).toHaveBeenCalledWith('home');
    expect(component.resetSectionState).not.toHaveBeenCalled();
  });

  it('applies section switch path and updates breadcrumbs', () => {
    const component = createAdminHarness() as any;
    component.section.set('home');
    spyOn(component, 'loadForSection').and.stub();
    spyOn(component, 'syncCmsDraftPoller').and.stub();
    spyOn(component, 'resetSectionState').and.stub();

    component.applySection('blog');

    expect(component.section()).toBe('blog');
    expect(component.crumbs[1].label).toBe('adminUi.content.nav.blog');
    expect(component.resetSectionState).toHaveBeenCalledWith('blog');
    expect(component.loadForSection).toHaveBeenCalledWith('blog');
    expect(component.syncCmsDraftPoller).toHaveBeenCalledWith('blog');
  });
});

describe('AdminComponent fast query and poller helpers', () => {
  it('applies content edit query for blog and pages with key normalization', () => {
    const component = createAdminHarness() as any;
    spyOn(component, 'loadBlogEditor').and.stub();
    spyOn(component, 'onPageBlocksKeyChange').and.stub();

    component.applyContentEditQuery('blog', { edit: 'hello-world' });
    expect(component.loadBlogEditor).toHaveBeenCalledWith('blog.hello-world');

    component.applyContentEditQuery('pages', { edit: 'faq' });
    expect(component.onPageBlocksKeyChange).toHaveBeenCalledWith('page.faq');

    component.onPageBlocksKeyChange.calls.reset();
    component.applyContentEditQuery('pages', { edit: 'page.' });
    expect(component.onPageBlocksKeyChange).not.toHaveBeenCalled();
  });

  it('skips content edit query work for empty payloads and duplicate keys', () => {
    const component = createAdminHarness() as any;
    component.selectedBlogKey = 'blog.same';
    component.pageBlocksKey = 'page.about';
    spyOn(component, 'loadBlogEditor').and.stub();
    spyOn(component, 'onPageBlocksKeyChange').and.stub();

    component.applyContentEditQuery('blog', { edit: 'same' });
    component.applyContentEditQuery('pages', { edit: 'about' });
    component.applyContentEditQuery('pages', { edit: '   ' });
    component.applyContentEditQuery('pages', { edit: 42 as any });

    expect(component.loadBlogEditor).not.toHaveBeenCalled();
    expect(component.onPageBlocksKeyChange).not.toHaveBeenCalled();
  });

  it('accepts global cms keys directly for page edit routing', () => {
    const component = createAdminHarness() as any;
    spyOn(component, 'onPageBlocksKeyChange').and.stub();

    component.applyContentEditQuery('pages', { edit: 'home.hero' });

    expect(component.onPageBlocksKeyChange).toHaveBeenCalledWith('page.home.hero');
  });
});

describe('AdminComponent fast poller and reset helpers', () => {
  it('starts and stops CMS draft poller based on section', () => {
    const component = createAdminHarness() as any;
    component.cmsDraftPoller = null;
    spyOn(component, 'observeCmsDrafts').and.stub();
    const setIntervalSpy = spyOn(window, 'setInterval').and.returnValue(123 as any);
    const clearIntervalSpy = spyOn(window, 'clearInterval').and.stub();

    component.syncCmsDraftPoller('home');
    expect(component.observeCmsDrafts).toHaveBeenCalled();
    expect(setIntervalSpy).toHaveBeenCalled();
    expect(component.cmsDraftPoller).toBe(123);

    component.syncCmsDraftPoller('settings');
    expect(clearIntervalSpy).toHaveBeenCalledWith(123);
    expect(component.cmsDraftPoller).toBeNull();
  });

  it('resets section state according to destination section', () => {
    const component = createAdminHarness() as any;
    component.selectedContent = { key: 'page.about' };
    component.showContentPreview = true;
    component.showBlogCreate = true;
    component.flaggedComments.set([{ id: 'x' }]);
    component.flaggedCommentsError = 'bad';
    spyOn(component, 'closeBlogEditor').and.stub();

    component.resetSectionState('settings');
    expect(component.closeBlogEditor).toHaveBeenCalled();
    expect(component.showBlogCreate).toBeFalse();
    expect(component.flaggedComments().length).toBe(0);
    expect(component.selectedContent).toEqual({ key: 'page.about' });

    component.resetSectionState('home');
    expect(component.selectedContent).toBeNull();
    expect(component.showContentPreview).toBeFalse();
  });

  it('does not create a second poller when one already exists', () => {
    const component = createAdminHarness() as any;
    component.cmsDraftPoller = 999;
    spyOn(component, 'observeCmsDrafts').and.stub();
    const setIntervalSpy = spyOn(window, 'setInterval').and.callThrough();

    component.syncCmsDraftPoller('home');

    expect(component.observeCmsDrafts).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(component.cmsDraftPoller).toBe(999);
  });

  it('loads section-specific resources for pages and blog branches', () => {
    const component = createAdminHarness() as any;
    component.loading.set(true);
    spyOn(component, 'loadInfo').and.stub();
    spyOn(component, 'loadLegalPage').and.stub();
    spyOn(component, 'loadCategories').and.stub();
    spyOn(component, 'loadCollections').and.stub();
    spyOn(component, 'loadContentPages').and.stub();
    spyOn(component, 'loadReusableBlocks').and.stub();
    spyOn(component, 'loadPageBlocks').and.stub();
    spyOn(component, 'loadContentRedirects').and.stub();
    spyOn(component, 'reloadContentBlocks').and.stub();
    spyOn(component, 'loadFlaggedComments').and.stub();

    component.loadForSection('pages');
    expect(component.loadInfo).toHaveBeenCalled();
    expect(component.loadLegalPage).toHaveBeenCalledWith(component.legalPageKey);
    expect(component.loadPageBlocks).toHaveBeenCalledWith(component.pageBlocksKey);
    expect(component.loadContentRedirects).toHaveBeenCalledWith(true);
    expect(component.loading()).toBeFalse();

    component.loadForSection('blog');
    expect(component.reloadContentBlocks).toHaveBeenCalled();
    expect(component.loadFlaggedComments).toHaveBeenCalled();
  });

  it('loads settings branch resources and handles admin streams', () => {
    const component = createAdminHarness() as any;
    component.admin = {
      coupons: () => immediateResult([{ code: 'A' }]),
      lowStock: () => immediateResult([{ sku: 'P1' }]),
      audit: () =>
        immediateResult({
          products: [{ id: 'p' }],
          content: [{ id: 'c' }],
          security: [{ id: 's' }],
        }),
      getMaintenance: () => immediateResult({ enabled: true }),
    };
    spyOn(component, 'reloadContentBlocks').and.stub();
    spyOn(component, 'loadCategories').and.stub();
    spyOn(component, 'loadTaxGroups').and.stub();
    spyOn(component, 'loadAssets').and.stub();
    spyOn(component, 'loadSocial').and.stub();
    spyOn(component, 'loadCompany').and.stub();
    spyOn(component, 'loadNavigation').and.stub();
    spyOn(component, 'loadCheckoutSettings').and.stub();
    spyOn(component, 'loadReportsSettings').and.stub();
    spyOn(component, 'loadSeo').and.stub();
    spyOn(component, 'loadFxStatus').and.stub();

    component.loadForSection('settings');

    expect(component.reloadContentBlocks).toHaveBeenCalled();
    expect(component.coupons.length).toBe(1);
    expect(component.lowStock.length).toBe(1);
    expect(component.productAudit.length).toBe(1);
    expect(component.contentAudit.length).toBe(1);
    expect(component.securityAudit.length).toBe(1);
    expect(component.maintenanceEnabled()).toBeTrue();
    expect(component.maintenanceEnabledValue).toBeTrue();
    expect(component.loading()).toBeFalse();
  });
});
