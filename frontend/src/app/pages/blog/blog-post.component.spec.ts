import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { BlogPostComponent } from './blog-post.component';
import { BlogService, BlogPost } from '../../core/blog.service';
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
    blog = jasmine.createSpyObj<BlogService>('BlogService', ['getPost', 'getPreviewPost', 'listComments']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success']);
    markdown = jasmine.createSpyObj<MarkdownService>('MarkdownService', ['render']);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['isAuthenticated', 'user']);
    doc = document.implementation.createHTMLDocument('blog-post-test');

    blog.getPost.and.returnValue(of(post));
    blog.getPreviewPost.and.returnValue(of(post));
    blog.listComments.and.returnValue(of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 50 } }));
    markdown.render.and.returnValue('<p>Body</p>');
    auth.isAuthenticated.and.returnValue(false);
    auth.user.and.returnValue(null);
  });

  function configure(): void {
    TestBed.configureTestingModule({
      imports: [BlogPostComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: BlogService, useValue: blog },
        { provide: ToastService, useValue: toast },
        { provide: MarkdownService, useValue: markdown },
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: { params: of({}), queryParams: of({}) } },
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
    expect(title.setTitle).toHaveBeenCalledWith('Hello | Moment Studio');

    const ogImageCall = meta.updateTag.calls.allArgs().find((args) => args[0]?.property === 'og:image');
    expect(ogImageCall).toBeTruthy();
    expect(ogImageCall?.[0]?.content).toContain('/api/v1/blog/posts/first-post/og.png?lang=en');

    const canonical = doc.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    expect(canonical).toBeTruthy();
    expect(canonical?.getAttribute('href')).toContain('/blog/first-post?lang=en');
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
});
