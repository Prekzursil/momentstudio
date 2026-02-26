import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';

import { AdminComponent } from './admin.component';

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
    queryParams: new Subject<Record<string, unknown>>(),
  };
}

function createAdminHarness(): {
  component: AdminComponent;
  admin: jasmine.SpyObj<any>;
} {
  const admin = jasmine.createSpyObj('AdminService', [
    'content',
    'uploadProductImage',
    'deleteProductImage',
    'updateOrderStatus',
    'revokeSessions',
    'userAliases',
    'reorderCategories',
    'updateUserRole',
  ]);

  const routeStub = createRouteStub('orders');
  const component = new AdminComponent(
    {
      snapshot: routeStub.snapshot,
      data: routeStub.data.asObservable(),
      queryParams: routeStub.queryParams.asObservable(),
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

describe('AdminComponent utility methods', () => {
  it('builds tags and computes upcoming products', () => {
    const { component } = createAdminHarness();
    const future = new Date(Date.now() + 3600_000).toISOString();
    const fartherFuture = new Date(Date.now() + 7200_000).toISOString();

    component.form = { is_bestseller: true } as any;
    component.productDetail = { tags: ['featured', 'sale'] } as any;
    component.products = [
      { id: 'p1', publish_at: fartherFuture },
      { id: 'p2', publish_at: future },
      { id: 'p3', publish_at: null },
    ] as any[];

    expect(component.buildTags().sort()).toEqual(['bestseller', 'featured', 'sale']);
    expect(component.upcomingProducts().map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it('formats local datetime from ISO', () => {
    const { component } = createAdminHarness();
    expect(component.toLocalDateTime('2026-02-27T10:30:00.000Z').length).toBe(16);
  });
});

describe('AdminComponent product/order selection methods', () => {
  it('toggles product selections and computes all-selected state', () => {
    const { component } = createAdminHarness();
    component.products = [{ id: 'p1' }, { id: 'p2' }] as any[];
    component.selectedIds = new Set<string>();

    component.toggleAll({ target: { checked: true } } as any);
    expect(component.allSelected).toBeTrue();
    expect(Array.from(component.selectedIds).sort()).toEqual(['p1', 'p2']);

    component.toggleSelect('p2', { target: { checked: false } } as any);
    expect(component.allSelected).toBeFalse();
    expect(component.selectedIds.has('p2')).toBeFalse();
  });

  it('filters orders and updates active order status', () => {
    const { component, admin } = createAdminHarness();
    const toast = component['toast'] as jasmine.SpyObj<any>;
    component.orders = [
      { id: 'o1', status: 'pending' },
      { id: 'o2', status: 'paid' },
    ] as any[];
    component.orderFilter = 'paid';
    expect(component.filteredOrders().map((o) => o.id)).toEqual(['o2']);

    component.selectOrder({ id: 'o1', status: 'pending' } as any);
    admin.updateOrderStatus.and.returnValue(of({ id: 'o1', status: 'paid' }));
    component.changeOrderStatus('paid');

    expect(admin.updateOrderStatus).toHaveBeenCalledWith('o1', 'paid');
    expect(component.activeOrder?.status).toBe('paid');
    expect(toast.success).toHaveBeenCalled();
  });
});

describe('AdminComponent user/admin methods', () => {
  it('loads aliases and handles alias failures', () => {
    const { component, admin } = createAdminHarness();
    admin.userAliases.and.returnValue(of({ aliases: [] }));
    component.loadUserAliases('u1');
    expect(component.userAliases).toEqual({ aliases: [] } as any);
    expect(component.userAliasesError).toBeNull();

    admin.userAliases.and.returnValue(throwError(() => new Error('fail')));
    component.loadUserAliases('u1');
    expect(component.userAliasesError).toContain('Could not load alias history.');
  });

  it('updates selected user and force-logout path', () => {
    const { component, admin } = createAdminHarness();
    const toast = component['toast'] as jasmine.SpyObj<any>;
    spyOn(component, 'loadUserAliases').and.stub();
    component.users = [{ id: 'u1', role: 'admin' }] as any[];

    component.selectUser('u1', 'admin');
    expect(component.selectedUserId).toBe('u1');
    expect(component.loadUserAliases).toHaveBeenCalledWith('u1');

    component.onSelectedUserIdChange('u1');
    expect(component.selectedUserRole).toBe('admin');

    admin.revokeSessions.and.returnValue(of({}));
    component.forceLogout();
    expect(admin.revokeSessions).toHaveBeenCalledWith('u1');
    expect(toast.success).toHaveBeenCalled();
  });

  it('requires role password and supports successful role update', () => {
    const { component, admin } = createAdminHarness();
    const toast = component['toast'] as jasmine.SpyObj<any>;
    component.users = [{ id: 'u1', role: 'viewer' }] as any[];
    component.selectedUserId = 'u1';
    component.selectedUserRole = 'admin';

    spyOn(window, 'prompt').and.returnValue('   ');
    component.updateRole();
    expect(toast.error).toHaveBeenCalled();

    (window.prompt as jasmine.Spy).and.returnValue('secret');
    admin.updateUserRole.and.returnValue(of({ id: 'u1', role: 'admin' }));
    component.updateRole();
    expect(admin.updateUserRole).toHaveBeenCalledWith('u1', 'admin', 'secret');
    expect(toast.success).toHaveBeenCalled();
  });
});

describe('AdminComponent category reorder methods', () => {
  it('moves categories by delta and persists reordered list', () => {
    const { component, admin } = createAdminHarness();
    const toast = component['toast'] as jasmine.SpyObj<any>;
    component.categories = [
      { slug: 'a', sort_order: 0 },
      { slug: 'b', sort_order: 1 },
    ] as any[];
    admin.reorderCategories.and.returnValue(of([{ slug: 'b', sort_order: 0 }, { slug: 'a', sort_order: 1 }]));

    component.moveCategory(component.categories[0] as any, 1);
    expect(admin.reorderCategories).toHaveBeenCalled();
    expect(component.categories[0].slug).toBe('b');
    expect(toast.success).toHaveBeenCalled();
  });

  it('supports drag-drop reorder and ignores invalid drops', () => {
    const { component, admin } = createAdminHarness();
    component.categories = [
      { slug: 'a', sort_order: 0 },
      { slug: 'b', sort_order: 1 },
      { slug: 'c', sort_order: 2 },
    ] as any[];
    admin.reorderCategories.and.returnValue(of(component.categories));

    component.onCategoryDragStart('a');
    component.onCategoryDrop('a');
    expect(component.draggingSlug).toBeNull();

    component.onCategoryDragStart('a');
    component.onCategoryDrop('c');
    expect(admin.reorderCategories).toHaveBeenCalled();
    expect(component.draggingSlug).toBeNull();
  });
});
