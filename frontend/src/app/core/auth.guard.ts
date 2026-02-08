import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { ToastService } from './toast.service';
import { AuthService } from './auth.service';
import { catchError, map, of, switchMap } from 'rxjs';

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const toast = inject(ToastService);
  const auth = inject(AuthService);
  const translate = inject(TranslateService);
  return auth.ensureAuthenticated({ silent: true }).pipe(
    map((ok) => {
      if (ok && auth.isAuthenticated()) return true;
      toast.error(translate.instant('errors.signInRequired'));
      return router.parseUrl('/login');
    }),
    catchError(() => {
      toast.error(translate.instant('errors.signInRequired'));
      return of(router.parseUrl('/login'));
    })
  );
};

export const adminGuard: CanActivateFn = () => {
  const router = inject(Router);
  const toast = inject(ToastService);
  const auth = inject(AuthService);
  const translate = inject(TranslateService);
  return auth.ensureAuthenticated({ silent: true }).pipe(
    map((ok) => {
      if (ok && auth.isAuthenticated() && auth.isStaff()) return true;
      toast.error(translate.instant(ok ? 'errors.staffRequired' : 'errors.signInRequired'));
      return router.parseUrl('/');
    }),
    catchError(() => {
      toast.error(translate.instant('errors.staffRequired'));
      return of(router.parseUrl('/'));
    })
  );
};

export const adminSectionGuard =
  (section: string): CanActivateFn =>
  (_route, state) => {
    const router = inject(Router);
    const toast = inject(ToastService);
    const auth = inject(AuthService);
    const translate = inject(TranslateService);
    return auth.ensureAuthenticated({ silent: true }).pipe(
      switchMap((ok) => {
        if (!ok || !auth.isAuthenticated() || !auth.isStaff()) {
          toast.error(translate.instant(ok ? 'errors.staffRequired' : 'errors.signInRequired'));
          return of(router.parseUrl('/'));
        }
        if (!auth.canAccessAdminSection(section)) {
          toast.error(translate.instant('errors.sectionDenied'));
          return of(router.parseUrl('/admin/dashboard'));
        }
        return auth.checkAdminAccess({ silent: true }).pipe(
          map(() => true),
          catchError((err) => {
            const code = err?.error?.code || err?.headers?.get?.('X-Error-Code') || err?.headers?.get?.('x-error-code');
            const detail = err?.error?.detail;
            if (code === 'admin_mfa_required' || detail === 'Two-factor authentication or passkey required for admin access') {
              toast.error(translate.instant('adminUi.security.mfaRequired'));
              return of(router.parseUrl('/account/security'));
            }
            if (
              code === 'admin_ip_denied' ||
              code === 'admin_ip_allowlist' ||
              detail === 'Admin access is blocked from this IP address' ||
              detail === 'Admin access is restricted to approved IP addresses'
            ) {
              toast.error(translate.instant('adminUi.ipBypass.restricted'));
              const next = encodeURIComponent(state.url || '/admin/dashboard');
              return of(router.parseUrl(`/admin/ip-bypass?returnUrl=${next}`));
            }
            if (code === 'training_readonly') {
              toast.error(translate.instant('adminUi.trainingMode.hint'));
              return of(router.parseUrl('/admin/dashboard'));
            }
            toast.error(detail || translate.instant('errors.sectionDenied'));
            return of(router.parseUrl('/'));
          })
        );
      })
      ,
      catchError(() => {
        toast.error(translate.instant('errors.sectionDenied'));
        return of(router.parseUrl('/'));
      })
    );
  };
