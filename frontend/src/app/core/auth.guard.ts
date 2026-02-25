import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { ToastService } from './toast.service';
import { AuthService } from './auth.service';
import { catchError, map, of, switchMap } from 'rxjs';

type AdminGuardErrorKind = 'mfa' | 'ip' | 'training' | 'denied';

interface AdminAccessErrorInfo {
  code?: string;
  detail?: string;
}

interface AdminAccessResolutionInput {
  detail?: string;
  section: string;
  stateUrl: string | undefined;
}

type AdminAccessResolution =
  | { allow: true; toastKey: string }
  | { allow: false; redirectPath: string; toastKey: string; toastText?: string };

const ROOT_PATH = '/';
const ADMIN_DASHBOARD_PATH = '/admin/dashboard';

function getPathname(url: string | undefined): string {
  return (url || '').split('?')[0];
}

function resolveAuthFailureMessageKey(ok: boolean): 'errors.signInRequired' | 'errors.staffRequired' {
  return ok ? 'errors.staffRequired' : 'errors.signInRequired';
}

function resolveSectionDeniedRedirectPath(url: string | undefined): string {
  return getPathname(url) === ADMIN_DASHBOARD_PATH ? ROOT_PATH : ADMIN_DASHBOARD_PATH;
}

function isAdminAuthRejected(ok: boolean, auth: AuthService): boolean {
  return !ok || !auth.isAuthenticated() || !auth.isStaff();
}

function extractAdminAccessErrorInfo(err: unknown): AdminAccessErrorInfo {
  const maybeError = err as {
    error?: { code?: string; detail?: string };
    headers?: { get?: (name: string) => string | null | undefined };
  };

  return {
    code: maybeError?.error?.code || maybeError?.headers?.get?.('X-Error-Code') || maybeError?.headers?.get?.('x-error-code') || undefined,
    detail: maybeError?.error?.detail,
  };
}

const ADMIN_ERROR_KIND_BY_CODE: Record<string, AdminGuardErrorKind | undefined> = {
  admin_mfa_required: 'mfa',
  admin_ip_denied: 'ip',
  admin_ip_allowlist: 'ip',
  training_readonly: 'training',
};

const ADMIN_ERROR_KIND_BY_DETAIL: Record<string, AdminGuardErrorKind | undefined> = {
  'Two-factor authentication or passkey required for admin access': 'mfa',
  'Admin access is blocked from this IP address': 'ip',
  'Admin access is restricted to approved IP addresses': 'ip',
};

function resolveIpBypassReturnUrl(stateUrl: string | undefined): string {
  const next = encodeURIComponent(stateUrl || ADMIN_DASHBOARD_PATH);
  return `/admin/ip-bypass?returnUrl=${next}`;
}

function resolveTrainingReadonlyResolution(section: string, stateUrl: string | undefined): AdminAccessResolution {
  if (section === 'dashboard' || getPathname(stateUrl) === ADMIN_DASHBOARD_PATH) {
    return { allow: true, toastKey: 'adminUi.trainingMode.hint' };
  }

  return {
    allow: false,
    redirectPath: ADMIN_DASHBOARD_PATH,
    toastKey: 'adminUi.trainingMode.hint',
  };
}

const ADMIN_ACCESS_ERROR_RESOLVERS: Record<AdminGuardErrorKind, (input: AdminAccessResolutionInput) => AdminAccessResolution> = {
  mfa: () => ({
    allow: false,
    redirectPath: '/account/security',
    toastKey: 'adminUi.security.mfaRequired',
  }),
  ip: ({ stateUrl }) => ({
    allow: false,
    redirectPath: resolveIpBypassReturnUrl(stateUrl),
    toastKey: 'adminUi.ipBypass.restricted',
  }),
  training: ({ section, stateUrl }) => resolveTrainingReadonlyResolution(section, stateUrl),
  denied: ({ detail }) => ({
    allow: false,
    redirectPath: ROOT_PATH,
    toastKey: 'errors.sectionDenied',
    toastText: detail,
  }),
};

function mapAdminAccessErrorKind(error: AdminAccessErrorInfo): AdminGuardErrorKind {
  const code = error.code || '';
  const codeMatch = ADMIN_ERROR_KIND_BY_CODE[code];
  if (codeMatch) {
    return codeMatch;
  }

  const detail = error.detail || '';
  const detailMatch = ADMIN_ERROR_KIND_BY_DETAIL[detail];
  if (detailMatch) {
    return detailMatch;
  }

  return 'denied';
}

function resolveAdminAccessError(
  kind: AdminGuardErrorKind,
  input: AdminAccessResolutionInput
): AdminAccessResolution {
  return ADMIN_ACCESS_ERROR_RESOLVERS[kind](input);
}

function handleAdminAccessError(
  err: unknown,
  section: string,
  stateUrl: string | undefined,
  router: Router,
  toast: ToastService,
  translate: TranslateService
) {
  const error = extractAdminAccessErrorInfo(err);
  const kind = mapAdminAccessErrorKind(error);
  const resolution = resolveAdminAccessError(kind, { detail: error.detail, section, stateUrl });

  if (resolution.allow) {
    toast.error(translate.instant(resolution.toastKey));
    return of(true);
  }

  toast.error(resolution.toastText || translate.instant(resolution.toastKey));
  return of(router.parseUrl(resolution.redirectPath));
}

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
        if (isAdminAuthRejected(ok, auth)) {
          toast.error(translate.instant(resolveAuthFailureMessageKey(ok)));
          return of(router.parseUrl(ROOT_PATH));
        }

        if (!auth.canAccessAdminSection(section)) {
          toast.error(translate.instant('errors.sectionDenied'));
          return of(router.parseUrl(resolveSectionDeniedRedirectPath(state.url)));
        }

        return auth.checkAdminAccess({ silent: true }).pipe(
          map(() => true),
          catchError((err) => handleAdminAccessError(err, section, state.url, router, toast, translate))
        );
      }),
      catchError(() => {
        toast.error(translate.instant('errors.sectionDenied'));
        return of(router.parseUrl(ROOT_PATH));
      })
    );
  };
