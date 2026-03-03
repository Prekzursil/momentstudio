import { SimpleChange } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { ApiService } from '../core/api.service';
import { MarkdownService } from '../core/markdown.service';
import { LegalConsentModalComponent } from './legal-consent-modal.component';

describe('LegalConsentModalComponent', () => {
  let api: jasmine.SpyObj<ApiService>;
  let markdown: jasmine.SpyObj<MarkdownService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    markdown = jasmine.createSpyObj<MarkdownService>('MarkdownService', ['render']);
    markdown.render.and.callFake((value: string) => `<p>${value}</p>`);

    TestBed.configureTestingModule({
      imports: [LegalConsentModalComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: MarkdownService, useValue: markdown },
      ],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        legal: {
          modal: {
            title: 'Legal title',
            loading: 'Loading document',
            missingDoc: 'Missing legal document',
            loadError: 'Unable to load legal content',
            scrollToAccept: 'Scroll to accept',
          },
        },
      },
      true
    );
    translate.use('en');
  });

  it('handles missing slug branch and resets fields', () => {
    const fixture = TestBed.createComponent(LegalConsentModalComponent);
    const component = fixture.componentInstance;

    component.open = true;
    component.slug = '   ';
    component.ngOnChanges({
      open: new SimpleChange(false, true, false),
      slug: new SimpleChange('', '   ', false),
    });

    expect(component.loading).toBeFalse();
    expect(component.error).toBe('Missing legal document');
    expect(component.title).toBe('');
    expect(component.pageBlocks).toEqual([]);

    component.open = false;
    component.ngOnChanges({ open: new SimpleChange(true, false, false) });
    expect(component.error).toBe('');
    expect(component.bodyHtml).toBe('');
  });

  it('loads legal content successfully and maps title/body/images/pageBlocks', fakeAsync(() => {
    const fixture = TestBed.createComponent(LegalConsentModalComponent);
    const component = fixture.componentInstance;
    const emitBodyScroll = jasmine.createSpy('emitBodyScroll');
    component.modal = { emitBodyScroll } as any;

    api.get.and.returnValue(
      of({
        key: 'page.terms',
        title: 'Terms',
        body_markdown: 'Hello world',
        images: [{ url: '/hero.jpg', focal_x: 11, focal_y: 82 }],
        meta: {
          blocks: [
            { type: 'text', title: 'Intro', body_markdown: 'Intro body' },
          ],
        },
      } as any)
    );

    component.open = true;
    component.slug = 'terms';
    component.ngOnChanges({
      open: new SimpleChange(false, true, false),
      slug: new SimpleChange('', 'terms', false),
    });
    tick();

    expect(component.loading).toBeFalse();
    expect(component.error).toBe('');
    expect(component.title).toBe('Terms');
    expect(component.bodyHtml).toContain('<p>Hello world</p>');
    expect(component.pageBlocks.length).toBeGreaterThanOrEqual(1);
    expect(component.firstImageUrl()).toBe('/hero.jpg');
    expect(component.firstImageFocal()).toBe('11% 82%');
    expect(component.subtitle).toBe('Scroll to accept');
    expect(emitBodyScroll).toHaveBeenCalled();
  }));

  it('handles API error branch and keeps modal in non-loading state', () => {
    const fixture = TestBed.createComponent(LegalConsentModalComponent);
    const component = fixture.componentInstance;

    api.get.and.returnValue(throwError(() => ({ error: { detail: 'Document not available' } })));

    component.open = true;
    component.slug = 'terms';
    component.ngOnChanges({ open: new SimpleChange(false, true, false) });

    expect(component.loading).toBeFalse();
    expect(component.title).toBe('Legal title');
    expect(component.error).toBe('Document not available');
    expect(component.pageBlocks).toEqual([]);
  });

  it('updates subtitle on body scroll, blocks/accepts confirm, and closes cleanly', () => {
    const fixture = TestBed.createComponent(LegalConsentModalComponent);
    const component = fixture.componentInstance;
    const acceptedSpy = spyOn(component.accepted, 'emit').and.callThrough();
    const closedSpy = spyOn(component.closed, 'emit').and.callThrough();

    component.loading = false;
    component.error = '';

    component.onBodyScroll({ scrollTop: 0, scrollHeight: 700, clientHeight: 200, atBottom: false });
    expect(component.subtitle).toBe('Scroll to accept');

    component.onBodyScroll({ scrollTop: 500, scrollHeight: 700, clientHeight: 200, atBottom: true });
    expect(component.subtitle).toBe('');

    component.error = 'blocked';
    component.handleAccept();
    expect(acceptedSpy).not.toHaveBeenCalled();

    component.error = '';
    component.handleAccept();
    expect(acceptedSpy).toHaveBeenCalledTimes(1);
    expect(closedSpy).toHaveBeenCalledTimes(1);
    expect(component.title).toBe('');
    expect(component.bodyHtml).toBe('');
  });

  it('normalizes focal position and sanitizes html input values', () => {
    const fixture = TestBed.createComponent(LegalConsentModalComponent);
    const component = fixture.componentInstance;

    expect(component.focalPosition(undefined, undefined)).toBe('50% 50%');
    expect(component.focalPosition(-5, 140)).toBe('0% 100%');
    expect(component.sanitizeHtml('<b>ok</b>')).toContain('ok');
    expect(component.sanitizeHtml(null)).toBe('');
  });
});
