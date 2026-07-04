import { resolveToken } from './token-registry';
import { validateToken } from './token-validation';
import corpus from '../../../../../test-fixtures/theme-token-corpus.json';

interface CorpusCase {
  readonly name: string;
  readonly value: string;
  readonly expect: string;
  readonly why?: string;
}

const cases: CorpusCase[] = corpus.cases;

describe('validateToken (shared corpus parity)', () => {
  for (const testCase of cases) {
    it(`${testCase.expect}: ${testCase.name} = ${JSON.stringify(testCase.value)}`, () => {
      const result = validateToken(testCase.name, testCase.value);
      expect(result.ok).toBe(testCase.expect === 'ok');
      if (result.ok) {
        // An accepted value is emitted verbatim (post decode-first pass).
        expect(result.value).toBe(testCase.value);
      } else {
        // A rejected value is never emitted; it degrades to a compiled default.
        expect(result.value).not.toBe(testCase.value);
      }
    });
  }
});

describe('validateToken (fallback behaviour)', () => {
  it('emits an empty default for an unknown/invalid name', () => {
    const result = validateToken('--not-a-real-token', '1 2 3');
    expect(result.ok).toBe(false);
    expect(result.value).toBe('');
  });

  it('falls back to the compiled default for a known key with a bad value', () => {
    const entry = resolveToken('--text');
    const result = validateToken('--text', '300 0 0');
    expect(result.ok).toBe(false);
    expect(entry?.fallback).toBe(result.value);
  });
});
