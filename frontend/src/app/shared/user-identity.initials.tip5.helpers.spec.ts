import { initialsFromIdentity } from './user-identity';

/** Golden WU tip orphan — initialsFromIdentity. */
describe('initialsFromIdentity (golden WU tip5)', () => {
  it('derives up to two initials from identity fields', () => {
    expect(initialsFromIdentity(null, '?')).toBe('?');
    expect(initialsFromIdentity({ name: 'Ada Lovelace' })).toBe('AL');
    expect(initialsFromIdentity({ username: 'ada_lovelace' })).toBe('AL');
  });
});
