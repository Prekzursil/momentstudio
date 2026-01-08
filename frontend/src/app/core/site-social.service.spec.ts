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
            { label: 'A', url: 'https://example.com/a', thumbnail_url: 'https://example.com/a.png' },
            { label: '', url: 'https://bad.example.com' }
          ],
          facebook_pages: []
        }
      })
    );

    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, SiteSocialService]
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
      providers: [{ provide: ApiService, useValue: api }, SiteSocialService]
    });

    const service = TestBed.inject(SiteSocialService);
    service.get().subscribe((data) => {
      expect(data.contact.phone).toBeTruthy();
      expect(data.contact.email).toBeTruthy();
      expect(data.instagramPages.length).toBeGreaterThanOrEqual(1);
      expect(data.facebookPages.length).toBeGreaterThanOrEqual(1);
    });
  });
});

