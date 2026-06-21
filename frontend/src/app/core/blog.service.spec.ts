import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ApiService } from './api.service';
import { BlogService } from './blog.service';

describe('BlogService', () => {
  let service: BlogService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ApiService, BlogService],
    });
    service = TestBed.inject(BlogService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('listPosts forwards query params', () => {
    service
      .listPosts({ lang: 'en', page: 2, limit: 5, q: 'hello', tag: 'news' })
      .subscribe((resp) => {
        expect(resp.items.length).toBe(0);
        expect(resp.meta.page).toBe(2);
      });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/blog/posts');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('lang')).toBe('en');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('limit')).toBe('5');
    expect(req.request.params.get('q')).toBe('hello');
    expect(req.request.params.get('tag')).toBe('news');
    req.flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 2, limit: 5 } });
  });

  it('createPreviewToken encodes lang and expiry in the URL', () => {
    service
      .createPreviewToken('hello-world', { lang: 'ro', expires_minutes: 15 })
      .subscribe((resp) => {
        expect(resp.token).toBe('t');
        expect(resp.url).toContain('preview=t');
      });

    const req = httpMock.expectOne(
      '/api/v1/blog/posts/hello-world/preview-token?lang=ro&expires_minutes=15',
    );
    expect(req.request.method).toBe('POST');
    req.flush({
      token: 't',
      expires_at: '2000-01-01T00:00:00+00:00',
      url: 'http://localhost:4200/blog/hello-world?preview=t&lang=ro',
    });
  });

  it('listMyComments forwards pagination and lang', () => {
    service.listMyComments({ lang: 'ro', page: 3, limit: 15 }).subscribe((resp) => {
      expect(resp.items.length).toBe(0);
      expect(resp.meta.page).toBe(3);
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/blog/me/comments');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('lang')).toBe('ro');
    expect(req.request.params.get('page')).toBe('3');
    expect(req.request.params.get('limit')).toBe('15');
    req.flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 3, limit: 15 } });
  });

  it('listPosts applies default page/limit and empty params', () => {
    service.listPosts({}).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/blog/posts');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('limit')).toBe('10');
    req.flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 10 } });
  });

  it('serves a cached list response without a second request', () => {
    service.listPosts({ lang: 'en' }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/blog/posts');
    req.flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 10 } });
    // Second call with the same key uses the cache -> no new HTTP request.
    service.listPosts({ lang: 'en' }).subscribe((resp) => expect(resp.items).toEqual([]));
    httpMock.verify();
  });

  it('evicts a failed cache entry so a retry re-requests', () => {
    let firstErr: unknown;
    service.getPost('p1').subscribe({ error: (e) => (firstErr = e) });
    httpMock
      .expectOne((r) => r.url === '/api/v1/blog/posts/p1')
      .flush({ detail: 'boom' }, { status: 500, statusText: 'Server Error' });
    expect(firstErr).toBeTruthy();

    // The error path deletes the cache key, so a retry issues a fresh request.
    service.getPost('p1').subscribe();
    httpMock.expectOne((r) => r.url === '/api/v1/blog/posts/p1').flush({ slug: 'p1' });
  });

  it('getPost and getNeighbors forward lang', () => {
    service.getPost('p1', 'ro').subscribe();
    const post = httpMock.expectOne((r) => r.url === '/api/v1/blog/posts/p1');
    expect(post.request.params.get('lang')).toBe('ro');
    post.flush({ slug: 'p1' });

    service.getNeighbors('p1', 'ro').subscribe();
    const nb = httpMock.expectOne((r) => r.url === '/api/v1/blog/posts/p1/neighbors');
    expect(nb.request.params.get('lang')).toBe('ro');
    nb.flush({ previous: null, next: null });
  });

  it('getPreviewPost forwards token and lang', () => {
    service.getPreviewPost('p1', 'tok', 'en').subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/blog/posts/p1/preview');
    expect(req.request.params.get('token')).toBe('tok');
    expect(req.request.params.get('lang')).toBe('en');
    req.flush({ slug: 'p1' });
  });

  it('prefetchPost fetches post and neighbors and swallows errors', () => {
    service.prefetchPost('p1', 'en');
    httpMock
      .expectOne((r) => r.url === '/api/v1/blog/posts/p1')
      .flush({ detail: 'no' }, { status: 500, statusText: 'Server Error' });
    httpMock
      .expectOne((r) => r.url === '/api/v1/blog/posts/p1/neighbors')
      .flush({ detail: 'no' }, { status: 500, statusText: 'Server Error' });
    expect(true).toBeTrue();
  });

  it('createPreviewToken omits the query string when no params are given', () => {
    service.createPreviewToken('p1').subscribe();
    const req = httpMock.expectOne('/api/v1/blog/posts/p1/preview-token');
    expect(req.request.method).toBe('POST');
    req.flush({ token: 't', expires_at: 'x', url: 'u' });
  });

  it('comment list/thread/subscription endpoints use defaults and X-Silent', () => {
    service.listComments('p1').subscribe();
    const c = httpMock.expectOne((r) => r.url === '/api/v1/blog/posts/p1/comments');
    expect(c.request.params.get('page')).toBe('1');
    expect(c.request.params.get('limit')).toBe('50');
    expect(c.request.headers.get('X-Silent')).toBe('1');
    c.flush({ items: [], meta: {} });

    service.listCommentThreads('p1').subscribe();
    const t = httpMock.expectOne((r) => r.url === '/api/v1/blog/posts/p1/comment-threads');
    expect(t.request.params.get('sort')).toBe('newest');
    t.flush({ items: [], meta: {}, total_comments: 0 });

    service.getCommentSubscription('p1').subscribe();
    httpMock
      .expectOne((r) => r.url === '/api/v1/blog/posts/p1/comment-subscription')
      .flush({ enabled: false });

    service.setCommentSubscription('p1', true).subscribe();
    const put = httpMock.expectOne((r) => r.url === '/api/v1/blog/posts/p1/comment-subscription');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ enabled: true });
    put.flush({ enabled: true });
  });

  it('comment mutation endpoints map correctly', () => {
    service.createComment('p1', { body: 'hi' }).subscribe();
    httpMock.expectOne('/api/v1/blog/posts/p1/comments').flush({ id: 'c1' });

    service.deleteComment('c1').subscribe();
    const del = httpMock.expectOne('/api/v1/blog/comments/c1');
    expect(del.request.method).toBe('DELETE');
    del.flush(null);

    service.flagComment('c1', { reason: 'spam' }).subscribe();
    httpMock.expectOne('/api/v1/blog/comments/c1/flag').flush({ id: 'f1' });
  });

  it('admin comment endpoints map correctly', () => {
    service.listFlaggedComments({ page: 2 }).subscribe();
    const flagged = httpMock.expectOne((r) => r.url === '/api/v1/blog/admin/comments/flagged');
    expect(flagged.request.params.get('page')).toBe('2');
    flagged.flush({ items: [], meta: {} });

    service.hideCommentAdmin('c1', { reason: 'x' }).subscribe();
    httpMock.expectOne('/api/v1/blog/admin/comments/c1/hide').flush({ id: 'c1' });

    service.hideCommentAdmin('c1').subscribe();
    httpMock.expectOne('/api/v1/blog/admin/comments/c1/hide').flush({ id: 'c1' });

    service.unhideCommentAdmin('c1').subscribe();
    httpMock.expectOne('/api/v1/blog/admin/comments/c1/unhide').flush({ id: 'c1' });

    service.resolveCommentFlagsAdmin('c1').subscribe();
    httpMock.expectOne('/api/v1/blog/admin/comments/c1/resolve-flags').flush({ resolved: 2 });
  });

  it('listMyComments uses defaults when called with no params', () => {
    service.listMyComments().subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/blog/me/comments');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('limit')).toBe('20');
    req.flush({ items: [], meta: {} });
  });

  it('getNeighbors works without a lang', () => {
    service.getNeighbors('p2').subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/blog/posts/p2/neighbors');
    expect(req.request.params.has('lang')).toBeFalse();
    req.flush({ previous: null, next: null });
  });

  it('getPost works without a lang', () => {
    service.getPost('p3').subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/blog/posts/p3');
    expect(req.request.params.has('lang')).toBeFalse();
    req.flush({ slug: 'p3' });
  });

  it('listFlaggedComments uses defaults when called with no params', () => {
    service.listFlaggedComments().subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/blog/admin/comments/flagged');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('limit')).toBe('20');
    req.flush({ items: [], meta: {} });
  });

  it('prunes expired cache entries once the cache grows past its cap', () => {
    let now = 1_000_000;
    spyOn(Date, 'now').and.callFake(() => now);

    // Seed > 200 distinct, already-expired list cache entries.
    for (let i = 0; i < 205; i += 1) {
      service.listPosts({ q: `seed-${i}` }).subscribe();
      httpMock
        .expectOne((r) => r.url === '/api/v1/blog/posts')
        .flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 10 } });
    }

    // Advance time so all seeded entries are expired, then add one more entry
    // which triggers the eviction sweep.
    now += 10 * 60 * 1000;
    service.listPosts({ q: 'trigger' }).subscribe();
    httpMock
      .expectOne((r) => r.url === '/api/v1/blog/posts')
      .flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 10 } });

    // A previously-seeded (now pruned) key must re-issue a request.
    service.listPosts({ q: 'seed-0' }).subscribe();
    httpMock
      .expectOne((r) => r.url === '/api/v1/blog/posts')
      .flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 10 } });
  });
});
