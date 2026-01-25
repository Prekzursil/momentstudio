import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ToastService } from './toast.service';
import { AuthService } from './auth.service';
import { catchError, map, of } from 'rxjs';

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const toast = inject(ToastService);
  const auth = inject(AuthService);
  return auth.ensureAuthenticated({ silent: true }).pipe(
    map((ok) => {
      if (ok && auth.isAuthenticated()) return true;
      toast.error('Please sign in to continue.');
      return router.parseUrl('/login');
    }),
    catchError(() => {
      toast.error('Please sign in to continue.');
      return of(router.parseUrl('/login'));
    })
  );
};

export const adminGuard: CanActivateFn = () => {
  const router = inject(Router);
  const toast = inject(ToastService);
  const auth = inject(AuthService);
  return auth.ensureAuthenticated({ silent: true }).pipe(
    map((ok) => {
      if (ok && auth.isAuthenticated() && auth.isStaff()) return true;
      toast.error(ok ? 'Staff access required.' : 'Please sign in to continue.');
      return router.parseUrl('/');
    }),
    catchError(() => {
      toast.error('Staff access required.');
      return of(router.parseUrl('/'));
    })
  );
};

export const adminSectionGuard =
  (section: string): CanActivateFn =>
  () => {
    const router = inject(Router);
    const toast = inject(ToastService);
    const auth = inject(AuthService);
    return auth.ensureAuthenticated({ silent: true }).pipe(
      map((ok) => {
        if (!ok || !auth.isAuthenticated() || !auth.isStaff()) {
          toast.error(ok ? 'Staff access required.' : 'Please sign in to continue.');
          return router.parseUrl('/');
        }
        if (auth.canAccessAdminSection(section)) return true;
        toast.error('You do not have access to this section.');
        return router.parseUrl('/admin/dashboard');
      }),
      catchError(() => {
        toast.error('You do not have access to this section.');
        return of(router.parseUrl('/admin/dashboard'));
      })
    );
  };
