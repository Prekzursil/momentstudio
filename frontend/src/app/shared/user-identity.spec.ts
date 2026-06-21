import { formatIdentity, initialsFromIdentity } from './user-identity';

describe('user-identity', () => {
  describe('formatIdentity', () => {
    it('returns the fallback when identity is null or undefined', () => {
      expect(formatIdentity(null)).toBe('');
      expect(formatIdentity(undefined, 'guest')).toBe('guest');
    });

    it('formats name, tag and username when all are present', () => {
      expect(formatIdentity({ name: 'Ada', username: 'ada', name_tag: 7 })).toBe('Ada#7 (ada)');
    });

    it('formats name and username when the tag is not a number', () => {
      expect(formatIdentity({ name: 'Ada', username: 'ada', name_tag: null })).toBe('Ada (ada)');
    });

    it('falls back to the first non-empty field', () => {
      expect(formatIdentity({ username: 'ada' })).toBe('ada');
      expect(formatIdentity({ email: 'a@b.com' })).toBe('a@b.com');
      expect(formatIdentity({ id: 'id-1' })).toBe('id-1');
    });

    it('uses the fallback when nothing is set', () => {
      expect(formatIdentity({}, 'anon')).toBe('anon');
      expect(formatIdentity({ name: null, username: null, email: null, id: null }, 'anon')).toBe(
        'anon',
      );
    });
  });

  describe('initialsFromIdentity', () => {
    it('returns the fallback for null identity', () => {
      expect(initialsFromIdentity(null)).toBe('?');
      expect(initialsFromIdentity(undefined, '*')).toBe('*');
    });

    it('returns the fallback when there is no usable source', () => {
      expect(initialsFromIdentity({}, 'X')).toBe('X');
    });

    it('builds two-letter initials from a name', () => {
      expect(initialsFromIdentity({ name: 'Ada Lovelace' })).toBe('AL');
    });

    it('uses username then email as the source', () => {
      expect(initialsFromIdentity({ username: 'john.doe' })).toBe('JD');
      expect(initialsFromIdentity({ email: 'mary-jane@x.com' })).toBe('MJ');
    });

    it('falls back to the first character when split yields no letters', () => {
      // A source made only of separators splits into empty parts, so the
      // letters array is empty and the slice(0, 1) fallback path runs.
      expect(initialsFromIdentity({ name: '-' })).toBe('-');
    });
  });
});
