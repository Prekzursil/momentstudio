import {
  COMPILED_DEFAULT_TOKENS,
  STYLE_ELEMENT_ID,
  applyThemeSsr,
  buildCspReportOnly,
  buildThemeCss,
  buildThemeHead,
  injectThemeHead,
  resolveThemeTokens,
  sha256Base64,
} from './theme-head';

// Representative malicious/valid fixtures mirroring the WU2 corpus categories.
// The FULL shared corpus (`test-fixtures/theme-token-corpus.json`) parity is
// owned by the WU13 security lane; WU6 keeps its sink test self-contained (and
// free of the JSON import-attribute the corpus specs use) so it compiles under
// any module resolution.
const REJECT_FIXTURES: readonly { readonly name: string; readonly value: string }[] = [
  { name: '--background', value: '15 23 42) } html{background:url(x)' }, // triplet breakout
  { name: '--background', value: '10, 20, 30' }, // commas — invalid triplet
  { name: '--background', value: '999 0 0' }, // out-of-range channel
  { name: '--background', value: '#0f172a' }, // hex in a triplet slot
  { name: '--surface', value: '1 2 3</style><script>alert(1)</script>' }, // </style> injection
  { name: '--surface', value: '\\3c script\\3e' }, // unicode-escaped <
  { name: '--accent', value: 'url(javascript:alert(1))' }, // js url
  { name: '--font-body', value: 'Comic Sans' }, // not in curated enum
  { name: '--unknown-token', value: '1 2 3' }, // name not in the registry
  { name: '--Bad_Name', value: '1 2 3' }, // underscore fails the name regex
];
const OK_FIXTURES: readonly { readonly name: string; readonly value: string }[] = [
  { name: '--background', value: '255 255 255' },
  { name: '--accent', value: '79 70 229' },
  { name: '--surface-200', value: '200 210 220' }, // server-emitted ramp name
  { name: '--font-body', value: 'Inter, system-ui, -apple-system, sans-serif' },
];

// Portable base64 SHA-256 oracle (independent of the module under test) so the
// hash assertion is a genuine cross-check, not a tautology.
async function oracleHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

describe('COMPILED_DEFAULT_TOKENS', () => {
  it('is the frozen WU3 seed baseline (background canvas is white)', () => {
    expect(COMPILED_DEFAULT_TOKENS['--background']).toBe('255 255 255');
    expect(Object.isFrozen(COMPILED_DEFAULT_TOKENS)).toBe(true);
  });
});

describe('resolveThemeTokens', () => {
  it('returns the pure compiled defaults for a null doc (backend blip / kill-switch)', () => {
    const resolved = resolveThemeTokens(null);
    expect(resolved).toEqual({ ...COMPILED_DEFAULT_TOKENS });
  });

  it('overlays a valid doc value over the default', () => {
    const resolved = resolveThemeTokens({ '--background': '10 20 30' });
    expect(resolved['--background']).toBe('10 20 30');
  });

  it('keeps the default when a known token carries an invalid value', () => {
    const resolved = resolveThemeTokens({ '--background': 'not-a-triplet' });
    expect(resolved['--background']).toBe('255 255 255');
  });

  it('drops an unknown token name entirely (never emitted)', () => {
    const resolved = resolveThemeTokens({ '--evil-name': '1 2 3' });
    expect(resolved['--evil-name']).toBeUndefined();
  });

  it('accepts a valid server-emitted ramp name not present in the defaults', () => {
    const resolved = resolveThemeTokens({ '--surface-200': '200 210 220' });
    expect(resolved['--surface-200']).toBe('200 210 220');
  });

  it('never leaks any rejected payload into the emitted CSS (defaults instead)', () => {
    for (const fixture of REJECT_FIXTURES) {
      const css = buildThemeCss(resolveThemeTokens({ [fixture.name]: fixture.value }));
      // A rejected declaration must not appear as `name: value` in the block.
      expect(css.includes(`${fixture.name}: ${fixture.value};`)).toBe(false);
      // The whole malicious value must never appear anywhere in the CSS.
      expect(css.includes(fixture.value)).toBe(false);
    }
  });

  it('emits every accepted value verbatim', () => {
    for (const fixture of OK_FIXTURES) {
      const css = buildThemeCss(resolveThemeTokens({ [fixture.name]: fixture.value }));
      expect(css.includes(`${fixture.name}: ${fixture.value};`)).toBe(true);
    }
  });
});

describe('buildThemeCss', () => {
  it('wraps sorted declarations in a :root block', () => {
    const css = buildThemeCss({ '--b': '2', '--a': '1' });
    expect(css).toBe(':root{--a: 1;--b: 2;}');
  });
});

describe('sha256Base64', () => {
  it('matches an independent SubtleCrypto oracle', async () => {
    const text = ':root{--background: 255 255 255;}';
    expect(await sha256Base64(text)).toBe(await oracleHash(text));
  });
});

describe('buildCspReportOnly', () => {
  it('carries the style-src hash plus base-uri / object-src / frame-ancestors (N-C1)', () => {
    const header = buildCspReportOnly('ABC123');
    expect(header).toContain("style-src 'sha256-ABC123'");
    expect(header).toContain("base-uri 'self'");
    expect(header).toContain("object-src 'none'");
    expect(header).toContain("frame-ancestors 'self'");
  });
});

describe('buildThemeHead', () => {
  it('emits the hash-pinned style tag whose hash matches the CSS body', async () => {
    const head = await buildThemeHead({ '--background': '10 20 30' });
    expect(head.styleTag).toBe(`<style id="${STYLE_ELEMENT_ID}">${head.css}</style>`);
    expect(head.hash).toBe(await oracleHash(head.css));
    expect(head.cspHeader).toContain(`'sha256-${head.hash}'`);
    expect(head.tokens['--background']).toBe('10 20 30');
  });
});

describe('injectThemeHead', () => {
  it('inserts the style as the first head child (no-FOUC: :root in the first head bytes)', () => {
    const html = '<!doctype html><html><head><base href="/"></head><body>x</body></html>';
    const out = injectThemeHead(html, '<style id="ms-theme">:root{}</style>');
    const headOpen = out.indexOf('<head>') + '<head>'.length;
    expect(out.slice(headOpen).startsWith('<style id="ms-theme">')).toBe(true);
    expect(out.indexOf('<style id="ms-theme">')).toBeLessThan(out.indexOf('<base'));
    expect(out.indexOf('<style id="ms-theme">')).toBeLessThan(out.indexOf('<body'));
  });

  it('falls back to before </head> when there is no opening head tag', () => {
    const out = injectThemeHead('prefix</head>rest', '<style>x</style>');
    expect(out).toBe('prefix<style>x</style></head>rest');
  });

  it('prepends when the document has no head at all', () => {
    const out = injectThemeHead('<body>x</body>', '<style>x</style>');
    expect(out).toBe('<style>x</style><body>x</body>');
  });
});

describe('applyThemeSsr', () => {
  it('returns head-injected HTML plus the matching report-only CSP header', async () => {
    const html = '<html><head></head><body>hi</body></html>';
    const rendered = await applyThemeSsr(html, { '--background': '10 20 30' });
    expect(rendered.html).toContain('<style id="ms-theme">');
    expect(rendered.html).toContain('--background: 10 20 30;');
    const head = await buildThemeHead({ '--background': '10 20 30' });
    expect(rendered.cspHeader).toBe(head.cspHeader);
  });

  it('degrades a null doc to the full compiled-default block (never unstyled)', async () => {
    const rendered = await applyThemeSsr('<head></head>', null);
    expect(rendered.html).toContain('--background: 255 255 255;');
  });
});
