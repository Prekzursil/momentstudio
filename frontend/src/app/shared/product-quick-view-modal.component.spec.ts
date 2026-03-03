import { ChangeDetectorRef, SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { CartStore } from '../core/cart.store';
import { CatalogService } from '../core/catalog.service';
import { ToastService } from '../core/toast.service';
import { ProductQuickViewModalComponent } from './product-quick-view-modal.component';

describe('ProductQuickViewModalComponent', () => {
  let catalog: jasmine.SpyObj<CatalogService>;
  let cart: jasmine.SpyObj<CartStore>;
  let toast: jasmine.SpyObj<ToastService>;
  let cdr: jasmine.SpyObj<ChangeDetectorRef>;

  beforeEach(() => {
    catalog = jasmine.createSpyObj<CatalogService>('CatalogService', ['getProduct']);
    cart = jasmine.createSpyObj<CartStore>('CartStore', ['addFromProduct']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success']);
    cdr = jasmine.createSpyObj<ChangeDetectorRef>('ChangeDetectorRef', ['detectChanges']);

    TestBed.configureTestingModule({
      imports: [ProductQuickViewModalComponent, TranslateModule.forRoot()],
      providers: [
        { provide: CatalogService, useValue: catalog },
        { provide: CartStore, useValue: cart },
        { provide: ToastService, useValue: toast },
        { provide: ChangeDetectorRef, useValue: cdr },
      ],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        shop: { quickView: 'Quick view' },
        product: {
          notFound: 'Product missing',
          loadErrorCopy: 'Could not load product',
          addedTitle: 'Added',
          addedBody: 'Item added',
        },
      },
      true
    );
    translate.use('en');
  });

  it('handles missing slug and API error branches', () => {
    const fixture = TestBed.createComponent(ProductQuickViewModalComponent);
    const component = fixture.componentInstance;

    component.open = true;
    component.slug = '   ';
    component.ngOnChanges({
      open: new SimpleChange(false, true, false),
      slug: new SimpleChange('', '   ', false),
    });

    expect(component.error).toBe('Product missing');
    expect(component.product).toBeNull();

    catalog.getProduct.and.returnValue(throwError(() => new Error('x')));
    component.slug = 'ring';
    component.ngOnChanges({ slug: new SimpleChange('   ', 'ring', false) });

    expect(component.loading).toBeFalse();
    expect(component.error).toBe('Could not load product');
    expect(component.product).toBeNull();
  });

  it('loads product data, sorts images, and maps active/selected defaults', () => {
    const fixture = TestBed.createComponent(ProductQuickViewModalComponent);
    const component = fixture.componentInstance;

    catalog.getProduct.and.returnValue(
      of({
        id: 'p-1',
        slug: 'ring',
        name: 'Ring',
        base_price: 120,
        sale_price: 95,
        currency: 'RON',
        stock_quantity: 4,
        allow_backorder: false,
        images: [
          { url: '/z.jpg', sort_order: 20 },
          { url: '/a.jpg', sort_order: 1 },
        ],
        variants: [
          { id: 'v-1', name: 'S', stock_quantity: 1 },
          { id: 'v-2', name: 'M', stock_quantity: 0 },
        ],
      } as any)
    );

    component.open = true;
    component.slug = 'ring';
    component.ngOnChanges({ open: new SimpleChange(false, true, false) });

    expect(component.loading).toBeFalse();
    expect(component.error).toBe('');
    expect(component.product?.images?.[0]?.url).toBe('/a.jpg');
    expect(component.selectedVariantId).toBe('v-1');
    expect(component.activeImageUrl()).toBe('/a.jpg');
    expect(component.title()).toBe('Ring');
    expect(component.isOnSale(component.product as any)).toBeTrue();
    expect(component.displayPrice(component.product as any)).toBe(95);
  });

  it('covers out-of-stock checks and addToCart guards/success path', () => {
    const fixture = TestBed.createComponent(ProductQuickViewModalComponent);
    const component = fixture.componentInstance;

    component.product = {
      id: 'p-2',
      slug: 'bracelet',
      name: 'Bracelet',
      base_price: 80,
      sale_price: null,
      currency: 'RON',
      stock_quantity: 0,
      allow_backorder: false,
      images: [{ url: '/img.jpg' }],
      variants: [{ id: 'v-2', name: 'M', stock_quantity: 0 }],
    } as any;
    component.selectedVariantId = 'v-2';

    expect(component.isOutOfStock()).toBeTrue();
    component.addToCart();
    expect(cart.addFromProduct).not.toHaveBeenCalled();

    component.product.allow_backorder = true;
    component.quantity = 3;
    component.addToCart();

    expect(cart.addFromProduct).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    const payload = cart.addFromProduct.calls.mostRecent().args[0];
    expect(payload.product_id).toBe('p-2');
    expect(payload.quantity).toBe(3);
    expect(payload.slug).toBe('bracelet');
  });

  it('emits view/closed events and resets transient state on close', () => {
    const fixture = TestBed.createComponent(ProductQuickViewModalComponent);
    const component = fixture.componentInstance;
    const viewSpy = spyOn(component.view, 'emit').and.callThrough();
    const closeSpy = spyOn(component.closed, 'emit').and.callThrough();

    component.open = true;
    component.slug = 'ring';
    component.product = {
      id: 'p-3',
      slug: 'ring',
      name: 'Ring',
      base_price: 100,
      currency: 'RON',
      stock_quantity: 2,
      images: [{ url: '/a.jpg' }],
    } as any;

    component.viewDetails();
    expect(viewSpy).toHaveBeenCalledWith('ring');
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(component.product).toBeNull();
    expect(component.selectedVariantId).toBeNull();
    expect(component.quantity).toBe(1);

    component.retry();
    expect(catalog.getProduct).not.toHaveBeenCalled();
  });
});
