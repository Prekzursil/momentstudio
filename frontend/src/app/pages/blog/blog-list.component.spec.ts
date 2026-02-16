import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Observable, of, Subject } from 'rxjs';

import { BlogListComponent } from './blog-list.component';
import { BlogService } from '../../core/blog.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';

describe('BlogListComponent SEO', () => {
  let meta: jasmine.SpyObj<Meta>;
  let title: jasmine.SpyObj<Title>;
  let blog: jasmine.SpyObj<BlogService>;
  let doc: Document;
  let routeParams$: Subject<Record<string, unknown>>;
  let routeQueryParams$: Subject<Record<string, unknown>>;
  let routeStub: {
    snapshot: { params: Record<string, unknown>; queryParams: Record<string, unknown> };
    params: Observable<Record<string, unknown>>;
    queryParams: Observable<Record<string, unknown>>;
  };

  beforeEach(() => {
    meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    blog = jasmine.createSpyObj<BlogService>('BlogService', ['listPosts']);
    doc = document.implementation.createHTMLDocument('blog-list-test');
    routeParams$ = new Subject<Record<string, unknown>>();
    routeQueryParams$ = new Subject<Record<string, unknown>>();
    routeStub = {
      snapshot: { params: {}, queryParams: {} },
      params: routeParams$.asObservable(),
      queryParams: routeQueryParams$.asObservable()
    };

    blog.listPosts.and.returnValue(
      of({
        items: [],
        meta: { total_items: 0, total_pages: 1, page: 1, limit: 9 }
      })
    );

    TestBed.configureTestingModule({
      imports: [BlogListComponent, TranslateModule.forRoot(), RouterTestingModule.withRoutes([])],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: BlogService, useValue: blog },
        { provide: ActivatedRoute, useValue: routeStub },
        { provide: StorefrontAdminModeService, useValue: { enabled: () => false } },
        { provide: DOCUMENT, useValue: doc }
      ]
    });
  });

  it('sets canonical and meta tags based on language', () => {
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { blog: { metaTitle: 'Blog | Test', metaDescription: 'Desc', title: 'Blog' } }, true);
    translate.use('en');

    const fixture = TestBed.createComponent(BlogListComponent);
    const cmp = fixture.componentInstance as any;
    cmp.load(1);

    expect(title.setTitle).toHaveBeenCalledWith('Blog | Test');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Desc' });

    const canonical = doc.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    expect(canonical).toBeTruthy();
    expect(canonical?.getAttribute('href')).toContain('/blog?lang=en');

    const alternates = Array.from(doc.querySelectorAll('link[rel="alternate"][data-seo-managed="true"]'));
    expect(alternates.length).toBe(3);

    const routeSchema = doc.querySelector('script#seo-route-schema-1');
    expect(routeSchema?.textContent || '').toContain('"CollectionPage"');
  });

  it('ignores stale list responses when multiple loads overlap', () => {
    const fixture = TestBed.createComponent(BlogListComponent);
    const cmp = fixture.componentInstance as any;

    const first$ = new Subject<any>();
    const second$ = new Subject<any>();
    blog.listPosts.and.returnValues(first$.asObservable(), second$.asObservable());

    cmp.load(1);
    cmp.load(1);

    // Newer response lands first.
    second$.next({
      items: [
        {
          slug: 'new-post',
          title: 'New Post',
          excerpt: 'Excerpt',
          tags: []
        }
      ],
      meta: { total_items: 1, total_pages: 1, page: 1, limit: 9 }
    });
    second$.complete();

    expect(cmp.posts.length).toBe(1);
    expect(cmp.posts[0].slug).toBe('new-post');

    // Stale response arrives later and must be ignored.
    first$.next({
      items: [
        {
          slug: 'old-post',
          title: 'Old Post',
          excerpt: 'Excerpt',
          tags: []
        }
      ],
      meta: { total_items: 1, total_pages: 1, page: 1, limit: 9 }
    });
    first$.complete();

    expect(cmp.posts.length).toBe(1);
    expect(cmp.posts[0].slug).toBe('new-post');
  });

  it('loads from route snapshot on first paint before route streams emit', () => {
    routeStub.snapshot.params = { tag: 'featured' };
    routeStub.snapshot.queryParams = { q: 'brosa', page: '2' };
    const fixture = TestBed.createComponent(BlogListComponent);
    fixture.detectChanges();

    expect(blog.listPosts.calls.count()).toBe(1);
    expect(blog.listPosts).toHaveBeenCalledWith(
      jasmine.objectContaining({
        q: 'brosa',
        tag: 'featured',
        page: 2
      })
    );
  });

  it('renders blog covers without delayed opacity gating classes', () => {
    blog.listPosts.and.returnValue(
      of({
        items: [
          {
            slug: 'hero-post',
            title: 'Hero post',
            excerpt: 'Excerpt',
            cover_image_url: '/media/hero.jpg',
            cover_fit: 'contain',
            tags: []
          }
        ],
        meta: { total_items: 1, total_pages: 1, page: 1, limit: 9 }
      })
    );
    const fixture = TestBed.createComponent(BlogListComponent);
    fixture.detectChanges();

    const heroImage = fixture.nativeElement.querySelector('img[alt="Hero post"]') as HTMLImageElement | null;
    expect(heroImage).toBeTruthy();
    expect(heroImage?.className).not.toContain('opacity-0');
    expect((fixture.componentInstance as any).markImageLoaded).toBeUndefined();
    expect((fixture.componentInstance as any).isImageLoaded).toBeUndefined();
  });
});
