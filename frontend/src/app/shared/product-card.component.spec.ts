import { SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { Product } from '../core/catalog.service';
import { AdminService } from '../core/admin.service';
import { AuthService } from '../core/auth.service';
import { CartStore } from '../core/cart.store';
import { StorefrontAdminModeService } from '../core/storefront-admin-mode.service';
import { ToastService } from '../core/toast.service';
import { WishlistService } from '../core/wishlist.service';
import { ProductCardComponent } from './product-card.component';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    slug: 'prod-1',
    name: 'Product 1',
    currency: 'RON',
    base_price: 100,
    sale_price: null,
    stock_quantity: 5,
    images: [],
    tags: [],
    ...overrides,
  } as Product;
}

function changeEvent(target: EventTarget): Event {
  return {
    preventDefault: jasmine.createSpy('preventDefault'),
    stopPropagation: jasmine.createSpy('stopPropagation'),
    target,
  } as unknown as Event;
}

function mouseEvent(overrides: Partial<MouseEvent> = {}): MouseEvent {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: jasmine.createSpy('preventDefault'),
    stopPropagation: jasmine.createSpy('stopPropagation'),
    ...overrides,
  } as unknown as MouseEvent;
}

describe('ProductCardComponent', () => {
  let translate: jasmine.SpyObj<TranslateService>;
  let wishlist: jasmine.SpyObj<WishlistService>;
  let auth: jasmine.SpyObj<AuthService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: jasmine.SpyObj<Router>;
  let storefront: jasmine.SpyObj<StorefrontAdminModeService>;
  let admin: jasmine.SpyObj<AdminService>;
  let cart: jasmine.SpyObj<CartStore>;

  function create(product: Product | undefined = makeProduct()): ProductCardComponent {
    translate = jasmine.createSpyObj<TranslateService>('TranslateService', ['instant']);
    translate.instant.and.callFake((key: string) => key as never);
    wishlist = jasmine.createSpyObj<WishlistService>('WishlistService', [
      'ensureLoaded',
      'isWishlisted',
      'remove',
      'removeLocal',
      'add',
      'addLocal',
    ]);
    wishlist.isWishlisted.and.returnValue(false);
    wishlist.remove.and.returnValue(of(undefined));
    wishlist.add.and.returnValue(of(makeProduct()));
    auth = jasmine.createSpyObj<AuthService>('AuthService', [
      'isAuthenticated',
      'isAdmin',
      'isImpersonating',
    ]);
    auth.isAuthenticated.and.returnValue(true);
    auth.isAdmin.and.returnValue(true);
    auth.isImpersonating.and.returnValue(false);
    toast = jasmine.createSpyObj<ToastService>('ToastService', [
      'info',
      'success',
      'error',
      'action',
    ]);
    router = jasmine.createSpyObj<Router>('Router', ['navigate', 'navigateByUrl']);
    router.navigate.and.resolveTo(true);
    router.navigateByUrl.and.resolveTo(true);
    storefront = jasmine.createSpyObj<StorefrontAdminModeService>('StorefrontAdminModeService', [
      'enabled',
    ]);
    storefront.enabled.and.returnValue(false);
    admin = jasmine.createSpyObj<AdminService>('AdminService', [
      'updateProduct',
      'bulkUpdateProducts',
    ]);
    admin.updateProduct.and.returnValue(of(makeProduct()) as never);
    admin.bulkUpdateProducts.and.returnValue(of([]) as never);
    cart = jasmine.createSpyObj<CartStore>('CartStore', ['addFromProduct']);

    TestBed.configureTestingModule({
      imports: [ProductCardComponent, TranslateModule.forRoot()],
      providers: [
        { provide: TranslateService, useValue: translate },
        { provide: WishlistService, useValue: wishlist },
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
        { provide: ActivatedRoute, useValue: { snapshot: { params: {}, queryParams: {} } } },
        { provide: Router, useValue: router },
        { provide: StorefrontAdminModeService, useValue: storefront },
        { provide: AdminService, useValue: admin },
        { provide: CartStore, useValue: cart },
      ],
    });

    const fixture = TestBed.createComponent(ProductCardComponent);
    const component = fixture.componentInstance;
    component.product = product as Product;
    return component;
  }

  it('creates and loads the wishlist on construction', () => {
    const component = create();
    expect(component).toBeTruthy();
    expect(wishlist.ensureLoaded).toHaveBeenCalled();
  });

  describe('ngOnChanges', () => {
    it('ignores changes that do not include the product input', () => {
      const component = create();
      component.inlinePrice = 'keep';
      component.ngOnChanges({});
      expect(component.inlinePrice).toBe('keep');
    });

    it('ignores a product change with no id', () => {
      const component = create(makeProduct({ id: '' }));
      component.inlinePrice = 'keep';
      component.ngOnChanges({ product: new SimpleChange(null, component.product, true) });
      expect(component.inlinePrice).toBe('keep');
    });

    it('seeds inline fields from a finite base price and stock', () => {
      const component = create(makeProduct({ base_price: 42.5, stock_quantity: 7 }));
      component.ngOnChanges({ product: new SimpleChange(null, component.product, true) });
      expect(component.inlinePrice).toBe('42.50');
      expect(component.inlineStock).toBe('7');
    });

    it('falls back to zero for a non-finite price and stock', () => {
      const component = create(
        makeProduct({ base_price: Number.NaN as never, stock_quantity: Number.NaN as never }),
      );
      component.ngOnChanges({ product: new SimpleChange(null, component.product, true) });
      expect(component.inlinePrice).toBe('0.00');
      expect(component.inlineStock).toBe('0');
    });

    it('does not reseed when the same product id changes again', () => {
      const component = create(makeProduct({ id: 'same', base_price: 10 }));
      component.ngOnChanges({ product: new SimpleChange(null, component.product, true) });
      component.inlinePrice = 'edited';
      component.ngOnChanges({ product: new SimpleChange(null, component.product, false) });
      expect(component.inlinePrice).toBe('edited');
    });
  });

  describe('getters', () => {
    it('wishlisted reflects the wishlist service and guards a missing product', () => {
      const component = create();
      wishlist.isWishlisted.and.returnValue(true);
      expect(component.wishlisted).toBeTrue();
      component.product = undefined as never;
      expect(component.wishlisted).toBeFalse();
    });

    it('isOnSale is true only for a finite lower sale price', () => {
      const component = create(makeProduct({ base_price: 100, sale_price: 80 }));
      expect(component.isOnSale).toBeTrue();
      component.product = makeProduct({ base_price: 100, sale_price: 120 });
      expect(component.isOnSale).toBeFalse();
      component.product = makeProduct({ base_price: 100, sale_price: null });
      expect(component.isOnSale).toBeFalse();
      component.product = undefined as never;
      expect(component.isOnSale).toBeFalse();
    });

    it('displayPrice prefers the sale price when on sale', () => {
      const component = create(makeProduct({ base_price: 100, sale_price: 80 }));
      expect(component.displayPrice).toBe(80);
      component.product = makeProduct({ base_price: 100, sale_price: null });
      expect(component.displayPrice).toBe(100);
    });

    it('badge prefers tag, then sale, then promo badge, then tag name, then stock', () => {
      const component = create();
      component.tag = 'Featured';
      expect(component.badge).toBe('Featured');

      component.tag = null;
      component.product = makeProduct({ base_price: 100, sale_price: 50 });
      expect(component.badge).toBe('shop.sale');

      component.product = makeProduct({
        badges: [{ badge: 'new' }] as never,
      });
      expect(component.badge).toBe('product.badges.new');

      component.product = makeProduct({ tags: [{ name: 'Handmade' }] as never });
      expect(component.badge).toBe('Handmade');

      component.product = makeProduct({ stock_quantity: 0 });
      expect(component.badge).toBe('product.soldOut');
    });

    it('primaryImage picks the lowest sort order and falls back to a placeholder', () => {
      const component = create(makeProduct({ images: [] }));
      expect(component.primaryImage).toContain('placeholder');

      component.product = makeProduct({
        images: [
          { url: 'b.jpg', sort_order: 2 },
          { url: 'a.jpg', sort_order: 1 },
        ] as never,
      });
      expect(component.primaryImage).toBe('a.jpg');

      component.product = makeProduct({ images: [{ sort_order: 0 }] as never });
      expect(component.primaryImage).toContain('placeholder');
    });

    it('stockBadge reports sold out, low stock, or nothing', () => {
      const component = create(makeProduct({ stock_quantity: 0 }));
      expect(component.stockBadge).toBe('product.soldOut');
      component.product = makeProduct({ stock_quantity: 3 });
      expect(component.stockBadge).toBe('product.lowStock');
      component.product = makeProduct({ stock_quantity: 20 });
      expect(component.stockBadge).toBeNull();
    });
  });

  describe('activeProductBadge (via badge)', () => {
    it('returns null when there are no badges', () => {
      const component = create(makeProduct({ badges: [] as never, stock_quantity: 20, tags: [] }));
      expect(component.badge).toBeNull();
    });

    it('respects the priority order of active badges', () => {
      const component = create(
        makeProduct({ badges: [{ badge: 'handmade' }, { badge: 'new' }] as never }),
      );
      expect(component.badge).toBe('product.badges.new');
    });

    it('falls back to the first active badge outside the priority list', () => {
      const component = create(makeProduct({ badges: [{ badge: 'custom' }] as never }));
      expect(component.badge).toBe('product.badges.custom');
    });

    it('excludes badges outside their active window', () => {
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const past = new Date(Date.now() - 86_400_000).toISOString();
      const component = create(
        makeProduct({
          stock_quantity: 20,
          tags: [],
          badges: [
            { badge: 'new', start_at: future },
            { badge: 'limited', end_at: past },
          ] as never,
        }),
      );
      expect(component.badge).toBeNull();
    });

    it('keeps badges inside an explicit active window', () => {
      const past = new Date(Date.now() - 86_400_000).toISOString();
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const component = create(
        makeProduct({ badges: [{ badge: 'limited', start_at: past, end_at: future }] as never }),
      );
      expect(component.badge).toBe('product.badges.limited');
    });

    it('skips blank badge entries and returns null when none remain', () => {
      const component = create(
        makeProduct({ stock_quantity: 20, tags: [], badges: [{ badge: '  ' }] as never }),
      );
      expect(component.badge).toBeNull();
    });
  });

  describe('toggleWishlist', () => {
    it('does nothing without a product id', () => {
      const component = create(makeProduct({ id: '' }));
      component.toggleWishlist(mouseEvent());
      expect(wishlist.add).not.toHaveBeenCalled();
    });

    it('prompts sign in when not authenticated', () => {
      const component = create();
      auth.isAuthenticated.and.returnValue(false);
      component.toggleWishlist(mouseEvent());
      expect(toast.info).toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
    });

    it('removes a wishlisted product', () => {
      const component = create();
      wishlist.isWishlisted.and.returnValue(true);
      component.toggleWishlist(mouseEvent());
      expect(wishlist.remove).toHaveBeenCalledWith('p1');
      expect(wishlist.removeLocal).toHaveBeenCalledWith('p1');
      expect(toast.success).toHaveBeenCalled();
    });

    it('adds a product that is not yet wishlisted', () => {
      const component = create();
      wishlist.isWishlisted.and.returnValue(false);
      component.toggleWishlist(mouseEvent());
      expect(wishlist.add).toHaveBeenCalledWith('p1');
      expect(wishlist.addLocal).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalled();
    });
  });

  describe('goToDetails', () => {
    it('navigates to the product when a slug exists', () => {
      const component = create();
      component.goToDetails();
      expect(router.navigate).toHaveBeenCalledWith(['/products', 'prod-1']);
    });

    it('does nothing without a slug', () => {
      const component = create(makeProduct({ slug: '' }));
      component.goToDetails();
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });

  describe('showStorefrontEdit', () => {
    it('requires edit mode, admin, no impersonation and a slug', () => {
      const component = create();
      expect(component.showStorefrontEdit()).toBeFalse();

      storefront.enabled.and.returnValue(true);
      expect(component.showStorefrontEdit()).toBeTrue();

      auth.isImpersonating.and.returnValue(true);
      expect(component.showStorefrontEdit()).toBeFalse();
      auth.isImpersonating.and.returnValue(false);

      auth.isAdmin.and.returnValue(false);
      expect(component.showStorefrontEdit()).toBeFalse();
      auth.isAdmin.and.returnValue(true);

      component.product = makeProduct({ slug: '' });
      expect(component.showStorefrontEdit()).toBeFalse();
    });
  });

  describe('openAdminEdit', () => {
    it('navigates to the admin product editor with the slug', () => {
      const component = create();
      component.openAdminEdit(mouseEvent());
      expect(router.navigate).toHaveBeenCalledWith(['/admin/products'], {
        state: { editProductSlug: 'prod-1' },
      });
    });

    it('does nothing without a slug', () => {
      const component = create(makeProduct({ slug: '' }));
      component.openAdminEdit(mouseEvent());
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });

  describe('onStatusChange', () => {
    function selectFor(value: string): HTMLSelectElement {
      const select = document.createElement('select');
      for (const v of ['draft', 'published', 'archived']) {
        const opt = document.createElement('option');
        opt.value = v;
        select.appendChild(opt);
      }
      select.value = value;
      return select;
    }

    it('does nothing when storefront edit is disabled', () => {
      const component = create();
      const event = { ...mouseEvent(), target: selectFor('draft') } as unknown as Event;
      component.onStatusChange(event);
      expect(admin.updateProduct).not.toHaveBeenCalled();
    });

    it('ignores an empty or unchanged status', () => {
      const component = create(makeProduct({ status: 'published' }));
      storefront.enabled.and.returnValue(true);
      const blank = changeEvent(selectFor(''));
      component.onStatusChange(blank);
      expect(admin.updateProduct).not.toHaveBeenCalled();

      const same = changeEvent(selectFor('published'));
      component.onStatusChange(same);
      expect(admin.updateProduct).not.toHaveBeenCalled();
    });

    it('reverts the select while a save is already in flight', () => {
      const component = create(makeProduct({ status: 'published' }));
      storefront.enabled.and.returnValue(true);
      component.statusSaving = true;
      const select = selectFor('draft');
      component.onStatusChange(changeEvent(select));
      expect(select.value).toBe('published');
      expect(admin.updateProduct).not.toHaveBeenCalled();
    });

    it('does nothing when the product has no slug', () => {
      const component = create(makeProduct({ status: 'published', slug: '' }));
      storefront.enabled.and.returnValue(true);
      component.onStatusChange(changeEvent(selectFor('draft')));
      expect(admin.updateProduct).not.toHaveBeenCalled();
    });

    it('saves a new status and offers an undo action', () => {
      const component = create(makeProduct({ status: 'published' }));
      storefront.enabled.and.returnValue(true);
      admin.updateProduct.and.returnValue(of(makeProduct({ status: 'draft' })) as never);
      const select = selectFor('draft');
      component.onStatusChange(changeEvent(select));
      expect(admin.updateProduct).toHaveBeenCalledWith(
        'prod-1',
        { status: 'draft' },
        { source: 'storefront' },
      );
      expect(component.product.status).toBe('draft');
      expect(select.value).toBe('draft');
      expect(toast.action).toHaveBeenCalled();
    });

    it('uses the desired status when the response omits one', () => {
      const component = create(makeProduct({ status: 'published' }));
      storefront.enabled.and.returnValue(true);
      admin.updateProduct.and.returnValue(of(makeProduct({ status: undefined as never })) as never);
      component.onStatusChange(changeEvent(selectFor('archived')));
      expect(component.product.status).toBe('archived');
    });

    it('reverts the select and toasts on error', () => {
      const component = create(makeProduct({ status: 'published' }));
      storefront.enabled.and.returnValue(true);
      admin.updateProduct.and.returnValue(throwError(() => new Error('nope')));
      const select = selectFor('draft');
      component.onStatusChange(changeEvent(select));
      expect(select.value).toBe('published');
      expect(toast.error).toHaveBeenCalled();
      expect(component.statusSaving).toBeFalse();
    });
  });

  describe('saveInline', () => {
    beforeEach(() => {
      // default: edit mode on for the inline form
    });

    it('does nothing when storefront edit is off or already saving', () => {
      const component = create();
      component.saveInline();
      expect(admin.bulkUpdateProducts).not.toHaveBeenCalled();

      storefront.enabled.and.returnValue(true);
      component.inlineSaving = true;
      component.saveInline();
      expect(admin.bulkUpdateProducts).not.toHaveBeenCalled();
    });

    it('validates the price field', () => {
      const component = create();
      storefront.enabled.and.returnValue(true);
      component.inlinePrice = '';
      component.saveInline();
      expect(component.inlineError).toBe('adminUi.products.inline.errors.priceRequired');

      component.inlinePrice = 'abc';
      component.saveInline();
      expect(component.inlineError).toBe('adminUi.products.inline.errors.priceInvalid');
    });

    it('validates the stock field', () => {
      const component = create();
      storefront.enabled.and.returnValue(true);
      component.inlinePrice = '10';
      component.inlineStock = '';
      component.saveInline();
      expect(component.inlineError).toBe('adminUi.products.inline.errors.stockRequired');

      component.inlineStock = '1.5';
      component.saveInline();
      expect(component.inlineError).toBe('adminUi.products.inline.errors.stockInvalid');
    });

    it('returns early when nothing changed', () => {
      const component = create(makeProduct({ base_price: 100, stock_quantity: 5 }));
      storefront.enabled.and.returnValue(true);
      component.inlinePrice = '100';
      component.inlineStock = '5';
      component.saveInline();
      expect(admin.bulkUpdateProducts).not.toHaveBeenCalled();
    });

    it('saves changed price and stock and offers undo', () => {
      const component = create(makeProduct({ base_price: 100, stock_quantity: 5 }));
      storefront.enabled.and.returnValue(true);
      component.inlinePrice = '120,5';
      component.inlineStock = '9';
      component.saveInline();
      expect(admin.bulkUpdateProducts).toHaveBeenCalledWith(
        [{ product_id: 'p1', base_price: 120.5, stock_quantity: 9 }],
        { source: 'storefront' },
      );
      expect(component.product.base_price).toBe(120.5);
      expect(component.product.stock_quantity).toBe(9);
      expect(toast.action).toHaveBeenCalled();
    });

    it('toasts on a save error', () => {
      const component = create(makeProduct({ base_price: 100, stock_quantity: 5 }));
      storefront.enabled.and.returnValue(true);
      admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('boom')));
      component.inlinePrice = '110';
      component.inlineStock = '5';
      component.saveInline();
      expect(toast.error).toHaveBeenCalled();
      expect(component.inlineSaving).toBeFalse();
    });
  });

  describe('undoStatusChange', () => {
    function callUndo(component: ProductCardComponent, ...args: unknown[]): void {
      (component as unknown as { undoStatusChange: (...a: unknown[]) => void }).undoStatusChange(
        ...args,
      );
    }

    it('guards when edit is off, saving, or no previous status', () => {
      const component = create();
      callUndo(component, 'prod-1', 'draft', 'published');
      expect(admin.updateProduct).not.toHaveBeenCalled();

      storefront.enabled.and.returnValue(true);
      component.statusSaving = true;
      callUndo(component, 'prod-1', 'draft', 'published');
      expect(admin.updateProduct).not.toHaveBeenCalled();
      component.statusSaving = false;

      callUndo(component, 'prod-1', '', 'published');
      expect(admin.updateProduct).not.toHaveBeenCalled();
    });

    it('restores the previous status on success', () => {
      const component = create(makeProduct({ status: 'published' }));
      storefront.enabled.and.returnValue(true);
      admin.updateProduct.and.returnValue(of(makeProduct({ status: 'draft' })) as never);
      const select = document.createElement('select');
      const opt = document.createElement('option');
      opt.value = 'draft';
      select.appendChild(opt);
      callUndo(component, 'prod-1', 'draft', 'published', select);
      expect(component.product.status).toBe('draft');
      expect(toast.success).toHaveBeenCalled();
    });

    it('reverts on error', () => {
      const component = create(makeProduct({ status: 'published' }));
      storefront.enabled.and.returnValue(true);
      admin.updateProduct.and.returnValue(throwError(() => new Error('x')));
      callUndo(component, 'prod-1', 'draft', 'published');
      expect(component.product.status).toBe('published');
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('undoInlineUpdate', () => {
    function callUndo(component: ProductCardComponent, ...args: unknown[]): void {
      (component as unknown as { undoInlineUpdate: (...a: unknown[]) => void }).undoInlineUpdate(
        ...args,
      );
    }

    it('guards when edit is off, saving, or no product id', () => {
      const component = create();
      callUndo(component, 1, 2, 3, 4);
      expect(admin.bulkUpdateProducts).not.toHaveBeenCalled();

      storefront.enabled.and.returnValue(true);
      component.inlineSaving = true;
      callUndo(component, 1, 2, 3, 4);
      expect(admin.bulkUpdateProducts).not.toHaveBeenCalled();
      component.inlineSaving = false;

      component.product = makeProduct({ id: '' });
      callUndo(component, 1, 2, 3, 4);
      expect(admin.bulkUpdateProducts).not.toHaveBeenCalled();
    });

    it('restores previous values on success', () => {
      const component = create(makeProduct({ base_price: 200, stock_quantity: 9 }));
      storefront.enabled.and.returnValue(true);
      callUndo(component, 100, 5, 200, 9);
      expect(component.product.base_price).toBe(100);
      expect(component.product.stock_quantity).toBe(5);
      expect(toast.success).toHaveBeenCalled();
    });

    it('rolls forward to the current values on error', () => {
      const component = create(makeProduct({ base_price: 200, stock_quantity: 9 }));
      storefront.enabled.and.returnValue(true);
      admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
      callUndo(component, 100, 5, 200, 9);
      expect(component.product.base_price).toBe(200);
      expect(component.product.stock_quantity).toBe(9);
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('requestPinToTop', () => {
    it('emits the product id only when allowed', () => {
      const component = create();
      const emitted: string[] = [];
      component.pinToTop.subscribe((id) => emitted.push(id));

      component.requestPinToTop();
      expect(emitted).toEqual([]);

      storefront.enabled.and.returnValue(true);
      component.showPin = false;
      component.requestPinToTop();
      expect(emitted).toEqual([]);

      component.showPin = true;
      component.product = makeProduct({ id: '' });
      component.requestPinToTop();
      expect(emitted).toEqual([]);

      component.product = makeProduct({ id: 'pin-me' });
      component.requestPinToTop();
      expect(emitted).toEqual(['pin-me']);
    });
  });

  describe('openQuickView', () => {
    it('emits the slug when present and skips when missing', () => {
      const component = create();
      const emitted: string[] = [];
      component.quickView.subscribe((slug) => emitted.push(slug));

      component.product = makeProduct({ slug: '' });
      component.openQuickView();
      expect(emitted).toEqual([]);

      component.product = makeProduct({ slug: 'view-me' });
      component.openQuickView();
      expect(emitted).toEqual(['view-me']);
    });
  });

  describe('onPrimaryClick', () => {
    it('opens the quick view on a plain left click when enabled', () => {
      const component = create();
      component.quickViewOnCardClick = true;
      spyOn(component, 'openQuickView');
      const event = mouseEvent();
      component.onPrimaryClick(event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(component.openQuickView).toHaveBeenCalled();
    });

    it('falls through to remembering the shop return for modified clicks', () => {
      const component = create();
      component.quickViewOnCardClick = true;
      spyOn(component, 'openQuickView');
      spyOn(component, 'rememberShopReturnContext');
      component.onPrimaryClick(mouseEvent({ button: 1 }));
      expect(component.openQuickView).not.toHaveBeenCalled();
      expect(component.rememberShopReturnContext).toHaveBeenCalled();
    });

    it('treats clicks with modifier keys as non-plain', () => {
      const component = create();
      component.quickViewOnCardClick = true;
      spyOn(component, 'openQuickView');
      spyOn(component, 'rememberShopReturnContext');
      component.onPrimaryClick(mouseEvent({ ctrlKey: true }));
      expect(component.openQuickView).not.toHaveBeenCalled();
    });
  });

  describe('isOutOfStock', () => {
    it('returns false without a product', () => {
      const component = create();
      component.product = undefined as never;
      expect(component.isOutOfStock()).toBeFalse();
    });

    it('treats a variant with null stock as in stock', () => {
      const component = create(
        makeProduct({ variants: [{ id: 'v1', stock_quantity: null }] as never }),
      );
      expect(component.isOutOfStock()).toBeFalse();
    });

    it('is out of stock when stock is depleted and backorder is off', () => {
      const component = create(makeProduct({ stock_quantity: 0, allow_backorder: false }));
      expect(component.isOutOfStock()).toBeTrue();
    });

    it('is in stock when backorder is allowed', () => {
      const component = create(makeProduct({ stock_quantity: 0, allow_backorder: true }));
      expect(component.isOutOfStock()).toBeFalse();
    });
  });

  describe('addToCart', () => {
    it('does nothing without a product or when out of stock', () => {
      const component = create();
      component.product = undefined as never;
      component.addToCart();
      expect(cart.addFromProduct).not.toHaveBeenCalled();

      component.product = makeProduct({ stock_quantity: 0, allow_backorder: false });
      component.addToCart();
      expect(cart.addFromProduct).not.toHaveBeenCalled();
    });

    it('adds a variant product to the cart', () => {
      const component = create(
        makeProduct({ variants: [{ id: 'v1', stock_quantity: 4 }] as never }),
      );
      component.addToCart();
      expect(cart.addFromProduct).toHaveBeenCalledWith(
        jasmine.objectContaining({ product_id: 'p1', variant_id: 'v1', quantity: 1, stock: 4 }),
      );
      expect(toast.success).toHaveBeenCalled();
    });

    it('uses backorder stock when a variant has null stock', () => {
      const component = create(
        makeProduct({
          allow_backorder: true,
          variants: [{ id: 'v1', stock_quantity: null }] as never,
        }),
      );
      component.addToCart();
      expect(cart.addFromProduct).toHaveBeenCalledWith(jasmine.objectContaining({ stock: 9999 }));
    });

    it('defaults the stock cap to 99 for a null-stock variant without backorder', () => {
      const component = create(
        makeProduct({
          allow_backorder: false,
          variants: [{ id: 'v1', stock_quantity: null }] as never,
        }),
      );
      component.addToCart();
      expect(cart.addFromProduct).toHaveBeenCalledWith(jasmine.objectContaining({ stock: 99 }));
    });

    it('falls back to 99 when the resolved stock is not finite', () => {
      const component = create(
        makeProduct({ stock_quantity: Number.NaN as never, allow_backorder: false }),
      );
      component.addToCart();
      expect(cart.addFromProduct).toHaveBeenCalledWith(jasmine.objectContaining({ stock: 99 }));
    });
  });

  describe('rememberShopReturnContext', () => {
    let originalPath: string;

    beforeEach(() => {
      originalPath = window.location.pathname + window.location.search;
    });

    afterEach(() => {
      window.history.replaceState(null, '', originalPath);
      sessionStorage.clear();
    });

    it('does nothing when remembering is disabled', () => {
      const component = create();
      component.rememberShopReturn = false;
      component.rememberShopReturnContext();
      expect(sessionStorage.getItem('shop_return_pending')).toBeNull();
    });

    it('ignores non-plain clicks', () => {
      const component = create();
      component.rememberShopReturn = true;
      component.rememberShopReturnContext(mouseEvent({ button: 2 }));
      expect(sessionStorage.getItem('shop_return_pending')).toBeNull();

      component.rememberShopReturnContext(mouseEvent({ shiftKey: true }));
      expect(sessionStorage.getItem('shop_return_pending')).toBeNull();
    });

    it('skips when the path is not a shop route', () => {
      const component = create();
      component.rememberShopReturn = true;
      window.history.replaceState(null, '', '/account');
      component.rememberShopReturnContext();
      expect(sessionStorage.getItem('shop_return_pending')).toBeNull();
    });

    it('persists the shop return context on a shop route', () => {
      const component = create();
      component.rememberShopReturn = true;
      window.history.replaceState(null, '', '/shop?page=2');
      component.rememberShopReturnContext(mouseEvent());
      expect(sessionStorage.getItem('shop_return_pending')).toBe('1');
      expect(sessionStorage.getItem('shop_return_url')).toBe('/shop?page=2');
    });

    it('swallows storage write failures', () => {
      const component = create();
      component.rememberShopReturn = true;
      window.history.replaceState(null, '', '/shop');
      spyOn(sessionStorage, 'setItem').and.throwError('quota');
      expect(() => component.rememberShopReturnContext()).not.toThrow();
    });

    it('records a non-zero scroll position when the window is scrolled', () => {
      const component = create();
      component.rememberShopReturn = true;
      window.history.replaceState(null, '', '/shop');
      Object.defineProperty(window, 'scrollY', { value: 321, configurable: true });
      try {
        component.rememberShopReturnContext(mouseEvent());
      } finally {
        delete (window as { scrollY?: number }).scrollY;
      }
      expect(sessionStorage.getItem('shop_return_scroll_y')).toBe('321');
    });
  });

  describe('branch coverage top-offs', () => {
    it('ngOnChanges handles a product with a nullish id and a null stock', () => {
      const component = create();
      component.product = undefined as never;
      component.inlinePrice = 'keep';
      component.ngOnChanges({ product: new SimpleChange(null, undefined, true) });
      expect(component.inlinePrice).toBe('keep');

      component.product = makeProduct({ id: 'n', base_price: 5, stock_quantity: null as never });
      component.ngOnChanges({ product: new SimpleChange(null, component.product, true) });
      expect(component.inlineStock).toBe('0');
    });

    it('primaryImage tolerates a non-array images value and missing sort orders', () => {
      const component = create(makeProduct({ images: undefined as never }));
      expect(component.primaryImage).toContain('placeholder');

      component.product = makeProduct({
        images: [{ url: 'a.jpg' }, { url: 'b.jpg' }] as never,
      });
      expect(component.primaryImage).toBe('a.jpg');
    });

    it('stockBadge treats a null stock as low stock', () => {
      const component = create(makeProduct({ stock_quantity: null as never }));
      expect(component.stockBadge).toBe('product.lowStock');
    });

    it('badge skips entries whose badge value is falsy', () => {
      const component = create(
        makeProduct({ stock_quantity: 20, tags: [], badges: [{ badge: null }] as never }),
      );
      expect(component.badge).toBeNull();
    });

    it('onStatusChange defaults a missing current status to published', () => {
      const component = create(makeProduct({ status: undefined as never }));
      storefront.enabled.and.returnValue(true);
      component.onStatusChange(changeEvent(selectForStatus('draft')));
      expect(admin.updateProduct).toHaveBeenCalledWith(
        'prod-1',
        { status: 'draft' },
        { source: 'storefront' },
      );
    });

    it('onStatusChange bails out when the trimmed slug is empty', () => {
      const component = create(makeProduct({ status: 'published', slug: '' }));
      spyOn(component, 'showStorefrontEdit').and.returnValue(true);
      component.onStatusChange(changeEvent(selectForStatus('draft')));
      expect(admin.updateProduct).not.toHaveBeenCalled();
    });

    it('onStatusChange falls back to the desired status when the response trims empty', () => {
      const component = create(makeProduct({ status: 'published' }));
      storefront.enabled.and.returnValue(true);
      admin.updateProduct.and.returnValue(of(makeProduct({ status: '   ' })) as never);
      let undoCb: (() => void) | undefined;
      toast.action.and.callFake((_m: string, _l: string, cb: () => void) => {
        undoCb = cb;
      });
      const select = selectForStatus('draft');
      component.onStatusChange(changeEvent(select));
      expect(component.product.status).toBe('   ');
      expect(undoCb).toEqual(jasmine.any(Function));
      undoCb?.();
    });

    it('saveInline coerces nullish inline fields to empty strings', () => {
      const component = create();
      storefront.enabled.and.returnValue(true);
      component.inlinePrice = null as never;
      component.saveInline();
      expect(component.inlineError).toBe('adminUi.products.inline.errors.priceRequired');

      component.inlinePrice = '10';
      component.inlineStock = null as never;
      component.saveInline();
      expect(component.inlineError).toBe('adminUi.products.inline.errors.stockRequired');
    });

    it('saveInline defaults a non-numeric current price and null current stock', () => {
      const component = create(
        makeProduct({ base_price: undefined as never, stock_quantity: null as never }),
      );
      storefront.enabled.and.returnValue(true);
      component.inlinePrice = '50';
      component.inlineStock = '5';
      component.saveInline();
      expect(admin.bulkUpdateProducts).toHaveBeenCalledWith(
        [{ product_id: 'p1', base_price: 50, stock_quantity: 5 }],
        { source: 'storefront' },
      );
    });

    it('saveInline updates only the changed price and invokes the undo action', () => {
      const component = create(makeProduct({ base_price: 100, stock_quantity: 5 }));
      storefront.enabled.and.returnValue(true);
      toast.action.and.callFake((_m: string, _l: string, cb: () => void) => cb() as never);
      component.inlinePrice = '120';
      component.inlineStock = '5';
      component.saveInline();
      expect(admin.bulkUpdateProducts).toHaveBeenCalledWith(
        [{ product_id: 'p1', base_price: 120 }],
        { source: 'storefront' },
      );
    });

    it('saveInline updates only the changed stock', () => {
      const component = create(makeProduct({ base_price: 100, stock_quantity: 5 }));
      storefront.enabled.and.returnValue(true);
      component.inlinePrice = '100';
      component.inlineStock = '9';
      component.saveInline();
      expect(admin.bulkUpdateProducts).toHaveBeenCalledWith(
        [{ product_id: 'p1', stock_quantity: 9 }],
        { source: 'storefront' },
      );
    });

    it('undoStatusChange falls back to the desired status and reverts with a select on error', () => {
      const component = create(makeProduct({ status: 'published' }));
      storefront.enabled.and.returnValue(true);
      admin.updateProduct.and.returnValue(of(makeProduct({ status: undefined as never })) as never);
      const ok = document.createElement('select');
      (component as unknown as { undoStatusChange: (...a: unknown[]) => void }).undoStatusChange(
        'prod-1',
        'draft',
        'published',
        ok,
      );
      expect(component.product.status).toBe('draft');

      admin.updateProduct.and.returnValue(throwError(() => new Error('x')));
      const select = document.createElement('select');
      const opt = document.createElement('option');
      opt.value = 'archived';
      select.appendChild(opt);
      (component as unknown as { undoStatusChange: (...a: unknown[]) => void }).undoStatusChange(
        'prod-1',
        'draft',
        'archived',
        select,
      );
      expect(component.product.status).toBe('archived');
      expect(select.value).toBe('archived');
    });

    it('isOutOfStock defaults to zero when both variant and product stock are null', () => {
      const component = create(
        makeProduct({
          stock_quantity: null as never,
          variants: [{ id: 'v1', stock_quantity: null }] as never,
        }),
      );
      expect(component.isOutOfStock()).toBeFalse();
    });

    it('rememberShopReturnContext bails out when sessionStorage is unavailable', () => {
      const component = create();
      component.rememberShopReturn = true;
      const desc = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
      try {
        Object.defineProperty(window, 'sessionStorage', {
          value: undefined,
          configurable: true,
        });
        expect(() => component.rememberShopReturnContext()).not.toThrow();
      } finally {
        if (desc) Object.defineProperty(window, 'sessionStorage', desc);
      }
    });
  });

  function selectForStatus(value: string): HTMLSelectElement {
    const select = document.createElement('select');
    for (const v of ['draft', 'published', 'archived']) {
      const opt = document.createElement('option');
      opt.value = v;
      select.appendChild(opt);
    }
    select.value = value;
    return select;
  }
});
