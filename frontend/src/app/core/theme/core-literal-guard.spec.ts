import { findUnmappedCoreLiterals, scanCoreLiterals } from './core-literal-guard';

describe('scanCoreLiterals', () => {
  it('flags a bare (light) core Tailwind class with its 1-based position', () => {
    const found = scanCoreLiterals('  bg-white');
    expect(found).toEqual([{ line: 1, column: 3, text: 'bg-white', kind: 'tw-class' }]);
  });

  it('flags a dark: core variant (baked dark palette regression)', () => {
    const found = scanCoreLiterals('dark:bg-slate-900');
    expect(found).toEqual([{ line: 1, column: 1, text: 'dark:bg-slate-900', kind: 'tw-class' }]);
  });

  it('flags stacked variants and opacity modifiers on the core vocabulary', () => {
    const texts = scanCoreLiterals(
      'dark:hover:bg-slate-800 focus:ring-indigo-500/40 bg-slate-900/50 border-slate-200/60',
    ).map((f) => f.text);
    expect(texts).toEqual([
      'dark:hover:bg-slate-800',
      'focus:ring-indigo-500/40',
      'bg-slate-900/50',
      'border-slate-200/60',
    ]);
  });

  it('flags raw hex colours', () => {
    const found = scanCoreLiterals('color: #0f172a; outline: #6366f1;');
    expect(found.map((f) => f.text)).toEqual(['#0f172a', '#6366f1']);
    expect(found.every((f) => f.kind === 'hex')).toBe(true);
  });

  it('computes line + column across newlines', () => {
    const found = scanCoreLiterals('line1\nline2 text-slate-700');
    expect(found[0]).toEqual({ line: 2, column: 7, text: 'text-slate-700', kind: 'tw-class' });
  });

  it('does NOT flag out-of-core / state / decorative families or aliases', () => {
    const src =
      'bg-amber-50 text-red-600 bg-emerald-50 bg-transparent bg-surface text-text-heading';
    expect(scanCoreLiterals(src)).toEqual([]);
  });

  it('returns an empty list for a clean source', () => {
    expect(scanCoreLiterals('grid gap-4 rounded-2xl')).toEqual([]);
  });
});

describe('findUnmappedCoreLiterals', () => {
  const src = 'bg-white dark:bg-slate-900 #94a3b8';

  it('drops allowlisted literals and keeps the rest (default = all kinds)', () => {
    const found = findUnmappedCoreLiterals(src, ['#94a3b8']);
    expect(found.map((f) => f.text)).toEqual(['bg-white', 'dark:bg-slate-900']);
  });

  it('honours a kind filter (hex-only excludes tw-class findings)', () => {
    const found = findUnmappedCoreLiterals(src, [], ['hex']);
    expect(found.map((f) => f.text)).toEqual(['#94a3b8']);
  });

  it('returns nothing when every literal is allowlisted', () => {
    expect(findUnmappedCoreLiterals(src, ['bg-white', 'dark:bg-slate-900', '#94a3b8'])).toEqual([]);
  });
});
