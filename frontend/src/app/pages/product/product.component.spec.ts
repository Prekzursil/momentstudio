import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

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
  let router: jasmine.SpyObj<Router>;

  beforeEach(() => {
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);
    cart = jasmine.createSpyObj<CartStore>('CartStore', ['addFromProduct']);
    catalog = jasmine.createSpyObj<CatalogService>('CatalogService', ['requestBackInStock']);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['isAuthenticated']);
    router = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);

    TestBed.configureTestingModule({
      imports: [ProductComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ToastService, useValue: toast },
        { provide: CartStore, useValue: cart },
        { provide: CatalogService, useValue: catalog },
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
        { provide: RecentlyViewedService, useValue: { add: () => [] } },
        { provide: WishlistService, useValue: { ensureLoaded: () => {}, isWishlisted: () => false } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'prod' } } } },
        { provide: Title, useValue: jasmine.createSpyObj<Title>('Title', ['setTitle']) },
        { provide: Meta, useValue: jasmine.createSpyObj<Meta>('Meta', ['updateTag']) },
        { provide: DOCUMENT, useValue: document.implementation.createHTMLDocument('product-test') }
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
});
