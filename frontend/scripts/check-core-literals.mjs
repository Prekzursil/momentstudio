#!/usr/bin/env node
/**
 * P1a WU5 core-palette literal sweep (CI runner).
 *
 * Absolute / exhaustiveness mode: asserts that every core-palette literal in the
 * storefront core surfaces is either tokenized (so it does not appear at all) or on the
 * reviewed allowlist. A NEW core class — light `bg-slate-100` OR `dark:bg-slate-800`
 * (the baked-dark-palette regression) — or a new un-allowlisted hex in these files turns
 * CI RED, so WU0's surface-coverage enumeration is machine-checked, not trusted.
 *
 * The scan logic mirrors `src/app/core/theme/core-literal-guard.ts` (unit-tested to 100%).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', 'src');

// Storefront core surfaces WU5 tokenizes. Templates carry core colour as Tailwind utility
// CLASSES (scan `tw-class` + `hex`); styles.css core surfaces carry them as raw hex/rgb
// literals only (scan `hex`). styles.css `@layer components` (`.blog-*` / `.markdown`
// `@apply …`) is an explicitly NON-CORE surface that rides the var() fallback (WU0 memo
// §1C), so its utility classes are out of scope — hence hex-only there.
const TEMPLATE_FILES = [
  'app/app.component.ts',
  'app/layout/header.component.ts',
  'app/layout/footer.component.ts',
  'app/pages/home/home.component.ts',
  'app/pages/shop/shop.component.ts',
  'app/pages/product/product.component.ts',
  'app/shared/product-card.component.ts',
  'app/shared/banner-block.component.ts',
  'index.html',
];
const HEX_ONLY_FILES = ['styles.css'];
const FILES = [
  ...TEMPLATE_FILES.map((path) => ({ path, kinds: ['tw-class', 'hex'] })),
  ...HEX_ONLY_FILES.map((path) => ({ path, kinds: ['hex'] })),
];

const CORE_UTIL = 'bg|text|border|ring|from|via|to|divide|accent|placeholder|fill|stroke';
const CORE_COLOR = 'white|black|slate-\\d{2,3}|indigo-\\d{2,3}';
const TW_CLASS = new RegExp(
  `(?<![\\w:-])(?:[a-z-]+:)*(?:${CORE_UTIL})-(?:${CORE_COLOR})(?:/\\d{1,3})?(?![\\w-])`,
  'g',
);
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function positionAt(source, index) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

function scan(source) {
  const found = [];
  for (const [re, kind] of [
    [TW_CLASS, 'tw-class'],
    [HEX, 'hex'],
  ]) {
    re.lastIndex = 0;
    for (let m = re.exec(source); m !== null; m = re.exec(source)) {
      found.push({ ...positionAt(source, m.index), text: m[0], kind });
    }
  }
  return found;
}

const allowlist = new Set(
  JSON.parse(readFileSync(resolve(HERE, 'core-literal-allowlist.json'), 'utf8')).allow,
);

let violations = 0;
for (const { path: rel, kinds } of FILES) {
  const source = readFileSync(resolve(SRC, rel), 'utf8');
  for (const f of scan(source)) {
    if (!kinds.includes(f.kind)) continue;
    if (allowlist.has(f.text)) continue;
    violations += 1;
    console.error(
      `${rel}:${f.line}:${f.column}  core ${f.kind} literal "${f.text}" ` +
        `is not tokenized or allowlisted`,
    );
  }
}

if (violations > 0) {
  console.error(`\nFAILED: ${violations} un-tokenized core-palette literal(s).`);
  process.exit(1);
}
console.log('OK: no un-tokenized core-palette literals in storefront core surfaces.');
