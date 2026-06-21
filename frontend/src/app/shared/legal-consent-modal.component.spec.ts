import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { TranslateService } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';

import { ApiService } from '../core/api.service';
import { MarkdownService } from '../core/markdown.service';
import { LegalConsentModalComponent } from './legal-consent-modal.component';
import { ModalBodyScrollEvent } from './modal.component';

describe('LegalConsentModalComponent', () => {
  let fixture: ComponentFixture<LegalConsentModalComponent>;
  let component: LegalConsentModalComponent;
  let api: jasmine.SpyObj<ApiService>;
  let markdown: jasmine.SpyObj<MarkdownService>;
  let langChange: Subject<unknown>;
  let translate: {
    currentLang: string;
    onLangChange: Subject<unknown>;
    instant: jasmine.Spy;
  };

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    markdown = jasmine.createSpyObj<MarkdownService>('MarkdownService', ['render']);
    markdown.render.and.callFake((md: string) => `<p>${md}</p>`);
    langChange = new Subject();
    translate = {
      currentLang: 'en',
      onLangChange: langChange,
      instant: jasmine.createSpy('instant').and.callFake((key: string) => key),
    };

    await TestBed.configureTestingModule({
      imports: [LegalConsentModalComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: TranslateService, useValue: translate },
        { provide: MarkdownService, useValue: markdown },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LegalConsentModalComponent);
    component = fixture.componentInstance;
  });

  function openChange(open: boolean): void {
    component.open = open;
    component.ngOnChanges({ open: new SimpleChange(!open, open, false) });
  }

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('does nothing in ngOnChanges when neither open nor slug changed', () => {
    component.ngOnChanges({ other: new SimpleChange(0, 1, true) });
    expect(api.get).not.toHaveBeenCalled();
  });

  it('shows a missing-doc error when opened without a slug', () => {
    component.slug = '   ';
    openChange(true);
    expect(component.error).toBe('legal.modal.missingDoc');
    expect(component.loading).toBe(false);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('treats a nullish slug as missing', () => {
    component.slug = null as never;
    openChange(true);
    expect(component.error).toBe('legal.modal.missingDoc');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('loads content for a slug and renders blocks', fakeAsync(() => {
    api.get.and.returnValue(
      of({
        title: 'Terms',
        body_markdown: 'body',
        images: [{ url: '/i.png', focal_x: 10, focal_y: 20 }],
        meta: { blocks: [{ type: 'text', body_markdown: 'b' }] },
      }),
    );
    component.slug = 'terms';
    openChange(true);
    expect(component.loading).toBe(false);
    expect(component.title).toBe('Terms');
    expect(component.pageBlocks.length).toBe(1);
    tick();
  }));

  it('uses a default title when the API omits one', fakeAsync(() => {
    api.get.and.returnValue(of({ images: 'not-array' }));
    component.slug = 'terms';
    openChange(true);
    expect(component.title).toBe('legal.modal.title');
    expect(component.firstImageUrl()).toBeNull();
    tick();
  }));

  it('uses the Romanian language when current lang is ro', fakeAsync(() => {
    translate.currentLang = 'ro';
    api.get.and.returnValue(of({ title: 'T', body_markdown: '', meta: null, images: [] }));
    component.slug = 'terms';
    openChange(true);
    expect(api.get).toHaveBeenCalledWith('/content/pages/terms', { lang: 'ro' });
    tick();
  }));

  it('surfaces the API error detail', () => {
    api.get.and.returnValue(throwError(() => ({ error: { detail: 'Nope' } })));
    component.slug = 'terms';
    openChange(true);
    expect(component.error).toBe('Nope');
    expect(component.loading).toBe(false);
  });

  it('falls back to a generic error message', () => {
    api.get.and.returnValue(throwError(() => ({})));
    component.slug = 'terms';
    openChange(true);
    expect(component.error).toBe('legal.modal.loadError');
  });

  it('resets when closed', () => {
    component.error = 'x';
    component.title = 'y';
    component.open = false;
    component.ngOnChanges({ open: new SimpleChange(true, false, false) });
    expect(component.error).toBe('');
    expect(component.title).toBe('');
  });

  it('reloads on language change only when open', () => {
    api.get.and.returnValue(of({ title: 'T', body_markdown: '', meta: null, images: [] }));
    component.slug = 'terms';
    component.open = true;
    langChange.next({ lang: 'ro' });
    expect(api.get).toHaveBeenCalledTimes(1);

    api.get.calls.reset();
    component.open = false;
    langChange.next({ lang: 'en' });
    expect(api.get).not.toHaveBeenCalled();
  });

  describe('focalPosition / firstImageFocal', () => {
    it('clamps and defaults focal coordinates', () => {
      expect(component.focalPosition()).toBe('50% 50%');
      expect(component.focalPosition(-5, 200)).toBe('0% 100%');
    });

    it('derives focal from the first image', fakeAsync(() => {
      api.get.and.returnValue(
        of({ title: 'T', body_markdown: '', meta: null, images: [{ url: '/i.png', focal_x: 30 }] }),
      );
      component.slug = 'terms';
      openChange(true);
      expect(component.firstImageUrl()).toBe('/i.png');
      expect(component.firstImageFocal()).toBe('30% 50%');
      tick();
    }));
  });

  describe('onBodyScroll', () => {
    it('clears the subtitle when content is not scrollable', () => {
      component.onBodyScroll({
        scrollTop: 0,
        clientHeight: 100,
        scrollHeight: 100,
        atBottom: false,
      } as ModalBodyScrollEvent);
      expect(component.subtitle).toBe('');
    });

    it('clears the subtitle once scrolled to the bottom', () => {
      component.onBodyScroll({
        scrollTop: 0,
        clientHeight: 100,
        scrollHeight: 500,
        atBottom: true,
      } as ModalBodyScrollEvent);
      expect(component.subtitle).toBe('');
    });

    it('prompts to scroll when content is scrollable and not at the bottom', () => {
      component.onBodyScroll({
        scrollTop: 0,
        clientHeight: 100,
        scrollHeight: 500,
        atBottom: false,
      } as ModalBodyScrollEvent);
      expect(component.subtitle).toBe('legal.modal.scrollToAccept');
    });
  });

  describe('confirmDisabled / handleAccept / handleClosed', () => {
    it('is disabled while loading or in error', () => {
      component.loading = true;
      expect(component.confirmDisabled()).toBe(true);
      component.loading = false;
      component.error = 'e';
      expect(component.confirmDisabled()).toBe(true);
      component.error = '';
      expect(component.confirmDisabled()).toBe(false);
    });

    it('does not emit accepted while disabled', () => {
      const accepted = jasmine.createSpy('accepted');
      component.accepted.subscribe(accepted);
      component.loading = true;
      component.handleAccept();
      expect(accepted).not.toHaveBeenCalled();
    });

    it('emits accepted and closes when enabled', () => {
      const accepted = jasmine.createSpy('accepted');
      const closed = jasmine.createSpy('closed');
      component.accepted.subscribe(accepted);
      component.closed.subscribe(closed);
      component.loading = false;
      component.error = '';
      component.handleAccept();
      expect(accepted).toHaveBeenCalled();
      expect(closed).toHaveBeenCalled();
    });
  });

  describe('sanitizeHtml', () => {
    it('returns sanitized HTML and empty for nullish input', () => {
      const sanitizer = TestBed.inject(DomSanitizer);
      spyOn(sanitizer, 'sanitize').and.returnValue('<b>safe</b>');
      expect(component.sanitizeHtml('<b>x</b>')).toBe('<b>safe</b>');

      (sanitizer.sanitize as jasmine.Spy).and.returnValue(null);
      expect(component.sanitizeHtml(undefined)).toBe('');
    });
  });

  it('unsubscribes from language changes on destroy', () => {
    component.ngOnDestroy();
    api.get.calls.reset();
    component.open = true;
    langChange.next({ lang: 'ro' });
    expect(api.get).not.toHaveBeenCalled();
  });
});
