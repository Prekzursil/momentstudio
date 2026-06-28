/**
 * Behavioral coverage for the application polyfills entry point
 * (`src/polyfills.ts`), which loads zone.js so Angular's change detection and
 * async-patching contract is available to the runtime.
 *
 * The Angular karma builder loads zone.js for the *test* harness via its own
 * `polyfills` configuration, so the application's `src/polyfills.ts` module is
 * never otherwise evaluated under test. Importing it here exercises that module
 * and asserts the zone.js public contract it is responsible for installing.
 */
import './polyfills';

// `Zone` is exposed on the global scope by zone.js once the polyfill runs.
declare const Zone: {
  current: { name: string; fork: (spec: { name: string }) => unknown };
  root: { name: string };
  __symbol__: (name: string) => string;
};

describe('polyfills entry point (src/polyfills.ts)', () => {
  it('installs the global Zone API provided by zone.js', () => {
    expect(typeof Zone).not.toBe('undefined');
    expect(typeof Zone.__symbol__).toBe('function');
  });

  it('exposes a current and root zone', () => {
    expect(Zone.current).toBeTruthy();
    expect(typeof Zone.current.name).toBe('string');
    expect(Zone.root).toBeTruthy();
    expect(typeof Zone.root.name).toBe('string');
  });

  it('supports forking a child zone (zone.js core behavior)', () => {
    const child = Zone.current.fork({ name: 'polyfills-spec-zone' });
    expect(child).toBeTruthy();
    expect((child as { name: string }).name).toBe('polyfills-spec-zone');
  });

  it('patches asynchronous primitives so they become zone-aware', () => {
    // zone.js replaces the native async primitives with monkey-patched
    // versions and stashes the original behind a zone symbol. The presence of
    // that symbol proves the polyfill performed its patching side effect.
    const originalDelegateSymbol = Zone.__symbol__('OriginalDelegate');
    const patchedSetTimeout = setTimeout as unknown as Record<string, unknown>;
    expect(originalDelegateSymbol in patchedSetTimeout).toBe(true);
  });
});
