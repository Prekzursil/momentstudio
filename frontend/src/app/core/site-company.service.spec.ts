import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';

import { ApiService } from './api.service';
import { SiteCompanyService } from './site-company.service';

describe('SiteCompanyService', () => {
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
  });

  it('parses company metadata, caches result, and resets cache', async () => {
    api.get.and.returnValue(
      of({
        meta: {
          version: 1,
          company: {
            name: ' Moment Studio ',
            registration_number: 12345,
            cui: ' RO123 ',
            address: ' Main Street ',
            phone: ' 0700 ',
            email: ' office@example.com '
          }
        }
      } as any)
    );

    TestBed.configureTestingModule({
      providers: [
        SiteCompanyService,
        { provide: ApiService, useValue: api },
      ],
    });

    const service = TestBed.inject(SiteCompanyService);

    const first = await firstValueFrom(service.get());
    const second = await firstValueFrom(service.get());

    expect(first).toEqual({
      name: 'Moment Studio',
      registrationNumber: '12345',
      cui: 'RO123',
      address: 'Main Street',
      phone: '0700',
      email: 'office@example.com',
    });
    expect(second).toEqual(first);
    expect(api.get.calls.count()).toBe(1);

    service.resetCache();
    await firstValueFrom(service.get());
    expect(api.get.calls.count()).toBe(2);
  });

  it('returns empty object shape on request failures', async () => {
    api.get.and.returnValue(throwError(() => new Error('network')));

    TestBed.configureTestingModule({
      providers: [
        SiteCompanyService,
        { provide: ApiService, useValue: api },
      ],
    });

    const service = TestBed.inject(SiteCompanyService);
    const result = await firstValueFrom(service.get());

    expect(result).toEqual({
      name: null,
      registrationNumber: null,
      cui: null,
      address: null,
      phone: null,
      email: null,
    });
  });
});
