import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';

import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { WishlistService } from './wishlist.service';
import { Product } from './catalog.service';

class AuthServiceStub {
  readonly userSignal: WritableSignal<{ id: string } | null> = signal<{ id: string } | null>(null);
  user = () => this.userSignal();
  isAuthenticated(): boolean {
    return this.userSignal() !== null;
  }
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    base_price: 100,
    sale_price: null,
    stock_quantity: 5,
    ...overrides,
  } as Product;
}

describe('WishlistService', () => {
  let api: jasmine.SpyObj<ApiService>;
  let auth: AuthServiceStub;

  function setup(): WishlistService {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post', 'delete']);
    api.get.and.returnValue(of([]));
    api.post.and.returnValue(of(product()));
    api.delete.and.returnValue(of(undefined));
    auth = new AuthServiceStub();

    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
        WishlistService,
      ],
    });
    return TestBed.inject(WishlistService);
  }

  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty and unloaded for an anonymous user', () => {
    const service = setup();
    TestBed.tick();
    expect(service.items()).toEqual([]);
    expect(service.isLoaded()).toBeFalse();
    expect(service.snapshots()).toEqual({});
  });

  it('loads the wishlist and builds baselines when a user signs in', () => {
    const service = setup();
    api.get.and.returnValue(of([product({ id: 'a', base_price: 10, stock_quantity: 2 })]));
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();

    expect(service.items().length).toBe(1);
    expect(service.isLoaded()).toBeTrue();
    expect(service.isWishlisted('a')).toBeTrue();
    expect(service.getBaseline('a')?.price).toBe(10);
  });

  it('clears state and snapshots when the user signs out', () => {
    const service = setup();
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();
    auth.userSignal.set(null);
    TestBed.tick();
    expect(service.items()).toEqual([]);
    expect(service.snapshots()).toEqual({});
  });

  it('ensureLoaded short-circuits when already loaded or loading or anonymous', () => {
    const service = setup();
    TestBed.tick();
    // anonymous -> not authenticated
    service.ensureLoaded();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('ensureLoaded short-circuits when already loaded', () => {
    const service = setup();
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();
    expect(service.isLoaded()).toBeTrue();
    api.get.calls.reset();
    service.ensureLoaded();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('treats a null wishlist payload as an empty list', () => {
    const service = setup();
    api.get.and.returnValue(of(null as never));
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();
    expect(service.items()).toEqual([]);
    expect(service.isLoaded()).toBeTrue();
  });

  it('handles a load error by resetting state', () => {
    const service = setup();
    api.get.and.returnValue(throwError(() => new Error('boom')));
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();
    expect(service.items()).toEqual([]);
    expect(service.isLoaded()).toBeFalse();
  });

  it('refresh re-fetches the wishlist', () => {
    const service = setup();
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();
    api.get.calls.reset();
    api.get.and.returnValue(of([product({ id: 'b' })]));
    service.refresh();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(service.isWishlisted('b')).toBeTrue();
  });

  it('add and remove call the API and normalize the product', () => {
    const service = setup();
    api.post.and.returnValue(of(product({ id: 'c', base_price: '12' as never })));
    let added: Product | undefined;
    service.add('c').subscribe((p) => (added = p));
    expect(api.post).toHaveBeenCalledWith('/wishlist/c', {});
    expect(added?.base_price).toBe(12);

    service.remove('c').subscribe();
    expect(api.delete).toHaveBeenCalledWith('/wishlist/c');
  });

  it('addLocal adds once and removeLocal removes with baselines', () => {
    const service = setup();
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();

    service.addLocal(product({ id: 'd' }));
    service.addLocal(product({ id: 'd' })); // duplicate ignored
    expect(service.items().filter((p) => p.id === 'd').length).toBe(1);
    expect(service.getBaseline('d')).not.toBeNull();

    service.removeLocal('d');
    expect(service.isWishlisted('d')).toBeFalse();
    expect(service.getBaseline('d')).toBeNull();
  });

  it('does not write baselines for an anonymous user', () => {
    const service = setup();
    TestBed.tick();
    service.addLocal(product({ id: 'e' }));
    expect(service.getBaseline('e')).toBeNull();
  });

  it('effectivePrice prefers a finite lower sale price', () => {
    const service = setup();
    expect(service.effectivePrice(product({ base_price: 100, sale_price: 80 }))).toBe(80);
    expect(service.effectivePrice(product({ base_price: 100, sale_price: 120 }))).toBe(100);
    expect(service.effectivePrice(product({ base_price: 100, sale_price: null }))).toBe(100);
  });

  it('normalizeProduct coerces nullable money fields', () => {
    const service = setup();
    api.post.and.returnValue(of(product({ id: 'f', sale_value: '5' as never, sale_price: null })));
    let added: Product | undefined;
    service.add('f').subscribe((p) => (added = p));
    expect(added?.sale_price).toBeNull();
    expect(added?.sale_value).toBe(5);
  });

  it('restores snapshots from localStorage for a returning user', () => {
    localStorage.setItem(
      'wishlist_snapshot:u9',
      JSON.stringify({ z: { saved_at: 't', price: 1, stock_quantity: 0 } }),
    );
    const service = setup();
    auth.userSignal.set({ id: 'u9' });
    TestBed.tick();
    expect(service.getBaseline('z')?.price).toBe(1);
  });

  it('tolerates corrupt and non-object snapshot storage', () => {
    localStorage.setItem('wishlist_snapshot:u8', '{bad json');
    const service = setup();
    auth.userSignal.set({ id: 'u8' });
    TestBed.tick();
    expect(service.snapshots()).toEqual({});

    auth.userSignal.set(null);
    TestBed.tick();
    localStorage.setItem('wishlist_snapshot:u7', JSON.stringify('not-an-object'));
    auth.userSignal.set({ id: 'u7' });
    TestBed.tick();
    expect(service.snapshots()).toEqual({});
  });

  it('ensureBaselines skips products without an id and persists once', () => {
    const service = setup();
    api.get.and.returnValue(
      of([product({ id: '' }), product({ id: 'g', stock_quantity: null as never })]),
    );
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();
    expect(service.getBaseline('g')?.stock_quantity).toBeNull();
    expect(service.getBaseline('')).toBeNull();
  });

  it('normalizeProduct keeps a present sale_price', () => {
    const service = setup();
    api.post.and.returnValue(of(product({ id: 'sp', sale_price: '7' as never })));
    let added: Product | undefined;
    service.add('sp').subscribe((p) => (added = p));
    expect(added?.sale_price).toBe(7);
  });

  it('does not overwrite an existing baseline on reload', () => {
    const service = setup();
    api.get.and.returnValue(of([product({ id: 'k', base_price: 50 })]));
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();
    const firstSavedAt = service.getBaseline('k')?.saved_at;

    api.get.and.returnValue(of([product({ id: 'k', base_price: 999 })]));
    service.refresh();
    expect(service.getBaseline('k')?.saved_at).toBe(firstSavedAt);
    expect(service.getBaseline('k')?.price).toBe(50);
  });

  it('upsertBaseline tolerates a null stock quantity', () => {
    const service = setup();
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();
    service.addLocal(product({ id: 'ns', stock_quantity: null as never }));
    expect(service.getBaseline('ns')?.stock_quantity).toBeNull();
  });

  it('skips baseline writes when the user signs out before the load resolves', () => {
    const service = setup();
    const subject = new Subject<Product[]>();
    api.get.and.returnValue(subject.asObservable());
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();
    // Sign out while the request is still in-flight, then resolve it.
    auth.userSignal.set(null);
    TestBed.tick();
    subject.next([product({ id: 'late' })]);
    subject.complete();
    expect(service.getBaseline('late')).toBeNull();
  });

  it('deleteBaseline is a no-op for unknown ids', () => {
    const service = setup();
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();
    expect(() => service.removeLocal('never-existed')).not.toThrow();
  });

  it('persistSnapshots ignores localStorage write failures', () => {
    const service = setup();
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();
    spyOn(localStorage, 'setItem').and.throwError('quota');
    expect(() => service.addLocal(product({ id: 'h' }))).not.toThrow();
  });

  it('removeLocal skips baseline deletion for an anonymous user', () => {
    const service = setup();
    TestBed.tick();
    expect(() => service.removeLocal('anon-item')).not.toThrow();
    expect(service.getBaseline('anon-item')).toBeNull();
  });

  it('persistSnapshots is a no-op without an active user', () => {
    const service = setup();
    TestBed.tick();
    expect(() =>
      (
        service as unknown as { persistSnapshots: (n: Record<string, unknown>) => void }
      ).persistSnapshots({}),
    ).not.toThrow();
  });

  it('snapshot persistence is skipped when localStorage is unavailable (SSR)', () => {
    const service = setup();
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    try {
      Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
      const internals = service as unknown as {
        loadSnapshots: (userId: string) => Record<string, unknown>;
        persistSnapshots: (next: Record<string, unknown>) => void;
        activeUserId: string | null;
      };
      expect(internals.loadSnapshots('u1')).toEqual({});
      internals.activeUserId = 'u1';
      expect(() => internals.persistSnapshots({})).not.toThrow();
    } finally {
      if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
    }
  });
});
