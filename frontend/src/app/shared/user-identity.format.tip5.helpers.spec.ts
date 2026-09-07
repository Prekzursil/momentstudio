import { formatIdentity } from './user-identity';

/** Golden WU tip orphan — formatIdentity. */
describe('formatIdentity (golden WU tip5)', () => {
  it('formats name/tag/username and falls back cleanly', () => {
    expect(formatIdentity(null, 'guest')).toBe('guest');
    expect(formatIdentity({ name: 'Ada', username: 'ada', name_tag: 7 })).toBe('Ada#7 (ada)');
    expect(formatIdentity({ email: 'a@b.c' })).toBe('a@b.c');
  });
});
