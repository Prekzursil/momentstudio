import { DOCUMENT } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Meta, Title } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';
import hljs from 'highlight.js/lib/core';

import { BlogPostComponent } from './blog-post.component';
import { AdminService, ContentBlock } from '../../core/admin.service';
import { BlogService, BlogComment, BlogPost } from '../../core/blog.service';
import { CatalogService } from '../../core/catalog.service';
import { NewsletterService } from '../../core/newsletter.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';
import { ToastService } from '../../core/toast.service';
import { MarkdownService } from '../../core/markdown.service';
import { AuthService } from '../../core/auth.service';

/**
 * Behavioural coverage suite for BlogPostComponent. Drives every branch of the
 * component's TypeScript logic (loading, SEO, quick-edit save, comments,
 * newsletter, sharing, lightbox, reading-progress and markdown post-processing)
 * by asserting real outputs/side-effects against controllable service spies and
 * a controllable `document.defaultView`.
 */
describe('BlogPostComponent (full coverage)', () => {
  let meta: jasmine.SpyObj<Meta>;
  let title: jasmine.SpyObj<Title>;
  let blog: jasmine.SpyObj<BlogService>;
  let admin: jasmine.SpyObj<AdminService>;
  let catalog: jasmine.SpyObj<CatalogService>;
  let newsletter: jasmine.SpyObj<NewsletterService>;
  let toast: jasmine.SpyObj<ToastService>;
  let markdown: jasmine.SpyObj<MarkdownService>;
  let auth: jasmine.SpyObj<AuthService>;
  let adminMode: { enabled: () => boolean };
  let doc: Document;
  let fakeWin: any;

  let routeParams$: Subject<Record<string, unknown>>;
  let routeQueryParams$: Subject<Record<string, unknown>>;
  let routeStub: any;

  const basePost: BlogPost = {
    slug: 'first-post',
    title: 'Hello',
    body_markdown: 'Body',
    created_at: '2000-01-01T00:00:00+00:00',
    updated_at: '2000-01-02T00:00:00+00:00',
    images: [],
    summary: 'Summary',
  };

  function makeComment(over: Partial<BlogComment> = {}): BlogComment {
    return {
      id: 'c1',
      parent_id: null,
      body: 'hi',
      is_deleted: false,
      is_hidden: false,
      created_at: '2001-01-01T00:00:00Z',
      updated_at: '2001-01-01T00:00:00Z',
      author: { id: 'u1', name: 'Alice', username: 'alice' },
      ...over,
    };
  }

  function makeBlock(over: Partial<ContentBlock> = {}): ContentBlock {
    return {
      key: 'blog.first-post',
      title: 'Hello',
      body_markdown: 'Body',
      status: 'draft',
      version: 3,
      meta: {},
      published_at: null,
      published_until: null,
      ...over,
    };
  }

  function makeFakeWindow(): any {
    const clipboard = {
      writeText: jasmine.createSpy('writeText').and.returnValue(Promise.resolve()),
    };
    return {
      scrollY: 0,
      innerHeight: 800,
      location: { origin: 'https://shop.test', pathname: '/blog/first-post', search: '', hash: '' },
      history: { replaceState: jasmine.createSpy('replaceState') },
      navigator: { clipboard },
      DOMParser: window.DOMParser,
      Node: window.Node,
      addEventListener: jasmine.createSpy('addEventListener'),
      removeEventListener: jasmine.createSpy('removeEventListener'),
      scrollTo: jasmine.createSpy('scrollTo'),
      open: jasmine.createSpy('open'),
      requestAnimationFrame: jasmine.createSpy('raf').and.callFake((cb: FrameRequestCallback) => {
        cb(0 as any);
        return 1;
      }),
      getComputedStyle: window.getComputedStyle.bind(window),
    };
  }

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
      'setCommentSubscription',
      'createComment',
      'deleteComment',
      'flagComment',
    ]);
    admin = jasmine.createSpyObj<AdminService>('AdminService', [
      'getContent',
      'updateContentBlock',
    ]);
    catalog = jasmine.createSpyObj<CatalogService>('CatalogService', [
      'getProduct',
      'listCategories',
      'listFeaturedCollections',
    ]);
    newsletter = jasmine.createSpyObj<NewsletterService>('NewsletterService', ['subscribe']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success']);
    markdown = jasmine.createSpyObj<MarkdownService>('MarkdownService', ['render']);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['isAuthenticated', 'user', 'isAdmin']);
    adminMode = { enabled: () => false };

    doc = document.implementation.createHTMLDocument('blog-post-cov');
    fakeWin = makeFakeWindow();

    blog.getPost.and.returnValue(of(basePost));
    blog.getPreviewPost.and.returnValue(of(basePost));
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
    blog.createComment.and.returnValue(of(makeComment()));
    blog.deleteComment.and.returnValue(of(void 0));
    blog.flagComment.and.returnValue(
      of({ id: 'f1', user_id: 'u1', reason: null, created_at: '2001-01-01T00:00:00Z' }),
    );
    admin.getContent.and.returnValue(of(makeBlock()));
    admin.updateContentBlock.and.returnValue(of(makeBlock()));
    catalog.getProduct.and.returnValue(of(null as any));
    catalog.listCategories.and.returnValue(of([] as any));
    catalog.listFeaturedCollections.and.returnValue(of([] as any));
    newsletter.subscribe.and.returnValue(
      of({ subscribed: true, already_subscribed: false } as any),
    );
    markdown.render.and.returnValue('<p>Body</p>');
    auth.isAuthenticated.and.returnValue(false);
    auth.isAdmin.and.returnValue(false);
    auth.user.and.returnValue(null);

    routeParams$ = new Subject();
    routeQueryParams$ = new Subject();
    routeStub = {
      snapshot: { params: {}, queryParams: {} },
      params: routeParams$.asObservable(),
      queryParams: routeQueryParams$.asObservable(),
    };
  });

  function configure(opts: { withWindow?: boolean } = {}): void {
    if (opts.withWindow) {
      Object.defineProperty(doc, 'defaultView', { configurable: true, get: () => fakeWin });
    }
    TestBed.configureTestingModule({
      imports: [BlogPostComponent, TranslateModule.forRoot(), RouterTestingModule.withRoutes([])],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: BlogService, useValue: blog },
        { provide: AdminService, useValue: admin },
        { provide: CatalogService, useValue: catalog },
        { provide: NewsletterService, useValue: newsletter },
        { provide: ToastService, useValue: toast },
        { provide: MarkdownService, useValue: markdown },
        { provide: StorefrontAdminModeService, useValue: adminMode },
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: routeStub },
        { provide: DOCUMENT, useValue: doc },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { blog: { post: { metaTitle: 'Blog post' } } }, true);
    translate.use('en');
  }

  function create(): { fixture: ComponentFixture<BlogPostComponent>; cmp: any } {
    const fixture = TestBed.createComponent(BlogPostComponent);
    return { fixture, cmp: fixture.componentInstance as any };
  }

  // ---------------------------------------------------------------------------
  // ngOnInit / ngOnDestroy / load
  // ---------------------------------------------------------------------------

  it('initialises from route snapshot, subscribes to params/lang and registers window listeners', () => {
    routeStub.snapshot.params = { slug: 'snap' };
    routeStub.snapshot.queryParams = { preview: 'tok' };
    blog.getPreviewPost.and.returnValue(of({ ...basePost, slug: 'snap' }));
    configure({ withWindow: true });
    const { cmp } = create();

    cmp.ngOnInit();
    expect(blog.getPreviewPost).toHaveBeenCalledWith('snap', 'tok', 'en');
    expect(fakeWin.addEventListener).toHaveBeenCalledWith('scroll', jasmine.any(Function), {
      passive: true,
    });
    expect(fakeWin.addEventListener).toHaveBeenCalledWith('resize', jasmine.any(Function));

    // route re-emits (non-string preview => cleared)
    routeParams$.next({ slug: 'second' });
    routeQueryParams$.next({ preview: 123 });
    expect(cmp.isPreview()).toBe(false);
    expect(blog.getPost).toHaveBeenCalledWith('second', 'en');

    // lang change reloads
    blog.getPost.calls.reset();
    TestBed.inject(TranslateService).use('ro');
    expect(blog.getPost).toHaveBeenCalled();

    cmp.ngOnDestroy();
    expect(fakeWin.removeEventListener).toHaveBeenCalledWith('scroll', jasmine.any(Function));
    expect(fakeWin.removeEventListener).toHaveBeenCalledWith('resize', jasmine.any(Function));
  });

  it('ngOnInit/ngOnDestroy tolerate a missing defaultView and string preview snapshot', () => {
    routeStub.snapshot.params = { slug: 'snap' };
    routeStub.snapshot.queryParams = {};
    configure({ withWindow: false });
    const { cmp } = create();
    cmp.ngOnInit();
    expect(cmp.isPreview()).toBe(false);
    expect(() => cmp.ngOnDestroy()).not.toThrow();
  });

  it('load() is a no-op without a slug', () => {
    configure();
    const { cmp } = create();
    cmp.slug = '';
    cmp.load();
    expect(blog.getPost).not.toHaveBeenCalled();
  });

  it('load() success path renders body, neighbours, related and meta tags', () => {
    blog.getNeighbors.and.returnValue(
      of({ previous: { slug: 'p', title: 'Prev' } as any, next: null }),
    );
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.slug = 'first-post';
    cmp.previewToken = '';
    cmp.load();

    expect(cmp.post()?.title).toBe('Hello');
    expect(cmp.loadingPost()).toBe(false);
    expect(cmp.hasPostError()).toBe(false);
    expect(title.setTitle).toHaveBeenCalledWith('Hello | momentstudio');
    expect(cmp.neighbors().previous?.slug).toBe('p');
    expect(cmp.fallbackIntro()).toContain('Hello');
  });

  it('load() error path flips to error state and clears comments', () => {
    blog.getPost.and.returnValue(throwError(() => new Error('boom')));
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.slug = 'first-post';
    cmp.load();
    expect(cmp.hasPostError()).toBe(true);
    expect(cmp.post()).toBeNull();
    expect(cmp.bodyHtml()).toBe('');
    expect(meta.updateTag).toHaveBeenCalledWith(jasmine.objectContaining({ property: 'og:title' }));
  });

  it('load() uses preview endpoint and loads admin block when editing is enabled', () => {
    adminMode.enabled = () => true;
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.slug = 'first-post';
    cmp.previewToken = 'tok';
    cmp.load();
    expect(blog.getPreviewPost).toHaveBeenCalledWith('first-post', 'tok', 'en');
    expect(admin.getContent).toHaveBeenCalledWith('blog.first-post');
    expect(cmp.adminBlock()?.version).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // Pure helpers
  // ---------------------------------------------------------------------------

  it('focalPosition clamps and defaults', () => {
    configure();
    const { cmp } = create();
    expect(cmp.focalPosition(undefined, undefined)).toBe('50% 50%');
    expect(cmp.focalPosition(-10, 200)).toBe('0% 100%');
    expect(cmp.focalPosition(25, 75)).toBe('25% 75%');
  });

  it('coverImageClass switches on contain', () => {
    configure();
    const { cmp } = create();
    expect(cmp.coverImageClass('contain')).toContain('object-contain');
    expect(cmp.coverImageClass('cover')).toContain('object-cover');
  });

  it('activeLang resolves ro vs en', () => {
    configure();
    const { cmp } = create();
    expect(cmp.activeLang()).toBe('en');
    TestBed.inject(TranslateService).use('ro');
    expect(cmp.activeLang()).toBe('ro');
  });

  it('canEditBlog reflects storefront admin mode', () => {
    adminMode.enabled = () => true;
    configure();
    const { cmp } = create();
    expect(cmp.canEditBlog()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Computed author signals
  // ---------------------------------------------------------------------------

  it('author computed signals derive name/initials/bio/links', () => {
    configure();
    const { cmp } = create();

    cmp.post.set(null);
    expect(cmp.authorDisplayName()).toBe('');
    expect(cmp.authorInitials()).toBe('?');
    expect(cmp.authorBio()).toBe('');
    expect(cmp.authorLinks()).toEqual([]);

    cmp.post.set({ ...basePost, author: { id: 'a', username: 'jdoe' } } as any);
    expect(cmp.authorDisplayName()).toBe('jdoe');
    expect(cmp.authorInitials()).toBe('JD');

    cmp.post.set({ ...basePost, author_name: 'Jane Mary Doe' } as any);
    expect(cmp.authorInitials()).toBe('JD');

    cmp.post.set({
      ...basePost,
      author_name: 'Solo',
      meta: {
        author: {
          bio: 'Writer',
          links: [
            { label: ' Site ', url: ' https://x ' },
            { label: '', url: 'https://skip' },
            { label: 'NoUrl', url: '' },
            'bad',
          ],
        },
      },
    } as any);
    expect(cmp.authorBio()).toBe('Writer');
    expect(cmp.authorLinks()).toEqual([{ label: 'Site', url: 'https://x' }]);

    const bioObjPost = {
      ...basePost,
      author_name: 'Solo',
      meta: { author: { bio: { ro: 'RO', en: 'EN' } } },
    };
    cmp.post.set(bioObjPost as any);
    expect(cmp.authorBio()).toBe('EN');
    // computed only re-derives when a signal dep changes; switch lang then re-set
    TestBed.inject(TranslateService).use('ro');
    cmp.post.set({ ...bioObjPost } as any);
    expect(cmp.authorBio()).toBe('RO');
    TestBed.inject(TranslateService).use('en');

    cmp.post.set({
      ...basePost,
      author_name: 'Solo',
      meta: { author: { bio: 42, links: 'nope' } },
    } as any);
    expect(cmp.authorBio()).toBe('');
    expect(cmp.authorLinks()).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Quick edit
  // ---------------------------------------------------------------------------

  it('toggleQuickEdit loads the admin block on first open, then hydrates from state', () => {
    adminMode.enabled = () => true;
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';

    cmp.toggleQuickEdit();
    expect(cmp.quickEditOpen()).toBe(true);
    expect(admin.getContent).toHaveBeenCalled();

    admin.getContent.calls.reset();
    cmp.toggleQuickEdit(); // close
    expect(cmp.quickEditOpen()).toBe(false);

    cmp.adminBlock.set(makeBlock({ status: 'published' }));
    cmp.toggleQuickEdit(); // open with block present -> hydrate
    expect(cmp.quickEditStatus).toBe('published');
    expect(admin.getContent).not.toHaveBeenCalled();
  });

  it('resetQuickEdit re-hydrates form fields from current state', () => {
    configure();
    const { cmp } = create();
    cmp.post.set({ ...basePost, title: 'Title X', summary: 'Sum', tags: ['a', 'b'] });
    cmp.quickEditTitle = 'dirty';
    cmp.resetQuickEdit();
    expect(cmp.quickEditTitle).toBe('Title X');
    expect(cmp.quickEditTags).toBe('a, b');
  });

  it('saveQuickEdit returns early without slug or block', () => {
    configure();
    const { cmp } = create();
    cmp.slug = '';
    cmp.saveQuickEdit();
    cmp.slug = 'first-post';
    cmp.adminBlock.set(null);
    cmp.saveQuickEdit();
    expect(admin.updateContentBlock).not.toHaveBeenCalled();
  });

  it('saveQuickEdit with no changes just closes the panel', () => {
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    cmp.post.set({ ...basePost, title: 'Hello' });
    cmp.adminBlock.set(makeBlock({ status: 'draft', title: 'Hello' }));
    cmp.quickEditOpen.set(true);
    cmp.hydrateQuickEditFromState?.();
    cmp.quickEditStatus = 'draft';
    cmp.quickEditTitle = 'Hello';
    cmp.quickEditSummary = '';
    cmp.quickEditTags = '';
    cmp.quickEditPublishAt = '';
    cmp.quickEditUnpublishAt = '';
    cmp.saveQuickEdit();
    expect(admin.updateContentBlock).not.toHaveBeenCalled();
    expect(cmp.quickEditOpen()).toBe(false);
  });

  it('saveQuickEdit builds status/schedule/meta/title payloads and applies them on success', () => {
    const futureIso = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const block = makeBlock({
      status: 'draft',
      title: 'Old',
      published_at: futureIso,
      published_until: null,
      meta: { tags: ['old'], summary: { en: 'old summary' } },
      version: 9,
    });
    admin.updateContentBlock.and.returnValue(of({ ...block, version: 10 }));
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    cmp.post.set({ ...basePost, title: 'Old' });
    cmp.adminBlock.set(block);
    cmp.quickEditStatus = 'published';
    cmp.quickEditTitle = 'Brand New';
    cmp.quickEditSummary = 'fresh summary';
    cmp.quickEditTags = 'one, two, two';
    cmp.quickEditPublishAt = ''; // clear a future scheduled publish => publish now
    cmp.quickEditUnpublishAt = '2030-05-05T10:00';
    cmp.saveQuickEdit();

    const payloads = admin.updateContentBlock.calls.allArgs().map((a) => a[1]);
    const main = payloads.find((p: any) => p.status) as any;
    expect(main.status).toBe('published');
    expect(main.published_at).toBeNull();
    expect(main.published_until).not.toBeNull();
    expect(main.meta.tags).toEqual(['one', 'two']);
    expect(main.meta.summary.en).toBe('fresh summary');
    const titlePayload = payloads.find((p: any) => p.title) as any;
    expect(titlePayload.title).toBe('Brand New');
    expect(cmp.post()?.title).toBe('Brand New');
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.quickEditSaving()).toBe(false);
  });

  it('saveQuickEdit sets a new scheduled publish time and removes tags/summary when cleared', () => {
    const block = makeBlock({
      status: 'draft',
      title: 'Hello',
      meta: { tags: ['gone'], summary: { en: 'bye', ro: 'pa' } },
      version: 2,
    });
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    cmp.post.set({ ...basePost, title: 'Hello' });
    cmp.adminBlock.set(block);
    cmp.quickEditStatus = 'draft';
    cmp.quickEditTitle = 'Hello';
    cmp.quickEditPublishAt = '2031-01-02T08:30';
    cmp.quickEditUnpublishAt = '';
    cmp.quickEditTags = '';
    cmp.quickEditSummary = '';
    cmp.saveQuickEdit();
    const payload = admin.updateContentBlock.calls.mostRecent().args[1] as any;
    expect(payload.published_at).toContain('T');
    expect(payload.meta.tags).toBeUndefined();
    expect(payload.meta.summary.ro).toBe('pa');
    expect(payload.meta.summary.en).toBeUndefined();
  });

  it('saveQuickEdit creates a fresh summary object when none exists', () => {
    const block = makeBlock({ status: 'draft', title: 'Hello', meta: {}, version: 1 });
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    cmp.post.set({ ...basePost, title: 'Hello', summary: '' });
    cmp.adminBlock.set(block);
    cmp.quickEditStatus = 'draft';
    cmp.quickEditTitle = 'Hello';
    cmp.quickEditPublishAt = '';
    cmp.quickEditUnpublishAt = '';
    cmp.quickEditTags = '';
    cmp.quickEditSummary = 'brand new summary';
    cmp.saveQuickEdit();
    const payload = admin.updateContentBlock.calls.mostRecent().args[1] as any;
    expect(payload.meta.summary.en).toBe('brand new summary');
  });

  it('saveQuickEdit clears summary when meta.summary is a plain string', () => {
    const block = makeBlock({
      status: 'draft',
      title: 'Hello',
      meta: { summary: 'plain' },
      version: 1,
    });
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    cmp.post.set({ ...basePost, title: 'Hello', summary: 'plain' });
    cmp.adminBlock.set(block);
    cmp.quickEditStatus = 'draft';
    cmp.quickEditTitle = 'Hello';
    cmp.quickEditPublishAt = '';
    cmp.quickEditUnpublishAt = '';
    cmp.quickEditTags = '';
    cmp.quickEditSummary = '';
    cmp.saveQuickEdit();
    const payload = admin.updateContentBlock.calls.mostRecent().args[1] as any;
    expect(payload.meta.summary).toBeUndefined();
  });

  it('saveQuickEdit surfaces a server detail message on failure', () => {
    admin.updateContentBlock.and.returnValue(
      throwError(() => ({ error: { detail: '  too soon  ' } })),
    );
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    cmp.post.set({ ...basePost, title: 'Hello' });
    cmp.adminBlock.set(makeBlock({ status: 'draft', title: 'Hello' }));
    cmp.quickEditStatus = 'published';
    cmp.quickEditTitle = 'Hello';
    cmp.quickEditPublishAt = '';
    cmp.quickEditUnpublishAt = '';
    cmp.quickEditTags = '';
    cmp.quickEditSummary = '';
    cmp.saveQuickEdit();
    expect(cmp.quickEditError()).toBe('too soon');
    expect(toast.error).toHaveBeenCalled();
  });

  it('saveQuickEdit falls back to a generic error when detail is absent', () => {
    admin.updateContentBlock.and.returnValue(throwError(() => ({})));
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    cmp.post.set({ ...basePost, title: 'Hello' });
    cmp.adminBlock.set(makeBlock({ status: 'draft', title: 'Hello' }));
    cmp.quickEditStatus = 'published';
    cmp.quickEditTitle = 'Hello';
    cmp.quickEditPublishAt = '';
    cmp.quickEditUnpublishAt = '';
    cmp.quickEditTags = '';
    cmp.quickEditSummary = '';
    cmp.saveQuickEdit();
    expect(cmp.quickEditError()).toBeTruthy();
    expect(toast.error).toHaveBeenCalled();
  });

  it('editBlogPost navigates only with a slug', () => {
    configure();
    const { cmp } = create();
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigate').and.resolveTo(true);
    cmp.slug = '';
    cmp.editBlogPost();
    expect(nav).not.toHaveBeenCalled();
    cmp.slug = 'first-post';
    cmp.editBlogPost();
    expect(nav).toHaveBeenCalledWith(['/admin/content/blog'], {
      queryParams: { edit: 'first-post' },
    });
  });

  it('loadAdminBlock guards on slug/permission and records load failures', () => {
    adminMode.enabled = () => false;
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    cmp.loadAdminBlock();
    expect(admin.getContent).not.toHaveBeenCalled();

    adminMode.enabled = () => true;
    admin.getContent.and.returnValue(throwError(() => new Error('nope')));
    cmp.loadAdminBlock();
    expect(cmp.adminBlockError()).toBe(true);
    expect(cmp.adminBlock()).toBeNull();
  });

  it('hydrateQuickEditFromState is a no-op without post or block', () => {
    configure();
    const { cmp } = create();
    cmp.post.set(null);
    cmp.adminBlock.set(null);
    cmp.quickEditTitle = 'keep';
    cmp.hydrateQuickEditFromState();
    expect(cmp.quickEditTitle).toBe('keep');
  });

  it('hydrateQuickEditFromState falls back to meta tags when the post has none', () => {
    configure();
    const { cmp } = create();
    cmp.post.set({ ...basePost, tags: [] });
    cmp.adminBlock.set(
      makeBlock({ meta: { tags: ['x', 'y'] }, published_at: '2020-01-01T00:00:00Z' }),
    );
    cmp.hydrateQuickEditFromState();
    expect(cmp.quickEditTags).toBe('x, y');
    expect(cmp.quickEditPublishAt).toContain('T');
  });

  // ---------------------------------------------------------------------------
  // date / meta helpers
  // ---------------------------------------------------------------------------

  it('date helpers handle empty and invalid inputs', () => {
    configure();
    const { cmp } = create();
    expect(cmp.toDateTimeLocal('')).toBe('');
    expect(cmp.toDateTimeLocal('not-a-date')).toBe('');
    expect(cmp.toDateTimeLocal('2020-06-15T12:30:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(cmp.toIsoFromDateTimeLocal('')).toBeNull();
    expect(cmp.toIsoFromDateTimeLocal('garbage')).toBeNull();
    expect(cmp.toIsoFromDateTimeLocal('2020-06-15T12:30')).toContain('T');
    expect(cmp.isFutureIso(null)).toBe(false);
    expect(cmp.isFutureIso('garbage')).toBe(false);
    expect(cmp.isFutureIso(new Date(Date.now() + 100000).toISOString())).toBe(true);
    expect(cmp.isFutureIso('2000-01-01T00:00:00Z')).toBe(false);
  });

  it('cloneMeta returns a copy, an empty object, or a shallow spread on cyclic input', () => {
    configure();
    const { cmp } = create();
    expect(cmp.cloneMeta(null)).toEqual({});
    expect(cmp.cloneMeta({ a: 1 })).toEqual({ a: 1 });
    const cyclic: any = { a: 1 };
    cyclic.self = cyclic;
    const cloned = cmp.cloneMeta(cyclic);
    expect(cloned.a).toBe(1);
  });

  it('normalizeTags handles arrays, strings, dedupe and rubbish', () => {
    configure();
    const { cmp } = create();
    expect(cmp.normalizeTags(null)).toEqual([]);
    expect(cmp.normalizeTags(123)).toEqual([]);
    expect(cmp.normalizeTags(['A', 'a', ' b ', ''])).toEqual(['A', 'b']);
    expect(cmp.normalizeTagsInput('x, X , , y')).toEqual(['x', 'y']);
  });

  it('sameStringSet compares case-insensitively', () => {
    configure();
    const { cmp } = create();
    expect(cmp.sameStringSet(['a'], ['a', 'b'])).toBe(false);
    expect(cmp.sameStringSet(['A', 'b'], ['b', 'a'])).toBe(true);
    expect(cmp.sameStringSet(['a'], ['c'])).toBe(false);
  });

  it('getMetaSummary reads strings, locale objects, and missing values', () => {
    configure();
    const { cmp } = create();
    expect(cmp.getMetaSummary({}, 'en')).toBe('');
    expect(cmp.getMetaSummary({ summary: ' hi ' }, 'en')).toBe('hi');
    expect(cmp.getMetaSummary({ summary: { en: ' E ' } }, 'en')).toBe('E');
    expect(cmp.getMetaSummary({ summary: { ro: 'R' } }, 'en')).toBe('');
  });

  // ---------------------------------------------------------------------------
  // neighbours / related / more-from-author
  // ---------------------------------------------------------------------------

  it('loadNeighbors guards on slug and recovers from errors', () => {
    configure();
    const { cmp } = create();
    cmp.slug = '';
    cmp.loadNeighbors('en');
    expect(blog.getNeighbors).not.toHaveBeenCalled();
    cmp.slug = 'first-post';
    blog.getNeighbors.and.returnValue(throwError(() => new Error('x')));
    cmp.loadNeighbors('en');
    expect(cmp.neighbors()).toEqual({ previous: null, next: null });
  });

  it('loadRelatedPosts short-circuits without series/tags and scores otherwise', () => {
    configure();
    const { cmp } = create();
    cmp.loadRelatedPosts('en', { ...basePost, series: '', tags: [] });
    expect(blog.listPosts).not.toHaveBeenCalled();

    blog.listPosts.and.returnValue(
      of({
        items: [
          { slug: 'first-post', title: 'self', tags: ['t1'] },
          { slug: 'a', title: 'A', series: 'S', tags: ['t1'], published_at: '2020-01-01' },
          { slug: 'b', title: 'B', tags: ['t1', 't2'], published_at: '2021-01-01' },
          { slug: 'c', title: 'C', tags: ['nope'] },
        ] as any,
        meta: { total_items: 4, total_pages: 1, page: 1, limit: 50 },
      }),
    );
    cmp.loadRelatedPosts('en', { ...basePost, series: 'S', tags: ['t1', 't2'] });
    const slugs = cmp.relatedPosts().map((p: any) => p.slug);
    expect(slugs).toEqual(['a', 'b']);
  });

  it('loadRelatedPosts recovers from errors', () => {
    configure();
    const { cmp } = create();
    blog.listPosts.and.returnValue(throwError(() => new Error('x')));
    cmp.loadRelatedPosts('en', { ...basePost, tags: ['t1'] });
    expect(cmp.relatedPosts()).toEqual([]);
  });

  it('loadMoreFromAuthor needs an author id and filters the current post out', () => {
    configure();
    const { cmp } = create();
    cmp.loadMoreFromAuthor('en', { ...basePost, author: null });
    expect(cmp.moreFromAuthor()).toEqual([]);
    expect(cmp.loadingMoreFromAuthor()).toBe(false);

    blog.listPosts.and.returnValue(
      of({
        items: [
          { slug: 'first-post', title: 'self' },
          { slug: 'x', title: 'X' },
        ] as any,
        meta: { total_items: 2, total_pages: 1, page: 1, limit: 8 },
      }),
    );
    cmp.loadMoreFromAuthor('en', { ...basePost, author: { id: 'a1' } });
    expect(cmp.moreFromAuthor().map((p: any) => p.slug)).toEqual(['x']);
  });

  it('loadMoreFromAuthor recovers from errors', () => {
    configure();
    const { cmp } = create();
    blog.listPosts.and.returnValue(throwError(() => new Error('x')));
    cmp.loadMoreFromAuthor('en', { ...basePost, author: { id: 'a1' } });
    expect(cmp.moreFromAuthor()).toEqual([]);
    expect(cmp.loadingMoreFromAuthor()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // scrolling / headings
  // ---------------------------------------------------------------------------

  it('scrollToTop is guarded and scrolls smoothly when a window exists', () => {
    configure({ withWindow: false });
    const a = create();
    a.cmp.scrollToTop();
    TestBed.resetTestingModule();

    configure({ withWindow: true });
    const b = create();
    b.cmp.scrollToTop();
    expect(fakeWin.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('scrollToHeading prevents default, guards window/target, and updates history + active id', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    const evt = { preventDefault: jasmine.createSpy('pd') } as any;

    cmp.scrollToHeading(evt, 'missing');
    expect(evt.preventDefault).toHaveBeenCalled();
    expect(fakeWin.scrollTo).not.toHaveBeenCalled();

    const h = doc.createElement('h2');
    h.id = 'sec';
    doc.body.appendChild(h);
    cmp.scrollToHeading(evt, 'sec');
    expect(fakeWin.scrollTo).toHaveBeenCalled();
    expect(fakeWin.history.replaceState).toHaveBeenCalled();
    expect(cmp.activeHeadingId()).toBe('sec');
  });

  it('scrollToHeading returns when there is no window', () => {
    configure({ withWindow: false });
    const { cmp } = create();
    const evt = { preventDefault: jasmine.createSpy('pd') } as any;
    cmp.scrollToHeading(evt, 'x');
    expect(evt.preventDefault).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // article click handling
  // ---------------------------------------------------------------------------

  it('handleArticleClick routes internal links and ignores modified clicks', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigateByUrl').and.resolveTo(true);

    const link = doc.createElement('a');
    link.setAttribute('data-router-link', '/shop');
    doc.body.appendChild(link);

    cmp.handleArticleClick({
      target: link,
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() {},
      stopPropagation() {},
    } as any);
    expect(nav).toHaveBeenCalledWith('/shop');

    nav.calls.reset();
    cmp.handleArticleClick({
      target: link,
      defaultPrevented: false,
      button: 0,
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() {},
      stopPropagation() {},
    } as any);
    expect(nav).not.toHaveBeenCalled();
  });

  it('handleArticleClick copies and wraps code blocks', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    const copySpy = spyOn<any>(cmp, 'copyCode');

    const wrapper = doc.createElement('div');
    wrapper.className = 'blog-codeblock';
    wrapper.innerHTML =
      '<pre><code>const x = 1;\n</code></pre>' +
      '<button data-code-action="copy">copy</button>' +
      '<button data-code-action="wrap" data-wrap-label="W" data-unwrap-label="U">W</button>';
    doc.body.appendChild(wrapper);
    const [copyBtn, wrapBtn] = Array.from(wrapper.querySelectorAll('button'));

    cmp.handleArticleClick({
      target: copyBtn,
      preventDefault() {},
      stopPropagation() {},
    } as any);
    expect(copySpy).toHaveBeenCalledWith('const x = 1;');

    cmp.handleArticleClick({
      target: wrapBtn,
      preventDefault() {},
      stopPropagation() {},
    } as any);
    expect(wrapper.classList.contains('blog-codeblock--wrap')).toBe(true);
    expect(wrapBtn.textContent).toBe('U');
  });

  it('handleArticleClick copy ignores empty code and wrap falls back to translations', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    const copySpy = spyOn<any>(cmp, 'copyCode');
    const wrapper = doc.createElement('div');
    wrapper.className = 'blog-codeblock';
    wrapper.innerHTML =
      '<pre><code>   </code></pre>' +
      '<button data-code-action="copy">copy</button>' +
      '<button data-code-action="wrap">W</button>' +
      '<button data-code-action="">noop</button>';
    doc.body.appendChild(wrapper);
    const btns = Array.from(wrapper.querySelectorAll('button'));
    cmp.handleArticleClick({ target: btns[0], preventDefault() {}, stopPropagation() {} } as any);
    expect(copySpy).not.toHaveBeenCalled();
    cmp.handleArticleClick({ target: btns[1], preventDefault() {}, stopPropagation() {} } as any);
    expect(btns[1].textContent).toBe('blog.post.code.unwrap');
    // action present but no wrapper -> early return branch
    const orphan = doc.createElement('button');
    orphan.setAttribute('data-code-action', 'copy');
    doc.body.appendChild(orphan);
    expect(() =>
      cmp.handleArticleClick({ target: orphan, preventDefault() {}, stopPropagation() {} } as any),
    ).not.toThrow();
  });

  it('handleArticleClick opens the lightbox for gallery images and ignores others', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    const open = spyOn<any>(cmp, 'openLightbox');

    // no img target
    cmp.handleArticleClick({
      target: doc.createElement('span'),
      preventDefault() {},
      stopPropagation() {},
    } as any);
    expect(open).not.toHaveBeenCalled();

    const img = doc.createElement('img');
    img.src = 'https://img/one.png';
    doc.body.appendChild(img);

    // images empty
    cmp.galleryImages.set([]);
    cmp.handleArticleClick({ target: img, preventDefault() {}, stopPropagation() {} } as any);
    expect(open).not.toHaveBeenCalled();

    // src not in gallery
    cmp.galleryImages.set([{ src: 'https://img/other.png', alt: '' }]);
    cmp.handleArticleClick({ target: img, preventDefault() {}, stopPropagation() {} } as any);
    expect(open).not.toHaveBeenCalled();

    // matching src
    cmp.galleryImages.set([{ src: 'https://img/one.png', alt: 'x' }]);
    cmp.handleArticleClick({ target: img, preventDefault() {}, stopPropagation() {} } as any);
    expect(open).toHaveBeenCalledWith(0);
  });

  it('handleArticleClick ignores an image with no resolvable src', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    const open = spyOn<any>(cmp, 'openLightbox');
    const img = doc.createElement('img');
    cmp.galleryImages.set([{ src: 'x', alt: '' }]);
    cmp.handleArticleClick({ target: img, preventDefault() {}, stopPropagation() {} } as any);
    expect(open).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // copyCode
  // ---------------------------------------------------------------------------

  it('copyCode is guarded without a window', () => {
    configure({ withWindow: false });
    const { cmp } = create();
    expect(() => cmp.copyCode('x')).not.toThrow();
  });

  it('copyCode uses the async clipboard when available', async () => {
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.copyCode('hello');
    await Promise.resolve();
    expect(fakeWin.navigator.clipboard.writeText).toHaveBeenCalledWith('hello');
    expect(toast.success).toHaveBeenCalled();
  });

  it('copyCode reports clipboard rejection', async () => {
    fakeWin.navigator.clipboard.writeText.and.returnValue(Promise.reject(new Error('no')));
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.copyCode('hello');
    await Promise.resolve();
    await Promise.resolve();
    expect(toast.error).toHaveBeenCalled();
  });

  it('copyCode falls back to execCommand (success and failure)', () => {
    fakeWin.navigator.clipboard = undefined;
    configure({ withWindow: true });
    const { cmp } = create();
    const exec = spyOn(doc, 'execCommand').and.returnValue(true);
    cmp.copyCode('a');
    expect(toast.success).toHaveBeenCalled();
    exec.and.returnValue(false);
    cmp.copyCode('b');
    expect(toast.error).toHaveBeenCalled();
  });

  it('copyCode reports a thrown fallback error', () => {
    fakeWin.navigator.clipboard = undefined;
    configure({ withWindow: true });
    const { cmp } = create();
    spyOn(doc, 'execCommand').and.throwError('boom');
    cmp.copyCode('a');
    expect(toast.error).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // lightbox
  // ---------------------------------------------------------------------------

  it('lightbox open/close/navigation manage state and body overflow', () => {
    configure({ withWindow: true });
    const { cmp } = create();

    cmp.openLightbox(0); // no images -> no-op
    expect(cmp.lightboxIndex()).toBeNull();

    cmp.galleryImages.set([
      { src: 'a', alt: 'A' },
      { src: 'b', alt: 'B' },
      { src: 'c', alt: 'C' },
    ]);
    cmp.openLightbox(5); // clamps to last
    expect(cmp.lightboxIndex()).toBe(2);
    expect(cmp.lightboxImage()?.src).toBe('c');
    expect(cmp.lightboxOpen()).toBe(true);
    expect(doc.body.style.overflow).toBe('hidden');
    expect(fakeWin.addEventListener).toHaveBeenCalledWith('keydown', jasmine.any(Function));

    cmp.nextLightbox({ stopPropagation() {} } as any);
    expect(cmp.lightboxIndex()).toBe(0);
    cmp.prevLightbox({ stopPropagation() {} } as any);
    expect(cmp.lightboxIndex()).toBe(2);

    cmp.closeLightbox();
    expect(cmp.lightboxIndex()).toBeNull();
    expect(fakeWin.removeEventListener).toHaveBeenCalledWith('keydown', jasmine.any(Function));
  });

  it('lightbox image computed returns null for an out-of-range index', () => {
    configure();
    const { cmp } = create();
    cmp.galleryImages.set([{ src: 'a', alt: '' }]);
    cmp.lightboxIndex.set(9);
    expect(cmp.lightboxImage()).toBeNull();
    expect(cmp.lightboxOpen()).toBe(false);
  });

  it('next/prev lightbox are no-ops with fewer than two images or no index', () => {
    configure();
    const { cmp } = create();
    cmp.galleryImages.set([{ src: 'a', alt: '' }]);
    cmp.lightboxIndex.set(0);
    cmp.nextLightbox();
    cmp.prevLightbox();
    expect(cmp.lightboxIndex()).toBe(0);
    cmp.lightboxIndex.set(null);
    cmp.galleryImages.set([
      { src: 'a', alt: '' },
      { src: 'b', alt: '' },
    ]);
    cmp.nextLightbox();
    expect(cmp.lightboxIndex()).toBeNull();
  });

  it('the keydown listener drives lightbox navigation', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.galleryImages.set([
      { src: 'a', alt: '' },
      { src: 'b', alt: '' },
    ]);
    cmp.openLightbox(0);
    const listener = cmp.lightboxKeyListener as (e: KeyboardEvent) => void;

    const make = (key: string) => ({ key, preventDefault: jasmine.createSpy('pd') }) as any;
    const right = make('ArrowRight');
    listener(right);
    expect(cmp.lightboxIndex()).toBe(1);
    const left = make('ArrowLeft');
    listener(left);
    expect(cmp.lightboxIndex()).toBe(0);
    const other = make('Enter');
    listener(other);
    expect(other.preventDefault).not.toHaveBeenCalled();
    const esc = make('Escape');
    listener(esc);
    expect(cmp.lightboxIndex()).toBeNull();
    // closed -> listener returns immediately
    const after = make('ArrowRight');
    listener(after);
    expect(after.preventDefault).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // sharing
  // ---------------------------------------------------------------------------

  it('copyShareLink is guarded and copies via clipboard', async () => {
    configure({ withWindow: false });
    const guarded = create();
    guarded.cmp.copyShareLink();
    TestBed.resetTestingModule();

    configure({ withWindow: true });
    const { cmp } = create();
    cmp.slug = 'first-post';
    cmp.copyShareLink();
    await Promise.resolve();
    expect(fakeWin.navigator.clipboard.writeText).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it('copyShareLink returns when no url can be built', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.slug = '';
    cmp.copyShareLink();
    expect(fakeWin.navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('copyShareLink reports a clipboard rejection', async () => {
    fakeWin.navigator.clipboard.writeText.and.returnValue(Promise.reject(new Error('no')));
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.slug = 'first-post';
    cmp.copyShareLink();
    await Promise.resolve();
    await Promise.resolve();
    expect(toast.error).toHaveBeenCalled();
  });

  it('copyShareLink falls back to execCommand (ok, fail and throw)', () => {
    fakeWin.navigator.clipboard = undefined;
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.slug = 'first-post';
    const exec = spyOn(doc, 'execCommand').and.returnValue(true);
    cmp.copyShareLink();
    expect(toast.success).toHaveBeenCalled();
    exec.and.returnValue(false);
    cmp.copyShareLink();
    expect(toast.error).toHaveBeenCalledTimes(1);
    exec.and.throwError('boom');
    cmp.copyShareLink();
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it('shareWhatsApp and shareFacebook open share intents with guards', () => {
    configure({ withWindow: false });
    const guarded = create();
    guarded.cmp.shareWhatsApp();
    guarded.cmp.shareFacebook();
    TestBed.resetTestingModule();

    configure({ withWindow: true });
    const { cmp } = create();
    cmp.slug = '';
    cmp.shareWhatsApp();
    cmp.shareFacebook();
    expect(fakeWin.open).not.toHaveBeenCalled();

    cmp.slug = 'first-post';
    cmp.post.set({ ...basePost, title: 'Hello' });
    cmp.shareWhatsApp();
    expect(fakeWin.open.calls.mostRecent().args[0]).toContain('https://wa.me');

    cmp.post.set({ ...basePost, title: '' });
    cmp.shareWhatsApp();
    cmp.shareFacebook();
    expect(fakeWin.open.calls.mostRecent().args[0]).toContain('facebook.com');
  });

  // ---------------------------------------------------------------------------
  // comments
  // ---------------------------------------------------------------------------

  it('loadComments guards, normalises sort/page and flattens threads', () => {
    configure();
    const { cmp } = create();
    cmp.slug = '';
    cmp.loadComments();
    expect(blog.listCommentThreads).not.toHaveBeenCalled();

    cmp.slug = 'first-post';
    blog.listCommentThreads.and.returnValue(
      of({
        items: [
          {
            root: makeComment({ id: 'r1' }),
            replies: [makeComment({ id: 'rep1', parent_id: 'r1' })],
          },
          { root: makeComment({ id: 'r2' }), replies: null as any },
        ],
        meta: { total_items: 2, total_pages: 3, page: 1, limit: 10 },
        total_comments: 5,
      }),
    );
    cmp.loadComments({ sort: 'bogus' as any, page: -2 });
    expect(cmp.commentSort()).toBe('newest');
    expect(cmp.commentPage()).toBe(1);
    expect(cmp.comments().length).toBe(3);
    expect(cmp.commentsTotal()).toBe(5);
  });

  it('loadComments records errors', () => {
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    blog.listCommentThreads.and.returnValue(throwError(() => new Error('x')));
    cmp.loadComments({ sort: 'top' });
    expect(cmp.hasCommentsError()).toBe(true);
    expect(cmp.comments()).toEqual([]);
  });

  it('loadCommentSubscription depends on auth state', () => {
    configure();
    const { cmp } = create();
    cmp.slug = '';
    cmp.loadCommentSubscription();
    expect(blog.getCommentSubscription).not.toHaveBeenCalled();

    cmp.slug = 'first-post';
    auth.isAuthenticated.and.returnValue(false);
    cmp.loadCommentSubscription();
    expect(cmp.commentSubscribed()).toBe(false);

    auth.isAuthenticated.and.returnValue(true);
    blog.getCommentSubscription.and.returnValue(of({ enabled: true }));
    cmp.loadCommentSubscription();
    expect(cmp.commentSubscribed()).toBe(true);

    blog.getCommentSubscription.and.returnValue(throwError(() => new Error('x')));
    cmp.loadCommentSubscription();
    expect(cmp.commentSubscribed()).toBe(false);
    expect(cmp.commentSubscriptionLoading()).toBe(false);
  });

  it('canSubscribeToComments requires a verified, authenticated user', () => {
    configure();
    const { cmp } = create();
    auth.isAuthenticated.and.returnValue(false);
    expect(cmp.canSubscribeToComments()).toBe(false);
    auth.isAuthenticated.and.returnValue(true);
    auth.user.and.returnValue({ id: 'u', email_verified: false } as any);
    expect(cmp.canSubscribeToComments()).toBe(false);
    auth.user.and.returnValue({ id: 'u', email_verified: true } as any);
    expect(cmp.canSubscribeToComments()).toBe(true);
  });

  it('toggleCommentSubscription handles guards, verification, success and failure', () => {
    configure();
    const { cmp } = create();
    const target = { checked: true } as HTMLInputElement;

    // not authenticated
    auth.isAuthenticated.and.returnValue(false);
    cmp.slug = 'first-post';
    cmp.toggleCommentSubscription({ target } as any);
    expect(blog.setCommentSubscription).not.toHaveBeenCalled();

    // authenticated but unverified
    auth.isAuthenticated.and.returnValue(true);
    auth.user.and.returnValue({ id: 'u', email_verified: false } as any);
    cmp.commentSubscribed.set(false);
    cmp.toggleCommentSubscription({ target } as any);
    expect(toast.error).toHaveBeenCalled();
    expect(target.checked).toBe(false);

    // verified -> success enabled
    auth.user.and.returnValue({ id: 'u', email_verified: true } as any);
    blog.setCommentSubscription.and.returnValue(of({ enabled: true }));
    cmp.toggleCommentSubscription({ target: { checked: true } as HTMLInputElement } as any);
    expect(cmp.commentSubscribed()).toBe(true);

    // success disabled
    blog.setCommentSubscription.and.returnValue(of({ enabled: false }));
    cmp.toggleCommentSubscription({ target: { checked: false } as HTMLInputElement } as any);
    expect(cmp.commentSubscribed()).toBe(false);

    // error reverts
    const revertTarget = { checked: true } as HTMLInputElement;
    cmp.commentSubscribed.set(false);
    blog.setCommentSubscription.and.returnValue(throwError(() => new Error('x')));
    cmp.toggleCommentSubscription({ target: revertTarget } as any);
    expect(revertTarget.checked).toBe(false);
    expect(cmp.commentSubscribed()).toBe(false);
  });

  it('toggleCommentSubscription returns without a slug', () => {
    configure();
    const { cmp } = create();
    auth.isAuthenticated.and.returnValue(true);
    cmp.slug = '';
    cmp.toggleCommentSubscription({ target: { checked: true } } as any);
    expect(blog.setCommentSubscription).not.toHaveBeenCalled();
  });

  it('setCommentSort ignores invalid and unchanged values, reloads on change', () => {
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    const load = spyOn(cmp, 'loadComments').and.stub();
    cmp.setCommentSort('bogus');
    cmp.setCommentSort('');
    cmp.setCommentSort('newest'); // unchanged
    expect(load).not.toHaveBeenCalled();
    cmp.setCommentSort('oldest');
    expect(load).toHaveBeenCalledWith({ page: 1, sort: 'oldest' });
  });

  it('goToCommentsPage clamps to total pages and skips unchanged pages', () => {
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    const load = spyOn(cmp, 'loadComments').and.stub();
    cmp.commentsMeta.set({ total_items: 30, total_pages: 3, page: 1, limit: 10 });
    cmp.commentPage.set(1);
    cmp.goToCommentsPage(99);
    expect(load).toHaveBeenCalledWith({ page: 3 });
    load.calls.reset();
    cmp.commentPage.set(2);
    cmp.goToCommentsPage(2);
    expect(load).not.toHaveBeenCalled();
  });

  it('goToCommentsPage works without pagination meta', () => {
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    const load = spyOn(cmp, 'loadComments').and.callThrough();
    cmp.commentsMeta.set(null);
    cmp.commentPage.set(1);
    cmp.goToCommentsPage(4);
    expect(load).toHaveBeenCalledWith({ page: 4 });
  });

  it('rootComments / replies partition by parent id', () => {
    configure();
    const { cmp } = create();
    cmp.comments.set([
      makeComment({ id: 'r', parent_id: null }),
      makeComment({ id: 'c', parent_id: 'r' }),
    ]);
    expect(cmp.rootComments().map((c: any) => c.id)).toEqual(['r']);
    expect(cmp.replies('r').map((c: any) => c.id)).toEqual(['c']);
  });

  it('canDelete / canReply / canFlag enforce permissions', () => {
    configure();
    const { cmp } = create();
    const mine = makeComment({ author: { id: 'me' } });
    const others = makeComment({ author: { id: 'other' } });

    auth.isAuthenticated.and.returnValue(false);
    expect(cmp.canDelete(mine)).toBe(false);
    expect(cmp.canReply(mine)).toBe(false);
    expect(cmp.canFlag(mine)).toBe(false);

    auth.isAuthenticated.and.returnValue(true);
    expect(cmp.canDelete(makeComment({ is_deleted: true }))).toBe(false);
    auth.user.and.returnValue(null);
    expect(cmp.canDelete(mine)).toBe(false);
    expect(cmp.canFlag(mine)).toBe(false);

    auth.user.and.returnValue({ id: 'me' } as any);
    auth.isAdmin.and.returnValue(false);
    expect(cmp.canDelete(mine)).toBe(true);
    expect(cmp.canDelete(others)).toBe(false);
    auth.isAdmin.and.returnValue(true);
    expect(cmp.canDelete(others)).toBe(true);

    expect(cmp.canReply(makeComment({ is_deleted: true }))).toBe(false);
    expect(cmp.canReply(mine)).toBe(true);

    expect(cmp.canFlag(makeComment({ author: { id: 'other' }, is_hidden: true }))).toBe(false);
    expect(cmp.canFlag(others)).toBe(true);
    expect(cmp.canFlag(mine)).toBe(false);
  });

  it('startReply / cancelReply manage the reply target', () => {
    configure();
    const { cmp } = create();
    const c = makeComment();
    cmp.startReply(c);
    expect(cmp.replyTo()).toBe(c);
    cmp.cancelReply();
    expect(cmp.replyTo()).toBeNull();
  });

  it('authorLabel formats identities with a fallback', () => {
    configure();
    const { cmp } = create();
    expect(cmp.authorLabel(null)).toBe('blog.comments.anonymous');
    expect(cmp.authorLabel({ name: 'Bob', username: 'bob' })).toBe('Bob (bob)');
  });

  // ---------------------------------------------------------------------------
  // submitComment
  // ---------------------------------------------------------------------------

  it('submitComment guards on slug/auth/body and captcha', () => {
    configure();
    const { cmp } = create();
    cmp.slug = '';
    cmp.submitComment({ preventDefault() {} } as any);
    expect(blog.createComment).not.toHaveBeenCalled();

    cmp.slug = 'first-post';
    auth.isAuthenticated.and.returnValue(false);
    cmp.submitComment();
    expect(blog.createComment).not.toHaveBeenCalled();

    auth.isAuthenticated.and.returnValue(true);
    cmp.commentBody = '   ';
    cmp.submitComment();
    expect(blog.createComment).not.toHaveBeenCalled();

    cmp.commentBody = 'hi';
    cmp.captchaEnabled = true;
    cmp.commentCaptchaToken = null;
    cmp.submitComment();
    expect(blog.createComment).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('submitComment posts a root comment and resets pagination by sort', () => {
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    auth.isAuthenticated.and.returnValue(true);
    cmp.commentBody = 'hello';
    cmp.captchaEnabled = false;
    const load = spyOn(cmp, 'loadComments').and.stub();

    cmp.commentSort.set('oldest');
    cmp.commentsMeta.set({ total_items: 25, total_pages: 3, page: 1, limit: 10 });
    cmp.submitComment();
    expect(cmp.commentPage()).toBe(3);

    cmp.commentBody = 'again';
    cmp.commentSort.set('top');
    cmp.submitComment();
    expect(cmp.commentSort()).toBe('newest');
    expect(cmp.commentPage()).toBe(1);

    cmp.commentBody = 'third';
    cmp.commentSort.set('newest');
    cmp.commentPage.set(4);
    cmp.submitComment();
    expect(cmp.commentPage()).toBe(1);
    expect(load).toHaveBeenCalled();
  });

  it('submitComment posts a reply without touching pagination', () => {
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    auth.isAuthenticated.and.returnValue(true);
    cmp.commentBody = 'reply';
    cmp.replyTo.set(makeComment({ id: 'parent' }));
    spyOn(cmp, 'loadComments').and.stub();
    cmp.commentPage.set(7);
    cmp.submitComment();
    expect(cmp.commentPage()).toBe(7);
    expect(cmp.replyTo()).toBeNull();
    expect(blog.createComment).toHaveBeenCalledWith('first-post', {
      body: 'reply',
      parent_id: 'parent',
      captcha_token: null,
    });
  });

  it('submitComment maps error responses to toasts', () => {
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    auth.isAuthenticated.and.returnValue(true);
    const setError = (err: any) => blog.createComment.and.returnValue(throwError(() => err));

    setError({ status: 429 });
    cmp.commentBody = 'a';
    cmp.submitComment();

    setError({ status: 400, error: { detail: 'too many links here' } });
    cmp.commentBody = 'b';
    cmp.submitComment();

    setError({ status: 400, error: { detail: 'captcha required' } });
    cmp.commentBody = 'c';
    cmp.submitComment();

    setError({ status: 400, error: { detail: 'captcha invalid' } });
    cmp.commentBody = 'd';
    cmp.submitComment();

    setError({ status: 400, error: { detail: 'something else entirely' } });
    cmp.commentBody = 'e';
    cmp.submitComment();

    setError({ status: 500 });
    cmp.commentBody = 'f';
    cmp.submitComment();

    setError({});
    cmp.commentBody = 'g';
    cmp.submitComment();

    expect(toast.error).toHaveBeenCalledTimes(7);
    expect(cmp.submitting()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // newsletter
  // ---------------------------------------------------------------------------

  it('submitNewsletter guards on email and captcha, then reports success states', () => {
    configure();
    const { cmp } = create();
    cmp.newsletterEmail = '   ';
    cmp.submitNewsletter({ preventDefault() {} } as any);
    expect(newsletter.subscribe).not.toHaveBeenCalled();

    cmp.newsletterEmail = 'a@b.co';
    cmp.captchaEnabled = true;
    cmp.newsletterCaptchaToken = null;
    cmp.submitNewsletter();
    expect(newsletter.subscribe).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);

    cmp.captchaEnabled = false;
    newsletter.subscribe.and.returnValue(
      of({ subscribed: true, already_subscribed: false } as any),
    );
    cmp.submitNewsletter();
    expect(cmp.newsletterSubscribed()).toBe(true);
    expect(cmp.newsletterAlreadySubscribed()).toBe(false);

    newsletter.subscribe.and.returnValue(of({ subscribed: true, already_subscribed: true } as any));
    cmp.submitNewsletter();
    expect(cmp.newsletterAlreadySubscribed()).toBe(true);
  });

  it('submitNewsletter reports subscription failures', () => {
    configure();
    const { cmp } = create();
    cmp.newsletterEmail = 'a@b.co';
    cmp.captchaEnabled = false;
    newsletter.subscribe.and.returnValue(throwError(() => new Error('x')));
    cmp.submitNewsletter();
    expect(cmp.newsletterLoading()).toBe(false);
    expect(toast.error).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // delete / flag
  // ---------------------------------------------------------------------------

  it('deleteComment respects permission, confirmation and errors', () => {
    configure();
    const { cmp } = create();
    auth.isAuthenticated.and.returnValue(true);
    auth.user.and.returnValue({ id: 'me' } as any);
    const mine = makeComment({ author: { id: 'me' } });

    // permission denied (not mine, not admin)
    expect(cmp.deleteComment(makeComment({ author: { id: 'x' } }))).toBeUndefined();
    expect(blog.deleteComment).not.toHaveBeenCalled();

    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    cmp.deleteComment(mine);
    expect(blog.deleteComment).not.toHaveBeenCalled();

    confirmSpy.and.returnValue(true);
    const load = spyOn(cmp, 'loadComments').and.stub();
    cmp.deleteComment(mine);
    expect(load).toHaveBeenCalled();

    blog.deleteComment.and.returnValue(throwError(() => new Error('x')));
    cmp.deleteComment(mine);
    expect(toast.error).toHaveBeenCalled();
  });

  it('flagComment respects permission, prompt and errors', () => {
    configure();
    const { cmp } = create();
    auth.isAuthenticated.and.returnValue(true);
    auth.user.and.returnValue({ id: 'me' } as any);
    const others = makeComment({ author: { id: 'other' } });

    expect(cmp.flagComment(makeComment({ author: { id: 'me' } }))).toBeUndefined();
    expect(blog.flagComment).not.toHaveBeenCalled();

    const promptSpy = spyOn(window, 'prompt').and.returnValue('  spam  ');
    cmp.flagComment(others);
    expect(blog.flagComment).toHaveBeenCalledWith('c1', { reason: 'spam' });
    expect(toast.success).toHaveBeenCalled();

    promptSpy.and.returnValue(null);
    blog.flagComment.and.returnValue(of({ id: 'f', user_id: 'u', reason: null, created_at: 'x' }));
    cmp.flagComment(others);
    expect(blog.flagComment).toHaveBeenCalledWith('c1', { reason: null });

    blog.flagComment.and.returnValue(throwError(() => new Error('x')));
    cmp.flagComment(others);
    expect(toast.error).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // SEO + reading progress
  // ---------------------------------------------------------------------------

  it('setCanonical returns an empty string without a slug', () => {
    configure();
    const { cmp } = create();
    cmp.slug = '';
    expect(cmp.setCanonical()).toBe('');
  });

  it('hasMeaningfulArticleText measures stripped text length', () => {
    configure();
    const { cmp } = create();
    cmp.bodyHtml.set('<p>short</p>');
    expect(cmp.hasMeaningfulArticleText()).toBe(false);
    cmp.bodyHtml.set('<p>' + 'word '.repeat(40) + '</p>');
    expect(cmp.hasMeaningfulArticleText()).toBe(true);
  });

  it('measureReadingProgressSoon is guarded and otherwise schedules a measure', () => {
    configure({ withWindow: false });
    const guarded = create();
    guarded.cmp.measureReadingProgressSoon();
    TestBed.resetTestingModule();

    configure({ withWindow: true });
    const { cmp } = create();
    cmp.measureReadingProgressSoon();
    expect(fakeWin.requestAnimationFrame).toHaveBeenCalled();
  });

  it('measureReadingProgress is guarded and computes gallery + headings', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.measureReadingProgress(); // no element -> early return

    const el = doc.createElement('div');
    el.innerHTML =
      '<h2 id="a">A</h2><h3 id="b">B</h3>' +
      '<img src="https://i/1.png">' +
      '<img src="https://i/1.png">' +
      '<div class="blog-embed"><img src="https://i/embed.png"></div>' +
      '<img>';
    cmp.articleContent = { nativeElement: el };
    cmp.measureReadingProgress();
    expect(cmp.galleryImages().map((g: any) => g.src)).toEqual(['https://i/1.png']);
  });

  it('updateReadingProgress handles missing window, missing element and computes progress', () => {
    configure({ withWindow: false });
    const guarded = create();
    guarded.cmp.updateReadingProgress();
    TestBed.resetTestingModule();

    configure({ withWindow: true });
    const { cmp } = create();
    cmp.articleContent = undefined;
    cmp.updateReadingProgress();
    expect(cmp.readingProgress()).toBe(0);
    expect(cmp.showBackToTop()).toBe(false);

    const el = doc.createElement('div');
    el.innerHTML = '<h2 id="a">A</h2>';
    cmp.articleContent = { nativeElement: el };
    // degenerate range triggers the re-measure branch
    (cmp as any).scrollStartY = 0;
    (cmp as any).scrollEndY = 1;
    fakeWin.scrollY = 50;
    cmp.updateReadingProgress();
    expect(cmp.readingProgress()).toBeGreaterThanOrEqual(0);

    // healthy pre-measured range exercises progress + back-to-top
    (cmp as any).scrollStartY = 0;
    (cmp as any).scrollEndY = 2000;
    fakeWin.scrollY = 1000;
    cmp.updateReadingProgress();
    expect(cmp.readingProgress()).toBeCloseTo(0.5, 1);
    expect(cmp.showBackToTop()).toBe(true);
  });

  it('updateActiveHeading clears without headings and selects the passed heading', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    (cmp as any).tocHeadingEls = [];
    cmp.updateActiveHeading();
    expect(cmp.activeHeadingId()).toBeNull();

    const top = doc.createElement('h2');
    top.id = 'top';
    const bottom = doc.createElement('h2');
    bottom.id = 'bottom';
    spyOn(top, 'getBoundingClientRect').and.returnValue({ top: -10 } as any);
    spyOn(bottom, 'getBoundingClientRect').and.returnValue({ top: 500 } as any);
    (cmp as any).tocHeadingEls = [top, bottom];
    cmp.updateActiveHeading();
    expect(cmp.activeHeadingId()).toBe('top');
  });

  it('updateActiveHeading returns when there is no window', () => {
    configure({ withWindow: false });
    const { cmp } = create();
    (cmp as any).tocHeadingEls = [doc.createElement('h2')];
    cmp.updateActiveHeading();
    expect(cmp.activeHeadingId()).toBeNull();
  });

  it('buildShareUrl is guarded and appends the location hash', () => {
    configure({ withWindow: false });
    const guarded = create();
    expect((guarded.cmp as any).buildShareUrl()).toBe('');
    TestBed.resetTestingModule();

    configure({ withWindow: true });
    const { cmp } = create();
    cmp.slug = '';
    expect((cmp as any).buildShareUrl()).toBe('');
    cmp.slug = 'first-post';
    fakeWin.location.hash = '#sec';
    expect((cmp as any).buildShareUrl()).toBe('https://shop.test/blog/first-post?lang=en#sec');
  });

  // ---------------------------------------------------------------------------
  // renderPostBody + embeds
  // ---------------------------------------------------------------------------

  it('renderPostBody returns the raw html without a DOMParser', () => {
    configure({ withWindow: false });
    const { cmp } = create();
    markdown.render.and.returnValue('<p>x</p>');
    const result = (cmp as any).renderPostBody('x');
    expect(result.html).toBe('<p>x</p>');
    expect(result.toc).toEqual([]);
    expect(result.embeds).toEqual([]);
  });

  it('renderPostBody builds toc, layouts, galleries, embeds, callouts and code blocks', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.slug = 'first-post';
    const html = [
      '<h2>Intro</h2>',
      '<h2>Intro</h2>', // duplicate slug
      '<h3></h3>', // empty title skipped
      '<p><img src="i/wide.png" title="wide"></p>',
      '<p><img src="i/left.png" title="left gallery"></p>',
      '<p><img src="i/right.png" title="right gallery"></p>',
      '<p><img src="i/plain.png" title="caption only"></p>',
      '<p><img src="i/g1.png" title="gallery"></p>',
      '<p><img src="i/g2.png" title="gallery"></p>',
      '<p>{{product:my-prod}}</p>',
      '<p>{{category:cat}}</p>',
      '<p>{{collection:col}}</p>',
      '<p>{{unknown:zzz}}</p>',
      '<p>plain paragraph</p>',
      '<blockquote><p>[!TIP] helpful</p></blockquote>',
      '<blockquote><p>[!WARNING] danger</p></blockquote>',
      '<blockquote><p>[!NOTE] note body</p></blockquote>',
      '<blockquote><p>no marker here</p></blockquote>',
      '<blockquote></blockquote>',
      '<pre><code class="language-js">const a=1;</code></pre>',
      '<pre><code class="language-ts">const b:number=1;</code></pre>',
      '<pre><code class="language-html">&lt;div&gt;</code></pre>',
      '<pre><code class="language-xml">&lt;x/&gt;</code></pre>',
      '<pre><code class="language-unknownlang">noop</code></pre>',
      '<pre><code>plain code</code></pre>',
    ].join('');
    markdown.render.and.returnValue(html);

    const result = (cmp as any).renderPostBody('whatever');
    const ids = result.toc.map((t: any) => t.id);
    expect(ids).toContain('intro');
    expect(ids).toContain('intro-2');
    expect(result.embeds).toEqual([
      { type: 'product', slug: 'my-prod' },
      { type: 'category', slug: 'cat' },
      { type: 'collection', slug: 'col' },
    ]);
    expect(result.html).toContain('blog-gallery');
    expect(result.html).toContain('blog-callout--tip');
    expect(result.html).toContain('blog-callout--warning');
    expect(result.html).toContain('blog-callout--note');
    expect(result.html).toContain('blog-codeblock');
    expect(result.html).toContain('blog-img-wide');
    expect(result.html).toContain('blog-img-left');
    expect(result.html).toContain('blog-img-right');
  });

  it('renderPostBody covers callouts whose marker sits in a non-text node and caution markers', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    const html = [
      '<blockquote><p><strong>[!CAUTION]</strong> be careful</p></blockquote>',
      '<blockquote><p>[!IMPORTANT]</p></blockquote>',
    ].join('');
    markdown.render.and.returnValue(html);
    const result = (cmp as any).renderPostBody('x');
    expect(result.html).toContain('blog-callout--warning');
    expect(result.html).toContain('blog-callout--note');
  });

  it('renderPostBody tolerates a highlight.js failure', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    spyOn(hljs, 'highlightAuto').and.throwError('hl boom');
    markdown.render.and.returnValue('<pre><code>plain</code></pre>');
    const result = (cmp as any).renderPostBody('x');
    expect(result.html).toContain('blog-codeblock');
  });

  it('hydrateEmbeds guards on empty html/embeds', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.bodyHtml.set('');
    (cmp as any).hydrateEmbeds([{ type: 'product', slug: 'x' }], 1, 'en');
    cmp.bodyHtml.set('<p>x</p>');
    (cmp as any).embedRevision = 1;
    (cmp as any).hydrateEmbeds([], 1, 'en');
    expect(catalog.getProduct).not.toHaveBeenCalled();
  });

  it('hydrateEmbeds resolves catalog data and rewrites the body html', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.bodyHtml.set(
      '<div class="blog-embed" data-embed-type="product" data-embed-slug="p1"></div>' +
        '<div class="blog-embed" data-embed-type="category" data-embed-slug="c1"></div>' +
        '<div class="blog-embed" data-embed-type="collection" data-embed-slug="col1"></div>',
    );
    (cmp as any).embedRevision = 5;
    catalog.getProduct.and.returnValue(
      of({
        slug: 'p1',
        name: 'Prod',
        currency: 'USD',
        base_price: 20,
        sale_price: 10,
        images: [{ url: 'i/p.png' }],
        short_description: 'great',
      } as any),
    );
    catalog.listCategories.and.returnValue(
      of([{ slug: 'c1', name: 'Cat', thumbnail_url: 'i/c.png' }] as any),
    );
    catalog.listFeaturedCollections.and.returnValue(
      of([
        {
          slug: 'col1',
          name: 'Col',
          description: 'desc',
          products: [{ slug: 'pp', name: 'PP', images: [{ url: 'i/pp.png' }] }],
        },
      ] as any),
    );

    (cmp as any).hydrateEmbeds(
      [
        { type: 'product', slug: 'p1' },
        { type: 'product', slug: 'p1' }, // dedupe
        { type: 'category', slug: 'c1' },
        { type: 'collection', slug: 'col1' },
      ],
      5,
      'en',
    );
    const out = cmp.bodyHtml();
    expect(out).toContain('blog-embed-card');
    expect(out).toContain('Prod');
    expect(out).toContain('blog-embed-price-secondary');
    expect(out).toContain('blog-embed-collection');
  });

  it('hydrateEmbeds ignores stale revisions', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    const original =
      '<div class="blog-embed" data-embed-type="product" data-embed-slug="p1"></div>';
    cmp.bodyHtml.set(original);
    (cmp as any).embedRevision = 2;
    catalog.getProduct.and.returnValue(
      of({ slug: 'p1', name: 'Prod', currency: 'USD', base_price: 1, images: [] } as any),
    );
    (cmp as any).hydrateEmbeds([{ type: 'product', slug: 'p1' }], 1, 'en');
    expect(cmp.bodyHtml()).toBe(original);
  });

  it('applyEmbedData guards and renders not-found placeholders + plain prices', () => {
    configure({ withWindow: true });
    const { cmp } = create();

    // no DOMParser
    Object.defineProperty(doc, 'defaultView', { configurable: true, get: () => ({}) });
    expect(
      (cmp as any).applyEmbedData('<p>x</p>', { products: {}, categories: [], collections: [] }),
    ).toBe('<p>x</p>');
    Object.defineProperty(doc, 'defaultView', { configurable: true, get: () => fakeWin });

    // no embeds present
    expect(
      (cmp as any).applyEmbedData('<p>no embeds</p>', {
        products: {},
        categories: [],
        collections: [],
      }),
    ).toBe('<p>no embeds</p>');

    const html =
      '<div class="blog-embed" data-embed-type="product" data-embed-slug="missing"></div>' +
      '<div class="blog-embed" data-embed-type="category" data-embed-slug="missing"></div>' +
      '<div class="blog-embed" data-embed-type="collection" data-embed-slug="missing"></div>' +
      '<div class="blog-embed" data-embed-type="" data-embed-slug=""></div>' +
      '<div class="blog-embed" data-embed-type="product" data-embed-slug="p2">loading placeholder</div>';
    const out = (cmp as any).applyEmbedData(html, {
      products: {
        p2: {
          slug: 'p2',
          name: 'P2',
          currency: 'EUR',
          base_price: 5,
          sale_price: 9,
          images: [],
          short_description: '',
        },
      },
      categories: [],
      collections: [],
    });
    expect(out).toContain('blog.post.embed.notFoundProduct');
    expect(out).toContain('blog.post.embed.notFoundCategory');
    expect(out).toContain('blog.post.embed.notFoundCollection');
    expect(out).not.toContain('blog-embed-price-secondary'); // sale >= base -> plain price
  });

  // ---------------------------------------------------------------------------
  // Additional branch coverage
  // ---------------------------------------------------------------------------

  it('lightboxImage returns null while the index is null', () => {
    configure();
    const { cmp } = create();
    expect(cmp.lightboxIndex()).toBeNull();
    expect(cmp.lightboxImage()).toBeNull();
  });

  it('ngOnInit handles a string preview emitted on the params stream', () => {
    routeStub.snapshot.params = { slug: 's' };
    configure();
    const { cmp } = create();
    cmp.ngOnInit();
    routeParams$.next({ slug: 'sp' });
    routeQueryParams$.next({ preview: 'realtoken' });
    expect(cmp.isPreview()).toBe(true);
    expect(blog.getPreviewPost).toHaveBeenCalledWith('sp', 'realtoken', 'en');
  });

  it('saveQuickEdit tolerates empty status/title and a null current post', () => {
    const block = makeBlock({
      status: 'draft',
      title: 'Hello',
      meta: { summary: { en: 'only-en' } },
      version: 4,
    });
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    cmp.post.set(null); // exercises (this.post()?.title || '') optional chain
    cmp.adminBlock.set(block);
    cmp.quickEditStatus = ''; // falsy status
    cmp.quickEditTitle = ''; // falsy title -> titleChanged false
    cmp.quickEditPublishAt = '';
    cmp.quickEditUnpublishAt = '';
    cmp.quickEditTags = '';
    cmp.quickEditSummary = 'changed'; // forces a meta change so a request is sent
    cmp.saveQuickEdit();
    const payload = admin.updateContentBlock.calls.mostRecent().args[1] as any;
    // summary object retains its single locale and gains the new value
    expect(payload.meta.summary.en).toBe('changed');
  });

  it('saveQuickEdit deletes a summary object that only held the active locale', () => {
    const block = makeBlock({
      status: 'draft',
      title: 'Hello',
      meta: { summary: { en: 'bye' } },
      version: 2,
    });
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    cmp.post.set({ ...basePost, title: 'Hello' });
    cmp.adminBlock.set(block);
    cmp.quickEditStatus = 'draft';
    cmp.quickEditTitle = 'Hello';
    cmp.quickEditPublishAt = '';
    cmp.quickEditUnpublishAt = '';
    cmp.quickEditTags = '';
    cmp.quickEditSummary = '';
    cmp.saveQuickEdit();
    const payload = admin.updateContentBlock.calls.mostRecent().args[1] as any;
    expect(payload.meta.summary).toBeUndefined();
  });

  it('saveQuickEdit clears a previously scheduled unpublish time', () => {
    const block = makeBlock({
      status: 'draft',
      title: 'Hello',
      published_until: '2030-01-01T00:00:00Z',
      version: 2,
    });
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    cmp.post.set({ ...basePost, title: 'Hello' });
    cmp.adminBlock.set(block);
    cmp.quickEditStatus = 'draft';
    cmp.quickEditTitle = 'Hello';
    cmp.quickEditPublishAt = '';
    cmp.quickEditUnpublishAt = ''; // differs from current -> null
    cmp.quickEditTags = '';
    cmp.quickEditSummary = '';
    cmp.saveQuickEdit();
    const payload = admin.updateContentBlock.calls.mostRecent().args[1] as any;
    expect(payload.published_until).toBeNull();
  });

  it('hydrateQuickEditFromState falls back across status/title/summary sources', () => {
    configure();
    const { cmp } = create();
    cmp.post.set(null);
    cmp.adminBlock.set(
      makeBlock({ status: '', title: 'BlockTitle', meta: { summary: { en: 'block summary' } } }),
    );
    cmp.hydrateQuickEditFromState();
    expect(cmp.quickEditStatus).toBe('draft'); // String('' || 'draft')
    expect(cmp.quickEditTitle).toBe('BlockTitle'); // post null -> block.title
    expect(cmp.quickEditSummary).toBe('block summary'); // post null -> meta summary
  });

  it('sameStringSet skips falsy elements on both sides', () => {
    configure();
    const { cmp } = create();
    expect(cmp.sameStringSet(['', 'a', null as any], ['a', '', null as any])).toBe(true);
  });

  it('progressPercent and the scroll/resize listeners delegate to reading-progress updates', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.readingProgress.set(0.42);
    expect(cmp.progressPercent()).toBe(42);
    const update = spyOn<any>(cmp, 'updateReadingProgress');
    const soon = spyOn<any>(cmp, 'measureReadingProgressSoon');
    (cmp as any).scrollListener();
    (cmp as any).resizeListener();
    expect(update).toHaveBeenCalled();
    expect(soon).toHaveBeenCalled();
  });

  it('applyEmbedData uses the placeholder when a category has no imagery', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    const out = (cmp as any).applyEmbedData(
      '<div class="blog-embed" data-embed-type="category" data-embed-slug="c"></div>',
      { products: {}, categories: [{ slug: 'c', name: 'Cat' }] as any, collections: [] },
    );
    expect(out).toContain('product-placeholder.svg');
  });

  it('loadRelatedPosts tie-breaks equal scores by published date', () => {
    configure();
    const { cmp } = create();
    blog.listPosts.and.returnValue(
      of({
        items: [
          { slug: 'undated1', title: 'U1', series: 'S' },
          { slug: 'older', title: 'Older', series: 'S', published_at: '2020-01-01' },
          { slug: 'undated2', title: 'U2', series: 'S' },
          { slug: 'newer', title: 'Newer', series: 'S', published_at: '2022-01-01' },
        ] as any,
        meta: { total_items: 4, total_pages: 1, page: 1, limit: 50 },
      }),
    );
    cmp.loadRelatedPosts('en', { ...basePost, slug: 'self', series: 'S', tags: [] });
    const slugs = cmp.relatedPosts().map((p: any) => p.slug);
    // dated posts (newest first) sort ahead of undated ones
    expect(slugs[0]).toBe('newer');
    expect(slugs[1]).toBe('older');
    expect(slugs).toContain('undated1');
    expect(slugs).toContain('undated2');
  });

  it('loadMoreFromAuthor tolerates a response with no items array', () => {
    configure();
    const { cmp } = create();
    blog.listPosts.and.returnValue(
      of({ items: undefined as any, meta: { total_items: 0, total_pages: 1, page: 1, limit: 8 } }),
    );
    cmp.loadMoreFromAuthor('en', { ...basePost, author: { id: 'a1' } });
    expect(cmp.moreFromAuthor()).toEqual([]);
  });

  it('handleArticleClick ignores links with an empty target and toggles wrap twice', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigateByUrl').and.resolveTo(true);

    const link = doc.createElement('a');
    link.setAttribute('data-router-link', '');
    doc.body.appendChild(link);
    cmp.handleArticleClick({
      target: link,
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() {},
      stopPropagation() {},
    } as any);
    expect(nav).not.toHaveBeenCalled();

    const wrapper = doc.createElement('div');
    wrapper.className = 'blog-codeblock';
    wrapper.innerHTML =
      '<button data-code-action="wrap" data-wrap-label="W" data-unwrap-label="U">W</button>';
    doc.body.appendChild(wrapper);
    const wrapBtn = wrapper.querySelector('button')!;
    cmp.handleArticleClick({ target: wrapBtn, preventDefault() {}, stopPropagation() {} } as any);
    expect(wrapBtn.textContent).toBe('U');
    cmp.handleArticleClick({ target: wrapBtn, preventDefault() {}, stopPropagation() {} } as any);
    expect(wrapBtn.textContent).toBe('W');
  });

  it('handleArticleClick copy handles a wrapper without a code element', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    const copySpy = spyOn<any>(cmp, 'copyCode');
    const wrapper = doc.createElement('div');
    wrapper.className = 'blog-codeblock';
    wrapper.innerHTML = '<button data-code-action="copy">copy</button>';
    doc.body.appendChild(wrapper);
    const btn = wrapper.querySelector('button')!;
    cmp.handleArticleClick({ target: btn, preventDefault() {}, stopPropagation() {} } as any);
    expect(copySpy).not.toHaveBeenCalled();
  });

  it('loadComments tolerates missing items/meta/total fields', () => {
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    blog.listCommentThreads.and.returnValue(
      of({ items: undefined as any, meta: undefined as any, total_comments: undefined as any }),
    );
    cmp.loadComments();
    expect(cmp.comments()).toEqual([]);
    expect(cmp.commentsMeta()).toBeNull();
    expect(cmp.commentsTotal()).toBe(0);
  });

  it('submitComment with oldest sort and no meta targets the first page', () => {
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    auth.isAuthenticated.and.returnValue(true);
    cmp.captchaEnabled = false;
    spyOn(cmp, 'loadComments').and.stub();
    cmp.commentBody = 'hi';
    cmp.commentSort.set('oldest');
    cmp.commentsMeta.set(null);
    cmp.submitComment();
    expect(cmp.commentPage()).toBe(1);
  });

  it('setMetaTags falls back across summary/body and updated/created dates', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.slug = 'first-post';
    (cmp as any).setMetaTags({
      ...basePost,
      summary: '',
      body_markdown: 'Body text used as description source',
      updated_at: '',
    });
    expect(title.setTitle).toHaveBeenCalled();
    (cmp as any).setMetaTags({
      ...basePost,
      summary: '',
      body_markdown: '',
      updated_at: '2001-01-01T00:00:00Z',
    });
    expect(meta.updateTag).toHaveBeenCalled();
  });

  it('setMetaTags builds an absolute og image and respects absolute api base urls', async () => {
    const { appConfig } = await import('../../core/app-config');
    const original = appConfig.apiBaseUrl;
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.slug = 'first-post';
    try {
      appConfig.apiBaseUrl = '';
      (cmp as any).setMetaTags({ ...basePost });
      appConfig.apiBaseUrl = 'https://cdn.example.com/api';
      (cmp as any).setMetaTags({ ...basePost });
      const httpsCall = [...meta.updateTag.calls.allArgs()]
        .reverse()
        .find((a: any[]) => a[0]?.property === 'og:image');
      expect(httpsCall?.[0]?.content).toContain('https://cdn.example.com/api');
      appConfig.apiBaseUrl = 'http://cdn.example.com/api';
      (cmp as any).setMetaTags({ ...basePost });
    } finally {
      appConfig.apiBaseUrl = original;
    }
  });

  it('setErrorMetaTags localises in Romanian', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.slug = 'first-post';
    TestBed.inject(TranslateService).use('ro');
    (cmp as any).setErrorMetaTags();
    expect(title.setTitle).toHaveBeenCalled();
  });

  it('hasMeaningfulArticleText treats empty body html as not meaningful', () => {
    configure();
    const { cmp } = create();
    cmp.bodyHtml.set('');
    expect(cmp.hasMeaningfulArticleText()).toBe(false);
  });

  it('updateReadingProgress handles a zero scroll position', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    const el = doc.createElement('div');
    el.innerHTML = '<h2 id="a">A</h2>';
    cmp.articleContent = { nativeElement: el };
    (cmp as any).scrollStartY = 0;
    (cmp as any).scrollEndY = 2000;
    fakeWin.scrollY = 0;
    cmp.updateReadingProgress();
    expect(cmp.readingProgress()).toBe(0);
    expect(cmp.showBackToTop()).toBe(false);
  });

  it('buildShareUrl localises the lang query in Romanian', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.slug = 'first-post';
    TestBed.inject(TranslateService).use('ro');
    fakeWin.location.hash = '';
    expect((cmp as any).buildShareUrl()).toContain('lang=ro');
  });

  it('renderPostBody covers empty markdown, sectionless headings, untitled images and lone galleries', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    const html = [
      '<h2>###</h2>', // slug resolves to the "section" fallback
      '<p><img src="i/none.png"></p>', // image with no title
      '<p><img src="i/lone.png" title="gallery"></p>', // lone gallery image (group < 2)
      '<p>after</p>',
      '<pre><code></code></pre>', // empty code block
      '<blockquote><p></p></blockquote>', // empty callout paragraph
    ].join('');
    markdown.render.and.returnValue(html);
    const result = (cmp as any).renderPostBody('');
    expect(markdown.render).toHaveBeenCalledWith('');
    expect(result.toc.map((t: any) => t.id)).toContain('section');
    expect(result.html).not.toContain('blog-gallery');
  });

  it('renderPostBody breaks a gallery run at a non-paragraph sibling', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    const html =
      '<p><img src="i/a.png" title="gallery"></p>' +
      '<p><img src="i/b.png" title="gallery"></p>' +
      '<h2>End</h2>';
    markdown.render.and.returnValue(html);
    const result = (cmp as any).renderPostBody('x');
    expect(result.html).toContain('blog-gallery');
  });

  it('hydrateEmbeds resolves category/collection only embeds and survives catalog errors', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.bodyHtml.set(
      '<div class="blog-embed" data-embed-type="product" data-embed-slug="p1"></div>' +
        '<div class="blog-embed" data-embed-type="category" data-embed-slug="c1"></div>' +
        '<div class="blog-embed" data-embed-type="collection" data-embed-slug="col1"></div>',
    );
    (cmp as any).embedRevision = 1;
    catalog.getProduct.and.returnValue(throwError(() => new Error('p')));
    catalog.listCategories.and.returnValue(throwError(() => new Error('c')));
    catalog.listFeaturedCollections.and.returnValue(throwError(() => new Error('col')));
    (cmp as any).hydrateEmbeds(
      [
        { type: 'product', slug: 'p1' },
        { type: 'category', slug: 'c1' },
        { type: 'collection', slug: 'col1' },
      ],
      1,
      'en',
    );
    const out = cmp.bodyHtml();
    expect(out).toContain('blog.post.embed.notFoundProduct');
    expect(out).toContain('blog.post.embed.notFoundCategory');
    expect(out).toContain('blog.post.embed.notFoundCollection');
  });

  it('hydrateEmbeds uses an empty product map when there are no product embeds', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    cmp.bodyHtml.set(
      '<div class="blog-embed" data-embed-type="category" data-embed-slug="c1"></div>',
    );
    (cmp as any).embedRevision = 1;
    catalog.listCategories.and.returnValue(
      of([{ slug: 'c1', name: 'Cat', thumbnail_url: 't' }] as any),
    );
    (cmp as any).hydrateEmbeds([{ type: 'category', slug: 'c1' }], 1, 'en');
    expect(catalog.getProduct).not.toHaveBeenCalled();
    expect(cmp.bodyHtml()).toContain('blog-embed-card');
  });

  it('applyEmbedData renders cards with every optional field absent', () => {
    configure({ withWindow: true });
    const { cmp } = create();
    const html =
      '<div class="blog-embed" data-embed-type="product" data-embed-slug="p"></div>' +
      '<div class="blog-embed" data-embed-type="category" data-embed-slug="c"></div>' +
      '<div class="blog-embed" data-embed-type="category" data-embed-slug="cb"></div>' +
      '<div class="blog-embed" data-embed-type="collection" data-embed-slug="col"></div>' +
      '<div class="blog-embed" data-embed-type="collection" data-embed-slug="empty"></div>';
    const out = (cmp as any).applyEmbedData(html, {
      products: { p: { slug: 'p', images: [] } as any }, // no name/currency/price
      categories: undefined as any, // exercises (data.categories || [])
      collections: undefined as any, // exercises (data.collections || [])
    });
    expect(out).toContain('blog.post.embed.notFoundCategory');
    expect(out).toContain('0.00');

    const out2 = (cmp as any).applyEmbedData(html, {
      products: {},
      categories: [
        { slug: 'c', thumbnail_url: 't' }, // no name -> slug
        { slug: 'cb', banner_url: 'b' }, // no thumbnail -> banner
      ] as any,
      collections: [
        { slug: 'col', products: [{ slug: 'pp' }] }, // no name; product without name/images
        { slug: 'empty', name: 'Empty' }, // no products array
      ] as any,
    });
    expect(out2).toContain('blog-embed-collection');
    expect(out2).toContain('blog-embed-card');
  });

  it('saveQuickEdit compares a new title against a null current post', () => {
    const block = makeBlock({ status: 'draft', title: 'Hello', meta: {}, version: 1 });
    configure();
    const { cmp } = create();
    cmp.slug = 'first-post';
    cmp.post.set(null); // (this.post()?.title || '') hits the nullish path
    cmp.adminBlock.set(block);
    cmp.quickEditStatus = 'draft';
    cmp.quickEditTitle = 'A New Title'; // truthy -> evaluates the post()?.title comparison
    cmp.quickEditPublishAt = '';
    cmp.quickEditUnpublishAt = '';
    cmp.quickEditTags = '';
    cmp.quickEditSummary = '';
    cmp.saveQuickEdit();
    const titlePayload = admin.updateContentBlock.calls
      .allArgs()
      .map((a) => a[1] as any)
      .find((p) => p.title);
    expect(titlePayload.title).toBe('A New Title');
  });

  it('hydrateQuickEditFromState falls all the way through to empty defaults', () => {
    configure();
    const { cmp } = create();
    cmp.post.set(null);
    cmp.adminBlock.set(makeBlock({ title: undefined as any, meta: {} }));
    cmp.hydrateQuickEditFromState();
    expect(cmp.quickEditTitle).toBe('');
    expect(cmp.quickEditSummary).toBe('');
  });

  it('slugifyHeading returns an empty string for empty input', () => {
    configure();
    const { cmp } = create();
    expect((cmp as any).slugifyHeading('')).toBe('');
    expect((cmp as any).slugifyHeading('Héllo World!')).toBe('hello-world');
  });
});
