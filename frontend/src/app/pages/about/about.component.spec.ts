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

let aboutMeta: jasmine.SpyObj<Meta>;
let aboutTitle: jasmine.SpyObj<Title>;
let aboutApi: jasmine.SpyObj<ApiService>;
let aboutSeoHeadLinks: jasmine.SpyObj<SeoHeadLinksService>;
let aboutTranslate: TranslateService;

describe('AboutComponent SEO', () => {
  beforeEach(setupAboutSpec);

  it('sets meta tags on init', () => {
    const fixture = TestBed.createComponent(AboutComponent);
    fixture.detectChanges();

    expect(aboutTitle.setTitle).toHaveBeenCalledWith('About | momentstudio');
    expect(aboutMeta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Hello' });
    expect(aboutMeta.updateTag).toHaveBeenCalledWith({ property: 'og:description', content: 'Hello' });
    expect(aboutMeta.updateTag).toHaveBeenCalledWith({ property: 'og:title', content: 'About | momentstudio' });
    expect(aboutSeoHeadLinks.setLocalizedCanonical).toHaveBeenCalledWith('/about', 'en', {});
    expect(aboutMeta.updateTag).toHaveBeenCalledWith({ property: 'og:url', content: 'http://localhost:4200/about' });
  });

  it('updates meta tags when language changes', () => {
    const fixture = TestBed.createComponent(AboutComponent);
    fixture.detectChanges();

    aboutTitle.setTitle.calls.reset();
    aboutMeta.updateTag.calls.reset();
    aboutSeoHeadLinks.setLocalizedCanonical.calls.reset();
    aboutSeoHeadLinks.setLocalizedCanonical.and.returnValue('http://localhost:4200/about?lang=ro');

    aboutTranslate.use('ro');

    expect(aboutTitle.setTitle).toHaveBeenCalledWith('Despre noi | momentstudio');
    expect(aboutMeta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Salut' });
    expect(aboutMeta.updateTag).toHaveBeenCalledWith({ property: 'og:description', content: 'Salut' });
    expect(aboutMeta.updateTag).toHaveBeenCalledWith({ property: 'og:title', content: 'Despre noi | momentstudio' });
    expect(aboutSeoHeadLinks.setLocalizedCanonical).toHaveBeenCalledWith('/about', 'ro', {});
    expect(aboutMeta.updateTag).toHaveBeenCalledWith({ property: 'og:url', content: 'http://localhost:4200/about?lang=ro' });
  });
});

describe('AboutComponent content + lifecycle', () => {
  beforeEach(setupAboutSpec);

  it('uses page blocks for meta description when present', () => {
    aboutApi.get.and.callFake(aboutPageBlocksCallFake);

    const fixture = TestBed.createComponent(AboutComponent);
    fixture.detectChanges();

    expect(aboutMeta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Intro Welcome' });
  });

  it('stops updating after destroy', () => {
    const fixture = TestBed.createComponent(AboutComponent);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();
    cmp.ngOnDestroy();

    aboutTitle.setTitle.calls.reset();
    aboutMeta.updateTag.calls.reset();

    aboutTranslate.use('ro');

    expect(aboutTitle.setTitle).not.toHaveBeenCalled();
    expect(aboutMeta.updateTag).not.toHaveBeenCalled();
  });
});

function setupAboutSpec(): void {
  aboutMeta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
  aboutTitle = jasmine.createSpyObj<Title>('Title', ['setTitle']);
  aboutApi = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
  aboutSeoHeadLinks = jasmine.createSpyObj<SeoHeadLinksService>('SeoHeadLinksService', ['setLocalizedCanonical']);
  aboutSeoHeadLinks.setLocalizedCanonical.and.returnValue('http://localhost:4200/about');
  aboutApi.get.and.callFake(aboutPageCallFake);
  const markdown = { render: (s: string) => s } as unknown as MarkdownService;
  configureAboutTestingModule(aboutMeta, aboutTitle, aboutApi, aboutSeoHeadLinks, markdown);
  aboutTranslate = TestBed.inject(TranslateService);
  seedAboutTranslations(aboutTranslate);
  aboutTranslate.use('en');
}

function configureAboutTestingModule(
  meta: jasmine.SpyObj<Meta>,
  title: jasmine.SpyObj<Title>,
  api: jasmine.SpyObj<ApiService>,
  seoHeadLinks: jasmine.SpyObj<SeoHeadLinksService>,
  markdown: MarkdownService
): void {
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
}

function seedAboutTranslations(translate: TranslateService): void {
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
}

function aboutPageCallFake(path: string, params?: Record<string, unknown>) {
  if (path !== '/content/pages/about') throw new Error(`Unexpected path: ${path}`);
  if (params?.['lang'] === 'ro') {
    return of({ title: 'Despre noi', body_markdown: 'Salut', meta: null, images: [] } as any);
  }
  return of({ title: 'About', body_markdown: 'Hello', meta: null, images: [] } as any);
}

function aboutPageBlocksCallFake(path: string, params?: Record<string, unknown>) {
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
}
