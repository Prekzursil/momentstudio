import {
  type CountryCode,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString
} from 'libphonenumber-js';

export type PhoneCountryOption = {
  code: CountryCode;
  dial: string;
  name: string;
  flag: string;
};

const cache = new Map<string, PhoneCountryOption[]>();

function flagEmoji(code: string): string {
  const normalized = (code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return '🏳️';
  const [a, b] = normalized;
  return String.fromCodePoint(0x1f1e6 + a.charCodeAt(0) - 65, 0x1f1e6 + b.charCodeAt(0) - 65);
}

function displayName(locale: string, regionCode: string): string {
  try {
    const anyIntl = Intl as unknown as { DisplayNames?: new (locales: string[], options: { type: string }) => { of: (x: string) => string } };
    const DisplayNames = anyIntl.DisplayNames;
    if (!DisplayNames) return regionCode;
    const names = new DisplayNames([locale], { type: 'region' });
    return names.of(regionCode) || regionCode;
  } catch {
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
      flag: flagEmoji(code)
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

export function splitE164(e164: string): { country: CountryCode | null; nationalNumber: string } {
  const parsed = parsePhoneNumberFromString((e164 || '').trim());
  if (!parsed) return { country: null, nationalNumber: '' };
  return {
    country: (parsed.country as CountryCode | undefined) ?? null,
    nationalNumber: parsed.nationalNumber
  };
}
