import { inject } from '@angular/core';
import { HttpErrorResponse, HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { catchError, map, switchMap } from 'rxjs/operators';
import { from, of, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { appConfig } from './app-config';
import { HttpErrorBusService } from './http-error-bus.service';

const REFRESH_EXCLUDED_PATHS = ['/auth/refresh', '/auth/login', '/auth/register', '/auth/logout'];

function getApiBaseUrl(): string {
  return appConfig.apiBaseUrl.replace(/\/$/, '');
}

function extractErrorCode(err: HttpErrorResponse): string {
  const body = err.error as any;
  if (body && typeof body === 'object' && typeof body.code === 'string') {
    return String(body.code || '');
  }
  if (typeof body === 'string') {
    try {
      const data = JSON.parse(body || '{}');
      return String((data)?.code || '');
    } catch {
      // ignore
    }
  }
  return String(err.headers.get('X-Error-Code') || '');
}

function extractErrorCodeFromBinary(err: HttpErrorResponse) {
  const body = err.error as any;
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return from(body.text()).pipe(
      map((text) => {
        try {
          const data = JSON.parse(text || '{}');
          return String((data)?.code || '');
        } catch {
          return '';
        }
      }),
      catchError(() => of(''))
    );
  }

  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) {
    try {
      const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
      const text = decoder ? decoder.decode(new Uint8Array(body)) : '';
      const data = JSON.parse(text || '{}');
      return of(String((data)?.code || ''));
    } catch {
      return of('');
    }
  }

  return of('');
}

const hasSession = (auth: AuthService): boolean => Boolean(auth.getRefreshToken() || auth.getAccessToken() || auth.user());

const isRefreshExcludedRequest = (url: string, apiBase: string): boolean => {
  if (url.startsWith(`${apiBase}/auth/google/`)) {
    return true;
  }
  return REFRESH_EXCLUDED_PATHS.some((path) => url === `${apiBase}${path}`);
};

const canAttemptRefresh = (err: unknown, req: HttpRequest<unknown>, apiBase: string, isApiRequest: boolean, hasAuthHeader: boolean, auth: AuthService): boolean => {
  if (!(err instanceof HttpErrorResponse)) {
    return false;
  }
  if (err.status !== 401 || !isApiRequest || hasAuthHeader) {
    return false;
  }
  if (isRefreshExcludedRequest(req.url, apiBase)) {
    return false;
  }
  return hasSession(auth);
};

const retryAfterRefresh = (req: HttpRequest<unknown>, next: HttpHandlerFn, auth: AuthService, err: HttpErrorResponse) => {
  return auth.refresh({ silent: true }).pipe(
    switchMap((tokens) => {
      if (!tokens) {
        auth.expireSession();
        return throwError(() => err);
      }

      const nextToken = auth.getAccessToken();
      const retryReq = req.clone({
        withCredentials: true,
        setHeaders: nextToken ? { Authorization: `Bearer ${nextToken}` } : {}
      });
      return next(retryReq);
    }),
    catchError(() => throwError(() => err))
  );
};

const canAttemptStepUpRetry = (err: unknown, req: HttpRequest<unknown>, apiBase: string, isApiRequest: boolean, silent: boolean, auth: AuthService): boolean => {
  if (!(err instanceof HttpErrorResponse)) {
    return false;
  }
  if (err.status !== 403 || !isApiRequest || silent) {
    return false;
  }
  if (req.url === `${apiBase}/auth/step-up`) {
    return false;
  }
  if (req.headers.has('X-Step-Up-Retry')) {
    return false;
  }
  return hasSession(auth);
};

const buildAuthHeaders = (req: HttpRequest<unknown>, auth: AuthService, hasAuthHeader: boolean): Record<string, string> => {
  const token = auth.getAccessToken();
  const stepUpToken = auth.getStepUpToken();
  const hasStepUpHeader = req.headers.has('X-Admin-Step-Up');
  const setHeaders: Record<string, string> = {};

  if (token && !hasAuthHeader) {
    setHeaders['Authorization'] = `Bearer ${token}`;
  }
  if (stepUpToken && !hasStepUpHeader) {
    setHeaders['X-Admin-Step-Up'] = stepUpToken;
  }
  return setHeaders;
};

const retryWithStepUp = (req: HttpRequest<unknown>, next: HttpHandlerFn, auth: AuthService, hasAuthHeader: boolean, err: HttpErrorResponse) => {
  const syncErrorCode = extractErrorCode(err);
  const code$ = syncErrorCode ? of(syncErrorCode) : extractErrorCodeFromBinary(err);

  return code$.pipe(
    switchMap((errorCode) => {
      if (String(errorCode || '').toLowerCase() !== 'step_up_required') {
        return throwError(() => err);
      }

      auth.clearStepUpToken();
      return auth.ensureStepUp({ silent: true }).pipe(
        switchMap((nextStepUp) => {
          if (!nextStepUp) {
            return throwError(() => err);
          }

          const nextToken = auth.getAccessToken();
          const retryHeaders: Record<string, string> = {
            'X-Admin-Step-Up': nextStepUp,
            'X-Step-Up-Retry': '1'
          };
          if (nextToken && !hasAuthHeader) {
            retryHeaders['Authorization'] = `Bearer ${nextToken}`;
          }
          const retryReq = req.clone({
            withCredentials: true,
            setHeaders: retryHeaders
          });
          return next(retryReq);
        }),
        catchError(() => throwError(() => err))
      );
    })
  );
};

const emitGlobalHttpError = (err: unknown, silent: boolean, errors: HttpErrorBusService, req: HttpRequest<unknown>): void => {
  if (silent || !(err instanceof HttpErrorResponse)) {
    return;
  }

  const status = err.status ?? 0;
  if (status === 0 || (status >= 500 && status < 600)) {
    errors.emit({ status, method: req.method, url: req.url });
  }
};

type InterceptorErrorContext = {
  req: HttpRequest<unknown>;
  next: HttpHandlerFn;
  auth: AuthService;
  errors: HttpErrorBusService;
  apiBase: string;
  isApiRequest: boolean;
  hasAuthHeader: boolean;
  silent: boolean;
};

const handleInterceptorError = (err: unknown, context: InterceptorErrorContext) => {
  const { req, next, auth, errors, apiBase, isApiRequest, hasAuthHeader, silent } = context;
  if (canAttemptRefresh(err, req, apiBase, isApiRequest, hasAuthHeader, auth)) {
    return retryAfterRefresh(req, next, auth, err as HttpErrorResponse);
  }
  if (canAttemptStepUpRetry(err, req, apiBase, isApiRequest, silent, auth)) {
    return retryWithStepUp(req, next, auth, hasAuthHeader, err as HttpErrorResponse);
  }

  emitGlobalHttpError(err, silent, errors, req);
  return throwError(() => err);
};

export const authAndErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const apiBase = getApiBaseUrl();
  const absoluteApiBase =
    apiBase.startsWith('/') && typeof location !== 'undefined' ? `${location.origin}${apiBase}` : apiBase;
  const isApiRequest = req.url.startsWith(apiBase) || req.url.startsWith(absoluteApiBase);
  const silent = req.headers.has('X-Silent');

  // IMPORTANT: do not inject AuthService for non-API requests.
  // The i18n loader requests translation JSON via HttpClient during app bootstrap, and
  // injecting services that depend on HttpClient can create a DI cycle that prevents
  // translations from loading (UI shows raw translation keys) and can throw NG0200.
  // Avoid injecting AuthService for non-API requests (e.g. i18n JSON, assets).
  // AuthService depends on HttpClient → interceptors, so injecting it here would create
  // a cyclic dependency during app bootstrap when TranslateHttpLoader makes its first request.
  if (!isApiRequest) {
    return next(req);
  }

  const auth = inject(AuthService);
  const errors = inject(HttpErrorBusService);
  const hasAuthHeader = req.headers.has('Authorization');
  const setHeaders = buildAuthHeaders(req, auth, hasAuthHeader);
  const authReq = req.clone({
    withCredentials: true,
    // Allow callers to explicitly set Authorization (e.g. Google completion token)
    // without it being overwritten by the normal access token.
    setHeaders
  });

  return next(authReq).pipe(
    catchError((err) =>
      handleInterceptorError(err, {
        req,
        next,
        auth,
        errors,
        apiBase,
        isApiRequest,
        hasAuthHeader,
        silent
      })
    )
  );
};
