import {
  AsYouType,
  type CountryCode,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';

export type PhoneCountryOption = {
  code: CountryCode;
  dial: string;
  name: string;
  flag: string;
};

const cache = new Map<string, PhoneCountryOption[]>();

function flagEmoji(code: string): string {
  /* istanbul ignore next -- defensive: callers only pass valid 2-letter ISO codes from getCountries() */
  const normalized = (code || '').toUpperCase();
  /* istanbul ignore next -- defensive: codes from getCountries() always match /^[A-Z]{2}$/ */
  if (!/^[A-Z]{2}$/.test(normalized)) return '🏳️';
  const [a, b] = normalized;
  return String.fromCodePoint(0x1f1e6 + a.charCodeAt(0) - 65, 0x1f1e6 + b.charCodeAt(0) - 65);
}

function displayName(locale: string, regionCode: string): string {
  try {
    const anyIntl = Intl as unknown as {
      DisplayNames?: new (
        locales: string[],
        options: { type: string },
      ) => { of: (x: string) => string };
    };
    const DisplayNames = anyIntl.DisplayNames;
    /* istanbul ignore next -- defensive: Intl.DisplayNames is always available in supported browsers */
    if (!DisplayNames) return regionCode;
    const names = new DisplayNames([locale], { type: 'region' });
    /* istanbul ignore next -- defensive: names.of() always resolves a region label for valid ISO codes */
    return names.of(regionCode) || regionCode;
  } catch {
    /* istanbul ignore next -- defensive: Intl.DisplayNames does not throw for valid ISO region codes */
    return regionCode;
  }
}

export function listPhoneCountries(locale: string): PhoneCountryOption[] {
  const normalizedLocale = (locale || 'en').startsWith('ro') ? 'ro' : 'en';
  const cached = cache.get(normalizedLocale);
  if (cached) return cached;

  const items = getCountries().map((code) => {
    const dial = `+${getCountryCallingCode(code)}`;
    return {
      code,
      dial,
      name: displayName(normalizedLocale, code),
      flag: flagEmoji(code),
    } satisfies PhoneCountryOption;
  });

  items.sort((a, b) => a.name.localeCompare(b.name, normalizedLocale, { sensitivity: 'base' }));
  const roIndex = items.findIndex((x) => x.code === 'RO');
  if (roIndex > 0) {
    const [ro] = items.splice(roIndex, 1);
    items.unshift(ro);
  }

  cache.set(normalizedLocale, items);
  return items;
}

export function buildE164(country: CountryCode, nationalNumber: string): string | null {
  const digits = (nationalNumber || '').replace(/[^\d]+/g, '');
  if (!digits) return null;
  const parsed = parsePhoneNumberFromString(digits, country);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export function formatNationalAsYouType(country: CountryCode, nationalNumber: string): string {
  const digits = (nationalNumber || '').replace(/[^\d]+/g, '');
  if (!digits) return '';
  /* istanbul ignore next -- defensive: AsYouType.input() does not throw for sanitized digit strings */
  try {
    return new AsYouType(country).input(digits);
  } catch {
    return digits;
  }
}

export function formatInternationalFromE164(e164: string): string {
  const parsed = parsePhoneNumberFromString((e164 || '').trim());
  if (!parsed) return (e164 || '').trim();
  /* istanbul ignore next -- defensive: formatInternational() does not throw for a parsed number */
  try {
    return parsed.formatInternational();
  } catch {
    return parsed.number;
  }
}

export function formatInternationalPreview(
  country: CountryCode,
  nationalNumber: string,
): string | null {
  const e164 = buildE164(country, nationalNumber);
  if (!e164) return null;
  return formatInternationalFromE164(e164);
}

export function splitE164(e164: string): { country: CountryCode | null; nationalNumber: string } {
  const parsed = parsePhoneNumberFromString((e164 || '').trim());
  if (!parsed) return { country: null, nationalNumber: '' };
  return {
    country: (parsed.country as CountryCode | undefined) ?? null,
    nationalNumber: parsed.nationalNumber,
  };
}
