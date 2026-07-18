import { ADMIN_EDITABLE_NAMES } from '../../../core/theme/token-registry';
import { validateAdminEditable } from '../../../core/theme/token-validation';
import {
  ALL_CONTROLS,
  EDITOR_GROUPS,
  FONT_OPTIONS,
  SIZE_OPTIONS,
  SPACE_OPTIONS,
  colorControlNames,
  compiledDefault,
  controlNames,
  hexToTriplet,
  tripletToHex,
} from './theme-editor-controls';

describe('theme-editor-controls', () => {
  it('exposes EXACTLY the admin-editable token set (pinned to the registry)', () => {
    expect([...controlNames()].sort()).toEqual([...ADMIN_EDITABLE_NAMES].sort());
    // 9 colours + 3 type + 5 spacing = 17.
    expect(ALL_CONTROLS.length).toBe(17);
  });

  it('groups the controls into colour / type / spacing sections', () => {
    expect(EDITOR_GROUPS.map((group) => group.key)).toEqual(['color', 'type', 'spacing']);
    const byKey = new Map(EDITOR_GROUPS.map((group) => [group.key, group.controls.length]));
    expect(byKey.get('color')).toBe(9);
    expect(byKey.get('type')).toBe(3);
    expect(byKey.get('spacing')).toBe(5);
  });

  it('lists exactly the nine colour controls for the pairing overlay', () => {
    expect(colorControlNames().length).toBe(9);
    expect(colorControlNames()).toContain('--accent');
    expect(colorControlNames()).not.toContain('--font-body');
  });

  it('never exposes a derived / ramp token — the client edit gate rejects one', () => {
    expect(controlNames()).not.toContain('--surface-muted');
    // The runtime gate the editor routes through hard-rejects a derived key.
    const rejected = validateAdminEditable('--surface-muted', '10 20 30');
    expect(rejected.ok).toBeFalse();
    expect(rejected.value).toBe('');
  });

  it('offers only WU2-valid values for every enum control', () => {
    for (const option of FONT_OPTIONS) {
      expect(validateAdminEditable('--font-body', option.value).ok)
        .withContext(option.value)
        .toBeTrue();
    }
    for (const option of SIZE_OPTIONS) {
      expect(validateAdminEditable('--font-size-base', option.value).ok)
        .withContext(option.value)
        .toBeTrue();
    }
    for (const option of SPACE_OPTIONS) {
      expect(validateAdminEditable('--space-md', option.value).ok)
        .withContext(option.value)
        .toBeTrue();
    }
  });

  it('seeds every colour control with a WU2-valid compiled default', () => {
    for (const name of colorControlNames()) {
      const seed = compiledDefault(name);
      expect(seed).not.toBe('');
      expect(validateAdminEditable(name, seed).ok).withContext(name).toBeTrue();
    }
  });

  it('returns an empty compiled default for an unknown token', () => {
    expect(compiledDefault('--not-a-token')).toBe('');
  });

  describe('tripletToHex', () => {
    it('renders a valid triplet as lowercase #rrggbb', () => {
      expect(tripletToHex('15 23 42')).toBe('#0f172a');
      expect(tripletToHex('255 255 255')).toBe('#ffffff');
      expect(tripletToHex('0 0 0')).toBe('#000000');
    });

    it('clamps and rounds out-of-range / fractional channels', () => {
      expect(tripletToHex('300 -5 42.6')).toBe('#ff002b');
    });

    it('falls back to black for a malformed triplet', () => {
      expect(tripletToHex('15 23')).toBe('#000000');
      expect(tripletToHex('15 23 xx')).toBe('#000000');
      expect(tripletToHex('   ')).toBe('#000000');
    });
  });

  describe('hexToTriplet', () => {
    it('parses a #rrggbb hex into an R G B triplet', () => {
      expect(hexToTriplet('#0f172a')).toBe('15 23 42');
    });

    it('expands a #rgb shorthand (with or without the hash)', () => {
      expect(hexToTriplet('#fff')).toBe('255 255 255');
      expect(hexToTriplet('abc')).toBe('170 187 204');
    });

    it('falls back to 0 0 0 for a malformed hex', () => {
      expect(hexToTriplet('#12g')).toBe('0 0 0');
      expect(hexToTriplet('#1234567')).toBe('0 0 0');
      expect(hexToTriplet('nope')).toBe('0 0 0');
    });
  });
});
