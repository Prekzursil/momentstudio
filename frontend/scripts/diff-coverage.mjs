// frontend/scripts/diff-coverage.mjs
//
// Changed-files coverage gate. Runs as `posttest:coverage` (after karma emits
// coverage/lcov.info) and enforces **100% coverage on the source lines this PR
// adds or modifies** — while `karma.conf.cjs` keeps a global no-regression
// FLOOR (grandfathering the legacy ~49% surface). Together they give: legacy
// code is frozen (may not regress), new/changed code must be fully covered.
//
// Why a separate script instead of a karma threshold: karma's coverageReporter
// only supports global / per-file minimums, not per-changed-line. This computes
// the PR diff (against the base branch) and intersects added lines with the
// lcov DA records.
//
// Runs inside the shared quality gate's SHALLOW (depth-1) checkout, so main()
// deepens the clone at runtime to obtain a merge-base. It FAILS LOUD if it
// cannot determine the base in a PR context (never silently skips enforcement).
//
// Pure helpers (parseLcov / parseDiffAddedLines / normalizePath / isSourceFile /
// computeMisses) are exported and unit-tested in diff-coverage.spec.mjs.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const LCOV_PATH = 'coverage/lcov.info';

/** Normalize any lcov `SF:` path or git path to a frontend-relative form
 *  (e.g. `src/app/foo.ts`), so both sides compare exactly regardless of whether
 *  lcov emitted an absolute, `./`-prefixed, or `frontend/`-prefixed path. */
export function normalizePath(p) {
  let s = String(p).replace(/\\/g, '/').trim();
  const marker = '/frontend/';
  const i = s.lastIndexOf(marker);
  if (i >= 0) s = s.slice(i + marker.length);
  return s.replace(/^\.\//, '').replace(/^frontend\//, '');
}

/** Parse lcov text into Map<file, Map<lineNo, hits>> (executable lines only). */
export function parseLcov(text) {
  const files = new Map();
  let lines = null;
  for (const raw of String(text).split(/\r?\n/)) {
    if (raw.startsWith('SF:')) {
      lines = new Map();
      files.set(normalizePath(raw.slice(3)), lines);
    } else if (raw.startsWith('DA:') && lines) {
      const [ln, hits] = raw.slice(3).split(',');
      lines.set(Number(ln), Number(hits));
    } else if (raw === 'end_of_record') {
      lines = null;
    }
  }
  return files;
}

/** Parse a unified `git diff` into Map<file, Set<addedLineNo>> (new side). */
export function parseDiffAddedLines(diffText) {
  const files = new Map();
  let cur = null;
  let newLine = 0;
  for (const raw of String(diffText).split(/\r?\n/)) {
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim().replace(/^b\//, '');
      cur = p === '/dev/null' ? null : normalizePath(p);
      if (cur && !files.has(cur)) files.set(cur, new Set());
    } else if (raw.startsWith('@@')) {
      const m = /\+(\d+)(?:,\d+)?/.exec(raw);
      newLine = m ? Number(m[1]) : 0;
    } else if (cur) {
      if (raw.startsWith('+') && !raw.startsWith('+++')) {
        files.get(cur).add(newLine);
        newLine++;
      } else if (raw.startsWith('-')) {
        // deleted line: no advance on the new side
      } else if (raw.startsWith(' ') || raw === '') {
        newLine++;
      }
    }
  }
  return files;
}

/** Is `f` (frontend-relative) an app SOURCE file whose changed lines we enforce?
 *  Excludes specs/mocks, bootstrap, declaration, config and tooling files. */
export function isSourceFile(f) {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f)) return false;
  if (!f.startsWith('src/')) return false;
  if (f.endsWith('.d.ts')) return false;
  if (/\.(spec|test|mock)\.[tj]sx?$/.test(f)) return false;
  // Node-only SSR bootstraps: never loaded in the karma (browser) runtime, so
  // they cannot be instrumented for lcov. `server.ts` is the express entrypoint
  // (imports express / @angular/ssr/node); its testable logic lives in
  // `src/server/*.ts` (karma-covered). Same category as `main.server.ts`.
  if (/(^|\/)(test\.ts|polyfills\.ts|main\.ts|main\.server\.ts|server\.ts)$/.test(f)) return false;
  if (/(^|\/)environments\//.test(f)) return false;
  if (/\.config\.[cm]?[tj]s$/.test(f)) return false;
  return true;
}

/** Compute the list of "misses": changed source lines that lcov marks as
 *  uncovered, PLUS changed source files entirely absent from lcov (a new file
 *  that no test exercises — the hole a per-line diff alone would let through). */
export function computeMisses(lcovFiles, changedLines, isSource = isSourceFile) {
  const misses = [];
  for (const [file, addSet] of changedLines) {
    if (!isSource(file)) continue;
    const cov = lcovFiles.get(file);
    if (!cov) {
      // Changed source file has no instrumentation at all -> not covered by any
      // test. Only flag it if it actually added lines (pure deletions are fine).
      if (addSet.size > 0) misses.push(`${file}: file not exercised by any test`);
      continue;
    }
    for (const ln of [...addSet].sort((a, b) => a - b)) {
      if (cov.has(ln) && cov.get(ln) === 0) misses.push(`${file}:${ln}`);
    }
  }
  return misses;
}

// ---------------------------------------------------------------------------
// CLI orchestration (verified end-to-end by CI; not unit-tested)
// ---------------------------------------------------------------------------

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function tryGit(args) {
  try {
    return git(args).trim();
  } catch {
    return null;
  }
}

function resolveMergeBase(baseRef) {
  // The quality gate checks out shallow (depth 1). Deepen to find a merge-base.
  tryGit(['fetch', '--no-tags', '--depth=300', 'origin', baseRef]);
  let base =
    tryGit(['merge-base', `origin/${baseRef}`, 'HEAD']) ||
    tryGit(['merge-base', 'FETCH_HEAD', 'HEAD']);
  if (!base) {
    tryGit(['fetch', '--no-tags', '--unshallow', 'origin']);
    base =
      tryGit(['merge-base', `origin/${baseRef}`, 'HEAD']) ||
      tryGit(['merge-base', 'FETCH_HEAD', 'HEAD']);
  }
  return base;
}

function main() {
  const baseRef = process.env.GITHUB_BASE_REF;
  if (!baseRef) {
    console.log(
      '[diff-coverage] Not a pull-request context (no GITHUB_BASE_REF) — changed-files gate skipped.',
    );
    return 0;
  }
  if (!existsSync(LCOV_PATH)) {
    console.error(
      `[diff-coverage] FAIL: ${LCOV_PATH} not found — coverage must run before this gate.`,
    );
    return 1;
  }

  const base = resolveMergeBase(baseRef);
  if (!base) {
    console.error(
      `[diff-coverage] FAIL: could not resolve a merge-base against origin/${baseRef} ` +
        '(shallow clone could not be deepened). Refusing to skip enforcement.',
    );
    return 1;
  }

  const diff = tryGit([
    'diff',
    '--relative',
    '--unified=0',
    '--no-color',
    `${base}...HEAD`,
    '--',
    '*.ts',
    '*.tsx',
    '*.js',
    '*.jsx',
    '*.mjs',
    '*.cjs',
  ]);
  if (diff === null) {
    console.error('[diff-coverage] FAIL: git diff against the merge-base failed.');
    return 1;
  }

  const changed = parseDiffAddedLines(diff);
  const lcov = parseLcov(readFileSync(LCOV_PATH, 'utf8'));
  const misses = computeMisses(lcov, changed);

  const changedSourceFiles = [...changed.keys()].filter((f) => isSourceFile(f));
  if (misses.length === 0) {
    console.log(
      `[diff-coverage] OK: 100% coverage on changed lines across ${changedSourceFiles.length} source file(s).`,
    );
    return 0;
  }

  console.error(
    `[diff-coverage] FAIL: ${misses.length} changed source line(s)/file(s) not covered:`,
  );
  for (const m of misses) console.error(`  - ${m}`);
  console.error(
    '\nEvery line this PR adds or modifies under frontend/src must be covered by a test. ' +
      'Add specs for the lines above (the legacy no-regression floor lives in karma.conf.cjs).',
  );
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
