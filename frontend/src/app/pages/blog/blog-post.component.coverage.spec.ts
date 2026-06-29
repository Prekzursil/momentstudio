import { DOCUMENT } from '@angular/common';
import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Meta, Title } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Observable, of, throwError, Subject } from 'rxjs';
import hljs from 'highlight.js/lib/core';

import { BlogPostComponent } from './blog-post.component';
import { AdminService, ContentBlock } from '../../core/admin.service';
import { BlogService, BlogPost, BlogComment } from '../../core/blog.service';
import { CatalogService } from '../../core/catalog.service';
import { NewsletterService } from '../../core/newsletter.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';
import { ToastService } from '../../core/toast.service';
import { MarkdownService } from '../../core/markdown.service';
import { AuthService } from '../../core/auth.service';
import { SeoHeadLinksService } from '../../core/seo-head-links.service';
import { StructuredDataService } from '../../core/structured-data.service';
import { SeoCopyFallbackService } from '../../core/seo-copy-fallback.service';
import { appConfig } from '../../core/app-config';

// `any` so tests can reach private members; no-explicit-any is disabled for specs.
type Cmp = any;

describe('BlogPostComponent (coverage)', () => {
  let meta: jasmine.SpyObj<Meta>;
  let title: jasmine.SpyObj<Title>;
  let blog: jasmine.SpyObj<BlogService>;
  let toast: jasmine.SpyObj<ToastService>;
  let markdown: jasmine.SpyObj<MarkdownService>;
  let auth: jasmine.SpyObj<AuthService>;
  let adminSvc: jasmine.SpyObj<AdminService>;
  let catalog: jasmine.SpyObj<CatalogService>;
  let newsletter: jasmine.SpyObj<NewsletterService>;
  let seoHeadLinks: jasmine.SpyObj<SeoHeadLinksService>;
  let structuredData: jasmine.SpyObj<StructuredDataService>;
  let seoCopyFallback: jasmine.SpyObj<SeoCopyFallbackService>;
  let adminEnabled: boolean;
  let configured: boolean;
  let routeParams$: Subject<Record<string, unknown>>;
  let routeQueryParams$: Subject<Record<string, unknown>>;
  let routeStub: {
    snapshot: { params: Record<string, unknown>; queryParams: Record<string, unknown> };
    params: Observable<Record<string, unknown>>;
    queryParams: Observable<Record<string, unknown>>;
  };

  const basePost: BlogPost = {
    slug: 'first-post',
    title: 'Hello',
    body_markdown: 'Body',
    created_at: '2000-01-01T00:00:00+00:00',
    updated_at: '2000-01-01T00:00:00+00:00',
    images: [],
    summary: 'Summary',
  };

  function post(overrides: Partial<BlogPost> = {}): BlogPost {
    return { ...basePost, ...overrides };
  }

  function comment(overrides: Partial<BlogComment> = {}): BlogComment {
    return {
      id: 'c1',
      parent_id: null,
      body: 'hi',
      is_deleted: false,
      is_hidden: false,
      created_at: '2000-01-01T00:00:00+00:00',
      updated_at: '2000-01-01T00:00:00+00:00',
      author: { id: 'u1', name: 'User One', username: 'user1' },
      ...overrides,
    };
  }

  beforeEach(() => {
    adminEnabled = false;
    configured = false;
    meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    blog = jasmine.createSpyObj<BlogService>('BlogService', [
      'getPost',
      'getPreviewPost',
      'getNeighbors',
      'listPosts',
      'listCommentThreads',
      'getCommentSubscription',
      'setCommentSubscription',
      'createComment',
      'deleteComment',
      'flagComment',
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success']);
    markdown = jasmine.createSpyObj<MarkdownService>('MarkdownService', ['render']);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['isAuthenticated', 'isAdmin', 'user']);
    adminSvc = jasmine.createSpyObj<AdminService>('AdminService', [
      'getContent',
      'updateContentBlock',
    ]);
    catalog = jasmine.createSpyObj<CatalogService>('CatalogService', [
      'getProduct',
      'listCategories',
      'listFeaturedCollections',
    ]);
    newsletter = jasmine.createSpyObj<NewsletterService>('NewsletterService', ['subscribe']);
    seoHeadLinks = jasmine.createSpyObj<SeoHeadLinksService>('SeoHeadLinksService', [
      'setLocalizedCanonical',
    ]);
    structuredData = jasmine.createSpyObj<StructuredDataService>('StructuredDataService', [
      'setRouteSchemas',
      'clearRouteSchemas',
    ]);
    seoCopyFallback = jasmine.createSpyObj<SeoCopyFallbackService>('SeoCopyFallbackService', [
      'blogPostIntro',
    ]);

    blog.getPost.and.returnValue(of(post()));
    blog.getPreviewPost.and.returnValue(of(post()));
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
    blog.setCommentSubscription.and.returnValue(of({ enabled: true }));
    blog.createComment.and.returnValue(of(comment()));
    blog.deleteComment.and.returnValue(of(void 0));
    blog.flagComment.and.returnValue(
      of({ id: 'f1', user_id: 'u1', reason: null, created_at: '2000-01-01T00:00:00+00:00' }),
    );
    markdown.render.and.returnValue('<p>Body</p>');
    auth.isAuthenticated.and.returnValue(false);
    auth.isAdmin.and.returnValue(false);
    auth.user.and.returnValue(null);
    adminSvc.getContent.and.returnValue(
      of({
        key: 'blog.first-post',
        title: 'Hello',
        body_markdown: '',
        status: 'draft',
        version: 1,
      }),
    );
    adminSvc.updateContentBlock.and.returnValue(
      of({
        key: 'blog.first-post',
        title: 'Hello',
        body_markdown: '',
        status: 'published',
        version: 2,
      }),
    );
    catalog.getProduct.and.returnValue(of(null as any));
    catalog.listCategories.and.returnValue(of([]));
    catalog.listFeaturedCollections.and.returnValue(of([]));
    newsletter.subscribe.and.returnValue(of({ already_subscribed: false } as any));
    seoHeadLinks.setLocalizedCanonical.and.callFake(
      (path: string) => `https://example.test${path}`,
    );
    seoCopyFallback.blogPostIntro.and.returnValue('Intro fallback copy.');

    routeParams$ = new Subject<Record<string, unknown>>();
    routeQueryParams$ = new Subject<Record<string, unknown>>();
    routeStub = {
      snapshot: { params: {}, queryParams: {} },
      params: routeParams$.asObservable(),
      queryParams: routeQueryParams$.asObservable(),
    };
  });

  function configure(): void {
    if (configured) return;
    configured = true;
    TestBed.configureTestingModule({
      imports: [BlogPostComponent, TranslateModule.forRoot(), RouterTestingModule.withRoutes([])],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: BlogService, useValue: blog },
        { provide: AdminService, useValue: adminSvc },
        { provide: CatalogService, useValue: catalog },
        { provide: NewsletterService, useValue: newsletter },
        { provide: ToastService, useValue: toast },
        { provide: MarkdownService, useValue: markdown },
        { provide: StorefrontAdminModeService, useValue: { enabled: () => adminEnabled } },
        { provide: AuthService, useValue: auth },
        { provide: SeoHeadLinksService, useValue: seoHeadLinks },
        { provide: StructuredDataService, useValue: structuredData },
        { provide: SeoCopyFallbackService, useValue: seoCopyFallback },
        { provide: ActivatedRoute, useValue: routeStub },
        { provide: DOCUMENT, useValue: document },
      ],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { blog: { post: { metaTitle: 'Blog post' } } }, true);
    translate.use('en');
  }

  function create(slug = 'first-post', previewToken = ''): Cmp {
    configure();
    const fixture = TestBed.createComponent(BlogPostComponent);
    const cmp = fixture.componentInstance as Cmp;
    cmp.slug = slug;
    cmp.previewToken = previewToken;
    return cmp;
  }

  // --- A fake window. Always carries no-op add/removeEventListener + rAF so the
  // component's ngOnDestroy cleanup never throws during fixture teardown.
  function win(extra: any = {}): any {
    return {
      addEventListener() {},
      removeEventListener() {},
      requestAnimationFrame: (cb: any) => {
        if (cb) cb(0);
        return 0;
      },
      ...extra,
    };
  }

  // --- A fake "document" with controllable defaultView for SSR/no-window branches.
  function fakeDoc(view: any): any {
    return { defaultView: view === null ? null : win(view) } as any;
  }

  // ---------------------------------------------------------------------------
  // computed signals + simple getters
  // ---------------------------------------------------------------------------
  describe('computed signals', () => {
    it('lightboxImage returns null when index is null', () => {
      const cmp = create();
      expect(cmp.lightboxImage()).toBeNull();
      expect(cmp.lightboxOpen()).toBeFalse();
    });

    it('lightboxImage returns null when index out of range', () => {
      const cmp = create();
      cmp.galleryImages.set([]);
      cmp.lightboxIndex.set(5);
      expect(cmp.lightboxImage()).toBeNull();
      expect(cmp.lightboxOpen()).toBeFalse();
    });

    it('lightboxImage returns the image when valid', () => {
      const cmp = create();
      cmp.galleryImages.set([{ src: 'a', alt: 'A' }]);
      cmp.lightboxIndex.set(0);
      expect(cmp.lightboxImage()).toEqual({ src: 'a', alt: 'A' });
      expect(cmp.lightboxOpen()).toBeTrue();
    });

    it('progressPercent rounds reading progress', () => {
      const cmp = create();
      cmp.readingProgress.set(0.426);
      expect(cmp.progressPercent()).toBe(43);
    });

    it('authorDisplayName falls through author_name, name, username, empty', () => {
      const cmp = create();
      cmp.post.set(post({ author_name: 'A Name' }));
      expect(cmp.authorDisplayName()).toBe('A Name');
      cmp.post.set(post({ author_name: null, author: { id: 'x', name: 'Nested' } }));
      expect(cmp.authorDisplayName()).toBe('Nested');
      cmp.post.set(post({ author_name: null, author: { id: 'x', username: 'nick' } }));
      expect(cmp.authorDisplayName()).toBe('nick');
      cmp.post.set(post({ author_name: null, author: { id: 'x' } }));
      expect(cmp.authorDisplayName()).toBe('');
    });

    it('authorInitials handles empty, single, and multi-word names', () => {
      const cmp = create();
      cmp.post.set(post({ author_name: '' }));
      expect(cmp.authorInitials()).toBe('?');
      cmp.post.set(post({ author_name: 'Solo' }));
      expect(cmp.authorInitials()).toBe('SO');
      cmp.post.set(post({ author_name: 'Jane Mary Doe' }));
      expect(cmp.authorInitials()).toBe('JD');
    });

    it('authorBio resolves string, localized object, and empty', () => {
      const cmp = create();
      cmp.post.set(post({ meta: { author: { bio: '  hi there  ' } } }));
      expect(cmp.authorBio()).toBe('hi there');
      cmp.post.set(post({ meta: { author: { bio: { en: ' English bio ', ro: 'RO' } } } }));
      expect(cmp.authorBio()).toBe('English bio');
      cmp.post.set(post({ meta: { author: { bio: { ro: 'RO only' } } } }));
      expect(cmp.authorBio()).toBe('');
      cmp.post.set(post({ meta: {} }));
      expect(cmp.authorBio()).toBe('');
    });

    it('authorBio uses ro when language is ro', () => {
      const cmp = create();
      TestBed.inject(TranslateService).use('ro');
      cmp.post.set(post({ meta: { author: { bio: { en: 'EN', ro: 'Romanian' } } } }));
      expect(cmp.authorBio()).toBe('Romanian');
    });

    it('authorLinks returns [] for non-array, filters invalid entries', () => {
      const cmp = create();
      cmp.post.set(post({ meta: { author: { links: 'nope' } } }));
      expect(cmp.authorLinks()).toEqual([]);
      cmp.post.set(
        post({
          meta: {
            author: {
              links: [
                { label: ' GitHub ', url: ' https://gh ' },
                { label: '', url: 'https://x' },
                { label: 'NoUrl', url: 5 },
              ],
            },
          },
        }),
      );
      expect(cmp.authorLinks()).toEqual([{ label: 'GitHub', url: 'https://gh' }]);
    });
  });

  // ---------------------------------------------------------------------------
  // small synchronous helpers
  // ---------------------------------------------------------------------------
  describe('simple helpers', () => {
    it('focalPosition clamps and defaults', () => {
      const cmp = create();
      expect(cmp.focalPosition()).toBe('50% 50%');
      expect(cmp.focalPosition(-10, 200)).toBe('0% 100%');
      expect(cmp.focalPosition(25, 75)).toBe('25% 75%');
    });

    it('coverImageClass switches on contain', () => {
      const cmp = create();
      expect(cmp.coverImageClass('contain')).toContain('object-contain');
      expect(cmp.coverImageClass('cover')).toContain('object-cover');
      expect(cmp.coverImageClass(null)).toContain('object-cover');
    });

    it('activeLang returns ro/en', () => {
      const cmp = create();
      expect(cmp.activeLang()).toBe('en');
      TestBed.inject(TranslateService).use('ro');
      expect(cmp.activeLang()).toBe('ro');
    });

    it('toDateTimeLocal handles empty, invalid and valid', () => {
      const cmp = create();
      expect(cmp.toDateTimeLocal('')).toBe('');
      expect(cmp.toDateTimeLocal('not-a-date')).toBe('');
      const out = cmp.toDateTimeLocal('2020-03-04T05:06:00');
      expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });

    it('toIsoFromDateTimeLocal handles empty, invalid and valid', () => {
      const cmp = create();
      expect(cmp.toIsoFromDateTimeLocal('')).toBeNull();
      expect(cmp.toIsoFromDateTimeLocal('garbage')).toBeNull();
      expect(cmp.toIsoFromDateTimeLocal('2020-03-04T05:06')).toContain('T');
    });

    it('isFutureIso handles missing, invalid, past, future', () => {
      const cmp = create();
      expect(cmp.isFutureIso(null)).toBeFalse();
      expect(cmp.isFutureIso('garbage')).toBeFalse();
      expect(cmp.isFutureIso('2000-01-01T00:00:00Z')).toBeFalse();
      expect(cmp.isFutureIso(new Date(Date.now() + 60000).toISOString())).toBeTrue();
    });

    it('cloneMeta clones, defaults to {}, and falls back on circular', () => {
      const cmp = create();
      expect(cmp.cloneMeta(null)).toEqual({});
      expect(cmp.cloneMeta({ a: 1 })).toEqual({ a: 1 });
      const circular: any = { a: 1 };
      circular.self = circular;
      const cloned = cmp.cloneMeta(circular);
      expect(cloned.a).toBe(1);
    });

    it('normalizeTags handles null, array, string, dedup, blanks', () => {
      const cmp = create();
      expect(cmp.normalizeTags(null)).toEqual([]);
      expect(cmp.normalizeTags(undefined)).toEqual([]);
      expect(cmp.normalizeTags(42)).toEqual([]);
      expect(cmp.normalizeTags(['A', 'a', ' b ', '', 'B'])).toEqual(['A', 'b']);
      expect(cmp.normalizeTags('x, y , x')).toEqual(['x', 'y']);
      expect(cmp.normalizeTagsInput('p, q')).toEqual(['p', 'q']);
    });

    it('sameStringSet compares case-insensitively', () => {
      const cmp = create();
      expect(cmp.sameStringSet(['a'], ['a', 'b'])).toBeFalse();
      expect(cmp.sameStringSet(['A', 'b'], ['a', 'B'])).toBeTrue();
      expect(cmp.sameStringSet(['a', 'c'], ['a', 'b'])).toBeFalse();
    });

    it('getMetaSummary resolves string, localized, and empty', () => {
      const cmp = create();
      expect(cmp.getMetaSummary({}, 'en')).toBe('');
      expect(cmp.getMetaSummary({ summary: ' text ' }, 'en')).toBe('text');
      expect(cmp.getMetaSummary({ summary: { en: ' E ' } }, 'en')).toBe('E');
      expect(cmp.getMetaSummary({ summary: { ro: 'R' } }, 'en')).toBe('');
      expect(cmp.getMetaSummary({ summary: ['arr'] }, 'en')).toBe('');
    });

    it('slugifyHeading normalizes and truncates', () => {
      const cmp = create();
      expect(cmp.slugifyHeading('Héllo, Wörld!')).toBe('hello-world');
      expect(cmp.slugifyHeading('')).toBe('');
    });

    it('hasMeaningfulArticleText checks length threshold', () => {
      const cmp = create();
      cmp.bodyHtml.set('<p>short</p>');
      expect(cmp.hasMeaningfulArticleText()).toBeFalse();
      cmp.bodyHtml.set('<p>' + 'word '.repeat(40) + '</p>');
      expect(cmp.hasMeaningfulArticleText()).toBeTrue();
    });

    it('canEditBlog reflects admin mode', () => {
      const cmp = create();
      expect(cmp.canEditBlog()).toBeFalse();
      adminEnabled = true;
      expect(cmp.canEditBlog()).toBeTrue();
    });

    it('rootComments and replies filter by parent_id', () => {
      const cmp = create();
      cmp.comments.set([
        comment({ id: 'r1', parent_id: null }),
        comment({ id: 'c2', parent_id: 'r1' }),
      ]);
      expect(cmp.rootComments().map((c: BlogComment) => c.id)).toEqual(['r1']);
      expect(cmp.replies('r1').map((c: BlogComment) => c.id)).toEqual(['c2']);
    });

    it('authorLabel delegates to formatIdentity', () => {
      const cmp = create();
      expect(typeof cmp.authorLabel({ id: 'u', name: 'Name' })).toBe('string');
      expect(typeof cmp.authorLabel(null)).toBe('string');
    });

    it('startReply / cancelReply toggle replyTo', () => {
      const cmp = create();
      const c = comment();
      cmp.startReply(c);
      expect(cmp.replyTo()).toBe(c);
      cmp.cancelReply();
      expect(cmp.replyTo()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // permission predicates
  // ---------------------------------------------------------------------------
  describe('permission predicates', () => {
    it('canDelete covers all branches', () => {
      const cmp = create();
      const c = comment({ author: { id: 'u1' } });
      auth.isAuthenticated.and.returnValue(false);
      expect(cmp.canDelete(c)).toBeFalse();
      auth.isAuthenticated.and.returnValue(true);
      expect(cmp.canDelete(comment({ is_deleted: true }))).toBeFalse();
      auth.user.and.returnValue(null);
      expect(cmp.canDelete(c)).toBeFalse();
      auth.user.and.returnValue({ id: 'other' } as any);
      auth.isAdmin.and.returnValue(true);
      expect(cmp.canDelete(c)).toBeTrue();
      auth.isAdmin.and.returnValue(false);
      auth.user.and.returnValue({ id: 'u1' } as any);
      expect(cmp.canDelete(c)).toBeTrue();
      auth.user.and.returnValue({ id: 'zzz' } as any);
      expect(cmp.canDelete(c)).toBeFalse();
    });

    it('canReply covers branches', () => {
      const cmp = create();
      auth.isAuthenticated.and.returnValue(false);
      expect(cmp.canReply(comment())).toBeFalse();
      auth.isAuthenticated.and.returnValue(true);
      expect(cmp.canReply(comment({ is_deleted: true }))).toBeFalse();
      expect(cmp.canReply(comment())).toBeTrue();
    });

    it('canSubscribeToComments covers branches', () => {
      const cmp = create();
      auth.isAuthenticated.and.returnValue(false);
      expect(cmp.canSubscribeToComments()).toBeFalse();
      auth.isAuthenticated.and.returnValue(true);
      auth.user.and.returnValue({ id: 'u', email_verified: false } as any);
      expect(cmp.canSubscribeToComments()).toBeFalse();
      auth.user.and.returnValue({ id: 'u', email_verified: true } as any);
      expect(cmp.canSubscribeToComments()).toBeTrue();
    });

    it('canFlag covers branches', () => {
      const cmp = create();
      auth.isAuthenticated.and.returnValue(false);
      expect(cmp.canFlag(comment())).toBeFalse();
      auth.isAuthenticated.and.returnValue(true);
      auth.user.and.returnValue(null);
      expect(cmp.canFlag(comment())).toBeFalse();
      auth.user.and.returnValue({ id: 'me' } as any);
      expect(cmp.canFlag(comment({ is_deleted: true }))).toBeFalse();
      expect(cmp.canFlag(comment({ is_hidden: true }))).toBeFalse();
      expect(cmp.canFlag(comment({ author: { id: 'me' } }))).toBeFalse();
      expect(cmp.canFlag(comment({ author: { id: 'other' } }))).toBeTrue();
    });
  });

  // ---------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------
  describe('lifecycle', () => {
    it('ngOnInit wires snapshot, subscriptions, listeners; ngOnDestroy cleans up', () => {
      routeStub.snapshot.params = { slug: 'snap' };
      routeStub.snapshot.queryParams = { preview: 'tok' };
      blog.getPreviewPost.and.returnValue(of(post({ slug: 'snap' })));
      const cmp = create('', '');
      spyOn(window, 'requestAnimationFrame').and.returnValue(0);
      const addSpy = spyOn(window, 'addEventListener').and.callThrough();
      const removeSpy = spyOn(window, 'removeEventListener').and.callThrough();

      cmp.ngOnInit();
      expect(blog.getPreviewPost).toHaveBeenCalledWith('snap', 'tok', 'en');
      expect(addSpy).toHaveBeenCalledWith('scroll', jasmine.any(Function), jasmine.any(Object));

      // route emission re-loads (with a string preview token branch)
      blog.getPreviewPost.and.returnValue(of(post({ slug: 'next' })));
      routeParams$.next({ slug: 'next' });
      routeQueryParams$.next({ preview: 'qp' });
      expect(blog.getPreviewPost).toHaveBeenCalledWith('next', 'qp', 'en');

      // route emission without a preview token
      blog.getPost.and.returnValue(of(post({ slug: 'plain' })));
      routeParams$.next({ slug: 'plain' });
      routeQueryParams$.next({});
      expect(blog.getPost).toHaveBeenCalledWith('plain', 'en');

      // language change re-loads
      TestBed.inject(TranslateService).use('ro');

      cmp.ngOnDestroy();
      expect(removeSpy).toHaveBeenCalledWith('scroll', jasmine.any(Function));
    });

    it('ngOnInit with non-string preview defaults to empty token', () => {
      routeStub.snapshot.params = { slug: 'snap' };
      routeStub.snapshot.queryParams = { preview: 123 };
      const cmp = create('', '');
      spyOn(window, 'requestAnimationFrame').and.returnValue(0);
      cmp.ngOnInit();
      expect(cmp.isPreview()).toBeFalse();
      expect(blog.getPost).toHaveBeenCalled();
      cmp.ngOnDestroy();
    });

    it('ngOnInit/ngOnDestroy tolerate missing defaultView', () => {
      routeStub.snapshot.params = { slug: 'snap' };
      const cmp = create('snap', '');
      (cmp as any).document = fakeDoc(null);
      cmp.ngOnInit();
      expect(blog.getPost).toHaveBeenCalled();
      cmp.ngOnDestroy();
      expect(structuredData.clearRouteSchemas).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // load()
  // ---------------------------------------------------------------------------
  describe('load', () => {
    it('returns early without a slug', () => {
      const cmp = create('', '');
      cmp.load();
      expect(blog.getPost).not.toHaveBeenCalled();
    });

    it('loads a published post, resets state, and triggers downstream loads', () => {
      const cmp = create('first-post', '');
      spyOn(window, 'requestAnimationFrame').and.returnValue(0);
      cmp.load();
      expect(blog.getPost).toHaveBeenCalledWith('first-post', 'en');
      expect(cmp.loadingPost()).toBeFalse();
      expect(cmp.hasPostError()).toBeFalse();
      expect(cmp.post()?.title).toBe('Hello');
      expect(blog.listCommentThreads).toHaveBeenCalled();
    });

    it('uses preview endpoint when preview token present', () => {
      const cmp = create('first-post', 'tk');
      spyOn(window, 'requestAnimationFrame').and.returnValue(0);
      cmp.load();
      expect(blog.getPreviewPost).toHaveBeenCalledWith('first-post', 'tk', 'en');
    });

    it('loads admin block when editing is enabled and resets captcha refs', () => {
      adminEnabled = true;
      const cmp = create('first-post', '');
      spyOn(window, 'requestAnimationFrame').and.returnValue(0);
      cmp.commentCaptcha = { reset: jasmine.createSpy('reset') } as any;
      cmp.newsletterCaptcha = { reset: jasmine.createSpy('reset') } as any;
      auth.user.and.returnValue({ id: 'u', email: 'me@test.dev' } as any);
      cmp.load();
      expect(adminSvc.getContent).toHaveBeenCalledWith('blog.first-post');
      expect(cmp.newsletterEmail).toBe('me@test.dev');
      expect(cmp.commentCaptcha.reset).toHaveBeenCalled();
    });

    it('handles post load error', () => {
      blog.getPost.and.returnValue(throwError(() => new Error('boom')));
      const cmp = create('first-post', '');
      cmp.load();
      expect(cmp.hasPostError()).toBeTrue();
      expect(cmp.post()).toBeNull();
      expect(cmp.loadingPost()).toBeFalse();
      expect(structuredData.setRouteSchemas).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // admin block / quick edit
  // ---------------------------------------------------------------------------
  describe('admin block + quick edit', () => {
    it('loadAdminBlock guards on slug/permission', () => {
      const cmp = create('', '');
      cmp.loadAdminBlock();
      expect(adminSvc.getContent).not.toHaveBeenCalled();
      const cmp2 = create('first-post', '');
      cmp2.loadAdminBlock(); // adminEnabled false
      expect(adminSvc.getContent).not.toHaveBeenCalled();
    });

    it('loadAdminBlock success hydrates state', () => {
      adminEnabled = true;
      const cmp = create('first-post', '');
      cmp.post.set(post());
      cmp.loadAdminBlock();
      expect(cmp.adminBlock()?.status).toBe('draft');
      expect(cmp.adminBlockError()).toBeFalse();
    });

    it('loadAdminBlock error sets error flag', () => {
      adminEnabled = true;
      adminSvc.getContent.and.returnValue(throwError(() => new Error('x')));
      const cmp = create('first-post', '');
      cmp.loadAdminBlock();
      expect(cmp.adminBlockError()).toBeTrue();
      expect(cmp.adminBlock()).toBeNull();
    });

    it('toggleQuickEdit opens and loads admin block when none cached', () => {
      adminEnabled = true;
      const cmp = create('first-post', '');
      cmp.toggleQuickEdit();
      expect(cmp.quickEditOpen()).toBeTrue();
      expect(adminSvc.getContent).toHaveBeenCalled();
    });

    it('toggleQuickEdit opens and hydrates when admin block already cached', () => {
      const cmp = create('first-post', '');
      cmp.adminBlock.set({
        key: 'blog.first-post',
        title: 'T',
        body_markdown: '',
        status: 'review',
        version: 3,
      });
      cmp.post.set(post({ tags: ['x'] }));
      cmp.toggleQuickEdit();
      expect(cmp.quickEditStatus).toBe('review');
      expect(cmp.quickEditTags).toBe('x');
    });

    it('toggleQuickEdit while loading does not reload', () => {
      const cmp = create('first-post', '');
      cmp.adminBlockLoading.set(true);
      cmp.toggleQuickEdit();
      expect(adminSvc.getContent).not.toHaveBeenCalled();
    });

    it('toggleQuickEdit closing simply collapses', () => {
      const cmp = create('first-post', '');
      cmp.quickEditOpen.set(true);
      cmp.toggleQuickEdit();
      expect(cmp.quickEditOpen()).toBeFalse();
    });

    it('resetQuickEdit re-hydrates from state', () => {
      const cmp = create('first-post', '');
      cmp.post.set(post({ title: 'Re' }));
      cmp.quickEditTitle = 'changed';
      cmp.resetQuickEdit();
      expect(cmp.quickEditTitle).toBe('Re');
    });

    it('hydrateQuickEditFromState returns early when no post and no block', () => {
      const cmp = create('first-post', '');
      cmp.quickEditTitle = 'kept';
      cmp.hydrateQuickEditFromState();
      expect(cmp.quickEditTitle).toBe('kept');
    });

    it('hydrateQuickEditFromState reads tags from meta when post has none', () => {
      const cmp = create('first-post', '');
      cmp.adminBlock.set({
        key: 'blog.first-post',
        title: 'B',
        body_markdown: '',
        status: 'draft',
        version: 1,
        meta: { tags: ['m1', 'm2'], summary: { en: 'S' } },
        published_at: '2020-01-01T00:00:00Z',
        published_until: '2020-02-01T00:00:00Z',
      });
      cmp.post.set(post({ tags: [] }));
      cmp.hydrateQuickEditFromState();
      expect(cmp.quickEditTags).toBe('m1, m2');
    });
  });

  // ---------------------------------------------------------------------------
  // saveQuickEdit()
  // ---------------------------------------------------------------------------
  describe('saveQuickEdit', () => {
    function withBlock(cmp: Cmp, block: Partial<ContentBlock> = {}): void {
      cmp.adminBlock.set({
        key: 'blog.first-post',
        title: 'Hello',
        body_markdown: '',
        status: 'draft',
        version: 1,
        ...block,
      });
      cmp.post.set(post());
    }

    it('returns early without slug or block', () => {
      const cmp = create('', '');
      cmp.saveQuickEdit();
      expect(adminSvc.updateContentBlock).not.toHaveBeenCalled();
      const cmp2 = create('first-post', '');
      cmp2.saveQuickEdit();
      expect(adminSvc.updateContentBlock).not.toHaveBeenCalled();
    });

    it('closes without requests when nothing changed', () => {
      const cmp = create('first-post', '');
      withBlock(cmp);
      cmp.post.set(post({ summary: undefined }));
      cmp.quickEditOpen.set(true);
      cmp.quickEditStatus = 'draft';
      cmp.quickEditTitle = ''; // exercises the `(quickEditTitle || '')` fallback
      cmp.quickEditSummary = '';
      cmp.quickEditTags = '';
      cmp.quickEditPublishAt = '';
      cmp.quickEditUnpublishAt = '';
      cmp.saveQuickEdit();
      expect(adminSvc.updateContentBlock).not.toHaveBeenCalled();
      expect(cmp.quickEditOpen()).toBeFalse();
    });

    it('sends status, schedule, tags, summary and title changes; updates post', () => {
      const cmp = create('first-post', '');
      withBlock(cmp, {
        status: 'draft',
        published_at: new Date(Date.now() + 3600_000).toISOString(),
        published_until: '2020-02-01T00:00:00Z',
        meta: { tags: ['old'], summary: { en: 'old summary' } },
        version: 7,
      });
      cmp.quickEditStatus = 'published';
      cmp.quickEditTitle = 'New Title';
      cmp.quickEditSummary = 'New summary';
      cmp.quickEditTags = 'a, b';
      cmp.quickEditPublishAt = '';
      cmp.quickEditUnpublishAt = '';
      cmp.saveQuickEdit();
      expect(adminSvc.updateContentBlock).toHaveBeenCalledTimes(2);
      const firstPayload = adminSvc.updateContentBlock.calls.argsFor(0)[1] as any;
      expect(firstPayload.status).toBe('published');
      expect(firstPayload.published_at).toBeNull();
      expect(firstPayload.published_until).toBeNull();
      expect(firstPayload.meta.tags).toEqual(['a', 'b']);
      expect(cmp.post()?.title).toBe('New Title');
      expect(toast.success).toHaveBeenCalled();
    });

    it('sets a new publish time when provided differently', () => {
      const cmp = create('first-post', '');
      withBlock(cmp, { meta: {} });
      cmp.quickEditStatus = 'draft';
      cmp.quickEditTitle = 'Hello';
      cmp.quickEditSummary = 'Summary';
      cmp.quickEditTags = '';
      cmp.quickEditPublishAt = '2030-05-06T07:08';
      cmp.quickEditUnpublishAt = '2031-05-06T07:08';
      cmp.saveQuickEdit();
      const payload = adminSvc.updateContentBlock.calls.argsFor(0)[1] as any;
      expect(payload.published_at).toContain('T');
      expect(payload.published_until).toContain('T');
    });

    it('adds summary into existing localized object and removes tags when cleared', () => {
      const cmp = create('first-post', '');
      withBlock(cmp, { meta: { tags: ['x'], summary: { ro: 'RO' } } });
      cmp.post.set(post({ summary: undefined, tags: ['x'] }));
      cmp.quickEditStatus = 'draft';
      cmp.quickEditTitle = 'Hello';
      cmp.quickEditSummary = 'English summary';
      cmp.quickEditTags = '';
      cmp.quickEditPublishAt = '';
      cmp.quickEditUnpublishAt = '';
      cmp.saveQuickEdit();
      const payload = adminSvc.updateContentBlock.calls.argsFor(0)[1] as any;
      expect(payload.meta.summary).toEqual({ ro: 'RO', en: 'English summary' });
      expect(payload.meta.tags).toBeUndefined();
    });

    it('removes only the active-lang summary key, keeping siblings', () => {
      const cmp = create('first-post', '');
      withBlock(cmp, { meta: { summary: { en: 'E', ro: 'R' } } });
      cmp.post.set(post({ summary: 'E' }));
      cmp.quickEditStatus = 'draft';
      cmp.quickEditTitle = 'Hello';
      cmp.quickEditSummary = '';
      cmp.quickEditTags = '';
      cmp.quickEditPublishAt = '';
      cmp.quickEditUnpublishAt = '';
      cmp.saveQuickEdit();
      const payload = adminSvc.updateContentBlock.calls.argsFor(0)[1] as any;
      expect(payload.meta.summary).toEqual({ ro: 'R' });
    });

    it('drops the summary object entirely when the last key is removed', () => {
      const cmp = create('first-post', '');
      withBlock(cmp, { meta: { summary: { en: 'E' } } });
      cmp.post.set(post({ summary: 'E' }));
      cmp.quickEditStatus = 'draft';
      cmp.quickEditTitle = 'Hello';
      cmp.quickEditSummary = '';
      cmp.quickEditTags = '';
      cmp.quickEditPublishAt = '';
      cmp.quickEditUnpublishAt = '';
      cmp.saveQuickEdit();
      const payload = adminSvc.updateContentBlock.calls.argsFor(0)[1] as any;
      expect(payload.meta.summary).toBeUndefined();
    });

    it('deletes a string summary when cleared', () => {
      const cmp = create('first-post', '');
      withBlock(cmp, { meta: { summary: 'plain' } });
      cmp.post.set(post({ summary: 'plain' }));
      cmp.quickEditStatus = 'draft';
      cmp.quickEditTitle = 'Hello';
      cmp.quickEditSummary = '';
      cmp.quickEditTags = '';
      cmp.quickEditPublishAt = '';
      cmp.quickEditUnpublishAt = '';
      cmp.saveQuickEdit();
      const payload = adminSvc.updateContentBlock.calls.argsFor(0)[1] as any;
      expect(payload.meta.summary).toBeUndefined();
    });

    it('sends only a title change when nothing else differs', () => {
      const cmp = create('first-post', '');
      withBlock(cmp, { meta: { summary: { en: 'Summary' } } });
      cmp.quickEditStatus = 'draft';
      cmp.quickEditTitle = 'Only Title';
      cmp.quickEditSummary = 'Summary';
      cmp.quickEditTags = '';
      cmp.quickEditPublishAt = '';
      cmp.quickEditUnpublishAt = '';
      cmp.saveQuickEdit();
      expect(adminSvc.updateContentBlock).toHaveBeenCalledTimes(1);
      const payload = adminSvc.updateContentBlock.calls.argsFor(0)[1] as any;
      expect(payload.title).toBe('Only Title');
    });

    it('handles save error with server detail', () => {
      adminSvc.updateContentBlock.and.returnValue(
        throwError(() => ({ error: { detail: '  too long  ' } })),
      );
      const cmp = create('first-post', '');
      withBlock(cmp, { meta: {} });
      cmp.quickEditStatus = 'published';
      cmp.quickEditTitle = 'Hello';
      cmp.quickEditSummary = 'Summary';
      cmp.quickEditTags = '';
      cmp.quickEditPublishAt = '';
      cmp.quickEditUnpublishAt = '';
      cmp.saveQuickEdit();
      expect(cmp.quickEditError()).toBe('too long');
      expect(toast.error).toHaveBeenCalled();
    });

    it('handles save error without detail (fallback copy)', () => {
      adminSvc.updateContentBlock.and.returnValue(throwError(() => ({ error: {} })));
      const cmp = create('first-post', '');
      withBlock(cmp, { meta: {} });
      cmp.quickEditStatus = 'published';
      cmp.quickEditTitle = 'Hello';
      cmp.quickEditSummary = 'Summary';
      cmp.quickEditTags = '';
      cmp.quickEditPublishAt = '';
      cmp.quickEditUnpublishAt = '';
      cmp.saveQuickEdit();
      expect(cmp.quickEditError()).toBeTruthy();
      expect(cmp.quickEditSaving()).toBeFalse();
    });

    it('saves a title change with empty status and no current post to patch', () => {
      const cmp = create('first-post', '');
      cmp.adminBlock.set({
        key: 'blog.first-post',
        title: 'Hello',
        body_markdown: '',
        status: 'draft',
        version: 1,
        meta: {},
      });
      cmp.post.set(null);
      cmp.quickEditStatus = ''; // exercises the `(quickEditStatus || '')` fallback
      cmp.quickEditTitle = 'Brand New';
      cmp.quickEditSummary = '';
      cmp.quickEditTags = '';
      cmp.quickEditPublishAt = '';
      cmp.quickEditUnpublishAt = '';
      cmp.saveQuickEdit();
      expect(adminSvc.updateContentBlock).toHaveBeenCalledTimes(1);
      const payload = adminSvc.updateContentBlock.calls.argsFor(0)[1] as any;
      expect(payload.title).toBe('Brand New');
      expect(toast.success).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // editBlogPost
  // ---------------------------------------------------------------------------
  describe('editBlogPost', () => {
    it('navigates with the slug', () => {
      const cmp = create('my-slug', '');
      const router = (cmp as any).router;
      const navSpy = spyOn(router, 'navigate').and.resolveTo(true);
      cmp.editBlogPost();
      expect(navSpy).toHaveBeenCalledWith(['/admin/content/blog'], {
        queryParams: { edit: 'my-slug' },
      });
    });

    it('does nothing for an empty slug', () => {
      const cmp = create('', '');
      const router = (cmp as any).router;
      const navSpy = spyOn(router, 'navigate');
      cmp.editBlogPost();
      expect(navSpy).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // neighbors / related / more-from-author
  // ---------------------------------------------------------------------------
  describe('related loaders', () => {
    it('loadNeighbors guards, succeeds and errors', () => {
      const cmp = create('', '');
      cmp.loadNeighbors('en');
      expect(blog.getNeighbors).not.toHaveBeenCalled();

      const cmp2 = create('first-post', '');
      blog.getNeighbors.and.returnValue(
        of({ previous: { slug: 'p' } as any, next: { slug: 'n' } as any }),
      );
      cmp2.loadNeighbors('en');
      expect(cmp2.neighbors().previous?.slug).toBe('p');

      blog.getNeighbors.and.returnValue(throwError(() => new Error('x')));
      cmp2.loadNeighbors('en');
      expect(cmp2.neighbors().previous).toBeNull();
    });

    it('loadNeighbors handles null previous/next from response', () => {
      const cmp = create('first-post', '');
      blog.getNeighbors.and.returnValue(of({ previous: undefined, next: undefined }) as any);
      cmp.loadNeighbors('en');
      expect(cmp.neighbors()).toEqual({ previous: null, next: null });
    });

    it('loadRelatedPosts returns early without series or tags', () => {
      const cmp = create('first-post', '');
      cmp.loadRelatedPosts('en', post({ series: '', tags: [] }));
      expect(cmp.relatedPosts()).toEqual([]);
      expect(blog.listPosts).not.toHaveBeenCalled();
    });

    it('loadRelatedPosts scores and sorts by series/tags then date', () => {
      const cmp = create('first-post', '');
      blog.listPosts.and.returnValue(
        of({
          items: [
            { slug: 'first-post', title: 'self', tags: ['t1'] } as any,
            { slug: 'a', title: 'A', series: 'S', tags: ['t1'], published_at: '2020-01-01' } as any,
            { slug: 'b', title: 'B', tags: ['t1', 't2'], published_at: '2021-01-01' } as any,
            { slug: 'c', title: 'C', tags: ['t1'], published_at: '2019-01-01' } as any,
            { slug: 'd', title: 'D', tags: ['nope'] } as any,
          ],
          meta: { total_items: 5, total_pages: 1, page: 1, limit: 50 },
        }),
      );
      cmp.loadRelatedPosts('en', post({ series: 'S', tags: ['t1', 't2'] }));
      const slugs = cmp.relatedPosts().map((i: any) => i.slug);
      expect(slugs[0]).toBe('a');
      expect(slugs).not.toContain('first-post');
      expect(slugs).not.toContain('d');
    });

    it('loadRelatedPosts handles same-score date ordering and error', () => {
      const cmp = create('first-post', '');
      blog.listPosts.and.returnValue(
        of({
          items: [
            { slug: 'old', title: 'O', tags: ['t1'] } as any,
            { slug: 'new', title: 'N', tags: ['t1'], published_at: '2025-01-01' } as any,
          ],
          meta: { total_items: 2, total_pages: 1, page: 1, limit: 50 },
        }),
      );
      cmp.loadRelatedPosts('en', post({ series: '', tags: ['t1'] }));
      expect(cmp.relatedPosts()[0].slug).toBe('new');

      blog.listPosts.and.returnValue(throwError(() => new Error('x')));
      cmp.loadRelatedPosts('en', post({ tags: ['t1'] }));
      expect(cmp.relatedPosts()).toEqual([]);
    });

    it('loadMoreFromAuthor returns early without author id', () => {
      const cmp = create('first-post', '');
      cmp.loadMoreFromAuthor('en', post({ author: null }));
      expect(cmp.moreFromAuthor()).toEqual([]);
      expect(cmp.loadingMoreFromAuthor()).toBeFalse();
    });

    it('loadMoreFromAuthor loads and filters current post; handles error', () => {
      const cmp = create('first-post', '');
      blog.listPosts.and.returnValue(
        of({
          items: [{ slug: 'first-post', title: 'self' } as any, { slug: 'x', title: 'X' } as any],
          meta: { total_items: 2, total_pages: 1, page: 1, limit: 8 },
        }),
      );
      cmp.loadMoreFromAuthor('en', post({ author: { id: 'a1' } }));
      expect(cmp.moreFromAuthor().map((i: any) => i.slug)).toEqual(['x']);
      expect(cmp.loadingMoreFromAuthor()).toBeFalse();

      blog.listPosts.and.returnValue(throwError(() => new Error('x')));
      cmp.loadMoreFromAuthor('en', post({ author: { id: 'a1' } }));
      expect(cmp.moreFromAuthor()).toEqual([]);
    });

    it('loadMoreFromAuthor copes with a null items list', () => {
      const cmp = create('first-post', '');
      blog.listPosts.and.returnValue(
        of({ items: null as any, meta: { total_items: 0, total_pages: 1, page: 1, limit: 8 } }),
      );
      cmp.loadMoreFromAuthor('en', post({ author: { id: 'a1' } }));
      expect(cmp.moreFromAuthor()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // scroll / navigation helpers
  // ---------------------------------------------------------------------------
  describe('scroll helpers', () => {
    it('scrollToTop guards on missing window and scrolls otherwise', () => {
      const cmp = create();
      (cmp as any).document = fakeDoc(null);
      cmp.scrollToTop();
      const scrollTo = jasmine.createSpy('scrollTo');
      (cmp as any).document = fakeDoc({ scrollTo });
      cmp.scrollToTop();
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });

    it('scrollToHeading guards on window and missing target, then scrolls', () => {
      const cmp = create();
      const evt = { preventDefault: jasmine.createSpy() } as any;
      (cmp as any).document = fakeDoc(null);
      cmp.scrollToHeading(evt, 'h');
      expect(evt.preventDefault).toHaveBeenCalled();

      const getElementById = jasmine.createSpy('getElementById').and.returnValue(null);
      (cmp as any).document = { defaultView: win({ scrollY: 0 }), getElementById };
      cmp.scrollToHeading({ preventDefault() {} } as any, 'missing');
      expect(getElementById).toHaveBeenCalledWith('missing');

      const target = { getBoundingClientRect: () => ({ top: 200 }) };
      const scrollTo = jasmine.createSpy('scrollTo');
      const replaceState = jasmine.createSpy('replaceState');
      (cmp as any).document = {
        defaultView: win({
          scrollY: 100,
          scrollTo,
          history: { replaceState },
          location: { pathname: '/p', search: '?q' },
        }),
        getElementById: () => target,
      };
      cmp.scrollToHeading({ preventDefault() {} } as any, 'sec');
      expect(scrollTo).toHaveBeenCalled();
      expect(replaceState).toHaveBeenCalled();
      expect(cmp.activeHeadingId()).toBe('sec');
    });
  });

  // ---------------------------------------------------------------------------
  // handleArticleClick
  // ---------------------------------------------------------------------------
  describe('handleArticleClick', () => {
    function makeEvent(target: any, overrides: any = {}): any {
      return {
        target,
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        preventDefault: jasmine.createSpy('preventDefault'),
        stopPropagation: jasmine.createSpy('stopPropagation'),
        ...overrides,
      };
    }

    it('navigates on plain router-link click', () => {
      const cmp = create();
      const router = (cmp as any).router;
      const navSpy = spyOn(router, 'navigateByUrl').and.resolveTo(true);
      const link = document.createElement('a');
      link.setAttribute('data-router-link', '/products/x');
      const target = { closest: (sel: string) => (sel.includes('data-router-link') ? link : null) };
      cmp.handleArticleClick(makeEvent(target));
      expect(navSpy).toHaveBeenCalledWith('/products/x');
    });

    it('ignores router-link click with modifier keys', () => {
      const cmp = create();
      const router = (cmp as any).router;
      const navSpy = spyOn(router, 'navigateByUrl');
      const link = document.createElement('a');
      link.setAttribute('data-router-link', '/products/x');
      const target = {
        closest: (sel: string) => (sel.includes('data-router-link') ? link : null),
      };
      cmp.handleArticleClick(makeEvent(target, { metaKey: true }));
      expect(navSpy).not.toHaveBeenCalled();
    });

    it('copies code when the copy button is clicked', () => {
      const cmp = create();
      const copySpy = spyOn(cmp as any, 'copyCode');
      const wrapper = document.createElement('div');
      wrapper.className = 'blog-codeblock';
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = 'console.log(1)\n';
      pre.appendChild(code);
      wrapper.appendChild(pre);
      const button = document.createElement('button');
      button.setAttribute('data-code-action', 'copy');
      wrapper.appendChild(button);
      const target = {
        closest: (sel: string) => {
          if (sel.includes('data-router-link')) return null;
          if (sel.includes('data-code-action')) return button;
          return null;
        },
      };
      cmp.handleArticleClick(makeEvent(target));
      expect(copySpy).toHaveBeenCalledWith('console.log(1)');
    });

    it('toggles wrap when the wrap button is clicked', () => {
      const cmp = create();
      const wrapper = document.createElement('div');
      wrapper.className = 'blog-codeblock';
      const button = document.createElement('button');
      button.setAttribute('data-code-action', 'wrap');
      button.setAttribute('data-wrap-label', 'Wrap');
      button.setAttribute('data-unwrap-label', 'Unwrap');
      wrapper.appendChild(button);
      const target = {
        closest: (sel: string) => {
          if (sel.includes('data-router-link')) return null;
          if (sel.includes('data-code-action')) return button;
          return null;
        },
      };
      cmp.handleArticleClick(makeEvent(target));
      expect(button.textContent).toBe('Unwrap');
      expect(wrapper.classList.contains('blog-codeblock--wrap')).toBeTrue();
    });

    it('falls back to translated wrap labels when attributes are absent', () => {
      const cmp = create();
      const wrapper = document.createElement('div');
      wrapper.className = 'blog-codeblock';
      const button = document.createElement('button');
      button.setAttribute('data-code-action', 'wrap');
      wrapper.appendChild(button);
      const target = {
        closest: (sel: string) => (sel.includes('data-code-action') ? button : null),
      };
      cmp.handleArticleClick(makeEvent(target));
      expect(button.textContent).toBeTruthy();
    });

    it('returns when code action has no wrapper', () => {
      const cmp = create();
      const button = document.createElement('button');
      button.setAttribute('data-code-action', 'copy');
      const target = {
        closest: (sel: string) => (sel.includes('data-code-action') ? button : null),
      };
      const evt = makeEvent(target);
      cmp.handleArticleClick(evt);
      expect(evt.stopPropagation).not.toHaveBeenCalled();
    });

    it('opens the lightbox when a gallery image is clicked', () => {
      const cmp = create();
      cmp.galleryImages.set([{ src: 'http://img/1', alt: 'one' }]);
      const openSpy = spyOn(cmp, 'openLightbox');
      const img = { currentSrc: 'http://img/1', src: 'http://img/1' };
      const target = {
        closest: (sel: string) => (sel === 'img' ? img : null),
      };
      cmp.handleArticleClick(makeEvent(target));
      expect(openSpy).toHaveBeenCalledWith(0);
    });

    it('ignores non-link, non-button, non-image clicks', () => {
      const cmp = create();
      const target = { closest: () => null };
      const evt = makeEvent(target);
      cmp.handleArticleClick(evt);
      expect(evt.preventDefault).not.toHaveBeenCalled();
    });

    it('ignores image clicks when there are no gallery images', () => {
      const cmp = create();
      cmp.galleryImages.set([]);
      const img = { currentSrc: '', src: 'http://x' };
      const target = { closest: (sel: string) => (sel === 'img' ? img : null) };
      const evt = makeEvent(target);
      cmp.handleArticleClick(evt);
      expect(evt.preventDefault).not.toHaveBeenCalled();
    });

    it('ignores gallery image without a resolvable source or unknown source', () => {
      const cmp = create();
      cmp.galleryImages.set([{ src: 'http://known', alt: 'k' }]);
      const noSrc = {
        closest: (sel: string) => (sel === 'img' ? { currentSrc: '', src: '' } : null),
      };
      const evt1 = makeEvent(noSrc);
      cmp.handleArticleClick(evt1);
      expect(evt1.preventDefault).not.toHaveBeenCalled();

      const unknown = {
        closest: (sel: string) => (sel === 'img' ? { currentSrc: '', src: 'http://other' } : null),
      };
      const evt2 = makeEvent(unknown);
      cmp.handleArticleClick(evt2);
      expect(evt2.preventDefault).not.toHaveBeenCalled();
    });

    it('ignores router-link element without a destination', () => {
      const cmp = create();
      const link = document.createElement('a');
      link.setAttribute('data-router-link', '');
      const target = {
        closest: (sel: string) => (sel.includes('data-router-link') ? link : null),
      };
      const evt = makeEvent(target);
      cmp.handleArticleClick(evt);
      expect(evt.preventDefault).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // copyCode / clipboard helpers
  // ---------------------------------------------------------------------------
  describe('clipboard helpers', () => {
    it('copyCode returns without a window', () => {
      const cmp = create();
      (cmp as any).document = fakeDoc(null);
      cmp.copyCode('x');
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('copyCode uses the async clipboard on success', fakeAsync(() => {
      const cmp = create();
      const writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
      (cmp as any).document = fakeDoc({ navigator: { clipboard: { writeText } } });
      cmp.copyCode('hello');
      flushMicrotasks();
      expect(toast.success).toHaveBeenCalled();
    }));

    it('copyCode reports clipboard failure', fakeAsync(() => {
      const cmp = create();
      const writeText = jasmine.createSpy('writeText').and.rejectWith(new Error('no'));
      (cmp as any).document = fakeDoc({ navigator: { clipboard: { writeText } } });
      cmp.copyCode('hello');
      flushMicrotasks();
      expect(toast.error).toHaveBeenCalled();
    }));

    it('copyCode falls back to execCommand success', () => {
      const cmp = create();
      const input: any = { value: '', style: {}, setAttribute() {}, select() {}, remove() {} };
      (cmp as any).document = {
        defaultView: win({ navigator: {} }),
        createElement: () => input,
        body: { appendChild() {} },
        execCommand: () => true,
      };
      cmp.copyCode('hello');
      expect(toast.success).toHaveBeenCalled();
    });

    it('copyCode falls back to execCommand failure', () => {
      const cmp = create();
      const input: any = { value: '', style: {}, setAttribute() {}, select() {}, remove() {} };
      (cmp as any).document = {
        defaultView: win({ navigator: {} }),
        createElement: () => input,
        body: { appendChild() {} },
        execCommand: () => false,
      };
      cmp.copyCode('hello');
      expect(toast.error).toHaveBeenCalled();
    });

    it('copyCode handles execCommand throwing', () => {
      const cmp = create();
      (cmp as any).document = {
        defaultView: win({ navigator: {} }),
        createElement: () => {
          throw new Error('boom');
        },
        body: { appendChild() {} },
        execCommand: () => true,
      };
      cmp.copyCode('hello');
      expect(toast.error).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // lightbox
  // ---------------------------------------------------------------------------
  describe('lightbox', () => {
    it('openLightbox returns without images', () => {
      const cmp = create();
      cmp.galleryImages.set([]);
      cmp.openLightbox(0);
      expect(cmp.lightboxIndex()).toBeNull();
    });

    it('openLightbox clamps index, adds key listener and locks body scroll', () => {
      const cmp = create();
      cmp.galleryImages.set([
        { src: 'a', alt: 'A' },
        { src: 'b', alt: 'B' },
      ]);
      const addEventListener = jasmine.createSpy('addEventListener');
      const body: any = { style: { overflow: 'auto' } };
      (cmp as any).document = { defaultView: win({ addEventListener }), body };
      cmp.openLightbox(99);
      expect(cmp.lightboxIndex()).toBe(1);
      expect(addEventListener).toHaveBeenCalled();
      expect(body.style.overflow).toBe('hidden');
      // second open keeps existing saved overflow (previousBodyOverflow already set)
      cmp.openLightbox(0);
      expect(cmp.lightboxIndex()).toBe(0);
    });

    it('openLightbox without a window still sets the index', () => {
      const cmp = create();
      cmp.galleryImages.set([{ src: 'a', alt: 'A' }]);
      (cmp as any).document = { defaultView: null, body: { style: {} } };
      cmp.openLightbox(0);
      expect(cmp.lightboxIndex()).toBe(0);
    });

    it('closeLightbox removes listener and restores overflow', () => {
      const cmp = create();
      const removeEventListener = jasmine.createSpy('removeEventListener');
      const body: any = { style: { overflow: 'hidden' } };
      (cmp as any).document = { defaultView: win({ removeEventListener }), body };
      (cmp as any).previousBodyOverflow = 'scroll';
      cmp.closeLightbox();
      expect(removeEventListener).toHaveBeenCalled();
      expect(body.style.overflow).toBe('scroll');
      expect(cmp.lightboxIndex()).toBeNull();
    });

    it('closeLightbox without window or saved overflow is a no-op for body', () => {
      const cmp = create();
      (cmp as any).document = { defaultView: null, body: { style: {} } };
      (cmp as any).previousBodyOverflow = null;
      cmp.closeLightbox();
      expect(cmp.lightboxIndex()).toBeNull();
    });

    it('nextLightbox / prevLightbox wrap around and guard', () => {
      const cmp = create();
      cmp.galleryImages.set([
        { src: 'a', alt: '' },
        { src: 'b', alt: '' },
        { src: 'c', alt: '' },
      ]);
      cmp.lightboxIndex.set(2);
      const evt = { stopPropagation: jasmine.createSpy() } as any;
      cmp.nextLightbox(evt);
      expect(cmp.lightboxIndex()).toBe(0);
      expect(evt.stopPropagation).toHaveBeenCalled();
      cmp.prevLightbox();
      expect(cmp.lightboxIndex()).toBe(2);
    });

    it('nextLightbox / prevLightbox guard on null index or <2 images', () => {
      const cmp = create();
      cmp.galleryImages.set([{ src: 'a', alt: '' }]);
      cmp.lightboxIndex.set(null);
      cmp.nextLightbox();
      cmp.prevLightbox();
      expect(cmp.lightboxIndex()).toBeNull();
      cmp.lightboxIndex.set(0);
      cmp.nextLightbox();
      expect(cmp.lightboxIndex()).toBe(0);
    });

    it('the bound key listener handles Escape/Arrow keys and ignores others when closed', () => {
      const cmp = create();
      cmp.galleryImages.set([
        { src: 'a', alt: '' },
        { src: 'b', alt: '' },
      ]);
      const listener = (cmp as any).lightboxKeyListener as (e: KeyboardEvent) => void;

      // closed -> ignored
      cmp.lightboxIndex.set(null);
      listener({ key: 'Escape', preventDefault() {} } as any);
      expect(cmp.lightboxIndex()).toBeNull();

      cmp.lightboxIndex.set(0);
      listener({ key: 'ArrowRight', preventDefault() {} } as any);
      expect(cmp.lightboxIndex()).toBe(1);
      listener({ key: 'ArrowLeft', preventDefault() {} } as any);
      expect(cmp.lightboxIndex()).toBe(0);
      listener({ key: 'x', preventDefault() {} } as any);
      expect(cmp.lightboxIndex()).toBe(0);

      // Escape closes
      (cmp as any).document = { defaultView: win(), body: { style: {} } };
      listener({ key: 'Escape', preventDefault() {} } as any);
      expect(cmp.lightboxIndex()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // share helpers
  // ---------------------------------------------------------------------------
  describe('share helpers', () => {
    function windowWithLocation(extra: any = {}): any {
      return win({
        location: { origin: 'https://site.test', hash: '#sec', pathname: '/p', search: '' },
        ...extra,
      });
    }

    it('copyShareLink returns without window or url', () => {
      const cmp = create('', '');
      (cmp as any).document = fakeDoc(null);
      cmp.copyShareLink();
      expect(toast.success).not.toHaveBeenCalled();

      const cmp2 = create('', '');
      (cmp2 as any).document = fakeDoc(windowWithLocation());
      cmp2.copyShareLink(); // empty slug -> buildShareUrl returns ''
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('copyShareLink copies via async clipboard', fakeAsync(() => {
      const cmp = create('first-post', '');
      const writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
      (cmp as any).document = fakeDoc(
        windowWithLocation({ navigator: { clipboard: { writeText } } }),
      );
      cmp.copyShareLink();
      flushMicrotasks();
      expect(writeText).toHaveBeenCalledWith('https://site.test/blog/first-post?lang=en#sec');
      expect(toast.success).toHaveBeenCalled();
    }));

    it('copyShareLink reports async clipboard failure', fakeAsync(() => {
      const cmp = create('first-post', '');
      const writeText = jasmine.createSpy('writeText').and.rejectWith(new Error('no'));
      (cmp as any).document = fakeDoc(
        windowWithLocation({ navigator: { clipboard: { writeText } } }),
      );
      cmp.copyShareLink();
      flushMicrotasks();
      expect(toast.error).toHaveBeenCalled();
    }));

    it('copyShareLink falls back to execCommand (success, failure, throw)', () => {
      const input: any = { value: '', style: {}, setAttribute() {}, select() {}, remove() {} };
      const cmp = create('first-post', '');
      (cmp as any).document = {
        defaultView: windowWithLocation({ navigator: {} }),
        createElement: () => input,
        body: { appendChild() {} },
        execCommand: () => true,
      };
      cmp.copyShareLink();
      expect(toast.success).toHaveBeenCalled();

      const cmp2 = create('first-post', '');
      (cmp2 as any).document = {
        defaultView: windowWithLocation({ navigator: {} }),
        createElement: () => input,
        body: { appendChild() {} },
        execCommand: () => false,
      };
      cmp2.copyShareLink();
      expect(toast.error).toHaveBeenCalled();

      const cmp3 = create('first-post', '');
      (cmp3 as any).document = {
        defaultView: windowWithLocation({ navigator: {} }),
        createElement: () => {
          throw new Error('x');
        },
        body: { appendChild() {} },
        execCommand: () => true,
      };
      cmp3.copyShareLink();
      expect(toast.error).toHaveBeenCalledTimes(2);
    });

    it('shareWhatsApp guards and opens with/without title', () => {
      const cmp = create('', '');
      (cmp as any).document = fakeDoc(null);
      cmp.shareWhatsApp();

      const cmpNoUrl = create('', '');
      (cmpNoUrl as any).document = fakeDoc(windowWithLocation({ open: jasmine.createSpy() }));
      cmpNoUrl.shareWhatsApp();

      const open = jasmine.createSpy('open');
      const cmp2 = create('first-post', '');
      cmp2.post.set(post({ title: 'Title' }));
      (cmp2 as any).document = fakeDoc(windowWithLocation({ open }));
      cmp2.shareWhatsApp();
      expect(open).toHaveBeenCalled();
      expect(open.calls.argsFor(0)[0] as string).toContain('wa.me');

      const open2 = jasmine.createSpy('open');
      const cmp3 = create('first-post', '');
      cmp3.post.set(post({ title: '' }));
      (cmp3 as any).document = fakeDoc(windowWithLocation({ open: open2 }));
      cmp3.shareWhatsApp();
      expect(open2).toHaveBeenCalled();
    });

    it('shareFacebook guards and opens', () => {
      const cmp = create('', '');
      (cmp as any).document = fakeDoc(null);
      cmp.shareFacebook();

      const cmpNoUrl = create('', '');
      (cmpNoUrl as any).document = fakeDoc(windowWithLocation({ open: jasmine.createSpy() }));
      cmpNoUrl.shareFacebook();

      const open = jasmine.createSpy('open');
      const cmp2 = create('first-post', '');
      (cmp2 as any).document = fakeDoc(windowWithLocation({ open }));
      cmp2.shareFacebook();
      expect(open.calls.argsFor(0)[0] as string).toContain('facebook.com');
    });

    it('buildShareUrl returns empty without a window', () => {
      const cmp = create('first-post', '');
      (cmp as any).document = fakeDoc(null);
      expect((cmp as any).buildShareUrl()).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // comments loading / pagination / sorting
  // ---------------------------------------------------------------------------
  describe('comments', () => {
    it('loadComments guards on slug', () => {
      const cmp = create('', '');
      cmp.loadComments();
      expect(blog.listCommentThreads).not.toHaveBeenCalled();
    });

    it('loadComments flattens threads and tracks meta', () => {
      const cmp = create('first-post', '');
      blog.listCommentThreads.and.returnValue(
        of({
          items: [
            { root: comment({ id: 'r1' }), replies: [comment({ id: 'c2', parent_id: 'r1' })] },
            { root: null as any, replies: null as any },
          ],
          meta: { total_items: 2, total_pages: 3, page: 1, limit: 10 },
          total_comments: 9,
        }),
      );
      cmp.loadComments({ page: 2, sort: 'top' });
      expect(cmp.comments().map((c: BlogComment) => c.id)).toEqual(['r1', 'c2']);
      expect(cmp.commentsTotal()).toBe(9);
      expect(cmp.commentSort()).toBe('top');
      expect(cmp.commentPage()).toBe(2);
    });

    it('loadComments normalizes invalid sort and page', () => {
      const cmp = create('first-post', '');
      cmp.loadComments({ sort: 'weird' as any, page: -5 });
      expect(cmp.commentSort()).toBe('newest');
      expect(cmp.commentPage()).toBe(1);
    });

    it('loadComments handles missing meta/total and errors', () => {
      const cmp = create('first-post', '');
      blog.listCommentThreads.and.returnValue(
        of({ items: null as any, meta: null as any, total_comments: undefined as any }),
      );
      cmp.loadComments();
      expect(cmp.commentsMeta()).toBeNull();
      expect(cmp.commentsTotal()).toBe(0);

      blog.listCommentThreads.and.returnValue(throwError(() => new Error('x')));
      cmp.loadComments();
      expect(cmp.hasCommentsError()).toBeTrue();
      expect(cmp.comments()).toEqual([]);
    });

    it('loadCommentSubscription guards and handles auth states', () => {
      const cmp = create('', '');
      cmp.loadCommentSubscription();
      expect(blog.getCommentSubscription).not.toHaveBeenCalled();

      const cmp2 = create('first-post', '');
      auth.isAuthenticated.and.returnValue(false);
      cmp2.loadCommentSubscription();
      expect(cmp2.commentSubscribed()).toBeFalse();

      auth.isAuthenticated.and.returnValue(true);
      blog.getCommentSubscription.and.returnValue(of({ enabled: true }));
      cmp2.loadCommentSubscription();
      expect(cmp2.commentSubscribed()).toBeTrue();

      blog.getCommentSubscription.and.returnValue(throwError(() => new Error('x')));
      cmp2.loadCommentSubscription();
      expect(cmp2.commentSubscribed()).toBeFalse();
      expect(cmp2.commentSubscriptionLoading()).toBeFalse();
    });

    it('setCommentSort ignores invalid/same and reloads on change', () => {
      const cmp = create('first-post', '');
      const loadSpy = spyOn(cmp, 'loadComments');
      cmp.setCommentSort('weird' as any);
      cmp.commentSort.set('newest');
      cmp.setCommentSort('newest');
      expect(loadSpy).not.toHaveBeenCalled();
      cmp.setCommentSort('top');
      expect(loadSpy).toHaveBeenCalledWith({ page: 1, sort: 'top' });
    });

    it('goToCommentsPage clamps to meta and ignores same page', () => {
      const cmp = create('first-post', '');
      const loadSpy = spyOn(cmp, 'loadComments');
      cmp.commentsMeta.set({ total_items: 50, total_pages: 3, page: 1, limit: 10 });
      cmp.commentPage.set(1);
      cmp.goToCommentsPage(99);
      expect(loadSpy).toHaveBeenCalledWith({ page: 3 });
      loadSpy.calls.reset();
      cmp.goToCommentsPage(1);
      expect(loadSpy).not.toHaveBeenCalled();
    });

    it('goToCommentsPage without meta uses requested page', () => {
      const cmp = create('first-post', '');
      const loadSpy = spyOn(cmp, 'loadComments');
      cmp.commentsMeta.set(null);
      cmp.commentPage.set(1);
      cmp.goToCommentsPage(4);
      expect(loadSpy).toHaveBeenCalledWith({ page: 4 });
    });
  });

  // ---------------------------------------------------------------------------
  // comment subscription toggle
  // ---------------------------------------------------------------------------
  describe('toggleCommentSubscription', () => {
    function evt(checked: boolean): any {
      return { target: { checked } };
    }

    it('guards on slug and authentication', () => {
      const cmp = create('', '');
      cmp.toggleCommentSubscription(evt(true));
      expect(blog.setCommentSubscription).not.toHaveBeenCalled();

      const cmp2 = create('first-post', '');
      auth.isAuthenticated.and.returnValue(false);
      cmp2.toggleCommentSubscription(evt(true));
      expect(blog.setCommentSubscription).not.toHaveBeenCalled();
    });

    it('rejects unverified users and resets checkbox', () => {
      const cmp = create('first-post', '');
      auth.isAuthenticated.and.returnValue(true);
      auth.user.and.returnValue({ id: 'u', email_verified: false } as any);
      cmp.commentSubscribed.set(true);
      const target = { checked: true };
      cmp.toggleCommentSubscription({ target } as any);
      expect(toast.error).toHaveBeenCalled();
      expect(target.checked).toBeTrue();
    });

    it('enables subscription successfully', () => {
      const cmp = create('first-post', '');
      auth.isAuthenticated.and.returnValue(true);
      auth.user.and.returnValue({ id: 'u', email_verified: true } as any);
      blog.setCommentSubscription.and.returnValue(of({ enabled: true }));
      cmp.toggleCommentSubscription(evt(true));
      expect(cmp.commentSubscribed()).toBeTrue();
      expect(toast.success).toHaveBeenCalled();
    });

    it('disables subscription successfully', () => {
      const cmp = create('first-post', '');
      auth.isAuthenticated.and.returnValue(true);
      auth.user.and.returnValue({ id: 'u', email_verified: true } as any);
      blog.setCommentSubscription.and.returnValue(of({ enabled: false }));
      cmp.toggleCommentSubscription(evt(false));
      expect(cmp.commentSubscribed()).toBeFalse();
      expect(toast.success).toHaveBeenCalled();
    });

    it('reverts on error', () => {
      const cmp = create('first-post', '');
      auth.isAuthenticated.and.returnValue(true);
      auth.user.and.returnValue({ id: 'u', email_verified: true } as any);
      cmp.commentSubscribed.set(false);
      blog.setCommentSubscription.and.returnValue(throwError(() => new Error('x')));
      const target = { checked: true };
      cmp.toggleCommentSubscription({ target } as any);
      expect(cmp.commentSubscribed()).toBeFalse();
      expect(target.checked).toBeFalse();
      expect(toast.error).toHaveBeenCalled();
    });

    it('handles a missing event target', () => {
      const cmp = create('first-post', '');
      auth.isAuthenticated.and.returnValue(true);
      auth.user.and.returnValue({ id: 'u', email_verified: true } as any);
      blog.setCommentSubscription.and.returnValue(of({ enabled: true }));
      cmp.toggleCommentSubscription({ target: null } as any);
      expect(cmp.commentSubscribed()).toBeTrue();
    });
  });

  // ---------------------------------------------------------------------------
  // submitComment
  // ---------------------------------------------------------------------------
  describe('submitComment', () => {
    function authed(): void {
      auth.isAuthenticated.and.returnValue(true);
      auth.user.and.returnValue({ id: 'u', email_verified: true } as any);
    }

    it('guards: event, slug, auth, empty body', () => {
      const cmp = create('', '');
      const evt = { preventDefault: jasmine.createSpy() } as any;
      cmp.submitComment(evt);
      expect(evt.preventDefault).toHaveBeenCalled();
      expect(blog.createComment).not.toHaveBeenCalled();

      const cmp2 = create('first-post', '');
      auth.isAuthenticated.and.returnValue(false);
      cmp2.commentBody = 'hi';
      cmp2.submitComment();
      expect(blog.createComment).not.toHaveBeenCalled();

      const cmp3 = create('first-post', '');
      authed();
      cmp3.commentBody = '   ';
      cmp3.submitComment();
      expect(blog.createComment).not.toHaveBeenCalled();
    });

    it('blocks when captcha enabled but token missing', () => {
      const cmp = create('first-post', '');
      authed();
      cmp.captchaEnabled = true;
      cmp.commentCaptchaToken = null;
      cmp.commentBody = 'hello';
      cmp.submitComment();
      expect(toast.error).toHaveBeenCalled();
      expect(blog.createComment).not.toHaveBeenCalled();
    });

    it('submits a root comment (newest) and reloads', () => {
      const cmp = create('first-post', '');
      authed();
      cmp.commentCaptcha = { reset: jasmine.createSpy() } as any;
      cmp.commentSort.set('newest');
      cmp.commentBody = 'hello';
      const loadSpy = spyOn(cmp, 'loadComments');
      cmp.submitComment();
      expect(blog.createComment).toHaveBeenCalled();
      expect(cmp.commentPage()).toBe(1);
      expect(loadSpy).toHaveBeenCalled();
    });

    it('submits a root comment when sorted oldest -> jumps to last page', () => {
      const cmp = create('first-post', '');
      authed();
      cmp.commentSort.set('oldest');
      cmp.commentsMeta.set({ total_items: 25, total_pages: 3, page: 1, limit: 10 });
      cmp.commentBody = 'hello';
      spyOn(cmp, 'loadComments');
      cmp.submitComment();
      expect(cmp.commentPage()).toBe(3);
    });

    it('submits a root comment when sorted top -> switches to newest', () => {
      const cmp = create('first-post', '');
      authed();
      cmp.commentSort.set('top');
      cmp.commentBody = 'hello';
      spyOn(cmp, 'loadComments');
      cmp.submitComment();
      expect(cmp.commentSort()).toBe('newest');
      expect(cmp.commentPage()).toBe(1);
    });

    it('submits oldest root with missing meta defaults', () => {
      const cmp = create('first-post', '');
      authed();
      cmp.commentSort.set('oldest');
      cmp.commentsMeta.set(null);
      cmp.commentBody = 'hello';
      spyOn(cmp, 'loadComments');
      cmp.submitComment();
      expect(cmp.commentPage()).toBe(1);
    });

    it('submits a reply without changing pagination', () => {
      const cmp = create('first-post', '');
      authed();
      cmp.replyTo.set(comment({ id: 'parent' }));
      cmp.commentBody = 'a reply';
      spyOn(cmp, 'loadComments');
      cmp.submitComment();
      const payload = blog.createComment.calls.argsFor(0)[1] as any;
      expect(payload.parent_id).toBe('parent');
      expect(cmp.replyTo()).toBeNull();
    });

    it('handles 429 rate limit error', () => {
      const cmp = create('first-post', '');
      authed();
      cmp.commentBody = 'hello';
      blog.createComment.and.returnValue(throwError(() => ({ status: 429 })));
      cmp.submitComment();
      expect(toast.error).toHaveBeenCalled();
      expect(cmp.submitting()).toBeFalse();
    });

    it('handles 400 link-limit error', () => {
      const cmp = create('first-post', '');
      authed();
      cmp.commentBody = 'hello';
      blog.createComment.and.returnValue(
        throwError(() => ({ status: 400, error: { detail: 'too many LINK entries' } })),
      );
      cmp.submitComment();
      expect(toast.error).toHaveBeenCalled();
    });

    it('handles 400 captcha-required and captcha-failed errors', () => {
      const cmp = create('first-post', '');
      authed();
      cmp.commentBody = 'hello';
      blog.createComment.and.returnValue(
        throwError(() => ({ status: 400, error: { detail: 'captcha required' } })),
      );
      cmp.submitComment();
      blog.createComment.and.returnValue(
        throwError(() => ({ status: 400, error: { detail: 'captcha invalid' } })),
      );
      cmp.submitComment();
      expect(toast.error).toHaveBeenCalledTimes(2);
    });

    it('handles 400 with a generic detail string', () => {
      const cmp = create('first-post', '');
      authed();
      cmp.commentBody = 'hello';
      blog.createComment.and.returnValue(
        throwError(() => ({ status: 400, error: { detail: 'some other problem' } })),
      );
      cmp.submitComment();
      expect(toast.error).toHaveBeenCalledWith(jasmine.any(String), 'some other problem');
    });

    it('handles generic error (no status)', () => {
      const cmp = create('first-post', '');
      authed();
      cmp.commentCaptcha = { reset: jasmine.createSpy() } as any;
      cmp.commentBody = 'hello';
      blog.createComment.and.returnValue(throwError(() => ({})));
      cmp.submitComment();
      expect(toast.error).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // submitNewsletter
  // ---------------------------------------------------------------------------
  describe('submitNewsletter', () => {
    it('guards on empty email', () => {
      const cmp = create('first-post', '');
      const evt = { preventDefault: jasmine.createSpy() } as any;
      cmp.newsletterEmail = '   ';
      cmp.submitNewsletter(evt);
      expect(evt.preventDefault).toHaveBeenCalled();
      expect(newsletter.subscribe).not.toHaveBeenCalled();
    });

    it('blocks when captcha enabled but token missing', () => {
      const cmp = create('first-post', '');
      cmp.captchaEnabled = true;
      cmp.newsletterCaptchaToken = null;
      cmp.newsletterEmail = 'me@test.dev';
      cmp.submitNewsletter();
      expect(toast.error).toHaveBeenCalled();
      expect(newsletter.subscribe).not.toHaveBeenCalled();
    });

    it('subscribes successfully (new)', () => {
      const cmp = create('first-post', '');
      cmp.newsletterCaptcha = { reset: jasmine.createSpy() } as any;
      cmp.newsletterEmail = 'me@test.dev';
      newsletter.subscribe.and.returnValue(of({ already_subscribed: false } as any));
      cmp.submitNewsletter();
      expect(cmp.newsletterSubscribed()).toBeTrue();
      expect(cmp.newsletterAlreadySubscribed()).toBeFalse();
      expect(toast.success).toHaveBeenCalled();
    });

    it('subscribes successfully (already subscribed)', () => {
      const cmp = create('first-post', '');
      cmp.newsletterEmail = 'me@test.dev';
      newsletter.subscribe.and.returnValue(of({ already_subscribed: true } as any));
      cmp.submitNewsletter();
      expect(cmp.newsletterAlreadySubscribed()).toBeTrue();
    });

    it('handles subscription error', () => {
      const cmp = create('first-post', '');
      cmp.newsletterEmail = 'me@test.dev';
      newsletter.subscribe.and.returnValue(throwError(() => new Error('x')));
      cmp.submitNewsletter();
      expect(cmp.newsletterLoading()).toBeFalse();
      expect(toast.error).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // deleteComment / flagComment
  // ---------------------------------------------------------------------------
  describe('deleteComment / flagComment', () => {
    it('deleteComment returns early when not allowed', () => {
      const cmp = create('first-post', '');
      auth.isAuthenticated.and.returnValue(false);
      cmp.deleteComment(comment());
      expect(blog.deleteComment).not.toHaveBeenCalled();
    });

    it('deleteComment aborts when not confirmed', () => {
      const cmp = create('first-post', '');
      auth.isAuthenticated.and.returnValue(true);
      auth.user.and.returnValue({ id: 'u1' } as any);
      spyOn(window, 'confirm').and.returnValue(false);
      cmp.deleteComment(comment({ author: { id: 'u1' } }));
      expect(blog.deleteComment).not.toHaveBeenCalled();
    });

    it('deleteComment deletes and reloads', () => {
      const cmp = create('first-post', '');
      auth.isAuthenticated.and.returnValue(true);
      auth.user.and.returnValue({ id: 'u1' } as any);
      spyOn(window, 'confirm').and.returnValue(true);
      const loadSpy = spyOn(cmp, 'loadComments');
      cmp.deleteComment(comment({ author: { id: 'u1' } }));
      expect(blog.deleteComment).toHaveBeenCalled();
      expect(loadSpy).toHaveBeenCalled();
    });

    it('deleteComment reports an error', () => {
      const cmp = create('first-post', '');
      auth.isAuthenticated.and.returnValue(true);
      auth.user.and.returnValue({ id: 'u1' } as any);
      spyOn(window, 'confirm').and.returnValue(true);
      blog.deleteComment.and.returnValue(throwError(() => new Error('x')));
      cmp.deleteComment(comment({ author: { id: 'u1' } }));
      expect(toast.error).toHaveBeenCalled();
    });

    it('flagComment returns early when not allowed', () => {
      const cmp = create('first-post', '');
      auth.isAuthenticated.and.returnValue(false);
      cmp.flagComment(comment());
      expect(blog.flagComment).not.toHaveBeenCalled();
    });

    it('flagComment reports success with a trimmed reason', () => {
      const cmp = create('first-post', '');
      auth.isAuthenticated.and.returnValue(true);
      auth.user.and.returnValue({ id: 'me' } as any);
      spyOn(window, 'prompt').and.returnValue('  spam  ');
      cmp.flagComment(comment({ author: { id: 'other' } }));
      const payload = blog.flagComment.calls.argsFor(0)[1] as any;
      expect(payload.reason).toBe('spam');
      expect(toast.success).toHaveBeenCalled();
    });

    it('flagComment sends null reason when prompt is empty/cancelled', () => {
      const cmp = create('first-post', '');
      auth.isAuthenticated.and.returnValue(true);
      auth.user.and.returnValue({ id: 'me' } as any);
      spyOn(window, 'prompt').and.returnValue(null);
      cmp.flagComment(comment({ author: { id: 'other' } }));
      const payload = blog.flagComment.calls.argsFor(0)[1] as any;
      expect(payload.reason).toBeNull();
    });

    it('flagComment reports an error', () => {
      const cmp = create('first-post', '');
      auth.isAuthenticated.and.returnValue(true);
      auth.user.and.returnValue({ id: 'me' } as any);
      spyOn(window, 'prompt').and.returnValue('reason');
      blog.flagComment.and.returnValue(throwError(() => new Error('x')));
      cmp.flagComment(comment({ author: { id: 'other' } }));
      expect(toast.error).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // SEO / meta
  // ---------------------------------------------------------------------------
  describe('SEO meta', () => {
    it('setMetaTags sets title, tags, canonical and schema (with cover + author)', () => {
      const cmp = create('first-post', '');
      cmp.setMetaTags(
        post({
          title: 'Story',
          cover_image_url: 'https://img/cover.jpg',
          published_at: '2020-01-01T00:00:00Z',
          author_name: 'Author Name',
        }),
      );
      expect(title.setTitle).toHaveBeenCalledWith('Story | momentstudio');
      const schema = structuredData.setRouteSchemas.calls.mostRecent().args[0][0] as any;
      expect(schema['@type']).toBe('BlogPosting');
      expect(schema.author.name).toBe('Author Name');
    });

    it('setMetaTags author falls back through name/username/default', () => {
      const cmp = create('first-post', '');
      cmp.setMetaTags(post({ author_name: null, author: { id: 'x', name: 'Nested' } }));
      let schema = structuredData.setRouteSchemas.calls.mostRecent().args[0][0] as any;
      expect(schema.author.name).toBe('Nested');

      cmp.setMetaTags(post({ author_name: null, author: { id: 'x', username: 'nick' } }));
      schema = structuredData.setRouteSchemas.calls.mostRecent().args[0][0] as any;
      expect(schema.author.name).toBe('nick');

      cmp.setMetaTags(post({ author_name: null, author: null, summary: null, body_markdown: '' }));
      schema = structuredData.setRouteSchemas.calls.mostRecent().args[0][0] as any;
      expect(schema.author.name).toBe('momentstudio');
    });

    it('setErrorMetaTags sets a WebPage schema', () => {
      const cmp = create('first-post', '');
      cmp.setErrorMetaTags();
      const schema = structuredData.setRouteSchemas.calls.mostRecent().args[0][0] as any;
      expect(schema['@type']).toBe('WebPage');
    });

    it('setCanonical returns empty without a slug', () => {
      const cmp = create('', '');
      expect((cmp as any).setCanonical()).toBe('');
      expect(seoHeadLinks.setLocalizedCanonical).not.toHaveBeenCalled();
    });

    it('setCanonical builds a localized canonical URL', () => {
      const cmp = create('first-post', '');
      const href = (cmp as any).setCanonical();
      expect(href).toContain('/blog/first-post');
      expect(meta.updateTag).toHaveBeenCalledWith({ property: 'og:url', content: href });
    });
  });

  // ---------------------------------------------------------------------------
  // reading progress
  // ---------------------------------------------------------------------------
  describe('reading progress', () => {
    it('measureReadingProgressSoon guards on window and schedules rAF', () => {
      const cmp = create();
      (cmp as any).document = fakeDoc(null);
      cmp.measureReadingProgressSoon();

      const raf = jasmine.createSpy('raf').and.callFake((cb: any) => {
        cb();
        return 1;
      });
      (cmp as any).document = fakeDoc({ requestAnimationFrame: raf });
      const measure = spyOn(cmp as any, 'measureReadingProgress');
      const update = spyOn(cmp as any, 'updateReadingProgress');
      cmp.measureReadingProgressSoon();
      expect(measure).toHaveBeenCalled();
      expect(update).toHaveBeenCalled();
    });

    it('measureReadingProgress guards on missing window or element', () => {
      const cmp = create();
      (cmp as any).document = fakeDoc(null);
      cmp.articleContent = undefined;
      (cmp as any).measureReadingProgress();
      expect(cmp.galleryImages()).toEqual([]);
    });

    it('measureReadingProgress collects headings and gallery images', () => {
      const cmp = create();
      const el = document.createElement('div');
      el.innerHTML = `
        <h2 id="a">A</h2>
        <h3 id="b">B</h3>
        <img src="http://img/1" alt="one" />
        <img src="http://img/1" alt="dup" />
        <div class="blog-embed"><img src="http://img/embed" alt="embed" /></div>
        <img alt="" />
      `;
      cmp.articleContent = { nativeElement: el } as any;
      (cmp as any).document = {
        defaultView: win({ scrollY: 0, innerHeight: 600 }),
        documentElement: { scrollTop: 0 },
      };
      (cmp as any).measureReadingProgress();
      expect(cmp.galleryImages().length).toBe(1);
      expect((cmp as any).tocHeadingEls.length).toBe(2);
    });

    it('updateReadingProgress resets when there is no article element', () => {
      const cmp = create();
      cmp.articleContent = undefined;
      (cmp as any).document = fakeDoc({ scrollY: 0 });
      cmp.readingProgress.set(0.5);
      (cmp as any).updateReadingProgress();
      expect(cmp.readingProgress()).toBe(0);
      expect(cmp.showBackToTop()).toBeFalse();
    });

    it('updateReadingProgress returns when there is no window', () => {
      const cmp = create();
      (cmp as any).document = fakeDoc(null);
      (cmp as any).updateReadingProgress();
      expect(cmp.readingProgress()).toBe(0);
    });

    it('updateReadingProgress computes progress and remeasures when stale', () => {
      const cmp = create();
      const el = document.createElement('div');
      el.innerHTML = '<h2 id="a">A</h2>';
      cmp.articleContent = { nativeElement: el } as any;
      (cmp as any).scrollStartY = 0;
      (cmp as any).scrollEndY = 0; // forces a remeasure
      const measure = spyOn(cmp as any, 'measureReadingProgress').and.callFake(() => {
        (cmp as any).scrollStartY = 0;
        (cmp as any).scrollEndY = 1000;
        (cmp as any).tocHeadingEls = [];
      });
      (cmp as any).document = { defaultView: win({ scrollY: 800 }) };
      (cmp as any).updateReadingProgress();
      expect(measure).toHaveBeenCalled();
      expect(cmp.readingProgress()).toBeGreaterThan(0);
      expect(cmp.showBackToTop()).toBeTrue();
    });

    it('updateActiveHeading clears when no headings, selects when scrolled', () => {
      const cmp = create();
      (cmp as any).tocHeadingEls = [];
      (cmp as any).updateActiveHeading();
      expect(cmp.activeHeadingId()).toBeNull();

      (cmp as any).document = fakeDoc(null);
      (cmp as any).tocHeadingEls = [{ id: 'h1', getBoundingClientRect: () => ({ top: -5 }) }];
      (cmp as any).updateActiveHeading();

      (cmp as any).document = fakeDoc({});
      (cmp as any).tocHeadingEls = [
        { id: 'h1', getBoundingClientRect: () => ({ top: -50 }) },
        { id: 'h2', getBoundingClientRect: () => ({ top: 50 }) },
        { id: 'h3', getBoundingClientRect: () => ({ top: 400 }) },
      ];
      (cmp as any).updateActiveHeading();
      // h1 and h2 are both above the offset; the last one scrolled past wins.
      expect(cmp.activeHeadingId()).toBe('h2');
    });
  });

  // ---------------------------------------------------------------------------
  // renderPostBody
  // ---------------------------------------------------------------------------
  describe('renderPostBody', () => {
    it('returns raw html when DOMParser is unavailable', () => {
      const cmp = create();
      markdown.render.and.returnValue('<p>raw</p>');
      (cmp as any).document = fakeDoc({});
      const res = (cmp as any).renderPostBody('x');
      expect(res).toEqual({ html: '<p>raw</p>', toc: [], embeds: [] });
    });

    it('builds toc with dedup, anchors, layout images, galleries, embeds, callouts, code', () => {
      const cmp = create();
      markdown.render.and.returnValue(`
        <h2>Intro</h2>
        <h2>Intro</h2>
        <h3>Sub</h3>
        <h2>!!!</h2>
        <h2></h2>
        <img src="a.jpg" title="wide" />
        <img src="b.jpg" title="left right gallery" />
        <img src="c.jpg" />
        <img src="d.jpg" title="random" />
        <p><img class="blog-img-gallery" src="g1.jpg" /></p>
        <p><img class="blog-img-gallery" src="g2.jpg" /></p>
        <p>not a gallery paragraph</p>
        <p><img class="blog-img-gallery" src="lonely.jpg" /></p>
        <p>{{ product:cool-thing }}</p>
        <p>{{ category:cat-slug }}</p>
        <p>{{ collection:col-slug }}</p>
        <blockquote><p>[!TIP] helpful</p></blockquote>
        <blockquote><p>[!WARNING] danger</p></blockquote>
        <blockquote><p>[!NOTE] info</p></blockquote>
        <blockquote><p>[!IMPORTANT]</p></blockquote>
        <blockquote><p>no marker here</p></blockquote>
        <blockquote></blockquote>
        <pre><code class="language-js">const x = 1;</code></pre>
        <pre><code class="language-ts">let y: number = 2;</code></pre>
        <pre><code class="language-html">&lt;div&gt;&lt;/div&gt;</code></pre>
        <pre><code class="language-xml">&lt;x/&gt;</code></pre>
        <pre><code class="language-zzz">plain text</code></pre>
        <pre><code>no language</code></pre>
      `);
      const res = (cmp as any).renderPostBody('markdown');
      const ids = res.toc.map((t: any) => t.id);
      expect(ids).toContain('intro');
      expect(ids).toContain('intro-2');
      expect(ids).toContain('section');
      expect(res.toc.some((t: any) => t.level === 3)).toBeTrue();
      expect(res.embeds).toEqual([
        { type: 'product', slug: 'cool-thing' },
        { type: 'category', slug: 'cat-slug' },
        { type: 'collection', slug: 'col-slug' },
      ]);
      expect(res.html).toContain('blog-gallery');
      expect(res.html).toContain('blog-callout--tip');
      expect(res.html).toContain('blog-callout--warning');
      expect(res.html).toContain('blog-callout--note');
      expect(res.html).toContain('blog-codeblock');
      expect(res.html).toContain('blog-img-wide');
      expect(res.html).toContain('blog-img-left');
      expect(res.html).toContain('blog-img-right');
    });

    it('handles callout markers in non-text first child and empty resulting paragraph', () => {
      const cmp = create();
      markdown.render.and.returnValue(
        '<blockquote><p><strong>[!CAUTION]</strong></p><p>body</p></blockquote>',
      );
      const res = (cmp as any).renderPostBody('m');
      expect(res.html).toContain('blog-callout--warning');
    });

    it('survives highlight throwing for a known language', () => {
      const cmp = create();
      spyOn(hljs, 'highlight').and.throwError('boom');
      markdown.render.and.returnValue('<pre><code class="language-js">x</code></pre>');
      const res = (cmp as any).renderPostBody('m');
      expect(res.html).toContain('blog-codeblock');
    });

    it('ignores embed paragraphs whose text is not a valid embed', () => {
      const cmp = create();
      markdown.render.and.returnValue('<p>just text</p>');
      const res = (cmp as any).renderPostBody('m');
      expect(res.embeds).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // hydrateEmbeds + applyEmbedData
  // ---------------------------------------------------------------------------
  describe('embeds hydration', () => {
    it('hydrateEmbeds returns when html or embeds are empty', () => {
      const cmp = create();
      cmp.bodyHtml.set('');
      (cmp as any).hydrateEmbeds([{ type: 'product', slug: 'x' }], 1, 'en');
      cmp.bodyHtml.set('<p>x</p>');
      (cmp as any).hydrateEmbeds([], 1, 'en');
      expect(catalog.getProduct).not.toHaveBeenCalled();
    });

    it('hydrateEmbeds dedups and fetches products/categories/collections', () => {
      const cmp = create();
      cmp.bodyHtml.set(
        '<div class="blog-embed" data-embed-type="product" data-embed-slug="p1"></div>',
      );
      (cmp as any).embedRevision = 5;
      catalog.getProduct.and.returnValue(
        of({
          id: '1',
          slug: 'p1',
          name: 'Prod',
          base_price: 10,
          currency: 'RON',
          images: [],
        } as any),
      );
      (cmp as any).hydrateEmbeds(
        [
          { type: 'product', slug: 'p1' },
          { type: 'product', slug: 'p1' },
          { type: 'category', slug: 'c1' },
          { type: 'collection', slug: 'col1' },
        ],
        5,
        'en',
      );
      expect(catalog.getProduct).toHaveBeenCalledWith('p1');
      expect(catalog.listCategories).toHaveBeenCalled();
      expect(catalog.listFeaturedCollections).toHaveBeenCalled();
      expect(cmp.bodyHtml()).toContain('blog-embed-card');
    });

    it('hydrateEmbeds ignores stale revisions', () => {
      const cmp = create();
      cmp.bodyHtml.set(
        '<div class="blog-embed" data-embed-type="product" data-embed-slug="p1"></div>',
      );
      (cmp as any).embedRevision = 9;
      catalog.getProduct.and.returnValue(
        of({ id: '1', slug: 'p1', name: 'Prod', base_price: 10, currency: 'RON' } as any),
      );
      const before = cmp.bodyHtml();
      (cmp as any).hydrateEmbeds([{ type: 'product', slug: 'p1' }], 1, 'en');
      expect(cmp.bodyHtml()).toBe(before);
    });

    it('hydrateEmbeds recovers from product fetch errors', () => {
      const cmp = create();
      cmp.bodyHtml.set(
        '<div class="blog-embed" data-embed-type="product" data-embed-slug="p1"></div>',
      );
      (cmp as any).embedRevision = 3;
      catalog.getProduct.and.returnValue(throwError(() => new Error('x')));
      (cmp as any).hydrateEmbeds([{ type: 'product', slug: 'p1' }], 3, 'en');
      expect(cmp.bodyHtml()).toContain('notFoundProduct');
    });

    it('applyEmbedData returns html unchanged without DOMParser', () => {
      const cmp = create();
      (cmp as any).document = fakeDoc({});
      expect(
        (cmp as any).applyEmbedData('<p>x</p>', { products: {}, categories: [], collections: [] }),
      ).toBe('<p>x</p>');
    });

    it('applyEmbedData returns html unchanged when there are no embeds', () => {
      const cmp = create();
      const out = (cmp as any).applyEmbedData('<p>no embeds</p>', {
        products: {},
        categories: [],
        collections: [],
      });
      expect(out).toBe('<p>no embeds</p>');
    });

    it('applyEmbedData renders product (with sale + description), category and collection', () => {
      const cmp = create();
      // The product embed carries placeholder content so the clear-children loop runs.
      const html =
        '<div class="blog-embed" data-embed-type="product" data-embed-slug="p1">loading…</div>' +
        '<div class="blog-embed" data-embed-type="category" data-embed-slug="c1"></div>' +
        '<div class="blog-embed" data-embed-type="collection" data-embed-slug="col1"></div>' +
        '<div class="blog-embed" data-embed-type="" data-embed-slug=""></div>';
      const out = (cmp as any).applyEmbedData(html, {
        products: {
          p1: {
            id: '1',
            slug: 'p1',
            name: 'Cool Product',
            base_price: 100,
            sale_price: 80,
            currency: 'RON',
            short_description: 'desc',
            images: [{ url: 'http://img/p.jpg' }],
          },
        },
        categories: [
          { id: 'c', slug: 'c1', name: 'Cat', thumbnail_url: 'http://img/c.jpg' } as any,
        ],
        collections: [
          {
            id: 'col',
            slug: 'col1',
            name: 'Collection',
            description: 'cdesc',
            created_at: '2020',
            products: [
              { id: 'pp', slug: 'pp', name: 'PP', base_price: 5, currency: 'RON', images: [] },
            ],
          } as any,
        ],
      });
      expect(out).toContain('Cool Product');
      expect(out).toContain('blog-embed-price-secondary');
      expect(out).toContain('Cat');
      expect(out).toContain('Collection');
    });

    it('applyEmbedData renders not-found states and price without sale', () => {
      const cmp = create();
      const html =
        '<div class="blog-embed" data-embed-type="product" data-embed-slug="missing"></div>' +
        '<div class="blog-embed" data-embed-type="category" data-embed-slug="missing"></div>' +
        '<div class="blog-embed" data-embed-type="collection" data-embed-slug="missing"></div>';
      const out = (cmp as any).applyEmbedData(html, {
        products: { missing: null },
        categories: [],
        collections: [],
      });
      expect(out).toContain('notFoundProduct');
      expect(out).toContain('notFoundCategory');
      expect(out).toContain('notFoundCollection');
    });

    it('applyEmbedData handles products/categories/collections with no images and fallbacks', () => {
      const cmp = create();
      const html =
        '<div class="blog-embed" data-embed-type="product" data-embed-slug="p"></div>' +
        '<div class="blog-embed" data-embed-type="category" data-embed-slug="c"></div>' +
        '<div class="blog-embed" data-embed-type="collection" data-embed-slug="col"></div>';
      const out = (cmp as any).applyEmbedData(html, {
        products: {
          p: {
            id: '1',
            slug: 'p',
            name: '',
            base_price: NaN as any,
            sale_price: null,
            currency: '',
            images: [],
          },
        },
        categories: [{ id: 'c', slug: 'c', name: '', banner_url: 'http://img/b.jpg' } as any],
        collections: [
          {
            id: 'col',
            slug: 'col',
            name: '',
            description: null,
            created_at: '2020',
            products: null as any,
          } as any,
        ],
      });
      expect(out).toContain('blog-embed-card');
      expect(out).toContain('blog-embed-collection');
    });

    it('applyEmbedData skips category/collection entries without slugs', () => {
      const cmp = create();
      const html = '<div class="blog-embed" data-embed-type="category" data-embed-slug="c1"></div>';
      const out = (cmp as any).applyEmbedData(html, {
        products: {},
        categories: [{ id: 'x', name: 'NoSlug' } as any, null as any],
        collections: [null as any],
      });
      expect(out).toContain('notFoundCategory');
    });
  });

  // ---------------------------------------------------------------------------
  // remaining branch fill (defensive defaults, ternary alternates, edge inputs)
  // ---------------------------------------------------------------------------
  describe('branch fill', () => {
    it('scrollListener and resizeListener delegate to the progress updaters', () => {
      const cmp = create();
      const update = spyOn(cmp as any, 'updateReadingProgress');
      const measureSoon = spyOn(cmp as any, 'measureReadingProgressSoon');
      (cmp as any).scrollListener();
      (cmp as any).resizeListener();
      expect(update).toHaveBeenCalled();
      expect(measureSoon).toHaveBeenCalled();
    });

    it('hydrateQuickEditFromState yields empty title/summary when both post and block lack them', () => {
      const cmp = create('first-post', '');
      cmp.post.set(null);
      cmp.adminBlock.set({
        key: 'blog.first-post',
        title: undefined as any,
        body_markdown: '',
        status: 'draft',
        version: 1,
        meta: {},
      });
      cmp.hydrateQuickEditFromState();
      expect(cmp.quickEditTitle).toBe('');
      expect(cmp.quickEditSummary).toBe('');
    });

    it('setMetaTags falls back to created_at when updated_at is missing', () => {
      const cmp = create('first-post', '');
      cmp.setMetaTags(post({ updated_at: '', created_at: '2019-09-09T00:00:00Z' }));
      const schema = structuredData.setRouteSchemas.calls.mostRecent().args[0][0] as any;
      expect(schema.dateModified).toBe('2019-09-09T00:00:00Z');
    });

    it('setErrorMetaTags resolves the romanian language branch', () => {
      const cmp = create('first-post', '');
      TestBed.inject(TranslateService).use('ro');
      cmp.setErrorMetaTags();
      const schema = structuredData.setRouteSchemas.calls.mostRecent().args[0][0] as any;
      expect(schema.inLanguage).toBe('ro');
    });

    it('buildShareUrl resolves the romanian language branch', () => {
      const cmp = create('first-post', '');
      TestBed.inject(TranslateService).use('ro');
      (cmp as any).document = fakeDoc(
        win({ location: { origin: 'https://s.test', hash: '', pathname: '/p', search: '' } }),
      );
      expect((cmp as any).buildShareUrl()).toBe('https://s.test/blog/first-post?lang=ro');
    });

    it('authorBio / authorLinks default meta to {} when post or meta is absent', () => {
      const cmp = create();
      cmp.post.set(null);
      expect(cmp.authorBio()).toBe('');
      expect(cmp.authorLinks()).toEqual([]);
      cmp.post.set(post({ meta: null }));
      expect(cmp.authorBio()).toBe('');
      expect(cmp.authorLinks()).toEqual([]);
    });

    it('authorLinks coerces a non-string label to empty (then filters it out)', () => {
      const cmp = create();
      cmp.post.set(post({ meta: { author: { links: [{ label: 5, url: 'https://x' }] } } }));
      expect(cmp.authorLinks()).toEqual([]);
    });

    it('sameStringSet coerces falsy members through the String(v || "") guard', () => {
      const cmp = create();
      expect(cmp.sameStringSet([null as any, 'a'], ['a'])).toBeTrue();
      expect(cmp.sameStringSet(['a'], [undefined as any, 'a'])).toBeTrue();
    });

    it('hydrateQuickEditFromState defaults status to draft and reads title/summary from block', () => {
      const cmp = create('first-post', '');
      cmp.post.set(null);
      cmp.adminBlock.set({
        key: 'blog.first-post',
        title: 'Block Title',
        body_markdown: '',
        status: '' as any,
        version: 1,
        meta: { summary: { en: 'Block summary' } },
      });
      cmp.hydrateQuickEditFromState();
      expect(cmp.quickEditStatus).toBe('draft');
      expect(cmp.quickEditTitle).toBe('Block Title');
      expect(cmp.quickEditSummary).toBe('Block summary');
    });

    it('loadRelatedPosts tolerates items without tags and orders same-score by date', () => {
      const cmp = create('first-post', '');
      blog.listPosts.and.returnValue(
        of({
          items: [
            { slug: 'no-tags', title: 'NoTags', series: 'S' } as any,
            { slug: 'a', title: 'A', tags: ['t1'], published_at: '2020-01-01' } as any,
            { slug: 'b', title: 'B', tags: ['t1'] } as any,
            { slug: 'c', title: 'C', tags: ['t1'], published_at: '2022-01-01' } as any,
          ],
          meta: { total_items: 4, total_pages: 1, page: 1, limit: 50 },
        }),
      );
      cmp.loadRelatedPosts('en', post({ series: '', tags: ['t1'] }));
      const slugs = cmp.relatedPosts().map((i: any) => i.slug);
      expect(slugs[0]).toBe('c');
      expect(slugs).toContain('b');
    });

    it('scrollToHeading tolerates a falsy scrollY', () => {
      const cmp = create();
      const scrollTo = jasmine.createSpy('scrollTo');
      (cmp as any).document = {
        defaultView: win({
          scrollY: 0,
          scrollTo,
          history: { replaceState() {} },
          location: { pathname: '/p', search: '' },
        }),
        getElementById: () => ({ getBoundingClientRect: () => ({ top: 10 }) }),
      };
      cmp.scrollToHeading({ preventDefault() {} } as any, 'h');
      expect(scrollTo).toHaveBeenCalled();
    });

    it('handleArticleClick copy action does nothing when there is no code text', () => {
      const cmp = create();
      const copySpy = spyOn(cmp as any, 'copyCode');
      const wrapper = document.createElement('div');
      wrapper.className = 'blog-codeblock';
      const button = document.createElement('button');
      button.setAttribute('data-code-action', 'copy');
      wrapper.appendChild(button);
      const target = {
        closest: (sel: string) => (sel.includes('data-code-action') ? button : null),
      };
      cmp.handleArticleClick({
        target,
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        preventDefault() {},
        stopPropagation() {},
      } as any);
      expect(copySpy).not.toHaveBeenCalled();
    });

    it('handleArticleClick wrap action restores the wrap label when already wrapped', () => {
      const cmp = create();
      const wrapper = document.createElement('div');
      wrapper.className = 'blog-codeblock blog-codeblock--wrap';
      const button = document.createElement('button');
      button.setAttribute('data-code-action', 'wrap');
      button.setAttribute('data-wrap-label', 'Wrap');
      button.setAttribute('data-unwrap-label', 'Unwrap');
      wrapper.appendChild(button);
      const target = {
        closest: (sel: string) => (sel.includes('data-code-action') ? button : null),
      };
      cmp.handleArticleClick({
        target,
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        preventDefault() {},
        stopPropagation() {},
      } as any);
      expect(button.textContent).toBe('Wrap');
      expect(wrapper.classList.contains('blog-codeblock--wrap')).toBeFalse();
    });

    it('prevLightbox stops propagation when given an event', () => {
      const cmp = create();
      cmp.galleryImages.set([
        { src: 'a', alt: '' },
        { src: 'b', alt: '' },
      ]);
      cmp.lightboxIndex.set(0);
      const evt = { stopPropagation: jasmine.createSpy() } as any;
      cmp.prevLightbox(evt);
      expect(evt.stopPropagation).toHaveBeenCalled();
      expect(cmp.lightboxIndex()).toBe(1);
    });

    it('setCommentSort tolerates a falsy sort value', () => {
      const cmp = create('first-post', '');
      const loadSpy = spyOn(cmp, 'loadComments');
      cmp.setCommentSort('' as any);
      expect(loadSpy).not.toHaveBeenCalled();
    });

    it('hasMeaningfulArticleText coerces an empty body to a string', () => {
      const cmp = create();
      cmp.bodyHtml.set('');
      expect(cmp.hasMeaningfulArticleText()).toBeFalse();
    });

    it('buildShareUrl tolerates a missing location hash', () => {
      const cmp = create('first-post', '');
      (cmp as any).document = fakeDoc(
        win({ location: { origin: 'https://s.test', hash: '', pathname: '/p', search: '' } }),
      );
      expect((cmp as any).buildShareUrl()).toBe('https://s.test/blog/first-post?lang=en');
    });

    it('setMetaTags builds an absolute OG url from an http api base', () => {
      const cmp = create('first-post', '');
      const original = appConfig.apiBaseUrl;
      (appConfig as any).apiBaseUrl = 'http://api.test/v1';
      try {
        cmp.setMetaTags(post());
        const ogCall = meta.updateTag.calls
          .allArgs()
          .find((args) => args[0]?.property === 'og:image');
        expect(ogCall?.[0]?.content).toBe(
          'http://api.test/v1/blog/posts/first-post/og.png?lang=en',
        );
      } finally {
        (appConfig as any).apiBaseUrl = original;
      }
    });

    it('setMetaTags falls back to the default api base when config is empty', () => {
      const cmp = create('first-post', '');
      const original = appConfig.apiBaseUrl;
      (appConfig as any).apiBaseUrl = '';
      try {
        cmp.setMetaTags(post());
        const ogCall = meta.updateTag.calls
          .allArgs()
          .find((args) => args[0]?.property === 'og:image');
        expect(ogCall?.[0]?.content).toContain('/api/v1/blog/posts/first-post/og.png');
      } finally {
        (appConfig as any).apiBaseUrl = original;
      }
    });

    it('measureReadingProgress defaults a missing image alt to empty', () => {
      const cmp = create();
      const el = document.createElement('div');
      el.innerHTML = '<img src="http://img/noalt" />';
      cmp.articleContent = { nativeElement: el } as any;
      (cmp as any).document = {
        defaultView: win({ scrollY: 0, innerHeight: 600 }),
        documentElement: { scrollTop: 0 },
      };
      (cmp as any).measureReadingProgress();
      expect(cmp.galleryImages()).toEqual([{ src: 'http://img/noalt', alt: '' }]);
    });

    it('updateReadingProgress computes without remeasuring when already measured', () => {
      const cmp = create();
      const el = document.createElement('div');
      cmp.articleContent = { nativeElement: el } as any;
      (cmp as any).scrollStartY = 0;
      (cmp as any).scrollEndY = 1000;
      (cmp as any).tocHeadingEls = [];
      const measure = spyOn(cmp as any, 'measureReadingProgress');
      (cmp as any).document = { defaultView: win({ scrollY: 0 }) };
      (cmp as any).updateReadingProgress();
      expect(measure).not.toHaveBeenCalled();
      expect(cmp.readingProgress()).toBe(0);
      expect(cmp.showBackToTop()).toBeFalse();
    });

    it('renderPostBody coerces empty markdown and an empty code block', () => {
      const cmp = create();
      markdown.render.and.returnValue('<pre><code class="language-js"></code></pre>');
      const res = (cmp as any).renderPostBody('');
      expect(markdown.render).toHaveBeenCalledWith('');
      expect(res.html).toContain('blog-codeblock');
    });

    it('renderPostBody returns raw html when there is no window', () => {
      const cmp = create();
      markdown.render.and.returnValue('<p>x</p>');
      (cmp as any).document = fakeDoc(null);
      expect((cmp as any).renderPostBody('m')).toEqual({ html: '<p>x</p>', toc: [], embeds: [] });
    });

    it('renderPostBody breaks a gallery group at the first non-paragraph sibling', () => {
      const cmp = create();
      markdown.render.and.returnValue(
        '<p><img class="blog-img-gallery" src="g1.jpg" /></p>' +
          '<p><img class="blog-img-gallery" src="g2.jpg" /></p>' +
          '<div>stop</div>',
      );
      const res = (cmp as any).renderPostBody('m');
      expect(res.html).toContain('blog-gallery');
      expect(res.html).toContain('<div>stop</div>');
    });

    it('renderPostBody ignores a blockquote whose first paragraph is empty', () => {
      const cmp = create();
      markdown.render.and.returnValue('<blockquote><p></p></blockquote>');
      const res = (cmp as any).renderPostBody('m');
      expect(res.html).not.toContain('blog-callout');
    });

    it('hydrateEmbeds resolves categories/collections only (no product calls)', () => {
      const cmp = create();
      cmp.bodyHtml.set(
        '<div class="blog-embed" data-embed-type="category" data-embed-slug="c1"></div>',
      );
      (cmp as any).embedRevision = 2;
      catalog.listCategories.and.returnValue(of([{ id: 'c', slug: 'c1', name: 'Cat' } as any]));
      (cmp as any).hydrateEmbeds([{ type: 'category', slug: 'c1' }], 2, 'en');
      expect(catalog.getProduct).not.toHaveBeenCalled();
      expect(cmp.bodyHtml()).toContain('Cat');
    });

    it('hydrateEmbeds recovers from category and collection fetch errors', () => {
      const cmp = create();
      cmp.bodyHtml.set(
        '<div class="blog-embed" data-embed-type="category" data-embed-slug="c1"></div>' +
          '<div class="blog-embed" data-embed-type="collection" data-embed-slug="col1"></div>',
      );
      (cmp as any).embedRevision = 4;
      catalog.listCategories.and.returnValue(throwError(() => new Error('x')));
      catalog.listFeaturedCollections.and.returnValue(throwError(() => new Error('y')));
      (cmp as any).hydrateEmbeds(
        [
          { type: 'category', slug: 'c1' },
          { type: 'collection', slug: 'col1' },
        ],
        4,
        'en',
      );
      expect(cmp.bodyHtml()).toContain('notFoundCategory');
      expect(cmp.bodyHtml()).toContain('notFoundCollection');
    });

    it('applyEmbedData tolerates null category/collection lists and missing thumbnails', () => {
      const cmp = create();
      const html =
        '<div class="blog-embed" data-embed-type="category" data-embed-slug="c1"></div>' +
        '<div class="blog-embed" data-embed-type="collection" data-embed-slug="col1"></div>';
      const out = (cmp as any).applyEmbedData(html, {
        products: {},
        categories: null as any,
        collections: null as any,
      });
      expect(out).toContain('notFoundCategory');
      expect(out).toContain('notFoundCollection');
    });

    it('applyEmbedData uses the placeholder image and slug fallbacks', () => {
      const cmp = create();
      const html =
        '<div class="blog-embed" data-embed-type="category" data-embed-slug="c1"></div>' +
        '<div class="blog-embed" data-embed-type="collection" data-embed-slug="col1"></div>';
      const out = (cmp as any).applyEmbedData(html, {
        products: {},
        categories: [{ id: 'c', slug: 'c1', name: 'Cat' } as any],
        collections: [
          {
            id: 'col',
            slug: 'col1',
            name: 'Col',
            created_at: '2020',
            products: [{ id: 'p', slug: 'pp', name: '', base_price: 1, currency: 'RON' } as any],
          } as any,
        ],
      });
      expect(out).toContain('product-placeholder.svg');
      expect(out).toContain('>pp<');
    });
  });
});
