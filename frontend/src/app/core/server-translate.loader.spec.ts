import { firstValueFrom } from 'rxjs';

import { ServerTranslateFs, ServerTranslateLoader } from './server-translate.loader';

/**
 * Behavioural unit tests for ServerTranslateLoader.
 *
 * The loader is server-only (it reads i18n JSON off disk during SSR), so the
 * Node fs/path bindings are injected through the overridable `loadNode` seam.
 * A test subclass swaps in a deterministic in-memory filesystem so every real
 * branch — candidate fall-through, language normalization, and the parse/guard
 * paths in `tryRead` — is exercised against asserted behaviour.
 */

interface FsBehaviour {
  exists?: (path: string) => boolean;
  read?: (path: string) => string;
}

class TestServerTranslateLoader extends ServerTranslateLoader {
  readonly existsCalls: string[] = [];
  readonly readCalls: string[] = [];

  constructor(private readonly behaviour: FsBehaviour) {
    super();
  }

  protected override async loadNode(): Promise<ServerTranslateFs> {
    await Promise.resolve();
    return {
      cwd: '/app',
      existsSync: (path: string) => {
        this.existsCalls.push(path);
        return this.behaviour.exists ? this.behaviour.exists(path) : false;
      },
      readFileSync: (path: string) => {
        this.readCalls.push(path);
        if (!this.behaviour.read) {
          throw new Error(`unexpected read: ${path}`);
        }
        return this.behaviour.read(path);
      },
      // Deterministic POSIX-style join so assertions are platform independent.
      join: (...segments: string[]) => segments.join('/'),
    };
  }

  // The library's TranslationObject is a self-referential type that makes
  // jasmine's recursive `Expected<T>` blow the instantiation depth limit. The
  // emitted value is a plain object, so we widen it to a shallow record purely
  // for assertions (the runtime value is unchanged).
  run(lang: string): Promise<Record<string, unknown>> {
    return firstValueFrom(this.getTranslation(lang)) as Promise<Record<string, unknown>>;
  }
}

function translate(behaviour: FsBehaviour, lang: string): Promise<Record<string, unknown>> {
  return new TestServerTranslateLoader(behaviour).run(lang);
}

describe('ServerTranslateLoader', () => {
  it('returns parsed translations from the first existing candidate (dist build path)', async () => {
    const payload = { hello: 'world' };
    const loader = new TestServerTranslateLoader({
      exists: (path) => path.includes('/dist/'),
      read: () => JSON.stringify(payload),
    });

    const result = await loader.run('en');

    expect(result).toEqual(payload);
    // Stops at the first candidate: only the dist path is read.
    expect(loader.readCalls.length).toBe(1);
    expect(loader.readCalls[0]).toContain('/dist/app/browser/assets/i18n/en.json');
  });

  it('falls back to the second candidate (src/assets) when the first does not exist', async () => {
    const payload = { from: 'src-assets' };
    const loader = new TestServerTranslateLoader({
      exists: (path) => path.includes('/src/'),
      read: () => JSON.stringify(payload),
    });

    const result = await loader.run('ro');

    expect(result).toEqual(payload);
    expect(loader.existsCalls.length).toBe(2);
    expect(loader.readCalls).toEqual([jasmine.stringContaining('/src/assets/i18n/ro.json')]);
  });

  it('normalizes unknown / empty languages to "en"', async () => {
    const unknown = new TestServerTranslateLoader({ exists: () => true, read: () => '{}' });
    await unknown.run('  FR  ');
    expect(unknown.existsCalls.every((p) => p.endsWith('en.json'))).toBeTrue();
    expect(unknown.existsCalls.some((p) => p.includes('fr.json'))).toBeFalse();

    const empty = new TestServerTranslateLoader({ exists: () => true, read: () => '{}' });
    await empty.run('');
    expect(empty.existsCalls.every((p) => p.endsWith('en.json'))).toBeTrue();
  });

  it('normalizes "RO" (case-insensitive, trimmed) to "ro"', async () => {
    const loader = new TestServerTranslateLoader({ exists: () => true, read: () => '{}' });

    await loader.run(' Ro ');

    expect(loader.existsCalls.every((p) => p.endsWith('ro.json'))).toBeTrue();
  });

  it('returns an empty object when no candidate file exists', async () => {
    const loader = new TestServerTranslateLoader({ exists: () => false });

    const result = await loader.run('en');

    expect(result).toEqual({});
    expect(loader.existsCalls.length).toBe(2);
    expect(loader.readCalls.length).toBe(0);
  });

  it('ignores a file whose JSON parses to a non-object (null)', async () => {
    expect(await translate({ exists: () => true, read: () => 'null' }, 'en')).toEqual({});
  });

  it('ignores a file whose JSON parses to a primitive (string)', async () => {
    expect(await translate({ exists: () => true, read: () => '"just-a-string"' }, 'en')).toEqual(
      {},
    );
  });

  it('swallows malformed JSON and returns an empty object', async () => {
    expect(await translate({ exists: () => true, read: () => '{ not: valid json' }, 'en')).toEqual(
      {},
    );
  });

  it('swallows readFileSync throwing and returns an empty object', async () => {
    const loader = new TestServerTranslateLoader({
      exists: () => true,
      read: () => {
        throw new Error('EACCES');
      },
    });

    expect(await loader.run('en')).toEqual({});
  });
});
