import { HttpErrorResponse } from '@angular/common/http';

export function extractRequestId(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) return null;

  const header = error.headers?.get('X-Request-ID') || error.headers?.get('x-request-id');
  if (header && header.trim()) return header.trim();

  const body: unknown = error.error;
  if (!body || typeof body !== 'object') return null;

  const obj = body as Record<string, unknown>;
  const direct = obj['request_id'] ?? obj['requestId'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const nestedError = obj['error'];
  if (nestedError && typeof nestedError === 'object') {
    const nested = nestedError as Record<string, unknown>;
    const candidate = nested['request_id'] ?? nested['requestId'];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }

  return null;
}

