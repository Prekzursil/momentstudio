import { fakeAsync, flushMicrotasks, TestBed } from '@angular/core/testing';
import { NgForm } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, Subject, throwError } from 'rxjs';
import { AuthResponse, AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { LoginComponent } from './login.component';

const AUTH_RESPONSE: AuthResponse = {
  user: { email: 'user@example.com', username: 'user', id: 'u1', role: 'user' },
  tokens: { access_token: 'a', refresh_token: 'r', token_type: 'bearer' },
} as AuthResponse;

/** Runs `fn` while `globalThis.sessionStorage` reports as absent, then restores it. */
function withoutSessionStorage(fn: () => void): void {
  const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
  Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => undefined });
  try {
    fn();
  } finally {
    if (original) {
      Object.defineProperty(window, 'sessionStorage', original);
    } else {
      delete (window as unknown as { sessionStorage?: unknown }).sessionStorage;
    }
  }
}

/** Builds a minimal credential whose buffers can be serialised by the webauthn helper. */
function fakeCredential(): PublicKeyCredential {
  const buffer = new Uint8Array([1, 2, 3]).buffer;
  return {
    id: 'cred-id',
    rawId: buffer,
    type: 'public-key',
    response: { clientDataJSON: buffer },
    getClientExtensionResults: () => ({}),
  } as unknown as PublicKeyCredential;
}

describe('LoginComponent', () => {
  let auth: jasmine.SpyObj<AuthService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: jasmine.SpyObj<Router>;
  let translate: TranslateService;
  let queryParam: string | null;
  let credentialsRestore: PropertyDescriptor | undefined;

  function setup(): LoginComponent {
    auth = jasmine.createSpyObj<AuthService>('AuthService', [
      'login',
      'startGoogleLogin',
      'completeTwoFactorLogin',
      'startPasskeyLogin',
      'completePasskeyLogin',
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);
    router = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);
    router.navigateByUrl.and.returnValue(Promise.resolve(true));

    TestBed.configureTestingModule({
      imports: [LoginComponent, RouterTestingModule, TranslateModule.forRoot()],
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

    translate = TestBed.inject(TranslateService);
    translate.use('en');
    return TestBed.createComponent(LoginComponent).componentInstance;
  }

  function validForm(): NgForm {
    return { valid: true } as unknown as NgForm;
  }

  function invalidForm(): NgForm {
    return { valid: false } as unknown as NgForm;
  }

  function mockCredentialsGet(impl: () => Promise<unknown>): jasmine.Spy {
    const spy = jasmine.createSpy('get').and.callFake(impl);
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get: spy } });
    return spy;
  }

  beforeEach(() => {
    queryParam = null;
    credentialsRestore = Object.getOwnPropertyDescriptor(navigator, 'credentials');
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    if (credentialsRestore) {
      Object.defineProperty(navigator, 'credentials', credentialsRestore);
    } else {
      delete (navigator as unknown as { credentials?: unknown }).credentials;
    }
    sessionStorage.clear();
    localStorage.clear();
  });

  // --- construction / normalizeNextUrl -----------------------------------

  it('defaults nextUrl to null when no next query param is present', () => {
    queryParam = null;
    const cmp = setup();
    expect(cmp.nextUrl).toBeNull();
  });

  it('rejects a whitespace-only next param', () => {
    queryParam = '   ';
    expect(setup().nextUrl).toBeNull();
  });

  it('rejects a next param that is not an absolute path', () => {
    queryParam = 'evil.com';
    expect(setup().nextUrl).toBeNull();
  });

  it('rejects a protocol-relative next param', () => {
    queryParam = '//evil.com';
    expect(setup().nextUrl).toBeNull();
  });

  it('rejects a next param that points back at the login page', () => {
    queryParam = '/login?x=1';
    expect(setup().nextUrl).toBeNull();
  });

  it('accepts a safe internal next path', () => {
    queryParam = '/account/settings';
    expect(setup().nextUrl).toBe('/account/settings');
  });

  // --- cancelTwoFactor ---------------------------------------------------

  it('cancelTwoFactor clears state and stored two-factor data', () => {
    const cmp = setup();
    cmp.twoFactorToken = 'tok';
    cmp.twoFactorUserEmail = 'a@b.c';
    cmp.twoFactorCode = '123';
    cmp.loading = true;
    sessionStorage.setItem('two_factor_token', 'tok');
    sessionStorage.setItem('two_factor_user', 'u');
    sessionStorage.setItem('two_factor_remember', 'true');

    cmp.cancelTwoFactor();

    expect(cmp.twoFactorToken).toBeNull();
    expect(cmp.twoFactorUserEmail).toBeNull();
    expect(cmp.twoFactorCode).toBe('');
    expect(cmp.loading).toBeFalse();
    expect(sessionStorage.getItem('two_factor_token')).toBeNull();
  });

  it('cancelTwoFactor is safe when sessionStorage is unavailable', () => {
    const cmp = setup();
    cmp.twoFactorToken = 'tok';
    withoutSessionStorage(() => cmp.cancelTwoFactor());
    expect(cmp.twoFactorToken).toBeNull();
  });

  // --- startPasskey ------------------------------------------------------

  it('startPasskey does nothing while a passkey request is already in flight', () => {
    const cmp = setup();
    cmp.passkeyBusy = true;
    cmp.startPasskey();
    expect(auth.startPasskeyLogin).not.toHaveBeenCalled();
  });

  it('startPasskey warns when passkeys are not supported', () => {
    const cmp = setup();
    cmp.passkeySupported = false;
    cmp.startPasskey();
    expect(toast.error).toHaveBeenCalledWith('auth.passkeyNotSupported');
    expect(auth.startPasskeyLogin).not.toHaveBeenCalled();
  });

  it('startPasskey completes the full login flow and navigates', fakeAsync(() => {
    const cmp = setup();
    cmp.passkeySupported = true;
    cmp.identifier = 'user';
    auth.startPasskeyLogin.and.returnValue(of({ authentication_token: 'at', options: {} }));
    auth.completePasskeyLogin.and.returnValue(of(AUTH_RESPONSE));
    mockCredentialsGet(() => Promise.resolve(fakeCredential()));

    cmp.startPasskey();
    flushMicrotasks();

    expect(auth.completePasskeyLogin).toHaveBeenCalledWith('at', jasmine.any(Object), false);
    expect(toast.success).toHaveBeenCalledWith('auth.successLogin', 'user@example.com');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/account');
    expect(cmp.passkeyBusy).toBeFalse();
  }));

  it('startPasskey stops quietly when no credential is returned', fakeAsync(() => {
    const cmp = setup();
    cmp.passkeySupported = true;
    auth.startPasskeyLogin.and.returnValue(of({ authentication_token: 'at', options: {} }));
    mockCredentialsGet(() => Promise.resolve(null));

    cmp.startPasskey();
    flushMicrotasks();

    expect(cmp.passkeyBusy).toBeFalse();
    expect(auth.completePasskeyLogin).not.toHaveBeenCalled();
  }));

  it('startPasskey surfaces the backend detail when verification fails', fakeAsync(() => {
    const cmp = setup();
    cmp.passkeySupported = true;
    auth.startPasskeyLogin.and.returnValue(of({ authentication_token: 'at', options: {} }));
    auth.completePasskeyLogin.and.returnValue(throwError(() => ({ error: { detail: 'nope' } })));
    mockCredentialsGet(() => Promise.resolve(fakeCredential()));

    cmp.startPasskey();
    flushMicrotasks();

    expect(toast.error).toHaveBeenCalledWith('nope');
    // A verification error does not emit `complete`, so passkeyBusy stays true.
    expect(cmp.passkeyBusy).toBeTrue();
  }));

  it('startPasskey falls back to a generic error when verification has no detail', fakeAsync(() => {
    const cmp = setup();
    cmp.passkeySupported = true;
    auth.startPasskeyLogin.and.returnValue(of({ authentication_token: 'at', options: {} }));
    auth.completePasskeyLogin.and.returnValue(throwError(() => ({})));
    mockCredentialsGet(() => Promise.resolve(fakeCredential()));

    cmp.startPasskey();
    flushMicrotasks();

    expect(toast.error).toHaveBeenCalledWith('auth.passkeyError');
  }));

  it('startPasskey informs the user when the credential prompt is cancelled', fakeAsync(() => {
    const cmp = setup();
    cmp.passkeySupported = true;
    auth.startPasskeyLogin.and.returnValue(of({ authentication_token: 'at', options: {} }));
    mockCredentialsGet(() => {
      const err = new Error('cancelled');
      err.name = 'NotAllowedError';
      return Promise.reject(err);
    });

    cmp.startPasskey();
    flushMicrotasks();

    expect(toast.info).toHaveBeenCalledWith('auth.passkeyCancelled');
    expect(cmp.passkeyBusy).toBeFalse();
  }));

  it('startPasskey shows a thrown error message from the credential prompt', fakeAsync(() => {
    const cmp = setup();
    cmp.passkeySupported = true;
    auth.startPasskeyLogin.and.returnValue(of({ authentication_token: 'at', options: {} }));
    mockCredentialsGet(() => Promise.reject(new Error('boom')));

    cmp.startPasskey();
    flushMicrotasks();

    expect(toast.error).toHaveBeenCalledWith('boom');
  }));

  it('startPasskey falls back to a generic error for an unlabelled prompt failure', fakeAsync(() => {
    const cmp = setup();
    cmp.passkeySupported = true;
    auth.startPasskeyLogin.and.returnValue(of({ authentication_token: 'at', options: {} }));
    mockCredentialsGet(() => {
      // No name and no message: exercises both `err?.name || ''` and the
      // `err?.message || <generic>` fallbacks.
      const err = new Error('');
      err.name = '';
      return Promise.reject(err);
    });

    cmp.startPasskey();
    flushMicrotasks();

    expect(toast.error).toHaveBeenCalledWith('auth.passkeyError');
  }));

  it('startPasskey surfaces the detail when requesting options fails', () => {
    const cmp = setup();
    cmp.passkeySupported = true;
    auth.startPasskeyLogin.and.returnValue(
      throwError(() => ({ error: { detail: 'options bad' } })),
    );
    cmp.startPasskey();
    expect(toast.error).toHaveBeenCalledWith('options bad');
    expect(cmp.passkeyBusy).toBeFalse();
  });

  it('startPasskey falls back to a generic error when requesting options has no detail', () => {
    const cmp = setup();
    cmp.passkeySupported = true;
    auth.startPasskeyLogin.and.returnValue(throwError(() => ({})));
    cmp.startPasskey();
    expect(toast.error).toHaveBeenCalledWith('auth.passkeyError');
  });

  // --- startGoogle -------------------------------------------------------

  it('startGoogle marks the flow and starts the google login request', () => {
    const cmp = setup();
    // Pending observable: the success callback assigns window.location.href (a
    // real redirect that would disconnect the Karma runner), so it is left
    // unresolved here. The redirect itself is istanbul-ignored in the source.
    auth.startGoogleLogin.and.returnValue(new Subject<string>().asObservable());
    cmp.startGoogle();
    expect(localStorage.getItem('google_flow')).toBe('login');
    expect(auth.startGoogleLogin).toHaveBeenCalled();
  });

  it('startGoogle surfaces the backend detail on failure', () => {
    const cmp = setup();
    auth.startGoogleLogin.and.returnValue(throwError(() => ({ error: { detail: 'no google' } })));
    cmp.startGoogle();
    expect(toast.error).toHaveBeenCalledWith('no google');
  });

  it('startGoogle falls back to a generic error when no detail is present', () => {
    const cmp = setup();
    auth.startGoogleLogin.and.returnValue(throwError(() => ({})));
    cmp.startGoogle();
    expect(toast.error).toHaveBeenCalledWith('auth.googleError');
  });

  // --- onSubmit: two-factor step ----------------------------------------

  it('onSubmit (2FA) rejects an invalid form', () => {
    const cmp = setup();
    cmp.twoFactorToken = 'tok';
    cmp.onSubmit(invalidForm());
    expect(cmp.error).toBe('auth.completeForm');
    expect(toast.error).toHaveBeenCalledWith('auth.completeForm');
    expect(auth.completeTwoFactorLogin).not.toHaveBeenCalled();
  });

  it('onSubmit (2FA) rejects an empty code', () => {
    const cmp = setup();
    cmp.twoFactorToken = 'tok';
    cmp.twoFactorCode = '   ';
    cmp.onSubmit(validForm());
    expect(cmp.error).toBe('auth.completeForm');
    expect(auth.completeTwoFactorLogin).not.toHaveBeenCalled();
  });

  it('onSubmit (2FA) verifies the code, clears storage and navigates', () => {
    const cmp = setup();
    cmp.twoFactorToken = 'tok';
    cmp.twoFactorCode = ' 123456 ';
    cmp.keepSignedIn = true;
    cmp.nextUrl = '/dashboard';
    sessionStorage.setItem('two_factor_token', 'tok');
    auth.completeTwoFactorLogin.and.returnValue(of(AUTH_RESPONSE));

    cmp.onSubmit(validForm());

    expect(auth.completeTwoFactorLogin).toHaveBeenCalledWith('tok', '123456', true);
    expect(cmp.twoFactorToken).toBeNull();
    expect(cmp.loading).toBeFalse();
    expect(sessionStorage.getItem('two_factor_token')).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('auth.successLogin', 'user@example.com');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/dashboard');
  });

  it('onSubmit (2FA) verifies even when sessionStorage is unavailable', () => {
    const cmp = setup();
    cmp.twoFactorToken = 'tok';
    cmp.twoFactorCode = '123456';
    auth.completeTwoFactorLogin.and.returnValue(of(AUTH_RESPONSE));
    withoutSessionStorage(() => cmp.onSubmit(validForm()));
    expect(cmp.twoFactorToken).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalled();
  });

  it('onSubmit (2FA) shows an invalid-code message on 401', () => {
    const cmp = setup();
    cmp.twoFactorToken = 'tok';
    cmp.twoFactorCode = '000000';
    auth.completeTwoFactorLogin.and.returnValue(throwError(() => ({ status: 401 })));
    cmp.onSubmit(validForm());
    expect(cmp.error).toBe('auth.twoFactorInvalid');
    expect(cmp.loading).toBeFalse();
  });

  it('onSubmit (2FA) surfaces a backend detail string', () => {
    const cmp = setup();
    cmp.twoFactorToken = 'tok';
    cmp.twoFactorCode = '000000';
    auth.completeTwoFactorLogin.and.returnValue(
      throwError(() => ({ status: 400, error: { detail: 'locked out' } })),
    );
    cmp.onSubmit(validForm());
    expect(cmp.error).toBe('locked out');
  });

  it('onSubmit (2FA) falls back to invalid when detail is not a usable string', () => {
    const cmp = setup();
    cmp.twoFactorToken = 'tok';
    cmp.twoFactorCode = '000000';
    auth.completeTwoFactorLogin.and.returnValue(
      throwError(() => ({ status: 400, error: { detail: '   ' } })),
    );
    cmp.onSubmit(validForm());
    expect(cmp.error).toBe('auth.twoFactorInvalid');
  });

  // --- onSubmit: primary login step -------------------------------------

  it('onSubmit (login) rejects an invalid form', () => {
    const cmp = setup();
    cmp.onSubmit(invalidForm());
    expect(cmp.error).toBe('auth.completeForm');
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('onSubmit (login) requires a captcha token when captcha is enabled', () => {
    const cmp = setup();
    cmp.captchaEnabled = true;
    cmp.captchaToken = null;
    cmp.onSubmit(validForm());
    expect(cmp.error).toBe('auth.captchaRequired');
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('onSubmit (login) submits credentials and navigates on success', () => {
    const cmp = setup();
    cmp.identifier = 'user';
    cmp.password = 'pw';
    cmp.keepSignedIn = true;
    auth.login.and.returnValue(of(AUTH_RESPONSE));
    cmp.onSubmit(validForm());
    expect(auth.login).toHaveBeenCalledWith('user', 'pw', undefined, { remember: true });
    expect(toast.success).toHaveBeenCalledWith('auth.successLogin', 'user@example.com');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/account');
    expect(cmp.loading).toBeFalse();
  });

  it('onSubmit (login) passes the captcha token through when present', () => {
    const cmp = setup();
    cmp.captchaEnabled = true;
    cmp.captchaToken = 'cap-1';
    auth.login.and.returnValue(of(AUTH_RESPONSE));
    cmp.onSubmit(validForm());
    expect(auth.login).toHaveBeenCalledWith('', '', 'cap-1', { remember: false });
  });

  it('onSubmit (login) handles a non-object login response', () => {
    const cmp = setup();
    auth.login.and.returnValue(of(null as unknown as AuthResponse));
    cmp.onSubmit(validForm());
    expect(toast.success).toHaveBeenCalledWith('auth.successLogin', undefined);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/account');
  });

  it('onSubmit (login) switches to the two-factor step when required', () => {
    const cmp = setup();
    cmp.keepSignedIn = true;
    auth.login.and.returnValue(
      of({
        requires_two_factor: true,
        two_factor_token: 'tf-token',
        user: { email: 'tf@example.com' },
      } as unknown as AuthResponse),
    );
    cmp.onSubmit(validForm());
    expect(cmp.twoFactorToken).toBe('tf-token');
    expect(cmp.twoFactorUserEmail).toBe('tf@example.com');
    expect(sessionStorage.getItem('two_factor_token')).toBe('tf-token');
    expect(JSON.parse(sessionStorage.getItem('two_factor_remember') ?? 'false')).toBeTrue();
    expect(toast.info).toHaveBeenCalledWith('auth.twoFactorRequired');
  });

  it('onSubmit (login) stores a null user when the two-factor response omits the user', () => {
    const cmp = setup();
    auth.login.and.returnValue(
      of({ requires_two_factor: true, two_factor_token: 'tf-token' } as unknown as AuthResponse),
    );
    cmp.onSubmit(validForm());
    expect(cmp.twoFactorUserEmail).toBeNull();
    expect(sessionStorage.getItem('two_factor_user')).toBe('null');
  });

  it('onSubmit (login) requests two-factor even without sessionStorage and without a user email', () => {
    const cmp = setup();
    auth.login.and.returnValue(
      of({ requires_two_factor: true, two_factor_token: 'tf-token' } as unknown as AuthResponse),
    );
    withoutSessionStorage(() => cmp.onSubmit(validForm()));
    expect(cmp.twoFactorToken).toBe('tf-token');
    expect(cmp.twoFactorUserEmail).toBeNull();
    expect(toast.info).toHaveBeenCalledWith('auth.twoFactorRequired');
  });

  it('onSubmit (login) resets the captcha and shows invalid credentials on 401', () => {
    const cmp = setup();
    const reset = jasmine.createSpy('reset');
    cmp.captcha = { reset } as unknown as LoginComponent['captcha'];
    cmp.captchaToken = 'cap-1';
    auth.login.and.returnValue(throwError(() => ({ status: 401 })));
    cmp.onSubmit(validForm());
    expect(reset).toHaveBeenCalled();
    expect(cmp.captchaToken).toBeNull();
    expect(cmp.error).toBe('auth.invalidCredentials');
  });

  it('onSubmit (login) surfaces a backend detail string on failure', () => {
    const cmp = setup();
    auth.login.and.returnValue(throwError(() => ({ status: 400, error: { detail: 'blocked' } })));
    cmp.onSubmit(validForm());
    expect(cmp.error).toBe('blocked');
  });

  it('onSubmit (login) falls back to a generic error when detail is unusable', () => {
    const cmp = setup();
    auth.login.and.returnValue(throwError(() => ({ status: 500, error: { detail: 42 } })));
    cmp.onSubmit(validForm());
    expect(cmp.error).toBe('auth.errorLogin');
  });
});
