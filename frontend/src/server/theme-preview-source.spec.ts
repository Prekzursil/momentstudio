import type { ThemeFetchDeps, ThemeSourceConfig } from './theme-source';
import {
  PREVIEW_TOKEN_PARAM,
  getPreviewThemeTokens,
  readPreviewToken,
  resolvePreviewDoc,
} from './theme-preview-source';

/** A fake `fetch` returning a JSON body with `status`, counting invocations. */
function jsonFetch(body: unknown, status = 200): { impl: typeof fetch; calls: () => number } {
  let count = 0;
  const impl = ((): Promise<Response> => {
    count += 1;
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { impl, calls: () => count };
}

/** A fake `fetch` that rejects (network error / abort). */
function throwingFetch(): typeof fetch {
  return (() => Promise.reject(new Error('boom'))) as unknown as typeof fetch;
}

function depsWith(fetchImpl: typeof fetch): ThemeFetchDeps {
  return { fetchImpl, now: () => 0 };
}

const BASE_CONFIG: ThemeSourceConfig = {
  apiBaseUrl: '/api/v1',
  timeoutMs: 5000,
  cacheTtlMs: 30_000,
  killSwitch: false,
};

describe('readPreviewToken', () => {
  it('extracts the token from a path+query URL', () => {
    expect(readPreviewToken(`/?${PREVIEW_TOKEN_PARAM}=abc.def`)).toBe('abc.def');
  });

  it('returns null when the param is absent', () => {
    expect(readPreviewToken('/shop?lang=en')).toBeNull();
  });

  it('returns null for an empty / whitespace token', () => {
    expect(readPreviewToken(`/?${PREVIEW_TOKEN_PARAM}=`)).toBeNull();
    expect(readPreviewToken(`/?${PREVIEW_TOKEN_PARAM}=%20%20`)).toBeNull();
  });

  it('returns null for a malformed URL', () => {
    expect(readPreviewToken('//[')).toBeNull();
  });

  it('trims a padded token', () => {
    expect(readPreviewToken(`/?${PREVIEW_TOKEN_PARAM}=%20tok%20`)).toBe('tok');
  });
});

describe('getPreviewThemeTokens', () => {
  it('returns the tokens on a 2xx with a tokens object', async () => {
    const { impl } = jsonFetch({ tokens: { '--accent': '12 34 56' } });
    const doc = await getPreviewThemeTokens('tok', BASE_CONFIG, depsWith(impl));
    expect(doc).toEqual({ '--accent': '12 34 56' });
  });

  it('requests the token-gated preview route with the token', async () => {
    let seenUrl = '';
    const impl = ((url: string): Promise<Response> => {
      seenUrl = url;
      return Promise.resolve(new Response(JSON.stringify({ tokens: {} }), { status: 200 }));
    }) as unknown as typeof fetch;
    await getPreviewThemeTokens('a b', BASE_CONFIG, depsWith(impl));
    expect(seenUrl).toBe(`/api/v1/theme/preview?${PREVIEW_TOKEN_PARAM}=a%20b`);
  });

  it('returns null on a non-2xx response (403 bad/expired token)', async () => {
    const { impl } = jsonFetch({}, 403);
    expect(await getPreviewThemeTokens('tok', BASE_CONFIG, depsWith(impl))).toBeNull();
  });

  it('returns null when the body has no tokens field', async () => {
    const { impl } = jsonFetch({ nope: true });
    expect(await getPreviewThemeTokens('tok', BASE_CONFIG, depsWith(impl))).toBeNull();
  });

  it('returns null when tokens is null', async () => {
    const { impl } = jsonFetch({ tokens: null });
    expect(await getPreviewThemeTokens('tok', BASE_CONFIG, depsWith(impl))).toBeNull();
  });

  it('returns null when tokens is not an object', async () => {
    const { impl } = jsonFetch({ tokens: 'nope' });
    expect(await getPreviewThemeTokens('tok', BASE_CONFIG, depsWith(impl))).toBeNull();
  });

  it('returns null when the fetch throws (timeout / network)', async () => {
    expect(
      await getPreviewThemeTokens('tok', BASE_CONFIG, depsWith(throwingFetch())),
    ).toBeNull();
  });
});

describe('resolvePreviewDoc', () => {
  it('is not a preview when the URL has no token', async () => {
    const { impl, calls } = jsonFetch({ tokens: {} });
    const result = await resolvePreviewDoc('/shop', BASE_CONFIG, depsWith(impl));
    expect(result).toEqual({ isPreview: false, doc: null });
    expect(calls()).toBe(0);
  });

  it('resolves the previewed doc when a token is present', async () => {
    const { impl } = jsonFetch({ tokens: { '--accent': '1 2 3' } });
    const result = await resolvePreviewDoc(
      `/?${PREVIEW_TOKEN_PARAM}=tok`,
      BASE_CONFIG,
      depsWith(impl),
    );
    expect(result).toEqual({ isPreview: true, doc: { '--accent': '1 2 3' } });
  });

  it('is a preview with a null doc when the preview fetch fails', async () => {
    const result = await resolvePreviewDoc(
      `/?${PREVIEW_TOKEN_PARAM}=tok`,
      BASE_CONFIG,
      depsWith(throwingFetch()),
    );
    expect(result).toEqual({ isPreview: true, doc: null });
  });
});
