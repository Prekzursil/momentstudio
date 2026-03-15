import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Observable, of, Subject, throwError } from 'rxjs';

import { BlogListComponent } from './blog-list.component';
import { BlogService } from '../../core/blog.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';

function createBlogListComponentHarness(): { fixture: any; component: any; router: Router } {
  const fixture = TestBed.createComponent(BlogListComponent);
  fixture.detectChanges();
  const component = fixture.componentInstance as any;
  const router = TestBed.inject(Router);
  return { fixture, component, router };
}

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
    expect(canonical?.getAttribute('href')).toContain('/blog');
    expect(canonical?.getAttribute('href')).not.toContain('lang=en');

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


describe('BlogListComponent behavior helpers', () => {
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
    blog = jasmine.createSpyObj<BlogService>('BlogService', ['listPosts', 'prefetchPost']);
    doc = document.implementation.createHTMLDocument('blog-helper-test');
    routeParams$ = new Subject<Record<string, unknown>>();
    routeQueryParams$ = new Subject<Record<string, unknown>>();
    routeStub = {
      snapshot: { params: {}, queryParams: {} },
      params: routeParams$.asObservable(),
      queryParams: routeQueryParams$.asObservable(),
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
        { provide: Title, useValue: jasmine.createSpyObj<Title>('Title', ['setTitle']) },
        { provide: Meta, useValue: jasmine.createSpyObj<Meta>('Meta', ['updateTag']) },
        { provide: BlogService, useValue: blog },
        { provide: ActivatedRoute, useValue: routeStub },
        { provide: StorefrontAdminModeService, useValue: { enabled: () => false } },
        { provide: DOCUMENT, useValue: doc },
      ],
    });
  });


  it('switches between hero and grid based on active filters and sort', () => {
    const response = {
      items: [
        { slug: 'hero', title: 'Hero', excerpt: 'E', tags: [] },
        { slug: 'grid', title: 'Grid', excerpt: 'E', tags: [] }
      ],
      meta: { total_items: 2, total_pages: 1, page: 1, limit: 9 }
    };
    blog.listPosts.and.returnValue(of(response as any));

    const { component } = createBlogListComponentHarness();
    component.searchQuery = '';
    component.tagQuery = '';
    component.seriesQuery = '';
    component.sort = 'newest';
    component.load(1);
    expect(component.heroPost?.slug).toBe('hero');
    expect(component.gridPosts.length).toBe(1);

    component.searchQuery = 'query';
    component.load(1);
    expect(component.heroPost).toBeNull();
    expect(component.gridPosts.length).toBe(2);
  });

  it('sets error state when list load fails', () => {
    blog.listPosts.and.returnValue(throwError(() => new Error('fail')));
    const { component } = createBlogListComponentHarness();

    component.load(2);

    expect(component.loading()).toBeFalse();
    expect(component.hasError()).toBeTrue();
    expect(component.pageMeta).toBeNull();
    expect(component.posts).toEqual([]);
  });

  it('applies filter navigation branches and chip clear guards', () => {
    const { component, router } = createBlogListComponentHarness();
    const navigateSpy = spyOn(router, 'navigate').and.resolveTo(true);

    component.searchQuery = 'a';
    component.seriesQuery = 'series-one';
    component.tagQuery = 'tag-one';
    component.applyFilters();
    expect(navigateSpy).toHaveBeenCalledWith(['/blog/series', 'series-one'], jasmine.any(Object));

    component.seriesQuery = '';
    component.tagQuery = 'tag-two';
    component.applyFilters();
    expect(navigateSpy).toHaveBeenCalledWith(['/blog/tag', 'tag-two'], jasmine.any(Object));

    component.tagQuery = '';
    component.applyFilters();
    expect(navigateSpy).toHaveBeenCalledWith(['/blog'], jasmine.any(Object));

    component.searchQuery = '';
    component.clearSearchChip();
    component.tagQuery = '';
    component.clearTagChip();
    component.seriesQuery = '';
    component.clearSeriesChip();

    component.searchQuery = 'x';
    component.clearSearchChip();
    component.tagQuery = 'x';
    component.clearTagChip();
    component.seriesQuery = 'x';
    component.clearSeriesChip();

    expect(navigateSpy.calls.count()).toBeGreaterThan(3);
  });

  it('handles sort, paging, thumbnail fallback, and edit/prefetch helpers', () => {
    const { component, router } = createBlogListComponentHarness();
    const navigateSpy = spyOn(router, 'navigate').and.resolveTo(true);

    component.pageMeta = { total_items: 10, total_pages: 2, page: 2, limit: 9 };
    component.changePage(-1);
    component.changePage(9);
    expect(navigateSpy.calls.count()).toBe(2);

    component.sort = 'invalid';
    component.applySort();
    expect(component.sort).toBe('newest');

    const thumb = component.thumbUrl('/media/photo.jpg?v=1');
    expect(thumb).toContain('-sm.jpg');
    component.markThumbFailed(thumb);
    expect(component.thumbUrl('/media/photo.jpg?v=1')).toBeNull();
    expect(component.coverImageClass('contain')).toContain('object-contain');
    expect(component.focalPosition(120, -20)).toBe('100% 0%');

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    spyOn(event, 'preventDefault').and.callThrough();
    spyOn(event, 'stopPropagation').and.callThrough();
    component.editBlogPost(event, 'entry-1');
    component.prefetchPost('entry-1');

    expect(blog.prefetchPost).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });
});
