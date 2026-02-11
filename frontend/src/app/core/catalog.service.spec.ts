import { TestBed } from '@angular/core/testing';
import { of, firstValueFrom } from 'rxjs';

import { ApiService } from './api.service';
import { CatalogService } from './catalog.service';

describe('CatalogService language-aware requests', () => {
  const apiMock = {
    get: jasmine.createSpy('get'),
  };

  let service: CatalogService;

  beforeEach(() => {
    apiMock.get.calls.reset();
    TestBed.configureTestingModule({
      providers: [
        CatalogService,
        { provide: ApiService, useValue: apiMock },
      ],
    });
    service = TestBed.inject(CatalogService);
  });

  it('passes lang to product list requests', async () => {
    apiMock.get.and.returnValue(
      of({
        items: [],
        meta: { total_items: 0, total_pages: 1, page: 1, limit: 12 },
      })
    );

    await firstValueFrom(service.listProducts({ search: 'test', lang: 'ro' }));

    expect(apiMock.get).toHaveBeenCalledWith(
      '/catalog/products',
      jasmine.objectContaining({ lang: 'ro', search: 'test' })
    );
  });

  it('passes lang to product detail and relationship requests', async () => {
    apiMock.get.and.returnValues(of({ id: 'p1', slug: 'prod', name: 'Prod', base_price: 10, currency: 'RON' }), of([]), of([]));

    await firstValueFrom(service.getProduct('prod', 'en'));
    await firstValueFrom(service.getRelatedProducts('prod', 'en'));
    await firstValueFrom(service.getUpsellProducts('prod', 'en'));

    expect(apiMock.get.calls.argsFor(0)).toEqual(['/catalog/products/prod', { lang: 'en' }]);
    expect(apiMock.get.calls.argsFor(1)).toEqual(['/catalog/products/prod/related', { lang: 'en' }]);
    expect(apiMock.get.calls.argsFor(2)).toEqual(['/catalog/products/prod/upsells', { lang: 'en' }]);
  });

  it('passes lang to featured collections requests', async () => {
    apiMock.get.and.returnValue(of([]));

    await firstValueFrom(service.listFeaturedCollections('ro'));

    expect(apiMock.get).toHaveBeenCalledWith('/catalog/collections/featured', { lang: 'ro' });
  });
});
