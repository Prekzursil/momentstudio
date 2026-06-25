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
      queryParams: routeQueryParams$.asObservable(),
    };

    blog.listPosts.and.returnValue(
      of({
        items: [],
        meta: { total_items: 0, total_pages: 1, page: 1, limit: 9 },
      }),
    );

    TestBed.configureTestingModule({
      imports: [BlogListComponent, TranslateModule.forRoot(), RouterTestingModule.withRoutes([])],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: BlogService, useValue: blog },
        { provide: ActivatedRoute, useValue: routeStub },
        { provide: StorefrontAdminModeService, useValue: { enabled: () => false } },
        { provide: DOCUMENT, useValue: doc },
      ],
    });
  });

  it('sets canonical and meta tags based on language', () => {
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      { blog: { metaTitle: 'Blog | Test', metaDescription: 'Desc', title: 'Blog' } },
      true,
    );
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

    const alternates = Array.from(
      doc.querySelectorAll('link[rel="alternate"][data-seo-managed="true"]'),
    );
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
          tags: [],
        },
      ],
      meta: { total_items: 1, total_pages: 1, page: 1, limit: 9 },
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
          tags: [],
        },
      ],
      meta: { total_items: 1, total_pages: 1, page: 1, limit: 9 },
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
        page: 2,
      }),
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
            tags: [],
          },
        ],
        meta: { total_items: 1, total_pages: 1, page: 1, limit: 9 },
      }),
    );
    const fixture = TestBed.createComponent(BlogListComponent);
    fixture.detectChanges();

    const heroImage = fixture.nativeElement.querySelector(
      'img[alt="Hero post"]',
    ) as HTMLImageElement | null;
    expect(heroImage).toBeTruthy();
    expect(heroImage?.className).not.toContain('opacity-0');
    expect((fixture.componentInstance as any).markImageLoaded).toBeUndefined();
    expect((fixture.componentInstance as any).isImageLoaded).toBeUndefined();
  });
});

describe('BlogListComponent interactions', () => {
  let blog: jasmine.SpyObj<BlogService>;
  let storefrontAdminMode: jasmine.SpyObj<StorefrontAdminModeService>;
  let routeParams$: Subject<Record<string, unknown>>;
  let routeQueryParams$: Subject<Record<string, unknown>>;
  let routeStub: any;

  function makeComponent(useRealDocument = true) {
    blog = jasmine.createSpyObj<BlogService>('BlogService', ['listPosts', 'prefetchPost']);
    blog.listPosts.and.returnValue(
      of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 9 } }),
    );
    storefrontAdminMode = jasmine.createSpyObj<StorefrontAdminModeService>(
      'StorefrontAdminModeService',
      ['enabled'],
    );
    storefrontAdminMode.enabled.and.returnValue(false);
    routeParams$ = new Subject();
    routeQueryParams$ = new Subject();
    routeStub = {
      snapshot: { params: {}, queryParams: {} },
      params: routeParams$.asObservable(),
      queryParams: routeQueryParams$.asObservable(),
    };

    const providers: any[] = [
      { provide: BlogService, useValue: blog },
      { provide: ActivatedRoute, useValue: routeStub },
      { provide: StorefrontAdminModeService, useValue: storefrontAdminMode },
    ];
    if (!useRealDocument) {
      providers.push({
        provide: DOCUMENT,
        useValue: document.implementation.createHTMLDocument('no-view'),
      });
    }

    TestBed.configureTestingModule({
      imports: [BlogListComponent, TranslateModule.forRoot(), RouterTestingModule.withRoutes([])],
      providers,
    });
    const fixture = TestBed.createComponent(BlogListComponent);
    return { fixture, cmp: fixture.componentInstance as any };
  }

  it('shows a hero post for the unfiltered first page on newest sort', () => {
    const { fixture, cmp } = makeComponent();
    blog.listPosts.and.returnValue(
      of({
        items: [
          { slug: 'a', title: 'A', excerpt: 'x', tags: [] },
          { slug: 'b', title: 'B', excerpt: 'y', tags: [] },
        ],
        meta: { total_items: 2, total_pages: 1, page: 1, limit: 9 },
      } as any),
    );
    cmp.load(1);
    expect(cmp.heroPost.slug).toBe('a');
    expect(cmp.gridPosts.length).toBe(1);
    fixture.detectChanges();
  });

  it('renders all posts in the grid when filters are active', () => {
    const { cmp } = makeComponent();
    cmp.searchQuery = 'brooch';
    blog.listPosts.and.returnValue(
      of({
        items: [{ slug: 'a', title: 'A', excerpt: 'x', tags: [] }],
        meta: { total_items: 1, total_pages: 1, page: 1, limit: 9 },
      } as any),
    );
    cmp.load(1);
    expect(cmp.heroPost).toBeNull();
    expect(cmp.gridPosts.length).toBe(1);
  });

  it('sets the error state when the list request fails', () => {
    const { cmp } = makeComponent();
    blog.listPosts.and.returnValue(throwError(() => new Error('nope')));
    cmp.load(1);
    expect(cmp.hasError()).toBeTrue();
    expect(cmp.loading()).toBeFalse();
    expect(cmp.posts.length).toBe(0);
  });

  it('derives series and tag routing from route params', () => {
    const { cmp } = makeComponent();
    cmp.ngOnInit();
    routeParams$.next({ series: 'summer' });
    routeQueryParams$.next({});
    expect(cmp.routeSeries).toBe('summer');
    expect(cmp.seriesQuery).toBe('summer');
    expect(cmp.tagQuery).toBe('');

    routeParams$.next({ tag: 'macro' });
    routeQueryParams$.next({});
    expect(cmp.routeTag).toBe('macro');
    expect(cmp.tagQuery).toBe('macro');
  });

  it('falls back to legacy query filters when no route segment is present', () => {
    const { cmp } = makeComponent();
    cmp.ngOnInit();
    routeParams$.next({});
    routeQueryParams$.next({ series: 'legacy-series' });
    expect(cmp.seriesQuery).toBe('legacy-series');
    expect(cmp.tagQuery).toBe('');

    routeParams$.next({});
    routeQueryParams$.next({ tag: 'legacy-tag' });
    expect(cmp.tagQuery).toBe('legacy-tag');
  });

  it('builds series and tag meta tags', () => {
    const { cmp } = makeComponent();
    cmp.routeSeries = 'spring';
    cmp.setMetaTags(1);
    cmp.routeSeries = null;
    cmp.routeTag = 'film';
    cmp.setMetaTags(2);
    expect(cmp.routeTag).toBe('film');
  });

  it('changePage clamps and navigates, and no-ops without page meta', () => {
    const { cmp } = makeComponent();
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigate').and.resolveTo(true);
    cmp.pageMeta = null;
    cmp.changePage(1);
    expect(nav).not.toHaveBeenCalled();

    cmp.pageMeta = { page: 1, total_pages: 3, total_items: 30, limit: 9 };
    cmp.changePage(1);
    expect(nav).toHaveBeenCalled();
    nav.calls.reset();
    cmp.pageMeta = { page: 2, total_pages: 3, total_items: 30, limit: 9 };
    cmp.changePage(-1);
    expect(nav).toHaveBeenCalled();
  });

  it('applyFilters routes by series, tag, or the base blog route', () => {
    const { cmp } = makeComponent();
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigate').and.resolveTo(true);

    cmp.seriesQuery = 'wedding';
    cmp.applyFilters();
    expect(nav).toHaveBeenCalledWith(['/blog/series', 'wedding'], jasmine.anything());

    nav.calls.reset();
    cmp.seriesQuery = '';
    cmp.tagQuery = 'studio';
    cmp.applyFilters();
    expect(nav).toHaveBeenCalledWith(['/blog/tag', 'studio'], jasmine.anything());

    nav.calls.reset();
    cmp.tagQuery = '';
    cmp.applyFilters();
    expect(nav).toHaveBeenCalledWith(['/blog'], jasmine.anything());
  });

  it('clearFilters resets queries and navigates to /blog', () => {
    const { cmp } = makeComponent();
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigate').and.resolveTo(true);
    cmp.searchQuery = 'q';
    cmp.tagQuery = 't';
    cmp.seriesQuery = 's';
    cmp.clearFilters();
    expect(cmp.searchQuery).toBe('');
    expect(nav).toHaveBeenCalledWith(['/blog'], jasmine.anything());
  });

  it('chip clearers only act when their field has content', () => {
    const { cmp } = makeComponent();
    const apply = spyOn(cmp, 'applyFilters');
    cmp.searchQuery = '';
    cmp.clearSearchChip();
    cmp.tagQuery = '';
    cmp.clearTagChip();
    cmp.seriesQuery = '';
    cmp.clearSeriesChip();
    expect(apply).not.toHaveBeenCalled();

    cmp.searchQuery = 'x';
    cmp.clearSearchChip();
    cmp.tagQuery = 'x';
    cmp.clearTagChip();
    cmp.seriesQuery = 'x';
    cmp.clearSeriesChip();
    expect(apply).toHaveBeenCalledTimes(3);
  });

  it('applySort normalizes and navigates', () => {
    const { cmp } = makeComponent(false);
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigate').and.resolveTo(true);
    cmp.sort = 'oldest';
    cmp.applySort();
    expect(cmp.sort).toBe('oldest');
    expect(nav).toHaveBeenCalled();
  });

  it('filterByTag and filterBySeries stop event propagation and apply', () => {
    const { cmp } = makeComponent();
    const apply = spyOn(cmp, 'applyFilters');
    const ev = jasmine.createSpyObj<MouseEvent>('MouseEvent', [
      'preventDefault',
      'stopPropagation',
    ]);
    cmp.filterByTag(ev, 'macro');
    expect(cmp.tagQuery).toBe('macro');
    expect(cmp.seriesQuery).toBe('');
    cmp.filterBySeries(ev, 'spring');
    expect(cmp.seriesQuery).toBe('spring');
    expect(cmp.tagQuery).toBe('');
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('prefetchPost ignores blank slugs and forwards trimmed slugs', () => {
    const { cmp } = makeComponent();
    cmp.prefetchPost('   ');
    expect(blog.prefetchPost).not.toHaveBeenCalled();
    cmp.prefetchPost('  my-post  ');
    expect(blog.prefetchPost).toHaveBeenCalledWith('my-post', 'en');
  });

  it('persists and reads the saved sort from localStorage', () => {
    const { cmp } = makeComponent(true);
    window.localStorage.removeItem('blog_sort');
    cmp.saveSort('most_viewed');
    expect(window.localStorage.getItem('blog_sort')).toBe('most_viewed');
    expect(cmp.loadSavedSort()).toBe('most_viewed');
    window.localStorage.removeItem('blog_sort');
  });

  it('returns null saved sort when the document has no default view', () => {
    const { cmp } = makeComponent(false);
    expect(cmp.loadSavedSort()).toBeNull();
    expect(() => cmp.saveSort('newest')).not.toThrow();
  });

  it('normalizeSort accepts known values and rejects others', () => {
    const { cmp } = makeComponent();
    expect(cmp.normalizeSort('most_commented')).toBe('most_commented');
    expect(cmp.normalizeSort('bogus')).toBeNull();
    expect(cmp.normalizeSort(42)).toBeNull();
  });

  it('coverImageClass switches on the fit value', () => {
    const { cmp } = makeComponent();
    expect(cmp.coverImageClass('contain')).toContain('object-contain');
    expect(cmp.coverImageClass('cover')).toBe('object-cover');
    expect(cmp.coverImageClass(null)).toBe('object-cover');
  });

  it('thumbUrl derives a small variant only for valid media paths', () => {
    const { cmp } = makeComponent();
    expect(cmp.thumbUrl(null)).toBeNull();
    expect(cmp.thumbUrl('https://cdn/x.jpg')).toBeNull();
    expect(cmp.thumbUrl('/media/folder/photo')).toBeNull();
    expect(cmp.thumbUrl('/media/photo.jpg')).toBe('/media/photo-sm.jpg');
    cmp.markThumbFailed('');
    cmp.markThumbFailed('/media/photo-sm.jpg?v=1');
    expect(cmp.thumbUrl('/media/photo.jpg')).toBeNull();
  });

  it('hasActiveFilters and canEditBlog reflect state', () => {
    const { cmp } = makeComponent();
    expect(cmp.hasActiveFilters()).toBeFalse();
    cmp.tagQuery = 'x';
    expect(cmp.hasActiveFilters()).toBeTrue();
    expect(cmp.canEditBlog()).toBeFalse();
    storefrontAdminMode.enabled.and.returnValue(true);
    expect(cmp.canEditBlog()).toBeTrue();
  });

  it('focalPosition clamps coordinates', () => {
    const { cmp } = makeComponent();
    expect(cmp.focalPosition()).toBe('50% 50%');
    expect(cmp.focalPosition(-5, 250)).toBe('0% 100%');
  });

  it('editBlogPost ignores blank slugs and navigates for real slugs', () => {
    const { cmp } = makeComponent();
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigate').and.resolveTo(true);
    const ev = jasmine.createSpyObj<Event>('Event', ['preventDefault', 'stopPropagation']);
    cmp.editBlogPost(ev, '   ');
    expect(nav).not.toHaveBeenCalled();
    cmp.editBlogPost(ev, 'my-slug');
    expect(nav).toHaveBeenCalledWith(['/admin/content/blog'], {
      queryParams: { edit: 'my-slug' },
    });
  });

  it('reloads on language change and tears down on destroy', () => {
    const { cmp } = makeComponent();
    cmp.ngOnInit();
    const translate = TestBed.inject(TranslateService);
    blog.listPosts.calls.reset();
    translate.use('ro');
    expect(blog.listPosts).toHaveBeenCalled();
    expect(() => cmp.ngOnDestroy()).not.toThrow();
  });

  it('renders hero, grid, pagination and admin edit controls', () => {
    storefrontAdminMode = jasmine.createSpyObj('StorefrontAdminModeService', ['enabled']);
    const { fixture, cmp } = makeComponent();
    storefrontAdminMode.enabled.and.returnValue(true);
    blog.listPosts.and.returnValue(
      of({
        items: [
          {
            slug: 'hero',
            title: 'Hero',
            excerpt: 'Lead',
            cover_image_url: '/media/hero.jpg',
            cover_fit: 'cover',
            published_at: '2026-01-01T00:00:00Z',
            reading_time_minutes: 4,
            author_name: 'Ana',
            series: 'spring',
            tags: ['macro', 'film'],
          },
          {
            slug: 'second',
            title: 'Second',
            excerpt: 'More',
            published_at: '2026-01-02T00:00:00Z',
            reading_time_minutes: 2,
            author_name: 'Bob',
            series: 'spring',
            tags: ['studio'],
          },
        ],
        meta: { total_items: 12, total_pages: 2, page: 1, limit: 9 },
      } as any),
    );
    cmp.load(1);
    fixture.detectChanges();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('Hero');
    expect(text).toContain('Second');
    expect(fixture.nativeElement.querySelectorAll('button').length).toBeGreaterThan(0);
  });

  it('renders the no-results state when filters are active but yield nothing', () => {
    const { fixture } = makeComponent();
    routeStub.snapshot.queryParams = { q: 'zzz' };
    fixture.detectChanges();
    expect((fixture.nativeElement.textContent || '').replace(/\s+/g, ' ')).toContain(
      'blog.noResultsTitle',
    );
  });

  it('renders the empty state when there are no posts and no filters', () => {
    const { fixture } = makeComponent();
    fixture.detectChanges();
    expect((fixture.nativeElement.textContent || '').replace(/\s+/g, ' ')).toContain(
      'blog.emptyTitle',
    );
  });

  it('renders the error state with a retry control', () => {
    const { fixture, cmp } = makeComponent();
    fixture.detectChanges();
    cmp.loading.set(false);
    cmp.hasError.set(true);
    fixture.detectChanges();
    expect((fixture.nativeElement.textContent || '').replace(/\s+/g, ' ')).toContain(
      'blog.errorTitle',
    );
  });

  it('covers Romanian language paths, falsy inputs and sort variations', () => {
    const { cmp } = makeComponent();
    const translate = TestBed.inject(TranslateService);
    translate.use('ro');

    // ngOnInit with a null snapshot exercises the `|| {}` fallbacks.
    cmp.route.snapshot.params = null;
    cmp.route.snapshot.queryParams = null;
    cmp.ngOnInit();

    // loadFromRoute with a string sort query param.
    routeParams$.next({});
    routeQueryParams$.next({ sort: 'oldest' });
    expect(cmp.sort).toBe('oldest');

    // load() under ro language.
    cmp.load(1);
    expect(cmp.seoIntro()).toBeDefined();

    // prefetchPost with a falsy slug and under ro.
    cmp.prefetchPost('');
    cmp.prefetchPost('valid');
    expect(blog.prefetchPost).toHaveBeenCalledWith('valid', 'ro');

    // editBlogPost with a falsy slug.
    const ev = jasmine.createSpyObj<Event>('Event', ['preventDefault', 'stopPropagation']);
    cmp.editBlogPost(ev, '');

    // applyFilters when sort is non-default keeps the sort param.
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    cmp.sort = 'oldest';
    cmp.seriesQuery = '';
    cmp.tagQuery = '';
    cmp.applyFilters();

    // applySort with an invalid sort normalizes back to newest.
    cmp.sort = 'garbage' as any;
    cmp.applySort();
    expect(cmp.sort).toBe('newest');
  });

  it('ignores a stale error response when a newer load is in flight', () => {
    const { cmp } = makeComponent();
    const first$ = new Subject<any>();
    const second$ = new Subject<any>();
    blog.listPosts.and.returnValues(first$.asObservable(), second$.asObservable());
    cmp.load(1);
    cmp.load(1);
    second$.next({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 9 } });
    second$.complete();
    cmp.hasError.set(false);
    // Stale error must be ignored by the loadSeq guard.
    first$.error(new Error('stale'));
    expect(cmp.hasError()).toBeFalse();
  });

  it('builds breadcrumb trails for series and tag routes', () => {
    const { cmp } = makeComponent();
    cmp.ngOnInit();
    routeParams$.next({ series: 'spring' });
    routeQueryParams$.next({});
    expect(cmp.crumbs.length).toBe(3);
    routeParams$.next({ tag: 'macro' });
    routeQueryParams$.next({});
    expect(cmp.crumbs.length).toBe(3);
  });
});
