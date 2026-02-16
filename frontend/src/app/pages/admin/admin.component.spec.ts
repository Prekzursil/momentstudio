import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Subject, of } from 'rxjs';

import { AdminComponent } from './admin.component';

describe('AdminComponent content first-paint init', () => {
  type RouteStub = {
    snapshot: { data: Record<string, unknown>; queryParams: Record<string, unknown> };
    data: Subject<Record<string, unknown>>;
    queryParams: Subject<Record<string, unknown>>;
  };

  function createRouteStub(
    section: string,
    query: Record<string, unknown> = {}
  ): RouteStub {
    return {
      snapshot: { data: { section }, queryParams: query },
      data: new Subject<Record<string, unknown>>(),
      queryParams: new Subject<Record<string, unknown>>()
    };
  }

  function createComponent(routeStub: RouteStub): { component: AdminComponent; admin: jasmine.SpyObj<any> } {
    const admin = jasmine.createSpyObj('AdminService', ['content']);
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
      {} as any,
      {} as any,
      jasmine.createSpyObj('ToastService', ['success', 'error']) as any,
      { instant: (k: string) => k } as any,
      { render: (value: string) => value } as any,
      { bypassSecurityTrustHtml: (value: string) => value } as unknown as DomSanitizer
    );

    return { component, admin };
  }

  it('applies route snapshot section/edit query before reactive streams emit', () => {
    const routeStub = createRouteStub('blog', { edit: 'welcome-post' });
    const { component } = createComponent(routeStub);

    const applySection = spyOn<any>(component, 'applySection').and.stub();
    const applyQuery = spyOn<any>(component, 'applyContentEditQuery').and.stub();
    const normalizeSection = spyOn<any>(component, 'normalizeSection').and.callThrough();

    component.ngOnInit();

    expect(normalizeSection).toHaveBeenCalledWith('blog');
    expect(applySection.calls.count()).toBe(1);
    expect(applySection).toHaveBeenCalledWith('blog');
    expect(applyQuery.calls.count()).toBe(1);
    expect(applyQuery).toHaveBeenCalledWith('blog', { edit: 'welcome-post' });

    routeStub.data.next({ section: 'pages' });
    routeStub.queryParams.next({ edit: 'about' });

    expect(applySection.calls.count()).toBe(2);
    expect(applySection.calls.mostRecent().args[0]).toBe('pages');
    expect(applyQuery.calls.count()).toBe(2);
    expect(applyQuery.calls.mostRecent().args).toEqual(['pages', { edit: 'about' }]);

    component.ngOnDestroy();
  });

  it('clones fetched content block arrays to avoid stale template references', () => {
    const routeStub = createRouteStub('home');
    const { component, admin } = createComponent(routeStub);
    const sourceBlocks = [{ key: 'home.hero', title: 'Hero' }] as any[];
    admin.content.and.returnValue(of(sourceBlocks));

    (component as any).reloadContentBlocks();

    expect(component.contentBlocks).toEqual(sourceBlocks as any);
    expect(component.contentBlocks).not.toBe(sourceBlocks as any);
  });
});
