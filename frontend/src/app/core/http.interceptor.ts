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

  const authReq = req.clone({
    withCredentials: true,
    setHeaders: token ? { Authorization: `Bearer ${token}` } : {}
  });

  return next(authReq).pipe(
    catchError((err) => {
      handler.handle(err);
      return throwError(() => err);
    })
  );
};
