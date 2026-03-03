import { Meta, Title } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { MarkdownService } from '../../core/markdown.service';
import { SeoCopyFallbackService } from '../../core/seo-copy-fallback.service';
import { SeoHeadLinksService } from '../../core/seo-head-links.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';
import { CmsPageComponent } from './page.component';

describe('CmsPageComponent coverage fast wave', () => {
  let api: jasmine.SpyObj<ApiService>;
  let router: jasmine.SpyObj<Router>;
  let translate: TranslateService;
  let paramMap$: BehaviorSubject<any>;
  let queryParams$: BehaviorSubject<Record<string, unknown>>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate'], { url: '/pages/terms' });
    router.navigate.and.returnValue(Promise.resolve(true));

    paramMap$ = new BehaviorSubject(convertToParamMap({ slug: 'terms' }));
    queryParams$ = new BehaviorSubject<Record<string, unknown>>({});

    const markdown = jasmine.createSpyObj<MarkdownService>('MarkdownService', ['render']);
    markdown.render.and.callFake((value: string) => `<p>${value}</p>`);

    const title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    const meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    const seoHead = jasmine.createSpyObj<SeoHeadLinksService>('SeoHeadLinksService', ['setLocalizedCanonical']);
    seoHead.setLocalizedCanonical.and.returnValue('https://example.test/pages/terms');
    const fallback = jasmine.createSpyObj<SeoCopyFallbackService>('SeoCopyFallbackService', ['pageIntro']);
    fallback.pageIntro.and.returnValue('fallback intro');

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, CmsPageComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: Router, useValue: router },
        { provide: StorefrontAdminModeService, useValue: { enabled: () => false } },
        { provide: MarkdownService, useValue: markdown },
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: SeoHeadLinksService, useValue: seoHead },
        { provide: SeoCopyFallbackService, useValue: fallback },
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
      {
        nav: { home: 'Home', page: 'Page' },
        about: { metaDescription: 'About page description' },
        meta: { descriptions: { page: 'Default page description' } },
      },
      true
    );
    translate.use('en');
  });

  it('covers empty slug load fast-fail and helper branches', () => {
    const fixture = TestBed.createComponent(CmsPageComponent);
    const component = fixture.componentInstance;

    (component as any).slug = '   ';
    (component as any).load();

    expect(component.block()).toBeNull();
    expect(component.loading()).toBeFalse();
    expect(component.hasError()).toBeTrue();

    expect(component.focalPosition(undefined, undefined)).toBe('50% 50%');
    expect(component.focalPosition(-5, 1000)).toBe('0% 100%');
    expect((component as any).slugFromKey('page.terms')).toBe('terms');
    expect((component as any).slugFromKey('plain')).toBe('');
  });

  it('covers legal-index markdown stripping and date formatting branches', () => {
    const fixture = TestBed.createComponent(CmsPageComponent);
    const component = fixture.componentInstance;

    const stripped = (component as any).stripLegalIndexTable(
      'Intro line\n| Title | Last Updated |\n|---|---|\n| A | 2026-01-01 |\nTail line'
    );

    expect(stripped).toContain('Intro line');
    expect(stripped).toContain('Tail line');
    expect(stripped).not.toContain('Last Updated');

    expect(component.formatLegalIndexDate('2026-03-03')).not.toBe('2026-03-03');
    expect(component.formatLegalIndexDate('not-a-date')).toBe('not-a-date');
    expect(component.formatLegalIndexDate('')).toBe('');
  });

  it('covers restricted/error load branches and seo cluster visibility guards', () => {
    const fixture = TestBed.createComponent(CmsPageComponent);
    const component = fixture.componentInstance;

    (component as any).setRestrictedPageState('terms', 'en');
    expect(component.requiresLogin()).toBeTrue();
    expect(component.hasError()).toBeFalse();
    expect(component.showSeoLinkCluster()).toBeFalse();

    (component as any).setPageErrorState('terms', 'en');
    expect(component.requiresLogin()).toBeFalse();
    expect(component.hasError()).toBeTrue();

    component.legalIndexDocs.set([{ slug: 'terms', title: 'Terms', lastUpdated: null }]);
    expect(component.showSeoLinkCluster()).toBeFalse();

    component.legalIndexDocs.set([]);
    component.bodyHtml.set('<p>short</p>');
    expect(component.hasMeaningfulBodyContent()).toBeFalse();

    component.bodyHtml.set(`<p>${'x'.repeat(160)}</p>`);
    expect(component.hasMeaningfulBodyContent()).toBeTrue();
    expect(component.showSeoLinkCluster()).toBeTrue();
  });

  it('covers page load error routing for 401 and non-401 responses', () => {
    const fixture = TestBed.createComponent(CmsPageComponent);
    const component = fixture.componentInstance;

    (component as any).handlePageLoadError({ status: 401 }, 'terms', 'en');
    expect(component.requiresLogin()).toBeTrue();

    (component as any).handlePageLoadError({ status: 500 }, 'terms', 'en');
    expect(component.hasError()).toBeTrue();
    expect(component.requiresLogin()).toBeFalse();
  });

  it('covers legal-index docs loading with success and fallback mapping', () => {
    const fixture = TestBed.createComponent(CmsPageComponent);
    const component = fixture.componentInstance;

    api.get.and.callFake((path: string) => {
      if (path.includes('terms-and-conditions')) {
        return of({ title: 'Terms', meta: { last_updated: '2026-03-01' } } as any);
      }
      if (path.includes('privacy-policy')) {
        return of({ title: '', meta: { last_updated: null } } as any);
      }
      return of(null as any);
    });

    (component as any).loadLegalIndexDocs('terms', 'en');

    expect(component.legalIndexLoading()).toBeFalse();
    expect(component.legalIndexDocs().length).toBe(3);
    expect(component.legalIndexDocs()[0].title).toBe('Terms');
  });
});
