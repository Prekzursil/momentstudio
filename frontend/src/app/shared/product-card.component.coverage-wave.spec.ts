import { of, throwError } from 'rxjs';

import { ProductCardComponent } from './product-card.component';

function createHarness() {
  const translate = {
    instant: jasmine.createSpy('instant').and.callFake((key: string) => key)
  };

  const wishlist = jasmine.createSpyObj('WishlistService', [
    'ensureLoaded',
    'isWishlisted',
    'remove',
    'removeLocal',
    'add',
    'addLocal'
  ]);
  wishlist.isWishlisted.and.returnValue(false);
  wishlist.remove.and.returnValue(of({}));
  wishlist.add.and.returnValue(of({ id: 'p-1', name: 'Product A' }));

  const auth = jasmine.createSpyObj('AuthService', [
    'isAuthenticated',
    'isAdmin',
    'isImpersonating'
  ]);
  auth.isAuthenticated.and.returnValue(true);
  auth.isAdmin.and.returnValue(true);
  auth.isImpersonating.and.returnValue(false);

  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info', 'action']);
  const router = jasmine.createSpyObj('Router', ['navigate', 'navigateByUrl']);
  router.navigate.and.returnValue(Promise.resolve(true));
  router.navigateByUrl.and.returnValue(Promise.resolve(true));

  const storefrontAdminMode = {
    enabled: jasmine.createSpy('enabled').and.returnValue(true),
    setEnabled: jasmine.createSpy('setEnabled')
  };

  const admin = jasmine.createSpyObj('AdminService', ['updateProduct', 'bulkUpdateProducts']);
  admin.updateProduct.and.returnValue(of({ status: 'archived' }));
  admin.bulkUpdateProducts.and.returnValue(of({}));

  const cart = jasmine.createSpyObj('CartStore', ['addFromProduct']);

  const component = new ProductCardComponent(
    translate as any,
    wishlist as any,
    auth as any,
    toast as any,
    router as any,
    storefrontAdminMode as any,
    admin as any,
    cart as any
  );

  component.product = {
    id: 'p-1',
    slug: 'product-a',
    name: 'Product A',
    base_price: 120,
    sale_price: 99,
    currency: 'RON',
    stock_quantity: 3,
    images: [
      { id: 'img-2', url: '/images/two.jpg', sort_order: 2 },
      { id: 'img-1', url: '/images/one.jpg', sort_order: 1 }
    ],
    variants: [{ id: 'v-1', stock_quantity: 2 }],
    badges: [{ badge: 'new' }],
    tags: [{ name: 'tag-a' }]
  } as any;

  return { component, translate, wishlist, auth, toast, router, storefrontAdminMode, admin, cart };
}

function mouseEventStub(overrides: Partial<MouseEvent> = {}): MouseEvent {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: jasmine.createSpy('preventDefault'),
    stopPropagation: jasmine.createSpy('stopPropagation'),
    ...overrides
  } as unknown as MouseEvent;
}

describe('ProductCardComponent coverage wave', () => {
  it('covers computed price/image/badge/stock getters and change sync', () => {
    const { component } = createHarness();

    component.ngOnChanges({ product: { currentValue: component.product } as any });
    expect(component.inlinePrice).toBe('120.00');
    expect(component.inlineStock).toBe('3');

    expect(component.isOnSale).toBeTrue();
    expect(component.displayPrice).toBe(99);
    expect(component.primaryImage).toBe('/images/one.jpg');
    expect(component.badge).toBe('shop.sale');
    expect(component.stockBadge).toBe('product.lowStock');

    component.tag = 'Manual tag';
    expect(component.badge).toBe('Manual tag');

    component.product.sale_price = null as any;
    component.product.stock_quantity = 0;
    component.product.badges = [{ id: 'badge-1', badge: 'new' }];
    component.tag = null;
    expect(component.badge).toBe('product.badges.new');

    component.product.badges = [];
    component.tag = null;
    expect(component.stockBadge).toBe('product.soldOut');
  });

  it('covers wishlist add/remove plus unauthenticated redirect branch', () => {
    const { component, auth, wishlist, toast, router } = createHarness();
    const event = mouseEventStub();

    auth.isAuthenticated.and.returnValue(false);
    component.toggleWishlist(event);
    expect(toast.info).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');

    auth.isAuthenticated.and.returnValue(true);
    wishlist.isWishlisted.and.returnValue(true);
    component.toggleWishlist(event);
    expect(wishlist.remove).toHaveBeenCalledWith('p-1');
    expect(wishlist.removeLocal).toHaveBeenCalledWith('p-1');

    wishlist.isWishlisted.and.returnValue(false);
    component.toggleWishlist(event);
    expect(wishlist.add).toHaveBeenCalledWith('p-1');
    expect(wishlist.addLocal).toHaveBeenCalled();
  });

  it('covers storefront edit visibility, edit navigation, and status changes', () => {
    const { component, auth, storefrontAdminMode, router, admin, toast } = createHarness();
    const event = mouseEventStub();
    const select = { value: 'archived' } as HTMLSelectElement;

    storefrontAdminMode.enabled.and.returnValue(false);
    expect(component.showStorefrontEdit()).toBeFalse();

    storefrontAdminMode.enabled.and.returnValue(true);
    auth.isAdmin.and.returnValue(false);
    expect(component.showStorefrontEdit()).toBeFalse();

    auth.isAdmin.and.returnValue(true);
    auth.isImpersonating.and.returnValue(false);
    expect(component.showStorefrontEdit()).toBeTrue();

    component.openAdminEdit(event);
    expect(router.navigate).toHaveBeenCalledWith(['/admin/products'], { state: { editProductSlug: 'product-a' } });

    component.onStatusChange({ ...event, target: select } as unknown as Event);
    expect(admin.updateProduct).toHaveBeenCalledWith('product-a', { status: 'archived' }, { source: 'storefront' });
    expect(toast.action).toHaveBeenCalled();

    admin.updateProduct.and.returnValue(throwError(() => new Error('save failed')));
    select.value = 'draft';
    component.product.status = 'archived';
    component.onStatusChange({ ...event, target: select } as unknown as Event);
    expect(toast.error).toHaveBeenCalled();
  });

  it('covers inline save validations, success branch, and undo callback', () => {
    const { component, admin, toast } = createHarness();

    component.inlinePrice = '';
    component.inlineStock = '2';
    component.saveInline();
    expect(component.inlineError).toBe('adminUi.products.inline.errors.priceRequired');

    component.inlinePrice = '10';
    component.inlineStock = '-1';
    component.saveInline();
    expect(component.inlineError).toBe('adminUi.products.inline.errors.stockInvalid');

    component.inlinePrice = '123.5';
    component.inlineStock = '9';
    component.saveInline();
    expect(admin.bulkUpdateProducts).toHaveBeenCalled();
    expect(toast.action).toHaveBeenCalled();

    const undo = toast.action.calls.mostRecent().args[2] as () => void;
    undo();
    expect(admin.bulkUpdateProducts.calls.count()).toBeGreaterThan(1);

    admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('undo fail')));
    component.inlinePrice = '125';
    component.inlineStock = '8';
    component.saveInline();
    expect(toast.error).toHaveBeenCalled();
  });

  it('covers cart/quick-view/pin/details and remember-return behavior', () => {
    const { component, cart, router } = createHarness();
    const event = mouseEventStub();

    component.showPin = true;
    component.showAddToCart = true;
    component.quickViewOnCardClick = true;
    component.rememberShopReturn = true;

    spyOn(component.pinToTop, 'emit');
    spyOn(component.quickView, 'emit');

    component.onPrimaryClick(event);
    expect(component.quickView.emit).toHaveBeenCalledWith('product-a');

    component.quickViewOnCardClick = false;
    component.goToDetails();
    expect(router.navigate).toHaveBeenCalledWith(['/products', 'product-a']);

    component.requestPinToTop();
    expect(component.pinToTop.emit).toHaveBeenCalledWith('p-1');

    component.addToCart();
    expect(cart.addFromProduct).toHaveBeenCalled();

    component.product.stock_quantity = 0;
    component.product.variants = [{ id: 'v-1', stock_quantity: 0 }] as any;
    component.product.allow_backorder = false;
    expect(component.isOutOfStock()).toBeTrue();
  });
});
