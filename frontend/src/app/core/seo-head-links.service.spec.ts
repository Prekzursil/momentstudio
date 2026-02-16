import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import { SeoHeadLinksService } from './seo-head-links.service';

describe('SeoHeadLinksService', () => {
  let doc: Document;
  let service: SeoHeadLinksService;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('seo-head-links');
    TestBed.configureTestingModule({
      providers: [SeoHeadLinksService, { provide: DOCUMENT, useValue: doc }]
    });
    service = TestBed.inject(SeoHeadLinksService);
  });

  it('upserts canonical and alternates with clean EN + lang=ro policy', () => {
    const href = service.setLocalizedCanonical('/shop/rings', 'ro', { sub: 'silver' });

    expect(href).toContain('/shop/rings?lang=ro&sub=silver');

    const canonical = doc.querySelector('link[rel="canonical"]');
    expect(canonical?.getAttribute('href')).toContain('/shop/rings?lang=ro&sub=silver');

    const alternates = Array.from(doc.querySelectorAll('link[rel="alternate"][data-seo-managed="true"]'));
    expect(alternates.length).toBe(3);
    expect(doc.querySelector('link[hreflang="en"]')?.getAttribute('href')).toContain('/shop/rings?sub=silver');
    expect(doc.querySelector('link[hreflang="ro"]')?.getAttribute('href')).toContain('/shop/rings?lang=ro&sub=silver');
    expect(doc.querySelector('link[hreflang="x-default"]')?.getAttribute('href')).toContain('/shop/rings?sub=silver');
  });

  it('replaces managed alternates without duplicates', () => {
    service.setLocalizedCanonical('/blog', 'en', { page: 2 });
    service.setLocalizedCanonical('/blog/tag/design', 'ro', {});

    const canonical = doc.querySelector('link[rel="canonical"]');
    expect(canonical?.getAttribute('href')).toContain('/blog/tag/design?lang=ro');
    expect(doc.querySelectorAll('link[rel="canonical"]').length).toBe(1);

    const alternates = Array.from(doc.querySelectorAll('link[rel="alternate"][data-seo-managed="true"]'));
    expect(alternates.length).toBe(3);
  });

  it('strips lang=en from canonical while keeping extra query params', () => {
    const href = service.setLocalizedCanonical('/blog', 'en', { lang: 'en', page: 2, q: 'ceramic' });
    expect(href).toContain('/blog?page=2&q=ceramic');
    expect(href).not.toContain('lang=en');

    expect(doc.querySelector('link[hreflang="en"]')?.getAttribute('href')).toContain('/blog?page=2&q=ceramic');
    expect(doc.querySelector('link[hreflang="ro"]')?.getAttribute('href')).toContain('/blog?lang=ro&page=2&q=ceramic');
  });
});
