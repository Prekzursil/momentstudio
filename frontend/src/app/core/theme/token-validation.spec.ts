import { resolveAdminEditable, resolveToken } from './token-registry';
import { validateAdminEditable, validateToken } from './token-validation';
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

describe('validateAdminEditable (strict draft-save / publish gate)', () => {
  it('accepts the primaries, fonts, size and spacing anchors verbatim', () => {
    expect(validateAdminEditable('--background', '10 20 30')).toEqual({
      ok: true,
      value: '10 20 30',
    });
    expect(validateAdminEditable('--space-lg', '1.5rem')).toEqual({
      ok: true,
      value: '1.5rem',
    });
  });

  it('rejects the numeric ramp, the wider spacing ramp and derived tokens', () => {
    // Each NAME is sink-acceptable (resolveToken defined) but NOT admin-settable.
    for (const name of ['--background-50', '--surface-800', '--space-2xl']) {
      expect(resolveToken(name)).toBeDefined();
      expect(resolveAdminEditable(name)).toBeUndefined();
      expect(validateAdminEditable(name, '15 23 42').ok).toBeFalse();
    }
    // Derived shade / state / on-colour keys never resolve on the admin gate.
    for (const name of ['--surface-muted', '--surface-inverse-hover', '--text-inverse']) {
      expect(validateAdminEditable(name, '255 255 255').ok).toBeFalse();
    }
  });

  it('emits an empty default for a non-admin-editable name', () => {
    const result = validateAdminEditable('--surface-300', '15 23 42');
    expect(result.ok).toBe(false);
    expect(result.value).toBe('');
  });

  it('falls back to the compiled default for a known editable key with a bad value', () => {
    const entry = resolveAdminEditable('--space-md');
    const result = validateAdminEditable('--space-md', '16'); // missing unit
    expect(result.ok).toBe(false);
    expect(result.value).toBe(entry?.fallback);
  });
});
