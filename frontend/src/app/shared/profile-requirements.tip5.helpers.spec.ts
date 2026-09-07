import { isProfileComplete, missingRequiredProfileFields } from './profile-requirements';

/** Golden WU tip orphan — profile requirement helpers. */
describe('profile requirement helpers (golden WU tip5)', () => {
  it('lists missing fields and detects completeness', () => {
    expect(missingRequiredProfileFields(null)).toContain('phone');
    expect(isProfileComplete({
      name: 'Ada',
      username: 'ada',
      first_name: 'Ada',
      last_name: 'Lovelace',
      date_of_birth: '1990-01-01',
      phone: '+40123456789',
    })).toBeTrue();
  });
});
