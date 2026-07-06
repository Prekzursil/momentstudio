/**
 * Curated theme-editor control model (P1a WU10).
 *
 * The pure, framework-free description of the admin theme editor's controls: the
 * exact set of ADMIN-EDITABLE tokens (the WU2 `ADMIN_EDITABLE_NAMES`), grouped
 * into the three editorial sections the UI renders — Colour / Typography /
 * Spacing — plus the curated option lists for the enum controls (fonts, the
 * type-scale, the spacing steps) and the `R G B` <-> hex conversions the colour
 * controls need. Kept separate from the Angular component so this logic is unit
 * testable without a browser and cannot drift from the frozen registry: the
 * `controlNames()` set is pinned to `ADMIN_EDITABLE_NAMES` by the spec.
 *
 * Every option value here is pre-validated against the WU2 registry
 * (`validateAdminEditable`) by the spec, so a curated control can only ever emit
 * an allowlisted value — defence-in-depth ABOVE the runtime validator the
 * component still routes each edit through.
 */

import { FONT_FAMILY_ALLOWLIST } from '../../../core/theme/token-registry';
import { getToken } from '../../../core/theme/token-taxonomy';

/** The kind of control rendered for a token. */
export type ControlKind = 'color' | 'font' | 'size' | 'space';

/** The three editorial sections the editor groups its controls into. */
export type GroupKey = 'color' | 'type' | 'spacing';

/** One selectable option for an enum control (font / size / spacing). */
export interface PresetOption {
  /** The token value emitted when chosen (frozen WU0 §4 wire format). */
  readonly value: string;
  /** i18n label key for the option. */
  readonly labelKey: string;
}

/** A single editor control for one admin-editable token. */
export interface EditorControl {
  /** The `--token` name (a member of `ADMIN_EDITABLE_NAMES`). */
  readonly name: string;
  /** The control kind (drives which input renders). */
  readonly kind: ControlKind;
  /** i18n label key for the control. */
  readonly labelKey: string;
  /** Curated options for an enum control; absent for free-value colours. */
  readonly options?: readonly PresetOption[];
}

/** A titled group of controls (one editorial section). */
export interface ControlGroup {
  readonly key: GroupKey;
  /** i18n label key for the section heading. */
  readonly labelKey: string;
  readonly controls: readonly EditorControl[];
}

/** Human labels for the curated font-family enum (index-aligned to the allowlist). */
const FONT_LABEL_KEYS: readonly string[] = [
  'adminUi.theme.fonts.inter',
  'adminUi.theme.fonts.cinzel',
  'adminUi.theme.fonts.systemSans',
  'adminUi.theme.fonts.systemSerif',
  'adminUi.theme.fonts.mono',
];

/** The curated font-family options (the WU2 allowlist, labelled). */
export const FONT_OPTIONS: readonly PresetOption[] = FONT_FAMILY_ALLOWLIST.map(
  (value, index): PresetOption => ({
    value,
    labelKey: FONT_LABEL_KEYS[index] ?? 'adminUi.theme.fonts.custom',
  }),
);

/** The curated type-scale presets for `--font-size-base` (all valid clamps). */
export const SIZE_OPTIONS: readonly PresetOption[] = [
  { value: 'clamp(14px, 1vw + 11px, 16px)', labelKey: 'adminUi.theme.sizes.compact' },
  { value: 'clamp(15px, 1.2vw + 12px, 18px)', labelKey: 'adminUi.theme.sizes.default' },
  { value: 'clamp(16px, 1.4vw + 13px, 20px)', labelKey: 'adminUi.theme.sizes.comfortable' },
  { value: 'clamp(17px, 1.6vw + 14px, 22px)', labelKey: 'adminUi.theme.sizes.large' },
];

/** The curated spacing-step presets (numeric+unit, WU2 numeric type). */
export const SPACE_OPTIONS: readonly PresetOption[] = [
  { value: '0.25rem', labelKey: 'adminUi.theme.spaces.4' },
  { value: '0.5rem', labelKey: 'adminUi.theme.spaces.8' },
  { value: '0.75rem', labelKey: 'adminUi.theme.spaces.12' },
  { value: '1rem', labelKey: 'adminUi.theme.spaces.16' },
  { value: '1.25rem', labelKey: 'adminUi.theme.spaces.20' },
  { value: '1.5rem', labelKey: 'adminUi.theme.spaces.24' },
  { value: '2rem', labelKey: 'adminUi.theme.spaces.32' },
  { value: '2.5rem', labelKey: 'adminUi.theme.spaces.40' },
  { value: '3rem', labelKey: 'adminUi.theme.spaces.48' },
];

function color(name: string, labelKey: string): EditorControl {
  return { name, kind: 'color', labelKey };
}

function font(name: string, labelKey: string): EditorControl {
  return { name, kind: 'font', labelKey, options: FONT_OPTIONS };
}

function space(name: string, labelKey: string): EditorControl {
  return { name, kind: 'space', labelKey, options: SPACE_OPTIONS };
}

/**
 * The frozen editor group model — the nine primary colours, the two curated
 * fonts + the type-scale, and the five spacing anchors, in render order. The
 * flattened name set equals `ADMIN_EDITABLE_NAMES` (pinned by the spec).
 */
export const EDITOR_GROUPS: readonly ControlGroup[] = [
  {
    key: 'color',
    labelKey: 'adminUi.theme.groups.color',
    controls: [
      color('--background', 'adminUi.theme.tokens.background'),
      color('--surface', 'adminUi.theme.tokens.surface'),
      color('--surface-inverse', 'adminUi.theme.tokens.surfaceInverse'),
      color('--text', 'adminUi.theme.tokens.text'),
      color('--text-heading', 'adminUi.theme.tokens.textHeading'),
      color('--text-muted', 'adminUi.theme.tokens.textMuted'),
      color('--border', 'adminUi.theme.tokens.border'),
      color('--accent', 'adminUi.theme.tokens.accent'),
      color('--overlay', 'adminUi.theme.tokens.overlay'),
    ],
  },
  {
    key: 'type',
    labelKey: 'adminUi.theme.groups.type',
    controls: [
      font('--font-body', 'adminUi.theme.tokens.fontBody'),
      font('--font-heading', 'adminUi.theme.tokens.fontHeading'),
      {
        name: '--font-size-base',
        kind: 'size',
        labelKey: 'adminUi.theme.tokens.fontSizeBase',
        options: SIZE_OPTIONS,
      },
    ],
  },
  {
    key: 'spacing',
    labelKey: 'adminUi.theme.groups.spacing',
    controls: [
      space('--space-xs', 'adminUi.theme.tokens.spaceXs'),
      space('--space-sm', 'adminUi.theme.tokens.spaceSm'),
      space('--space-md', 'adminUi.theme.tokens.spaceMd'),
      space('--space-lg', 'adminUi.theme.tokens.spaceLg'),
      space('--space-xl', 'adminUi.theme.tokens.spaceXl'),
    ],
  },
];

/** Every editor control, flattened in render order. */
export const ALL_CONTROLS: readonly EditorControl[] = EDITOR_GROUPS.flatMap(
  (group) => group.controls,
);

/** The flat set of editable token names the editor exposes (pinning contract). */
export function controlNames(): readonly string[] {
  return ALL_CONTROLS.map((control) => control.name);
}

/** The subset of control names that are colour controls (the pairing overlay). */
export function colorControlNames(): readonly string[] {
  return ALL_CONTROLS.filter((control) => control.kind === 'color').map((control) => control.name);
}

/** Clamp a raw channel to the sRGB integer range 0-255. */
function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * Convert a frozen `R G B` triplet ("15 23 42") to a `#rrggbb` hex string for a
 * native `<input type="color">`. A malformed triplet degrades to black so the
 * picker always has a valid value (the authoritative value stays the triplet).
 */
export function tripletToHex(triplet: string): string {
  const parts = triplet.trim().split(/\s+/);
  if (parts.length !== 3) {
    return '#000000';
  }
  const channels = parts.map(Number);
  if (channels.some((channel) => !Number.isFinite(channel))) {
    return '#000000';
  }
  return `#${channels.map((channel) => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Convert a `#rgb` / `#rrggbb` hex string (from the colour picker) back to the
 * frozen space-separated `R G B` triplet wire format. A malformed hex degrades
 * to "0 0 0" — the runtime `validateAdminEditable` gate is still the authority.
 */
export function hexToTriplet(hex: string): string {
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) {
    return '0 0 0';
  }
  let digits = match[1];
  if (digits.length === 3) {
    digits = digits
      .split('')
      .map((digit) => digit + digit)
      .join('');
  }
  const red = parseInt(digits.slice(0, 2), 16);
  const green = parseInt(digits.slice(2, 4), 16);
  const blue = parseInt(digits.slice(4, 6), 16);
  return `${red} ${green} ${blue}`;
}

/**
 * The compiled-default value for an editable token — the seed the editor opens
 * on when the draft omits a key. Sourced from the WU3 taxonomy; falls back to an
 * empty string only for a name absent from the taxonomy (never happens for a
 * control name, which is pinned to the taxonomy by the spec).
 */
export function compiledDefault(name: string): string {
  return getToken(name)?.compiledDefault ?? '';
}
