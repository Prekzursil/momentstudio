import { SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { LazyStylesService } from '../core/lazy-styles.service';
import { ShippingService } from '../core/shipping.service';
import { LockerPickerComponent } from './locker-picker.component';


let lockerPickerFixture: ComponentFixture<LockerPickerComponent>;
let lockerPickerComponent: LockerPickerComponent;
let lockerPickerShipping: jasmine.SpyObj<ShippingService>;

describe('LockerPickerComponent', () => {
  beforeEach(async () => {
    lockerPickerShipping = jasmine.createSpyObj<ShippingService>('ShippingService', ['listLockers', 'listLockerCities']);
    lockerPickerShipping.listLockers.and.returnValue(of([]));
    lockerPickerShipping.listLockerCities.and.returnValue(
      of({
        items: [
          {
            provider: 'sameday',
            city: 'Bucuresti',
            county: 'Ilfov',
            display_name: 'Bucuresti, Ilfov',
            lat: 44.43,
            lng: 26.1,
            locker_count: 42
          }
        ],
        snapshot: {
          provider: 'sameday',
          total_lockers: 1200,
          last_success_at: '2026-01-01T00:00:00Z',
          last_error: null,
          stale: true,
          stale_age_seconds: 86400 * 35,
          challenge_failure_streak: 3,
          schema_drift_detected: true,
          canary_alert_codes: ['schema_drift', 'challenge_failure_streak'],
          canary_alert_messages: ['schema changed', 'challenge streak']
        }
      } as any)
    );

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), LockerPickerComponent],
      providers: [
        { provide: ShippingService, useValue: lockerPickerShipping },
        { provide: LazyStylesService, useValue: { ensure: () => Promise.resolve() } }
      ]
    }).compileComponents();

    lockerPickerFixture = TestBed.createComponent(LockerPickerComponent);
    lockerPickerComponent = lockerPickerFixture.componentInstance;
    spyOn(lockerPickerComponent as any, 'initMap').and.returnValue(Promise.resolve());
    lockerPickerFixture.detectChanges();
  });

  defineCitySuggestionSpec();
  defineMirrorUnavailableSpec();
  defineNoGeolocationSpec();
  defineShortSearchSpec();
  defineSearchFirstResultSpec();
  defineGenericLoadErrorSpec();
  defineStaleDaysSpec();
  defineGeoSuccessAndDeniedSpec();
  defineSearchFirstResultFallbackSpec();
  defineFanCourierFetchBranchesSpec();
  defineProviderChangeRefreshSpec();
  defineSelectedChangeRedrawSpec();
  defineAbortErrorSuppressionSpec();
  defineDestroyCleanupSpec();
  defineMirrorSnapshotRefreshGuardSpec();
});

function defineCitySuggestionSpec(): void {
  it('loads city suggestions from backend for sameday and stores stale snapshot metadata', async () => {
    lockerPickerComponent.provider = 'sameday';
    await (lockerPickerComponent as any).fetchLocations('Bucu');
    lockerPickerFixture.detectChanges();

    expect(lockerPickerShipping.listLockerCities).toHaveBeenCalled();
    expect(lockerPickerComponent.searchResults.length).toBe(1);
    expect(lockerPickerComponent.searchResults[0].display_name).toContain('Bucuresti');
    expect(lockerPickerComponent.mirrorSnapshot?.stale).toBeTrue();
    expect(lockerPickerComponent.mirrorSnapshot?.canary_alert_messages?.length).toBeGreaterThan(0);
    expect(lockerPickerComponent.staleDays()).toBeGreaterThanOrEqual(30);
    expect((lockerPickerFixture.nativeElement.textContent || '').replaceAll(/\s+/g, ' ')).toContain(
      'checkout.lockers.snapshotCanaryTitle'
    );
  });
};

function defineMirrorUnavailableSpec(): void {
  it('shows mirror unavailable message when backend returns 503 locker mirror error', async () => {
    lockerPickerShipping.listLockers.and.returnValue(
      throwError(() => ({ error: { detail: 'Sameday locker mirror is not initialized' } }))
    );
    lockerPickerComponent.provider = 'sameday';

    await (lockerPickerComponent as any).loadLockers(44.4, 26.1);
    expect(lockerPickerComponent.error).toContain('checkout.lockers.mirrorUnavailable');
  });
};

function defineNoGeolocationSpec(): void {
  it('surfaces a no-geolocation error when geolocation API is unavailable', () => {
    spyOnProperty(globalThis.navigator, 'geolocation', 'get').and.returnValue(undefined as any);

    lockerPickerComponent.useMyLocation();

    expect(lockerPickerComponent.error).toContain('checkout.lockers.noGeolocation');
  });
};

function defineShortSearchSpec(): void {
  it('clears search results and aborts in-flight lookup for short search strings', () => {
    const controller = new AbortController();
    const abortSpy = spyOn(controller, 'abort').and.callThrough();
    lockerPickerComponent.searchResults = [{ display_name: 'Old', lat: 1, lng: 2 }];
    (lockerPickerComponent as any).searchAbort = controller;

    lockerPickerComponent.onSearchQueryChange('ab');

    expect(lockerPickerComponent.searchResults).toEqual([]);
    expect(abortSpy).toHaveBeenCalled();
  });
};

function defineSearchFirstResultSpec(): void {
  it('applies the first in-memory search result before performing remote lookup', () => {
    lockerPickerShipping.listLockerCities.calls.reset();
    const applySpy = spyOn(lockerPickerComponent, 'applyLocation');
    lockerPickerComponent.searchQuery = 'bucu';
    lockerPickerComponent.searchResults = [{ display_name: 'Bucuresti', lat: 44.43, lng: 26.1 }];

    lockerPickerComponent.searchFirstResult();

    expect(applySpy).toHaveBeenCalledWith(lockerPickerComponent.searchResults[0]);
    expect(lockerPickerShipping.listLockerCities).not.toHaveBeenCalled();
  });
};

function defineGenericLoadErrorSpec(): void {
  it('uses the generic locker error for non-sameday providers', async () => {
    lockerPickerShipping.listLockers.and.returnValue(throwError(() => ({ error: { detail: 'service unavailable' } })));
    lockerPickerComponent.provider = 'fan_courier';

    await (lockerPickerComponent as any).loadLockers(44.4, 26.1);

    expect(lockerPickerComponent.error).toContain('checkout.lockers.error');
  });
};

function defineStaleDaysSpec(): void {
  it('returns fallback and computed stale day values from mirror snapshots', () => {
    lockerPickerComponent.mirrorSnapshot = { stale_age_seconds: null } as any;
    expect(lockerPickerComponent.staleDays()).toBe(30);

    lockerPickerComponent.mirrorSnapshot = { stale_age_seconds: 86400 * 7.9 } as any;
    expect(lockerPickerComponent.staleDays()).toBe(7);
  });
};

function defineGeoSuccessAndDeniedSpec(): void {
  it('covers geolocation success and denied callbacks', () => {
    const getCurrentPosition = jasmine.createSpy('getCurrentPosition').and.callFake((onSuccess: any, onError: any) => {
      onSuccess({ coords: { latitude: 45.1, longitude: 26.2 } });
      onError(new Error('denied'));
    });
    spyOnProperty(globalThis.navigator, 'geolocation', 'get').and.returnValue({ getCurrentPosition } as any);

    lockerPickerComponent.useMyLocation();
    expect(lockerPickerComponent['lastCenter']).toEqual({ lat: 45.1, lng: 26.2 });
    expect(lockerPickerComponent.error).toContain('checkout.lockers.geoDenied');
  });
};

function defineSearchFirstResultFallbackSpec(): void {
  it('uses remote lookup when in-memory result list is empty', async () => {
    lockerPickerShipping.listLockerCities.and.returnValue(of({ items: [], snapshot: null } as any));
    lockerPickerComponent.searchResults = [];
    lockerPickerComponent.searchQuery = 'Bucuresti';

    await (lockerPickerComponent as any).fetchLocations('Bucuresti', { applyFirst: true });

    expect(lockerPickerComponent.searchError).toContain('checkout.lockers.searchNoResults');
  });
};

function defineFanCourierFetchBranchesSpec(): void {
  it('covers fan-courier fetch non-ok and success parsing branches', async () => {
    const fetchSpy = spyOn(globalThis as any, 'fetch');
    lockerPickerComponent.provider = 'fan_courier';

    fetchSpy.and.returnValue(Promise.resolve({ ok: false, json: () => Promise.resolve([]) } as any));
    await (lockerPickerComponent as any).fetchLocations('Cluj');
    expect(lockerPickerComponent.searchError).toContain('checkout.lockers.searchError');

    fetchSpy.and.returnValue(
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            { display_name: 'Cluj', lat: '46.7', lon: '23.6' },
            { display_name: '', lat: 'x', lon: 'y' },
          ]),
      } as any)
    );
    lockerPickerComponent.searchError = '';
    await (lockerPickerComponent as any).fetchLocations('Cluj');
    expect(lockerPickerComponent.searchResults.length).toBeGreaterThan(0);
    expect(lockerPickerComponent.searchResults[0].display_name).toContain('Cluj');
  });
};

function defineProviderChangeRefreshSpec(): void {
  it('resets transient state and refreshes nearby results when provider changes after initialization', () => {
    const refreshSpy = spyOn<any>(lockerPickerComponent as any, 'refreshMirrorSnapshot').and.returnValue(Promise.resolve());
    const searchAreaSpy = spyOn(lockerPickerComponent, 'searchThisArea');
    const selectSpy = spyOn(lockerPickerComponent, 'selectLocker').and.callThrough();
    lockerPickerComponent.searchResults = [{ display_name: 'Old', lat: 1, lng: 2 }];
    lockerPickerComponent.searchError = 'old error';
    lockerPickerComponent.searchQuery = 'old query';
    lockerPickerComponent.mirrorSnapshot = { stale: true } as any;
    (lockerPickerComponent as any).initialized = true;

    lockerPickerComponent.provider = 'fan_courier';
    lockerPickerComponent.ngOnChanges({
      provider: new SimpleChange('sameday', 'fan_courier', false),
    });

    expect(selectSpy).toHaveBeenCalledWith(null);
    expect(lockerPickerComponent.searchResults).toEqual([]);
    expect(lockerPickerComponent.searchError).toBe('');
    expect(lockerPickerComponent.searchQuery).toBe('');
    expect(lockerPickerComponent.mirrorSnapshot).toBeNull();
    expect(searchAreaSpy).toHaveBeenCalled();

    lockerPickerComponent.provider = 'sameday';
    lockerPickerComponent.ngOnChanges({
      provider: new SimpleChange('fan_courier', 'sameday', false),
    });
    expect(refreshSpy).toHaveBeenCalled();
  });
}

function defineSelectedChangeRedrawSpec(): void {
  it('redraws markers when selected locker input changes after initialization', () => {
    const redrawSpy = spyOn<any>(lockerPickerComponent as any, 'redrawMarkers');
    (lockerPickerComponent as any).initialized = true;

    lockerPickerComponent.ngOnChanges({
      selected: new SimpleChange(null, { id: 'locker-1' } as any, false),
    });

    expect(redrawSpy).toHaveBeenCalled();
  });
}

function defineAbortErrorSuppressionSpec(): void {
  it('suppresses user-facing errors for aborted sameday city searches', async () => {
    lockerPickerComponent.provider = 'sameday';
    lockerPickerComponent.searchError = 'stale error';
    lockerPickerShipping.listLockerCities.and.returnValue(throwError(() => ({ name: 'AbortError' })));

    await (lockerPickerComponent as any).fetchLocations('Bucuresti');

    expect(lockerPickerComponent.searchLoading).toBeFalse();
    expect(lockerPickerComponent.searchResults).toEqual([]);
    expect(lockerPickerComponent.searchError).toBe('');
  });
}

function defineDestroyCleanupSpec(): void {
  it('cleans map resources, timers, and abort controllers on destroy', () => {
    const mapRemoveSpy = jasmine.createSpy('remove');
    const controller = new AbortController();
    const abortSpy = spyOn(controller, 'abort').and.callThrough();
    (lockerPickerComponent as any).map = { remove: mapRemoveSpy } as any;
    (lockerPickerComponent as any).markers = {} as any;
    (lockerPickerComponent as any).searchTimer = globalThis.setTimeout(() => void 0, 1000);
    (lockerPickerComponent as any).searchAbort = controller;

    lockerPickerComponent.ngOnDestroy();

    expect(mapRemoveSpy).toHaveBeenCalled();
    expect(abortSpy).toHaveBeenCalled();
    expect((lockerPickerComponent as any).map).toBeNull();
    expect((lockerPickerComponent as any).markers).toBeNull();
    expect((lockerPickerComponent as any).searchAbort).toBeNull();
  });
}

function defineMirrorSnapshotRefreshGuardSpec(): void {
  it('skips or tolerates mirror snapshot refresh based on provider and failures', async () => {
    lockerPickerShipping.listLockerCities.calls.reset();
    lockerPickerComponent.provider = 'fan_courier';
    await (lockerPickerComponent as any).refreshMirrorSnapshot();
    expect(lockerPickerShipping.listLockerCities).not.toHaveBeenCalled();

    lockerPickerComponent.provider = 'sameday';
    lockerPickerComponent.mirrorSnapshot = { stale: true } as any;
    lockerPickerShipping.listLockerCities.and.returnValue(throwError(() => new Error('mirror unavailable')));
    await (lockerPickerComponent as any).refreshMirrorSnapshot();
    expect(lockerPickerComponent.mirrorSnapshot?.stale).toBeTrue();
  });
}


