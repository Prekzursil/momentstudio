import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

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

  beforeEach(() => {
    meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    seoHeadLinks = jasmine.createSpyObj<SeoHeadLinksService>('SeoHeadLinksService', ['setLocalizedCanonical']);
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
        { provide: StorefrontAdminModeService, useValue: { enabled: () => false } },
        { provide: MarkdownService, useValue: markdown }
      ]
    });

    translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        about: { metaTitle: 'About | momentstudio', metaDescription: 'About desc' }
      },
      true
    );
    translate.setTranslation(
      'ro',
      {
        about: { metaTitle: 'Despre noi | momentstudio', metaDescription: 'Descriere' }
      },
      true
    );
    translate.use('en');
  });

  it('sets meta tags on init', () => {
    const fixture = TestBed.createComponent(AboutComponent);
    fixture.detectChanges();

    expect(title.setTitle).toHaveBeenCalledWith('About | momentstudio');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Hello' });
    expect(meta.updateTag).toHaveBeenCalledWith({ property: 'og:description', content: 'Hello' });
    expect(meta.updateTag).toHaveBeenCalledWith({ property: 'og:title', content: 'About | momentstudio' });
    expect(seoHeadLinks.setLocalizedCanonical).toHaveBeenCalledWith('/about', 'en', {});
    expect(meta.updateTag).toHaveBeenCalledWith({ property: 'og:url', content: 'http://localhost:4200/about' });
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
    expect(meta.updateTag).toHaveBeenCalledWith({ property: 'og:title', content: 'Despre noi | momentstudio' });
    expect(seoHeadLinks.setLocalizedCanonical).toHaveBeenCalledWith('/about', 'ro', {});
    expect(meta.updateTag).toHaveBeenCalledWith({ property: 'og:url', content: 'http://localhost:4200/about?lang=ro' });
  });

  it('uses page blocks for meta description when present', () => {
    api.get.and.callFake((path: string, params?: Record<string, unknown>) => {
      if (path !== '/content/pages/about') throw new Error(`Unexpected path: ${path}`);
      if (params?.['lang'] === 'ro') {
        return of({
          title: 'Despre noi',
          body_markdown: 'Salut',
          meta: {
            blocks: [{ key: 'intro', type: 'text', enabled: true, title: { ro: 'Introducere' }, body_markdown: { ro: 'Bun venit' } }]
          },
          images: []
        } as any);
      }
      return of({
        title: 'About',
        body_markdown: 'Hello',
        meta: {
          blocks: [{ key: 'intro', type: 'text', enabled: true, title: { en: 'Intro' }, body_markdown: { en: 'Welcome' } }]
        },
        images: []
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
});
