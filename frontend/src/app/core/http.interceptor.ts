import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { ToastService } from './toast.service';

export const authAndErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);
  const authReq = req.clone({
    withCredentials: true
  });

  return next(authReq).pipe(
    catchError((err) => {
      toast.error('Request failed', err?.message ?? 'Unknown error');
      return throwError(() => err);
    })
  );
};
