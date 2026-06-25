import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ApiService } from './api.service';
import { FxRatesService } from './fx-rates.service';

describe('FxRatesService', () => {
  const apiMock = { get: jasmine.createSpy('get') };
  let service: FxRatesService;

  beforeEach(() => {
    apiMock.get.calls.reset();
    TestBed.configureTestingModule({
      providers: [FxRatesService, { provide: ApiService, useValue: apiMock }],
    });
    service = TestBed.inject(FxRatesService);
  });

  it('exposes a default snapshot before loading', () => {
    const snap = service.snapshot;
    expect(snap.base).toBe('RON');
    expect(snap.eurPerRon).toBe(0);
    expect(snap.usdPerRon).toBe(0);
    expect(snap.loaded).toBeFalse();
  });

  it('loads rates and marks loaded when both rates are positive', () => {
    apiMock.get.and.returnValue(
      of({
        base: 'RON',
        eur_per_ron: 0.2,
        usd_per_ron: 0.22,
        as_of: '2026-01-01',
        source: 'ecb',
        fetched_at: '2026-01-02',
      }),
    );
    service.ensureLoaded();
    const snap = service.snapshot;
    expect(snap.eurPerRon).toBe(0.2);
    expect(snap.usdPerRon).toBe(0.22);
    expect(snap.asOf).toBe('2026-01-01');
    expect(snap.fetchedAt).toBe('2026-01-02');
    expect(snap.source).toBe('ecb');
    expect(snap.loaded).toBeTrue();
  });

  it('does not mark loaded when a rate is zero', () => {
    apiMock.get.and.returnValue(
      of({ eur_per_ron: 0, usd_per_ron: 0.22, as_of: '', source: '', fetched_at: '' }),
    );
    service.ensureLoaded();
    expect(service.snapshot.loaded).toBeFalse();
  });

  it('coerces non-numeric rates to zero', () => {
    apiMock.get.and.returnValue(
      of({
        eur_per_ron: 'x' as unknown as number,
        usd_per_ron: 'y' as unknown as number,
        as_of: '',
        source: '',
        fetched_at: '',
      }),
    );
    service.ensureLoaded();
    expect(service.snapshot.eurPerRon).toBe(0);
    expect(service.snapshot.usdPerRon).toBe(0);
    expect(service.snapshot.loaded).toBeFalse();
  });

  it('skips fetching again once loaded', () => {
    apiMock.get.and.returnValue(
      of({ eur_per_ron: 0.2, usd_per_ron: 0.22, as_of: '', source: '', fetched_at: '' }),
    );
    service.ensureLoaded();
    service.ensureLoaded();
    expect(apiMock.get).toHaveBeenCalledTimes(1);
  });

  it('records the failure on error without marking loaded', () => {
    apiMock.get.and.returnValue(throwError(() => new Error('net')));
    service.ensureLoaded();
    expect(service.snapshot.loaded).toBeFalse();
  });

  it('throttles retries within the error cooldown window', () => {
    apiMock.get.and.returnValue(throwError(() => new Error('net')));
    service.ensureLoaded();
    apiMock.get.calls.reset();
    service.ensureLoaded();
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('retries after the cooldown window elapses', () => {
    let clock = 1_000_000;
    spyOn(Date, 'now').and.callFake(() => clock);
    apiMock.get.and.returnValue(throwError(() => new Error('net')));
    service.ensureLoaded(); // records lastErrorAt = clock
    apiMock.get.calls.reset();

    clock += 61_000; // advance beyond the 60s cooldown
    apiMock.get.and.returnValue(
      of({ eur_per_ron: 0.2, usd_per_ron: 0.22, as_of: '', source: '', fetched_at: '' }),
    );
    service.ensureLoaded();
    expect(apiMock.get).toHaveBeenCalledTimes(1);
  });
});
