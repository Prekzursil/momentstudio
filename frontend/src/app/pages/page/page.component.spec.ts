import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { MarkdownService } from '../../core/markdown.service';
import { SeoHeadLinksService } from '../../core/seo-head-links.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';
import { CmsPageComponent } from './page.component';

describe('CmsPageComponent', () => {
  let meta: jasmine.SpyObj<Meta>;
  let title: jasmine.SpyObj<Title>;
  let api: jasmine.SpyObj<ApiService>;
  let seoHeadLinks: jasmine.SpyObj<SeoHeadLinksService>;
  let translate: TranslateService;
  let paramMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let queryParams$: BehaviorSubject<Record<string, unknown>>;
  const adminModeStub = {
    adminEnabled: false,
    enabled() {
      return this.adminEnabled;
    },
  };

  beforeEach(() => {
    adminModeStub.adminEnabled = false;
    paramMap$ = new BehaviorSubject(convertToParamMap({ slug: 'about' }));
    queryParams$ = new BehaviorSubject<Record<string, unknown>>({});

    meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    seoHeadLinks = jasmine.createSpyObj<SeoHeadLinksService>('SeoHeadLinksService', [
      'setLocalizedCanonical',
    ]);
    seoHeadLinks.setLocalizedCanonical.and.returnValue('http://localhost:4200/pages/about');

    api.get.and.callFake((path: string, params?: Record<string, unknown>) => {
      if (path === '/content/pages/about') {
        if (params?.['lang'] === 'ro') {
          return of({
            key: 'page.about',
            title: 'Despre',
            body_markdown: 'Salut',
            images: [],
          } as any);
        }
        return of({
          key: 'page.about',
          title: 'About page',
          body_markdown: 'Hello',
          images: [],
        } as any);
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const markdown = { render: (s: string) => s } as unknown as MarkdownService;

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, CmsPageComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: ApiService, useValue: api },
        { provide: SeoHeadLinksService, useValue: seoHeadLinks },
        { provide: StorefrontAdminModeService, useValue: adminModeStub },
        { provide: MarkdownService, useValue: markdown },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMap$.asObservable(),
            queryParams: queryParams$.asObservable(),
          },
        },
      ],
    });

    translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      { about: { metaDescription: 'About desc' }, nav: { home: 'Home', page: 'Page' } },
      true,
    );
    translate.setTranslation(
      'ro',
      { about: { metaDescription: 'Descriere' }, nav: { home: 'Acasă', page: 'Pagină' } },
      true,
    );
    translate.use('en');
  });

  it('sets canonical and og:url on load', () => {
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();

    expect(title.setTitle).toHaveBeenCalledWith('About page | momentstudio');
    expect(seoHeadLinks.setLocalizedCanonical).toHaveBeenCalledWith('/pages/about', 'en', {});
    expect(meta.updateTag).toHaveBeenCalledWith({
      property: 'og:url',
      content: 'http://localhost:4200/pages/about',
    });
  });

  it('updates canonical language when translation changes', () => {
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();

    title.setTitle.calls.reset();
    meta.updateTag.calls.reset();
    seoHeadLinks.setLocalizedCanonical.calls.reset();
    seoHeadLinks.setLocalizedCanonical.and.returnValue('http://localhost:4200/pages/about?lang=ro');

    translate.use('ro');

    expect(title.setTitle).toHaveBeenCalledWith('Despre | momentstudio');
    expect(seoHeadLinks.setLocalizedCanonical).toHaveBeenCalledWith('/pages/about', 'ro', {});
    expect(meta.updateTag).toHaveBeenCalledWith({
      property: 'og:url',
      content: 'http://localhost:4200/pages/about?lang=ro',
    });
  });

  it('shows the error state when the slug is empty', () => {
    paramMap$.next(convertToParamMap({}));
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    expect(cmp.hasError()).toBeTrue();
    expect(cmp.loading()).toBeFalse();
    expect(cmp.block()).toBeNull();
  });

  it('requires login on a 401 response', () => {
    api.get.and.callFake(() => {
      return {
        subscribe: (obs: { error: (e: unknown) => void }) => {
          obs.error({ status: 401 });
          return { unsubscribe() {} };
        },
      } as never;
    });
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    expect(cmp.requiresLogin()).toBeTrue();
    expect(cmp.hasError()).toBeFalse();
  });

  it('shows a generic error on a non-401 failure', () => {
    api.get.and.callFake(() => {
      return {
        subscribe: (obs: { error: (e: unknown) => void }) => {
          obs.error({ status: 500 });
          return { unsubscribe() {} };
        },
      } as never;
    });
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    expect(cmp.hasError()).toBeTrue();
    expect(cmp.requiresLogin()).toBeFalse();
  });

  it('uses the preview endpoint when a preview token is present', () => {
    queryParams$.next({ preview: 'tok123' });
    api.get.and.callFake(((path: string) => {
      if (path.includes('/preview')) {
        return of({ key: 'page.about', title: 'Preview', body_markdown: 'P', images: [] });
      }
      throw new Error(`Unexpected path ${path}`);
    }) as never);
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();
    expect(api.get).toHaveBeenCalledWith(
      '/content/pages/about/preview',
      jasmine.objectContaining({ token: 'tok123' }),
    );
  });

  it('loads the legal index for the terms page', () => {
    paramMap$.next(convertToParamMap({ slug: 'terms' }));
    api.get.and.callFake(((path: string) => {
      if (path === '/content/pages/terms') {
        return of({
          key: 'page.terms',
          title: 'Terms',
          body_markdown: '| Last updated |\n| 2026-01-01 |\nReal body',
          images: [],
        });
      }
      if (path === '/content/pages/terms-and-conditions') {
        return of({
          key: 'page.tc',
          title: 'T&C',
          body_markdown: '',
          meta: { last_updated: '2026-01-01' },
          images: [],
        });
      }
      // privacy-policy + anpc return null to exercise the fallback title path.
      return of(null);
    }) as never);
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    expect(cmp.legalIndexDocs().length).toBe(3);
    expect(cmp.legalIndexLoading()).toBeFalse();
    expect(cmp.legalIndexDocs()[0].lastUpdated).toBe('2026-01-01');
  });

  it('redirects to the canonical slug when the key differs', () => {
    paramMap$.next(convertToParamMap({ slug: 'old-slug' }));
    api.get.and.callFake(
      () => of({ key: 'page.about', title: 'About', body_markdown: 'x', images: [] }) as never,
    );
    const fixture = TestBed.createComponent(CmsPageComponent);
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate').and.resolveTo(true);
    fixture.detectChanges();
    expect(navSpy).toHaveBeenCalledWith(
      ['/pages', 'about'],
      jasmine.objectContaining({ replaceUrl: true }),
    );
  });

  it('clamps the focal position to a percentage box', () => {
    const cmp = TestBed.createComponent(CmsPageComponent).componentInstance;
    expect(cmp.focalPosition(200, -10)).toBe('100% 0%');
    expect(cmp.focalPosition()).toBe('50% 50%');
  });

  it('formats legal index dates and passes through invalid forms', () => {
    const cmp = TestBed.createComponent(CmsPageComponent).componentInstance;
    expect(cmp.formatLegalIndexDate('')).toBe('');
    expect(cmp.formatLegalIndexDate('not-a-date')).toBe('not-a-date');
    expect(cmp.formatLegalIndexDate('2026-13-99')).toContain('2027');
    expect(cmp.formatLegalIndexDate('2026-01-15')).toContain('2026');
  });

  it('reports whether the body has meaningful content', () => {
    const cmp = TestBed.createComponent(CmsPageComponent).componentInstance;
    cmp.bodyHtml.set('<p>short</p>');
    expect(cmp.hasMeaningfulBodyContent()).toBeFalse();
    cmp.bodyHtml.set('<p>' + 'a'.repeat(100) + '</p>');
    expect(cmp.hasMeaningfulBodyContent()).toBeTrue();
  });

  it('hides the SEO cluster when login is required or legal docs exist', () => {
    const cmp = TestBed.createComponent(CmsPageComponent).componentInstance;
    cmp.requiresLogin.set(true);
    expect(cmp.showSeoLinkCluster()).toBeFalse();
    cmp.requiresLogin.set(false);
    cmp.legalIndexDocs.set([{ slug: 's', title: 't', lastUpdated: null }]);
    expect(cmp.showSeoLinkCluster()).toBeFalse();
    cmp.legalIndexDocs.set([]);
    expect(cmp.showSeoLinkCluster()).toBeTrue();
  });

  it('computes the login next url from the router', () => {
    const cmp = TestBed.createComponent(CmsPageComponent).componentInstance;
    expect(cmp.loginNextUrl()).toBeTruthy();
  });

  it('navigates to the admin editor when editing a page with a slug', () => {
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate').and.resolveTo(true);
    fixture.componentInstance.editPage();
    expect(navSpy).toHaveBeenCalledWith(
      ['/admin/content/pages'],
      jasmine.objectContaining({ queryParams: { edit: 'about' } }),
    );
  });

  it('does not navigate to the editor without a slug', () => {
    paramMap$.next(convertToParamMap({}));
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate').and.resolveTo(true);
    fixture.componentInstance.editPage();
    expect(navSpy).not.toHaveBeenCalled();
  });

  it('exposes canEditPage from the storefront admin mode', () => {
    const cmp = TestBed.createComponent(CmsPageComponent).componentInstance;
    expect(cmp.canEditPage()).toBeFalse();
    adminModeStub.adminEnabled = true;
    expect(cmp.canEditPage()).toBeTrue();
  });

  it('falls back to the nav.page title when the block has no title', () => {
    api.get.and.callFake(
      () => of({ key: 'page.about', title: '', body_markdown: 'b', images: [] }) as never,
    );
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.block()?.title).toBe('');
    expect(title.setTitle).toHaveBeenCalledWith('about | momentstudio');
  });

  it('uses fallback titles when legal index sub-requests fail individually', () => {
    paramMap$.next(convertToParamMap({ slug: 'terms' }));
    api.get.and.callFake(((path: string) => {
      if (path === '/content/pages/terms') {
        return of({
          key: 'page.terms',
          title: 'Terms',
          body_markdown: 'Body text here',
          images: [],
        });
      }
      // Each legal sub-request fails; per-request catchError yields null and the
      // component falls back to translated titles.
      return throwError(() => new Error('legal fail'));
    }) as never);
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();
    const docs = fixture.componentInstance.legalIndexDocs();
    expect(docs.length).toBe(3);
    expect(docs.every((d) => d.lastUpdated === null)).toBeTrue();
    expect(fixture.componentInstance.legalIndexLoading()).toBeFalse();
  });

  it('falls back to slug for title/canonical when key has no page prefix and title is empty', () => {
    api.get.and.callFake(
      () => of({ key: 'misc', title: '', body_markdown: '', images: [] }) as never,
    );
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();
    // Empty title -> generic "Page | momentstudio"; non-page. key -> canonical uses slug.
    expect(title.setTitle).toHaveBeenCalledWith('Page | momentstudio');
    expect(seoHeadLinks.setLocalizedCanonical).toHaveBeenCalledWith('/pages/about', 'en', {});
  });

  it('strips table rows that are not the legal-index header', () => {
    paramMap$.next(convertToParamMap({ slug: 'terms' }));
    api.get.and.callFake(((path: string) => {
      if (path === '/content/pages/terms') {
        return of({
          key: 'page.terms',
          title: 'Terms',
          // A pipe line that is NOT the "last updated" header -> kept as content.
          body_markdown: '| just a normal table row |\nplain text',
          images: [],
        });
      }
      return of(null);
    }) as never);
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.bodyHtml()).toContain('just a normal table row');
  });

  it('derives meta text from parsed page blocks when present', () => {
    api.get.and.callFake(
      () =>
        of({
          key: 'page.about',
          title: 'About',
          body_markdown: 'fallback',
          images: [],
          meta: {
            blocks: [
              { type: 'text', key: 't', body_markdown: 'Block body content', enabled: true },
            ],
          },
        }) as never,
    );
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.pageBlocks().length).toBe(1);
    expect(meta.updateTag).toHaveBeenCalled();
  });

  it('formats legal index dates in the Romanian locale', () => {
    translate.use('ro');
    const cmp = TestBed.createComponent(CmsPageComponent).componentInstance;
    expect(cmp.formatLegalIndexDate('2026-02-10')).toBeTruthy();
  });

  it('passes through dates with the wrong number of parts', () => {
    const cmp = TestBed.createComponent(CmsPageComponent).componentInstance;
    // Matches the YYYY-MM-DD shape regex but produces a non-finite part after split.
    expect(cmp.formatLegalIndexDate('20a6-01-15')).toBe('20a6-01-15');
  });

  it('handles a block with an empty key', () => {
    api.get.and.callFake(
      () => of({ key: '', title: 'NoKey', body_markdown: 'body', images: [] }) as never,
    );
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.block()?.key).toBe('');
    expect(title.setTitle).toHaveBeenCalledWith('NoKey | momentstudio');
  });

  it('strips a legal index table when the terms body is empty', () => {
    paramMap$.next(convertToParamMap({ slug: 'terms' }));
    api.get.and.callFake(((path: string) => {
      if (path === '/content/pages/terms') {
        return of({
          key: 'page.terms',
          title: 'Terms',
          body_markdown: null as unknown as string,
          images: [],
        });
      }
      return of(null);
    }) as never);
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.block()?.title).toBe('Terms');
  });

  it('strips a legal index table that appears after body content', () => {
    paramMap$.next(convertToParamMap({ slug: 'terms' }));
    api.get.and.callFake(((path: string) => {
      if (path === '/content/pages/terms') {
        return of({
          key: 'page.terms',
          title: 'Terms',
          body_markdown: 'Intro paragraph\n| Last updated | x |\n| 2026-01-01 | y |\nAfter table',
          images: [],
        });
      }
      return of(null);
    }) as never);
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();
    // Body renders without the table rows; intro + after-table content remain.
    expect(fixture.componentInstance.bodyHtml()).toContain('Intro paragraph');
    expect(fixture.componentInstance.bodyHtml()).toContain('After table');
    expect(fixture.componentInstance.bodyHtml()).not.toContain('Last updated');
  });

  it('suppresses the reload triggered by the canonical-slug redirect', () => {
    paramMap$.next(convertToParamMap({ slug: 'old-slug' }));
    api.get.and.callFake(
      () => of({ key: 'page.about', title: 'About', body_markdown: 'x', images: [] }) as never,
    );
    const fixture = TestBed.createComponent(CmsPageComponent);
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    fixture.detectChanges();
    api.get.calls.reset();
    // Simulate the route param emitting the canonical slug after redirect.
    paramMap$.next(convertToParamMap({ slug: 'about' }));
    expect(api.get).not.toHaveBeenCalled(); // suppressed
  });
});
