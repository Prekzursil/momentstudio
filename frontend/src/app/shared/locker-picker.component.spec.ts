import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import * as L from 'leaflet';
import { of, throwError } from 'rxjs';

import { LazyStylesService } from '../core/lazy-styles.service';
import { LockerCitySearchResponse, LockerRead, ShippingService } from '../core/shipping.service';
import { LockerPickerComponent } from './locker-picker.component';

type Private = {
  map: import('leaflet').Map | null;
  markers: import('leaflet').LayerGroup | null;
  leaflet: typeof import('leaflet') | null;
  initialized: boolean;
  lastCenter: { lat: number; lng: number };
  mapHost?: { nativeElement: HTMLDivElement };
  searchTimer: number | null;
  searchAbort: AbortController | null;
  loadLeaflet: () => Promise<typeof import('leaflet')>;
  fetchLocations: (q: string, opts?: { applyFirst?: boolean }) => Promise<void>;
  loadLockers: (lat: number, lng: number) => Promise<void>;
  refreshMirrorSnapshot: () => Promise<void>;
  redrawMarkers: () => void;
  haversineKm: (a: number, b: number, c: number, d: number) => number;
};

function locker(overrides: Partial<LockerRead> = {}): LockerRead {
  return {
    id: 'l1',
    provider: 'sameday',
    name: 'Locker 1',
    address: 'Str. Test 1',
    lat: 44.43,
    lng: 26.1,
    distance_km: 1.2,
    ...overrides,
  } as LockerRead;
}

function citiesResponse() {
  return {
    items: [
      {
        provider: 'sameday',
        city: 'Bucuresti',
        county: 'Ilfov',
        display_name: 'Bucuresti, Ilfov',
        lat: 44.43,
        lng: 26.1,
        locker_count: 42,
      },
      // Invalid rows that must be filtered out.
      { provider: 'sameday', display_name: '', lat: 1, lng: 2 },
      { provider: 'sameday', display_name: 'NaN coords', lat: 'x', lng: 'y' },
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
      canary_alert_codes: ['schema_drift'],
      canary_alert_messages: ['schema changed'],
    },
  } as unknown as LockerCitySearchResponse;
}

describe('LockerPickerComponent', () => {
  let shipping: jasmine.SpyObj<ShippingService>;

  beforeEach(async () => {
    shipping = jasmine.createSpyObj<ShippingService>('ShippingService', [
      'listLockers',
      'listLockerCities',
    ]);
    shipping.listLockers.and.returnValue(of([]));
    shipping.listLockerCities.and.returnValue(of(citiesResponse()));

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), LockerPickerComponent],
      providers: [
        { provide: ShippingService, useValue: shipping },
        { provide: LazyStylesService, useValue: { ensure: () => Promise.resolve() } },
      ],
    }).compileComponents();
  });

  function make(): ComponentFixture<LockerPickerComponent> {
    return TestBed.createComponent(LockerPickerComponent);
  }

  function priv(fixture: ComponentFixture<LockerPickerComponent>): Private {
    return fixture.componentInstance as unknown as Private;
  }

  // A fake map that always includes `remove` so component teardown stays safe.
  function fakeMap(extra: Record<string, unknown>): import('leaflet').Map {
    return { remove: () => {}, ...extra } as unknown as import('leaflet').Map;
  }

  // ---- Lifecycle (with stubbed map) ---------------------------------------

  it('initializes and loads the sameday snapshot on view init', fakeAsync(() => {
    const fixture = make();
    spyOn(fixture.componentInstance, 'initMap').and.returnValue(Promise.resolve());
    fixture.detectChanges();
    tick();
    expect(shipping.listLockerCities).toHaveBeenCalled();
    expect(fixture.componentInstance.mirrorSnapshot?.stale).toBeTrue();
  }));

  it('does not load a snapshot for non-sameday providers on init', fakeAsync(() => {
    const fixture = make();
    fixture.componentInstance.provider = 'fan_courier';
    spyOn(fixture.componentInstance, 'initMap').and.returnValue(Promise.resolve());
    shipping.listLockerCities.calls.reset();
    fixture.detectChanges();
    tick();
    expect(shipping.listLockerCities).not.toHaveBeenCalled();
  }));

  it('refreshMirrorSnapshot returns early for non-sameday and swallows errors', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    cmp.provider = 'fan_courier';
    shipping.listLockerCities.calls.reset();
    await priv(fixture).refreshMirrorSnapshot();
    expect(shipping.listLockerCities).not.toHaveBeenCalled();

    cmp.provider = 'sameday';
    shipping.listLockerCities.and.returnValue(throwError(() => new Error('boom')));
    await priv(fixture).refreshMirrorSnapshot();
    expect(cmp.mirrorSnapshot).toBeNull();
  });

  it('refreshMirrorSnapshot nulls the snapshot when the response omits it', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    cmp.provider = 'sameday';
    cmp.mirrorSnapshot = { stale: true } as never;
    shipping.listLockerCities.and.returnValue(of(undefined as unknown as LockerCitySearchResponse));
    await priv(fixture).refreshMirrorSnapshot();
    expect(cmp.mirrorSnapshot).toBeNull();
  });

  // ---- Search query handling ----------------------------------------------

  it('debounces queries of three or more characters', fakeAsync(() => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    const fetchSpy = spyOn(priv(fixture), 'fetchLocations').and.returnValue(Promise.resolve());

    cmp.onSearchQueryChange('ab');
    expect(cmp.searchResults).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();

    // First long query schedules a timer.
    cmp.onSearchQueryChange('bucuresti');
    // Second long query clears the pending timer before rescheduling.
    cmp.onSearchQueryChange('bucuresti now');
    tick(250);
    expect(fetchSpy).toHaveBeenCalledWith('bucuresti now');
  }));

  it('searchFirstResult applies an existing result, fetches, or no-ops', fakeAsync(() => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    const applySpy = spyOn(cmp, 'applyLocation').and.callThrough();
    const fetchSpy = spyOn(priv(fixture), 'fetchLocations').and.returnValue(Promise.resolve());

    cmp.searchQuery = '   ';
    cmp.searchFirstResult();
    expect(applySpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    cmp.searchQuery = 'bucu';
    cmp.searchResults = [{ display_name: 'A', lat: 44, lng: 26 }];
    cmp.searchFirstResult();
    expect(applySpy).toHaveBeenCalled();

    // applyLocation clears the query, so restore it before the no-results path.
    cmp.searchQuery = 'bucu';
    cmp.searchResults = [];
    cmp.searchFirstResult();
    expect(fetchSpy).toHaveBeenCalledWith('bucu', { applyFirst: true });
  }));

  it('clears the search query and the selected location', () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    cmp.searchQuery = 'x';
    cmp.searchResults = [{ display_name: 'A', lat: 1, lng: 2 }];
    cmp.searchError = 'err';
    cmp.clearSearchQuery();
    expect(cmp.searchQuery).toBe('');
    expect(cmp.searchResults).toEqual([]);

    cmp.selectedLocation = { display_name: 'A', lat: 1, lng: 2 };
    cmp.clearSelectedLocation();
    expect(cmp.selectedLocation).toBeNull();
  });

  // ---- fetchLocations: sameday --------------------------------------------

  it('fetches sameday cities, filtering invalid rows', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    cmp.provider = 'sameday';
    await priv(fixture).fetchLocations('Bucu');
    expect(cmp.searchResults.length).toBe(1);
    expect(cmp.searchResults[0].display_name).toBe('Bucuresti, Ilfov');
    expect(cmp.searchResults[0].locker_count).toBe(42);
  });

  it('treats a non-array sameday items payload as empty', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    cmp.provider = 'sameday';
    shipping.listLockerCities.and.returnValue(
      of({ items: 'nope', snapshot: null } as unknown as LockerCitySearchResponse),
    );
    await priv(fixture).fetchLocations('Bucu');
    expect(cmp.searchResults).toEqual([]);
  });

  it('applies the first sameday result when requested', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    const applySpy = spyOn(cmp, 'applyLocation');
    cmp.provider = 'sameday';
    await priv(fixture).fetchLocations('Bucu', { applyFirst: true });
    expect(applySpy).toHaveBeenCalled();
  });

  it('reports no sameday results when applying the first of an empty list', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    cmp.provider = 'sameday';
    shipping.listLockerCities.and.returnValue(
      of({ items: [], snapshot: null } as unknown as LockerCitySearchResponse),
    );
    await priv(fixture).fetchLocations('zzz', { applyFirst: true });
    expect(cmp.searchError).toContain('searchNoResults');
  });

  it('surfaces a sameday search error', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    cmp.provider = 'sameday';
    shipping.listLockerCities.and.returnValue(throwError(() => new Error('boom')));
    await priv(fixture).fetchLocations('Bucu');
    expect(cmp.searchError).toContain('searchError');
  });

  // ---- fetchLocations: nominatim (non-sameday) ----------------------------

  it('fetches nominatim results, filtering invalid entries', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    cmp.provider = 'fan_courier';
    const body = JSON.stringify([
      { display_name: 'Cluj', lat: '46.77', lon: '23.59' },
      { display_name: '', lat: '1', lon: '2' },
      { display_name: 'Bad', lat: 'x', lon: 'y' },
      // Present keys but falsy coords -> exercises the `|| ''` map fallbacks.
      { display_name: 'ZeroCoord', lat: 0, lon: 0 },
      { nope: true },
    ]);
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(new Response(body, { status: 200 })));
    await priv(fixture).fetchLocations('Cluj');
    expect(cmp.searchResults.length).toBe(1);
    expect(cmp.searchResults[0].display_name).toBe('Cluj');
  });

  it('treats a non-array nominatim payload as empty', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    cmp.provider = 'fan_courier';
    spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(new Response(JSON.stringify({ not: 'an array' }), { status: 200 })),
    );
    await priv(fixture).fetchLocations('Cluj');
    expect(cmp.searchResults).toEqual([]);
  });

  it('applies the first nominatim result and reports empty results', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    cmp.provider = 'fan_courier';
    const applySpy = spyOn(cmp, 'applyLocation');
    spyOn(window, 'fetch').and.returnValues(
      Promise.resolve(
        new Response(JSON.stringify([{ display_name: 'Cluj', lat: '46.7', lon: '23.5' }]), {
          status: 200,
        }),
      ),
      Promise.resolve(new Response(JSON.stringify([]), { status: 200 })),
    );
    await priv(fixture).fetchLocations('Cluj', { applyFirst: true });
    expect(applySpy).toHaveBeenCalled();

    await priv(fixture).fetchLocations('zzz', { applyFirst: true });
    expect(cmp.searchError).toContain('searchNoResults');
  });

  it('handles a non-ok nominatim response', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    cmp.provider = 'fan_courier';
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(new Response('', { status: 500 })));
    await priv(fixture).fetchLocations('Cluj');
    expect(cmp.searchError).toContain('searchError');
  });

  it('ignores aborted nominatim requests but surfaces other errors', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    cmp.provider = 'fan_courier';
    const fetchSpy = spyOn(window, 'fetch');

    fetchSpy.and.returnValue(
      Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );
    await priv(fixture).fetchLocations('Cluj');
    expect(cmp.searchError).toBe('');

    fetchSpy.and.returnValue(Promise.reject(new Error('network')));
    await priv(fixture).fetchLocations('Cluj');
    expect(cmp.searchError).toContain('searchError');
  });

  it('ignores aborted sameday requests but surfaces other errors', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    cmp.provider = 'sameday';
    shipping.listLockerCities.and.returnValue(
      throwError(() => Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );
    await priv(fixture).fetchLocations('Bucu');
    expect(cmp.searchError).toBe('');
  });

  // ---- loadLockers ---------------------------------------------------------

  it('loads lockers and tolerates a non-array payload', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    shipping.listLockers.and.returnValue(of([locker(), locker({ id: 'l2' })]));
    await priv(fixture).loadLockers(44, 26);
    expect(cmp.lockers.length).toBe(2);
    expect(cmp.loading).toBeFalse();

    shipping.listLockers.and.returnValue(of(null as unknown as LockerRead[]));
    await priv(fixture).loadLockers(44, 26);
    expect(cmp.lockers).toEqual([]);
  });

  it('surfaces a generic locker error for non-sameday providers without a detail', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    cmp.provider = 'fan_courier';
    shipping.listLockers.and.returnValue(throwError(() => ({})));
    await priv(fixture).loadLockers(44, 26);
    expect(cmp.error).toContain('checkout.lockers.error');
  });

  it('shows the mirror unavailable message for sameday mirror errors', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    cmp.provider = 'sameday';
    shipping.listLockers.and.returnValue(
      throwError(() => ({ error: { detail: 'Sameday locker mirror is not initialized' } })),
    );
    await priv(fixture).loadLockers(44, 26);
    expect(cmp.error).toContain('mirrorUnavailable');
  });

  it('shows the mirror unavailable message for sameday locker errors without "mirror"', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    cmp.provider = 'sameday';
    shipping.listLockers.and.returnValue(
      throwError(() => ({ error: { detail: 'no locker available nearby' } })),
    );
    await priv(fixture).loadLockers(44, 26);
    expect(cmp.error).toContain('mirrorUnavailable');
  });

  // ---- selectLocker / applyLocation ---------------------------------------

  it('selectLocker emits and pans when a map exists', () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    const emitted: (LockerRead | null)[] = [];
    cmp.selectedChange.subscribe((l) => emitted.push(l));

    cmp.selectLocker(null);
    expect(emitted[0]).toBeNull();

    const panTo = jasmine.createSpy('panTo');
    priv(fixture).map = fakeMap({ panTo });
    const l = locker();
    cmp.selectLocker(l);
    expect(emitted[1]).toBe(l);
    expect(panTo).toHaveBeenCalledWith([l.lat, l.lng]);
  });

  it('applyLocation sets state and triggers a search', () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    const setView = jasmine.createSpy('setView');
    priv(fixture).map = fakeMap({ setView });
    const searchSpy = spyOn(cmp, 'searchThisArea');
    cmp.applyLocation({ display_name: 'Cluj', lat: 46.7, lng: 23.5 });
    expect(cmp.selectedLocation?.display_name).toBe('Cluj');
    expect(setView).toHaveBeenCalledWith([46.7, 23.5], 13);
    expect(searchSpy).toHaveBeenCalled();
  });

  // ---- ngOnChanges ---------------------------------------------------------

  it('ngOnChanges ignores the first provider change', () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    const selectSpy = spyOn(cmp, 'selectLocker');
    cmp.ngOnChanges({ provider: { firstChange: true, currentValue: 'sameday' } as never });
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('ngOnChanges resets state when the provider switches to sameday', () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    const refreshSpy = spyOn(priv(fixture), 'refreshMirrorSnapshot').and.returnValue(
      Promise.resolve(),
    );
    const searchSpy = spyOn(cmp, 'searchThisArea');
    priv(fixture).initialized = true;
    cmp.provider = 'sameday';
    cmp.searchQuery = 'x';
    cmp.ngOnChanges({ provider: { firstChange: false, currentValue: 'sameday' } as never });
    expect(refreshSpy).toHaveBeenCalled();
    expect(searchSpy).toHaveBeenCalled();
    expect(cmp.searchQuery).toBe('');
  });

  it('ngOnChanges clears the snapshot when switching away from sameday', () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    spyOn(cmp, 'searchThisArea');
    cmp.provider = 'fan_courier';
    cmp.mirrorSnapshot = { stale: false } as never;
    // initialized stays false -> searchThisArea not triggered here.
    cmp.ngOnChanges({ provider: { firstChange: false, currentValue: 'fan_courier' } as never });
    expect(cmp.mirrorSnapshot).toBeNull();
  });

  it('ngOnChanges redraws markers when the selection changes', () => {
    const fixture = make();
    const redrawSpy = spyOn(priv(fixture), 'redrawMarkers');
    priv(fixture).initialized = true;
    fixture.componentInstance.ngOnChanges({
      selected: { firstChange: false, currentValue: locker() } as never,
    });
    expect(redrawSpy).toHaveBeenCalled();
  });

  // ---- track-by helpers & staleDays ---------------------------------------

  it('exposes stable track-by identities', () => {
    const cmp = make().componentInstance;
    expect(cmp.trackLocker(0, locker({ id: 'abc' }))).toBe('abc');
    expect(cmp.trackLocation(0, { display_name: 'X', lat: 1, lng: 2 })).toBe('1,2,X');
  });

  it('computes the stale-snapshot age in days', () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    expect(cmp.staleDays()).toBe(30);
    cmp.mirrorSnapshot = { stale_age_seconds: 0 } as never;
    expect(cmp.staleDays()).toBe(30);
    cmp.mirrorSnapshot = { stale_age_seconds: 86400 * 3 } as never;
    expect(cmp.staleDays()).toBe(3);
  });

  // ---- geolocation ---------------------------------------------------------

  it('reports an error when geolocation is unavailable', () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    try {
      cmp.useMyLocation();
      expect(cmp.error).toContain('noGeolocation');
    } finally {
      if (original) Object.defineProperty(navigator, 'geolocation', original);
    }
  });

  it('recenters the map on the resolved position and handles denials', () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    const setView = jasmine.createSpy('setView');
    priv(fixture).map = fakeMap({ setView });
    const searchSpy = spyOn(cmp, 'searchThisArea');
    const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');

    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (success: PositionCallback) =>
          success({ coords: { latitude: 45, longitude: 25 } } as GeolocationPosition),
      },
      configurable: true,
    });
    try {
      cmp.useMyLocation();
      expect(setView).toHaveBeenCalledWith([45, 25], 13);
      expect(searchSpy).toHaveBeenCalled();

      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition: (_s: PositionCallback, error: PositionErrorCallback) =>
            error({ code: 1 } as GeolocationPositionError),
        },
        configurable: true,
      });
      cmp.useMyLocation();
      expect(cmp.error).toContain('geoDenied');
    } finally {
      if (original) Object.defineProperty(navigator, 'geolocation', original);
    }
  });

  // ---- ngOnDestroy ---------------------------------------------------------

  it('cleans up the map, timer and abort controller on destroy', () => {
    const fixture = make();
    const remove = jasmine.createSpy('remove');
    const abort = jasmine.createSpy('abort');
    priv(fixture).map = { remove } as unknown as import('leaflet').Map;
    priv(fixture).searchTimer = 123;
    priv(fixture).searchAbort = { abort } as unknown as AbortController;
    fixture.destroy();
    expect(remove).toHaveBeenCalled();
    expect(abort).toHaveBeenCalled();
  });

  // ---- Real Leaflet map integration ---------------------------------------

  it('builds a real map and reacts to its events and markers', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    // Feed the eagerly-bundled Leaflet module through the import seam so this
    // integration test drives a real map without performing a network-backed
    // lazy chunk fetch (the source of the intermittent ChunkLoadError).
    spyOn(priv(fixture), 'loadLeaflet').and.returnValue(Promise.resolve(L));
    const host = document.createElement('div');
    host.style.width = '300px';
    host.style.height = '200px';
    document.body.appendChild(host);
    priv(fixture).mapHost = { nativeElement: host };

    try {
      await cmp.initMap();
      const p = priv(fixture);
      expect(p.map).toBeTruthy();
      expect(p.initialized).toBeTrue();

      // Second call returns early (already initialized).
      await cmp.initMap();

      // moveend updates the remembered center.
      p.map!.setView([45, 25], 12);
      p.map!.fire('moveend');
      expect(p.lastCenter.lat).toBeCloseTo(45, 0);

      // dragend with no selection short-circuits.
      cmp.selectedLocation = null;
      p.map!.fire('dragend');

      // dragend far from the selection clears it.
      cmp.selectedLocation = { display_name: 'far', lat: 0, lng: 0 };
      p.map!.fire('dragend');
      expect(cmp.selectedLocation).toBeNull();

      // dragend near the selection keeps it.
      const center = p.map!.getCenter();
      cmp.selectedLocation = { display_name: 'near', lat: center.lat, lng: center.lng };
      p.map!.fire('dragend');
      expect(cmp.selectedLocation).not.toBeNull();

      // redrawMarkers builds markers; firing a marker click selects the locker.
      cmp.lockers = [locker({ id: 'a' }), locker({ id: 'b' })];
      cmp.selected = locker({ id: 'a' });
      p.redrawMarkers();
      const selectSpy = spyOn(cmp, 'selectLocker').and.callThrough();
      p.markers!.eachLayer((layer) => (layer as import('leaflet').CircleMarker).fire('click'));
      expect(selectSpy).toHaveBeenCalled();
    } finally {
      document.body.removeChild(host);
    }
  });

  it('initMap returns early without a map host', async () => {
    const fixture = make();
    const cmp = fixture.componentInstance;
    priv(fixture).mapHost = undefined;
    await cmp.initMap();
    expect(priv(fixture).map).toBeNull();
  });

  it('loadLeaflet resolves the Leaflet module through the import seam', async () => {
    const fixture = make();
    // Exercises the real seam body. Because the spec statically imports Leaflet,
    // webpack bundles it eagerly, so this dynamic import resolves from the test
    // bundle rather than fetching a lazy runtime chunk over HTTP.
    const mod = await priv(fixture).loadLeaflet();
    expect(mod.map).toBe(L.map);
  });
});
