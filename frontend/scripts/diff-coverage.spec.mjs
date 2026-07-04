// Unit tests for the pure logic of diff-coverage.mjs.
// Run: node --test scripts/diff-coverage.spec.mjs   (from frontend/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePath,
  parseLcov,
  parseDiffAddedLines,
  isSourceFile,
  computeMisses,
} from './diff-coverage.mjs';

test('normalizePath reduces absolute / prefixed paths to frontend-relative', () => {
  assert.equal(normalizePath('/home/runner/work/ms/ms/frontend/src/app/a.ts'), 'src/app/a.ts');
  assert.equal(normalizePath('frontend/src/app/a.ts'), 'src/app/a.ts');
  assert.equal(normalizePath('./src/app/a.ts'), 'src/app/a.ts');
  assert.equal(normalizePath('src\\app\\a.ts'), 'src/app/a.ts');
});

test('parseLcov maps executable lines to hit counts', () => {
  const lcov = ['SF:src/app/a.ts', 'DA:1,3', 'DA:2,0', 'end_of_record'].join('\n');
  const files = parseLcov(lcov);
  assert.equal(files.get('src/app/a.ts').get(1), 3);
  assert.equal(files.get('src/app/a.ts').get(2), 0);
});

test('parseDiffAddedLines tracks new-side added line numbers', () => {
  const diff = [
    'diff --git a/src/app/a.ts b/src/app/a.ts',
    '--- a/src/app/a.ts',
    '+++ b/src/app/a.ts',
    '@@ -10,0 +11,2 @@',
    '+const x = 1;',
    '+const y = 2;',
  ].join('\n');
  const changed = parseDiffAddedLines(diff);
  assert.deepEqual([...changed.get('src/app/a.ts')].sort((a, b) => a - b), [11, 12]);
});

test('parseDiffAddedLines ignores deleted files (+++ /dev/null)', () => {
  const diff = ['--- a/src/app/gone.ts', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-a', '-b'].join('\n');
  assert.equal(parseDiffAddedLines(diff).size, 0);
});

test('isSourceFile includes app source, excludes specs/config/bootstrap/declarations', () => {
  assert.equal(isSourceFile('src/app/a.component.ts'), true);
  assert.equal(isSourceFile('src/app/a.component.spec.ts'), false);
  assert.equal(isSourceFile('src/app/a.mock.ts'), false);
  assert.equal(isSourceFile('src/test.ts'), false);
  assert.equal(isSourceFile('src/main.ts'), false);
  assert.equal(isSourceFile('src/environments/environment.ts'), false);
  assert.equal(isSourceFile('src/app/types.d.ts'), false);
  assert.equal(isSourceFile('scripts/generate-config.mjs'), false);
  assert.equal(isSourceFile('karma.conf.cjs'), false);
});

test('computeMisses flags an uncovered changed line', () => {
  const lcov = parseLcov(['SF:src/app/a.ts', 'DA:11,1', 'DA:12,0', 'end_of_record'].join('\n'));
  const changed = new Map([['src/app/a.ts', new Set([11, 12])]]);
  assert.deepEqual(computeMisses(lcov, changed), ['src/app/a.ts:12']);
});

test('computeMisses passes when every changed line is covered', () => {
  const lcov = parseLcov(['SF:src/app/a.ts', 'DA:11,1', 'DA:12,4', 'end_of_record'].join('\n'));
  const changed = new Map([['src/app/a.ts', new Set([11, 12])]]);
  assert.deepEqual(computeMisses(lcov, changed), []);
});

test('computeMisses ignores non-executable changed lines (not in lcov)', () => {
  // line 13 is a comment/type — istanbul never emits a DA record for it
  const lcov = parseLcov(['SF:src/app/a.ts', 'DA:11,1', 'end_of_record'].join('\n'));
  const changed = new Map([['src/app/a.ts', new Set([11, 13])]]);
  assert.deepEqual(computeMisses(lcov, changed), []);
});

test('computeMisses flags a brand-new source file absent from lcov (untested file hole)', () => {
  const lcov = parseLcov(['SF:src/app/other.ts', 'DA:1,1', 'end_of_record'].join('\n'));
  const changed = new Map([['src/app/brand-new.ts', new Set([1, 2, 3])]]);
  assert.deepEqual(computeMisses(lcov, changed), ['src/app/brand-new.ts: file not exercised by any test']);
});

test('computeMisses excludes spec files entirely', () => {
  const lcov = parseLcov('');
  const changed = new Map([['src/app/a.component.spec.ts', new Set([1, 2])]]);
  assert.deepEqual(computeMisses(lcov, changed), []);
});
