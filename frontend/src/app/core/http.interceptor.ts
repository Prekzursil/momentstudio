import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, switchMap } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { ErrorHandlerService } from '../shared/error-handler.service';
import { AuthService } from './auth.service';
import { appConfig } from './app-config';

function getApiBaseUrl(): string {
  return appConfig.apiBaseUrl.replace(/\/$/, '');
}

export const authAndErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const handler = inject(ErrorHandlerService);
  const auth = inject(AuthService);
  const token = auth.getAccessToken();
  const silent = req.headers.has('X-Silent');

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
      const isTwoFactor = req.url === `${apiBase}/auth/login/2fa`;
      const isRegister = req.url === `${apiBase}/auth/register`;
      const isLogout = req.url === `${apiBase}/auth/logout`;
      const isGoogleFlow = req.url.startsWith(`${apiBase}/auth/google/`);
      const isPasswordReset = req.url.startsWith(`${apiBase}/auth/password-reset`);

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
              if (!silent) {
                handler.handle(err);
              }
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

      const suppressGlobalToast = silent || isLogin || isTwoFactor || isRegister || isRefresh || isLogout || isGoogleFlow || isPasswordReset;
      if (!suppressGlobalToast) {
        handler.handle(err);
      }
      return throwError(() => err);
    })
  );
};
