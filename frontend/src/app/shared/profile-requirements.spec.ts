import { isProfileComplete, missingRequiredProfileFields } from './profile-requirements';

describe('profile requirements', () => {
  it('lists all required fields when user is null', () => {
    expect(missingRequiredProfileFields(null)).toEqual(['name', 'username', 'first_name', 'last_name', 'date_of_birth', 'phone']);
    expect(isProfileComplete(null)).toBeFalse();
  });

  it('returns an empty list for a complete profile', () => {
    const user = {
      name: 'Ana',
      username: 'ana2005l',
      first_name: 'Ana',
      last_name: 'Pop',
      date_of_birth: '2000-01-01',
      phone: '+40723204204'
    };
    expect(missingRequiredProfileFields(user)).toEqual([]);
    expect(isProfileComplete(user)).toBeTrue();
  });

  it('trims values and reports missing required fields', () => {
    const user = {
      name: '   ',
      username: ' ana2005l ',
      first_name: null,
      last_name: 'Pop',
      date_of_birth: '',
      phone: undefined
    };
    expect(missingRequiredProfileFields(user)).toEqual(['name', 'first_name', 'date_of_birth', 'phone']);
  });
});

