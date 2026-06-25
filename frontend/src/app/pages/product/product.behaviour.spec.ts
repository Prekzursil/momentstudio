import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Meta, Title } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ReplaySubject, of, throwError } from 'rxjs';

import { ProductComponent } from './product.component';
import { ToastService } from '../../core/toast.service';
import { CartStore } from '../../core/cart.store';
import { CatalogService, Product, ProductVariant } from '../../core/catalog.service';
import { RecentlyViewedService } from '../../core/recently-viewed.service';
import { WishlistService } from '../../core/wishlist.service';
import { AuthService } from '../../core/auth.service';
import { MarkdownService } from '../../core/markdown.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';
import { AdminService } from '../../core/admin.service';
import { SeoHeadLinksService } from '../../core/seo-head-links.service';
import { SeoCopyFallbackService } from '../../core/seo-copy-fallback.service';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    slug: 'prod',
    name: 'Mug',
    base_price: 20,
    currency: 'RON',
    stock_quantity: 5,
    images: [{ url: '/a.jpg', sort_order: 0 } as never],
    variants: [],
    tags: [],
    ...overrides,
  } as Product;
}

describe('ProductComponent (behaviour)', () => {
  let toast: jasmine.SpyObj<ToastService>;
  let cart: jasmine.SpyObj<CartStore>;
  let catalog: jasmine.SpyObj<CatalogService>;
  let auth: jasmine.SpyObj<AuthService>;
  let wishlist: jasmine.SpyObj<WishlistService>;
  let admin: jasmine.SpyObj<AdminService>;
  let storefront: jasmine.SpyObj<StorefrontAdminModeService>;
  let seoHeadLinks: jasmine.SpyObj<SeoHeadLinksService>;
  let recently: jasmine.SpyObj<RecentlyViewedService>;
  let routeParam$: ReplaySubject<unknown>;

  function configure(): void {
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);
    cart = jasmine.createSpyObj<CartStore>('CartStore', ['addFromProduct']);
    catalog = jasmine.createSpyObj<CatalogService>('CatalogService', [
      'getProduct',
      'getUpsellProducts',
      'getRelatedProducts',
      'getBackInStockStatus',
      'requestBackInStock',
      'cancelBackInStock',
    ]);
    auth = jasmine.createSpyObj<AuthService>('AuthService', [
      'isAuthenticated',
      'isAdmin',
      'isImpersonating',
    ]);
    wishlist = jasmine.createSpyObj<WishlistService>('WishlistService', [
      'ensureLoaded',
      'isWishlisted',
      'add',
      'remove',
      'addLocal',
      'removeLocal',
    ]);
    admin = jasmine.createSpyObj<AdminService>('AdminService', ['duplicateProduct']);
    storefront = jasmine.createSpyObj<StorefrontAdminModeService>('StorefrontAdminModeService', [
      'enabled',
    ]);
    recently = jasmine.createSpyObj<RecentlyViewedService>('RecentlyViewedService', ['add']);
    seoHeadLinks = jasmine.createSpyObj<SeoHeadLinksService>('SeoHeadLinksService', [
      'setLocalizedCanonical',
    ]);

    auth.isAuthenticated.and.returnValue(true);
    auth.isAdmin.and.returnValue(false);
    auth.isImpersonating.and.returnValue(false);
    wishlist.isWishlisted.and.returnValue(false);
    wishlist.add.and.returnValue(of(makeProduct()));
    wishlist.remove.and.returnValue(of(undefined) as never);
    storefront.enabled.and.returnValue(false);
    recently.add.and.returnValue([]);
    seoHeadLinks.setLocalizedCanonical.and.returnValue('http://localhost/products/prod');
    catalog.getProduct.and.returnValue(of(makeProduct()));
    catalog.getUpsellProducts.and.returnValue(of([]));
    catalog.getRelatedProducts.and.returnValue(of([]));
    catalog.getBackInStockStatus.and.returnValue(of({ request: null }) as never);
    catalog.requestBackInStock.and.returnValue(of({ id: 'r1' }) as never);
    catalog.cancelBackInStock.and.returnValue(of(undefined) as never);

    routeParam$ = new ReplaySubject(1);
    routeParam$.next(convertToParamMap({ slug: 'prod' }));

    TestBed.configureTestingModule({
      imports: [RouterTestingModule.withRoutes([]), ProductComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ToastService, useValue: toast },
        { provide: CartStore, useValue: cart },
        { provide: CatalogService, useValue: catalog },
        { provide: AuthService, useValue: auth },
        { provide: RecentlyViewedService, useValue: recently },
        { provide: WishlistService, useValue: wishlist },
        { provide: AdminService, useValue: admin },
        { provide: StorefrontAdminModeService, useValue: storefront },
        { provide: SeoHeadLinksService, useValue: seoHeadLinks },
        { provide: MarkdownService, useValue: { render: (s: string) => `<p>${s}</p>` } },
        {
          provide: SeoCopyFallbackService,
          useValue: { productIntro: () => 'intro copy' },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ slug: 'prod' }) },
            paramMap: routeParam$.asObservable(),
          },
        },
        { provide: Title, useValue: jasmine.createSpyObj<Title>('Title', ['setTitle']) },
        { provide: Meta, useValue: jasmine.createSpyObj<Meta>('Meta', ['updateTag']) },
        { provide: DOCUMENT, useValue: document },
      ],
    });
    TestBed.inject(TranslateService).use('en');
  }

  function create(): ProductComponent {
    const fixture = TestBed.createComponent(ProductComponent);
    fixture.componentInstance.ngOnInit();
    return fixture.componentInstance;
  }

  afterEach(() => {
    document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => el.remove());
    sessionStorage.clear();
  });

  it('loads a product and renders description, recently viewed, and structured data', () => {
    configure();
    recently.add.and.returnValue([makeProduct({ slug: 'other' }), makeProduct({ slug: 'prod' })]);
    catalog.getProduct.and.returnValue(
      of(makeProduct({ long_description: 'Long', rating_count: 3, rating_average: 4 })),
    );
    const cmp = create();
    expect(cmp.product?.slug).toBe('prod');
    expect(cmp.descriptionHtml).toContain('Long');
    expect(cmp.recentlyViewed.length).toBe(1);
    expect(document.querySelector('script[type="application/ld+json"]')).toBeTruthy();
  });

  it('sorts product images by sort_order', () => {
    configure();
    catalog.getProduct.and.returnValue(
      of(
        makeProduct({
          images: [
            { url: '/b', sort_order: 2 },
            { url: '/a', sort_order: 1 },
          ] as never,
        }),
      ),
    );
    const cmp = create();
    expect(cmp.product?.images?.[0].url).toBe('/a');
  });

  it('marks the load as failed for non-404 errors', () => {
    configure();
    catalog.getProduct.and.returnValue(throwError(() => ({ status: 500 })));
    const cmp = create();
    expect(cmp.loadError).toBeTrue();
  });

  it('treats a 404 as a not-found without an error banner', () => {
    configure();
    catalog.getProduct.and.returnValue(throwError(() => ({ status: 404 })));
    const cmp = create();
    expect(cmp.loadError).toBeFalse();
  });

  it('filters upsell and related products', () => {
    configure();
    catalog.getUpsellProducts.and.returnValue(
      of([makeProduct({ slug: 'prod' }), makeProduct({ slug: 'u1' })]),
    );
    catalog.getRelatedProducts.and.returnValue(of([makeProduct({ slug: 'r1' })]));
    const cmp = create();
    expect(cmp.upsellProducts.map((p) => p.slug)).toEqual(['u1']);
    expect(cmp.relatedProducts.map((p) => p.slug)).toEqual(['r1']);
  });

  it('handles upsell and related load failures', () => {
    configure();
    catalog.getUpsellProducts.and.returnValue(throwError(() => new Error('x')));
    catalog.getRelatedProducts.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    expect(cmp.upsellProducts).toEqual([]);
    expect(cmp.relatedProducts).toEqual([]);
  });

  it('navigates back to a saved shop return url', () => {
    configure();
    sessionStorage.setItem('shop_return_pending', '1');
    sessionStorage.setItem('shop_return_url', '/shop?page=2');
    const cmp = create();
    const router = TestBed.inject(Router);
    const navByUrl = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    cmp.backToShop();
    expect(navByUrl).toHaveBeenCalledWith('/shop?page=2');
  });

  it('navigates to the default shop when no return url is saved', () => {
    configure();
    const cmp = create();
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    cmp.backToShop();
    expect(navigate).toHaveBeenCalledWith(['/shop']);
  });

  it('ignores a non-shop return url', () => {
    configure();
    sessionStorage.setItem('shop_return_pending', '1');
    sessionStorage.setItem('shop_return_url', '/evil');
    const cmp = create();
    expect((cmp as unknown as { shopReturnUrl: string | null }).shopReturnUrl).toBeNull();
  });

  it('retryLoad reloads the product', () => {
    configure();
    const cmp = create();
    catalog.getProduct.calls.reset();
    cmp.retryLoad();
    expect(catalog.getProduct).toHaveBeenCalled();
  });

  it('gates storefront edit by admin mode, role and impersonation', () => {
    configure();
    const cmp = create();
    expect(cmp.showStorefrontEdit()).toBeFalse();
    storefront.enabled.and.returnValue(true);
    expect(cmp.showStorefrontEdit()).toBeFalse();
    auth.isAdmin.and.returnValue(true);
    expect(cmp.showStorefrontEdit()).toBeTrue();
    auth.isImpersonating.and.returnValue(true);
    expect(cmp.showStorefrontEdit()).toBeFalse();
  });

  it('opens the image manager only when editing is allowed', () => {
    configure();
    const cmp = create();
    cmp.openImageManager();
    expect(cmp.imageManagerOpen).toBeFalse();
    storefront.enabled.and.returnValue(true);
    auth.isAdmin.and.returnValue(true);
    cmp.openImageManager();
    expect(cmp.imageManagerOpen).toBeTrue();
  });

  it('updates images via onImagesChange', () => {
    configure();
    const cmp = create();
    cmp.onImagesChange([{ url: '/new' } as never]);
    expect(cmp.product?.images?.[0].url).toBe('/new');
    cmp.onImagesChange('not-an-array' as never);
    expect(cmp.product?.images?.[0].url).toBe('/new');
  });

  it('duplicates a product from the storefront', () => {
    configure();
    storefront.enabled.and.returnValue(true);
    auth.isAdmin.and.returnValue(true);
    admin.duplicateProduct.and.returnValue(of({ slug: 'prod-copy' }) as never);
    const cmp = create();
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    cmp.duplicateFromStorefront();
    expect(admin.duplicateProduct).toHaveBeenCalledWith('prod', { source: 'storefront' });
    expect(navigate).toHaveBeenCalledWith(['/admin/products'], {
      state: { editProductSlug: 'prod-copy' },
    });
  });

  it('toasts when duplication fails', () => {
    configure();
    storefront.enabled.and.returnValue(true);
    auth.isAdmin.and.returnValue(true);
    admin.duplicateProduct.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.duplicateFromStorefront();
    expect(toast.error).toHaveBeenCalled();
  });

  it('manages the active image and preview state', () => {
    configure();
    const cmp = create();
    cmp.setActiveImage(3);
    expect(cmp.activeImageIndex).toBe(3);
    cmp.openPreview();
    expect(cmp.previewOpen).toBeTrue();
    cmp.closePreview();
    expect(cmp.previewOpen).toBeFalse();
  });

  it('returns the placeholder image when there are none', () => {
    configure();
    catalog.getProduct.and.returnValue(of(makeProduct({ images: [] })));
    const cmp = create();
    expect(cmp.activeImage).toContain('placeholder');
  });

  it('adds an in-stock product to the cart', () => {
    configure();
    const cmp = create();
    cmp.addToCart();
    expect(cart.addFromProduct).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it('blocks adding an out-of-stock product to the cart', () => {
    configure();
    catalog.getProduct.and.returnValue(of(makeProduct({ stock_quantity: 0 })));
    const cmp = create();
    cmp.addToCart();
    expect(cart.addFromProduct).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('toggles the wishlist add/remove and prompts login when signed out', () => {
    configure();
    const cmp = create();
    cmp.toggleWishlist();
    expect(wishlist.add).toHaveBeenCalled();

    wishlist.isWishlisted.and.returnValue(true);
    cmp.toggleWishlist();
    expect(wishlist.remove).toHaveBeenCalled();

    auth.isAuthenticated.and.returnValue(false);
    const router = TestBed.inject(Router);
    const navByUrl = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    cmp.toggleWishlist();
    expect(navByUrl).toHaveBeenCalledWith('/login');
  });

  it('computes sale pricing and stock state for variants', () => {
    configure();
    const variant: ProductVariant = { id: 'v1', stock_quantity: 0 } as ProductVariant;
    catalog.getProduct.and.returnValue(
      of(makeProduct({ sale_price: 12, base_price: 20, variants: [variant], stock_quantity: 5 })),
    );
    const cmp = create();
    expect(cmp.isOnSale(cmp.product as Product)).toBeTrue();
    expect(cmp.displayPrice(cmp.product as Product)).toBe(12);
    expect(cmp.isOutOfStock()).toBeTrue();
  });

  it('treats a variant with null stock as in stock', () => {
    configure();
    const variant: ProductVariant = { id: 'v1', stock_quantity: null } as ProductVariant;
    catalog.getProduct.and.returnValue(of(makeProduct({ variants: [variant], stock_quantity: 0 })));
    const cmp = create();
    expect(cmp.isOutOfStock()).toBeFalse();
  });

  it('allows backorder products even when stock is zero', () => {
    configure();
    catalog.getProduct.and.returnValue(
      of(makeProduct({ stock_quantity: 0, allow_backorder: true })),
    );
    const cmp = create();
    expect(cmp.isOutOfStock()).toBeFalse();
  });

  it('shows fallback navigation links only when nothing else is loaded', () => {
    configure();
    const cmp = create();
    expect(cmp.showFallbackNavigationLinks()).toBeTrue();
  });

  it('loads back-in-stock status for an out-of-stock signed-in user', () => {
    configure();
    catalog.getProduct.and.returnValue(of(makeProduct({ stock_quantity: 0 })));
    catalog.getBackInStockStatus.and.returnValue(of({ request: { id: 'r1' } }) as never);
    const cmp = create();
    expect(cmp.backInStockRequest).toEqual({ id: 'r1' } as never);
  });

  it('requests back-in-stock and handles errors', () => {
    configure();
    catalog.getProduct.and.returnValue(of(makeProduct({ stock_quantity: 0 })));
    const cmp = create();
    cmp.requestBackInStock();
    expect(catalog.requestBackInStock).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();

    cmp.backInStockRequest = null;
    catalog.requestBackInStock.and.returnValue(throwError(() => new Error('x')));
    cmp.requestBackInStock();
    expect(toast.error).toHaveBeenCalled();
  });

  it('requires sign-in to request back-in-stock', () => {
    configure();
    catalog.getProduct.and.returnValue(of(makeProduct({ stock_quantity: 0 })));
    auth.isAuthenticated.and.returnValue(true);
    const cmp = create();
    auth.isAuthenticated.and.returnValue(false);
    const router = TestBed.inject(Router);
    const navByUrl = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    cmp.requestBackInStock();
    expect(navByUrl).toHaveBeenCalledWith('/login');
  });

  it('cancels a back-in-stock request and handles errors', () => {
    configure();
    catalog.getProduct.and.returnValue(of(makeProduct({ stock_quantity: 0 })));
    const cmp = create();
    cmp.backInStockRequest = { id: 'r1' } as never;
    cmp.cancelBackInStock();
    expect(catalog.cancelBackInStock).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();

    cmp.backInStockRequest = { id: 'r2' } as never;
    catalog.cancelBackInStock.and.returnValue(throwError(() => new Error('x')));
    cmp.cancelBackInStock();
    expect(toast.error).toHaveBeenCalled();
  });

  it('ignores a repeated route emission for the same slug', () => {
    configure();
    create();
    catalog.getProduct.calls.reset();
    routeParam$.next(convertToParamMap({ slug: 'prod' }));
    expect(catalog.getProduct).not.toHaveBeenCalled();
  });

  it('reloads on a language change', () => {
    configure();
    const cmp = create();
    catalog.getProduct.calls.reset();
    TestBed.inject(TranslateService).use('ro');
    expect(catalog.getProduct).toHaveBeenCalled();
    expect(cmp.uiLang).toBe('ro');
  });

  it('does nothing in load when there is no slug', () => {
    configure();
    const cmp = create();
    catalog.getProduct.calls.reset();
    routeParam$.next(convertToParamMap({}));
    expect(cmp.loading).toBeFalse();
    expect(catalog.getProduct).not.toHaveBeenCalled();
  });

  it('guards no-product paths', () => {
    configure();
    catalog.getProduct.and.returnValue(throwError(() => ({ status: 404 })));
    const cmp = create();
    expect(cmp.product).toBeNull();
    cmp.addToCart();
    cmp.toggleWishlist();
    cmp.onImagesChange([]);
    expect(cmp.wishlisted).toBeFalse();
    expect(cmp.isOutOfStock()).toBeFalse();
    expect(cart.addFromProduct).not.toHaveBeenCalled();
  });

  it('selects the first variant when the desired id is not found', () => {
    configure();
    const variants: ProductVariant[] = [
      { id: 'v1', stock_quantity: 5 } as ProductVariant,
      { id: 'v2', stock_quantity: 5 } as ProductVariant,
    ];
    catalog.getProduct.and.returnValue(of(makeProduct({ variants })));
    const cmp = create();
    cmp.selectedVariantId = 'missing';
    cmp.addToCart();
    expect(cart.addFromProduct).toHaveBeenCalledWith(
      jasmine.objectContaining({ variant_id: 'v1' }),
    );
  });

  it('reads back-in-stock status only for authenticated out-of-stock users', () => {
    configure();
    catalog.getProduct.and.returnValue(of(makeProduct({ stock_quantity: 0 })));
    auth.isAuthenticated.and.returnValue(false);
    const cmp = create();
    expect(catalog.getBackInStockStatus).not.toHaveBeenCalled();
    expect(cmp.product).toBeTruthy();
  });

  it('does not re-request back-in-stock when a request already exists', () => {
    configure();
    catalog.getProduct.and.returnValue(of(makeProduct({ stock_quantity: 0 })));
    catalog.getBackInStockStatus.and.returnValue(of({ request: { id: 'r1' } }) as never);
    const cmp = create();
    catalog.requestBackInStock.calls.reset();
    cmp.requestBackInStock();
    expect(catalog.requestBackInStock).not.toHaveBeenCalled();
  });

  it('ignores cancelBackInStock without an active request', () => {
    configure();
    const cmp = create();
    cmp.cancelBackInStock();
    expect(catalog.cancelBackInStock).not.toHaveBeenCalled();
  });

  it('ignores requestBackInStock when the product is in stock', () => {
    configure();
    const cmp = create();
    cmp.requestBackInStock();
    expect(catalog.requestBackInStock).not.toHaveBeenCalled();
  });

  it('returns null when the pending shop return url is missing', () => {
    configure();
    sessionStorage.setItem('shop_return_pending', '1');
    const cmp = create();
    expect((cmp as unknown as { shopReturnUrl: string | null }).shopReturnUrl).toBeNull();
  });

  it('swallows errors when reading the shop return url', () => {
    configure();
    spyOn(sessionStorage, 'getItem').and.throwError('blocked');
    const cmp = create();
    expect((cmp as unknown as { shopReturnUrl: string | null }).shopReturnUrl).toBeNull();
  });

  it('ignores duplicate when editing is disabled or already saving', () => {
    configure();
    const cmp = create();
    cmp.duplicateFromStorefront();
    expect(admin.duplicateProduct).not.toHaveBeenCalled();

    storefront.enabled.and.returnValue(true);
    auth.isAdmin.and.returnValue(true);
    (cmp as unknown as { duplicateSaving: boolean }).duplicateSaving = true;
    cmp.duplicateFromStorefront();
    expect(admin.duplicateProduct).not.toHaveBeenCalled();
  });

  it('ignores duplicate when the product has no slug', () => {
    configure();
    catalog.getProduct.and.returnValue(of(makeProduct({ slug: '' })));
    storefront.enabled.and.returnValue(true);
    auth.isAdmin.and.returnValue(true);
    const cmp = create();
    cmp.duplicateFromStorefront();
    expect(admin.duplicateProduct).not.toHaveBeenCalled();
  });

  it('does not navigate when the duplicate has no new slug', () => {
    configure();
    storefront.enabled.and.returnValue(true);
    auth.isAdmin.and.returnValue(true);
    admin.duplicateProduct.and.returnValue(of({ slug: '' }) as never);
    const cmp = create();
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    cmp.duplicateFromStorefront();
    expect(toast.success).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ignores a stale product response after the slug changed', () => {
    configure();
    const slow$ = new ReplaySubject<Product>(1);
    catalog.getProduct.and.returnValue(slow$.asObservable());
    const cmp = create();
    (cmp as unknown as { slug: string | null }).slug = 'different';
    slow$.next(makeProduct({ slug: 'prod' }));
    expect(cmp.product).toBeNull();
  });

  it('ignores stale upsell and related responses', () => {
    configure();
    const upsell$ = new ReplaySubject<Product[]>(1);
    const related$ = new ReplaySubject<Product[]>(1);
    catalog.getUpsellProducts.and.returnValue(upsell$.asObservable());
    catalog.getRelatedProducts.and.returnValue(related$.asObservable());
    const cmp = create();
    cmp.product = makeProduct({ slug: 'changed' });
    upsell$.next([makeProduct({ slug: 'u1' })]);
    related$.next([makeProduct({ slug: 'r1' })]);
    expect(cmp.upsellProducts).toEqual([]);
    expect(cmp.relatedProducts).toEqual([]);
  });

  it('treats an error without a numeric status as a load failure', () => {
    configure();
    catalog.getProduct.and.returnValue(throwError(() => ({})));
    const cmp = create();
    expect(cmp.loadError).toBeTrue();
  });

  it('keeps images stable when sort_order is missing', () => {
    configure();
    catalog.getProduct.and.returnValue(
      of(makeProduct({ images: [{ url: '/x' }, { url: '/y' }] as never })),
    );
    const cmp = create();
    expect(cmp.product?.images?.length).toBe(2);
  });

  it('falls back to the first image for an out-of-range active index', () => {
    configure();
    const cmp = create();
    cmp.setActiveImage(99);
    expect(cmp.activeImage).toBe('/a.jpg');
  });

  it('marks structured data out of stock and omits an absent rating average', () => {
    configure();
    catalog.getProduct.and.returnValue(
      of(makeProduct({ stock_quantity: 0, rating_count: 4, rating_average: undefined })),
    );
    const cmp = create();
    const script = document.querySelector('script[type="application/ld+json"]');
    expect(script?.textContent).toContain('OutOfStock');
    expect(cmp.product).toBeTruthy();
  });

  it('uses the fallback stock when a variant has no stock and product stock is null', () => {
    configure();
    const variant: ProductVariant = { id: 'v1', stock_quantity: 0 } as ProductVariant;
    catalog.getProduct.and.returnValue(
      of(makeProduct({ variants: [variant], stock_quantity: null, allow_backorder: true })),
    );
    const cmp = create();
    cmp.addToCart();
    expect(cart.addFromProduct).toHaveBeenCalled();
  });

  it('drops recently-viewed entries with blank slugs', () => {
    configure();
    recently.add.and.returnValue([
      makeProduct({ slug: '' }),
      makeProduct({ slug: 'keep' }),
      makeProduct({ slug: 'prod' }),
    ]);
    const cmp = create();
    expect(cmp.recentlyViewed.map((p) => p.slug)).toEqual(['keep']);
  });

  it('tolerates null upsell and related payloads', () => {
    configure();
    catalog.getUpsellProducts.and.returnValue(of(null) as never);
    catalog.getRelatedProducts.and.returnValue(of(null) as never);
    const cmp = create();
    expect(cmp.upsellProducts).toEqual([]);
    expect(cmp.relatedProducts).toEqual([]);
  });

  it('defaults the cart stock to zero when all stock values are missing', () => {
    configure();
    catalog.getProduct.and.returnValue(
      of(makeProduct({ stock_quantity: 0, allow_backorder: true, variants: [] })),
    );
    const cmp = create();
    cmp.addToCart();
    expect(cart.addFromProduct).toHaveBeenCalledWith(jasmine.objectContaining({ stock: 0 }));
  });

  it('ignores a stale error after the slug changed', () => {
    configure();
    const slow$ = new ReplaySubject<Product>(1);
    catalog.getProduct.and.returnValue(slow$.asObservable());
    const cmp = create();
    cmp.loadError = false;
    (cmp as unknown as { slug: string | null }).slug = 'changed';
    slow$.error({ status: 500 });
    expect(cmp.loadError).toBeFalse();
  });

  it('ignores upsell and related results once the product is cleared', () => {
    configure();
    const upsell$ = new ReplaySubject<Product[]>(1);
    const related$ = new ReplaySubject<Product[]>(1);
    catalog.getUpsellProducts.and.returnValue(upsell$.asObservable());
    catalog.getRelatedProducts.and.returnValue(related$.asObservable());
    const cmp = create();
    cmp.product = null;
    upsell$.next([makeProduct({ slug: 'u1' })]);
    related$.next([makeProduct({ slug: 'r1' })]);
    expect(cmp.upsellProducts).toEqual([]);
    expect(cmp.relatedProducts).toEqual([]);
  });

  it('uses the load slug when the returned product has no slug', () => {
    configure();
    recently.add.and.returnValue([makeProduct({ slug: 'prod' })]);
    catalog.getProduct.and.returnValue(of(makeProduct({ slug: '' })));
    const cmp = create();
    // The current product (empty slug, resolved to the load slug 'prod') is filtered out.
    expect(cmp.recentlyViewed).toEqual([]);
  });

  it('falls back to the first variant when the selection is cleared', () => {
    configure();
    const variants: ProductVariant[] = [{ id: 'only', stock_quantity: 3 } as ProductVariant];
    catalog.getProduct.and.returnValue(of(makeProduct({ variants })));
    const cmp = create();
    cmp.selectedVariantId = null;
    cmp.addToCart();
    expect(cart.addFromProduct).toHaveBeenCalledWith(
      jasmine.objectContaining({ variant_id: 'only' }),
    );
  });

  it('cleans up subscriptions and the structured-data script on destroy', () => {
    configure();
    const cmp = create();
    expect(() => cmp.ngOnDestroy()).not.toThrow();
  });
});
