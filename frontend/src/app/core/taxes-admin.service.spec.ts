import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ApiService } from './api.service';
import { TaxesAdminService } from './taxes-admin.service';

describe('TaxesAdminService', () => {
  let service: TaxesAdminService;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post', 'patch', 'put', 'delete']);
    api.get.and.returnValue(of([]));
    api.post.and.returnValue(of({}));
    api.patch.and.returnValue(of({}));
    api.put.and.returnValue(of({}));
    api.delete.and.returnValue(of(undefined));

    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, TaxesAdminService],
    });
    service = TestBed.inject(TaxesAdminService);
  });

  it('listGroups calls the groups endpoint', () => {
    service.listGroups().subscribe();
    expect(api.get).toHaveBeenCalledWith('/taxes/admin/groups');
  });

  it('createGroup posts the payload', () => {
    const payload = { code: 'STD', name: 'Standard' };
    service.createGroup(payload).subscribe();
    expect(api.post).toHaveBeenCalledWith('/taxes/admin/groups', payload);
  });

  it('updateGroup patches by id', () => {
    service.updateGroup('g1', { name: 'New' }).subscribe();
    expect(api.patch).toHaveBeenCalledWith('/taxes/admin/groups/g1', { name: 'New' });
  });

  it('deleteGroup deletes by id', () => {
    service.deleteGroup('g1').subscribe();
    expect(api.delete).toHaveBeenCalledWith('/taxes/admin/groups/g1');
  });

  it('upsertRate puts to the rates endpoint', () => {
    const payload = { country_code: 'RO', vat_rate_percent: 19 };
    service.upsertRate('g1', payload).subscribe();
    expect(api.put).toHaveBeenCalledWith('/taxes/admin/groups/g1/rates', payload);
  });

  it('deleteRate encodes the country code', () => {
    service.deleteRate('g1', 'a b').subscribe();
    expect(api.delete).toHaveBeenCalledWith('/taxes/admin/groups/g1/rates/a%20b');
  });
});
