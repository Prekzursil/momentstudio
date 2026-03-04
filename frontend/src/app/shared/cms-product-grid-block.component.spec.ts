import { of, throwError } from 'rxjs';

import { CmsProductGridBlockComponent } from './cms-product-grid-block.component';

describe('CmsProductGridBlockComponent', () => {
  function createCatalogSpy() {
    return jasmine.createSpyObj('CatalogService', ['listProducts', 'listFeaturedCollections', 'getProduct']);
  }

  it('loads category products and updates state', () => {
    const catalog = createCatalogSpy();
    const product = { id: 'p1', slug: 'ring' } as any;
    catalog.listProducts.and.returnValue(of({ items: [product] } as any));
    const component = new CmsProductGridBlockComponent(catalog as any);

    component.block = { source: 'category', category_slug: 'rings', limit: 3 } as any;
    component.load();

    expect(catalog.listProducts).toHaveBeenCalledWith({ category_slug: 'rings', limit: 3 });
    expect(component.products()).toEqual([product]);
    expect(component.error()).toBeFalse();
    expect(component.loading()).toBeFalse();
    expect(component.skeletons.length).toBe(3);
  });

  it('loads collection source and handles missing/invalid source as no-op', () => {
    const catalog = createCatalogSpy();
    const colProduct = { id: 'p2', slug: 'bracelet' } as any;
    catalog.listFeaturedCollections.and.returnValue(of([{ slug: 'featured', products: [colProduct] }] as any));
    const component = new CmsProductGridBlockComponent(catalog as any);

    component.block = { source: 'collection', collection_slug: 'featured', limit: 5 } as any;
    component.load();
    expect(catalog.listFeaturedCollections).toHaveBeenCalled();
    expect(component.products()).toEqual([colProduct]);

    component.block = { source: 'collection', collection_slug: '', limit: 5 } as any;
    component.products.set([]);
    component.load();
    expect(component.products()).toEqual([]);

    component.block = null as any;
    component.load();
    expect(component.products()).toEqual([]);
  });

  it('loads manual products with per-slug fallback and sets error on request failure', () => {
    const catalog = createCatalogSpy();
    const p1 = { id: 'p1', slug: 'ring' } as any;
    const p2 = { id: 'p2', slug: 'chain' } as any;
    catalog.getProduct.and.callFake((slug: string) => {
      if (slug === 'missing') return throwError(() => ({ status: 404 }));
      return of(slug === 'ring' ? p1 : p2);
    });
    catalog.listProducts.and.returnValue(throwError(() => ({ status: 500 })));

    const component = new CmsProductGridBlockComponent(catalog as any);
    component.block = { source: 'products', product_slugs: ['ring', 'missing', 'chain'], limit: 5 } as any;
    component.load();
    expect(component.products()).toEqual([p1, p2]);

    component.block = { source: 'category', category_slug: 'rings', limit: 4 } as any;
    component.load();
    expect(component.error()).toBeTrue();
    expect(component.products()).toEqual([]);
    expect(component.loading()).toBeFalse();
  });

  it('covers lifecycle and helpers', () => {
    const catalog = createCatalogSpy();
    catalog.listProducts.and.returnValue(of({ items: [] } as any));
    const component = new CmsProductGridBlockComponent(catalog as any);

    component.block = { source: 'category', category_slug: 'rings', limit: 2 } as any;
    component.ngOnChanges();
    expect(catalog.listProducts).toHaveBeenCalled();

    expect(component.trackProduct(2, { id: '', slug: '' } as any)).toBe('2');
    expect(component.trackProduct(0, { id: '', slug: 'slug-only' } as any)).toBe('slug-only');
    expect(component.trackProduct(0, { id: 'id-only', slug: '' } as any)).toBe('id-only');

    const unsub = jasmine.createSpy('unsubscribe');
    (component as any).sub = { unsubscribe: unsub };
    component.ngOnDestroy();
    expect(unsub).toHaveBeenCalled();
  });
});
