import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { of, throwError, firstValueFrom, isObservable } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';

import { adminGuard, adminSectionGuard, authGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

describe('auth/admin guards', () => {
  const toast = {
    error: jasmine.createSpy('error')
  };

  const translate = {
    instant: (key: string) => key
  };

  const authMock = {
    ensureAuthenticated: jasmine.createSpy('ensureAuthenticated'),
    isAuthenticated: jasmine.createSpy('isAuthenticated'),
    isStaff: jasmine.createSpy('isStaff'),
    canAccessAdminSection: jasmine.createSpy('canAccessAdminSection'),
    checkAdminAccess: jasmine.createSpy('checkAdminAccess')
  };

  async function resolveGuardResult(result: unknown): Promise<unknown> {
    if (isObservable(result)) {
      return firstValueFrom(result);
    }
    return await Promise.resolve(result);
  }

  async function runSectionGuard(section: string, url: string): Promise<unknown> {
    const guardResult$ = TestBed.runInInjectionContext(() =>
      adminSectionGuard(section)({} as any, { url } as any)
    );
    return resolveGuardResult(guardResult$);
  }

  function runAuthGuard(): unknown {
    return TestBed.runInInjectionContext(() => (authGuard as unknown as () => unknown)());
  }

  function runAdminGuard(): unknown {
    return TestBed.runInInjectionContext(() => (adminGuard as unknown as () => unknown)());
  }

  beforeEach(() => {
    toast.error.calls.reset();
    Object.values(authMock).forEach((spy) => {
      if ('calls' in spy) {
        (spy as jasmine.Spy).calls.reset();
      }
    });

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authMock },
        { provide: ToastService, useValue: toast },
        { provide: TranslateService, useValue: translate }
      ]
    });

    authMock.ensureAuthenticated.and.returnValue(of(true));
    authMock.isAuthenticated.and.returnValue(true);
    authMock.isStaff.and.returnValue(true);
    authMock.canAccessAdminSection.and.returnValue(true);
    authMock.checkAdminAccess.and.returnValue(of({ allowed: true }));
  });

  it('authGuard allows authenticated users', async () => {
    const result$ = runAuthGuard();
    expect(await resolveGuardResult(result$)).toBeTrue();
  });

  it('authGuard redirects unauthenticated users to login', async () => {
    authMock.ensureAuthenticated.and.returnValue(of(false));
    const router = TestBed.inject(Router);
    const result$ = runAuthGuard();

    const result = await resolveGuardResult(result$);
    expect(result instanceof UrlTree).toBeTrue();
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
    expect(toast.error).toHaveBeenCalledWith('errors.signInRequired');
  });

  it('authGuard handles ensureAuthenticated errors', async () => {
    authMock.ensureAuthenticated.and.returnValue(throwError(() => new Error('boom')));
    const router = TestBed.inject(Router);

    const result$ = runAuthGuard();
    const result = await resolveGuardResult(result$);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('adminGuard allows authenticated staff users', async () => {
    const result$ = runAdminGuard();
    expect(await resolveGuardResult(result$)).toBeTrue();
  });

  it('adminGuard redirects non-staff user with staffRequired message', async () => {
    authMock.isStaff.and.returnValue(false);
    const router = TestBed.inject(Router);

    const result$ = runAdminGuard();
    const result = await resolveGuardResult(result$);
    expect(router.serializeUrl(result as UrlTree)).toBe('/');
    expect(toast.error).toHaveBeenCalledWith('errors.staffRequired');
  });

  it('adminGuard redirects unauthenticated user with signInRequired message', async () => {
    authMock.ensureAuthenticated.and.returnValue(of(false));
    authMock.isAuthenticated.and.returnValue(false);
    const router = TestBed.inject(Router);

    const result$ = runAdminGuard();
    const result = await resolveGuardResult(result$);
    expect(router.serializeUrl(result as UrlTree)).toBe('/');
    expect(toast.error).toHaveBeenCalledWith('errors.signInRequired');
  });

  it('adminGuard handles ensureAuthenticated errors', async () => {
    authMock.ensureAuthenticated.and.returnValue(throwError(() => new Error('oops')));
    const router = TestBed.inject(Router);

    const result$ = runAdminGuard();
    const result = await resolveGuardResult(result$);
    expect(router.serializeUrl(result as UrlTree)).toBe('/');
    expect(toast.error).toHaveBeenCalledWith('errors.staffRequired');
  });

  it('avoids self-redirect loops when dashboard section access is denied', async () => {
    authMock.canAccessAdminSection.and.returnValue(false);
    const router = TestBed.inject(Router);

    const result = await runSectionGuard('dashboard', '/admin/dashboard');
    expect(result instanceof UrlTree).toBeTrue();
    expect(router.serializeUrl(result as UrlTree)).toBe('/');
  });

  it('allows dashboard route when admin access API returns training_readonly', async () => {
    authMock.checkAdminAccess.and.returnValue(
      throwError(() => ({
        headers: {
          get: (name: string) => (name.toLowerCase() === 'x-error-code' ? 'training_readonly' : null)
        }
      }))
    );

    expect(await runSectionGuard('dashboard', '/admin/dashboard')).toBeTrue();
  });

  it('redirects training_readonly non-dashboard sections to dashboard', async () => {
    authMock.checkAdminAccess.and.returnValue(
      throwError(() => ({
        error: {
          code: 'training_readonly'
        }
      }))
    );
    const router = TestBed.inject(Router);

    const result = await runSectionGuard('content', '/admin/content');
    expect(router.serializeUrl(result as UrlTree)).toBe('/admin/dashboard');
  });

  it('redirects mfa-required errors to account security', async () => {
    authMock.checkAdminAccess.and.returnValue(
      throwError(() => ({
        error: {
          code: 'admin_mfa_required'
        }
      }))
    );
    const router = TestBed.inject(Router);

    const result = await runSectionGuard('ops', '/admin/ops');
    expect(router.serializeUrl(result as UrlTree)).toBe('/account/security');
    expect(toast.error).toHaveBeenCalledWith('adminUi.security.mfaRequired');
  });

  it('redirects ip-denied errors to ip-bypass with encoded return URL', async () => {
    authMock.checkAdminAccess.and.returnValue(
      throwError(() => ({
        error: {
          detail: 'Admin access is restricted to approved IP addresses'
        }
      }))
    );
    const router = TestBed.inject(Router);

    const result = await runSectionGuard('ops', '/admin/ops?tab=monitoring');
    expect(router.serializeUrl(result as UrlTree)).toBe('/admin/ip-bypass?returnUrl=%2Fadmin%2Fops%3Ftab%3Dmonitoring');
  });

  it('uses error detail for denied path fallback', async () => {
    authMock.checkAdminAccess.and.returnValue(
      throwError(() => ({
        error: {
          detail: 'blocked by policy'
        }
      }))
    );
    const router = TestBed.inject(Router);

    const result = await runSectionGuard('ops', '/admin/ops');
    expect(router.serializeUrl(result as UrlTree)).toBe('/');
    expect(toast.error).toHaveBeenCalledWith('blocked by policy');
  });

  it('redirects when auth is rejected before section checks', async () => {
    authMock.ensureAuthenticated.and.returnValue(of(false));
    authMock.isAuthenticated.and.returnValue(false);
    const router = TestBed.inject(Router);

    const result = await runSectionGuard('ops', '/admin/ops');
    expect(router.serializeUrl(result as UrlTree)).toBe('/');
    expect(toast.error).toHaveBeenCalledWith('errors.signInRequired');
  });

  it('handles admin section guard outer catchError path', async () => {
    authMock.ensureAuthenticated.and.returnValue(throwError(() => new Error('explode')));
    const router = TestBed.inject(Router);

    const result = await runSectionGuard('ops', '/admin/ops');
    expect(router.serializeUrl(result as UrlTree)).toBe('/');
    expect(toast.error).toHaveBeenCalledWith('errors.sectionDenied');
  });
});
