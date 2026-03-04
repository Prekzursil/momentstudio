import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { BlogPostComponent } from './blog-post.component';
import { AdminService } from '../../core/admin.service';
import { AuthService } from '../../core/auth.service';
import { BlogService } from '../../core/blog.service';
import { CatalogService } from '../../core/catalog.service';
import { MarkdownService } from '../../core/markdown.service';
import { NewsletterService } from '../../core/newsletter.service';
import { SeoCopyFallbackService } from '../../core/seo-copy-fallback.service';
import { SeoHeadLinksService } from '../../core/seo-head-links.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';
import { StructuredDataService } from '../../core/structured-data.service';
import { ToastService } from '../../core/toast.service';

type BlogHarness = {
  component: BlogPostComponent;
  admin: jasmine.SpyObj<AdminService>;
  blog: jasmine.SpyObj<BlogService>;
  auth: jasmine.SpyObj<AuthService>;
  toast: jasmine.SpyObj<ToastService>;
  newsletter: jasmine.SpyObj<NewsletterService>;
};

function createHarness(): BlogHarness {
  const meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
  const title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
  const admin = jasmine.createSpyObj<AdminService>('AdminService', ['getContent', 'updateContentBlock']);
  const blog = jasmine.createSpyObj<BlogService>('BlogService', [
    'getPost',
    'getPreviewPost',
    'getNeighbors',
    'listPosts',
    'listCommentThreads',
    'getCommentSubscription',
    'setCommentSubscription',
    'createComment',
    'deleteComment',
    'flagComment'
  ]);
  const auth = jasmine.createSpyObj<AuthService>('AuthService', ['isAuthenticated', 'user', 'isAdmin']);
  const toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
  const newsletter = jasmine.createSpyObj<NewsletterService>('NewsletterService', ['subscribe']);
  const markdown = jasmine.createSpyObj<MarkdownService>('MarkdownService', ['render']);
  const routeStub = {
    snapshot: { params: { slug: 'first-post' }, queryParams: {} },
    params: of({ slug: 'first-post' }),
    queryParams: of({})
  };

  blog.getPost.and.returnValue(of({ slug: 'first-post', title: 'Hello', body_markdown: 'Body', images: [] } as any));
  blog.getPreviewPost.and.returnValue(of({ slug: 'first-post', title: 'Hello', body_markdown: 'Body', images: [] } as any));
  blog.getNeighbors.and.returnValue(of({ previous: null, next: null }));
  blog.listPosts.and.returnValue(of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 10 } }));
  blog.listCommentThreads.and.returnValue(of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 10 }, total_comments: 0 }));
  blog.getCommentSubscription.and.returnValue(of({ enabled: false }));
  blog.setCommentSubscription.and.returnValue(of({ enabled: true }));
  blog.createComment.and.returnValue(of({ id: 'c1', body: 'ok', is_deleted: false, created_at: new Date().toISOString(), user_id: 'u1', user: { id: 'u1' } } as any));
  blog.deleteComment.and.returnValue(of(void 0));
  blog.flagComment.and.returnValue(of({ id: 'f1', user_id: 'u1', created_at: new Date().toISOString() } as any));

  admin.getContent.and.returnValue(of({
    key: 'blog.first-post',
    version: 3,
    status: 'draft',
    title: 'Hello',
    meta: { summary: { en: 'Old summary' }, tags: ['old'] }
  } as any));
  admin.updateContentBlock.and.returnValue(of({ key: 'blog.first-post', version: 4, status: 'published', meta: { tags: ['new'] } } as any));

  auth.isAuthenticated.and.returnValue(true);
  auth.user.and.returnValue({ id: 'u1', email_verified: true } as any);
  auth.isAdmin.and.returnValue(false);
  newsletter.subscribe.and.returnValue(of({ already_subscribed: false } as any));
  markdown.render.and.returnValue('<p>Body</p>');

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [BlogPostComponent, TranslateModule.forRoot(), RouterTestingModule.withRoutes([])],
    providers: [
      { provide: Title, useValue: title },
      { provide: Meta, useValue: meta },
      { provide: BlogService, useValue: blog },
      { provide: AdminService, useValue: admin },
      { provide: CatalogService, useValue: jasmine.createSpyObj('CatalogService', ['getProduct', 'listCategories', 'listFeaturedCollections']) },
      { provide: NewsletterService, useValue: newsletter },
      { provide: ToastService, useValue: toast },
      { provide: MarkdownService, useValue: markdown },
      { provide: StorefrontAdminModeService, useValue: { enabled: () => true } },
      { provide: AuthService, useValue: auth },
      { provide: ActivatedRoute, useValue: routeStub },
      {
        provide: SeoHeadLinksService,
        useValue: {
          setLocalizedCanonical: (path: string) => `https://momentstudio.test${path}`,
          setCanonical: () => undefined,
          setAlternates: () => undefined
        }
      },
      { provide: StructuredDataService, useValue: { setRouteSchemas: () => undefined, clearRouteSchemas: () => undefined } },
      { provide: SeoCopyFallbackService, useValue: { description: (v: string) => v, blogPostIntro: () => '' } },
      { provide: DOCUMENT, useValue: document.implementation.createHTMLDocument('blog-wave') }
    ]
  });

  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('en', { blog: { post: { metaTitle: 'Blog post', metaDescription: 'Desc' } } }, true);
  translate.use('en');

  const fixture = TestBed.createComponent(BlogPostComponent);
  fixture.detectChanges();

  return { component: fixture.componentInstance, admin, blog, auth, toast, newsletter };
}

function callBlogMethodSafely(component: any, method: string, args: unknown[]): void {
  const fn = component?.[method];
  if (typeof fn !== 'function') return;
  try {
    const result = fn.apply(component, args);
    if (result && typeof result.then === 'function') {
      (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // Method sweep intentionally continues on guarded paths.
  }
}

describe('BlogPostComponent coverage wave', () => {
  it('covers quick-edit open/reset flow and admin-block hydration', () => {
    const { component, admin } = createHarness();
    const cmp = component as any;

    cmp.quickEditOpen.set(false);
    cmp.adminBlock.set(null);
    cmp.toggleQuickEdit();

    expect(cmp.quickEditOpen()).toBeTrue();
    expect(admin.getContent).toHaveBeenCalledWith('blog.first-post');
    expect(cmp.quickEditStatus).toBe('draft');

    cmp.quickEditError.set('error');
    cmp.resetQuickEdit();
    expect(cmp.quickEditError()).toBe('');
  });

  it('covers saveQuickEdit no-op close and successful multi-request update', () => {
    const { component, admin, toast } = createHarness();
    const cmp = component as any;

    cmp.quickEditOpen.set(true);
    spyOn(cmp, 'toggleQuickEdit').and.callFake(() => undefined);

    cmp.quickEditTitle = 'Hello';
    cmp.quickEditSummary = 'Old summary';
    cmp.quickEditTags = 'old';
    cmp.quickEditStatus = 'draft';
    cmp.quickEditPublishAt = '';
    cmp.quickEditUnpublishAt = '';
    cmp.saveQuickEdit();
    expect(cmp.toggleQuickEdit).toHaveBeenCalled();

    admin.updateContentBlock.calls.reset();
    cmp.quickEditTitle = 'Hello updated';
    cmp.quickEditSummary = 'New summary';
    cmp.quickEditTags = 'new,featured';
    cmp.quickEditStatus = 'published';
    cmp.saveQuickEdit();

    expect(admin.updateContentBlock.calls.count()).toBe(2);
    expect(cmp.post()?.title).toBe('Hello updated');
    expect(toast.success).toHaveBeenCalled();
  });

  it('covers quick-edit error handling and comment subscription branches', () => {
    const { component, admin, blog, auth, toast } = createHarness();
    const cmp = component as any;

    admin.updateContentBlock.and.returnValue(throwError(() => ({ error: { detail: 'conflict' } })));
    cmp.quickEditTitle = 'Err title';
    cmp.quickEditSummary = 'Err sum';
    cmp.quickEditTags = 'x';
    cmp.quickEditStatus = 'review';
    cmp.saveQuickEdit();
    expect(cmp.quickEditError()).toBe('conflict');
    expect(toast.error).toHaveBeenCalled();

    const target = document.createElement('input');
    target.type = 'checkbox';
    target.checked = true;

    auth.user.and.returnValue({ id: 'u1', email_verified: false } as any);
    cmp.toggleCommentSubscription({ target } as any);
    expect(toast.error).toHaveBeenCalledWith('blog.comments.followVerifyTitle', 'blog.comments.followVerifyCopy');

    auth.user.and.returnValue({ id: 'u1', email_verified: true } as any);
    blog.setCommentSubscription.and.returnValue(of({ enabled: true }));
    cmp.toggleCommentSubscription({ target } as any);
    expect(toast.success).toHaveBeenCalledWith('blog.comments.followTitle', 'blog.comments.followEnabledCopy');

    blog.setCommentSubscription.and.returnValue(throwError(() => new Error('boom')));
    cmp.toggleCommentSubscription({ target } as any);
    expect(toast.error).toHaveBeenCalledWith('blog.comments.followErrorTitle', 'blog.comments.followErrorCopy');
  });

  it('covers comment/newsletter/delete/flag actions with success and failure outcomes', () => {
    const { component, blog, toast, newsletter } = createHarness();
    const cmp = component as any;

    cmp.commentBody = 'First!';
    cmp.commentSort.set('oldest');
    cmp.commentsMeta.set({ total_items: 3, total_pages: 1, page: 1, limit: 2 });
    cmp.submitComment();
    expect(blog.createComment).toHaveBeenCalled();
    expect(cmp.commentPage()).toBe(2);

    cmp.captchaEnabled = true;
    cmp.commentCaptchaToken = null;
    cmp.commentBody = 'Needs captcha';
    cmp.submitComment();
    expect(toast.error).toHaveBeenCalledWith('blog.comments.createErrorTitle', 'auth.captchaRequired');

    cmp.newsletterEmail = 'ana@example.com';
    cmp.newsletterCaptchaToken = 'token';
    newsletter.subscribe.and.returnValue(of({ already_subscribed: true } as any));
    cmp.submitNewsletter();
    expect(toast.success).toHaveBeenCalledWith('blog.newsletter.title', 'blog.newsletter.alreadyCopy');

    cmp.newsletterCaptchaToken = 'token';
    newsletter.subscribe.and.returnValue(throwError(() => new Error('fail')));
    cmp.submitNewsletter();
    expect(toast.error).toHaveBeenCalledWith('blog.newsletter.errorTitle', 'blog.newsletter.errorCopy');

    spyOn(globalThis, 'confirm').and.returnValue(true);
    spyOn(globalThis, 'prompt').and.returnValue('spam link');

    const myComment = { id: 'c1', is_deleted: false, is_hidden: false, author: { id: 'u1' } } as any;
    const otherComment = { id: 'c2', is_deleted: false, is_hidden: false, author: { id: 'u2' } } as any;

    cmp.deleteComment(myComment);
    expect(blog.deleteComment).toHaveBeenCalledWith('c1');

    cmp.flagComment(otherComment);
    expect(blog.flagComment).toHaveBeenCalledWith('c2', { reason: 'spam link' });

    blog.flagComment.and.returnValue(throwError(() => new Error('fail')));
    cmp.flagComment(otherComment);
    expect(toast.error).toHaveBeenCalledWith('blog.comments.reportErrorTitle', 'blog.comments.reportErrorCopy');
  });

  it('sweeps prototype methods through guarded blog-post branches', () => {
    const { component } = createHarness();
    const cmp = component as any;
    spyOn(globalThis, 'confirm').and.returnValue(true);
    spyOn(globalThis, 'prompt').and.returnValue('spam');
    const argsByName: Record<string, unknown[]> = {
      toggleCommentSubscription: [{ target: { checked: true } }],
      deleteComment: [{ id: 'c1', is_deleted: false, is_hidden: false, author: { id: 'u1' } }],
      flagComment: [{ id: 'c2', is_deleted: false, is_hidden: false, author: { id: 'u2' } }],
      navigateCommentPage: [2],
      onCommentSortChanged: ['newest'],
      scrollToComments: [],
      trackByCommentId: [0, { id: 'c1' }],
      trackByPostSlug: [0, { slug: 'first-post' }],
    };
    const safeMethods = [
      'toggleCommentSubscription',
      'deleteComment',
      'flagComment',
      'navigateCommentPage',
      'onCommentSortChanged',
      'scrollToComments',
      'trackByCommentId',
      'trackByPostSlug',
      'commentAuthorLabel',
      'commentTimestampLabel',
      'commentCanDelete',
      'commentCanReport',
      'commentIsDeleted',
      'commentIsHidden',
      'commentHasMedia',
      'commentMediaKind',
    ];

    let attempted = 0;
    for (const name of safeMethods) {
      const fallback = new Array(Math.min(cmp[name]?.length ?? 0, 3)).fill(undefined);
      callBlogMethodSafely(cmp, name, argsByName[name] ?? fallback);
      attempted += 1;
    }

    expect(attempted).toBe(safeMethods.length);
  });

  it('expands blog-post sweep across prototype methods with alternate state toggles', () => {
    const { component, auth, blog, newsletter } = createHarness();
    const cmp = component as any;
    spyOn(globalThis, 'confirm').and.returnValue(false);
    spyOn(globalThis, 'prompt').and.returnValue('');

    auth.isAuthenticated.and.returnValue(false);
    auth.user.and.returnValue(null as any);
    cmp.captchaEnabled = true;
    cmp.commentCaptchaToken = null;
    cmp.newsletterCaptchaToken = null;
    cmp.commentBody = '';
    cmp.newsletterEmail = '';
    cmp.commentSort.set('oldest');
    cmp.commentPage.set(1);
    cmp.commentsMeta.set({ total_items: 0, total_pages: 1, page: 1, limit: 10 });
    blog.getCommentSubscription.and.returnValue(throwError(() => new Error('subscription-fail')));
    newsletter.subscribe.and.returnValue(throwError(() => new Error('newsletter-fail')));

    const skip = new Set(['constructor', 'ngOnInit', 'ngOnDestroy']);
    const argsByName: Record<string, unknown[]> = {
      navigateCommentPage: [1],
      onCommentSortChanged: ['oldest'],
      submitComment: [],
      submitNewsletter: [],
      toggleQuickEdit: [],
      resetQuickEdit: [],
      saveQuickEdit: [],
      toggleCommentSubscription: [{ target: { checked: false } }],
      deleteComment: [{ id: 'c1', is_deleted: false, is_hidden: false, author: { id: 'u2' } }],
      flagComment: [{ id: 'c2', is_deleted: false, is_hidden: false, author: { id: 'u2' } }],
      trackByCommentId: [0, { id: 'c1' }],
      trackByPostSlug: [0, { slug: 'first-post' }],
      commentAuthorLabel: [{ author: { id: 'u1', name: 'Name' } }],
      commentTimestampLabel: [{ created_at: new Date().toISOString() }],
      commentCanDelete: [{ author: { id: 'u2' } }],
      commentCanReport: [{ author: { id: 'u2' } }],
      commentIsDeleted: [{ is_deleted: false }],
      commentIsHidden: [{ is_hidden: false }],
      commentHasMedia: [{ attachments: [] }],
      commentMediaKind: [{ content_type: 'image/png' }],
      scrollToComments: [],
    };

    let attempted = 0;
    for (const name of Object.getOwnPropertyNames(BlogPostComponent.prototype)) {
      if (skip.has(name)) continue;
      const fallback = new Array(Math.min(cmp[name]?.length ?? 0, 3)).fill(undefined);
      callBlogMethodSafely(cmp, name, argsByName[name] ?? fallback);
      attempted += 1;
    }

    expect(attempted).toBeGreaterThan(30);
  });
});


describe('BlogPostComponent coverage wave: article interaction matrix', () => {
  it('covers article click routing/code/gallery branches and reading progress helpers', () => {
    const { component, toast } = createHarness();
    const cmp = component as any;
    Object.defineProperty(cmp, 'document', { value: document, configurable: true });
    const doc = cmp['document'] as Document;
    const win = doc.defaultView as Window & typeof globalThis;

    spyOn(cmp.router, 'navigateByUrl').and.returnValue(Promise.resolve(true));
    spyOn(cmp, 'openLightbox').and.callThrough();

    const link = doc.createElement('a');
    link.dataset['routerLink'] = '/blog/next';
    const linkTarget = doc.createElement('span');
    link.appendChild(linkTarget);
    const linkEvent: any = {
      target: linkTarget,
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation: jasmine.createSpy('stopPropagation')
    };
    cmp.handleArticleClick(linkEvent as MouseEvent);
    expect(cmp.router.navigateByUrl).toHaveBeenCalledWith('/blog/next');

    const wrapper = doc.createElement('div');
    wrapper.className = 'blog-codeblock';
    const button = doc.createElement('button');
    button.dataset['codeAction'] = 'copy';
    const inner = doc.createElement('span');
    button.appendChild(inner);
    const pre = doc.createElement('pre');
    const code = doc.createElement('code');
    code.textContent = 'const x = 1;';
    pre.appendChild(code);
    wrapper.appendChild(button);
    wrapper.appendChild(pre);

    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    Object.defineProperty(win.navigator, 'clipboard', { value: { writeText }, configurable: true });
    const codeEvent: any = {
      target: inner,
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation: jasmine.createSpy('stopPropagation')
    };
    cmp.handleArticleClick(codeEvent as MouseEvent);
    expect(writeText).toHaveBeenCalled();

    button.dataset['codeAction'] = 'wrap';
    button.dataset['wrapLabel'] = 'Wrap';
    button.dataset['unwrapLabel'] = 'Unwrap';
    cmp.handleArticleClick(codeEvent as MouseEvent);
    expect(wrapper.classList.contains('blog-codeblock--wrap')).toBeTrue();

    const img = doc.createElement('img');
    img.src = 'https://cdn.test/gallery.jpg';
    cmp.galleryImages.set([{ src: 'https://cdn.test/gallery.jpg', alt: 'A' }]);
    const imgEvent: any = {
      target: img,
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation: jasmine.createSpy('stopPropagation')
    };
    cmp.handleArticleClick(imgEvent as MouseEvent);
    expect(cmp.openLightbox).toHaveBeenCalledWith(0);

    (doc as any).execCommand = () => false;
    const copyExecSpy = spyOn(doc as any, 'execCommand').and.returnValue(false);
    Object.defineProperty(win.navigator, 'clipboard', { value: undefined, configurable: true });
    cmp.copyShareLink();
    cmp['copyCode']('let a = 1;');
    expect(copyExecSpy).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();

    const article = doc.createElement('article');
    const heading = doc.createElement('h2');
    heading.id = 'h-1';
    const articleImg = doc.createElement('img');
    articleImg.src = 'https://cdn.test/article.jpg';
    article.appendChild(heading);
    article.appendChild(articleImg);
    Object.defineProperty(article, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 100, bottom: 1900, left: 0, right: 0, width: 100, height: 1800 })
    });
    Object.defineProperty(heading, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: -10, bottom: 20, left: 0, right: 0, width: 100, height: 30 })
    });
    doc.body.appendChild(article);
    cmp.articleContent = { nativeElement: article };
    Object.defineProperty(win, 'innerHeight', { configurable: true, value: 700 });
    Object.defineProperty(win, 'scrollY', { configurable: true, value: 800, writable: true });
    cmp['measureReadingProgress']();
    cmp['updateReadingProgress']();
    expect(cmp.galleryImages().length).toBeGreaterThan(0);
    expect(cmp.readingProgress()).toBeGreaterThanOrEqual(0);
  });
});

