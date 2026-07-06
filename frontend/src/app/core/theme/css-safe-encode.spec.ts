import { decodeCssEscapes, encodeCssSafe, isAllowedUrl } from './css-safe-encode';

describe('isAllowedUrl', () => {
  it('rejects an empty target', () => {
    expect(isAllowedUrl('')).toBe(false);
    expect(isAllowedUrl('   ')).toBe(false);
  });

  it('allows self/relative URLs (no scheme)', () => {
    expect(isAllowedUrl('/fonts/x.woff2')).toBe(true);
    expect(isAllowedUrl('./x.woff2')).toBe(true);
  });

  it('allows absolute https URLs', () => {
    expect(isAllowedUrl('https://cdn.example.com/f.woff2')).toBe(true);
  });

  it('rejects non-https schemes by origin, not substring', () => {
    expect(isAllowedUrl('http://cdn.example.com/f.woff2')).toBe(false);
    expect(isAllowedUrl('data:text/css,x')).toBe(false);
    expect(isAllowedUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects a malformed absolute URL (parse throws)', () => {
    expect(isAllowedUrl('https://[')).toBe(false);
  });
});

describe('decodeCssEscapes', () => {
  it('leaves an unescaped value unchanged', () => {
    expect(decodeCssEscapes('15 23 42')).toBe('15 23 42');
  });

  it('decodes a hex escape', () => {
    expect(decodeCssEscapes('\\3c')).toBe('<');
  });

  it('consumes a single trailing whitespace after a hex escape', () => {
    expect(decodeCssEscapes('\\3c ')).toBe('<');
  });

  it('maps NULL to the replacement character', () => {
    expect(decodeCssEscapes('\\0')).toBe('\uFFFD');
  });

  it('maps an out-of-range codepoint to the replacement character', () => {
    expect(decodeCssEscapes('\\ffffff')).toBe('\uFFFD');
  });

  it('decodes a literal (non-hex) escape', () => {
    expect(decodeCssEscapes('\\g')).toBe('g');
  });
});

describe('encodeCssSafe', () => {
  it('accepts a clean value and returns it decoded', () => {
    const result = encodeCssSafe('15 23 42');
    expect(result.ok).toBe(true);
    expect(result.value).toBe('15 23 42');
  });

  it('rejects control characters', () => {
    expect(encodeCssSafe('15 23\u000142').ok).toBe(false);
  });

  it('rejects the DEL control character', () => {
    expect(encodeCssSafe('a\u007fb').ok).toBe(false);
  });

  it('rejects angle brackets', () => {
    expect(encodeCssSafe('</style>').ok).toBe(false);
  });

  it('rejects rule/declaration breakout characters', () => {
    expect(encodeCssSafe('a{b').ok).toBe(false);
    expect(encodeCssSafe('a}b').ok).toBe(false);
    expect(encodeCssSafe('a;b').ok).toBe(false);
  });

  it('rejects @import, expression() and javascript: sinks', () => {
    expect(encodeCssSafe('@import url(x)').ok).toBe(false);
    expect(encodeCssSafe('expression(alert(1))').ok).toBe(false);
    expect(encodeCssSafe('javascript:alert(1)').ok).toBe(false);
  });

  it('rejects any url() when allowUrl is not set', () => {
    expect(encodeCssSafe('url(https://a.com)').ok).toBe(false);
  });

  it('allows an https/self url() when allowUrl is set', () => {
    expect(encodeCssSafe('url(https://a.com/f.woff2)', { allowUrl: true }).ok).toBe(true);
    expect(encodeCssSafe("url('/self.woff2')", { allowUrl: true }).ok).toBe(true);
  });

  it('rejects a disallowed-scheme url() even when allowUrl is set', () => {
    expect(encodeCssSafe('url(data:text/css,x)', { allowUrl: true }).ok).toBe(false);
  });

  it('rejects an unparseable url( when allowUrl is set', () => {
    expect(encodeCssSafe('url(unclosed', { allowUrl: true }).ok).toBe(false);
  });
});
