import { adminFilterFavoriteKey } from './admin-filter-favorites';

describe('adminFilterFavoriteKey', () => {
  it('is deterministic for identical scope and filter payload', () => {
    const filters = { q: 'abc', status: 'paid', page: 2 };
    const first = adminFilterFavoriteKey('orders', filters);
    const second = adminFilterFavoriteKey('orders', filters);
    expect(first).toBe(second);
    expect(first.startsWith('filter:orders:')).toBeTrue();
  });

  it('produces a different key for different scopes', () => {
    const filters = { q: 'abc' };
    const ordersKey = adminFilterFavoriteKey('orders', filters);
    const usersKey = adminFilterFavoriteKey('users', filters);
    expect(ordersKey).not.toBe(usersKey);
  });

  it('handles non-serializable payloads through string fallback', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const key = adminFilterFavoriteKey('products', circular);
    expect(key.startsWith('filter:products:')).toBeTrue();
  });
});

