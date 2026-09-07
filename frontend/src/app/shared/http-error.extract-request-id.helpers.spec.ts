import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { extractRequestId } from './http-error';

/** Golden WU shared-http-error-message — extractRequestId arms. */
describe('extractRequestId (golden WU)', () => {
  it('returns null for non-http errors', () => {
    expect(extractRequestId(new Error('x'))).toBeNull();
  });

  it('reads trimmed X-Request-ID header', () => {
    const err = new HttpErrorResponse({
      headers: new HttpHeaders({ 'X-Request-ID': ' req-42 ' }),
    });
    expect(extractRequestId(err)).toBe('req-42');
  });

  it('reads request_id from error body', () => {
    const err = new HttpErrorResponse({ error: { request_id: ' body-id ' } });
    expect(extractRequestId(err)).toBe('body-id');
  });
});
