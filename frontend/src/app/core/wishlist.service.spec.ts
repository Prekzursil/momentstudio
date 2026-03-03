import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';

import { ApiService } from './api.service';
import { AuthService, AuthUser } from './auth.service';
import { Product } from './catalog.service';
import { WishlistService, WishlistSnapshotEntry } from './wishlist.service';

function createUser(id: string): AuthUser {
  return {
    id,
    email: `${id}@example.com`,
    username: id,
    role: 'user'
  };
}

function createProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    slug: 'product-1',
    name: 'Product 1',
    base_price: 120,
    sale_price: 90,
    sale_value: 30,
    currency: 'RON',
    stock_quantity: 5,
    ...overrides
  };
}

class AuthServiceStub {
  private readonly userState = signal<AuthUser | null>(null);

  readonly user = (): AuthUser | null => this.userState();
  readonly isAuthenticated = jasmine.createSpy('isAuthenticated').and.callFake((): boolean => this.userState() !== null);

  setUser(user: AuthUser | null): void {
    this.userState.set(user);
  }
}

function flushSignalEffects(): void {
  TestBed.flushEffects();
}

describe('WishlistService', () => {
  let api: jasmine.SpyObj<Pick<ApiService, 'get' | 'post' | 'delete'>>;
  let auth: AuthServiceStub;

  beforeEach(() => {
    localStorage.clear();
    api = jasmine.createSpyObj<Pick<ApiService, 'get' | 'post' | 'delete'>>('ApiService', ['get', 'post', 'delete']);
    auth = new AuthServiceStub();

    TestBed.configureTestingModule({
      providers: [
        WishlistService,
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth }
      ]
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  function createService(): WishlistService {
    const service = TestBed.inject(WishlistService);
    flushSignalEffects();
    return service;
  }

  it('loads, normalizes, and snapshots remote wishlist items for authenticated users', () => {
    auth.setUser(createUser('user-load'));
    const remoteProduct = {
      id: 'remote-1',
      slug: 'remote-1',
      name: 'Remote Product',
      base_price: '150.25',
      sale_price: '99.5',
      sale_value: '50.75',
      currency: 'RON',
      stock_quantity: 12
    } satisfies Record<string, unknown>;
    api.get.and.returnValue(of([remoteProduct] as unknown as Product[]));

    const service = createService();
    const items = service.items();

    expect(api.get).toHaveBeenCalledWith('/wishlist');
    expect(service.isLoaded()).toBeTrue();
    expect(items.length).toBe(1);
    expect(items[0].base_price).toBeCloseTo(150.25, 2);
    expect(items[0].sale_price).toBeCloseTo(99.5, 2);
    expect(items[0].sale_value).toBeCloseTo(50.75, 2);
    expect(service.isWishlisted('remote-1')).toBeTrue();

    const baseline = service.getBaseline('remote-1');
    expect(baseline).not.toBeNull();
    if (!baseline) {
      fail('Expected baseline snapshot to exist');
      return;
    }
    expect(baseline.price).toBeCloseTo(99.5, 2);
    expect(baseline.stock_quantity).toBe(12);

    const storedRaw = localStorage.getItem('wishlist_snapshot:user-load');
    expect(storedRaw).not.toBeNull();
    const stored = JSON.parse(storedRaw ?? '{}') as Record<string, WishlistSnapshotEntry>;
    expect(stored['remote-1'].price).toBeCloseTo(99.5, 2);
  });

  it('resets to an empty unloaded state when wishlist loading fails', () => {
    auth.setUser(createUser('user-error'));
    api.get.and.returnValue(throwError(() => new Error('wishlist failed')));

    const service = createService();

    expect(api.get).toHaveBeenCalledWith('/wishlist');
    expect(service.items()).toEqual([]);
    expect(service.isLoaded()).toBeFalse();
  });

  it('does not load when unauthenticated and keeps refresh side-effect free', () => {
    api.get.and.returnValue(of([]));
    const service = createService();

    service.ensureLoaded();
    service.refresh();

    expect(api.get).not.toHaveBeenCalled();
    expect(service.items()).toEqual([]);
    expect(service.isLoaded()).toBeFalse();
  });

  it('deduplicates local inserts and keeps snapshot storage in sync on remove', () => {
    auth.setUser(createUser('user-local'));
    api.get.and.returnValue(of([]));
    const service = createService();

    const localProduct = createProduct({
      id: 'local-1',
      sale_price: 80,
      base_price: 100,
      stock_quantity: 2
    });

    service.addLocal(localProduct);
    service.addLocal(localProduct);

    expect(service.items().length).toBe(1);
    expect(service.isWishlisted('local-1')).toBeTrue();
    expect(service.getBaseline('local-1')?.price).toBe(80);

    service.removeLocal('local-1');

    expect(service.items()).toEqual([]);
    expect(service.isWishlisted('local-1')).toBeFalse();
    expect(service.getBaseline('local-1')).toBeNull();

    const stored = JSON.parse(localStorage.getItem('wishlist_snapshot:user-local') ?? '{}') as Record<string, WishlistSnapshotEntry>;
    expect(stored['local-1']).toBeUndefined();
  });

  it('handles invalid stored snapshots and maps add/remove API calls', async () => {
    localStorage.setItem('wishlist_snapshot:user-invalid', '{invalid-json');
    auth.setUser(createUser('user-invalid'));
    api.get.and.returnValue(of([]));

    const addedRaw = {
      id: 'posted-1',
      slug: 'posted-1',
      name: 'Posted Product',
      base_price: '50',
      sale_price: '45',
      currency: 'RON'
    } satisfies Record<string, unknown>;
    api.post.and.returnValue(of(addedRaw as unknown as Product));
    api.delete.and.returnValue(of(void 0));

    const service = createService();

    expect(service.snapshots()).toEqual({});
    expect(service.effectivePrice(createProduct({ base_price: 100, sale_price: 80 }))).toBe(80);
    expect(service.effectivePrice(createProduct({ base_price: 100, sale_price: 120 }))).toBe(100);

    const added = await firstValueFrom(service.add('posted-1'));
    expect(api.post).toHaveBeenCalledWith('/wishlist/posted-1', {});
    expect(added.base_price).toBe(50);
    expect(added.sale_price).toBe(45);

    await firstValueFrom(service.remove('posted-1'));
    expect(api.delete).toHaveBeenCalledWith('/wishlist/posted-1');
  });
});
