import {
  buildE164,
  formatInternationalFromE164,
  formatInternationalPreview,
  formatNationalAsYouType,
  listPhoneCountries,
  splitE164,
} from './phone';

describe('phone utils', () => {
  it('lists countries with RO first', () => {
    const countries = listPhoneCountries('en');
    expect(countries.length).toBeGreaterThan(50);
    expect(countries[0].code).toBe('RO');
    expect(countries[0].dial).toBe('+40');
    expect(countries[0].flag).toBeTruthy();
  });

  it('returns the cached list on subsequent calls for the same locale', () => {
    const first = listPhoneCountries('en');
    const second = listPhoneCountries('en');
    expect(second).toBe(first);
  });

  it('normalizes ro-prefixed and empty locales', () => {
    const ro = listPhoneCountries('ro-RO');
    expect(ro[0].code).toBe('RO');
    const dflt = listPhoneCountries('');
    expect(dflt.length).toBeGreaterThan(50);
  });

  it('builds and splits E.164 numbers', () => {
    expect(buildE164('RO', '723204204')).toBe('+40723204204');
    expect(splitE164('+40723204204')).toEqual({ country: 'RO', nationalNumber: '723204204' });
  });

  it('returns null for invalid or empty numbers', () => {
    expect(buildE164('RO', '123')).toBeNull();
    expect(buildE164('RO', '')).toBeNull();
    expect(buildE164('RO', 'abc')).toBeNull();
  });

  it('splits returns nulls for an unparseable string', () => {
    expect(splitE164('')).toEqual({ country: null, nationalNumber: '' });
    expect(splitE164('not-a-number')).toEqual({ country: null, nationalNumber: '' });
  });

  it('splits a valid number with no resolvable country to a null country', () => {
    // +870 (Inmarsat) parses as valid but has no ISO country -> `?? null` branch.
    const result = splitE164('+870773111632');
    expect(result.country).toBeNull();
    expect(result.nationalNumber).toBeTruthy();
  });

  it('formats a national number as-you-type and handles empties', () => {
    expect(formatNationalAsYouType('RO', '723204204')).toContain('7');
    expect(formatNationalAsYouType('RO', '')).toBe('');
    expect(formatNationalAsYouType('RO', '----')).toBe('');
  });

  it('formats an international number from E.164', () => {
    expect(formatInternationalFromE164('+40723204204')).toContain('+40');
    expect(formatInternationalFromE164('garbage')).toBe('garbage');
    expect(formatInternationalFromE164('')).toBe('');
  });

  it('builds an international preview or null when invalid', () => {
    expect(formatInternationalPreview('RO', '723204204')).toContain('+40');
    expect(formatInternationalPreview('RO', '12')).toBeNull();
  });
});
