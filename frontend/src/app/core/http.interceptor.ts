import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { ErrorHandlerService } from '../shared/error-handler.service';

export const authAndErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const handler = inject(ErrorHandlerService);
  const authReq = req.clone({
    withCredentials: true
  });

  return next(authReq).pipe(
    catchError((err) => {
      handler.handle(err);
      return throwError(() => err);
    })
  );
};
