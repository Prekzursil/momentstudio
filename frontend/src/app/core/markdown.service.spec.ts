import { TestBed } from '@angular/core/testing';

import { MarkdownService } from './markdown.service';

describe('MarkdownService', () => {
  let service: MarkdownService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [MarkdownService] });
    service = TestBed.inject(MarkdownService);
  });

  it('renders markdown to sanitized HTML', () => {
    const html = service.render('**bold**');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('renders empty input safely', () => {
    expect(service.render('')).toBe('');
    expect(service.render(undefined as never)).toBe('');
  });

  it('strips dangerous markup via sanitization', () => {
    const html = service.render('<script>alert(1)</script>ok');
    expect(html).not.toContain('<script>');
  });

  it('reports when sanitization changed the output', () => {
    const dirty = service.renderWithSanitizationReport('<img src=x onerror=alert(1)>');
    expect(dirty.sanitized).toBe(true);

    const clean = service.renderWithSanitizationReport('plain text');
    expect(clean.sanitized).toBe(false);
    expect(clean.html).toContain('plain text');
  });

  it('parses empty/falsy input in the sanitization report', () => {
    const report = service.renderWithSanitizationReport('');
    expect(report.html).toBe('');
    expect(report.sanitized).toBe(false);
  });

  it('returns raw HTML and sanitized=false when no sanitizer is available', () => {
    // Simulate an SSR-like environment where DOMPurify could not be created
    // (the `: null` purify branch). `window` is non-configurable in Chrome, so
    // we drive the runtime `!this.purify` branches by nulling the field.
    (service as unknown as { purify: unknown }).purify = null;

    const raw = service.render('<b>x</b>');
    expect(raw).toContain('<b>x</b>');

    const report = service.renderWithSanitizationReport('<b>x</b>');
    expect(report.sanitized).toBe(false);
    expect(report.html).toContain('<b>x</b>');
  });
});
