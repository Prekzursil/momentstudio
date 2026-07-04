//
// WU6/WU13 (B6) - server-sink lint-ban RED-THEN-GREEN proof.
//
// Proves the no-restricted-syntax ban wired in eslint.config.mjs for the
// src/server directory actually FLAGS an Angular sanitizer bypass
// (bypassSecurityTrust family) and an innerHTML/outerHTML write, while the real
// theme-head.ts sink (the ONE permitted controlled style-string emit) passes
// clean. It also proves the eslint globs genuinely reach server TS (server TS is
// in tsconfig.eslint.json's src glob), not a separate un-linted tsconfig - the
// exact gap this deliverable closes.
//
// The RED case is a throwaway probe file that is a COPY of theme-head.ts with
// two banned statements appended, so the proof is literally "the same bypass
// added inside theme-head.ts fails CI". The probe is always removed (finally).
//

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const ESLINT_CLI = join(FRONTEND_DIR, 'node_modules', 'eslint', 'bin', 'eslint.js');
const REAL_SINK = join('src', 'server', 'theme-head.ts');
// Probe lives in src/server/ so it matches the SAME ban glob as theme-head.ts.
const PROBE_REL = join('src', 'server', '__theme_head_ban_probe__.ts');
const PROBE_ABS = join(FRONTEND_DIR, PROBE_REL);

/** Run eslint on one file; return { code, output } (never throws on lint fail). */
function runEslint(fileRel) {
  try {
    const stdout = execFileSync(process.execPath, [ESLINT_CLI, fileRel], {
      cwd: FRONTEND_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output: stdout };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

test('GREEN: the real server theme-head sink passes eslint (no ban violations)', () => {
  const { code, output } = runEslint(REAL_SINK);
  assert.equal(code, 0, `expected theme-head.ts to lint clean, got:\n${output}`);
});

test('RED: bypassSecurityTrust*/innerHTML inside a server-sink file FAILS eslint', () => {
  const sink = readFileSync(join(FRONTEND_DIR, REAL_SINK), 'utf8');
  const banned = [
    '',
    '// --- injected banned sinks (proof only) ---',
    'declare const __sanitizer: { bypassSecurityTrustHtml(v: string): unknown };',
    'export function __proveBanRed(el: HTMLElement, v: string): unknown {',
    '  el.innerHTML = v;',
    '  return __sanitizer.bypassSecurityTrustHtml(v);',
    '}',
    '',
  ].join('\n');
  writeFileSync(PROBE_ABS, `${sink}${banned}`, 'utf8');
  try {
    const { code, output } = runEslint(PROBE_REL);
    assert.notEqual(code, 0, `expected the banned probe to FAIL eslint; output:\n${output}`);
    assert.match(output, /no-restricted-syntax/, 'ban must fire via no-restricted-syntax');
    assert.match(output, /bypassSecurityTrust\*/, 'must flag the sanitizer-bypass sink');
    assert.match(output, /innerHTML\/outerHTML/, 'must flag the innerHTML sink');
  } finally {
    if (existsSync(PROBE_ABS)) {
      rmSync(PROBE_ABS);
    }
  }
});
