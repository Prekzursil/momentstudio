import {
  TAG_COLOR_PALETTE,
  TAG_COLOR_STORAGE_KEY,
  TagColor,
  loadTagColorOverrides,
  normalizeTagKey,
  persistTagColorOverrides,
  tagChipColorClass,
  tagColorFor,
} from './order-tag-colors';

/**
 * Temporarily replace the global `localStorage` binding with `undefined` so the
 * `typeof localStorage === 'undefined'` guard branch can be exercised in the
 * browser test runner (where `localStorage` is normally always present).
 */
function withoutLocalStorage(run: () => void): void {
  const hadOwn = Object.prototype.hasOwnProperty.call(window, 'localStorage');
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    value: undefined,
    configurable: true,
  });
  try {
    run();
  } finally {
    if (hadOwn && original) {
      Object.defineProperty(window, 'localStorage', original);
    } else {
      delete (window as unknown as { localStorage?: unknown }).localStorage;
    }
  }
}

describe('order-tag-colors', () => {
  afterEach(() => {
    localStorage.clear();
  });

  describe('static metadata', () => {
    it('exposes the eight-colour palette in declaration order', () => {
      expect(TAG_COLOR_PALETTE).toEqual([
        'slate',
        'indigo',
        'violet',
        'emerald',
        'amber',
        'rose',
        'sky',
        'teal',
      ]);
    });

    it('uses a versioned storage key', () => {
      expect(TAG_COLOR_STORAGE_KEY).toBe('admin.orders.tagColors.v1');
    });
  });

  describe('normalizeTagKey', () => {
    it('lowercases, trims and collapses internal whitespace to underscores', () => {
      expect(normalizeTagKey('  Fraud   Risk  ')).toBe('fraud_risk');
    });

    it('strips characters outside [a-z0-9_-]', () => {
      // Each run of disallowed chars sits between whitespace that first becomes
      // an underscore, so the cleaned key keeps the collapsed separators.
      expect(normalizeTagKey('VIP!! 💎 #1')).toBe('vip__1');
    });

    it('removes leading and trailing underscores or dashes', () => {
      expect(normalizeTagKey('--_hello-_')).toBe('hello');
    });

    it('returns an empty string for an empty input', () => {
      expect(normalizeTagKey('')).toBe('');
    });

    it('returns an empty string for a falsy (null/undefined) input', () => {
      expect(normalizeTagKey(null as unknown as string)).toBe('');
      expect(normalizeTagKey(undefined as unknown as string)).toBe('');
    });

    it('returns an empty string when only punctuation remains after cleaning', () => {
      expect(normalizeTagKey('***')).toBe('');
    });

    it('truncates the cleaned key to 50 characters', () => {
      const long = 'a'.repeat(120);
      const result = normalizeTagKey(long);
      expect(result.length).toBe(50);
      expect(result).toBe('a'.repeat(50));
    });
  });

  describe('loadTagColorOverrides', () => {
    it('returns an empty map when nothing is stored', () => {
      expect(loadTagColorOverrides()).toEqual({});
    });

    it('returns an empty map when localStorage is unavailable', () => {
      withoutLocalStorage(() => {
        expect(loadTagColorOverrides()).toEqual({});
      });
    });

    it('loads, normalises keys and keeps only valid palette colours', () => {
      localStorage.setItem(
        TAG_COLOR_STORAGE_KEY,
        JSON.stringify({
          ' VIP ': 'violet',
          gift: 'indigo',
          bad_color: 'not-a-color',
          nonString: 42,
          '***': 'rose',
        }),
      );

      expect(loadTagColorOverrides()).toEqual({
        vip: 'violet',
        gift: 'indigo',
      });
    });

    it('treats a stored JSON null as an empty override map', () => {
      localStorage.setItem(TAG_COLOR_STORAGE_KEY, 'null');
      expect(loadTagColorOverrides()).toEqual({});
    });

    it('returns an empty map and swallows errors on malformed JSON', () => {
      localStorage.setItem(TAG_COLOR_STORAGE_KEY, '{not valid json');
      expect(loadTagColorOverrides()).toEqual({});
    });

    it('returns an empty map when reading from storage throws', () => {
      spyOn(localStorage, 'getItem').and.throwError('boom');
      expect(loadTagColorOverrides()).toEqual({});
    });
  });

  describe('persistTagColorOverrides', () => {
    it('serialises the overrides into storage under the versioned key', () => {
      persistTagColorOverrides({ vip: 'violet' });
      expect(localStorage.getItem(TAG_COLOR_STORAGE_KEY)).toBe(JSON.stringify({ vip: 'violet' }));
    });

    it('serialises an empty object when given a nullish map', () => {
      persistTagColorOverrides(null as unknown as Record<string, TagColor>);
      expect(localStorage.getItem(TAG_COLOR_STORAGE_KEY)).toBe('{}');
    });

    it('does nothing when localStorage is unavailable', () => {
      withoutLocalStorage(() => {
        expect(() => persistTagColorOverrides({ vip: 'violet' })).not.toThrow();
      });
    });

    it('swallows errors when writing to storage throws', () => {
      spyOn(localStorage, 'setItem').and.throwError('quota');
      expect(() => persistTagColorOverrides({ vip: 'violet' })).not.toThrow();
    });

    it('round-trips through loadTagColorOverrides', () => {
      persistTagColorOverrides({ vip: 'violet', gift: 'indigo' });
      expect(loadTagColorOverrides()).toEqual({ vip: 'violet', gift: 'indigo' });
    });
  });

  describe('tagColorFor', () => {
    it('prefers a user override over every built-in rule', () => {
      expect(tagColorFor('VIP', { vip: 'teal' })).toBe('teal');
    });

    it('ignores overrides keyed for a different normalised tag', () => {
      expect(tagColorFor('VIP', { gift: 'teal' })).toBe('violet');
    });

    it('maps the known built-in tags to their semantic colours', () => {
      expect(tagColorFor('vip', {})).toBe('violet');
      expect(tagColorFor('fraud_risk', {})).toBe('amber');
      expect(tagColorFor('fraud_approved', {})).toBe('emerald');
      expect(tagColorFor('fraud_denied', {})).toBe('rose');
      expect(tagColorFor('gift', {})).toBe('indigo');
      expect(tagColorFor('test', {})).toBe('slate');
    });

    it('falls back to slate for an empty/blank tag', () => {
      expect(tagColorFor('', {})).toBe('slate');
      expect(tagColorFor('   ', {})).toBe('slate');
    });

    it('hashes unknown tags deterministically into the palette', () => {
      const first = tagColorFor('warehouse', {});
      const second = tagColorFor('warehouse', {});
      expect(first).toBe(second);
      expect(TAG_COLOR_PALETTE).toContain(first);
    });

    it('produces stable, distinct hashes for different unknown tags', () => {
      expect(tagColorFor('priority', {})).toBe(
        TAG_COLOR_PALETTE[
          Math.abs(
            'priority'.split('').reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) | 0, 0),
          ) % TAG_COLOR_PALETTE.length
        ],
      );
    });
  });

  describe('tagChipColorClass', () => {
    it('returns the Tailwind class string for the resolved colour', () => {
      const cls = tagChipColorClass('vip', {});
      expect(cls).toContain('violet');
      expect(cls).toContain('dark:');
    });

    it('honours an override when resolving the class string', () => {
      const cls = tagChipColorClass('vip', { vip: 'emerald' });
      expect(cls).toContain('emerald');
    });

    it('returns the slate class string for a blank tag', () => {
      expect(tagChipColorClass('', {})).toContain('slate');
    });
  });
});
