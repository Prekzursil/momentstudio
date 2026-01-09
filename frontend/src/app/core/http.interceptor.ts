import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { ErrorHandlerService } from '../shared/error-handler.service';
import { AuthService } from './auth.service';

export const authAndErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const handler = inject(ErrorHandlerService);
  const auth = inject(AuthService);
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
      handler.handle(err);
      return throwError(() => err);
    })
  );
};
