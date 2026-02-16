import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Meta, Title } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ReplaySubject, of } from 'rxjs';

import { ProductComponent } from './product.component';
import { ToastService } from '../../core/toast.service';
import { CartStore } from '../../core/cart.store';
import { CatalogService } from '../../core/catalog.service';
import { RecentlyViewedService } from '../../core/recently-viewed.service';
import { WishlistService } from '../../core/wishlist.service';
import { AuthService } from '../../core/auth.service';

describe('ProductComponent', () => {
  let toast: jasmine.SpyObj<ToastService>;
  let cart: jasmine.SpyObj<CartStore>;
  let catalog: jasmine.SpyObj<CatalogService>;
  let auth: jasmine.SpyObj<AuthService>;
  let routeParam$: ReplaySubject<any>;

  beforeEach(() => {
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);
    cart = jasmine.createSpyObj<CartStore>('CartStore', ['addFromProduct']);
    catalog = jasmine.createSpyObj<CatalogService>('CatalogService', [
      'requestBackInStock',
      'getProduct',
      'getUpsellProducts',
      'getRelatedProducts',
    ]);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['isAuthenticated', 'isAdmin', 'isImpersonating']);
    auth.isAdmin.and.returnValue(false);
    auth.isImpersonating.and.returnValue(false);
    routeParam$ = new ReplaySubject(1);
    routeParam$.next(convertToParamMap({ slug: 'prod' }));
    catalog.getUpsellProducts.and.returnValue(of([] as any));
    catalog.getRelatedProducts.and.returnValue(of([] as any));

    TestBed.configureTestingModule({
      imports: [RouterTestingModule.withRoutes([]), ProductComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ToastService, useValue: toast },
        { provide: CartStore, useValue: cart },
        { provide: CatalogService, useValue: catalog },
        { provide: AuthService, useValue: auth },
        { provide: RecentlyViewedService, useValue: { add: () => [] } },
        { provide: WishlistService, useValue: { ensureLoaded: () => {}, isWishlisted: () => false } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ slug: 'prod' }) },
            paramMap: routeParam$.asObservable()
          }
        },
        { provide: Title, useValue: jasmine.createSpyObj<Title>('Title', ['setTitle']) },
        { provide: Meta, useValue: jasmine.createSpyObj<Meta>('Meta', ['updateTag']) },
        { provide: DOCUMENT, useValue: document }
      ]
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        product: {
          soldOut: 'Sold out',
          notifyBackInStock: 'Notify me',
          notifyRequestedTitle: 'Requested',
          notifyRequestedBody: 'We will email you',
          loadErrorTitle: 'Error',
          loadErrorCopy: 'Error',
          notifyRequiresSignInTitle: 'Sign in',
          notifyRequiresSignInBody: 'Sign in',
          notifyCanceledTitle: 'Canceled',
          notifyCanceledBody: 'Canceled',
          addedTitle: 'Added',
          addedBody: 'Added'
        }
      },
      true
    );
    translate.use('en');
  });

  afterEach(() => {
    document.querySelector('link[rel="canonical"]')?.remove();
    document.querySelectorAll('link[rel="alternate"][data-seo-managed="true"]').forEach((el) => el.remove());
    document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => el.remove());
  });

  it('adds to cart and shows toast when in stock', () => {
    const cmp = TestBed.createComponent(ProductComponent).componentInstance;
    cmp.product = {
      id: 'p1',
      slug: 'p1',
      name: 'Product',
      base_price: 25,
      currency: 'RON',
      stock_quantity: 5,
      images: [{ url: '/img.png' }],
    } as any;
    cmp.addToCart();

    expect(cart.addFromProduct).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it('includes selected variant when adding to cart', () => {
    const cmp = TestBed.createComponent(ProductComponent).componentInstance;
    cmp.product = {
      id: 'p1',
      slug: 'p1',
      name: 'Product',
      base_price: 25,
      currency: 'RON',
      stock_quantity: 5,
      variants: [{ id: 'v1', name: 'Small', stock_quantity: 3 }],
      images: [{ url: '/img.png' }],
    } as any;
    cmp.selectedVariantId = 'v1';

    cmp.addToCart();

    expect(cart.addFromProduct).toHaveBeenCalledWith(jasmine.objectContaining({ variant_id: 'v1' }));
  });

  it('requests back-in-stock when out of stock and signed in', () => {
    auth.isAuthenticated.and.returnValue(true);
    catalog.requestBackInStock.and.returnValue(of({ id: 'r1', created_at: '2000-01-01T00:00:00+00:00' } as any));

    const cmp = TestBed.createComponent(ProductComponent).componentInstance;
    cmp.product = {
      id: 'p1',
      slug: 'p1',
      name: 'Product',
      base_price: 25,
      currency: 'RON',
      stock_quantity: 0,
      allow_backorder: false,
      images: []
    } as any;

    cmp.requestBackInStock();

    expect(catalog.requestBackInStock).toHaveBeenCalledWith('p1');
    expect(cmp.backInStockRequest?.id).toBe('r1');
    expect(toast.success).toHaveBeenCalled();
  });

  it('sets canonical and alternate links for product detail', () => {
    catalog.getProduct.and.returnValue(
      of({
        id: 'prod',
        slug: 'prod',
        name: 'Product',
        base_price: 42,
        currency: 'RON',
        stock_quantity: 3,
        images: []
      } as any)
    );

    const fixture = TestBed.createComponent(ProductComponent);
    fixture.detectChanges();

    const canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    expect(canonical?.getAttribute('href')).toContain('/products/prod?lang=en');
    expect(document.querySelectorAll('link[rel="alternate"][data-seo-managed="true"]').length).toBe(3);
  });

  it('ignores stale product loads when navigating quickly between slugs', () => {
    const productA = { id: 'a', slug: 'a', name: 'A', base_price: 10, currency: 'RON', stock_quantity: 1, images: [] } as any;
    const productB = { id: 'b', slug: 'b', name: 'B', base_price: 12, currency: 'RON', stock_quantity: 1, images: [] } as any;

    const productA$ = new ReplaySubject<any>(1);
    const productB$ = new ReplaySubject<any>(1);

    catalog.getProduct.and.callFake((slug: string) => {
      if (slug === 'a') return productA$.asObservable();
      if (slug === 'b') return productB$.asObservable();
      return productB$.asObservable();
    });

    routeParam$.next(convertToParamMap({ slug: 'a' }));
    const cmp = TestBed.createComponent(ProductComponent).componentInstance;
    cmp.ngOnInit();

    routeParam$.next(convertToParamMap({ slug: 'b' }));

    productB$.next(productB);
    expect(cmp.product?.slug).toBe('b');

    productA$.next(productA);
    expect(cmp.product?.slug).toBe('b');
  });
});
