import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Observable, of, throwError } from 'rxjs';
import { AuthService, GoogleCallbackResponse } from '../../core/auth.service';
import { GoogleLinkPendingService } from '../../core/google-link-pending.service';
import { ToastService } from '../../core/toast.service';
import { GoogleCallbackComponent } from './google-callback.component';

const GOOGLE_FLOW_KEY = 'google_flow';

function user(email = 'a@b.c'): GoogleCallbackResponse['user'] {
  return { email, username: 'ana', id: 'u1', role: 'user' } as GoogleCallbackResponse['user'];
}

describe('GoogleCallbackComponent', () => {
  let auth: jasmine.SpyObj<AuthService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: jasmine.SpyObj<Router>;
  let linkPending: jasmine.SpyObj<GoogleLinkPendingService>;
  let params: Record<string, string | null>;
  let translate: TranslateService;

  function build(): ComponentFixture<GoogleCallbackComponent> {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['completeGoogleLogin']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate', 'navigateByUrl']);
    linkPending = jasmine.createSpyObj<GoogleLinkPendingService>('GoogleLinkPendingService', [
      'setPending',
    ]);
    router.navigate.and.returnValue(Promise.resolve(true));
    router.navigateByUrl.and.returnValue(Promise.resolve(true));

    TestBed.configureTestingModule({
      imports: [GoogleCallbackComponent, RouterTestingModule, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
        { provide: GoogleLinkPendingService, useValue: linkPending },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: (k: string) => params[k] ?? null } } },
        },
      ],
    });

    translate = TestBed.inject(TranslateService);
    translate.use('en');
    return TestBed.createComponent(GoogleCallbackComponent);
  }

  function setup(): GoogleCallbackComponent {
    return build().componentInstance;
  }

  function login(res: Partial<GoogleCallbackResponse>): void {
    auth.completeGoogleLogin.and.returnValue(of(res as GoogleCallbackResponse));
  }

  beforeEach(() => {
    params = { code: 'auth-code', state: 'state-xyz' };
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('aborts and redirects to /login when the code is missing', () => {
    params['code'] = null;
    const cmp = setup();
    cmp.ngOnInit();
    expect(cmp.error()).toBe('auth.googleMissingCode');
    expect(toast.error).toHaveBeenCalledWith('auth.googleMissingCode');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
    expect(auth.completeGoogleLogin).not.toHaveBeenCalled();
  });

  it('aborts when the code is present but the state is missing', () => {
    params['state'] = null;
    const cmp = setup();
    cmp.ngOnInit();
    expect(cmp.error()).toBe('auth.googleMissingCode');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('defaults to the login flow when no flow marker is stored and finishes a plain login', () => {
    const cmp = setup();
    login({ user: user('signed@in.co') });
    cmp.ngOnInit();
    expect(auth.completeGoogleLogin).toHaveBeenCalledWith('auth-code', 'state-xyz');
    expect(cmp.message()).toBe('auth.googleSigningIn');
    expect(toast.success).toHaveBeenCalledWith('auth.googleLoginSuccess', 'signed@in.co');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/account');
    expect(localStorage.getItem(GOOGLE_FLOW_KEY)).toBeNull();
  });

  it('honours an explicit login flow marker', () => {
    localStorage.setItem(GOOGLE_FLOW_KEY, 'login');
    const cmp = setup();
    login({ user: user() });
    cmp.ngOnInit();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/account');
  });

  it('routes to profile completion and stores the completion token when required', () => {
    const cmp = setup();
    login({ user: user('new@user.io'), requires_completion: true, completion_token: 'comp-tok' });
    cmp.ngOnInit();
    expect(sessionStorage.getItem('google_completion_token')).toBe('comp-tok');
    expect(sessionStorage.getItem('google_completion_user')).toBe(
      JSON.stringify(user('new@user.io')),
    );
    expect(toast.info).toHaveBeenCalledWith(
      'auth.completeProfileRequiredTitle',
      'auth.completeProfileRequiredCopy',
    );
    expect(router.navigate).toHaveBeenCalledWith(['/register'], { queryParams: { complete: 1 } });
  });

  it('routes to completion via a completion token even without requires_completion', () => {
    const cmp = setup();
    login({ user: user(), completion_token: 'only-token' });
    cmp.ngOnInit();
    expect(sessionStorage.getItem('google_completion_token')).toBe('only-token');
    expect(router.navigate).toHaveBeenCalledWith(['/register'], { queryParams: { complete: 1 } });
  });

  it('routes to completion without storing a token when requires_completion has no token', () => {
    const cmp = setup();
    login({ user: user(), requires_completion: true });
    cmp.ngOnInit();
    expect(sessionStorage.getItem('google_completion_token')).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/register'], { queryParams: { complete: 1 } });
  });

  it('stores the two-factor context and redirects to the 2FA page', () => {
    const cmp = setup();
    login({ user: user('2fa@user.io'), requires_two_factor: true, two_factor_token: '2fa-tok' });
    cmp.ngOnInit();
    expect(sessionStorage.getItem('two_factor_token')).toBe('2fa-tok');
    expect(sessionStorage.getItem('two_factor_user')).toBe(JSON.stringify(user('2fa@user.io')));
    expect(sessionStorage.getItem('two_factor_remember')).toBe('true');
    expect(toast.info).toHaveBeenCalledWith('auth.twoFactorRequired');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login/2fa');
  });

  it('persists a null two-factor user when the response omits the user', () => {
    const cmp = setup();
    login({
      user: undefined as unknown as GoogleCallbackResponse['user'],
      requires_two_factor: true,
      two_factor_token: '2fa-tok',
    });
    cmp.ngOnInit();
    expect(sessionStorage.getItem('two_factor_user')).toBe('null');
  });

  it('falls through to a normal login when 2FA is required but no token is returned', () => {
    const cmp = setup();
    login({ user: user('ok@user.io'), requires_two_factor: true });
    cmp.ngOnInit();
    expect(sessionStorage.getItem('two_factor_token')).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('auth.googleLoginSuccess', 'ok@user.io');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/account');
  });

  it('shows the backend error detail and returns to /login on login failure', () => {
    sessionStorage.setItem('google_completion_token', 'stale');
    sessionStorage.setItem('google_completion_user', 'stale');
    const cmp = setup();
    auth.completeGoogleLogin.and.returnValue(throwError(() => ({ error: { detail: 'boom' } })));
    cmp.ngOnInit();
    expect(cmp.error()).toBe('boom');
    expect(toast.error).toHaveBeenCalledWith('boom');
    expect(sessionStorage.getItem('google_completion_token')).toBeNull();
    expect(sessionStorage.getItem('google_completion_user')).toBeNull();
    expect(localStorage.getItem(GOOGLE_FLOW_KEY)).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('falls back to a generic error message when the failure carries no detail', () => {
    const cmp = setup();
    auth.completeGoogleLogin.and.returnValue(throwError(() => null));
    cmp.ngOnInit();
    expect(cmp.error()).toBe('auth.googleError');
    expect(toast.error).toHaveBeenCalledWith('auth.googleError');
  });

  it('hands a link flow off to the pending link service and redirects to account security', () => {
    localStorage.setItem(GOOGLE_FLOW_KEY, 'link');
    const cmp = setup();
    cmp.ngOnInit();
    expect(cmp.message()).toBe('auth.googleLinking');
    expect(linkPending.setPending).toHaveBeenCalledWith({ code: 'auth-code', state: 'state-xyz' });
    expect(localStorage.getItem(GOOGLE_FLOW_KEY)).toBeNull();
    expect(toast.info).toHaveBeenCalledWith('auth.googleLinkContinueInAccount');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/account/security');
    expect(auth.completeGoogleLogin).not.toHaveBeenCalled();
  });

  it('renders the message and error signals in the template', () => {
    const fixture = build();
    translate.setTranslation('en', { auth: { googleFinishing: 'Finishing sign-in' } }, true);
    // Non-emitting observable: ngOnInit subscribes without navigating or resetting signals.
    auth.completeGoogleLogin.and.returnValue(
      new Observable<GoogleCallbackResponse>(() => undefined),
    );
    fixture.detectChanges();
    fixture.componentInstance.message.set('Working on it');
    fixture.componentInstance.error.set('Something failed');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Finishing sign-in');
    expect(text).toContain('Working on it');
    expect(text).toContain('Something failed');
  });

  it('uses a deferred login observable without redirecting until it resolves', () => {
    const cmp = setup();
    let subscribed = false;
    auth.completeGoogleLogin.and.returnValue(
      new Observable<GoogleCallbackResponse>(() => {
        subscribed = true;
      }),
    );
    cmp.ngOnInit();
    expect(subscribed).toBeTrue();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
