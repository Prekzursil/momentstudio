import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import { StructuredDataService } from './structured-data.service';

describe('StructuredDataService', () => {
  let doc: Document;
  let service: StructuredDataService;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('structured-data');
    TestBed.configureTestingModule({
      providers: [StructuredDataService, { provide: DOCUMENT, useValue: doc }]
    });
    service = TestBed.inject(StructuredDataService);
  });

  it('upserts route schemas with deterministic ids', () => {
    service.setRouteSchemas([
      { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Home' },
      { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Shop' }
    ]);

    const scripts = Array.from(doc.querySelectorAll('script[data-seo-route-schema="true"]'));
    expect(scripts.length).toBe(2);
    expect(scripts[0]?.id).toBe('seo-route-schema-1');
    expect(scripts[1]?.id).toBe('seo-route-schema-2');
  });

  it('removes stale managed scripts when schema count shrinks', () => {
    service.setRouteSchemas([
      { '@context': 'https://schema.org', '@type': 'WebPage', name: 'A' },
      { '@context': 'https://schema.org', '@type': 'WebPage', name: 'B' }
    ]);

    service.setRouteSchemas([{ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Only' }]);

    const scripts = Array.from(doc.querySelectorAll('script[data-seo-route-schema="true"]'));
    expect(scripts.length).toBe(1);
    expect(scripts[0]?.id).toBe('seo-route-schema-1');
    expect(scripts[0]?.textContent || '').toContain('Only');
  });

  it('clears managed route schemas', () => {
    service.setRouteSchemas([{ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Home' }]);
    service.clearRouteSchemas();

    const scripts = Array.from(doc.querySelectorAll('script[data-seo-route-schema="true"]'));
    expect(scripts.length).toBe(0);
  });
});
