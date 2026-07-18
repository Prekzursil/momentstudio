/**
 * TS<->Python parity harness for theme-derive.ts (P1a WU4b-derive).
 *
 * Bundles the pure `deriveTokens` implementation with esbuild and runs it over
 * the shared fixture (`test-fixtures/theme-derive-fixture.json`).
 *
 *   node scripts/theme-derive-parity.mjs --emit    # regenerate `expected`
 *   node scripts/theme-derive-parity.mjs           # assert against `expected`
 *
 * The Python side (`backend/tests/test_theme_derive.py`) asserts `derive_tokens`
 * matches the SAME `expected`, so a green harness + green pytest proves both
 * languages emit byte-identical output. Exit 1 on any mismatch.
 */

import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '../../test-fixtures/theme-derive-fixture.json');
const entry = resolve(here, '../src/app/core/theme/theme-derive.ts');

async function loadDerive() {
  const bundled = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'neutral',
    logLevel: 'silent',
  });
  const code = bundled.outputFiles[0].text;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  return import(dataUrl);
}

function equal(a, b) {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
  return ak.every((k) => a[k] === b[k]);
}

async function main() {
  const emit = process.argv.includes('--emit');
  const { deriveTokens } = await loadDerive();
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const expected = {};
  let failures = 0;

  for (const testCase of fixture.cases) {
    const out = deriveTokens(testCase.primaries);
    expected[testCase.name] = out;
    if (!emit) {
      const want = fixture.expected?.[testCase.name];
      if (!want || !equal(out, want)) {
        failures += 1;
        console.error(`MISMATCH [${testCase.name}]`);
        console.error('  got :', JSON.stringify(out));
        console.error('  want:', JSON.stringify(want));
      }
    }
  }

  if (emit) {
    fixture.expected = expected;
    writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`emitted expected for ${fixture.cases.length} case(s)`);
    return;
  }

  if (failures > 0) {
    console.error(`FAILED: ${failures} case(s) mismatched`);
    process.exit(1);
  }
  console.log(`PARITY OK: ${fixture.cases.length} case(s) matched`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
