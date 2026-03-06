export type IdentityLike = {
  name?: string | null;
  username?: string | null;
  name_tag?: number | null;
  email?: string | null;
  id?: string | null;
};

const trimValue = (value: string | null | undefined): string => (value || '').trim();

const buildDisplayName = (name: string, username: string, tag: number | null | undefined): string => {
  if (!name || !username) return '';
  return typeof tag === 'number' ? `${name}#${tag} (${username})` : `${name} (${username})`;
};

const pickPrimarySource = (identity: IdentityLike): string =>
  [trimValue(identity.name), trimValue(identity.username), trimValue(identity.email)].find(Boolean) || '';

const initialsFromSource = (source: string): string =>
  source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');

export function formatIdentity(identity: IdentityLike | null | undefined, fallback = ''): string {
  if (!identity) return fallback;
  const name = trimValue(identity.name);
  const username = trimValue(identity.username);
  const formatted = buildDisplayName(name, username, identity.name_tag);
  if (formatted) return formatted;

  return [name, username, trimValue(identity.email), trimValue(identity.id), fallback].find(Boolean) || '';
}

export function initialsFromIdentity(identity: IdentityLike | null | undefined, fallback = '?'): string {
  if (!identity) return fallback;
  const source = pickPrimarySource(identity);
  if (!source) return fallback;

  return initialsFromSource(source) || source.charAt(0).toUpperCase();
}
