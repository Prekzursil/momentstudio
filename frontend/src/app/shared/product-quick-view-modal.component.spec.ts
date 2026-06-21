import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { CatalogService, Product } from '../core/catalog.service';
import { CartStore } from '../core/cart.store';
import { ToastService } from '../core/toast.service';
import { ProductQuickViewModalComponent } from './product-quick-view-modal.component';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    slug: 'prod',
    name: 'Prod',
    base_price: 100,
    currency: 'RON',
    images: [
      { url: '/a.png', sort_order: 2 },
      { url: '/b.png', sort_order: 1 },
    ],
    ...overrides,
  } as Product;
}

describe('ProductQuickViewModalComponent', () => {
  let fixture: ComponentFixture<ProductQuickViewModalComponent>;
  let component: ProductQuickViewModalComponent;
  let catalog: jasmine.SpyObj<CatalogService>;
  let cart: jasmine.SpyObj<CartStore>;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    catalog = jasmine.createSpyObj<CatalogService>('CatalogService', ['getProduct']);
    cart = jasmine.createSpyObj<CartStore>('CartStore', ['addFromProduct']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success']);
    catalog.getProduct.and.returnValue(of(makeProduct()));

    await TestBed.configureTestingModule({
      imports: [ProductQuickViewModalComponent, TranslateModule.forRoot()],
      providers: [
        { provide: CatalogService, useValue: catalog },
        { provide: CartStore, useValue: cart },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProductQuickViewModalComponent);
    component = fixture.componentInstance;
  });

  function openWith(slug: string): void {
    component.slug = slug;
    component.open = true;
    component.ngOnChanges({ open: new SimpleChange(false, true, true) });
  }

  it('creates', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('ignores ngOnChanges without open/slug changes', () => {
    component.ngOnChanges({});
    expect(catalog.getProduct).not.toHaveBeenCalled();
  });

  it('loads and sorts product images when opened', () => {
    openWith('prod');
    expect(catalog.getProduct).toHaveBeenCalledWith('prod');
    expect(component.product?.images?.[0].url).toBe('/b.png'); // sorted by sort_order
    expect(component.loading).toBeFalse();
  });

  it('resets when closed via ngOnChanges', () => {
    openWith('prod');
    component.open = false;
    component.ngOnChanges({ open: new SimpleChange(true, false, false) });
    expect(component.product).toBeNull();
  });

  it('reports an error when slug is empty', () => {
    component.slug = '';
    component.open = true;
    component.ngOnChanges({ open: new SimpleChange(false, true, true) });
    expect(component.error).toBeTruthy();
    expect(component.product).toBeNull();
  });

  it('reports an error when loading fails and retries', () => {
    catalog.getProduct.and.returnValue(throwError(() => new Error('fail')));
    openWith('prod');
    expect(component.error).toBeTruthy();
    expect(component.product).toBeNull();

    catalog.getProduct.and.returnValue(of(makeProduct()));
    component.retry();
    expect(component.product).toBeTruthy();
  });

  it('does not retry when closed', () => {
    component.open = false;
    catalog.getProduct.calls.reset();
    component.retry();
    expect(catalog.getProduct).not.toHaveBeenCalled();
  });

  it('falls back to a default title and uses product name when loaded', () => {
    expect(component.title()).toBe('shop.quickView');
    openWith('prod');
    expect(component.title()).toBe('Prod');
  });

  it('switches the active image and clamps the url lookup', () => {
    openWith('prod');
    component.setActiveImage(1);
    expect(component.activeImageUrl()).toBe('/a.png');
    component.setActiveImage(99);
    expect(component.activeImageUrl()).toBe('/a.png');
  });

  it('returns a placeholder image url when no images', () => {
    catalog.getProduct.and.returnValue(of(makeProduct({ images: [] })));
    openWith('prod');
    expect(component.activeImageUrl()).toContain('placeholder');
  });

  it('computes sale state and display price', () => {
    const onSale = makeProduct({ base_price: 100, sale_price: 80 });
    expect(component.isOnSale(onSale)).toBeTrue();
    expect(component.displayPrice(onSale)).toBe(80);
    const notSale = makeProduct({ base_price: 100, sale_price: null });
    expect(component.isOnSale(notSale)).toBeFalse();
    expect(component.displayPrice(notSale)).toBe(100);
  });

  it('detects out-of-stock honoring variants and backorder', () => {
    catalog.getProduct.and.returnValue(of(makeProduct({ stock_quantity: 0 })));
    openWith('prod');
    expect(component.isOutOfStock()).toBeTrue();

    catalog.getProduct.and.returnValue(
      of(makeProduct({ stock_quantity: 0, allow_backorder: true })),
    );
    openWith('prod');
    expect(component.isOutOfStock()).toBeFalse();

    catalog.getProduct.and.returnValue(
      of(makeProduct({ variants: [{ id: 'v1', name: 'V', stock_quantity: null }] })),
    );
    openWith('prod');
    component.selectedVariantId = 'v1';
    expect(component.isOutOfStock()).toBeFalse();
  });

  it('reports not out-of-stock when there is no product', () => {
    expect(component.isOutOfStock()).toBeFalse();
  });

  it('adds the product to the cart with toast feedback', () => {
    catalog.getProduct.and.returnValue(
      of(makeProduct({ variants: [{ id: 'v1', name: 'V', stock_quantity: 5 }] })),
    );
    openWith('prod');
    component.selectedVariantId = 'v1';
    component.quantity = 2;
    component.addToCart();
    expect(cart.addFromProduct).toHaveBeenCalledWith(
      jasmine.objectContaining({ product_id: 'p1', variant_id: 'v1', quantity: 2 }),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it('does not add to cart when out of stock or no product', () => {
    component.addToCart();
    expect(cart.addFromProduct).not.toHaveBeenCalled();

    catalog.getProduct.and.returnValue(of(makeProduct({ stock_quantity: 0 })));
    openWith('prod');
    component.addToCart();
    expect(cart.addFromProduct).not.toHaveBeenCalled();
  });

  it('clamps an invalid quantity and uses placeholder image/default stock', () => {
    // undefined stock + backorder keeps it in stock so addToCart proceeds; the
    // `?? 99` default stock and placeholder image branches both execute.
    catalog.getProduct.and.returnValue(
      of(
        makeProduct({
          images: [],
          stock_quantity: undefined as unknown as number,
          allow_backorder: true,
        }),
      ),
    );
    openWith('prod');
    component.quantity = 0;
    component.addToCart();
    expect(cart.addFromProduct).toHaveBeenCalledWith(
      jasmine.objectContaining({
        quantity: 1,
        stock: 99,
        image: jasmine.stringMatching('placeholder'),
      }),
    );
  });

  it('emits view details with the slug then closes', () => {
    const viewSpy = jasmine.createSpy('view');
    const closedSpy = jasmine.createSpy('closed');
    component.view.subscribe(viewSpy);
    component.closed.subscribe(closedSpy);
    openWith('prod');
    component.viewDetails();
    expect(viewSpy).toHaveBeenCalledWith('prod');
    expect(closedSpy).toHaveBeenCalled();
  });

  it('does not emit view details without a slug', () => {
    const viewSpy = jasmine.createSpy('view');
    component.view.subscribe(viewSpy);
    component.slug = '';
    component.product = null;
    component.viewDetails();
    expect(viewSpy).not.toHaveBeenCalled();
  });

  it('emits closed and resets on handleClosed', () => {
    const closedSpy = jasmine.createSpy('closed');
    component.closed.subscribe(closedSpy);
    openWith('prod');
    component.handleClosed();
    expect(closedSpy).toHaveBeenCalled();
    expect(component.product).toBeNull();
  });

  it('selects the first variant when the chosen id is unknown', () => {
    catalog.getProduct.and.returnValue(
      of(
        makeProduct({
          stock_quantity: 5,
          variants: [
            { id: 'v1', name: 'A', stock_quantity: 3 },
            { id: 'v2', name: 'B', stock_quantity: 4 },
          ],
        }),
      ),
    );
    openWith('prod');
    component.selectedVariantId = 'does-not-exist';
    component.addToCart();
    expect(cart.addFromProduct).toHaveBeenCalledWith(
      jasmine.objectContaining({ variant_id: 'v1' }),
    );
  });

  it('uses product-level stock and image when adding a no-variant product', () => {
    catalog.getProduct.and.returnValue(
      of(makeProduct({ stock_quantity: 7, images: [{ url: '/only.png', sort_order: 0 }] })),
    );
    openWith('prod');
    component.quantity = NaN as unknown as number;
    component.addToCart();
    expect(cart.addFromProduct).toHaveBeenCalledWith(
      jasmine.objectContaining({ quantity: 1, variant_id: null, stock: 7, image: '/only.png' }),
    );
  });

  it('coerces a non-finite variant stock to the default when adding', () => {
    catalog.getProduct.and.returnValue(
      of(
        makeProduct({
          variants: [{ id: 'v1', name: 'A', stock_quantity: Infinity as unknown as number }],
        }),
      ),
    );
    openWith('prod');
    component.selectedVariantId = 'v1';
    component.addToCart();
    expect(cart.addFromProduct).toHaveBeenCalledWith(jasmine.objectContaining({ stock: 99 }));
  });

  it('handles products whose images field is not an array', () => {
    catalog.getProduct.and.returnValue(of(makeProduct({ images: undefined as unknown as [] })));
    openWith('prod');
    expect(component.activeImageUrl()).toContain('placeholder');
  });
});
