/**
 * Curated normal-tier token taxonomy + seed palette (P1a WU3).
 *
 * The concrete P1a token vocabulary: the slate-mono + indigo-accent seed set,
 * each entry carrying (a) its WU0 §1 per-archetype surface-coverage map — the
 * surfaces it must repaint across the home / listing / detail archetypes, the
 * contract WU5 satisfies and WU10/WU11 assert; (b) its normal-tier vs power-only
 * classification (B12); and (c) its compiled default — the `var(--token,
 * <compiled-default>)` fallback that reproduces today's rendering.
 *
 * Names + compiled defaults are pinned to the frozen WU2 registry
 * (`token-registry.ts`) and mirror the backend WU1 seed
 * (`backend/app/services/theme_service.py::default_theme_tokens`). Every token
 * here resolves in that registry and its compiled default passes the registry's
 * per-type validator — verified by the spec beside this file. Wire format is the
 * WU0 spike memo §4: Tailwind-consumed color = bare `R G B` triplet;
 * font-family = curated enum; type/space = numeric+unit. Design refinement of
 * the exact seed values is a later carry (§13); this is the compiled-default
 * baseline.
 */

/** The three storefront archetypes the surface-coverage map spans (WU0 §1). */
export type Archetype = 'home' | 'listing' | 'detail';

/** All archetypes, in canonical order. */
export const ARCHETYPES: readonly Archetype[] = ['home', 'listing', 'detail'];

/**
 * Token tier (B12). `normal` = every offerable value yields a valid, non
 * layout-breaking render, so it ships as an admin control in P1a. `power` =
 * raw hex / arbitrary font-URL / arbitrary spacing — represented in the type
 * system but intentionally NOT shipped as a P1a admin control (a later tier).
 * The P1a seed set below is entirely `normal`.
 */
export type TokenTier = 'normal' | 'power';

/** The taxonomy value family (aligns with the WU2 registry token types). */
export type TaxonomyKind = 'color' | 'font' | 'size' | 'space';

/**
 * Per-archetype surface-coverage entry: the set of surfaces a token repaints
 * within each archetype's page (including the shared header/footer chrome that
 * renders on every archetype). Grounded in the WU0 §1 role map — never a surface
 * outside it. Every normal-tier token carries a non-empty list for all three.
 */
export interface SurfaceCoverage {
  readonly home: readonly string[];
  readonly listing: readonly string[];
  readonly detail: readonly string[];
}

/** A single curated taxonomy token. */
export interface TaxonomyToken {
  /** The `--token` name; a member of the frozen WU2 registry. */
  readonly name: string;
  /** The value family. */
  readonly kind: TaxonomyKind;
  /** Ships as a P1a admin control (`normal`) vs modelled-only (`power`). */
  readonly tier: TokenTier;
  /** The `var(--token, <compiled-default>)` fallback (frozen wire format). */
  readonly compiledDefault: string;
  /** Which surfaces this token repaints across the three archetypes. */
  readonly surfaces: SurfaceCoverage;
  /** Human-readable role (from the WU0 §1 map). */
  readonly role: string;
}

function color(
  name: string,
  compiledDefault: string,
  role: string,
  surfaces: SurfaceCoverage,
): TaxonomyToken {
  return { name, kind: 'color', tier: 'normal', compiledDefault, surfaces, role };
}

function space(name: string, compiledDefault: string): TaxonomyToken {
  // Core spacing scale (WU0 §1C): global padding / margin / gap across every
  // archetype, consumed via the storefront-scoped `--space-*` aliases (WU5).
  return {
    name,
    kind: 'space',
    tier: 'normal',
    compiledDefault,
    role: 'core spacing step (padding / margin / gap)',
    surfaces: {
      home: ['padding', 'margin', 'gap'],
      listing: ['padding', 'margin', 'gap'],
      detail: ['padding', 'margin', 'gap'],
    },
  };
}

/** The slate-mono + indigo-accent seed set (mirrors the WU1 backend baseline). */
export const SEED_TOKENS: readonly TaxonomyToken[] = [
  color('--background', '255 255 255', 'page canvas', {
    home: ['page-canvas', 'header', 'footer'],
    listing: ['page-canvas', 'header', 'footer'],
    detail: ['page-canvas', 'header', 'footer'],
  }),
  color('--surface', '241 245 249', 'cards / panels / inputs / raised', {
    home: ['cards', 'panels', 'header-dropdown'],
    listing: ['cards', 'filter-panels', 'inputs', 'product-card'],
    detail: ['cards', 'panels', 'inputs', 'product-card'],
  }),
  color('--surface-inverse', '15 23 42', 'dark chips / buttons / badges on light', {
    home: ['header-chip', 'badges'],
    listing: ['chips', 'badges', 'product-card-tag'],
    detail: ['chips', 'buttons', 'badges', 'product-card-tag'],
  }),
  color('--text', '51 65 85', 'body copy', {
    home: ['body-copy', 'paragraphs'],
    listing: ['body-copy', 'paragraphs'],
    detail: ['body-copy', 'paragraphs'],
  }),
  color('--text-heading', '15 23 42', 'headings / emphasis / hover', {
    home: ['hero-heading', 'section-headings'],
    listing: ['section-headings', 'listing-title'],
    detail: ['product-title', 'section-headings'],
  }),
  color('--text-muted', '100 116 139', 'captions / meta / placeholder', {
    home: ['captions', 'footer-meta'],
    listing: ['filter-labels', 'meta', 'placeholders'],
    detail: ['meta', 'captions'],
  }),
  color('--border', '226 232 240', 'dividers / inputs / card-edges / rings', {
    home: ['card-edges', 'dividers'],
    listing: ['card-edges', 'dividers', 'input-borders', 'filter-rings'],
    detail: ['card-edges', 'dividers', 'input-borders'],
  }),
  color('--accent', '79 70 229', 'links / focus rings / form-control accent', {
    home: ['links', 'focus-rings'],
    listing: ['links', 'form-control-accent', 'focus-rings', 'selected'],
    detail: ['links', 'focus-rings'],
  }),
  color('--overlay', '0 0 0', 'modal / drawer scrims', {
    home: ['nav-drawer-scrim'],
    listing: ['nav-drawer-scrim'],
    detail: ['nav-drawer-scrim', 'image-modal-scrim'],
  }),
  {
    name: '--font-body',
    kind: 'font',
    tier: 'normal',
    compiledDefault: 'Inter, system-ui, -apple-system, sans-serif',
    role: 'body typeface (everything inherits)',
    surfaces: {
      home: ['body-text', 'headings', 'labels'],
      listing: ['body-text', 'headings', 'labels'],
      detail: ['body-text', 'headings', 'labels'],
    },
  },
  {
    // WU0 §5 MANDATORY ADJUST: `--font-heading` is near-orphaned today (only the
    // banner wordmark uses it). WU5 MUST add `var(--font-heading)` onto the
    // archetype `<h*>`, so the declared surface coverage below is the CONTRACT
    // WU5 satisfies — the heading font must repaint on all three archetypes,
    // not just the banner, or the WU8 admin control is a silent no-op.
    name: '--font-heading',
    kind: 'font',
    tier: 'normal',
    compiledDefault: 'Cinzel, ui-serif, Georgia, serif',
    role: 'display / heading typeface',
    surfaces: {
      home: ['banner-wordmark', 'section-headings'],
      listing: ['section-headings', 'listing-title'],
      detail: ['product-title', 'section-headings'],
    },
  },
  {
    name: '--font-size-base',
    kind: 'size',
    tier: 'normal',
    compiledDefault: 'clamp(15px, 1.2vw + 12px, 18px)',
    role: 'root rem anchor (whole rem cascade scales off it)',
    surfaces: {
      home: ['type-scale-root'],
      listing: ['type-scale-root'],
      detail: ['type-scale-root'],
    },
  },
  space('--space-xs', '0.5rem'),
  space('--space-sm', '0.75rem'),
  space('--space-md', '1rem'),
  space('--space-lg', '1.5rem'),
  space('--space-xl', '2rem'),
];

const SEED_BY_NAME: ReadonlyMap<string, TaxonomyToken> = new Map(
  SEED_TOKENS.map((token) => [token.name, token]),
);

/** Look up a seed token by name, or `undefined` if it is not in the taxonomy. */
export function getToken(name: string): TaxonomyToken | undefined {
  return SEED_BY_NAME.get(name);
}

/** The seed color tokens (Tailwind-consumed `R G B` triplets). */
export function colorTokens(): readonly TaxonomyToken[] {
  return SEED_TOKENS.filter((token) => token.kind === 'color');
}
