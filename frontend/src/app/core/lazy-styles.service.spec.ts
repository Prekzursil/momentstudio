import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import { LazyStylesService } from './lazy-styles.service';

describe('LazyStylesService', () => {
  let service: LazyStylesService;
  let doc: Document;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('lazy-styles');
    TestBed.configureTestingModule({
      providers: [
        LazyStylesService,
        { provide: DOCUMENT, useValue: doc },
      ],
    });
    service = TestBed.inject(LazyStylesService);
  });

  it('returns immediately when style element already exists', async () => {
    const existing = doc.createElement('link');
    existing.dataset['lazyStyle'] = 'checkout';
    doc.head.appendChild(existing);

    await expectAsync(service.ensure('checkout', '/assets/checkout.css')).toBeResolved();
    expect(doc.querySelectorAll('link[data-lazy-style="checkout"]').length).toBe(1);
  });

  it('reuses inflight load promise and resolves on onload', async () => {
    const first = service.ensure('admin', '/assets/admin.css');
    const second = service.ensure('admin', '/assets/admin.css');
    const link = doc.querySelector<HTMLLinkElement>('link[data-lazy-style="admin"]');
    expect(link).toBeTruthy();

    link?.onload?.(new Event('load'));
    await expectAsync(first).toBeResolved();
    await expectAsync(second).toBeResolved();
  });

  it('removes failed link and rejects when stylesheet fails to load', async () => {
    const failing = service.ensure('broken', '/assets/broken.css');

    const link = doc.querySelector<HTMLLinkElement>('link[data-lazy-style="broken"]');
    expect(link).toBeTruthy();

    link?.onerror?.(new Event('error'));
    await expectAsync(failing).toBeRejected();
    expect(doc.querySelector('link[data-lazy-style="broken"]')).toBeNull();
  });
});

