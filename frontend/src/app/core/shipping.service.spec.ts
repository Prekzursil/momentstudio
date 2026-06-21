import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';

import { ApiService } from './api.service';
import { ShippingService } from './shipping.service';

describe('ShippingService', () => {
  const apiMock = { get: jasmine.createSpy('get') };
  let service: ShippingService;

  beforeEach(() => {
    apiMock.get.calls.reset();
    TestBed.configureTestingModule({
      providers: [ShippingService, { provide: ApiService, useValue: apiMock }],
    });
    service = TestBed.inject(ShippingService);
  });

  it('lists lockers with the provided params', async () => {
    apiMock.get.and.returnValue(of([{ id: 'l1' }]));
    const params = { provider: 'sameday' as const, lat: 44.4, lng: 26.1, radius_km: 5, limit: 20 };
    const result = await firstValueFrom(service.listLockers(params));
    expect(apiMock.get).toHaveBeenCalledWith('/shipping/lockers', params);
    expect(result).toEqual([{ id: 'l1' }] as never);
  });

  it('lists locker cities with the provided params', async () => {
    apiMock.get.and.returnValue(of({ items: [], snapshot: null }));
    const params = { provider: 'fan_courier' as const, q: 'cluj', limit: 10 };
    const result = await firstValueFrom(service.listLockerCities(params));
    expect(apiMock.get).toHaveBeenCalledWith('/shipping/lockers/cities', params);
    expect(result).toEqual({ items: [], snapshot: null });
  });
});
