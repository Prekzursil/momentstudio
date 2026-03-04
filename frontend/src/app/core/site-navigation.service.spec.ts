import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ApiService } from './api.service';
import { SiteNavigationService } from './site-navigation.service';

describe('SiteNavigationService', () => {
  let service: SiteNavigationService;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    TestBed.configureTestingModule({
      providers: [
        SiteNavigationService,
        { provide: ApiService, useValue: api },
      ],
    });
    service = TestBed.inject(SiteNavigationService);
  });

  it('parses and sanitizes navigation links from content meta', () => {
    api.get.and.returnValue(
      of({
        meta: {
          header_links: [
            { id: 'h1', url: '/shop', label: { en: 'Shop', ro: 'Magazin' } },
            { id: 'h1', url: '/dup', label: { en: 'Dup', ro: 'Dup' } },
            { id: '', url: '/about', label: { en: 'About', ro: 'Despre' } },
            { id: 'bad', url: '', label: { en: 'Bad', ro: 'Bad' } },
          ],
          footer_handcrafted_links: [{ id: 'f1', url: '/contact', label: { en: 'Contact', ro: 'Contact' } }],
          footer_legal_links: [{ id: 'l1', url: '/terms', label: { en: 'Terms', ro: 'Termeni' } }],
        },
      } as any),
    );

    let nav: any;
    service.get().subscribe((value) => (nav = value));

    expect(nav).toBeTruthy();
    expect(nav.headerLinks.length).toBe(2);
    expect(nav.headerLinks[0].id).toBe('h1');
    expect(nav.headerLinks[1].id).toBe('nav_3');
    expect(nav.footerHandcraftedLinks.length).toBe(1);
    expect(nav.footerLegalLinks.length).toBe(1);
  });

  it('returns null when service errors or when parsed lists are empty', () => {
    api.get.and.returnValue(throwError(() => ({ status: 500 })));

    let errorValue: any = 'unset';
    service.get().subscribe((value) => (errorValue = value));
    expect(errorValue).toBeNull();

    service.resetCache();
    api.get.and.returnValue(of({ meta: { header_links: [{ id: 'x', url: '/x', label: { en: '', ro: '' } }] } } as any));

    let emptyValue: any = 'unset';
    service.get().subscribe((value) => (emptyValue = value));
    expect(emptyValue).toBeNull();
  });

  it('caches successful result until resetCache is called', () => {
    api.get.and.returnValue(of({ meta: { header_links: [{ id: 'h1', url: '/shop', label: { en: 'Shop', ro: 'Magazin' } }] } } as any));

    service.get().subscribe();
    service.get().subscribe();

    expect(api.get).toHaveBeenCalledTimes(1);

    service.resetCache();
    service.get().subscribe();
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
