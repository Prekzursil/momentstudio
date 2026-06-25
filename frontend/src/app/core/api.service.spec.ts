import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { HttpEventType } from '@angular/common/http';

import { ApiService } from './api.service';

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ApiService],
    });
    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('get sends a GET with built params and custom headers', () => {
    service
      .get(
        '/things',
        { q: 'a', n: 2, flag: true, ids: ['x', 'y'], skip: undefined },
        { 'X-A': '1' },
      )
      .subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/things');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('a');
    expect(req.request.params.get('n')).toBe('2');
    expect(req.request.params.get('flag')).toBe('true');
    expect(req.request.params.getAll('ids')).toEqual(['x', 'y']);
    expect(req.request.params.has('skip')).toBeFalse();
    expect(req.request.headers.get('X-A')).toBe('1');
    req.flush({});
  });

  it('get works without params', () => {
    service.get('/plain').subscribe();
    const req = httpMock.expectOne('/api/v1/plain');
    expect(req.request.params.keys().length).toBe(0);
    req.flush({});
  });

  it('post sends a POST body with params', () => {
    service.post('/create', { name: 'x' }, undefined, { page: 1 }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/create');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'x' });
    expect(req.request.params.get('page')).toBe('1');
    req.flush({});
  });

  it('postWithProgress reports upload events', (done) => {
    service.postWithProgress('/upload', { f: 1 }).subscribe((event) => {
      if (event.type === HttpEventType.Response) {
        done();
      }
    });
    const req = httpMock.expectOne('/api/v1/upload');
    expect(req.request.reportProgress).toBeTrue();
    req.flush({ ok: true });
  });

  it('put sends a PUT body', () => {
    service.put('/p/1', { a: 1 }).subscribe();
    const req = httpMock.expectOne('/api/v1/p/1');
    expect(req.request.method).toBe('PUT');
    req.flush({});
  });

  it('patch sends a PATCH body', () => {
    service.patch('/p/1', { a: 1 }).subscribe();
    const req = httpMock.expectOne('/api/v1/p/1');
    expect(req.request.method).toBe('PATCH');
    req.flush({});
  });

  it('delete without body omits request body', () => {
    service.delete('/p/1').subscribe();
    const req = httpMock.expectOne('/api/v1/p/1');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toBeNull();
    req.flush({});
  });

  it('delete with body attaches the body', () => {
    service.delete('/p/1', undefined, undefined, { reason: 'x' }).subscribe();
    const req = httpMock.expectOne('/api/v1/p/1');
    expect(req.request.body).toEqual({ reason: 'x' });
    req.flush({});
  });

  it('getBlob requests a blob response', () => {
    service.getBlob('/file', { id: 1 }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/file');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x']));
  });

  it('postBlob requests a blob response', () => {
    service.postBlob('/file', { id: 1 }).subscribe();
    const req = httpMock.expectOne('/api/v1/file');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x']));
  });

  it('buildParams skips null values', () => {
    service.get('/n', { keep: 'yes', drop: null as unknown as undefined }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/n');
    expect(req.request.params.get('keep')).toBe('yes');
    expect(req.request.params.has('drop')).toBeFalse();
    req.flush({});
  });
});
