import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ApiService } from './api.service';
import { SiteNavigationData, SiteNavigationService } from './site-navigation.service';

describe('SiteNavigationService', () => {
  let service: SiteNavigationService;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, SiteNavigationService],
    });
    service = TestBed.inject(SiteNavigationService);
  });

  it('parses links and skips invalid entries', () => {
    api.get.and.returnValue(
      of({
        meta: {
          header_links: [
            { id: 'h1', url: '/home', label: { en: 'Home', ro: 'Acasa' } },
            'not-an-object',
            null,
            { url: '', label: { en: 'X', ro: 'X' } },
            { url: '/no-label', label: { en: 'EN', ro: '' } },
            { id: 'dup', url: '/dup', label: { en: 'A', ro: 'A' } },
            { id: 'dup', url: '/dup2', label: { en: 'B', ro: 'B' } },
            { url: '/auto', label: { en: 'Auto', ro: 'Auto' } },
          ],
          footer_handcrafted_links: 'not-an-array',
          footer_legal_links: [{ url: '/legal', label: { en: 'Legal', ro: 'Legal' } }],
        },
      }),
    );

    let data: SiteNavigationData | null | undefined;
    service.get().subscribe((res) => (data = res));

    // Index 7 (the /auto entry) yields the auto id nav_8.
    expect(data?.headerLinks.map((l) => l.id)).toEqual(['h1', 'dup', 'nav_8']);
    expect(data?.footerHandcraftedLinks).toEqual([]);
    expect(data?.footerLegalLinks.length).toBe(1);
  });

  it('handles a missing meta and non-string label values', () => {
    api.get.and.returnValue(
      of({
        meta: {
          header_links: [{ url: 123, label: 'string-label' }],
        },
      }),
    );

    let data: SiteNavigationData | null | undefined;
    service.get().subscribe((res) => (data = res));
    // url is not a string and label is not an object -> entry skipped -> all empty -> null
    expect(data).toBeNull();
  });

  it('returns null when the block has no meta at all', () => {
    api.get.and.returnValue(of({}));

    let data: SiteNavigationData | null | undefined;
    service.get().subscribe((res) => (data = res));
    expect(data).toBeNull();
  });

  it('caches the observable and resets it on demand', () => {
    api.get.and.returnValue(of({ meta: {} }));

    service.get().subscribe();
    service.get().subscribe();
    expect(api.get).toHaveBeenCalledTimes(1);

    service.resetCache();
    service.get().subscribe();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('maps API errors to null', () => {
    api.get.and.returnValue(throwError(() => new Error('boom')));

    let data: SiteNavigationData | null | undefined;
    service.get().subscribe((res) => (data = res));
    expect(data).toBeNull();
  });
});
