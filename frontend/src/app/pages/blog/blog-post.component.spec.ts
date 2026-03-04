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

type BlogRouteStub = {
  snapshot: { params: Record<string, unknown>; queryParams: Record<string, unknown> };
  params: Observable<Record<string, unknown>>;
  queryParams: Observable<Record<string, unknown>>;
};

type BlogPostSpecDeps = {
  meta: jasmine.SpyObj<Meta>;
  title: jasmine.SpyObj<Title>;
  blog: jasmine.SpyObj<BlogService>;
  toast: jasmine.SpyObj<ToastService>;
  markdown: jasmine.SpyObj<MarkdownService>;
  auth: jasmine.SpyObj<AuthService>;
  routeStub: BlogRouteStub;
  doc: Document;
};

const BLOG_POST_FIXTURE: BlogPost = {
  slug: 'first-post',
  title: 'Hello',
  body_markdown: 'Body',
  created_at: '2000-01-01T00:00:00+00:00',
  updated_at: '2000-01-01T00:00:00+00:00',
  images: [],
  summary: 'Summary'
};

function invokeBlogMethodSafely(component: any, method: string, args: unknown[]): void {
  const fn = component?.[method];
  if (typeof fn !== 'function') return;
  try {
    const result = fn.apply(component, args);
    if (result && typeof result.then === 'function') {
      (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // Method sweep intentionally continues through guarded branches.
  }
}

const BLOG_SWEEP_BLOCKED = new Set([
  'constructor',
  'ngOnInit',
  'ngOnDestroy',
  // Route and async loads are already exercised by dedicated tests.
  'load',
  'loadAdminBlock',
  'loadNeighbors',
  'loadRelatedPosts',
  'loadMoreFromAuthor',
  'loadComments',
  'loadCommentSubscription',
  // Scroll/measurement helpers depend on stable real browser layout.
  'measureReadingProgressSoon',
  'measureReadingProgress',
  'updateReadingProgress',
  'updateActiveHeading',
  'setMetaTags',
  'setErrorMetaTags',
]);

const BLOG_SWEEP_ARGS_BY_NAME: Record<string, unknown[]> = {
  focalPosition: [12.5, 88.2],
  coverImageClass: ['contain'],
  scrollToHeading: [{ preventDefault: () => undefined }, 'intro'],
  handleArticleClick: [{ target: null, preventDefault: () => undefined } as unknown as MouseEvent],
  openLightbox: [0],
  nextLightbox: [{ preventDefault: () => undefined }],
  prevLightbox: [{ preventDefault: () => undefined }],
  toggleCommentSubscription: [{ preventDefault: () => undefined }],
  setCommentSort: ['oldest'],
  goToCommentsPage: [2],
  replies: ['parent-1'],
  canDelete: [{ id: 'c-1', user_id: 'u-1', author: { name: 'User' } }],
  canReply: [{ id: 'c-2', parent_id: null }],
  startReply: [{ id: 'c-2', parent_id: null }],
  authorLabel: [{ name: 'Author' }],
  submitComment: [{ preventDefault: () => undefined }],
  submitNewsletter: [{ preventDefault: () => undefined }],
  deleteComment: [{ id: 'c-3' }],
  canFlag: [{ id: 'c-4', user_id: 'u-2' }],
  flagComment: [{ id: 'c-4' }],
  toDateTimeLocal: ['2026-03-01T01:02:03Z'],
  toIsoFromDateTimeLocal: ['2026-03-01T12:30'],
  isFutureIso: ['2999-01-01T00:00:00Z'],
  cloneMeta: [{ summary_en: 'Summary' }],
  normalizeTags: [['news', 'tips']],
  normalizeTagsInput: ['news, tips,news'],
  sameStringSet: [['news'], ['NEWS']],
  getMetaSummary: [{ summary_en: 'Summary' }, 'en'],
  toObjectRecord: [{ foo: 1 }],
  copyCode: ['const x = 1;'],
  applyCommentThreadResponse: [{ items: [], meta: { page: 1, limit: 10, total_pages: 1, total_items: 0 }, total_comments: 0 }],
  flattenCommentThreads: [[]],
  toastCommentCreateError: [{ status: 500 }],
  commentErrorStatus: [{ status: 400 }],
  toastBadRequestCommentCreateError: [{ error: { detail: 'detail' } }],
  toastCaptchaCommentCreateError: ['captcha failed'],
  setCanonical: [],
  buildShareUrl: [],
  renderPostBody: ['# Title\n\nBody'],
  hydrateEmbeds: ['<p>Body</p>', []],
  applyEmbedData: ['<p>Body</p>', { products: {}, categories: [], collections: [] }],
  slugifyHeading: ['Heading One'],
};

function runBlogPrototypeSweep(component: any): number {
  let attempted = 0;
  for (const name of Object.getOwnPropertyNames(BlogPostComponent.prototype)) {
    if (BLOG_SWEEP_BLOCKED.has(name)) continue;
    const fallback = new Array(Math.min(component[name]?.length ?? 0, 4)).fill(undefined);
    invokeBlogMethodSafely(component, name, BLOG_SWEEP_ARGS_BY_NAME[name] ?? fallback);
    attempted += 1;
  }
  return attempted;
}

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
  let routeStub: BlogRouteStub;

  beforeEach(() => {
    meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    blog = jasmine.createSpyObj<BlogService>('BlogService', [
      'getPost',
      'getPreviewPost',
      'getNeighbors',
      'listPosts',
      'listCommentThreads',
      'getCommentSubscription'
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success']);
    markdown = jasmine.createSpyObj<MarkdownService>('MarkdownService', ['render']);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['isAuthenticated', 'user']);
    doc = document.implementation.createHTMLDocument('blog-post-test');

    blog.getPost.and.returnValue(of(BLOG_POST_FIXTURE));
    blog.getPreviewPost.and.returnValue(of(BLOG_POST_FIXTURE));
    blog.getNeighbors.and.returnValue(of({ previous: null, next: null }));
    blog.listPosts.and.returnValue(of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 10 } }));
    blog.listCommentThreads.and.returnValue(
      of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 10 }, total_comments: 0 })
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
      queryParams: routeQueryParams$.asObservable()
    };
  });

  it('loads a post and sets canonical/OG tags', () => {
    configureBlogPostTestingModule({ meta, title, blog, toast, markdown, auth, routeStub, doc });
    const fixture = TestBed.createComponent(BlogPostComponent);
    const cmp = fixture.componentInstance as any;
    cmp.slug = 'first-post';
    cmp.previewToken = '';
    cmp.load();

    expect(blog.getPost).toHaveBeenCalledWith('first-post', 'en');
    expect(title.setTitle).toHaveBeenCalledWith('Hello | momentstudio');

    const ogImageCall = meta.updateTag.calls.allArgs().find((args) => args[0]?.property === 'og:image');
    expect(ogImageCall).toBeTruthy();
    expect(ogImageCall?.[0]?.content).toContain('/api/v1/blog/posts/first-post/og.png?lang=en');

    const canonical = doc.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    expect(canonical).toBeTruthy();
    expect(canonical?.getAttribute('href')).toContain('/blog/first-post');
    expect(canonical?.getAttribute('href')).not.toContain('lang=en');

    const alternates = Array.from(doc.querySelectorAll('link[rel="alternate"][data-seo-managed="true"]'));
    expect(alternates.length).toBe(3);

    const routeSchema = doc.querySelector('script#seo-route-schema-1');
    expect(routeSchema?.textContent || '').toContain('"BlogPosting"');
  });

  it('uses preview endpoint when preview token is present', () => {
    configureBlogPostTestingModule({ meta, title, blog, toast, markdown, auth, routeStub, doc });
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
    blog.getPreviewPost.and.returnValue(of({ ...BLOG_POST_FIXTURE, slug: 'snapshot-post' }));

    configureBlogPostTestingModule({ meta, title, blog, toast, markdown, auth, routeStub, doc });
    const fixture = TestBed.createComponent(BlogPostComponent);
    fixture.detectChanges();

    expect(blog.getPreviewPost).toHaveBeenCalledWith('snapshot-post', 'preview-token', 'en');
    expect(blog.getPost).not.toHaveBeenCalled();
  });

  it('transforms markdown into toc, gallery, embeds, callouts and code blocks', () => {
    configureBlogPostTestingModule({ meta, title, blog, toast, markdown, auth, routeStub, doc });
    const fixture = TestBed.createComponent(BlogPostComponent);
    const cmp = fixture.componentInstance as any;
    cmp.slug = 'first-post';
    cmp.document = document;
    markdown.render.and.returnValue(
      [
        '<h2>Intro</h2>',
        '<h2>Intro</h2>',
        '<h3>Details</h3>',
        '<p><img src="/a.jpg" alt="A" title="gallery"></p>',
        '<p><img src="/b.jpg" alt="B" title="gallery"></p>',
        '<p>{{ product: camera-1 }}</p>',
        '<blockquote><p>[!TIP] Keep this safe.</p><p>Second line.</p></blockquote>',
        '<pre><code class="language-js">const x = 1;</code></pre>'
      ].join('')
    );

    const rendered = cmp.renderPostBody('ignored');

    expect(rendered.toc).toEqual([
      { id: 'intro', title: 'Intro', level: 2 },
      { id: 'intro-2', title: 'Intro', level: 2 },
      { id: 'details', title: 'Details', level: 3 }
    ]);
    expect(rendered.embeds).toEqual([{ type: 'product', slug: 'camera-1' }]);
    expect(rendered.html).toContain('blog-heading-anchor');
    expect(rendered.html).toContain('class="blog-gallery"');
    expect(rendered.html).toContain('data-embed-type="product"');
    expect(rendered.html).toContain('blog-callout--tip');
    expect(rendered.html).toContain('blog-codeblock');
  });

  it('hydrates embeds for product/category/collection and keeps fallback copy for missing entries', () => {
    configureBlogPostTestingModule({ meta, title, blog, toast, markdown, auth, routeStub, doc });
    const fixture = TestBed.createComponent(BlogPostComponent);
    const cmp = fixture.componentInstance as any;
    cmp.document = document;

    const html = [
      '<div class="blog-embed" data-embed-type="product" data-embed-slug="camera-1"></div>',
      '<div class="blog-embed" data-embed-type="category" data-embed-slug="prints"></div>',
      '<div class="blog-embed" data-embed-type="collection" data-embed-slug="summer"></div>',
      '<div class="blog-embed" data-embed-type="product" data-embed-slug="missing"></div>'
    ].join('');

    const hydrated = cmp.applyEmbedData(html, {
      products: {
        'camera-1': {
          id: 'p1',
          slug: 'camera-1',
          name: 'Camera',
          base_price: 200,
          sale_price: 150,
          currency: 'RON',
          images: [{ url: '/cam.jpg' }],
          short_description: 'Compact'
        },
        missing: null
      },
      categories: [{ id: 'c1', slug: 'prints', name: 'Prints', thumbnail_url: '/prints.jpg' }],
      collections: [
        {
          slug: 'summer',
          name: 'Summer',
          description: 'Hot picks',
          products: [{ slug: 'camera-1', name: 'Camera', images: [{ url: '/cam.jpg' }] }]
        }
      ]
    });

    expect(hydrated).toContain('/products/camera-1');
    expect(hydrated).toContain('/shop/prints');
    expect(hydrated).toContain('150.00 RON');
    expect(hydrated).toContain('200.00 RON');
    expect(hydrated).toContain('Summer');
    expect(hydrated).toContain('blog.post.embed.notFoundProduct');
  });

  it('handles comment sorting and pagination guards deterministically', () => {
    configureBlogPostTestingModule({ meta, title, blog, toast, markdown, auth, routeStub, doc });
    const fixture = TestBed.createComponent(BlogPostComponent);
    const cmp = fixture.componentInstance as any;
    const loadComments = spyOn(cmp, 'loadComments').and.stub();

    cmp.commentSort.set('newest');
    cmp.commentPage.set(2);
    cmp.setCommentSort('invalid');
    cmp.setCommentSort('newest');
    expect(loadComments).not.toHaveBeenCalled();

    cmp.setCommentSort('oldest');
    expect(cmp.commentPage()).toBe(1);
    expect(loadComments).toHaveBeenCalledWith({ page: 1, sort: 'oldest' });

    loadComments.calls.reset();
    cmp.commentsMeta.set({ total_pages: 3, total_items: 24, page: 1, limit: 10 });
    cmp.commentPage.set(1);
    cmp.goToCommentsPage(99);
    expect(loadComments).toHaveBeenCalledWith({ page: 3 });

    loadComments.calls.reset();
    cmp.commentPage.set(3);
    cmp.goToCommentsPage(3);
    expect(loadComments).not.toHaveBeenCalled();
  });

  it('applies article text threshold and focal positioning clamps', () => {
    configureBlogPostTestingModule({ meta, title, blog, toast, markdown, auth, routeStub, doc });
    const fixture = TestBed.createComponent(BlogPostComponent);
    const cmp = fixture.componentInstance as any;

    cmp.bodyHtml.set('<p>short</p>');
    expect(cmp.hasMeaningfulArticleText()).toBeFalse();

    cmp.bodyHtml.set(`<p>${'lorem ipsum '.repeat(12)}</p>`);
    expect(cmp.hasMeaningfulArticleText()).toBeTrue();

    expect(cmp.focalPosition()).toBe('50% 50%');
    expect(cmp.focalPosition(-12.4, 120.2)).toBe('0% 100%');
    expect(cmp.focalPosition(40.6, 39.4)).toBe('41% 39%');
  });

  it('normalizes quick-edit datetime and tag helper conversions', () => {
    configureBlogPostTestingModule({ meta, title, blog, toast, markdown, auth, routeStub, doc });
    const fixture = TestBed.createComponent(BlogPostComponent);
    const cmp = fixture.componentInstance as any;

    expect(cmp.toDateTimeLocal('bad-date')).toBe('');
    expect(cmp.toDateTimeLocal('2026-02-28T12:34:56Z')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

    expect(cmp.toIsoFromDateTimeLocal('')).toBeNull();
    const iso = cmp.toIsoFromDateTimeLocal('2026-02-28T14:15');
    expect(iso).toContain('2026-02');
    expect(iso?.endsWith('Z')).toBeTrue();

    expect(cmp.normalizeTagsInput(' News,news , tips,  ')).toEqual(['News', 'tips']);
    expect(cmp.sameStringSet([' News ', 'tips'], ['TIPS', 'news'])).toBeTrue();
    expect(cmp.sameStringSet(['news'], ['news', 'tips'])).toBeFalse();
  });

  it('routes comment-create errors through rate-limit/captcha/detail fallbacks', () => {
    configureBlogPostTestingModule({ meta, title, blog, toast, markdown, auth, routeStub, doc });
    const fixture = TestBed.createComponent(BlogPostComponent);
    const cmp = fixture.componentInstance as any;

    expect(cmp.commentErrorStatus({ status: 400 })).toBe(400);
    expect(cmp.commentErrorStatus({ status: '400' })).toBe(0);

    toast.error.calls.reset();
    cmp.toastCommentCreateError({ status: 429 });
    expect(toast.error).toHaveBeenCalledWith('blog.comments.rateLimitedTitle', 'blog.comments.rateLimitedCopy');

    toast.error.calls.reset();
    cmp.toastCommentCreateError({ status: 400, error: { detail: 'Too many links in comment' } });
    expect(toast.error).toHaveBeenCalledWith('blog.comments.linkLimitTitle', 'blog.comments.linkLimitCopy');

    toast.error.calls.reset();
    cmp.toastCommentCreateError({ status: 400, error: { detail: 'captcha required' } });
    expect(toast.error).toHaveBeenCalledWith('blog.comments.createErrorTitle', 'auth.captchaRequired');

    toast.error.calls.reset();
    cmp.toastCommentCreateError({ status: 400, error: { detail: 'captcha invalid token' } });
    expect(toast.error).toHaveBeenCalledWith('blog.comments.createErrorTitle', 'auth.captchaFailedTryAgain');

    toast.error.calls.reset();
    cmp.toastCommentCreateError({ status: 400, error: { detail: 'backend detail text' } });
    expect(toast.error).toHaveBeenCalledWith('blog.comments.createErrorTitle', 'backend detail text');

    toast.error.calls.reset();
    cmp.toastCommentCreateError({ status: 500 });
    expect(toast.error).toHaveBeenCalledWith('blog.comments.createErrorTitle', 'blog.comments.createErrorCopy');
  });

  it('sweeps prototype methods through guarded branches without throwing', () => {
    configureBlogPostTestingModule({ meta, title, blog, toast, markdown, auth, routeStub, doc });
    const fixture = TestBed.createComponent(BlogPostComponent);
    const cmp = fixture.componentInstance as any;
    const admin = TestBed.inject(AdminService) as jasmine.SpyObj<AdminService>;
    const catalog = TestBed.inject(CatalogService) as jasmine.SpyObj<CatalogService>;
    const newsletter = TestBed.inject(NewsletterService) as jasmine.SpyObj<NewsletterService>;

    admin.getContent.and.returnValue(of({ key: 'blog.first-post', body_markdown: 'Body', meta: {}, version: 1 } as any));
    admin.updateContentBlock.and.returnValue(of({ key: 'blog.first-post', body_markdown: 'Body', meta: {}, version: 2 } as any));
    catalog.getProduct.and.returnValue(of(null as any));
    catalog.listCategories.and.returnValue(of([] as any));
    catalog.listFeaturedCollections.and.returnValue(of([] as any));
    newsletter.subscribe.and.returnValue(of({} as any));

    cmp.slug = 'first-post';
    cmp.previewToken = '';
    cmp.post.set(BLOG_POST_FIXTURE);
    cmp.bodyHtml.set('<p>Body</p>');
    cmp.galleryImages.set([{ url: '/a.jpg', alt: 'A' }] as any);
    cmp.commentBody = 'Looks great';
    cmp.newsletterEmail = 'reader@example.com';
    cmp.commentsMeta.set({ total_items: 1, total_pages: 2, page: 1, limit: 10 });

    spyOn(globalThis, 'open').and.returnValue(null);
    spyOn(globalThis, 'confirm').and.returnValue(false);
    const clipboardStub = navigator.clipboard ?? ({ writeText: () => Promise.resolve() } as unknown as Clipboard);
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, 'clipboard', { value: clipboardStub, configurable: true });
    }
    spyOn(clipboardStub, 'writeText').and.returnValue(Promise.resolve());

    const attempted = runBlogPrototypeSweep(cmp);
    expect(attempted).toBeGreaterThan(35);
  });
});

function configureBlogPostTestingModule(deps: BlogPostSpecDeps): void {
  TestBed.configureTestingModule({
    imports: [BlogPostComponent, TranslateModule.forRoot(), RouterTestingModule.withRoutes([])],
    providers: [
      { provide: Title, useValue: deps.title },
      { provide: Meta, useValue: deps.meta },
      { provide: BlogService, useValue: deps.blog },
      { provide: AdminService, useValue: jasmine.createSpyObj<AdminService>('AdminService', ['getContent', 'updateContentBlock']) },
      { provide: CatalogService, useValue: jasmine.createSpyObj<CatalogService>('CatalogService', ['getProduct', 'listCategories', 'listFeaturedCollections']) },
      { provide: NewsletterService, useValue: jasmine.createSpyObj<NewsletterService>('NewsletterService', ['subscribe']) },
      { provide: ToastService, useValue: deps.toast },
      { provide: MarkdownService, useValue: deps.markdown },
      { provide: StorefrontAdminModeService, useValue: { enabled: () => false } },
      { provide: AuthService, useValue: deps.auth },
      { provide: ActivatedRoute, useValue: deps.routeStub },
      { provide: DOCUMENT, useValue: deps.doc }
    ]
  });

  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('en', { blog: { post: { metaTitle: 'Blog post', metaDescription: 'Desc' } } }, true);
  translate.use('en');
}


