import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, map, switchMap } from 'rxjs/operators';
import { from, of, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { appConfig } from './app-config';
import { HttpErrorBusService } from './http-error-bus.service';

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
  const token = auth.getAccessToken();
  const stepUpToken = auth.getStepUpToken();
  const hasAuthHeader = req.headers.has('Authorization');
  const hasStepUpHeader = req.headers.has('X-Admin-Step-Up');
  const setHeaders: Record<string, string> = {};
  if (token && !hasAuthHeader) {
    setHeaders['Authorization'] = `Bearer ${token}`;
  }
  if (stepUpToken && !hasStepUpHeader) {
    setHeaders['X-Admin-Step-Up'] = stepUpToken;
  }
  const authReq = req.clone({
    withCredentials: true,
    // Allow callers to explicitly set Authorization (e.g. Google completion token)
    // without it being overwritten by the normal access token.
    setHeaders
  });

  return next(authReq).pipe(
    catchError((err) => {
      const isRefresh = req.url === `${apiBase}/auth/refresh`;
      const isLogin = req.url === `${apiBase}/auth/login`;
      const isRegister = req.url === `${apiBase}/auth/register`;
      const isLogout = req.url === `${apiBase}/auth/logout`;
      const isGoogleFlow = req.url.startsWith(`${apiBase}/auth/google/`);
      const isStepUp = req.url === `${apiBase}/auth/step-up`;

      if (
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        isApiRequest &&
        !hasAuthHeader &&
        !isRefresh &&
        !isLogin &&
        !isRegister &&
        !isLogout &&
        !isGoogleFlow &&
        (auth.getRefreshToken() || auth.getAccessToken() || auth.user())
      ) {
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
      }

      const canAttemptStepUpRetry =
        err instanceof HttpErrorResponse && err.status === 403 && isApiRequest && !isStepUp && !silent && !req.headers.has('X-Step-Up-Retry');

      if (canAttemptStepUpRetry && (auth.getRefreshToken() || auth.getAccessToken() || auth.user())) {
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
                const retryHeaders: Record<string, string> = { 'X-Admin-Step-Up': nextStepUp, 'X-Step-Up-Retry': '1' };
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
      }

      // Global, low-noise error surface:
      // - only network failures (status 0) and 5xx
      // - honor X-Silent to avoid spamming background calls
      if (!silent && err instanceof HttpErrorResponse) {
        const status = err.status ?? 0;
        if (status === 0 || (status >= 500 && status < 600)) {
          errors.emit({ status, method: req.method, url: req.url });
        }
      }

      return throwError(() => err);
    })
  );
};

