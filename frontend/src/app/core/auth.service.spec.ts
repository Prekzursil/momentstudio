import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ApiService } from './api.service';
import { AuthResponse, AuthService, AuthTokens, AuthUser } from './auth.service';

const IMPERSONATION_KEY = 'impersonation_access_token';

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jwt(payload: Record<string, unknown>): string {
  return `header.${b64url(payload)}.signature`;
}

function futureExp(): number {
  return Math.floor(Date.now() / 1000) + 3600;
}

function pastExp(): number {
  return Math.floor(Date.now() / 1000) - 3600;
}

function validToken(extra: Record<string, unknown> = {}): string {
  return jwt({ exp: futureExp(), ...extra });
}

function expiredToken(extra: Record<string, unknown> = {}): string {
  return jwt({ exp: pastExp(), ...extra });
}

function tokens(access: string, refresh: string): AuthTokens {
  return { access_token: access, refresh_token: refresh, token_type: 'bearer' };
}

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1',
    email: 'u@example.com',
    username: 'user',
    role: 'customer',
    ...overrides,
  } as AuthUser;
}

describe('AuthService', () => {
  let api: jasmine.SpyObj<ApiService>;
  let router: jasmine.SpyObj<Router>;
  // The service attaches global revalidation listeners in its constructor.
  // Intercept them so no listener leaks across tests (other event types are
  // delegated to the real implementation to keep the harness intact).
  let focusHandlers: EventListener[];
  let visibilityHandlers: EventListener[];

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.hash = '';

    focusHandlers = [];
    visibilityHandlers = [];
    const realWindowAdd = window.addEventListener.bind(window);
    const realDocAdd = document.addEventListener.bind(document);
    spyOn(window, 'addEventListener').and.callFake(
      (type: string, handler: EventListenerOrEventListenerObject, options?: unknown) => {
        if (type === 'focus') {
          focusHandlers.push(handler as EventListener);
          return;
        }
        realWindowAdd(type, handler, options as never);
      },
    );
    spyOn(document, 'addEventListener').and.callFake(
      (type: string, handler: EventListenerOrEventListenerObject, options?: unknown) => {
        if (type === 'visibilitychange') {
          visibilityHandlers.push(handler as EventListener);
          return;
        }
        realDocAdd(type, handler, options as never);
      },
    );

    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post', 'patch', 'delete']);
    api.get.and.returnValue(of({}));
    api.post.and.returnValue(of({}));
    api.patch.and.returnValue(of({}));
    api.delete.and.returnValue(of({}));
    router = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: ApiService, useValue: api },
        { provide: Router, useValue: router },
      ],
    });
  });

  afterEach(() => {
    // Some tests stub the storage getters to throw; guard teardown accordingly.
    try {
      localStorage.clear();
    } catch {
      /* storage access stubbed to throw */
    }
    try {
      sessionStorage.clear();
    } catch {
      /* storage access stubbed to throw */
    }
    window.location.hash = '';
  });

  function create(): AuthService {
    return TestBed.inject(AuthService);
  }

  // ---- Bootstrap -----------------------------------------------------------

  it('bootstraps with no persisted state', () => {
    const service = create();
    expect(service.isAuthenticated()).toBeFalse();
    expect(service.getAccessToken()).toBeNull();
  });

  it('loads tokens from session storage and keeps a valid session', () => {
    sessionStorage.setItem('auth_tokens', JSON.stringify(tokens(validToken(), validToken())));
    const service = create();
    expect(service.getAccessToken()).toContain('header.');
  });

  it('falls back to local storage tokens when session is empty', () => {
    localStorage.setItem('auth_tokens', JSON.stringify(tokens(validToken(), validToken())));
    const service = create();
    expect(service.getRefreshToken()).toContain('header.');
  });

  it('clears the session when both persisted tokens are expired', () => {
    sessionStorage.setItem('auth_tokens', JSON.stringify(tokens(expiredToken(), expiredToken())));
    const service = create();
    expect(service.getAccessToken()).toBeNull();
  });

  it('ignores tokens that fail to parse', () => {
    sessionStorage.setItem('auth_tokens', 'not json');
    const service = create();
    expect(service.getAccessToken()).toBeNull();
  });

  // ---- Role helpers --------------------------------------------------------

  it('reports authentication and role state', () => {
    const service = create();
    expect(service.user()).toBeNull();
    expect(service.role()).toBeNull();
    expect(service.isAdmin()).toBeFalse();
    (service as unknown as { setUser: (u: AuthUser) => void }).setUser(makeUser({ role: 'admin' }));
    expect(service.isAuthenticated()).toBeTrue();
    expect(service.role()).toBe('admin');
    expect(service.isAdmin()).toBeTrue();
  });

  it('treats owner as admin', () => {
    const service = create();
    (service as unknown as { setUser: (u: AuthUser) => void }).setUser(makeUser({ role: 'owner' }));
    expect(service.isAdmin()).toBeTrue();
  });

  it('classifies staff roles', () => {
    const service = create();
    const setUser = (service as unknown as { setUser: (u: AuthUser | null) => void }).setUser.bind(
      service,
    );
    for (const role of ['owner', 'admin', 'support', 'fulfillment', 'content']) {
      setUser(makeUser({ role }));
      expect(service.isStaff()).withContext(role).toBeTrue();
    }
    setUser(makeUser({ role: 'customer' }));
    expect(service.isStaff()).toBeFalse();
  });

  it('gates admin sections by role', () => {
    const service = create();
    const setUser = (service as unknown as { setUser: (u: AuthUser | null) => void }).setUser.bind(
      service,
    );

    setUser(null);
    expect(service.canAccessAdminSection('dashboard')).toBeFalse();

    setUser(makeUser({ role: 'admin' }));
    expect(service.canAccessAdminSection('anything')).toBeTrue();

    setUser(makeUser({ role: 'support' }));
    expect(service.canAccessAdminSection('')).toBeFalse();
    expect(service.canAccessAdminSection('users')).toBeTrue();
    expect(service.canAccessAdminSection('orders')).toBeFalse();

    setUser(makeUser({ role: 'fulfillment' }));
    expect(service.canAccessAdminSection('inventory')).toBeTrue();
    expect(service.canAccessAdminSection('users')).toBeFalse();

    setUser(makeUser({ role: 'content' }));
    expect(service.canAccessAdminSection('PRODUCTS')).toBeTrue();
    expect(service.canAccessAdminSection('orders')).toBeFalse();

    setUser(makeUser({ role: 'mystery' }));
    expect(service.canAccessAdminSection('dashboard')).toBeFalse();
  });

  // ---- Token accessors -----------------------------------------------------

  it('exposes access and refresh tokens', () => {
    const service = create();
    expect(service.getAccessToken()).toBeNull();
    expect(service.getRefreshToken()).toBeNull();
    service.setTokens(tokens('a', 'b'));
    expect(service.getAccessToken()).toBe('a');
    expect(service.getRefreshToken()).toBe('b');
  });

  it('manages the step-up token lifecycle', () => {
    const service = create();
    expect(service.getStepUpToken()).toBeNull();

    (service as unknown as { stepUpToken: string }).stepUpToken = expiredToken();
    expect(service.getStepUpToken()).toBeNull();

    const valid = validToken();
    (service as unknown as { stepUpToken: string }).stepUpToken = valid;
    expect(service.getStepUpToken()).toBe(valid);

    service.clearStepUpToken();
    expect(service.getStepUpToken()).toBeNull();
  });

  it('ensureStepUp is intentionally a no-op', (done) => {
    const service = create();
    service.ensureStepUp({ silent: true, prompt: 'x' }).subscribe((v) => {
      expect(v).toBeNull();
      service.ensureStepUp().subscribe((v2) => {
        expect(v2).toBeNull();
        done();
      });
    });
  });

  // ---- Login / register flows ---------------------------------------------

  it('persists tokens after a successful login', () => {
    const service = create();
    const res: AuthResponse = { user: makeUser(), tokens: tokens('a', 'b') };
    api.post.and.returnValue(of(res));

    let result: unknown;
    service.login('id', 'pw', 'captcha', { remember: true }).subscribe((r) => (result = r));

    expect(api.post).toHaveBeenCalledWith('/auth/login', {
      identifier: 'id',
      password: 'pw',
      captcha_token: 'captcha',
      remember: true,
    });
    expect(result).toBe(res);
    expect(service.getAccessToken()).toBe('a');
  });

  it('persists with the default remember flag when none is supplied', () => {
    const service = create();
    const res: AuthResponse = { user: makeUser(), tokens: tokens('a', 'b') };
    api.post.and.returnValue(of(res));
    service.login('id', 'pw').subscribe();
    expect(service.getAccessToken()).toBe('a');
  });

  it('does not persist on a two-factor challenge response', () => {
    const service = create();
    api.post.and.returnValue(
      of({ user: makeUser(), requires_two_factor: true, two_factor_token: 'tf' }),
    );
    service.login('id', 'pw').subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/login', {
      identifier: 'id',
      password: 'pw',
      captcha_token: null,
      remember: false,
    });
    expect(service.getAccessToken()).toBeNull();
  });

  it('registers and persists', () => {
    const service = create();
    const res: AuthResponse = { user: makeUser(), tokens: tokens('a', 'b') };
    api.post.and.returnValue(of(res));
    const payload = {
      name: 'N',
      username: 'u',
      email: 'e',
      password: 'p',
      first_name: 'F',
      last_name: 'L',
      date_of_birth: '2000-01-01',
      phone: '123',
      accept_terms: true,
      accept_privacy: true,
    };
    service.register(payload).subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/register', payload);
    expect(service.getAccessToken()).toBe('a');
  });

  it('changes the password', () => {
    const service = create();
    api.post.and.returnValue(of({ detail: 'ok' }));
    service.changePassword('old', 'new').subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/password/change', {
      current_password: 'old',
      new_password: 'new',
    });
  });

  // ---- Google flows --------------------------------------------------------

  it('starts google login and maps the auth url', () => {
    const service = create();
    api.get.and.returnValue(of({ auth_url: 'https://g' }));
    let url: string | undefined;
    service.startGoogleLogin().subscribe((u) => (url = u));
    expect(url).toBe('https://g');
  });

  it('completes google login, persisting only when tokens are returned', () => {
    const service = create();
    api.post.and.returnValue(of({ user: makeUser(), tokens: tokens('a', 'b') }));
    service.completeGoogleLogin('code', 'state').subscribe();
    expect(service.getAccessToken()).toBe('a');

    const service2 = TestBed.inject(AuthService);
    api.post.and.returnValue(of({ user: makeUser(), tokens: null, requires_completion: true }));
    service2.completeGoogleLogin('code', 'state').subscribe();
  });

  it('completes two-factor login', () => {
    const service = create();
    api.post.and.returnValue(of({ user: makeUser(), tokens: tokens('a', 'b') }));
    service.completeTwoFactorLogin('tf', '123456', true).subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/login/2fa', {
      two_factor_token: 'tf',
      code: '123456',
    });
    expect(service.getAccessToken()).toBe('a');
  });

  it('completes google registration', () => {
    const service = create();
    api.post.and.returnValue(of({ user: makeUser(), tokens: tokens('a', 'b') }));
    service
      .completeGoogleRegistration('ct', {
        username: 'u',
        name: 'N',
        first_name: 'F',
        last_name: 'L',
        date_of_birth: '2000-01-01',
        phone: '1',
        password: 'p',
        accept_terms: true,
        accept_privacy: true,
      })
      .subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/google/complete', jasmine.any(Object), {
      Authorization: 'Bearer ct',
    });
    expect(service.getAccessToken()).toBe('a');
  });

  it('starts and completes google link and unlink', () => {
    const service = create();
    api.get.and.returnValue(of({ auth_url: 'https://link' }));
    let url: string | undefined;
    service.startGoogleLink().subscribe((u) => (url = u));
    expect(url).toBe('https://link');

    api.post.and.returnValue(of(makeUser({ role: 'admin' })));
    service.completeGoogleLink('c', 's', 'pw').subscribe();
    expect(service.role()).toBe('admin');

    api.post.and.returnValue(of(makeUser({ role: 'owner' })));
    service.unlinkGoogle('pw').subscribe();
    expect(service.role()).toBe('owner');
  });

  // ---- Avatar / profile (auth-gated) --------------------------------------

  it('short-circuits avatar operations when unauthenticated', () => {
    const service = create();
    service.uploadAvatar(new File(['x'], 'a.png')).subscribe();
    service.useGoogleAvatar().subscribe();
    service.removeAvatar().subscribe();
    service.updatePreferredLanguage('en').subscribe();
    service.updateNotificationPreferences({}).subscribe();
    service.updateTrainingMode(true).subscribe();
    service.updateProfile({}).subscribe();
    service.updateUsername('u', 'p').subscribe();
    service.updateEmail('e', 'p').subscribe();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('runs avatar and profile operations when authenticated', () => {
    const service = create();
    (service as unknown as { setUser: (u: AuthUser) => void }).setUser(makeUser());
    api.post.and.returnValue(of(makeUser({ role: 'admin' })));
    api.patch.and.returnValue(of(makeUser({ role: 'admin' })));
    api.delete.and.returnValue(of(makeUser({ role: 'admin' })));

    service.uploadAvatar(new File(['x'], 'a.png')).subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/me/avatar', jasmine.any(FormData));

    service.useGoogleAvatar().subscribe();
    service.removeAvatar().subscribe();
    service.updatePreferredLanguage('ro').subscribe();
    service.updateNotificationPreferences({ notify_marketing: true }).subscribe();
    service.updateTrainingMode(false).subscribe();
    service.updateProfile({ name: 'New' }).subscribe();
    service.updateUsername('u2', 'pw').subscribe();
    service.updateEmail('e2', 'pw').subscribe();
    expect(service.role()).toBe('admin');
  });

  // ---- Aliases / cooldowns / verification / emails ------------------------

  it('reads aliases and cooldowns', () => {
    const service = create();
    service.getAliases().subscribe();
    service.getCooldowns().subscribe();
    expect(api.get).toHaveBeenCalledWith('/auth/me/aliases');
    expect(api.get).toHaveBeenCalledWith('/auth/me/cooldowns');
  });

  it('requests email verification with and without a next path', () => {
    const service = create();
    service.requestEmailVerification('  /account  ').subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/verify/request', {}, undefined, {
      next: '/account',
    });
    service.requestEmailVerification().subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/verify/request', {}, undefined, undefined);
  });

  it('confirms email verification', () => {
    const service = create();
    service.confirmEmailVerification('tok').subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/verify/confirm', { token: 'tok' });
  });

  it('manages secondary emails', () => {
    const service = create();
    service.listEmails().subscribe();
    service.addSecondaryEmail('e@x').subscribe();
    service.requestSecondaryEmailVerification('id1', ' /next ').subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/me/emails/id1/verify/request', {}, undefined, {
      next: '/next',
    });
    service.requestSecondaryEmailVerification('id1').subscribe();
    expect(api.post).toHaveBeenCalledWith(
      '/auth/me/emails/id1/verify/request',
      {},
      undefined,
      undefined,
    );
    service.confirmSecondaryEmailVerification('tok').subscribe();
    service.deleteSecondaryEmail('id1', 'pw').subscribe();
    expect(api.delete).toHaveBeenCalledWith('/auth/me/emails/id1', undefined, undefined, {
      password: 'pw',
    });
    api.post.and.returnValue(of(makeUser({ role: 'admin' })));
    service.makeSecondaryEmailPrimary('id1', 'pw').subscribe();
    expect(service.role()).toBe('admin');
  });

  // ---- Sessions / security / 2FA / passkeys -------------------------------

  it('lists and revokes sessions and lists security events', () => {
    const service = create();
    service.listSessions().subscribe();
    service.revokeOtherSessions('pw').subscribe();
    service.listSecurityEvents().subscribe();
    expect(api.get).toHaveBeenCalledWith('/auth/me/security-events', { limit: 30 });
    service.listSecurityEvents(5).subscribe();
    expect(api.get).toHaveBeenCalledWith('/auth/me/security-events', { limit: 5 });
  });

  it('covers the two-factor endpoints', () => {
    const service = create();
    service.getTwoFactorStatus().subscribe();
    service.startTwoFactorSetup('pw').subscribe();
    service.enableTwoFactor('123').subscribe();
    service.disableTwoFactor('pw', '123').subscribe();
    service.regenerateTwoFactorRecoveryCodes('pw', '123').subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/me/2fa/recovery-codes/regenerate', {
      password: 'pw',
      code: '123',
    });
  });

  it('covers the passkey endpoints', () => {
    const service = create();
    service.listPasskeys().subscribe();
    service.startPasskeyRegistration('pw').subscribe();
    service.completePasskeyRegistration('rt', { id: 'c' }, 'My Key').subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/me/passkeys/register/verify', {
      registration_token: 'rt',
      credential: { id: 'c' },
      name: 'My Key',
    });
    service.completePasskeyRegistration('rt', { id: 'c' }).subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/me/passkeys/register/verify', {
      registration_token: 'rt',
      credential: { id: 'c' },
      name: null,
    });
    service.deletePasskey('pk1', 'pw').subscribe();
    expect(api.delete).toHaveBeenCalledWith('/auth/me/passkeys/pk1', undefined, undefined, {
      password: 'pw',
    });
    service.startPasskeyLogin('  user  ', true).subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/passkeys/login/options', {
      identifier: 'user',
      remember: true,
    });
    service.startPasskeyLogin(null, false).subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/passkeys/login/options', {
      identifier: null,
      remember: false,
    });
    api.post.and.returnValue(of({ user: makeUser(), tokens: tokens('a', 'b') }));
    service.completePasskeyLogin('at', { id: 'c' }, true).subscribe();
    expect(service.getAccessToken()).toBe('a');
  });

  // ---- Refresh -------------------------------------------------------------

  it('refresh returns null while impersonating', (done) => {
    sessionStorage.setItem(IMPERSONATION_KEY, validToken({ impersonator: 'admin' }));
    const service = create();
    service.refresh().subscribe((r) => {
      expect(r).toBeNull();
      done();
    });
  });

  it('refresh posts with a valid refresh token and stores new tokens', () => {
    const service = create();
    service.setTokens(tokens('old', validToken()));
    const newTokens = tokens('newA', 'newR');
    api.post.and.returnValue(of(newTokens));
    let result: AuthTokens | null | undefined;
    service.refresh({ silent: true }).subscribe((r) => (result = r));
    expect(api.post).toHaveBeenCalledWith(
      '/auth/refresh',
      { refresh_token: jasmine.any(String) },
      { 'X-Silent': '1' },
    );
    expect(result).toEqual(newTokens);
    expect(service.getAccessToken()).toBe('newA');
  });

  it('refresh posts an empty body when the refresh token is expired', () => {
    const service = create();
    service.setTokens(tokens('old', expiredToken()));
    api.post.and.returnValue(of(tokens('a', 'b')));
    service.refresh().subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/refresh', {}, undefined);
  });

  it('refresh reuses an in-flight request', () => {
    const service = create();
    api.post.and.returnValue(of(tokens('a', 'b')));
    const first = service.refresh();
    const second = service.refresh();
    expect(first).toBe(second);
    first.subscribe();
  });

  it('refresh swallows errors and returns null', (done) => {
    const service = create();
    api.post.and.returnValue(throwError(() => new Error('boom')));
    service.refresh().subscribe((r) => {
      expect(r).toBeNull();
      done();
    });
  });

  // ---- Logout / session lifecycle -----------------------------------------

  it('logout exits impersonation', (done) => {
    sessionStorage.setItem(IMPERSONATION_KEY, validToken({ impersonator: 'admin' }));
    const service = create();
    expect(service.isImpersonating()).toBeTrue();
    service.logout().subscribe(() => {
      expect(router.navigateByUrl).toHaveBeenCalledWith('/');
      done();
    });
  });

  it('logout posts with auth headers and clears the session', () => {
    const service = create();
    service.setTokens(tokens('access', 'refresh'));
    service.logout().subscribe();
    expect(api.post).toHaveBeenCalledWith(
      '/auth/logout',
      { refresh_token: 'refresh' },
      { Authorization: 'Bearer access' },
    );
    expect(service.getAccessToken()).toBeNull();
  });

  it('logout posts an empty body when no tokens are present', () => {
    const service = create();
    service.logout().subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/logout', {}, undefined);
  });

  it('logout swallows backend errors', (done) => {
    const service = create();
    service.setTokens(tokens('access', 'refresh'));
    api.post.and.returnValue(throwError(() => new Error('boom')));
    service.logout().subscribe((v) => {
      expect(v).toBeUndefined();
      done();
    });
  });

  it('expireSession exits impersonation when impersonating', () => {
    sessionStorage.setItem(IMPERSONATION_KEY, validToken({ impersonator: 'admin' }));
    const service = create();
    service.expireSession();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('expireSession redirects to login otherwise', () => {
    const service = create();
    service.expireSession();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('clearSession without a redirect does not navigate', () => {
    const service = create();
    router.navigateByUrl.calls.reset();
    service.clearSession();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  // ---- Password reset / current user / admin access -----------------------

  it('requests and confirms a password reset', () => {
    const service = create();
    service.requestPasswordReset('e@x').subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/password-reset/request', { email: 'e@x' });
    service.confirmPasswordReset('tok', 'newpw').subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/password-reset/confirm', {
      token: 'tok',
      new_password: 'newpw',
    });
  });

  it('loads the current user', () => {
    const service = create();
    api.get.and.returnValue(of(makeUser({ role: 'admin' })));
    service.loadCurrentUser().subscribe();
    expect(service.role()).toBe('admin');
  });

  it('checks admin access with the silent default and explicit value', () => {
    const service = create();
    service.checkAdminAccess().subscribe();
    expect(api.get).toHaveBeenCalledWith('/auth/admin/access', undefined, { 'X-Silent': '1' });
    service.checkAdminAccess({ silent: false }).subscribe();
    expect(api.get).toHaveBeenCalledWith('/auth/admin/access', undefined, undefined);
  });

  it('sets and clears the admin IP bypass', () => {
    const service = create();
    service.setAdminIpBypass('tok').subscribe();
    expect(api.post).toHaveBeenCalledWith('/auth/admin/ip-bypass', { token: 'tok' });
    service.clearAdminIpBypass().subscribe();
    expect(api.delete).toHaveBeenCalledWith('/auth/admin/ip-bypass');
  });

  // ---- ensureAuthenticated -------------------------------------------------

  it('ensureAuthenticated loads /auth/me when the access token is valid', (done) => {
    const service = create();
    service.setTokens(tokens(validToken(), validToken()));
    api.get.and.returnValue(of(makeUser({ role: 'admin' })));
    service.ensureAuthenticated().subscribe((ok) => {
      expect(ok).toBeTrue();
      expect(service.role()).toBe('admin');
      done();
    });
  });

  it('ensureAuthenticated refreshes then loads the user when no valid access token', (done) => {
    const service = create();
    api.post.and.returnValue(of(tokens(validToken(), validToken())));
    api.get.and.returnValue(of(makeUser()));
    service.ensureAuthenticated({ silent: true }).subscribe((ok) => {
      expect(ok).toBeTrue();
      done();
    });
  });

  it('ensureAuthenticated clears the session when refresh yields no tokens', (done) => {
    const service = create();
    api.post.and.returnValue(of(null));
    service.ensureAuthenticated().subscribe((ok) => {
      expect(ok).toBeFalse();
      done();
    });
  });

  it('ensureAuthenticated catches errors and clears the session', (done) => {
    const service = create();
    service.setTokens(tokens(validToken(), validToken()));
    api.get.and.returnValue(throwError(() => new Error('boom')));
    service.ensureAuthenticated().subscribe((ok) => {
      expect(ok).toBeFalse();
      expect(service.getAccessToken()).toBeNull();
      done();
    });
  });

  it('ensureAuthenticated reuses the in-flight request', () => {
    const service = create();
    service.setTokens(tokens(validToken(), validToken()));
    api.get.and.returnValue(of(makeUser()));
    const first = service.ensureAuthenticated();
    const second = service.ensureAuthenticated();
    expect(first).toBe(second);
    first.subscribe();
  });

  // ---- Impersonation -------------------------------------------------------

  it('bootstraps impersonation from the URL hash', () => {
    const token = validToken({ impersonator: 'admin' });
    window.location.hash = `#impersonate=${token}`;
    const service = create();
    expect(service.isImpersonating()).toBeTrue();
    expect(sessionStorage.getItem(IMPERSONATION_KEY)).toBe(token);
  });

  it('ignores a non-impersonation token in the URL hash', () => {
    window.location.hash = `#impersonate=${validToken()}`;
    const service = create();
    expect(service.isImpersonating()).toBeFalse();
  });

  it('ignores a hash without an impersonate parameter', () => {
    window.location.hash = '#other=value';
    const service = create();
    expect(service.isImpersonating()).toBeFalse();
  });

  it('bootstraps impersonation from session storage', () => {
    sessionStorage.setItem(IMPERSONATION_KEY, validToken({ impersonator: 'admin' }));
    const service = create();
    expect(service.isImpersonating()).toBeTrue();
  });

  it('clears an expired stored impersonation token', () => {
    sessionStorage.setItem(IMPERSONATION_KEY, expiredToken({ impersonator: 'admin' }));
    const service = create();
    expect(service.isImpersonating()).toBeFalse();
    expect(sessionStorage.getItem(IMPERSONATION_KEY)).toBeNull();
  });

  it('isImpersonating is false for a plain access token', () => {
    const service = create();
    service.setTokens(tokens(validToken(), validToken()));
    expect(service.isImpersonating()).toBeFalse();
  });

  it('exitImpersonation clears the session', () => {
    sessionStorage.setItem(IMPERSONATION_KEY, validToken({ impersonator: 'admin' }));
    const service = create();
    service.exitImpersonation({ redirectTo: '/bye' });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/bye');
  });

  // ---- Revalidation hooks --------------------------------------------------

  it('installs focus/visibility revalidation hooks with a cooldown', () => {
    const service = create();
    const ensureSpy = spyOn(service, 'ensureAuthenticated').and.returnValue(of(true));

    expect(focusHandlers.length).toBeGreaterThan(0);
    expect(visibilityHandlers.length).toBeGreaterThan(0);

    focusHandlers[0](new Event('focus'));
    expect(ensureSpy).toHaveBeenCalledTimes(1);

    // Within the cooldown window the second invocation is skipped.
    focusHandlers[0](new Event('focus'));
    expect(ensureSpy).toHaveBeenCalledTimes(1);

    // Reset the cooldown and drive the visibility handler (visible) -> revalidates.
    (service as unknown as { lastRevalidateAt: number }).lastRevalidateAt = 0;
    spyOnProperty(document, 'hidden', 'get').and.returnValue(false);
    visibilityHandlers[0](new Event('visibilitychange'));
    expect(ensureSpy).toHaveBeenCalledTimes(2);

    // The revalidation subscription swallows errors via its error callback.
    (service as unknown as { lastRevalidateAt: number }).lastRevalidateAt = 0;
    ensureSpy.and.returnValue(throwError(() => new Error('revalidate failed')));
    expect(() => focusHandlers[0](new Event('focus'))).not.toThrow();
    expect(ensureSpy).toHaveBeenCalledTimes(3);
  });

  it('skips revalidation when the document is hidden', () => {
    const service = create();
    const ensureSpy = spyOn(service, 'ensureAuthenticated').and.returnValue(of(true));
    spyOnProperty(document, 'hidden', 'get').and.returnValue(true);
    visibilityHandlers[0](new Event('visibilitychange'));
    expect(ensureSpy).not.toHaveBeenCalled();
  });

  // ---- Private helpers / storage edge cases -------------------------------

  it('parses JWT payloads and expiry defensively', () => {
    const service = create() as unknown as {
      parseJwtExpiry: (t: string) => number | null;
      parseJwtPayload: (t: string) => Record<string, unknown> | null;
      isJwtExpired: (t: string) => boolean;
    };
    expect(service.parseJwtExpiry('')).toBeNull();
    expect(service.parseJwtExpiry('only.two')).toBeNull();
    expect(service.parseJwtExpiry(jwt({ foo: 'bar' }))).toBeNull();
    expect(service.parseJwtExpiry('a.!!!.c')).toBeNull();
    expect(service.parseJwtExpiry(validToken())).toEqual(jasmine.any(Number));

    expect(service.parseJwtPayload('')).toBeNull();
    expect(service.parseJwtPayload('only.two')).toBeNull();
    expect(service.parseJwtPayload('a.!!!.c')).toBeNull();
    expect(service.parseJwtPayload(b64fakeNonObject())).toBeNull();
    expect(service.parseJwtPayload(validToken({ impersonator: 'x' }))).toEqual(jasmine.any(Object));

    expect(service.isJwtExpired('no.exp.token')).toBeTrue();
    expect(service.isJwtExpired(expiredToken())).toBeTrue();
    expect(service.isJwtExpired(validToken())).toBeFalse();
  });

  it('exercises the dead but exported-shaped private helpers', () => {
    const service = create() as unknown as {
      storageMode: 'local' | 'session';
      persistTokens: (t: AuthTokens) => void;
      persistRole: (r: string) => void;
      hasValidRefreshToken: () => boolean;
    };
    service.storageMode = 'local';
    service.persistTokens(tokens('a', 'b'));
    expect(localStorage.getItem('auth_tokens')).toContain('a');
    service.persistRole('admin');
    expect(localStorage.getItem('auth_role')).toBe('admin');
    service.persistRole('');
    expect(localStorage.getItem('auth_role')).toBe('');

    expect(service.hasValidRefreshToken()).toBeFalse();
    (service as unknown as AuthService).setTokens(tokens('a', validToken()));
    expect(service.hasValidRefreshToken()).toBeTrue();
    (service as unknown as AuthService).setTokens(tokens('a', expiredToken()));
    expect(service.hasValidRefreshToken()).toBeFalse();
  });

  it('handles missing storage by skipping reads and writes', () => {
    const service = create() as unknown as {
      getStorage: (mode: 'local' | 'session') => Storage | null;
      writeToStorage: (k: string, v: string) => void;
      readFromStorage: (k: string, m: 'local' | 'session') => string | null;
      removeFromStorage: (k: string) => void;
      clearStorage: (m?: 'local' | 'session') => void;
    };
    spyOn(service, 'getStorage').and.returnValue(null);
    expect(() => service.writeToStorage('k', 'v')).not.toThrow();
    expect(service.readFromStorage('k', 'session')).toBeNull();
    expect(() => service.removeFromStorage('k')).not.toThrow();
    expect(() => service.clearStorage()).not.toThrow();
    // Explicit single-mode clear exercises the `mode ? [mode] : [...]` branch.
    expect(() => service.clearStorage('session')).not.toThrow();
  });

  it('swallows storage access exceptions', () => {
    const service = create() as unknown as {
      getStorage: (mode: 'local' | 'session') => Storage | null;
      writeToStorage: (k: string, v: string) => void;
      readFromStorage: (k: string, m: 'local' | 'session') => string | null;
      removeFromStorage: (k: string) => void;
      clearStorage: () => void;
    };
    spyOn(Storage.prototype, 'setItem').and.throwError('blocked');
    spyOn(Storage.prototype, 'getItem').and.throwError('blocked');
    spyOn(Storage.prototype, 'removeItem').and.throwError('blocked');
    expect(() => service.writeToStorage('k', 'v')).not.toThrow();
    expect(service.readFromStorage('k', 'session')).toBeNull();
    expect(() => service.removeFromStorage('k')).not.toThrow();
    expect(() => service.clearStorage()).not.toThrow();
  });

  it('returns null when storage access throws inside getStorage', () => {
    const service = create() as unknown as {
      getStorage: (mode: 'local' | 'session') => Storage | null;
    };
    spyOnProperty(window, 'localStorage', 'get').and.throwError('blocked');
    spyOnProperty(window, 'sessionStorage', 'get').and.throwError('blocked');
    expect(service.getStorage('local')).toBeNull();
    expect(service.getStorage('session')).toBeNull();
  });

  it('loads a persisted user, tolerating invalid JSON', () => {
    sessionStorage.setItem('auth_tokens', JSON.stringify(tokens(validToken(), validToken())));
    sessionStorage.setItem('auth_user', JSON.stringify(makeUser()));
    const service = create() as unknown as {
      loadUserFrom: (m: 'local' | 'session') => AuthUser | null;
    };
    // bootstrap already cleared storage; re-seed for the direct read paths.
    sessionStorage.setItem('auth_user', JSON.stringify(makeUser({ role: 'admin' })));
    expect(service.loadUserFrom('session')?.role).toBe('admin');
    sessionStorage.setItem('auth_user', 'not json');
    expect(service.loadUserFrom('session')).toBeNull();
    sessionStorage.removeItem('auth_user');
    expect(service.loadUserFrom('session')).toBeNull();
  });

  it('swallows errors when clearing the impersonation token from the URL', () => {
    spyOn(window.history, 'replaceState').and.throwError('blocked');
    const token = validToken({ impersonator: 'admin' });
    window.location.hash = `#impersonate=${token}`;
    const service = create();
    expect(service.isImpersonating()).toBeTrue();
  });

  it('swallows errors when writing the impersonation token to storage', () => {
    const token = validToken({ impersonator: 'admin' });
    window.location.hash = `#impersonate=${token}`;
    spyOn(Storage.prototype, 'setItem').and.throwError('blocked');
    expect(() => create()).not.toThrow();
  });

  it('returns null when reading the impersonation token from storage throws', () => {
    const service = create() as unknown as {
      readImpersonationTokenFromStorage: () => string | null;
    };
    spyOn(Storage.prototype, 'getItem').and.throwError('blocked');
    expect(service.readImpersonationTokenFromStorage()).toBeNull();
  });

  it('swallows errors when clearing impersonation from storage', () => {
    const service = create() as unknown as { clearImpersonation: () => void };
    spyOn(Storage.prototype, 'removeItem').and.throwError('blocked');
    expect(() => service.clearImpersonation()).not.toThrow();
  });
});

function b64fakeNonObject(): string {
  // A JWT whose payload base64 decodes to a non-object JSON value (a number).
  return `header.${b64url(123)}.signature`;
}
