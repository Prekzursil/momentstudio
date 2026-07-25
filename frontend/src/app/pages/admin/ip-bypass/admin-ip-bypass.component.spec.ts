import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../core/toast.service';
import { AdminIpBypassComponent } from './admin-ip-bypass.component';

describe('AdminIpBypassComponent', () => {
  let auth: jasmine.SpyObj<AuthService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: jasmine.SpyObj<Router>;

  function configure(queryParam: string | null): void {
    auth = jasmine.createSpyObj<AuthService>('AuthService', [
      'setAdminIpBypass',
      'clearAdminIpBypass',
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);
    router = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);
    router.navigateByUrl.and.returnValue(Promise.resolve(true));

    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminIpBypassComponent],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => queryParam } } },
        },
      ],
    });
  }

  function create(queryParam: string | null = null): AdminIpBypassComponent {
    configure(queryParam);
    const fixture = TestBed.createComponent(AdminIpBypassComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('renders the title, copy and breadcrumb crumbs', () => {
    configure(null);
    const fixture = TestBed.createComponent(AdminIpBypassComponent);
    fixture.detectChanges();

    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('adminUi.ipBypass.title');
    expect(text).toContain('adminUi.ipBypass.copy');
    expect(fixture.componentInstance.crumbs().length).toBe(2);
    expect(fixture.componentInstance.crumbs()[0].url).toBe('/admin/dashboard');
    expect(fixture.componentInstance.busy()).toBeFalse();
  });

  it('defaults the return url to the admin dashboard when no query param is present', () => {
    const component = create(null);
    component.token = 'tok';
    auth.setAdminIpBypass.and.returnValue(of(undefined));

    component.submit();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/dashboard');
  });

  it('uses the returnUrl query param when present', () => {
    const component = create('/admin/orders');
    component.token = 'tok';
    auth.setAdminIpBypass.and.returnValue(of(undefined));

    component.submit();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/orders');
  });

  describe('submit', () => {
    it('does nothing when already busy', () => {
      const component = create();
      component.token = 'tok';
      component.busy.set(true);

      component.submit();

      expect(auth.setAdminIpBypass).not.toHaveBeenCalled();
    });

    it('does nothing when the token is blank', () => {
      const component = create();
      component.token = '   ';

      component.submit();

      expect(auth.setAdminIpBypass).not.toHaveBeenCalled();
      expect(component.busy()).toBeFalse();
    });

    it('trims the token, shows success, navigates and clears busy on success', () => {
      const component = create('/admin/dashboard');
      component.token = '  secret-token  ';
      auth.setAdminIpBypass.and.returnValue(of(undefined));

      component.submit();

      expect(auth.setAdminIpBypass).toHaveBeenCalledWith('secret-token');
      expect(toast.success).toHaveBeenCalledWith('adminUi.ipBypass.success');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/dashboard');
      expect(component.busy()).toBeFalse();
    });

    it('shows the server-provided detail message on error', () => {
      const component = create();
      component.token = 'tok';
      auth.setAdminIpBypass.and.returnValue(
        throwError(() => ({ error: { detail: 'forbidden ip' } })),
      );

      component.submit();

      expect(toast.error).toHaveBeenCalledWith('forbidden ip');
      expect(component.busy()).toBeFalse();
    });

    it('falls back to a generic message when the error has no detail', () => {
      const component = create();
      component.token = 'tok';
      auth.setAdminIpBypass.and.returnValue(throwError(() => ({})));

      component.submit();

      expect(toast.error).toHaveBeenCalledWith('adminUi.errors.generic');
      expect(component.busy()).toBeFalse();
    });

    it('falls back to a generic message when the error is nullish', () => {
      const component = create();
      component.token = 'tok';
      auth.setAdminIpBypass.and.returnValue(throwError(() => null));

      component.submit();

      expect(toast.error).toHaveBeenCalledWith('adminUi.errors.generic');
      expect(component.busy()).toBeFalse();
    });
  });

  describe('clear', () => {
    it('does nothing when already busy', () => {
      const component = create();
      component.busy.set(true);

      component.clear();

      expect(auth.clearAdminIpBypass).not.toHaveBeenCalled();
    });

    it('resets the token, shows an info toast and clears busy on success', () => {
      const component = create();
      component.token = 'tok';
      auth.clearAdminIpBypass.and.returnValue(of(undefined));

      component.clear();

      expect(auth.clearAdminIpBypass).toHaveBeenCalled();
      expect(component.token).toBe('');
      expect(toast.info).toHaveBeenCalledWith('adminUi.ipBypass.cleared');
      expect(component.busy()).toBeFalse();
    });

    it('still resets the token and clears busy on error', () => {
      const component = create();
      component.token = 'tok';
      auth.clearAdminIpBypass.and.returnValue(throwError(() => new Error('boom')));

      component.clear();

      expect(component.token).toBe('');
      expect(toast.info).not.toHaveBeenCalled();
      expect(component.busy()).toBeFalse();
    });
  });
});
