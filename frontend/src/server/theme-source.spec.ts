import { contrastRatio } from '../app/core/theme/contrast';
import { DERIVED_COLOR_NAMES, parseTriplet } from '../app/core/theme/theme-derive';
import { resolveThemeTokens } from './theme-head';
import {
  type ThemeFetchDeps,
  type ThemeSourceConfig,
  defaultFetchDeps,
  getThemeTokens,
  invalidateThemeCache,
  processEnv,
  readEnv,
  readThemeConfig,
} from './theme-source';

/** A fake `fetch` returning a JSON body with `status`, counting invocations. */
function jsonFetch(body: unknown, status = 200): { impl: typeof fetch; calls: () => number } {
  let count = 0;
  const impl = ((): Promise<Response> => {
    count += 1;
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { impl, calls: () => count };
}

/** Deps with a fixed clock and the given fetch. */
function depsWith(fetchImpl: typeof fetch, now = 0): ThemeFetchDeps {
  return { fetchImpl, now: () => now };
}

const BASE_CONFIG: ThemeSourceConfig = {
  apiBaseUrl: '/api/v1',
  timeoutMs: 5000,
  cacheTtlMs: 30_000,
  killSwitch: false,
};

describe('processEnv', () => {
  let original: unknown;
  beforeEach(() => {
    original = (globalThis as { process?: unknown }).process;
  });
  afterEach(() => {
    (globalThis as { process?: unknown }).process = original;
  });

  it('returns undefined when there is no process (browser)', () => {
    (globalThis as { process?: unknown }).process = undefined;
    expect(processEnv()).toBeUndefined();
  });

  it('returns process.env when a process exists (node/shim)', () => {
    (globalThis as { process?: unknown }).process = { env: { MS_PROBE: 'yes' } };
    expect(processEnv()?.['MS_PROBE']).toBe('yes');
  });
});

describe('readEnv', () => {
  it('returns a trimmed value from the injected env', () => {
    expect(readEnv('K', { K: '  v  ' })).toBe('v');
  });

  it('collapses an empty/whitespace value to undefined', () => {
    expect(readEnv('K', { K: '   ' })).toBeUndefined();
  });

  it('returns undefined for a missing key', () => {
    expect(readEnv('K', {})).toBeUndefined();
  });

  it('falls back to processEnv when no env is injected', () => {
    const original = (globalThis as { process?: unknown }).process;
    (globalThis as { process?: unknown }).process = { env: { MS_PROBE_ENV: 'x' } };
    try {
      expect(readEnv('MS_PROBE_ENV')).toBe('x');
    } finally {
      (globalThis as { process?: unknown }).process = original;
    }
  });
});

describe('readThemeConfig', () => {
  it('applies defaults when the environment is empty', () => {
    const config = readThemeConfig({});
    expect(config.apiBaseUrl).toBe('/api/v1');
    expect(config.timeoutMs).toBe(2000);
    expect(config.cacheTtlMs).toBe(30_000);
    expect(config.killSwitch).toBe(false);
  });

  it('reads and normalizes the backend URL (strips trailing slashes)', () => {
    expect(
      readThemeConfig({ SSR_API_BASE_URL: 'https://api.example.com/api/v1//' }).apiBaseUrl,
    ).toBe('https://api.example.com/api/v1');
  });

  it('honours a positive numeric timeout / ttl override', () => {
    const config = readThemeConfig({ MS_THEME_TIMEOUT_MS: '750', MS_THEME_CACHE_TTL_MS: '0' });
    expect(config.timeoutMs).toBe(750);
    expect(config.cacheTtlMs).toBe(0);
  });

  it('ignores a non-positive timeout and a negative ttl', () => {
    const config = readThemeConfig({ MS_THEME_TIMEOUT_MS: '0', MS_THEME_CACHE_TTL_MS: '-5' });
    expect(config.timeoutMs).toBe(2000);
    expect(config.cacheTtlMs).toBe(30_000);
  });

  it('enables the kill-switch only for exactly "1"', () => {
    expect(readThemeConfig({ MS_THEME_KILL_SWITCH: '1' }).killSwitch).toBe(true);
    expect(readThemeConfig({ MS_THEME_KILL_SWITCH: 'true' }).killSwitch).toBe(false);
  });
});

describe('defaultFetchDeps', () => {
  it('wires the ambient fetch and a real clock', () => {
    const deps = defaultFetchDeps();
    expect(typeof deps.fetchImpl).toBe('function');
    expect(typeof deps.now()).toBe('number');
  });
});

describe('getThemeTokens', () => {
  beforeEach(() => invalidateThemeCache());
  afterEach(() => invalidateThemeCache());

  it('returns null immediately when the kill-switch is set (no fetch)', async () => {
    const fetcher = jsonFetch({ tokens: { '--background': '1 2 3' } });
    const tokens = await getThemeTokens(
      { ...BASE_CONFIG, killSwitch: true },
      depsWith(fetcher.impl),
    );
    expect(tokens).toBeNull();
    expect(fetcher.calls()).toBe(0);
  });

  it('fetches and returns the published tokens on success', async () => {
    const fetcher = jsonFetch({ tokens: { '--background': '1 2 3' } });
    const tokens = await getThemeTokens(BASE_CONFIG, depsWith(fetcher.impl));
    expect(tokens).toEqual({ '--background': '1 2 3' });
  });

  it('serves the second call from the in-process cache (no re-fetch)', async () => {
    const fetcher = jsonFetch({ tokens: { '--background': '1 2 3' } });
    await getThemeTokens(BASE_CONFIG, depsWith(fetcher.impl, 100));
    await getThemeTokens(BASE_CONFIG, depsWith(fetcher.impl, 200));
    expect(fetcher.calls()).toBe(1);
  });

  it('re-fetches once the cached entry has expired', async () => {
    const fetcher = jsonFetch({ tokens: { '--background': '1 2 3' } });
    await getThemeTokens({ ...BASE_CONFIG, cacheTtlMs: 50 }, depsWith(fetcher.impl, 0));
    await getThemeTokens({ ...BASE_CONFIG, cacheTtlMs: 50 }, depsWith(fetcher.impl, 100));
    expect(fetcher.calls()).toBe(2);
  });

  it('re-fetches after an explicit cache invalidation (publish)', async () => {
    const fetcher = jsonFetch({ tokens: { '--background': '1 2 3' } });
    await getThemeTokens(BASE_CONFIG, depsWith(fetcher.impl, 0));
    invalidateThemeCache();
    await getThemeTokens(BASE_CONFIG, depsWith(fetcher.impl, 1));
    expect(fetcher.calls()).toBe(2);
  });

  it('returns null on a non-2xx response (compiled-default fallback)', async () => {
    const fetcher = jsonFetch({}, 500);
    expect(await getThemeTokens(BASE_CONFIG, depsWith(fetcher.impl))).toBeNull();
  });

  it('returns null when the body has no tokens object', async () => {
    const fetcher = jsonFetch({ tokens: 'nope' });
    expect(await getThemeTokens(BASE_CONFIG, depsWith(fetcher.impl))).toBeNull();
  });

  it('returns null when the tokens field is absent', async () => {
    const fetcher = jsonFetch({ version: 1 });
    expect(await getThemeTokens(BASE_CONFIG, depsWith(fetcher.impl))).toBeNull();
  });

  it('returns null when the fetch throws', async () => {
    const impl = (() => Promise.reject(new Error('network'))) as unknown as typeof fetch;
    expect(await getThemeTokens(BASE_CONFIG, depsWith(impl))).toBeNull();
  });

  it('aborts on timeout and degrades to null', async () => {
    const impl = ((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as unknown as typeof fetch;
    const tokens = await getThemeTokens({ ...BASE_CONFIG, timeoutMs: 1 }, depsWith(impl));
    expect(tokens).toBeNull();
  });
});

describe('theme-source -> WU6 sink (DERIVED full set emitted)', () => {
  beforeEach(() => invalidateThemeCache());
  afterEach(() => invalidateThemeCache());

  it('the fetched doc, fed to the sink, yields every DERIVED token', async () => {
    const fetcher = jsonFetch({ tokens: { '--accent': '20 30 120' } });
    const doc = await getThemeTokens(BASE_CONFIG, depsWith(fetcher.impl));
    const emitted = resolveThemeTokens(doc);
    for (const name of DERIVED_COLOR_NAMES) {
      expect(emitted[name]).withContext(`${name} must be emitted`).toBeTruthy();
    }
    // The submitted primary survives; the derived on-colours are computed.
    expect(emitted['--accent']).toBe('20 30 120');
  });

  it('drops a hostile DERIVED/white-on-white key from the cached doc, re-derives', async () => {
    // A tampered cached doc tries to force --surface-inverse=white AND a white
    // --text-inverse on-colour. The sink keeps the (legal) primary but RECOMPUTES
    // the on-colour to black — the transport never dictates a derived value.
    const fetcher = jsonFetch({
      tokens: { '--surface-inverse': '255 255 255', '--text-inverse': '255 255 255' },
    });
    const doc = await getThemeTokens(BASE_CONFIG, depsWith(fetcher.impl));
    const emitted = resolveThemeTokens(doc);
    expect(emitted['--surface-inverse']).toBe('255 255 255');
    expect(emitted['--text-inverse']).toBe('0 0 0');
    const ratio = contrastRatio(
      parseTriplet(emitted['--text-inverse']),
      parseTriplet(emitted['--surface-inverse']),
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
