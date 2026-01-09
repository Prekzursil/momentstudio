import { buildE164, listPhoneCountries, splitE164 } from './phone';

describe('phone utils', () => {
  it('lists countries with RO first', () => {
    const countries = listPhoneCountries('en');
    expect(countries.length).toBeGreaterThan(50);
    expect(countries[0].code).toBe('RO');
    expect(countries[0].dial).toBe('+40');
  });

  it('builds and splits E.164 numbers', () => {
    expect(buildE164('RO', '723204204')).toBe('+40723204204');
    expect(splitE164('+40723204204')).toEqual({ country: 'RO', nationalNumber: '723204204' });
  });

  it('returns null for invalid numbers', () => {
    expect(buildE164('RO', '123')).toBeNull();
  });
});

