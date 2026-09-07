import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { extractRequestId } from './http-error';

/** Golden WU tip orphan — extractRequestId. */
describe('extractRequestId (golden WU tip5)', () => {
  it('reads request ids from headers and nested bodies', () => {
    const headers = new HttpHeaders({ 'X-Request-ID': 'hdr-1' });
    const err = new HttpErrorResponse({ status: 500, headers });
    expect(extractRequestId(err)).toBe('hdr-1');

    const nested = new HttpErrorResponse({ status: 400, error: { error: { requestId: 'body-2' } } });
    expect(extractRequestId(nested)).toBe('body-2');
    expect(extractRequestId(new Error('nope'))).toBeNull();
  });
});
