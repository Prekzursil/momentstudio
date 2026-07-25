import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';

import { ApiService } from './api.service';
import { checkoutPricingSettingsResolver } from './checkout.resolver';

describe('checkoutPricingSettingsResolver', () => {
  const apiMock = {
    get: jasmine.createSpy('get'),
  };

  const route = {} as ActivatedRouteSnapshot;
  const state = {} as RouterStateSnapshot;

  function runResolver(): Promise<Record<string, unknown> | null> {
    const result = TestBed.runInInjectionContext(() =>
      checkoutPricingSettingsResolver(route, state),
    ) as Observable<Record<string, unknown> | null>;
    return firstValueFrom(result);
  }

  beforeEach(() => {
    apiMock.get.calls.reset();
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: apiMock }],
    });
  });

  it('requests the checkout content block from the API', async () => {
    apiMock.get.and.returnValue(of({ meta: { vatIncluded: true } }));

    await runResolver();

    expect(apiMock.get).toHaveBeenCalledWith('/content/site.checkout');
  });

  it('returns the meta object when the content block has meta', async () => {
    const meta = { vatIncluded: true, currency: 'RON' };
    apiMock.get.and.returnValue(of({ meta }));

    await expectAsync(runResolver()).toBeResolvedTo(meta);
  });

  it('returns null when the content block meta is null', async () => {
    apiMock.get.and.returnValue(of({ meta: null }));

    await expectAsync(runResolver()).toBeResolvedTo(null);
  });

  it('returns null when the API resolves to a null block', async () => {
    apiMock.get.and.returnValue(of(null));

    await expectAsync(runResolver()).toBeResolvedTo(null);
  });

  it('returns null when the API request errors', async () => {
    apiMock.get.and.returnValue(throwError(() => new Error('boom')));

    await expectAsync(runResolver()).toBeResolvedTo(null);
  });
});
