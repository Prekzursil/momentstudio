import { Product } from './catalog.service';
import { RecentlyViewedService } from './recently-viewed.service';

describe('RecentlyViewedService item curation', () => {
  beforeEach(() => clearStorageAndCookie());
  afterEach(() => clearStorageAndCookie());

  it('adds items with dedupe and max cap behavior', () => {
    const service = new RecentlyViewedService();
    for (let i = 0; i < 13; i += 1) {
      service.add(makeProduct(i));
    }
    expect(service.list().length).toBe(12);
    expect(service.list()[0].slug).toBe('slug-12');

    service.add(makeProduct(99, { slug: 'slug-5', name: 'Updated Name' }));
    const list = service.list();
    expect(list[0].slug).toBe('slug-5');
    expect(list.filter((item) => item.slug === 'slug-5').length).toBe(1);
    expect(list[0].name).toBe('Updated Name');
  });

  it('normalizes malformed persisted payload and rewrites sanitized data', () => {
    const setItemSpy = spyOn(localStorage, 'setItem').and.callThrough();
    localStorage.setItem(
      'recently_viewed',
      JSON.stringify([
        null,
        { slug: 'a', id: '', name: 'A', base_price: 'x', currency: '', images: [{ url: '/ok.jpg' }, {}] },
        { slug: 'a', id: 'dup', name: 'Duplicate', base_price: 99, currency: 'EUR', images: [] },
        {},
      ])
    );

    const service = new RecentlyViewedService();
    const list = service.list();

    expect(list.length).toBe(1);
    expect(list[0].id).toBe('a');
    expect(list[0].slug).toBe('a');
    expect(list[0].base_price).toBe(0);
    expect(list[0].currency).toBe('RON');
    expect(list[0].images).toEqual([{ url: '/ok.jpg' }]);
    expect(setItemSpy).toHaveBeenCalled();
  });
});

describe('RecentlyViewedService persistence fallbacks', () => {
  beforeEach(() => clearStorageAndCookie());
  afterEach(() => clearStorageAndCookie());

  it('falls back to cookie reads when localStorage access fails', () => {
    spyOn(localStorage, 'getItem').and.throwError('blocked');
    const cookiePayload = encodeURIComponent(
      JSON.stringify([makeProduct(1, { slug: 'cookie-item', id: 'cookie-item' })])
    );
    document.cookie = `recently_viewed=${cookiePayload}; path=/`;

    const service = new RecentlyViewedService();
    const list = service.list();
    expect(list.length).toBe(1);
    expect(list[0].slug).toBe('cookie-item');
  });
});

function makeProduct(index: number, overrides: Partial<Product> = {}): Product {
  return {
    id: `id-${index}`,
    slug: `slug-${index}`,
    name: `Name ${index}`,
    base_price: index + 1,
    currency: 'RON',
    images: [{ url: `/img-${index}.jpg` }],
    ...overrides,
  } as Product;
}

function clearStorageAndCookie(): void {
  localStorage.removeItem('recently_viewed');
  document.cookie = 'recently_viewed=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
}
