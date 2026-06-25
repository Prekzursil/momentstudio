import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { of, throwError, firstValueFrom, isObservable } from 'rxjs';

import { adminGuard, adminSectionGuard, authGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';
import { TranslateService } from '@ngx-translate/core';

describe('adminSectionGuard', () => {
  const toast = {
    error: jasmine.createSpy('error'),
  };

  const translate = {
    instant: (key: string) => key,
  };

  const authMock = {
    ensureAuthenticated: jasmine.createSpy('ensureAuthenticated'),
    isAuthenticated: jasmine.createSpy('isAuthenticated'),
    isStaff: jasmine.createSpy('isStaff'),
    canAccessAdminSection: jasmine.createSpy('canAccessAdminSection'),
    checkAdminAccess: jasmine.createSpy('checkAdminAccess'),
  };

  async function resolveGuardResult(result: unknown): Promise<unknown> {
    if (isObservable(result)) {
      return firstValueFrom(result);
    }
    return await Promise.resolve(result);
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
        { provide: TranslateService, useValue: translate },
      ],
    });

    authMock.ensureAuthenticated.and.returnValue(of(true));
    authMock.isAuthenticated.and.returnValue(true);
    authMock.isStaff.and.returnValue(true);
    authMock.canAccessAdminSection.and.returnValue(true);
    authMock.checkAdminAccess.and.returnValue(of({ allowed: true }));
  });

  it('avoids self-redirect loops when dashboard section access is denied', async () => {
    authMock.canAccessAdminSection.and.returnValue(false);
    const router = TestBed.inject(Router);
    const guardResult$ = TestBed.runInInjectionContext(() =>
      adminSectionGuard('dashboard')({} as any, { url: '/admin/dashboard' } as any),
    );

    const result = await resolveGuardResult(guardResult$);
    expect(result instanceof UrlTree).toBeTrue();
    expect(router.serializeUrl(result as UrlTree)).toBe('/');
  });

  it('allows dashboard route when admin access API returns training_readonly', async () => {
    authMock.checkAdminAccess.and.returnValue(
      throwError(() => ({
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'x-error-code' ? 'training_readonly' : null,
        },
      })),
    );

    const guardResult$ = TestBed.runInInjectionContext(() =>
      adminSectionGuard('dashboard')({} as any, { url: '/admin/dashboard' } as any),
    );

    const result = await resolveGuardResult(guardResult$);
    expect(result).toBeTrue();
  });

  function runSection(section = 'orders', url = '/admin/orders'): Promise<unknown> {
    const r = TestBed.runInInjectionContext(() =>
      adminSectionGuard(section)({} as any, { url } as any),
    );
    return resolveGuardResult(r);
  }

  function serialize(result: unknown): string {
    return TestBed.inject(Router).serializeUrl(result as UrlTree);
  }

  it('allows access for a permitted staff user', async () => {
    expect(await runSection()).toBeTrue();
  });

  it('redirects to login when not authenticated', async () => {
    authMock.ensureAuthenticated.and.returnValue(of(false));
    const result = await runSection();
    expect(serialize(result)).toBe('/');
    expect(toast.error).toHaveBeenCalledWith('errors.signInRequired');
  });

  it('redirects to home when authenticated but not staff', async () => {
    authMock.isStaff.and.returnValue(false);
    const result = await runSection();
    expect(serialize(result)).toBe('/');
    expect(toast.error).toHaveBeenCalledWith('errors.staffRequired');
  });

  it('redirects to dashboard when a non-dashboard section is denied', async () => {
    authMock.canAccessAdminSection.and.returnValue(false);
    const result = await runSection('orders', '/admin/orders');
    expect(serialize(result)).toBe('/admin/dashboard');
    expect(toast.error).toHaveBeenCalledWith('errors.sectionDenied');
  });

  it('redirects to account security on admin_mfa_required', async () => {
    authMock.checkAdminAccess.and.returnValue(
      throwError(() => ({ error: { code: 'admin_mfa_required' } })),
    );
    const result = await runSection();
    expect(serialize(result)).toBe('/account/security');
  });

  it('redirects to account security on the mfa detail message', async () => {
    authMock.checkAdminAccess.and.returnValue(
      throwError(() => ({
        error: { detail: 'Two-factor authentication or passkey required for admin access' },
      })),
    );
    expect(serialize(await runSection())).toBe('/account/security');
  });

  it('redirects to ip-bypass on admin_ip_denied with a return url', async () => {
    authMock.checkAdminAccess.and.returnValue(
      throwError(() => ({ error: { code: 'admin_ip_denied' } })),
    );
    const result = await runSection('orders', '/admin/orders?x=1');
    expect(serialize(result)).toContain('/admin/ip-bypass');
    expect(serialize(result)).toContain('returnUrl');
  });

  it('redirects a non-dashboard section to dashboard on training_readonly', async () => {
    authMock.checkAdminAccess.and.returnValue(
      throwError(() => ({ error: { code: 'training_readonly' } })),
    );
    const result = await runSection('orders', '/admin/orders');
    expect(serialize(result)).toBe('/admin/dashboard');
  });

  it('falls back to the error detail on an unknown error code', async () => {
    authMock.checkAdminAccess.and.returnValue(
      throwError(() => ({ error: { code: 'weird', detail: 'Custom detail' } })),
    );
    const result = await runSection();
    expect(serialize(result)).toBe('/');
    expect(toast.error).toHaveBeenCalledWith('Custom detail');
  });

  it('uses the generic message when no detail is present', async () => {
    authMock.checkAdminAccess.and.returnValue(throwError(() => ({})));
    const result = await runSection();
    expect(serialize(result)).toBe('/');
    expect(toast.error).toHaveBeenCalledWith('errors.sectionDenied');
  });

  it('redirects to home when ensureAuthenticated throws', async () => {
    authMock.ensureAuthenticated.and.returnValue(throwError(() => new Error('down')));
    const result = await runSection();
    expect(serialize(result)).toBe('/');
    expect(toast.error).toHaveBeenCalledWith('errors.sectionDenied');
  });

  function runSectionNoUrl(section = 'orders'): Promise<unknown> {
    const r = TestBed.runInInjectionContext(() =>
      adminSectionGuard(section)({} as any, { url: '' } as any),
    );
    return resolveGuardResult(r);
  }

  it('handles section denial with a missing url', async () => {
    authMock.canAccessAdminSection.and.returnValue(false);
    expect(serialize(await runSectionNoUrl())).toBe('/admin/dashboard');
  });

  it('reads the error code from headers and defaults the ip-bypass return url', async () => {
    authMock.checkAdminAccess.and.returnValue(
      throwError(() => ({
        headers: { get: (n: string) => (n === 'X-Error-Code' ? 'admin_ip_allowlist' : null) },
      })),
    );
    const result = await runSectionNoUrl();
    expect(serialize(result)).toContain('/admin/ip-bypass');
    expect(serialize(result)).toContain('admin%2Fdashboard');
  });

  it('handles training_readonly with a missing url for a non-dashboard section', async () => {
    authMock.checkAdminAccess.and.returnValue(
      throwError(() => ({ error: { code: 'training_readonly' } })),
    );
    expect(serialize(await runSectionNoUrl('orders'))).toBe('/admin/dashboard');
  });
});

describe('authGuard', () => {
  const toast = { error: jasmine.createSpy('error') };
  const translate = { instant: (key: string) => key };
  const authMock = {
    ensureAuthenticated: jasmine.createSpy('ensureAuthenticated'),
    isAuthenticated: jasmine.createSpy('isAuthenticated'),
  };

  beforeEach(() => {
    toast.error.calls.reset();
    authMock.ensureAuthenticated.calls.reset();
    authMock.isAuthenticated.calls.reset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authMock },
        { provide: ToastService, useValue: toast },
        { provide: TranslateService, useValue: translate },
      ],
    });
  });

  function run(): Promise<unknown> {
    const r = TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));
    return isObservable(r) ? firstValueFrom(r) : Promise.resolve(r);
  }

  it('allows an authenticated user', async () => {
    authMock.ensureAuthenticated.and.returnValue(of(true));
    authMock.isAuthenticated.and.returnValue(true);
    expect(await run()).toBeTrue();
  });

  it('redirects to login when not authenticated', async () => {
    authMock.ensureAuthenticated.and.returnValue(of(false));
    authMock.isAuthenticated.and.returnValue(false);
    const result = await run();
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/login');
    expect(toast.error).toHaveBeenCalledWith('errors.signInRequired');
  });

  it('redirects to login when ensureAuthenticated errors', async () => {
    authMock.ensureAuthenticated.and.returnValue(throwError(() => new Error('x')));
    const result = await run();
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/login');
  });
});

describe('adminGuard', () => {
  const toast = { error: jasmine.createSpy('error') };
  const translate = { instant: (key: string) => key };
  const authMock = {
    ensureAuthenticated: jasmine.createSpy('ensureAuthenticated'),
    isAuthenticated: jasmine.createSpy('isAuthenticated'),
    isStaff: jasmine.createSpy('isStaff'),
  };

  beforeEach(() => {
    toast.error.calls.reset();
    [authMock.ensureAuthenticated, authMock.isAuthenticated, authMock.isStaff].forEach((s) =>
      s.calls.reset(),
    );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authMock },
        { provide: ToastService, useValue: toast },
        { provide: TranslateService, useValue: translate },
      ],
    });
  });

  function run(): Promise<unknown> {
    const r = TestBed.runInInjectionContext(() => adminGuard({} as any, {} as any));
    return isObservable(r) ? firstValueFrom(r) : Promise.resolve(r);
  }

  function serialize(result: unknown): string {
    return TestBed.inject(Router).serializeUrl(result as UrlTree);
  }

  it('allows an authenticated staff user', async () => {
    authMock.ensureAuthenticated.and.returnValue(of(true));
    authMock.isAuthenticated.and.returnValue(true);
    authMock.isStaff.and.returnValue(true);
    expect(await run()).toBeTrue();
  });

  it('redirects to home with staffRequired when authenticated but not staff', async () => {
    authMock.ensureAuthenticated.and.returnValue(of(true));
    authMock.isAuthenticated.and.returnValue(true);
    authMock.isStaff.and.returnValue(false);
    expect(serialize(await run())).toBe('/');
    expect(toast.error).toHaveBeenCalledWith('errors.staffRequired');
  });

  it('redirects to home with signInRequired when not authenticated', async () => {
    authMock.ensureAuthenticated.and.returnValue(of(false));
    authMock.isAuthenticated.and.returnValue(false);
    authMock.isStaff.and.returnValue(false);
    expect(serialize(await run())).toBe('/');
    expect(toast.error).toHaveBeenCalledWith('errors.signInRequired');
  });

  it('redirects to home when ensureAuthenticated errors', async () => {
    authMock.ensureAuthenticated.and.returnValue(throwError(() => new Error('x')));
    expect(serialize(await run())).toBe('/');
    expect(toast.error).toHaveBeenCalledWith('errors.staffRequired');
  });
});
