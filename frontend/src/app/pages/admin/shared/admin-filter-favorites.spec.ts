import { adminFilterFavoriteKey, AdminFilterFavoriteScope } from './admin-filter-favorites';

describe('adminFilterFavoriteKey', () => {
  it('builds a namespaced key for each scope using the same filters', () => {
    const filters = { status: 'open', page: 2 };
    const scopes: AdminFilterFavoriteScope[] = ['orders', 'products', 'users'];

    for (const scope of scopes) {
      const key = adminFilterFavoriteKey(scope, filters);
      expect(key.startsWith(`filter:${scope}:`)).toBeTrue();
    }
  });

  it('is deterministic for equal filter payloads', () => {
    const a = adminFilterFavoriteKey('orders', { q: 'abc', sort: 'asc' });
    const b = adminFilterFavoriteKey('orders', { q: 'abc', sort: 'asc' });
    expect(a).toBe(b);
  });

  it('produces different hashes for different filter payloads', () => {
    const a = adminFilterFavoriteKey('orders', { q: 'abc' });
    const b = adminFilterFavoriteKey('orders', { q: 'xyz' });
    expect(a).not.toBe(b);
  });

  it('encodes the hash in base36 (no characters outside [0-9a-z])', () => {
    const key = adminFilterFavoriteKey('products', { category: 'tools' });
    const hash = key.replace('filter:products:', '');
    expect(hash.length).toBeGreaterThan(0);
    expect(/^[0-9a-z]+$/.test(hash)).toBeTrue();
  });

  it('treats null and undefined filters as the same empty payload (nullish branch)', () => {
    const nullKey = adminFilterFavoriteKey('users', null);
    const undefinedKey = adminFilterFavoriteKey('users', undefined);
    // Both go through `value ?? null` -> JSON.stringify(null) === "null"
    expect(nullKey).toBe(undefinedKey);
    expect(nullKey).toBe('filter:users:x0xxgk');
  });

  it('keeps a defined falsy value distinct from null (left side of nullish coalescing)', () => {
    // 0 is falsy but not nullish, so it must NOT collapse to null.
    const zeroKey = adminFilterFavoriteKey('orders', 0);
    const nullKey = adminFilterFavoriteKey('orders', null);
    expect(zeroKey).not.toBe(nullKey);
    expect(zeroKey).toBe('filter:orders:epw9f3');
  });

  it('falls back to String(value) when JSON.stringify throws (catch branch)', () => {
    // A circular reference makes JSON.stringify throw, exercising the catch path.
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    const key = adminFilterFavoriteKey('orders', circular);
    // String({}) -> "[object Object]"; hashing must still succeed.
    const expected = adminFilterFavoriteKeyViaString(circular);
    expect(key).toBe(expected);
    expect(key.startsWith('filter:orders:')).toBeTrue();
  });
});

// Mirror of the production string-fallback hashing so the catch-branch assertion
// checks REAL output rather than just "some string".
function adminFilterFavoriteKeyViaString(value: unknown): string {
  const payload = String(value);
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `filter:orders:${(hash >>> 0).toString(36)}`;
}
