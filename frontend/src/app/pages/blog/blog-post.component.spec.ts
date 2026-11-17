import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Meta, Title } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Observable, of, Subject } from 'rxjs';

import { BlogPostComponent } from './blog-post.component';
import { AdminService } from '../../core/admin.service';
import { BlogService, BlogPost } from '../../core/blog.service';
import { CatalogService } from '../../core/catalog.service';
import { NewsletterService } from '../../core/newsletter.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';
import { ToastService } from '../../core/toast.service';
import { MarkdownService } from '../../core/markdown.service';
import { AuthService } from '../../core/auth.service';

describe('BlogPostComponent', () => {
  let meta: jasmine.SpyObj<Meta>;
  let title: jasmine.SpyObj<Title>;
  let blog: jasmine.SpyObj<BlogService>;
  let toast: jasmine.SpyObj<ToastService>;
  let markdown: jasmine.SpyObj<MarkdownService>;
  let auth: jasmine.SpyObj<AuthService>;
  let doc: Document;
  let routeParams$: Subject<Record<string, unknown>>;
  let routeQueryParams$: Subject<Record<string, unknown>>;
  let routeStub: {
    snapshot: { params: Record<string, unknown>; queryParams: Record<string, unknown> };
    params: Observable<Record<string, unknown>>;
    queryParams: Observable<Record<string, unknown>>;
  };

  const post: BlogPost = {
    slug: 'first-post',
    title: 'Hello',
    body_markdown: 'Body',
    created_at: '2000-01-01T00:00:00+00:00',
    updated_at: '2000-01-01T00:00:00+00:00',
    images: [],
    summary: 'Summary',
  };

  beforeEach(() => {
    meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    blog = jasmine.createSpyObj<BlogService>('BlogService', [
      'getPost',
      'getPreviewPost',
      'getNeighbors',
      'listPosts',
      'listCommentThreads',
      'getCommentSubscription',
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success']);
    markdown = jasmine.createSpyObj<MarkdownService>('MarkdownService', ['render']);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['isAuthenticated', 'user']);
    doc = document.implementation.createHTMLDocument('blog-post-test');

    blog.getPost.and.returnValue(of(post));
    blog.getPreviewPost.and.returnValue(of(post));
    blog.getNeighbors.and.returnValue(of({ previous: null, next: null }));
    blog.listPosts.and.returnValue(
      of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 10 } }),
    );
    blog.listCommentThreads.and.returnValue(
      of({
        items: [],
        meta: { total_items: 0, total_pages: 1, page: 1, limit: 10 },
        total_comments: 0,
      }),
    );
    blog.getCommentSubscription.and.returnValue(of({ enabled: false }));
    markdown.render.and.returnValue('<p>Body</p>');
    auth.isAuthenticated.and.returnValue(false);
    auth.user.and.returnValue(null);
    routeParams$ = new Subject<Record<string, unknown>>();
    routeQueryParams$ = new Subject<Record<string, unknown>>();
    routeStub = {
      snapshot: { params: {}, queryParams: {} },
      params: routeParams$.asObservable(),
      queryParams: routeQueryParams$.asObservable(),
    };
  });

  function configure(): void {
    TestBed.configureTestingModule({
      imports: [BlogPostComponent, TranslateModule.forRoot(), RouterTestingModule.withRoutes([])],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: BlogService, useValue: blog },
        {
          provide: AdminService,
          useValue: jasmine.createSpyObj<AdminService>('AdminService', [
            'getContent',
            'updateContentBlock',
          ]),
        },
        {
          provide: CatalogService,
          useValue: jasmine.createSpyObj<CatalogService>('CatalogService', [
            'getProduct',
            'listCategories',
            'listFeaturedCollections',
          ]),
        },
        {
          provide: NewsletterService,
          useValue: jasmine.createSpyObj<NewsletterService>('NewsletterService', ['subscribe']),
        },
        { provide: ToastService, useValue: toast },
        { provide: MarkdownService, useValue: markdown },
        { provide: StorefrontAdminModeService, useValue: { enabled: () => false } },
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: routeStub },
        { provide: DOCUMENT, useValue: doc },
      ],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      { blog: { post: { metaTitle: 'Blog post', metaDescription: 'Desc' } } },
      true,
    );
    translate.use('en');
  }

  it('loads a post and sets canonical/OG tags', () => {
    configure();
    const fixture = TestBed.createComponent(BlogPostComponent);
    const cmp = fixture.componentInstance as any;
    cmp.slug = 'first-post';
    cmp.previewToken = '';
    cmp.load();

    expect(blog.getPost).toHaveBeenCalledWith('first-post', 'en');
    expect(title.setTitle).toHaveBeenCalledWith('Hello | momentstudio');

    const ogImageCall = meta.updateTag.calls
      .allArgs()
      .find((args) => args[0]?.property === 'og:image');
    expect(ogImageCall).toBeTruthy();
    expect(ogImageCall?.[0]?.content).toContain('/api/v1/blog/posts/first-post/og.png?lang=en');

    const canonical = doc.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    expect(canonical).toBeTruthy();
    expect(canonical?.getAttribute('href')).toContain('/blog/first-post');
    expect(canonical?.getAttribute('href')).not.toContain('lang=en');

    const alternates = Array.from(
      doc.querySelectorAll('link[rel="alternate"][data-seo-managed="true"]'),
    );
    expect(alternates.length).toBe(3);

    const routeSchema = doc.querySelector('script#seo-route-schema-1');
    expect(routeSchema?.textContent || '').toContain('"BlogPosting"');
  });

  it('uses preview endpoint when preview token is present', () => {
    configure();
    const fixture = TestBed.createComponent(BlogPostComponent);
    const cmp = fixture.componentInstance as any;
    cmp.slug = 'first-post';
    cmp.previewToken = 'token';
    cmp.load();

    expect(blog.getPreviewPost).toHaveBeenCalledWith('first-post', 'token', 'en');
  });

  it('uses route snapshot slug and preview token on first paint', () => {
    routeStub.snapshot.params = { slug: 'snapshot-post' };
    routeStub.snapshot.queryParams = { preview: 'preview-token' };
    blog.getPreviewPost.and.returnValue(of({ ...post, slug: 'snapshot-post' }));

    configure();
    const fixture = TestBed.createComponent(BlogPostComponent);
    fixture.detectChanges();

    expect(blog.getPreviewPost).toHaveBeenCalledWith('snapshot-post', 'preview-token', 'en');
    expect(blog.getPost).not.toHaveBeenCalled();
  });

  it('focalPosition clamps and defaults missing coordinates', () => {
    configure();
    const fixture = TestBed.createComponent(BlogPostComponent);
    const cmp = fixture.componentInstance as any;

    expect(cmp.focalPosition(null, null)).toBe('50% 50%');
    expect(cmp.focalPosition(-10, 150)).toBe('0% 100%');
    expect(cmp.focalPosition(25.6, 74.4)).toBe('26% 74%');
  });

  it('shareWhatsApp opens an encoded wa.me link for the current post', () => {
    configure();
    const fixture = TestBed.createComponent(BlogPostComponent);
    const cmp = fixture.componentInstance as any;
    const open = jasmine.createSpy('open');
    const win = {
      open,
      addEventListener: jasmine.createSpy('addEventListener'),
      removeEventListener: jasmine.createSpy('removeEventListener'),
      location: { origin: 'https://example.test', hash: '' },
    };
    spyOnProperty(cmp.document, 'defaultView').and.returnValue(win as any);
    spyOn(cmp, 'buildShareUrl').and.returnValue('https://example.test/blog/first-post');
    cmp.post.set({ ...post, title: 'Hello' });

    cmp.shareWhatsApp();

    expect(open).toHaveBeenCalled();
    const [href, target, features] = open.calls.mostRecent().args;
    expect(href).toContain('https://wa.me/?text=');
    expect(decodeURIComponent(String(href).split('text=')[1])).toContain('Hello');
    expect(decodeURIComponent(String(href).split('text=')[1])).toContain(
      'https://example.test/blog/first-post',
    );
    expect(target).toBe('_blank');
    expect(features).toContain('noopener');
    fixture.destroy();
  });

  it('shareFacebook opens the Facebook sharer for the share URL', () => {
    configure();
    const fixture = TestBed.createComponent(BlogPostComponent);
    const cmp = fixture.componentInstance as any;
    const open = jasmine.createSpy('open');
    const win = {
      open,
      addEventListener: jasmine.createSpy('addEventListener'),
      removeEventListener: jasmine.createSpy('removeEventListener'),
      location: { origin: 'https://example.test', hash: '' },
    };
    spyOnProperty(cmp.document, 'defaultView').and.returnValue(win as any);
    spyOn(cmp, 'buildShareUrl').and.returnValue('https://example.test/blog/first-post');

    cmp.shareFacebook();

    expect(open).toHaveBeenCalledWith(
      'https://www.facebook.com/sharer/sharer.php?u=' +
        encodeURIComponent('https://example.test/blog/first-post'),
      '_blank',
      'noopener,noreferrer',
    );
    fixture.destroy();
  });

  it('toDateTimeLocal returns empty for missing/invalid and formats local YYYY-MM-DDTHH:mm', () => {
    configure();
    const fixture = TestBed.createComponent(BlogPostComponent);
    const cmp = fixture.componentInstance as any;

    expect(cmp.toDateTimeLocal(null)).toBe('');
    expect(cmp.toDateTimeLocal(undefined)).toBe('');
    expect(cmp.toDateTimeLocal('')).toBe('');
    expect(cmp.toDateTimeLocal('not-a-date')).toBe('');

    const source = new Date(2020, 2, 4, 5, 6, 0);
    const isoIn = source.toISOString();
    const parsed = new Date(isoIn);
    const pad = (n: number) => String(n).padStart(2, '0');
    const expected = `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
    const out = cmp.toDateTimeLocal(isoIn);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(out).toBe(expected);
    fixture.destroy();
  });

  it('toIsoFromDateTimeLocal returns null for blank/invalid and ISO for valid local input', () => {
    configure();
    const fixture = TestBed.createComponent(BlogPostComponent);
    const cmp = fixture.componentInstance as any;

    expect(cmp.toIsoFromDateTimeLocal('')).toBeNull();
    expect(cmp.toIsoFromDateTimeLocal('   ')).toBeNull();
    expect(cmp.toIsoFromDateTimeLocal('garbage')).toBeNull();

    const iso = cmp.toIsoFromDateTimeLocal('2020-03-04T05:06');
    expect(iso).not.toBeNull();
    expect(iso).toContain('T');
    expect(Number.isFinite(Date.parse(iso as string))).toBeTrue();
    expect(iso).toBe(new Date('2020-03-04T05:06').toISOString());
    fixture.destroy();
  });

  it('isFutureIso is false for missing/invalid/past and true beyond the 1s skew', () => {
    configure();
    const fixture = TestBed.createComponent(BlogPostComponent);
    const cmp = fixture.componentInstance as any;

    expect(cmp.isFutureIso(null)).toBeFalse();
    expect(cmp.isFutureIso(undefined)).toBeFalse();
    expect(cmp.isFutureIso('')).toBeFalse();
    expect(cmp.isFutureIso('garbage')).toBeFalse();
    expect(cmp.isFutureIso('2000-01-01T00:00:00Z')).toBeFalse();

    const nearFuture = new Date(Date.now() + 60_000).toISOString();
    expect(cmp.isFutureIso(nearFuture)).toBeTrue();
    fixture.destroy();
  });
});
