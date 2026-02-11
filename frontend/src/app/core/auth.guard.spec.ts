import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { of, throwError, firstValueFrom, isObservable } from 'rxjs';

import { adminSectionGuard } from './auth.guard';
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
      adminSectionGuard('dashboard')({} as any, { url: '/admin/dashboard' } as any)
    );

    const result = await resolveGuardResult(guardResult$);
    expect(result instanceof UrlTree).toBeTrue();
    expect(router.serializeUrl(result as UrlTree)).toBe('/');
  });

  it('allows dashboard route when admin access API returns training_readonly', async () => {
    authMock.checkAdminAccess.and.returnValue(
      throwError(() => ({
        headers: {
          get: (name: string) => (name.toLowerCase() === 'x-error-code' ? 'training_readonly' : null),
        },
      }))
    );

    const guardResult$ = TestBed.runInInjectionContext(() =>
      adminSectionGuard('dashboard')({} as any, { url: '/admin/dashboard' } as any)
    );

    const result = await resolveGuardResult(guardResult$);
    expect(result).toBeTrue();
  });
});
  async function resolveGuardResult(result: unknown): Promise<unknown> {
    if (isObservable(result)) {
      return firstValueFrom(result);
    }
    return await Promise.resolve(result);
  }
