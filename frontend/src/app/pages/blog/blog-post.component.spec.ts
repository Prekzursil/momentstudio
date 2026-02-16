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
    summary: 'Summary'
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
      'getCommentSubscription'
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success']);
    markdown = jasmine.createSpyObj<MarkdownService>('MarkdownService', ['render']);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['isAuthenticated', 'user']);
    doc = document.implementation.createHTMLDocument('blog-post-test');

    blog.getPost.and.returnValue(of(post));
    blog.getPreviewPost.and.returnValue(of(post));
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

  function configure(): void {
    TestBed.configureTestingModule({
      imports: [BlogPostComponent, TranslateModule.forRoot(), RouterTestingModule.withRoutes([])],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: BlogService, useValue: blog },
        { provide: AdminService, useValue: jasmine.createSpyObj<AdminService>('AdminService', ['getContent', 'updateContentBlock']) },
        { provide: CatalogService, useValue: jasmine.createSpyObj<CatalogService>('CatalogService', ['getProduct', 'listCategories', 'listFeaturedCollections']) },
        { provide: NewsletterService, useValue: jasmine.createSpyObj<NewsletterService>('NewsletterService', ['subscribe']) },
        { provide: ToastService, useValue: toast },
        { provide: MarkdownService, useValue: markdown },
        { provide: StorefrontAdminModeService, useValue: { enabled: () => false } },
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: routeStub },
        { provide: DOCUMENT, useValue: doc }
      ]
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { blog: { post: { metaTitle: 'Blog post', metaDescription: 'Desc' } } }, true);
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
});
