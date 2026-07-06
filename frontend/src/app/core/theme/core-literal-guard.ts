/**
 * Core-palette literal guard (P1a WU5).
 *
 * Machine-checks the "verifiable themeable-core" contract from both sides so WU0's
 * hand enumeration is proven, not trusted:
 *
 *  - regression / diff mode: flags any NEW hardcoded core-palette literal that a
 *    storefront core surface should be consuming through a token instead.
 *  - absolute / exhaustiveness mode: run once over the current tree, EVERY core literal
 *    must be either tokenized (so it does not appear) or on the reviewed allowlist —
 *    closing the day-one vacuous-pass hole.
 *
 * A "core literal" is a storefront core-palette Tailwind utility class
 * (`bg`/`text`/`border`/`ring`/`from`/`via`/`to`/`divide`/`accent`/… on
 * `white`/`black`/`slate-*`/`indigo-*`) or a raw hex color. BOTH light (`bg-white`)
 * AND `dark:` core variants (`dark:bg-slate-900`) are flagged: WU5 rewrites the dark
 * palette to the same storefront-scoped aliases (the tokens flip under `:root.dark`),
 * so a re-introduced `dark:bg-slate-800` is exactly the "baked dark palette" regression
 * the guard must catch. State/decorative families (amber/rose/emerald/red/fuchsia/…)
 * are out of the core vocabulary and are never flagged.
 *
 * Pure and dependency-free; the `scripts/check-core-literals.mjs` CI runner mirrors this
 * logic over the real file tree.
 */

/** The kind of core-palette literal that was found. */
export type CoreLiteralKind = 'tw-class' | 'hex';

/** A single flagged core-palette literal, with its 1-based source position. */
export interface CoreLiteralFinding {
  readonly line: number;
  readonly column: number;
  readonly text: string;
  readonly kind: CoreLiteralKind;
}

// Core storefront utility prefixes that carry a palette colour.
const CORE_UTIL = 'bg|text|border|ring|from|via|to|divide|accent|placeholder|fill|stroke';
// Core colour vocabulary: white / black / slate-<shade> / indigo-<shade>.
const CORE_COLOR = 'white|black|slate-\\d{2,3}|indigo-\\d{2,3}';

// Matches a full utility class (any variant prefix incl. `dark:`) + core colour + opt /opacity.
const TW_CLASS = new RegExp(
  `(?<![\\w:-])(?:[a-z-]+:)*(?:${CORE_UTIL})-(?:${CORE_COLOR})(?:/\\d{1,3})?(?![\\w-])`,
  'g',
);
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function positionAt(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10 /* \n */) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

function collect(source: string, re: RegExp, kind: CoreLiteralKind): CoreLiteralFinding[] {
  const out: CoreLiteralFinding[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    const { line, column } = positionAt(source, m.index);
    out.push({ line, column, text: m[0], kind });
  }
  return out;
}

/**
 * Scan `source` for every core-palette literal — Tailwind utility classes (light AND
 * `dark:` core variants) and raw hex colours.
 */
export function scanCoreLiterals(source: string): CoreLiteralFinding[] {
  return [...collect(source, TW_CLASS, 'tw-class'), ...collect(source, HEX, 'hex')];
}

/**
 * Absolute-mode sweep: every core literal in `source` (of a scanned `kind`) that is NOT
 * on `allowlist` (a set of reviewed, documented non-core / baked exceptions) is a
 * violation.
 */
export function findUnmappedCoreLiterals(
  source: string,
  allowlist: readonly string[],
  kinds: readonly CoreLiteralKind[] = ['tw-class', 'hex'],
): CoreLiteralFinding[] {
  const allowed = new Set(allowlist);
  const wanted = new Set(kinds);
  return scanCoreLiterals(source).filter(
    (finding) => wanted.has(finding.kind) && !allowed.has(finding.text),
  );
}
