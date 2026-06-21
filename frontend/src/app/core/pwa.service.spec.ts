import { TestBed } from '@angular/core/testing';

import { PwaService } from './pwa.service';

describe('PwaService', () => {
  function makeService(): PwaService {
    TestBed.configureTestingModule({ providers: [PwaService] });
    return TestBed.inject(PwaService);
  }

  it('reflects the initial navigator.onLine value', () => {
    const spy = spyOnProperty(navigator, 'onLine', 'get').and.returnValue(false);
    const service = makeService();
    expect(spy).toHaveBeenCalled();
    expect(service.isOnline()).toBeFalse();
  });

  it('updates the signal when online/offline events fire', () => {
    spyOnProperty(navigator, 'onLine', 'get').and.returnValue(true);
    const service = makeService();
    expect(service.isOnline()).toBeTrue();

    window.dispatchEvent(new Event('offline'));
    expect(service.isOnline()).toBeFalse();

    window.dispatchEvent(new Event('online'));
    expect(service.isOnline()).toBeTrue();
  });
});
