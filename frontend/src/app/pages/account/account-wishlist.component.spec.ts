import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { of, throwError, Subject } from 'rxjs';

import { AccountWishlistComponent } from './account-wishlist.component';
import { AccountComponent } from './account.component';
import { CartStore } from '../../core/cart.store';
import { CatalogService, Product } from '../../core/catalog.service';
import { ToastService } from '../../core/toast.service';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    slug: 'p1',
    name: 'Product 1',
    base_price: 10,
    currency: 'RON',
    ...overrides,
  } as Product;
}

describe('AccountWishlistComponent', () => {
  let wishlist: {
    items: jasmine.Spy;
    isLoaded: jasmine.Spy;
    getBaseline: jasmine.Spy;
    effectivePrice: jasmine.Spy;
    remove: jasmine.Spy;
    removeLocal: jasmine.Spy;
  };
  let account: { wishlist: typeof wishlist };
  let cart: jasmine.SpyObj<CartStore>;
  let toast: jasmine.SpyObj<ToastService>;
  let catalog: jasmine.SpyObj<CatalogService>;
  let translate: jasmine.SpyObj<TranslateService>;

  beforeEach(() => {
    wishlist = {
      items: jasmine.createSpy('items').and.returnValue([]),
      isLoaded: jasmine.createSpy('isLoaded').and.returnValue(true),
      getBaseline: jasmine.createSpy('getBaseline').and.returnValue(null),
      effectivePrice: jasmine
        .createSpy('effectivePrice')
        .and.callFake((p: Product) => p.base_price),
      remove: jasmine.createSpy('remove').and.returnValue(of(undefined)),
      removeLocal: jasmine.createSpy('removeLocal'),
    };
    account = { wishlist };

    cart = jasmine.createSpyObj<CartStore>('CartStore', ['addFromProduct']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    catalog = jasmine.createSpyObj<CatalogService>('CatalogService', [
      'getBackInStockStatus',
      'requestBackInStock',
      'cancelBackInStock',
    ]);
    catalog.getBackInStockStatus.and.returnValue(of({ in_stock: false, request: null }));
    catalog.requestBackInStock.and.returnValue(
      of({ id: 'req1', created_at: '2020-01-01T00:00:00Z' }),
    );
    catalog.cancelBackInStock.and.returnValue(of(undefined));

    translate = jasmine.createSpyObj<TranslateService>('TranslateService', ['instant']);
    translate.instant.and.callFake((key: string | string[]) =>
      Array.isArray(key) ? key.join(',') : key,
    );

    TestBed.configureTestingModule({
      imports: [AccountWishlistComponent],
      providers: [
        { provide: AccountComponent, useValue: account },
        { provide: CartStore, useValue: cart },
        { provide: ToastService, useValue: toast },
        { provide: CatalogService, useValue: catalog },
        { provide: TranslateService, useValue: translate },
      ],
    });
    TestBed.overrideComponent(AccountWishlistComponent, {
      set: { template: '', imports: [] },
    });
  });

  function create(): AccountWishlistComponent {
    return TestBed.createComponent(AccountWishlistComponent).componentInstance;
  }

  describe('selection', () => {
    it('toggles a single product in and out of the selection', () => {
      const cmp = create();
      expect(cmp.isSelected('p1')).toBe(false);

      cmp.toggleSelected('p1', true);
      expect(cmp.isSelected('p1')).toBe(true);
      expect(cmp.selectedCount()).toBe(1);

      cmp.toggleSelected('p1', false);
      expect(cmp.isSelected('p1')).toBe(false);
      expect(cmp.selectedCount()).toBe(0);
    });

    it('reports allSelected as false when there are no items', () => {
      wishlist.items.and.returnValue([]);
      const cmp = create();
      expect(cmp.allSelected()).toBe(false);
    });

    it('reports allSelected true only when every item is selected', () => {
      wishlist.items.and.returnValue([makeProduct({ id: 'a' }), makeProduct({ id: 'b' })]);
      const cmp = create();
      expect(cmp.allSelected()).toBe(false);

      cmp.toggleSelected('a', true);
      expect(cmp.allSelected()).toBe(false);

      cmp.toggleSelected('b', true);
      expect(cmp.allSelected()).toBe(true);
    });

    it('selects every item when toggleSelectAll(true) and clears on false', () => {
      wishlist.items.and.returnValue([makeProduct({ id: 'a' }), makeProduct({ id: 'b' })]);
      const cmp = create();

      cmp.toggleSelectAll(true);
      expect(cmp.selectedCount()).toBe(2);
      expect(cmp.allSelected()).toBe(true);

      cmp.toggleSelectAll(false);
      expect(cmp.selectedCount()).toBe(0);
    });

    it('clears the selection explicitly', () => {
      const cmp = create();
      cmp.toggleSelected('a', true);
      cmp.clearSelection();
      expect(cmp.selectedCount()).toBe(0);
    });
  });

  describe('addSelectedToCart', () => {
    it('adds matched products with sale/base price, stock and image fallbacks, skipping unknown ids', () => {
      const onSale = makeProduct({
        id: 'a',
        slug: 'a',
        name: 'A',
        base_price: 10,
        sale_price: 8,
        stock_quantity: 5,
        images: [{ url: 'img-a' } as any],
      });
      const noSale = makeProduct({
        id: 'b',
        slug: 'b',
        name: 'B',
        base_price: 12,
        sale_price: null,
        stock_quantity: null,
      });
      wishlist.items.and.returnValue([onSale, noSale]);
      const cmp = create();
      cmp.toggleSelected('a', true);
      cmp.toggleSelected('b', true);
      cmp.toggleSelected('ghost', true);

      cmp.addSelectedToCart();

      expect(cart.addFromProduct).toHaveBeenCalledTimes(2);
      expect(cart.addFromProduct).toHaveBeenCalledWith({
        product_id: 'a',
        quantity: 1,
        name: 'A',
        slug: 'a',
        price: 8,
        currency: 'RON',
        stock: 5,
        image: 'img-a',
      });
      expect(cart.addFromProduct).toHaveBeenCalledWith({
        product_id: 'b',
        quantity: 1,
        name: 'B',
        slug: 'b',
        price: 12,
        currency: 'RON',
        stock: undefined,
        image: undefined,
      });
      expect(toast.success).toHaveBeenCalledWith('account.wishlist.messages.addedToCart');
    });
  });

  describe('removeSelected', () => {
    it('does nothing when the selection is empty', () => {
      const confirmSpy = spyOn(window, 'confirm');
      const cmp = create();

      cmp.removeSelected();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(wishlist.remove).not.toHaveBeenCalled();
      expect(cmp.bulkBusy).toBe(false);
    });

    it('aborts when the user cancels the confirmation dialog', () => {
      spyOn(window, 'confirm').and.returnValue(false);
      const cmp = create();
      cmp.toggleSelected('a', true);

      cmp.removeSelected();

      expect(wishlist.remove).not.toHaveBeenCalled();
      expect(cmp.bulkBusy).toBe(false);
    });

    it('removes each selected item, updates local state and resets busy flag', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      wishlist.items.and.returnValue([makeProduct({ id: 'a' }), makeProduct({ id: 'b' })]);
      const cmp = create();
      cmp.toggleSelected('a', true);
      cmp.toggleSelected('b', true);

      cmp.removeSelected();

      expect(wishlist.remove).toHaveBeenCalledWith('a');
      expect(wishlist.remove).toHaveBeenCalledWith('b');
      expect(wishlist.removeLocal).toHaveBeenCalledWith('a');
      expect(wishlist.removeLocal).toHaveBeenCalledWith('b');
      expect(toast.success).toHaveBeenCalledWith('account.wishlist.messages.removedSelected');
      expect(cmp.bulkBusy).toBe(false);
      expect(cmp.selectedCount()).toBe(0);
    });

    it('swallows per-item remove errors via catchError and still completes', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      wishlist.items.and.returnValue([makeProduct({ id: 'a' }), makeProduct({ id: 'b' })]);
      wishlist.remove.and.callFake((id: string) =>
        id === 'a' ? throwError(() => new Error('boom')) : of(undefined),
      );
      const cmp = create();
      cmp.toggleSelected('a', true);
      cmp.toggleSelected('b', true);

      expect(() => cmp.removeSelected()).not.toThrow();
      expect(wishlist.removeLocal).toHaveBeenCalledWith('a');
      expect(wishlist.removeLocal).toHaveBeenCalledWith('b');
      expect(toast.success).toHaveBeenCalledWith('account.wishlist.messages.removedSelected');
      expect(cmp.bulkBusy).toBe(false);
    });
  });

  describe('isOutOfStock', () => {
    it('is false when stock is positive', () => {
      const cmp = create();
      expect(cmp.isOutOfStock(makeProduct({ stock_quantity: 3 }))).toBe(false);
    });

    it('is false when out of stock but backorder is allowed', () => {
      const cmp = create();
      expect(
        cmp.isOutOfStock(makeProduct({ stock_quantity: 0, allow_backorder: true })),
      ).toBe(false);
    });

    it('is true when out of stock and no backorder (null stock treated as zero)', () => {
      const cmp = create();
      expect(
        cmp.isOutOfStock(makeProduct({ stock_quantity: null, allow_backorder: false })),
      ).toBe(true);
    });
  });

  describe('back-in-stock status', () => {
    it('does not fetch status for in-stock items and returns null request', () => {
      const cmp = create();
      const inStock = makeProduct({ stock_quantity: 5 });
      expect(cmp.backInStockRequest(inStock)).toBeNull();
      expect(catalog.getBackInStockStatus).not.toHaveBeenCalled();
    });

    it('fetches once, caches the request and short-circuits subsequent reads', () => {
      const req = { id: 'r1', created_at: '2020-01-01T00:00:00Z' };
      catalog.getBackInStockStatus.and.returnValue(of({ in_stock: false, request: req }));
      const cmp = create();
      const oos = makeProduct({ id: 'a', slug: 'a', stock_quantity: 0 });

      expect(cmp.backInStockRequest(oos)).toEqual(req);
      expect(cmp.backInStockRequest(oos)).toEqual(req);
      expect(catalog.getBackInStockStatus).toHaveBeenCalledTimes(1);
      expect(cmp.isBackInStockBusy(oos)).toBe(false);
    });

    it('returns null when the cached status has no request', () => {
      catalog.getBackInStockStatus.and.returnValue(of({ in_stock: true }));
      const cmp = create();
      const oos = makeProduct({ id: 'a', slug: 'a', stock_quantity: 0 });
      expect(cmp.backInStockRequest(oos)).toBeNull();
    });

    it('marks the item busy while a status fetch is pending and avoids duplicate fetches', () => {
      const pending = new Subject<any>();
      catalog.getBackInStockStatus.and.returnValue(pending.asObservable());
      const cmp = create();
      const oos = makeProduct({ id: 'a', slug: 'a', stock_quantity: 0 });

      expect(cmp.backInStockRequest(oos)).toBeNull();
      expect(cmp.isBackInStockBusy(oos)).toBe(true);
      expect(cmp.backInStockRequest(oos)).toBeNull();
      expect(catalog.getBackInStockStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe('requestBackInStock', () => {
    it('ignores in-stock items', () => {
      const cmp = create();
      cmp.requestBackInStock(makeProduct({ stock_quantity: 4 }));
      expect(catalog.requestBackInStock).not.toHaveBeenCalled();
    });

    it('ignores items that already have a pending request', () => {
      const req = { id: 'r1', created_at: '2020-01-01T00:00:00Z' };
      catalog.getBackInStockStatus.and.returnValue(of({ in_stock: false, request: req }));
      const cmp = create();
      const oos = makeProduct({ id: 'a', slug: 'a', stock_quantity: 0 });

      cmp.requestBackInStock(oos);
      expect(catalog.requestBackInStock).not.toHaveBeenCalled();
    });

    it('ignores items whose status fetch is still in flight', () => {
      catalog.getBackInStockStatus.and.returnValue(new Subject<any>().asObservable());
      const cmp = create();
      const oos = makeProduct({ id: 'a', slug: 'a', stock_quantity: 0 });

      cmp.requestBackInStock(oos);
      expect(catalog.requestBackInStock).not.toHaveBeenCalled();
    });

    it('submits a request, caches it, notifies success and clears busy', () => {
      const req = { id: 'r1', created_at: '2020-01-01T00:00:00Z' };
      catalog.requestBackInStock.and.returnValue(of(req));
      const cmp = create();
      const oos = makeProduct({ id: 'a', slug: 'a', name: 'A', stock_quantity: 0 });

      cmp.requestBackInStock(oos);

      expect(catalog.requestBackInStock).toHaveBeenCalledWith('a');
      expect(cmp.backInStockRequest(oos)).toEqual(req);
      expect(toast.success).toHaveBeenCalledWith(
        'product.notifyRequestedTitle',
        'product.notifyRequestedBody',
      );
      expect(cmp.isBackInStockBusy(oos)).toBe(false);
    });

    it('shows an error toast when the request fails', () => {
      catalog.requestBackInStock.and.returnValue(throwError(() => new Error('nope')));
      const cmp = create();
      const oos = makeProduct({ id: 'a', slug: 'a', name: 'A', stock_quantity: 0 });

      cmp.requestBackInStock(oos);

      expect(toast.error).toHaveBeenCalledWith('product.loadErrorTitle', 'product.loadErrorCopy');
      expect(cmp.isBackInStockBusy(oos)).toBe(false);
    });
  });

  describe('cancelBackInStock', () => {
    it('does nothing when there is no existing request', () => {
      catalog.getBackInStockStatus.and.returnValue(of({ in_stock: false, request: null }));
      const cmp = create();
      const oos = makeProduct({ id: 'a', slug: 'a', stock_quantity: 0 });

      cmp.cancelBackInStock(oos);
      expect(catalog.cancelBackInStock).not.toHaveBeenCalled();
    });

    it('does nothing when a cancel is already in flight', () => {
      const cmp = create();
      const oos = makeProduct({ id: 'a', slug: 'a', stock_quantity: 0 });
      (cmp as unknown as { backInStockById: Map<string, unknown> }).backInStockById.set('a', {
        in_stock: false,
        request: { id: 'r1', created_at: '2020-01-01T00:00:00Z' },
      });
      (cmp as unknown as { backInStockBusy: Set<string> }).backInStockBusy.add('a');

      cmp.cancelBackInStock(oos);
      expect(catalog.cancelBackInStock).not.toHaveBeenCalled();
    });

    it('cancels the request, clears it from cache and notifies success', () => {
      const req = { id: 'r1', created_at: '2020-01-01T00:00:00Z' };
      catalog.getBackInStockStatus.and.returnValue(of({ in_stock: false, request: req }));
      const cmp = create();
      const oos = makeProduct({ id: 'a', slug: 'a', name: 'A', stock_quantity: 0 });

      cmp.cancelBackInStock(oos);

      expect(catalog.cancelBackInStock).toHaveBeenCalledWith('a');
      expect(cmp.backInStockRequest(oos)).toBeNull();
      expect(toast.success).toHaveBeenCalledWith(
        'product.notifyCanceledTitle',
        'product.notifyCanceledBody',
      );
      expect(cmp.isBackInStockBusy(oos)).toBe(false);
    });

    it('shows an error toast when the cancel fails', () => {
      const req = { id: 'r1', created_at: '2020-01-01T00:00:00Z' };
      catalog.getBackInStockStatus.and.returnValue(of({ in_stock: false, request: req }));
      catalog.cancelBackInStock.and.returnValue(throwError(() => new Error('nope')));
      const cmp = create();
      const oos = makeProduct({ id: 'a', slug: 'a', name: 'A', stock_quantity: 0 });

      cmp.cancelBackInStock(oos);

      expect(toast.error).toHaveBeenCalledWith('product.loadErrorTitle', 'product.loadErrorCopy');
      expect(cmp.isBackInStockBusy(oos)).toBe(false);
    });
  });

  describe('priceChange', () => {
    it('returns null without a baseline', () => {
      wishlist.getBaseline.and.returnValue(null);
      const cmp = create();
      expect(cmp.priceChange(makeProduct())).toBeNull();
    });

    it('returns null when the current price is not finite', () => {
      wishlist.getBaseline.and.returnValue({ saved_at: 's', price: 10, stock_quantity: 1 });
      wishlist.effectivePrice.and.returnValue(Number.NaN);
      const cmp = create();
      expect(cmp.priceChange(makeProduct())).toBeNull();
    });

    it('returns null when the baseline price is not finite', () => {
      wishlist.getBaseline.and.returnValue({ saved_at: 's', price: Number.NaN, stock_quantity: 1 });
      wishlist.effectivePrice.and.returnValue(10);
      const cmp = create();
      expect(cmp.priceChange(makeProduct())).toBeNull();
    });

    it('returns null for negligible differences', () => {
      wishlist.getBaseline.and.returnValue({ saved_at: 's', price: 10, stock_quantity: 1 });
      wishlist.effectivePrice.and.returnValue(10.005);
      const cmp = create();
      expect(cmp.priceChange(makeProduct())).toBeNull();
    });

    it('reports an upward price change', () => {
      wishlist.getBaseline.and.returnValue({ saved_at: 's', price: 10, stock_quantity: 1 });
      wishlist.effectivePrice.and.returnValue(12);
      const cmp = create();
      expect(cmp.priceChange(makeProduct())).toEqual({ direction: 'up', delta: 2 });
    });

    it('reports a downward price change', () => {
      wishlist.getBaseline.and.returnValue({ saved_at: 's', price: 10, stock_quantity: 1 });
      wishlist.effectivePrice.and.returnValue(8);
      const cmp = create();
      expect(cmp.priceChange(makeProduct())).toEqual({ direction: 'down', delta: 2 });
    });
  });

  describe('stockChange', () => {
    it('returns null without a baseline', () => {
      wishlist.getBaseline.and.returnValue(null);
      const cmp = create();
      expect(cmp.stockChange(makeProduct())).toBeNull();
    });

    it('returns null when the baseline stock is unknown', () => {
      wishlist.getBaseline.and.returnValue({ saved_at: 's', price: 10, stock_quantity: null });
      const cmp = create();
      expect(cmp.stockChange(makeProduct())).toBeNull();
    });

    it('reports "out" when an item that used to be stocked is now unavailable', () => {
      wishlist.getBaseline.and.returnValue({ saved_at: 's', price: 10, stock_quantity: 5 });
      const cmp = create();
      expect(
        cmp.stockChange(makeProduct({ stock_quantity: 0, allow_backorder: false })),
      ).toBe('out');
    });

    it('reports "back" when a previously empty item is stocked again', () => {
      wishlist.getBaseline.and.returnValue({ saved_at: 's', price: 10, stock_quantity: 0 });
      const cmp = create();
      expect(cmp.stockChange(makeProduct({ stock_quantity: 4 }))).toBe('back');
    });

    it('reports "back" via backorder availability when stock is missing', () => {
      wishlist.getBaseline.and.returnValue({ saved_at: 's', price: 10, stock_quantity: 0 });
      const cmp = create();
      expect(
        cmp.stockChange(makeProduct({ stock_quantity: null, allow_backorder: true })),
      ).toBe('back');
    });

    it('returns null when availability is unchanged', () => {
      wishlist.getBaseline.and.returnValue({ saved_at: 's', price: 10, stock_quantity: 5 });
      const cmp = create();
      expect(cmp.stockChange(makeProduct({ stock_quantity: 5 }))).toBeNull();
    });
  });
});
