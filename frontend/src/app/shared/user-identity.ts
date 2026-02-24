export type IdentityLike = {
  name?: string | null;
  username?: string | null;
  name_tag?: number | null;
  email?: string | null;
  id?: string | null;
};

export function formatIdentity(identity: IdentityLike | null | undefined, fallback = ''): string {
  if (!identity) return fallback;
  const name = (identity.name ?? '').trim();
  const username = (identity.username ?? '').trim();
  const tag = identity.name_tag;

  if (name && username && typeof tag === 'number') {
    return `${name}#${tag} (${username})`;
  }
  if (name && username) {
    return `${name} (${username})`;
  }

  const email = (identity.email ?? '').trim();
  const id = (identity.id ?? '').trim();
  return name || username || email || id || fallback;
}

export function initialsFromIdentity(identity: IdentityLike | null | undefined, fallback = '?'): string {
  if (!identity) return fallback;
  const name = (identity.name ?? '').trim();
  const username = (identity.username ?? '').trim();
  const email = (identity.email ?? '').trim();
  const src = name || username || email;
  if (!src) return fallback;

  const letters = src
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase())
    .filter(Boolean);
  return (letters.slice(0, 2).join('') || src.slice(0, 1).toUpperCase());
}


