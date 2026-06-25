import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';

import { ApiService } from './api.service';
import { SiteCompanyService } from './site-company.service';

describe('SiteCompanyService', () => {
  const apiMock = { get: jasmine.createSpy('get') };
  let service: SiteCompanyService;

  beforeEach(() => {
    apiMock.get.calls.reset();
    TestBed.configureTestingModule({
      providers: [SiteCompanyService, { provide: ApiService, useValue: apiMock }],
    });
    service = TestBed.inject(SiteCompanyService);
  });

  it('parses a populated company block and trims/coerces values', async () => {
    apiMock.get.and.returnValue(
      of({
        meta: {
          company: {
            name: '  Acme  ',
            registration_number: 'J40/1/2020',
            cui: 123456,
            address: '',
            phone: '   ',
            email: 'hi@acme.test',
          },
        },
      }),
    );
    const info = await firstValueFrom(service.get());
    expect(info.name).toBe('Acme');
    expect(info.registrationNumber).toBe('J40/1/2020');
    expect(info.cui).toBe('123456');
    expect(info.address).toBeNull();
    expect(info.phone).toBeNull();
    expect(info.email).toBe('hi@acme.test');
  });

  it('handles missing meta/company gracefully', async () => {
    apiMock.get.and.returnValue(of({}));
    const info = await firstValueFrom(service.get());
    expect(info.name).toBeNull();
    expect(info.cui).toBeNull();
  });

  it('returns the empty company on error', async () => {
    apiMock.get.and.returnValue(throwError(() => new Error('boom')));
    const info = await firstValueFrom(service.get());
    expect(info.name).toBeNull();
    expect(info.email).toBeNull();
  });

  it('caches the observable and refreshes after resetCache', async () => {
    apiMock.get.and.returnValue(of({ meta: { company: { name: 'First' } } }));
    await firstValueFrom(service.get());
    await firstValueFrom(service.get());
    expect(apiMock.get).toHaveBeenCalledTimes(1);

    service.resetCache();
    apiMock.get.and.returnValue(of({ meta: { company: { name: 'Second' } } }));
    const info = await firstValueFrom(service.get());
    expect(info.name).toBe('Second');
    expect(apiMock.get).toHaveBeenCalledTimes(2);
  });

  it('returns null for non-string/non-number values', async () => {
    apiMock.get.and.returnValue(of({ meta: { company: { name: { nested: true } } } }));
    const info = await firstValueFrom(service.get());
    expect(info.name).toBeNull();
  });

  it('treats a numeric zero-length string as null', async () => {
    apiMock.get.and.returnValue(of({ meta: { company: { cui: '' } } }));
    const info = await firstValueFrom(service.get());
    expect(info.cui).toBeNull();
  });
});
