import { HttpErrorResponse } from '@angular/common/http';

function readRequestIdValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readRequestIdFromObject(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const direct = readRequestIdValue(obj['request_id']) ?? readRequestIdValue(obj['requestId']);
  if (direct) return direct;
  return readRequestIdFromObject(obj['error']);
}

export function extractRequestId(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) return null;

  const header =
    readRequestIdValue(error.headers?.get('X-Request-ID')) ?? readRequestIdValue(error.headers?.get('x-request-id'));
  if (header) return header;
  return readRequestIdFromObject(error.error);
}
