import { of, throwError } from 'rxjs';

import { ProductComponent } from './product.component';

function createHarness(): any {
  const cmp: any = Object.create(ProductComponent.prototype);
  cmp.product = null;
  cmp.loading = true;
  cmp.loadError = false;
  cmp.descriptionHtml = '';
  cmp.seoFallbackDescription = '';
  cmp.selectedVariantId = null;
  cmp.quantity = 2;
  cmp.activeImageIndex = 0;
  cmp.previewOpen = false;
  cmp.imageManagerOpen = false;
  cmp.backInStockLoading = false;
  cmp.duplicateSaving = false;
  cmp.backInStockRequest = null;
  cmp.upsellProducts = [];
  cmp.relatedProducts = [];
  cmp.recentlyViewed = [];
  cmp.shopReturnUrl = '/shop?saved=1';
  cmp.slug = 'ring-1';
  cmp.crumbs = [];
  cmp.ldScript = null;

  cmp.catalog = jasmine.createSpyObj('CatalogService', [
    'getBackInStockStatus',
    'requestBackInStock',
    'cancelBackInStock',
    'getUpsellProducts',
    'getRelatedProducts',
  ]);
  cmp.catalog.getBackInStockStatus.and.returnValue(of({ request: { id: 'req-1' } }));
  cmp.catalog.requestBackInStock.and.returnValue(of({ id: 'req-2' }));
  cmp.catalog.cancelBackInStock.and.returnValue(of({}));
  cmp.catalog.getUpsellProducts.and.returnValue(of([{ slug: 'other' }, { slug: 'ring-1' }]));
  cmp.catalog.getRelatedProducts.and.returnValue(of([{ slug: 'other-2' }, { slug: 'ring-1' }]));

  cmp.toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);
  cmp.title = jasmine.createSpyObj('Title', ['setTitle']);
  cmp.meta = jasmine.createSpyObj('Meta', ['updateTag']);
  cmp.cartStore = jasmine.createSpyObj('CartStore', ['addFromProduct']);
  cmp.recentlyViewedService = {
    add: jasmine.createSpy('add').and.returnValue([
      { slug: 'ring-1' },
      { slug: 'other-1' },
      { slug: 'other-2' },
    ]),
  };
  cmp.translate = {
    currentLang: 'en',
    instant: (key: string, params?: Record<string, unknown>) => {
      if (!params) return key;
      return `${key}:${Object.keys(params).join(',')}`;
    },
    onLangChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
  };
  cmp.markdown = { render: jasmine.createSpy('render').and.callFake((v: string) => `<p>${v}</p>`) };
  cmp.wishlist = jasmine.createSpyObj('WishlistService', ['isWishlisted', 'add', 'remove', 'addLocal', 'removeLocal']);
  cmp.wishlist.isWishlisted.and.returnValue(false);
  cmp.wishlist.add.and.returnValue(of({ id: 'p1' }));
  cmp.wishlist.remove.and.returnValue(of({}));
  cmp.auth = jasmine.createSpyObj('AuthService', ['isAuthenticated', 'isAdmin', 'isImpersonating']);
  cmp.auth.isAuthenticated.and.returnValue(true);
  cmp.auth.isAdmin.and.returnValue(true);
  cmp.auth.isImpersonating.and.returnValue(false);
  cmp.router = jasmine.createSpyObj('Router', ['navigateByUrl', 'navigate']);
  cmp.router.navigateByUrl.and.returnValue(Promise.resolve(true));
  cmp.router.navigate.and.returnValue(Promise.resolve(true));
  cmp.cdr = { detectChanges: jasmine.createSpy('detectChanges') };
  cmp.storefrontAdminMode = { enabled: jasmine.createSpy('enabled').and.returnValue(true) };
  cmp.admin = jasmine.createSpyObj('AdminService', ['duplicateProduct']);
  cmp.admin.duplicateProduct.and.returnValue(of({ slug: 'ring-1-copy' }));
  cmp.seoHeadLinks = {
    setLocalizedCanonical: jasmine.createSpy('setLocalizedCanonical').and.returnValue('https://momentstudio.test/products/ring-1')
  };
  cmp.seoCopyFallback = { productIntro: jasmine.createSpy('productIntro').and.returnValue('Fallback intro') };

  return cmp;
}

describe('ProductComponent fast navigation and duplicate helpers', () => {
  it('reads return URL, navigates back, and toggles storefront edit affordances', () => {
    const cmp = createHarness();
    spyOn(sessionStorage, 'getItem').and.callFake((key: string) => {
      if (key === 'shop_return_pending') return '1';
      if (key === 'shop_return_url') return '/shop?from=prod';
      return null;
    });
    expect(cmp['readShopReturnUrl']()).toBe('/shop?from=prod');

    cmp.backToShop();
    expect(cmp.router.navigateByUrl).toHaveBeenCalledWith('/shop?saved=1');

    cmp.product = { slug: 'ring-1' };
    expect(cmp.showStorefrontEdit()).toBeTrue();
    cmp.openImageManager();
    expect(cmp.imageManagerOpen).toBeTrue();
  });

  it('handles duplicateFromStorefront success and error flows', () => {
    const cmp = createHarness();
    cmp.product = { slug: 'ring-1' };

    cmp.duplicateFromStorefront();
    expect(cmp.admin.duplicateProduct).toHaveBeenCalledWith('ring-1', { source: 'storefront' });
    expect(cmp.toast.success).toHaveBeenCalled();

    cmp.admin.duplicateProduct.and.returnValue(throwError(() => new Error('x')));
    cmp.duplicateFromStorefront();
    expect(cmp.toast.error).toHaveBeenCalled();
  });
});

describe('ProductComponent fast duplicate-guard and load-state helpers', () => {
  it('covers duplicateFromStorefront guard clauses without firing API calls', () => {
    const cmp = createHarness();
    cmp.product = { slug: 'ring-1' };
    cmp.storefrontAdminMode.enabled.and.returnValue(false);
    cmp.duplicateFromStorefront();
    expect(cmp.admin.duplicateProduct).not.toHaveBeenCalled();

    cmp.storefrontAdminMode.enabled.and.returnValue(true);
    cmp.auth.isAdmin.and.returnValue(true);
    cmp.auth.isImpersonating.and.returnValue(false);
    cmp.product = { slug: '   ' };
    cmp.duplicateFromStorefront();
    expect(cmp.admin.duplicateProduct).not.toHaveBeenCalled();

    cmp.product = { slug: 'ring-1' };
    cmp.duplicateSaving = true;
    cmp.duplicateFromStorefront();
    expect(cmp.admin.duplicateProduct).not.toHaveBeenCalled();
  });

  it('sorts images and applies loaded product state helpers', () => {
    const cmp = createHarness();
    const product: any = {
      slug: 'ring-1',
      name: 'Ring',
      long_description: 'Long',
      tags: [{ name: 'Gem' }],
      variants: [{ id: 'v1' }],
      images: [{ url: 'b', sort_order: 2 }, { url: 'a', sort_order: 1 }],
    };

    cmp['sortProductImages'](product);
    expect(product.images[0].url).toBe('a');

    cmp['applyLoadedProductState'](product, 'en');
    expect(cmp.product.slug).toBe('ring-1');
    expect(cmp.descriptionHtml).toContain('<p>Long</p>');
    expect(cmp.seoFallbackDescription).toBe('Fallback intro');
    expect(cmp.selectedVariantId).toBe('v1');
    expect(cmp.loading).toBeFalse();
  });
});

describe('ProductComponent fast list refresh helpers', () => {
  it('refreshes recently viewed and loads upsells/related with self-filtering', () => {
    const cmp = createHarness();
    cmp.product = { slug: 'ring-1' };
    cmp['refreshRecentlyViewed']({ slug: 'ring-1' }, 'ring-1');
    expect(cmp.recentlyViewed.map((item: any) => item.slug)).toEqual(['other-1', 'other-2']);

    cmp['loadUpsells']('ring-1', 'en');
    expect(cmp.upsellProducts.map((item: any) => item.slug)).toEqual(['other']);

    cmp['loadRelated']('ring-1', 'en');
    expect(cmp.relatedProducts.map((item: any) => item.slug)).toEqual(['other-2']);
  });
});

describe('ProductComponent fast media and cart helpers', () => {
  it('covers image preview and sale/price helpers', () => {
    const cmp = createHarness();
    expect(cmp.activeImage).toContain('product-placeholder');

    cmp.product = {
      base_price: 100,
      sale_price: 80,
      images: [{ url: 'img-a' }, { url: 'img-b' }],
      variants: [{ id: 'v1', stock_quantity: 3 }],
    };
    cmp.selectedVariantId = 'v1';
    cmp.setActiveImage(1);
    expect(cmp.activeImage).toBe('img-b');

    cmp.openPreview();
    expect(cmp.previewOpen).toBeTrue();
    cmp.closePreview();
    expect(cmp.previewOpen).toBeFalse();

    expect(cmp.isOnSale(cmp.product)).toBeTrue();
    expect(cmp.displayPrice(cmp.product)).toBe(80);
  });

  it('adds to cart in-stock and shows sold-out toast out-of-stock', () => {
    const cmp = createHarness();
    cmp.product = {
      id: 'p1',
      slug: 'ring-1',
      name: 'Ring',
      base_price: 100,
      sale_price: 90,
      currency: 'RON',
      stock_quantity: 2,
      images: [{ url: 'img-a' }],
      variants: [{ id: 'v1', stock_quantity: 2 }],
    };
    cmp.selectedVariantId = 'v1';
    cmp.addToCart();
    expect(cmp.cartStore.addFromProduct).toHaveBeenCalled();
    expect(cmp.toast.success).toHaveBeenCalled();

    cmp.product.stock_quantity = 0;
    cmp.product.variants = [{ id: 'v1', stock_quantity: 0 }];
    cmp.addToCart();
    expect(cmp.toast.error).toHaveBeenCalled();
  });
});

describe('ProductComponent fast wishlist and stock baseline helpers', () => {
  it('covers wishlist sign-in, add, and remove branches', () => {
    const cmp = createHarness();
    cmp.product = { id: 'p1', name: 'Ring', slug: 'ring-1' };

    cmp.auth.isAuthenticated.and.returnValue(false);
    cmp.toggleWishlist();
    expect(cmp.toast.info).toHaveBeenCalled();

    cmp.auth.isAuthenticated.and.returnValue(true);
    cmp.wishlist.isWishlisted.and.returnValue(false);
    cmp.toggleWishlist();
    expect(cmp.wishlist.add).toHaveBeenCalledWith('p1');

    cmp.wishlist.isWishlisted.and.returnValue(true);
    cmp.toggleWishlist();
    expect(cmp.wishlist.remove).toHaveBeenCalledWith('p1');
  });

  it('covers back-in-stock status, request and cancel flows', () => {
    const cmp = createHarness();
    cmp.product = { name: 'Ring', slug: 'ring-1', stock_quantity: 0, allow_backorder: false };

    cmp['loadBackInStockStatus']();
    expect(cmp.catalog.getBackInStockStatus).toHaveBeenCalledWith('ring-1');
    expect(cmp.backInStockRequest.id).toBe('req-1');

    cmp.backInStockRequest = null;
    cmp.requestBackInStock();
    expect(cmp.catalog.requestBackInStock).toHaveBeenCalledWith('ring-1');
    expect(cmp.toast.success).toHaveBeenCalled();

    cmp.backInStockRequest = { id: 'req-2' };
    cmp.cancelBackInStock();
    expect(cmp.catalog.cancelBackInStock).toHaveBeenCalledWith('ring-1');
    expect(cmp.backInStockRequest).toBeNull();
  });
});

describe('ProductComponent fast canonical and structured data helper', () => {
  it('updates canonical/meta and injects structured data script', () => {
    const cmp = createHarness();
    cmp.product = {
      id: 'p1',
      slug: 'ring-1',
      name: 'Ring',
      base_price: 100,
      sale_price: 80,
      currency: 'RON',
      stock_quantity: 2,
      short_description: 'Short',
      long_description: 'Long',
      images: [{ url: 'img-a' }],
    };

    cmp['setCanonical'](cmp.product);
    expect(cmp.seoHeadLinks.setLocalizedCanonical).toHaveBeenCalled();
    expect(cmp.meta.updateTag).toHaveBeenCalledWith(jasmine.objectContaining({ property: 'og:url' }));

    cmp['updateStructuredData'](cmp.product);
    expect(cmp.ldScript).toBeTruthy();
    cmp.ngOnDestroy();
    expect(cmp.cdr.detectChanges).not.toHaveBeenCalled();
  });
});

describe('ProductComponent fast stock guard and related error helpers', () => {
  it('covers back-in-stock sign-in guard and request/cancel error paths', () => {
    const cmp = createHarness();
    cmp.product = { name: 'Ring', slug: 'ring-1', stock_quantity: 0, allow_backorder: false };

    cmp.auth.isAuthenticated.and.returnValue(false);
    cmp['loadBackInStockStatus']();
    expect(cmp.catalog.getBackInStockStatus).not.toHaveBeenCalled();

    cmp.requestBackInStock();
    expect(cmp.toast.info).toHaveBeenCalled();
    expect(cmp.router.navigateByUrl).toHaveBeenCalledWith('/login');

    cmp.auth.isAuthenticated.and.returnValue(true);
    cmp.catalog.requestBackInStock.and.returnValue(throwError(() => new Error('request-failed')));
    cmp.backInStockRequest = null;
    cmp.requestBackInStock();
    expect(cmp.backInStockLoading).toBeFalse();
    expect(cmp.toast.error).toHaveBeenCalled();

    cmp.backInStockRequest = { id: 'req-1' };
    cmp.catalog.cancelBackInStock.and.returnValue(throwError(() => new Error('cancel-failed')));
    cmp.cancelBackInStock();
    expect(cmp.backInStockLoading).toBeFalse();
    expect(cmp.backInStockRequest).toEqual({ id: 'req-1' });
  });

  it('covers upsell and related error branches by resetting lists for active product slug', () => {
    const cmp = createHarness();
    cmp.product = { slug: 'ring-1' };
    cmp.upsellProducts = [{ slug: 'cached-upsell' }];
    cmp.relatedProducts = [{ slug: 'cached-related' }];
    cmp.catalog.getUpsellProducts.and.returnValue(throwError(() => new Error('upsell-failed')));
    cmp.catalog.getRelatedProducts.and.returnValue(throwError(() => new Error('related-failed')));

    cmp['loadUpsells']('ring-1', 'en');
    cmp['loadRelated']('ring-1', 'en');

    expect(cmp.upsellProducts).toEqual([]);
    expect(cmp.relatedProducts).toEqual([]);
  });
});
