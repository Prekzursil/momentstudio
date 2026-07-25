import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgForm } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';

import { AuthResponse, AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { TwoFactorComponent } from './two-factor.component';

describe('TwoFactorComponent', () => {
  let auth: jasmine.SpyObj<AuthService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: jasmine.SpyObj<Router>;
  let translate: TranslateService;

  const authResponse: AuthResponse = {
    user: { email: 'user@example.com', username: 'user', id: 'u1', role: 'user' },
    tokens: { access_token: 'a', refresh_token: 'r', token_type: 'bearer' },
  } as AuthResponse;

  function setup(): ComponentFixture<TwoFactorComponent> {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['completeTwoFactorLogin']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    router = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);
    router.navigateByUrl.and.returnValue(Promise.resolve(true));
    auth.completeTwoFactorLogin.and.returnValue(of(authResponse));

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), TwoFactorComponent],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
        { provide: Router, useValue: router },
        // A stub ActivatedRoute lets the breadcrumb's routerLink directives render
        // under RouterTestingModule without bootstrapping a full navigation cycle.
        { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: {} } },
      ],
    });

    translate = TestBed.inject(TranslateService);
    translate.use('en');
    return TestBed.createComponent(TwoFactorComponent);
  }

  function validForm(): NgForm {
    return { valid: true } as unknown as NgForm;
  }

  function invalidForm(): NgForm {
    return { valid: false } as unknown as NgForm;
  }

  /** Run `fn` with the browser `sessionStorage` global temporarily unavailable. */
  function withoutSessionStorage(fn: () => void): void {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => undefined });
    try {
      fn();
    } finally {
      if (original) {
        Object.defineProperty(window, 'sessionStorage', original);
      }
    }
  }

  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  describe('ngOnInit', () => {
    it('toasts and redirects to login when sessionStorage is unavailable', () => {
      const cmp = setup().componentInstance;
      withoutSessionStorage(() => cmp.ngOnInit());
      expect(toast.error).toHaveBeenCalledWith('auth.twoFactorMissing');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
      expect(cmp.userEmail).toBeNull();
    });

    it('toasts and redirects to login when the two-factor token is missing', () => {
      const cmp = setup().componentInstance;
      cmp.ngOnInit();
      expect(toast.error).toHaveBeenCalledWith('auth.twoFactorMissing');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
    });

    it('hydrates the user email and skips redirect when a token is present', () => {
      sessionStorage.setItem('two_factor_token', 'tok');
      sessionStorage.setItem('two_factor_remember', 'true');
      sessionStorage.setItem('two_factor_user', JSON.stringify({ email: 'stored@example.com' }));
      const cmp = setup().componentInstance;
      cmp.ngOnInit();
      expect(cmp.userEmail).toBe('stored@example.com');
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('falls back to remember=false when the stored flag is invalid JSON', () => {
      sessionStorage.setItem('two_factor_token', 'tok');
      sessionStorage.setItem('two_factor_remember', '{not-json');
      const cmp = setup().componentInstance;
      cmp.ngOnInit();
      cmp.code = '123456';
      cmp.onSubmit(validForm());
      expect(auth.completeTwoFactorLogin).toHaveBeenCalledWith('tok', '123456', false);
    });

    it('leaves the user email null when the stored user is malformed JSON', () => {
      sessionStorage.setItem('two_factor_token', 'tok');
      sessionStorage.setItem('two_factor_user', '{broken');
      const cmp = setup().componentInstance;
      cmp.ngOnInit();
      expect(cmp.userEmail).toBeNull();
    });

    it('leaves the user email null when the stored user has no email field', () => {
      sessionStorage.setItem('two_factor_token', 'tok');
      sessionStorage.setItem('two_factor_user', JSON.stringify({ name: 'No Email' }));
      const cmp = setup().componentInstance;
      cmp.ngOnInit();
      expect(cmp.userEmail).toBeNull();
    });

    it('leaves the user email null when the stored user parses to null', () => {
      sessionStorage.setItem('two_factor_token', 'tok');
      sessionStorage.setItem('two_factor_user', 'null');
      const cmp = setup().componentInstance;
      cmp.ngOnInit();
      expect(cmp.userEmail).toBeNull();
    });

    it('renders the stored email and the error message in the template', () => {
      sessionStorage.setItem('two_factor_token', 'tok');
      sessionStorage.setItem('two_factor_user', JSON.stringify({ email: 'shown@example.com' }));
      const fixture = setup();
      fixture.componentInstance.error = 'Invalid code entered';
      fixture.detectChanges();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('shown@example.com');
      expect(text).toContain('Invalid code entered');
    });
  });

  describe('cancel', () => {
    it('clears the stored challenge and navigates to login', () => {
      sessionStorage.setItem('two_factor_token', 'tok');
      sessionStorage.setItem('two_factor_user', '{}');
      sessionStorage.setItem('two_factor_remember', 'true');
      const cmp = setup().componentInstance;
      cmp.cancel();
      expect(sessionStorage.getItem('two_factor_token')).toBeNull();
      expect(sessionStorage.getItem('two_factor_user')).toBeNull();
      expect(sessionStorage.getItem('two_factor_remember')).toBeNull();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
    });

    it('navigates to login without touching storage when sessionStorage is unavailable', () => {
      const cmp = setup().componentInstance;
      withoutSessionStorage(() => cmp.cancel());
      expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
    });
  });

  describe('onSubmit', () => {
    function readyComponent(remember = 'true'): TwoFactorComponent {
      sessionStorage.setItem('two_factor_token', 'tok');
      sessionStorage.setItem('two_factor_remember', remember);
      const cmp = setup().componentInstance;
      cmp.ngOnInit();
      cmp.code = '654321';
      return cmp;
    }

    it('rejects an invalid form and does not call the service', () => {
      const cmp = setup().componentInstance;
      cmp.onSubmit(invalidForm());
      expect(toast.error).toHaveBeenCalledWith('auth.completeForm');
      expect(auth.completeTwoFactorLogin).not.toHaveBeenCalled();
    });

    it('rejects a valid form when the token is missing', () => {
      const cmp = setup().componentInstance;
      cmp.code = '654321';
      cmp.onSubmit(validForm());
      expect(toast.error).toHaveBeenCalledWith('auth.completeForm');
      expect(auth.completeTwoFactorLogin).not.toHaveBeenCalled();
    });

    it('submits the code, clears storage, toasts success, and navigates to account', () => {
      const cmp = readyComponent('true');
      cmp.onSubmit(validForm());
      expect(auth.completeTwoFactorLogin).toHaveBeenCalledWith('tok', '654321', true);
      expect(sessionStorage.getItem('two_factor_token')).toBeNull();
      expect(toast.success).toHaveBeenCalledWith('auth.successLogin', 'user@example.com');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/account');
      expect(cmp.error).toBeNull();
      expect(cmp.loading).toBeFalse();
    });

    it('completes the login even when sessionStorage is unavailable on success', () => {
      const cmp = readyComponent('false');
      withoutSessionStorage(() => cmp.onSubmit(validForm()));
      expect(auth.completeTwoFactorLogin).toHaveBeenCalledWith('tok', '654321', false);
      expect(toast.success).toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/account');
    });

    it('keeps loading true while the request is in flight', () => {
      const cmp = readyComponent();
      auth.completeTwoFactorLogin.and.returnValue(new Subject<AuthResponse>().asObservable());
      cmp.onSubmit(validForm());
      expect(cmp.loading).toBeTrue();
    });

    it('shows the backend error detail and toasts it on failure', () => {
      const cmp = readyComponent();
      auth.completeTwoFactorLogin.and.returnValue(
        throwError(() => ({ error: { detail: 'bad code' } })),
      );
      cmp.onSubmit(validForm());
      expect(cmp.error).toBe('bad code');
      expect(toast.error).toHaveBeenCalledWith('bad code');
      expect(cmp.loading).toBeFalse();
    });

    it('falls back to a generic error when no detail is present', () => {
      const cmp = readyComponent();
      auth.completeTwoFactorLogin.and.returnValue(throwError(() => ({})));
      cmp.onSubmit(validForm());
      expect(cmp.error).toBe('auth.twoFactorInvalid');
      expect(toast.error).toHaveBeenCalledWith('auth.twoFactorInvalid');
    });

    it('falls back to a generic error when the error object itself is null', () => {
      const cmp = readyComponent();
      auth.completeTwoFactorLogin.and.returnValue(throwError(() => null));
      cmp.onSubmit(validForm());
      expect(cmp.error).toBe('auth.twoFactorInvalid');
    });
  });
});
