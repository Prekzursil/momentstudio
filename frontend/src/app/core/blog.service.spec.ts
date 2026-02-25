import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ApiService } from './api.service';
import { BlogService } from './blog.service';

function expectListPostsForwardsQueryParams(service: BlogService, httpMock: HttpTestingController): void {
  service.listPosts({ lang: 'en', page: 2, limit: 5, q: 'hello', tag: 'news' }).subscribe((resp) => {
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
}

function expectCreatePreviewTokenEncodesLangAndExpiry(service: BlogService, httpMock: HttpTestingController): void {
  service.createPreviewToken('hello-world', { lang: 'ro', expires_minutes: 15 }).subscribe((resp) => {
    expect(resp.token).toBe('t');
    expect(resp.url).toContain('preview=t');
  });

  const req = httpMock.expectOne('/api/v1/blog/posts/hello-world/preview-token?lang=ro&expires_minutes=15');
  expect(req.request.method).toBe('POST');
  req.flush({
    token: 't',
    expires_at: '2000-01-01T00:00:00+00:00',
    url: 'http://localhost:4200/blog/hello-world?preview=t&lang=ro'
  });
}

function expectListMyCommentsForwardsPagination(service: BlogService, httpMock: HttpTestingController): void {
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
}

describe('BlogService', () => {
  let service: BlogService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ApiService, BlogService]
    });
    service = TestBed.inject(BlogService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('listPosts forwards query params', () => {
    expectListPostsForwardsQueryParams(service, httpMock);
  });

  it('createPreviewToken encodes lang and expiry in the URL', () => {
    expectCreatePreviewTokenEncodesLangAndExpiry(service, httpMock);
  });

  it('listMyComments forwards pagination and lang', () => {
    expectListMyCommentsForwardsPagination(service, httpMock);
  });
});
