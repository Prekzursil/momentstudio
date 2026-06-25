import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';

import { extractRequestId } from './http-error';

function makeError(init: { headers?: HttpHeaders; error?: unknown }): HttpErrorResponse {
  return new HttpErrorResponse({
    headers: init.headers,
    error: init.error,
    status: 500,
    statusText: 'Server Error',
  });
}

describe('extractRequestId', () => {
  it('returns null for non-HttpErrorResponse values', () => {
    expect(extractRequestId(new Error('boom'))).toBeNull();
    expect(extractRequestId('nope')).toBeNull();
    expect(extractRequestId(null)).toBeNull();
  });

  it('reads X-Request-ID header (canonical casing)', () => {
    const error = makeError({ headers: new HttpHeaders({ 'X-Request-ID': '  req-1  ' }) });
    expect(extractRequestId(error)).toBe('req-1');
  });

  it('reads x-request-id header (lowercase fallback)', () => {
    const error = makeError({ headers: new HttpHeaders({ 'x-request-id': 'req-low' }) });
    expect(extractRequestId(error)).toBe('req-low');
  });

  it('ignores a blank header and falls through to the body', () => {
    const error = makeError({
      headers: new HttpHeaders({ 'X-Request-ID': '   ' }),
      error: { request_id: 'body-req' },
    });
    expect(extractRequestId(error)).toBe('body-req');
  });

  it('returns null when there is no header and no usable body', () => {
    expect(extractRequestId(makeError({ error: null }))).toBeNull();
    expect(extractRequestId(makeError({ error: 'a string body' }))).toBeNull();
  });

  it('reads request_id directly from the body', () => {
    expect(extractRequestId(makeError({ error: { request_id: '  direct  ' } }))).toBe('direct');
  });

  it('reads requestId (camelCase) from the body', () => {
    expect(extractRequestId(makeError({ error: { requestId: 'camel' } }))).toBe('camel');
  });

  it('ignores a blank direct value and inspects the nested error', () => {
    const error = makeError({ error: { request_id: '   ', error: { request_id: 'nested' } } });
    expect(extractRequestId(error)).toBe('nested');
  });

  it('reads requestId from a nested error object', () => {
    const error = makeError({ error: { error: { requestId: 'nested-camel' } } });
    expect(extractRequestId(error)).toBe('nested-camel');
  });

  it('returns null when the nested error has no usable id', () => {
    expect(extractRequestId(makeError({ error: { error: { request_id: '  ' } } }))).toBeNull();
    expect(extractRequestId(makeError({ error: { error: 'not-an-object' } }))).toBeNull();
    expect(extractRequestId(makeError({ error: { error: null } }))).toBeNull();
  });

  it('returns null when ids are present but not strings', () => {
    expect(extractRequestId(makeError({ error: { request_id: 123 } }))).toBeNull();
  });
});
