import { TestBed } from '@angular/core/testing';
import { of, firstValueFrom } from 'rxjs';

import { ApiService } from './api.service';
import { CatalogService } from './catalog.service';

describe('CatalogService language-aware requests', () => {
  const apiMock = {
    get: jasmine.createSpy('get'),
    post: jasmine.createSpy('post'),
    delete: jasmine.createSpy('delete'),
  };

  let service: CatalogService;

  beforeEach(() => {
    apiMock.get.calls.reset();
    apiMock.post.calls.reset();
    apiMock.delete.calls.reset();
    TestBed.configureTestingModule({
      providers: [CatalogService, { provide: ApiService, useValue: apiMock }],
    });
    service = TestBed.inject(CatalogService);
  });

  it('passes lang to product list requests', async () => {
    apiMock.get.and.returnValue(
      of({
        items: [],
        meta: { total_items: 0, total_pages: 1, page: 1, limit: 12 },
      }),
    );

    await firstValueFrom(service.listProducts({ search: 'test', lang: 'ro' }));

    expect(apiMock.get).toHaveBeenCalledWith(
      '/catalog/products',
      jasmine.objectContaining({ lang: 'ro', search: 'test' }),
    );
  });

  it('passes lang to product detail and relationship requests', async () => {
    apiMock.get.and.returnValues(
      of({ id: 'p1', slug: 'prod', name: 'Prod', base_price: 10, currency: 'RON' }),
      of([]),
      of([]),
    );

    await firstValueFrom(service.getProduct('prod', 'en'));
    await firstValueFrom(service.getRelatedProducts('prod', 'en'));
    await firstValueFrom(service.getUpsellProducts('prod', 'en'));

    expect(apiMock.get.calls.argsFor(0)).toEqual(['/catalog/products/prod', { lang: 'en' }]);
    expect(apiMock.get.calls.argsFor(1)).toEqual([
      '/catalog/products/prod/related',
      { lang: 'en' },
    ]);
    expect(apiMock.get.calls.argsFor(2)).toEqual([
      '/catalog/products/prod/upsells',
      { lang: 'en' },
    ]);
  });

  it('passes lang to featured collections requests', async () => {
    apiMock.get.and.returnValue(of([]));

    await firstValueFrom(service.listFeaturedCollections('ro'));

    expect(apiMock.get).toHaveBeenCalledWith('/catalog/collections/featured', { lang: 'ro' });
  });

  it('lists categories with and without options', async () => {
    apiMock.get.and.returnValue(of([]));
    await firstValueFrom(service.listCategories('en', { include_hidden: true }));
    expect(apiMock.get).toHaveBeenCalledWith('/catalog/categories', {
      lang: 'en',
      include_hidden: true,
    });

    await firstValueFrom(service.listCategories());
    expect(apiMock.get).toHaveBeenCalledWith('/catalog/categories', {
      lang: undefined,
      include_hidden: undefined,
    });
  });

  it('normalizes product money fields including null and non-null sale branches', async () => {
    apiMock.get.and.returnValue(
      of({
        id: 'p1',
        slug: 'p',
        name: 'P',
        base_price: '12.50',
        sale_price: null,
        sale_value: null,
        currency: 'RON',
      }),
    );
    const nulled = await firstValueFrom(service.getProduct('p'));
    expect(nulled.base_price).toBe(12.5);
    expect(nulled.sale_price).toBeNull();
    expect(nulled.sale_value).toBeNull();

    apiMock.get.and.returnValue(
      of({
        id: 'p1',
        slug: 'p',
        name: 'P',
        base_price: '10',
        sale_price: '8.00',
        sale_value: '2.00',
        currency: 'RON',
      }),
    );
    const sale = await firstValueFrom(service.getProduct('p'));
    expect(sale.sale_price).toBe(8);
    expect(sale.sale_value).toBe(2);
  });

  it('defaults page/limit and omits empty tags in listProducts', async () => {
    apiMock.get.and.returnValue(of({ items: null, meta: {} }));
    const res = await firstValueFrom(service.listProducts({ tags: [] }));
    expect(res.items).toEqual([]);
    const args = apiMock.get.calls.mostRecent().args[1];
    expect(args.page).toBe(1);
    expect(args.limit).toBe(12);
    expect(args.tags).toBeUndefined();

    apiMock.get.and.returnValue(of({ items: [], meta: {} }));
    await firstValueFrom(service.listProducts({ tags: ['a'], page: 3, limit: 24 }));
    const args2 = apiMock.get.calls.mostRecent().args[1];
    expect(args2.tags).toEqual(['a']);
    expect(args2.page).toBe(3);
    expect(args2.limit).toBe(24);
  });

  it('returns empty arrays for null related/upsell responses', async () => {
    apiMock.get.and.returnValues(of(null), of(null));
    expect(await firstValueFrom(service.getRelatedProducts('p'))).toEqual([]);
    expect(await firstValueFrom(service.getUpsellProducts('p'))).toEqual([]);
  });

  it('normalizes non-empty product lists from listProducts/related/upsell', async () => {
    const row = { id: 'p1', slug: 'p', name: 'P', base_price: '7.00', currency: 'RON' };
    apiMock.get.and.returnValue(of({ items: [row], meta: {} }));
    const list = await firstValueFrom(service.listProducts({}));
    expect(list.items[0].base_price).toBe(7);

    apiMock.get.and.returnValue(of([row]));
    const related = await firstValueFrom(service.getRelatedProducts('p'));
    expect(related[0].base_price).toBe(7);

    apiMock.get.and.returnValue(of([row]));
    const upsells = await firstValueFrom(service.getUpsellProducts('p'));
    expect(upsells[0].base_price).toBe(7);
  });

  it('reads, requests, and cancels back-in-stock', async () => {
    apiMock.get.and.returnValue(of({ in_stock: false, request: null }));
    const status = await firstValueFrom(service.getBackInStockStatus('p'));
    expect(status.in_stock).toBeFalse();
    expect(apiMock.get).toHaveBeenCalledWith('/catalog/products/p/back-in-stock');

    apiMock.post.and.returnValue(of({ id: 'r1', created_at: 'd' }));
    await firstValueFrom(service.requestBackInStock('p'));
    expect(apiMock.post).toHaveBeenCalledWith('/catalog/products/p/back-in-stock', {});

    apiMock.delete.and.returnValue(of(undefined));
    await firstValueFrom(service.cancelBackInStock('p'));
    expect(apiMock.delete).toHaveBeenCalledWith('/catalog/products/p/back-in-stock');
  });

  it('fetches price bounds, omitting empty tags but passing non-empty ones', async () => {
    apiMock.get.and.returnValue(of({ min_price: 1, max_price: 9 }));
    await firstValueFrom(service.getProductPriceBounds({ category_slug: 'c', tags: [] }));
    expect(apiMock.get.calls.mostRecent().args[1].tags).toBeUndefined();

    await firstValueFrom(service.getProductPriceBounds({ tags: ['x'] }));
    expect(apiMock.get.calls.mostRecent().args[1].tags).toEqual(['x']);
  });

  it('normalizes products nested in featured collections including null products', async () => {
    apiMock.get.and.returnValue(
      of([
        {
          id: 'c1',
          slug: 'col',
          name: 'Col',
          created_at: 'd',
          products: [{ id: 'p1', slug: 'p', name: 'P', base_price: '5.00', currency: 'RON' }],
        },
        { id: 'c2', slug: 'col2', name: 'Col2', created_at: 'd', products: null },
      ]),
    );
    const collections = await firstValueFrom(service.listFeaturedCollections('en'));
    expect(collections[0].products[0].base_price).toBe(5);
    expect(collections[1].products).toEqual([]);
  });

  it('returns an empty list for a null featured collections response', async () => {
    apiMock.get.and.returnValue(of(null));
    expect(await firstValueFrom(service.listFeaturedCollections())).toEqual([]);
  });
});
