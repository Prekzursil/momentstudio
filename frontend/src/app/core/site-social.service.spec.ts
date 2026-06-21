import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ApiService } from './api.service';
import { SiteSocialService } from './site-social.service';

describe('SiteSocialService', () => {
  it('parses site.social meta and falls back for missing fields', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(
      of({
        meta: {
          version: 1,
          contact: { phone: '+1', email: 'a@b.com' },
          instagram_pages: [
            {
              label: 'A',
              url: 'https://example.com/a',
              thumbnail_url: 'https://example.com/a.png',
            },
            { label: '', url: 'https://bad.example.com' },
          ],
          facebook_pages: [],
        },
      }),
    );

    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, SiteSocialService],
    });

    const service = TestBed.inject(SiteSocialService);
    service.get().subscribe((data) => {
      expect(data.contact.phone).toBe('+1');
      expect(data.contact.email).toBe('a@b.com');
      expect(data.instagramPages.length).toBe(1);
      expect(data.instagramPages[0].label).toBe('A');
      // facebook_pages was empty -> fallback defaults include 2 pages
      expect(data.facebookPages.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('falls back to defaults when the endpoint errors', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(throwError(() => new Error('fail')));

    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, SiteSocialService],
    });

    const service = TestBed.inject(SiteSocialService);
    service.get().subscribe((data) => {
      expect(data.contact.phone).toBeTruthy();
      expect(data.contact.email).toBeTruthy();
      expect(data.instagramPages.length).toBeGreaterThanOrEqual(1);
      expect(data.facebookPages.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('caches the observable and resetCache clears it', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(of({ meta: null }));

    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, SiteSocialService],
    });
    const service = TestBed.inject(SiteSocialService);

    service.get().subscribe();
    service.get().subscribe();
    expect(api.get).toHaveBeenCalledTimes(1);

    service.resetCache();
    service.get().subscribe();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('cleans link thumbnails and drops invalid entries', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(
      of({
        meta: {
          instagram_pages: [
            { label: 'Trim', url: 'https://x.io', thumbnail_url: '  ' },
            { label: 'NumThumb', url: 'https://y.io', thumbnail_url: 123 },
            null,
            'not-an-object',
            { label: 'NoUrl', url: '' },
          ],
        },
      }),
    );

    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, SiteSocialService],
    });
    const service = TestBed.inject(SiteSocialService);
    service.get().subscribe((data) => {
      expect(data.instagramPages.length).toBe(2);
      expect(data.instagramPages[0].thumbnail_url).toBeNull();
      expect(data.instagramPages[1].thumbnail_url).toBeNull();
    });
  });

  it('coerces missing label/url fields before validating links', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(
      of({
        meta: {
          instagram_pages: [
            { url: 'https://only-url.io' },
            { label: 'only-label' },
            { label: 'Good', url: 'https://good.io' },
          ],
        },
      }),
    );

    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, SiteSocialService],
    });
    const service = TestBed.inject(SiteSocialService);
    service.get().subscribe((data) => {
      expect(data.instagramPages.length).toBe(1);
      expect(data.instagramPages[0].label).toBe('Good');
    });
  });

  it('keeps contact with only a phone when email is missing', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(of({ meta: { contact: { phone: '+1' } } }));

    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, SiteSocialService],
    });
    const service = TestBed.inject(SiteSocialService);
    service.get().subscribe((data) => {
      expect(data.contact.phone).toBe('+1');
      expect(data.contact.email).toBeNull();
    });
  });

  it('keeps contact with only an email when phone is missing', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(of({ meta: { contact: { email: 'only@b.com' } } }));

    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, SiteSocialService],
    });
    const service = TestBed.inject(SiteSocialService);
    service.get().subscribe((data) => {
      expect(data.contact.phone).toBeNull();
      expect(data.contact.email).toBe('only@b.com');
    });
  });

  it('keeps contact with only a phone and trims to null when empty', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(of({ meta: { contact: { phone: '+99', email: '   ' } } }));

    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, SiteSocialService],
    });
    const service = TestBed.inject(SiteSocialService);
    service.get().subscribe((data) => {
      expect(data.contact.phone).toBe('+99');
      expect(data.contact.email).toBeNull();
    });
  });

  it('falls back contact when it is not an object or fully blank', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(of({ meta: { contact: { phone: '', email: '' } } }));

    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, SiteSocialService],
    });
    const service = TestBed.inject(SiteSocialService);
    service.get().subscribe((data) => {
      expect(data.contact.phone).toBeTruthy();
    });
  });

  it('falls back contact when meta.contact is missing entirely', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(of({ meta: { instagram_pages: [] } }));

    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, SiteSocialService],
    });
    const service = TestBed.inject(SiteSocialService);
    service.get().subscribe((data) => {
      expect(data.contact.phone).toBeTruthy();
    });
  });
});
