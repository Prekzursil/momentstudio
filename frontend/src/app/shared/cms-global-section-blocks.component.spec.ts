import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';

import { ApiService } from '../core/api.service';
import { MarkdownService } from '../core/markdown.service';
import { CmsGlobalSectionBlocksComponent } from './cms-global-section-blocks.component';
import type { PageBlock } from './page-blocks';

function configure(api: jasmine.SpyObj<ApiService>) {
  const markdown = { render: (md: string) => md } as unknown as MarkdownService;
  TestBed.configureTestingModule({
    imports: [TranslateModule.forRoot(), CmsGlobalSectionBlocksComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: MarkdownService, useValue: markdown },
    ],
  });
}

describe('CmsGlobalSectionBlocksComponent', () => {
  it('keeps reserved loading space until async CMS blocks resolve', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    const pending$ = new Subject<unknown>();
    api.get.and.returnValue(pending$);
    const markdown = { render: (md: string) => md } as unknown as MarkdownService;

    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), CmsGlobalSectionBlocksComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: MarkdownService, useValue: markdown },
      ],
    });

    const fixture = TestBed.createComponent(CmsGlobalSectionBlocksComponent);
    fixture.componentInstance.contentKey = 'site.header-banners';
    fixture.componentInstance.reserveLoadingHeightClass = 'min-h-[9rem]';
    fixture.componentInstance.loadingSkeletonCount = 4;
    fixture.detectChanges();

    const loading = fixture.nativeElement.querySelector(
      '[data-cms-global-loading="true"]',
    ) as HTMLElement | null;
    expect(loading).toBeTruthy();
    expect(loading?.className).toContain('min-h-[9rem]');
    expect(fixture.nativeElement.querySelectorAll('app-skeleton').length).toBe(4);

    pending$.next({
      meta: {
        blocks: [
          {
            key: 'intro',
            type: 'text',
            title: { en: 'Header promo' },
            body_markdown: { en: 'Promo copy' },
          },
        ],
      },
    });
    pending$.complete();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-cms-global-loading="true"]')).toBeNull();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('Header promo');
    expect(text).toContain('Promo copy');
  });

  it('does not call the API when the content key is blank', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    configure(api);
    const fixture = TestBed.createComponent(CmsGlobalSectionBlocksComponent);
    fixture.componentInstance.contentKey = '   ';
    fixture.detectChanges();
    expect(api.get).not.toHaveBeenCalled();
    expect(fixture.componentInstance.blocks().length).toBe(0);
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('does not call the API when the content key is an empty string', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    configure(api);
    const fixture = TestBed.createComponent(CmsGlobalSectionBlocksComponent);
    fixture.componentInstance.contentKey = '';
    fixture.detectChanges();
    expect(api.get).not.toHaveBeenCalled();
    expect(fixture.componentInstance.blocks().length).toBe(0);
  });

  it('requests the Romanian content variant when the active language is ro', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(of({ meta: { blocks: [] } }));
    configure(api);
    const translate = TestBed.inject(TranslateService);
    translate.use('ro');
    const fixture = TestBed.createComponent(CmsGlobalSectionBlocksComponent);
    fixture.componentInstance.contentKey = 'site.footer';
    fixture.detectChanges();
    expect(api.get).toHaveBeenCalledWith('/content/site.footer', { lang: 'ro' });
  });

  it('treats a missing meta payload as an empty block list', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(of({}));
    configure(api);
    const fixture = TestBed.createComponent(CmsGlobalSectionBlocksComponent);
    fixture.componentInstance.contentKey = 'site.header';
    fixture.detectChanges();
    expect(fixture.componentInstance.blocks().length).toBe(0);
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('clears blocks on a 404 response', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(throwError(() => ({ status: 404 })));
    configure(api);
    const fixture = TestBed.createComponent(CmsGlobalSectionBlocksComponent);
    fixture.componentInstance.contentKey = 'site.header';
    fixture.detectChanges();
    expect(fixture.componentInstance.blocks().length).toBe(0);
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('clears blocks on a non-404 error', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(throwError(() => ({ status: 500 })));
    configure(api);
    const fixture = TestBed.createComponent(CmsGlobalSectionBlocksComponent);
    fixture.componentInstance.contentKey = 'site.header';
    fixture.detectChanges();
    expect(fixture.componentInstance.blocks().length).toBe(0);
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('reloads when the active language changes', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(of({ meta: { blocks: [] } }));
    configure(api);
    const translate = TestBed.inject(TranslateService);
    const fixture = TestBed.createComponent(CmsGlobalSectionBlocksComponent);
    fixture.componentInstance.contentKey = 'site.header';
    fixture.detectChanges();
    expect(api.get.calls.count()).toBe(1);
    translate.use('ro');
    expect(api.get.calls.count()).toBe(2);
  });

  it('unsubscribes from language changes on destroy', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(of({ meta: { blocks: [] } }));
    configure(api);
    const translate = TestBed.inject(TranslateService);
    const fixture = TestBed.createComponent(CmsGlobalSectionBlocksComponent);
    fixture.componentInstance.contentKey = 'site.header';
    fixture.detectChanges();
    fixture.destroy();
    api.get.calls.reset();
    translate.use('ro');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('computes clamped focal positions and skeleton rows', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(of({ meta: { blocks: [] } }));
    configure(api);
    const fixture = TestBed.createComponent(CmsGlobalSectionBlocksComponent);
    const cmp = fixture.componentInstance;
    expect(cmp.focalPosition()).toBe('50% 50%');
    expect(cmp.focalPosition(-5, 150)).toBe('0% 100%');
    expect(cmp.focalPosition(25, 75)).toBe('25% 75%');

    cmp.loadingSkeletonCount = 0;
    expect(cmp.loadingRows()).toEqual([0]);
    cmp.loadingSkeletonCount = 3;
    expect(cmp.loadingRows()).toEqual([0, 1, 2]);
  });

  it('renders text, image, gallery, banner and carousel block templates', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(of({ meta: { blocks: [] } }));
    configure(api);
    const fixture = TestBed.createComponent(CmsGlobalSectionBlocksComponent);
    const cmp = fixture.componentInstance;
    cmp.contentKey = 'site.header';
    fixture.detectChanges();

    const slide = {
      image_url: '/media/banner.jpg',
      alt: 'Banner',
      headline: 'Hi',
      subheadline: null,
      cta_label: null,
      cta_url: null,
      variant: 'full' as const,
      size: 'M' as const,
      text_style: 'dark' as const,
      focal_x: 50,
      focal_y: 50,
    };
    const blocks: PageBlock[] = [
      { key: 't', type: 'text', enabled: true, title: 'Text title', body_html: '<p>Body</p>' },
      {
        key: 'i',
        type: 'image',
        enabled: true,
        title: 'Image title',
        url: '/media/a.jpg',
        alt: 'Alt',
        caption: 'Cap',
        link_url: 'https://example.com',
        focal_x: 20,
        focal_y: 30,
      },
      {
        key: 'i2',
        type: 'image',
        enabled: true,
        title: null,
        url: '/media/b.jpg',
        alt: null,
        caption: null,
        link_url: null,
        focal_x: 50,
        focal_y: 50,
      },
      {
        key: 'g',
        type: 'gallery',
        enabled: true,
        title: 'Gallery',
        images: [
          { url: '/media/g1.jpg', alt: 'G1', caption: 'GC', focal_x: 10, focal_y: 90 },
          { url: '/media/g2.jpg', alt: null, caption: null, focal_x: 50, focal_y: 50 },
        ],
      },
      { key: 'b', type: 'banner', enabled: true, title: 'Banner block', slide },
      {
        key: 'c',
        type: 'carousel',
        enabled: true,
        title: 'Carousel block',
        slides: [slide],
        settings: {
          autoplay: false,
          interval_ms: 5000,
          show_dots: true,
          show_arrows: true,
          pause_on_hover: true,
        },
      },
    ];
    cmp.blocks.set(blocks);
    fixture.detectChanges();

    const html = fixture.nativeElement as HTMLElement;
    const text = (html.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('Text title');
    expect(text).toContain('Image title');
    expect(text).toContain('Cap');
    expect(text).toContain('Gallery');
    expect(html.querySelector('a[href="https://example.com"]')).toBeTruthy();
    expect(html.querySelector('app-banner-block')).toBeTruthy();
    expect(html.querySelector('app-carousel-block')).toBeTruthy();
    const linkedImg = html.querySelector('a[href="https://example.com"] img') as HTMLImageElement;
    expect(linkedImg.style.objectPosition).toBe('20% 30%');
  });
});
