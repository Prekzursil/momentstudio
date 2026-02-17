import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of } from 'rxjs';

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

  beforeEach(() => {
    paramMap$ = new BehaviorSubject(convertToParamMap({ slug: 'about' }));
    queryParams$ = new BehaviorSubject<Record<string, unknown>>({});

    meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    seoHeadLinks = jasmine.createSpyObj<SeoHeadLinksService>('SeoHeadLinksService', ['setLocalizedCanonical']);
    seoHeadLinks.setLocalizedCanonical.and.returnValue('http://localhost:4200/pages/about');

    api.get.and.callFake((path: string, params?: Record<string, unknown>) => {
      if (path === '/content/pages/about') {
        if (params?.['lang'] === 'ro') {
          return of({ key: 'page.about', title: 'Despre', body_markdown: 'Salut', images: [] } as any);
        }
        return of({ key: 'page.about', title: 'About page', body_markdown: 'Hello', images: [] } as any);
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
        { provide: StorefrontAdminModeService, useValue: { enabled: () => false } },
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
    translate.setTranslation('en', { about: { metaDescription: 'About desc' }, nav: { home: 'Home', page: 'Page' } }, true);
    translate.setTranslation('ro', { about: { metaDescription: 'Descriere' }, nav: { home: 'Acasă', page: 'Pagină' } }, true);
    translate.use('en');
  });

  it('sets canonical and og:url on load', () => {
    const fixture = TestBed.createComponent(CmsPageComponent);
    fixture.detectChanges();

    expect(title.setTitle).toHaveBeenCalledWith('About page | momentstudio');
    expect(seoHeadLinks.setLocalizedCanonical).toHaveBeenCalledWith('/pages/about', 'en', {});
    expect(meta.updateTag).toHaveBeenCalledWith({ property: 'og:url', content: 'http://localhost:4200/pages/about' });
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
    expect(meta.updateTag).toHaveBeenCalledWith({ property: 'og:url', content: 'http://localhost:4200/pages/about?lang=ro' });
  });
});
