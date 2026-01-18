import { inject } from '@angular/core';
import { HttpBackend, HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, finalize, shareReplay, switchMap, tap } from 'rxjs/operators';
import { Observable, throwError } from 'rxjs';
import { ErrorHandlerService } from '../shared/error-handler.service';
import { AuthService, AuthTokens } from './auth.service';
import { appConfig } from './app-config';

let refreshInFlight: Observable<AuthTokens> | null = null;

function getApiBaseUrl(): string {
  return appConfig.apiBaseUrl.replace(/\/$/, '');
}

function refreshTokens(rawHttp: HttpClient, auth: AuthService): Observable<AuthTokens> {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = auth.getRefreshToken();
  if (!refreshToken) {
    return throwError(() => new Error('No refresh token available'));
  }
  const apiBase = getApiBaseUrl();
  refreshInFlight = rawHttp
    .post<AuthTokens>(`${apiBase}/auth/refresh`, { refresh_token: refreshToken }, { withCredentials: true })
    .pipe(
      tap((tokens) => auth.setTokens(tokens)),
      finalize(() => {
        refreshInFlight = null;
      }),
      shareReplay(1)
    );
  return refreshInFlight;
}

export const authAndErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const handler = inject(ErrorHandlerService);
  const auth = inject(AuthService);
  const backend = inject(HttpBackend);
  const rawHttp = new HttpClient(backend);
  const token = auth.getAccessToken();

  const hasAuthHeader = req.headers.has('Authorization');
  const authReq = req.clone({
    withCredentials: true,
    // Allow callers to explicitly set Authorization (e.g. Google completion token)
    // without it being overwritten by the normal access token.
    setHeaders: token && !hasAuthHeader ? { Authorization: `Bearer ${token}` } : {}
  });

  return next(authReq).pipe(
    catchError((err) => {
      const apiBase = getApiBaseUrl();
      const isApiRequest = req.url.startsWith(apiBase);
      const isRefresh = req.url === `${apiBase}/auth/refresh`;
      const isLogin = req.url === `${apiBase}/auth/login`;
      const isRegister = req.url === `${apiBase}/auth/register`;
      const isLogout = req.url === `${apiBase}/auth/logout`;
      const isGoogleFlow = req.url.startsWith(`${apiBase}/auth/google/`);

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
        auth.getRefreshToken()
      ) {
        return refreshTokens(rawHttp, auth).pipe(
          switchMap(() => {
            const nextToken = auth.getAccessToken();
            const retryReq = req.clone({
              withCredentials: true,
              setHeaders: nextToken ? { Authorization: `Bearer ${nextToken}` } : {}
            });
            return next(retryReq);
          }),
          catchError((refreshErr) => {
            auth.expireSession();
            handler.handle(refreshErr);
            return throwError(() => err);
          })
        );
      }

      handler.handle(err);
      return throwError(() => err);
    })
  );
};
