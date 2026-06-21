import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import { SeoHeadLinksService } from './seo-head-links.service';

describe('SeoHeadLinksService', () => {
  let doc: Document;
  let service: SeoHeadLinksService;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('seo-head-links');
    TestBed.configureTestingModule({
      providers: [SeoHeadLinksService, { provide: DOCUMENT, useValue: doc }],
    });
    service = TestBed.inject(SeoHeadLinksService);
  });

  it('upserts canonical and alternates with clean EN + lang=ro policy', () => {
    const href = service.setLocalizedCanonical('/shop/rings', 'ro', { sub: 'silver' });

    expect(href).toContain('/shop/rings?lang=ro&sub=silver');

    const canonical = doc.querySelector('link[rel="canonical"]');
    expect(canonical?.getAttribute('href')).toContain('/shop/rings?lang=ro&sub=silver');

    const alternates = Array.from(
      doc.querySelectorAll('link[rel="alternate"][data-seo-managed="true"]'),
    );
    expect(alternates.length).toBe(3);
    expect(doc.querySelector('link[hreflang="en"]')?.getAttribute('href')).toContain(
      '/shop/rings?sub=silver',
    );
    expect(doc.querySelector('link[hreflang="ro"]')?.getAttribute('href')).toContain(
      '/shop/rings?lang=ro&sub=silver',
    );
    expect(doc.querySelector('link[hreflang="x-default"]')?.getAttribute('href')).toContain(
      '/shop/rings?sub=silver',
    );
  });

  it('replaces managed alternates without duplicates', () => {
    service.setLocalizedCanonical('/blog', 'en', { page: 2 });
    service.setLocalizedCanonical('/blog/tag/design', 'ro', {});

    const canonical = doc.querySelector('link[rel="canonical"]');
    expect(canonical?.getAttribute('href')).toContain('/blog/tag/design?lang=ro');
    expect(doc.querySelectorAll('link[rel="canonical"]').length).toBe(1);

    const alternates = Array.from(
      doc.querySelectorAll('link[rel="alternate"][data-seo-managed="true"]'),
    );
    expect(alternates.length).toBe(3);
  });

  it('strips lang=en from canonical while keeping extra query params', () => {
    const href = service.setLocalizedCanonical('/blog', 'en', {
      lang: 'en',
      page: 2,
      q: 'ceramic',
    });
    expect(href).toContain('/blog?page=2&q=ceramic');
    expect(href).not.toContain('lang=en');

    expect(doc.querySelector('link[hreflang="en"]')?.getAttribute('href')).toContain(
      '/blog?page=2&q=ceramic',
    );
    expect(doc.querySelector('link[hreflang="ro"]')?.getAttribute('href')).toContain(
      '/blog?lang=ro&page=2&q=ceramic',
    );
  });

  it('defaults to an empty query when none is supplied', () => {
    const href = service.setLocalizedCanonical('/about', 'en');
    expect(href).not.toContain('?');
  });

  it('normalizes empty and slash-less paths', () => {
    expect(service.setLocalizedCanonical('', 'en')).toMatch(/\/$/);
    expect(service.setLocalizedCanonical('shop', 'en')).toContain('/shop');
  });

  it('skips undefined, non-finite, and blank query values', () => {
    const href = service.setLocalizedCanonical('/x', 'en', {
      a: undefined,
      b: Number.NaN,
      c: '   ',
      d: 'keep',
      n: 5,
    });
    expect(href).toContain('d=keep');
    expect(href).toContain('n=5');
    expect(href).not.toContain('a=');
    expect(href).not.toContain('b=');
    expect(href).not.toContain('c=');
  });

  describe('origin resolution', () => {
    function configureWithOrigin(origin: string | undefined): SeoHeadLinksService {
      const fakeDoc = {
        defaultView: { location: { origin } },
        querySelector: () => null,
        querySelectorAll: () => [] as unknown as NodeListOf<HTMLLinkElement>,
        createElement: (tag: string) => document.createElement(tag),
        head: { appendChild: () => undefined },
      } as unknown as Document;
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [SeoHeadLinksService, { provide: DOCUMENT, useValue: fakeDoc }],
      });
      return TestBed.inject(SeoHeadLinksService);
    }

    it('uses the document defaultView origin when present', () => {
      const svc = configureWithOrigin('https://from-doc.test');
      expect(svc.setLocalizedCanonical('/p', 'en')).toContain('https://from-doc.test');
    });

    it('falls back to window then configured base url', () => {
      const svc = configureWithOrigin(undefined);
      const href = svc.setLocalizedCanonical('/p', 'en');
      expect(href.startsWith('http')).toBeTrue();
    });
  });
});
