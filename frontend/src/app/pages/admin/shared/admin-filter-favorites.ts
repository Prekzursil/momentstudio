export type AdminFilterFavoriteScope = 'orders' | 'products' | 'users';

export function adminFilterFavoriteKey(scope: AdminFilterFavoriteScope, filters: unknown): string {
  const payload = safeJson(filters);
  const hash = fnv1a(payload).toString(36);
  return `filter:${scope}:${hash}`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
}

function fnv1a(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

