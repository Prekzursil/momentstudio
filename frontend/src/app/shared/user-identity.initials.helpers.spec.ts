import { initialsFromIdentity } from './user-identity';

/** Golden WU shared-initials-from-identity — initialsFromIdentity. */
describe('initialsFromIdentity (golden WU tip)', () => {
  it('builds initials with fallbacks across identity fields', () => {
    expect(initialsFromIdentity(null)).toBe('?');
    expect(initialsFromIdentity(undefined, '*')).toBe('*');
    expect(initialsFromIdentity({}, 'X')).toBe('X');
    expect(initialsFromIdentity({ name: 'Ada Lovelace' })).toBe('AL');
    expect(initialsFromIdentity({ username: 'john.doe' })).toBe('JD');
    expect(initialsFromIdentity({ email: 'mary-jane@x.com' })).toBe('MJ');
    expect(initialsFromIdentity({ name: '-' })).toBe('-');
  });
});
