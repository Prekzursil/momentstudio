import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';

import { extractRequestId } from './http-error';

describe('extractRequestId', () => {
  it('returns null for non-HTTP errors', () => {
    expect(extractRequestId(new Error('x'))).toBeNull();
    expect(extractRequestId(null)).toBeNull();
  });

  it('prefers request id from response headers', () => {
    const err = new HttpErrorResponse({
      status: 400,
      headers: new HttpHeaders({ 'X-Request-ID': ' req-123 ' }),
      error: { request_id: 'body-id' },
    });
    expect(extractRequestId(err)).toBe('req-123');
  });

  it('reads request id from nested payload keys', () => {
    const err = new HttpErrorResponse({
      status: 400,
      error: {
        error: {
          requestId: 'nested-id',
        },
      },
    });
    expect(extractRequestId(err)).toBe('nested-id');
  });

  it('ignores blank request ids', () => {
    const err = new HttpErrorResponse({
      status: 400,
      headers: new HttpHeaders({ 'x-request-id': '   ' }),
      error: { request_id: '   ' },
    });
    expect(extractRequestId(err)).toBeNull();
  });
});

