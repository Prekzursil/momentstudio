import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { MarkdownService } from '../../core/markdown.service';
import { SeoHeadLinksService } from '../../core/seo-head-links.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';
import { AboutComponent } from './about.component';

describe('AboutComponent', () => {
  let meta: jasmine.SpyObj<Meta>;
  let title: jasmine.SpyObj<Title>;
  let api: jasmine.SpyObj<ApiService>;
  let seoHeadLinks: jasmine.SpyObj<SeoHeadLinksService>;
  let translate: TranslateService;
  let queryParams$: BehaviorSubject<Record<string, unknown>>;
  let adminEnabled: boolean;

  beforeEach(() => {
    queryParams$ = new BehaviorSubject<Record<string, unknown>>({});
    adminEnabled = false;
    meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    seoHeadLinks = jasmine.createSpyObj<SeoHeadLinksService>('SeoHeadLinksService', [
      'setLocalizedCanonical',
    ]);
    seoHeadLinks.setLocalizedCanonical.and.returnValue('http://localhost:4200/about');
    api.get.and.callFake((path: string, params?: Record<string, unknown>) => {
      if (path !== '/content/pages/about') throw new Error(`Unexpected path: ${path}`);
      if (params?.['lang'] === 'ro') {
        return of({ title: 'Despre noi', body_markdown: 'Salut', meta: null, images: [] } as any);
      }
      return of({ title: 'About', body_markdown: 'Hello', meta: null, images: [] } as any);
    });
    const markdown = { render: (s: string) => s } as unknown as MarkdownService;

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, AboutComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: ApiService, useValue: api },
        { provide: SeoHeadLinksService, useValue: seoHeadLinks },
        { provide: StorefrontAdminModeService, useValue: { enabled: () => adminEnabled } },
        { provide: MarkdownService, useValue: markdown },
        { provide: ActivatedRoute, useValue: { queryParams: queryParams$.asObservable() } },
      ],
    });

    translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        about: { metaTitle: 'About | momentstudio', metaDescription: 'About desc' },
      },
      true,
    );
    translate.setTranslation(
      'ro',
      {
        about: { metaTitle: 'Despre noi | momentstudio', metaDescription: 'Descriere' },
      },
      true,
    );
    translate.use('en');
  });

  it('sets meta tags on init', () => {
    const fixture = TestBed.createComponent(AboutComponent);
    fixture.detectChanges();

    expect(title.setTitle).toHaveBeenCalledWith('About | momentstudio');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Hello' });
    expect(meta.updateTag).toHaveBeenCalledWith({ property: 'og:description', content: 'Hello' });
    expect(meta.updateTag).toHaveBeenCalledWith({
      property: 'og:title',
      content: 'About | momentstudio',
    });
    expect(seoHeadLinks.setLocalizedCanonical).toHaveBeenCalledWith('/about', 'en', {});
    expect(meta.updateTag).toHaveBeenCalledWith({
      property: 'og:url',
      content: 'http://localhost:4200/about',
    });
  });

  it('updates meta tags when language changes', () => {
    const fixture = TestBed.createComponent(AboutComponent);
    fixture.detectChanges();

    title.setTitle.calls.reset();
    meta.updateTag.calls.reset();
    seoHeadLinks.setLocalizedCanonical.calls.reset();
    seoHeadLinks.setLocalizedCanonical.and.returnValue('http://localhost:4200/about?lang=ro');

    translate.use('ro');

    expect(title.setTitle).toHaveBeenCalledWith('Despre noi | momentstudio');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Salut' });
    expect(meta.updateTag).toHaveBeenCalledWith({ property: 'og:description', content: 'Salut' });
    expect(meta.updateTag).toHaveBeenCalledWith({
      property: 'og:title',
      content: 'Despre noi | momentstudio',
    });
    expect(seoHeadLinks.setLocalizedCanonical).toHaveBeenCalledWith('/about', 'ro', {});
    expect(meta.updateTag).toHaveBeenCalledWith({
      property: 'og:url',
      content: 'http://localhost:4200/about?lang=ro',
    });
  });

  it('uses page blocks for meta description when present', () => {
    api.get.and.callFake((path: string, params?: Record<string, unknown>) => {
      if (path !== '/content/pages/about') throw new Error(`Unexpected path: ${path}`);
      if (params?.['lang'] === 'ro') {
        return of({
          title: 'Despre noi',
          body_markdown: 'Salut',
          meta: {
            blocks: [
              {
                key: 'intro',
                type: 'text',
                enabled: true,
                title: { ro: 'Introducere' },
                body_markdown: { ro: 'Bun venit' },
              },
            ],
          },
          images: [],
        } as any);
      }
      return of({
        title: 'About',
        body_markdown: 'Hello',
        meta: {
          blocks: [
            {
              key: 'intro',
              type: 'text',
              enabled: true,
              title: { en: 'Intro' },
              body_markdown: { en: 'Welcome' },
            },
          ],
        },
        images: [],
      } as any);
    });

    const fixture = TestBed.createComponent(AboutComponent);
    fixture.detectChanges();

    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Intro Welcome' });
  });

  it('stops updating after destroy', () => {
    const fixture = TestBed.createComponent(AboutComponent);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();
    cmp.ngOnDestroy();

    title.setTitle.calls.reset();
    meta.updateTag.calls.reset();

    translate.use('ro');

    expect(title.setTitle).not.toHaveBeenCalled();
    expect(meta.updateTag).not.toHaveBeenCalled();
  });

  it('clamps and rounds focal positions, defaulting missing values', () => {
    const cmp = TestBed.createComponent(AboutComponent).componentInstance;
    expect(cmp.focalPosition(undefined, undefined)).toBe('50% 50%');
    expect(cmp.focalPosition(-20, 200)).toBe('0% 100%');
    expect(cmp.focalPosition(33.6, 66.4)).toBe('34% 66%');
  });

  it('exposes edit availability from the storefront admin mode service', () => {
    adminEnabled = true;
    const cmp = TestBed.createComponent(AboutComponent).componentInstance;
    expect(cmp.canEditPage()).toBeTrue();
  });

  it('navigates to the page editor on editPage', () => {
    const cmp = TestBed.createComponent(AboutComponent).componentInstance;
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate').and.resolveTo(true);
    cmp.editPage();
    expect(navSpy).toHaveBeenCalledWith(['/admin/content/pages'], {
      queryParams: { edit: 'about' },
    });
  });

  it('shows fallback meta tags when loading fails', () => {
    translate.setTranslation(
      'en',
      { about: { metaTitle: '', metaDescription: 'About desc' } },
      true,
    );
    api.get.and.returnValue(throwError(() => new Error('boom')));
    const fixture = TestBed.createComponent(AboutComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.hasError()).toBeTrue();
    expect(fixture.componentInstance.block()).toBeNull();
    expect(title.setTitle).toHaveBeenCalledWith('About | momentstudio');
  });

  it('requests the preview endpoint when a preview token is present', () => {
    queryParams$.next({ preview: 'tok-1' });
    api.get.and.returnValue(
      of({ title: 'Preview', body_markdown: 'Body', meta: null, images: [] } as any),
    );
    const fixture = TestBed.createComponent(AboutComponent);
    fixture.detectChanges();

    expect(api.get).toHaveBeenCalledWith('/content/pages/about/preview', {
      token: 'tok-1',
      lang: 'en',
    });
  });

  it('treats a non-string preview query value as no token', () => {
    queryParams$.next({ preview: ['arr'] });
    const fixture = TestBed.createComponent(AboutComponent);
    fixture.detectChanges();
    expect(api.get).toHaveBeenCalledWith('/content/pages/about', { lang: 'en' });
  });

  it('falls back to route defaults when the body is empty', () => {
    api.get.and.returnValue(
      of({ title: 'Empty', body_markdown: '', meta: null, images: [] } as any),
    );
    const fixture = TestBed.createComponent(AboutComponent);
    fixture.detectChanges();
    const descriptionCall = meta.updateTag.calls
      .all()
      .map((c) => c.args[0])
      .find((t) => (t as { name?: string }).name === 'description');
    expect((descriptionCall as { content: string }).content.length).toBeGreaterThan(0);
  });
});
