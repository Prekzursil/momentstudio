import { TestBed } from '@angular/core/testing';

import { Product } from './catalog.service';
import { RecentlyViewedService } from './recently-viewed.service';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    slug: 'slug-1',
    name: 'Product 1',
    base_price: 10,
    currency: 'RON',
    images: [{ url: 'https://x/img.png' }],
    ...overrides,
  } as Product;
}

describe('RecentlyViewedService', () => {
  let service: RecentlyViewedService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [RecentlyViewedService] });
    service = TestBed.inject(RecentlyViewedService);
    localStorage.clear();
    // Clear the cookie fallback.
    document.cookie = 'recently_viewed=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  afterEach(() => {
    localStorage.clear();
    document.cookie = 'recently_viewed=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('returns an empty list when nothing is stored', () => {
    expect(service.list()).toEqual([]);
  });

  it('adds a product and reads it back', () => {
    const result = service.add(makeProduct());
    expect(result.length).toBe(1);
    expect(result[0].slug).toBe('slug-1');
    expect(service.list()[0].slug).toBe('slug-1');
  });

  it('uses default currency and empty images when missing', () => {
    const result = service.add(makeProduct({ currency: '', images: undefined as never }));
    expect(result[0].currency).toBe('RON');
    expect(result[0].images).toEqual([]);
  });

  it('deduplicates by slug, moving the entry to the front', () => {
    service.add(makeProduct({ slug: 'a' }));
    service.add(makeProduct({ slug: 'b' }));
    const result = service.add(makeProduct({ slug: 'a' }));
    expect(result.map((p) => p.slug)).toEqual(['a', 'b']);
  });

  it('caps the stored list at the maximum number of items', () => {
    for (let i = 0; i < 15; i++) {
      service.add(makeProduct({ slug: `slug-${i}` }));
    }
    expect(service.list().length).toBe(12);
  });

  it('returns empty for non-array or invalid stored JSON', () => {
    localStorage.setItem('recently_viewed', 'not json');
    expect(service.list()).toEqual([]);

    localStorage.setItem('recently_viewed', JSON.stringify({ not: 'array' }));
    expect(service.list()).toEqual([]);
  });

  it('normalizes stored entries, dropping invalid ones', () => {
    localStorage.setItem(
      'recently_viewed',
      JSON.stringify([
        null,
        'string',
        { slug: 123 },
        { slug: '' },
        { slug: 'dup' },
        { slug: 'dup' },
        {
          id: '',
          slug: 'fix',
          name: 123,
          base_price: 'NaN',
          currency: '  ',
          images: 'bad',
        },
        { slug: 'imgs', images: [{ url: 'ok' }, { url: 123 }, null] },
      ]),
    );
    const list = service.list();
    const fix = list.find((p) => p.slug === 'fix');
    expect(list.filter((p) => p.slug === 'dup').length).toBe(1);
    expect(fix?.id).toBe('fix');
    expect(fix?.name).toBe('');
    expect(fix?.base_price).toBe(0);
    expect(fix?.currency).toBe('RON');
    expect(fix?.images).toEqual([]);
    const imgs = list.find((p) => p.slug === 'imgs');
    expect(imgs?.images?.length).toBe(1);
  });

  it('rewrites storage when normalization changes the raw value', () => {
    localStorage.setItem('recently_viewed', JSON.stringify([{ slug: 'x' }]));
    service.list();
    const stored = JSON.parse(localStorage.getItem('recently_viewed') || '[]');
    expect(stored[0].currency).toBe('RON');
  });

  it('reads from the cookie when localStorage has no value', () => {
    const payload = JSON.stringify([{ slug: 'cookie-item' }]);
    document.cookie = `recently_viewed=${encodeURIComponent(payload)}; path=/`;
    const list = service.list();
    expect(list.some((p) => p.slug === 'cookie-item')).toBe(true);
  });

  it('falls back to the cookie when localStorage access throws', () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('blocked');
    const payload = JSON.stringify([{ slug: 'cookie-item' }]);
    document.cookie = `recently_viewed=${encodeURIComponent(payload)}; path=/`;
    expect(service.list().some((p) => p.slug === 'cookie-item')).toBe(true);
  });

  it('ignores localStorage write failures and falls back to the cookie', () => {
    spyOn(Storage.prototype, 'setItem').and.throwError('blocked');
    expect(() => service.add(makeProduct({ slug: 'wcookie' }))).not.toThrow();
  });

  it('reads through to the cookie helper when localStorage is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });
    try {
      const payload = JSON.stringify([{ slug: 'no-ls' }]);
      document.cookie = `recently_viewed=${encodeURIComponent(payload)}; path=/`;
      expect(service.list().some((p) => p.slug === 'no-ls')).toBe(true);
      expect(() => service.add(makeProduct({ slug: 'no-ls-write' }))).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });

  it('returns null from the cookie reader when there is no matching cookie', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });
    try {
      document.cookie = 'recently_viewed=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
      document.cookie = 'unrelated=value; path=/';
      expect(service.list()).toEqual([]);
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});
