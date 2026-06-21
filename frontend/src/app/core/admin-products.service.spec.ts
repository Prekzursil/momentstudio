import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ApiService } from './api.service';
import { AdminProductsService } from './admin-products.service';

describe('AdminProductsService', () => {
  let service: AdminProductsService;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post']);
    api.get.and.returnValue(of({ items: [], meta: {} }));
    api.post.and.returnValue(of({}));

    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, AdminProductsService],
    });
    service = TestBed.inject(AdminProductsService);
  });

  it('search forwards params to the search endpoint', () => {
    const params = { q: 'mug', status: 'active', page: 1, limit: 20 };
    service.search(params).subscribe();
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/products/search', params as never);
  });

  it('restore posts to the restore endpoint', () => {
    service.restore('p1').subscribe();
    expect(api.post).toHaveBeenCalledWith('/admin/dashboard/products/p1/restore', {});
  });

  it('byIds posts the id list', () => {
    service.byIds(['a', 'b']).subscribe();
    expect(api.post).toHaveBeenCalledWith('/admin/dashboard/products/by-ids', {
      ids: ['a', 'b'],
    });
  });

  it('duplicateCheck forwards query params', () => {
    const params = { name: 'Mug', sku: 'SKU1' };
    service.duplicateCheck(params).subscribe();
    expect(api.get).toHaveBeenCalledWith(
      '/admin/dashboard/products/duplicate-check',
      params as never,
    );
  });
});
