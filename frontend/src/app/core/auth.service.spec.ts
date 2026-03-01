import { Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { ApiService } from './api.service';
import {
  AuthResponse,
  AuthService,
  AuthTokens,
  AuthUser,
  GoogleCallbackResponse,
  TwoFactorChallengeResponse
} from './auth.service';

type ApiSpy = jasmine.SpyObj<Pick<ApiService, 'get' | 'post' | 'patch' | 'delete'>>;
type RouterSpy = jasmine.SpyObj<Pick<Router, 'navigateByUrl'>>;

type AuthInternals = {
  ensureInFlight: Observable<boolean> | null;
  persist: (res: AuthResponse, remember: boolean) => void;
  refreshInFlight: Observable<AuthTokens | null> | null;
  setUser: (user: AuthUser | null) => void;
  stepUpToken: string | null;
};

function base64UrlEncode(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function createJwt(payload: Record<string, unknown>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

function createUser(role = 'user', overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u-1',
    email: 'ana@example.com',
    username: 'ana',
    role,
    ...overrides
  };
}

function createTokens(opts?: {
  accessExpOffsetSec?: number;
  refreshExpOffsetSec?: number;
  impersonator?: string;
}): AuthTokens {
  const now = Math.floor(Date.now() / 1000);
  const accessPayload: Record<string, unknown> = {
    exp: now + (opts?.accessExpOffsetSec ?? 3_600)
  };
  if (opts?.impersonator) {
    accessPayload['impersonator'] = opts.impersonator;
  }
  return {
    access_token: createJwt(accessPayload),
    refresh_token: createJwt({ exp: now + (opts?.refreshExpOffsetSec ?? 7_200) }),
    token_type: 'bearer'
  };
}

function createService(): {
  service: AuthService;
  api: ApiSpy;
  router: RouterSpy;
  internals: AuthInternals;
} {
  const api = jasmine.createSpyObj<ApiSpy>('ApiService', ['get', 'post', 'patch', 'delete']);
  const router = jasmine.createSpyObj<RouterSpy>('Router', ['navigateByUrl']);
  router.navigateByUrl.and.returnValue(Promise.resolve(true));

  const proto = AuthService.prototype as unknown as { installRevalidationHooks: () => void };
  const originalInstallHooks = proto.installRevalidationHooks;
  proto.installRevalidationHooks = () => void 0;
  const service = new AuthService(api as unknown as ApiService, router as unknown as Router);
  proto.installRevalidationHooks = originalInstallHooks;
  return { service, api, router, internals: service as unknown as AuthInternals };
}

function readSync<T>(obs$: Observable<T>): T {
  let emitted = false;
  let value!: T;
  obs$.subscribe((next) => {
    emitted = true;
    value = next;
  });
  if (!emitted) {
    throw new Error('Expected synchronous observable emission');
  }
  return value;
}

describe('AuthService', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, document.title, '/');
  });

  it('evaluates role-based permissions for admin sections', () => {
    const { service, internals } = createService();

    expect(service.canAccessAdminSection('dashboard')).toBeFalse();

    internals.setUser(createUser('owner'));
    expect(service.isAdmin()).toBeTrue();
    expect(service.isStaff()).toBeTrue();
    expect(service.canAccessAdminSection('anything')).toBeTrue();

    internals.setUser(createUser('support'));
    expect(service.isAdmin()).toBeFalse();
    expect(service.isStaff()).toBeTrue();
    expect(service.canAccessAdminSection(' users ')).toBeTrue();
    expect(service.canAccessAdminSection('orders')).toBeFalse();

    internals.setUser(createUser('fulfillment'));
    expect(service.canAccessAdminSection('inventory')).toBeTrue();
    expect(service.canAccessAdminSection('content')).toBeFalse();

    internals.setUser(createUser('content'));
    expect(service.canAccessAdminSection('products')).toBeTrue();
    expect(service.canAccessAdminSection('support')).toBeFalse();
  });

  it('returns and clears step-up tokens based on expiry', () => {
    const { service, internals } = createService();

    internals.stepUpToken = '   ';
    expect(service.getStepUpToken()).toBeNull();

    const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3_600 });
    internals.stepUpToken = validToken;
    expect(service.getStepUpToken()).toBe(validToken);

    internals.stepUpToken = createJwt({ exp: Math.floor(Date.now() / 1000) - 120 });
    expect(service.getStepUpToken()).toBeNull();
    expect(internals.stepUpToken).toBeNull();
  });

  it('persists login only for full auth responses', () => {
    const { service, api, internals } = createService();
    const authResponse: AuthResponse = {
      user: createUser('customer'),
      tokens: createTokens()
    };
    const challengeResponse: TwoFactorChallengeResponse = {
      user: createUser('customer'),
      requires_two_factor: true,
      two_factor_token: '2fa-token'
    };
    api.post.and.returnValues(
      of<AuthResponse | TwoFactorChallengeResponse>(authResponse),
      of<AuthResponse | TwoFactorChallengeResponse>(challengeResponse)
    );

    const persistSpy = spyOn(internals, 'persist').and.callThrough();

    const first = readSync(service.login('ana', 'secret', undefined, { remember: true }));
    const second = readSync(service.login('ana', 'secret'));

    expect(first).toEqual(authResponse);
    expect(second).toEqual(challengeResponse);
    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(persistSpy).toHaveBeenCalledWith(authResponse, true);
  });

  it('persists google callback responses only when tokens exist', () => {
    const { service, api, internals } = createService();
    const withTokens: GoogleCallbackResponse = {
      user: createUser('customer'),
      tokens: createTokens()
    };
    const withoutTokens: GoogleCallbackResponse = {
      user: createUser('customer'),
      tokens: null
    };
    api.post.and.returnValues(of(withTokens), of(withoutTokens));

    const persistSpy = spyOn(internals, 'persist').and.callThrough();

    readSync(service.completeGoogleLogin('code-1', 'state-1'));
    readSync(service.completeGoogleLogin('code-2', 'state-2'));

    expect(persistSpy).toHaveBeenCalledTimes(1);
  });

  it('maps google link start response to auth_url', () => {
    const { service, api } = createService();
    api.get.and.returnValue(of({ auth_url: 'https://accounts.google.test/start' }));

    const authUrl = readSync(service.startGoogleLink());

    expect(authUrl).toBe('https://accounts.google.test/start');
    expect(api.get).toHaveBeenCalledWith('/auth/google/link/start');
  });

  it('updates local user state when linking and unlinking google accounts', () => {
    const { service, api } = createService();
    const linked = createUser('customer', { google_sub: 'google-1' });
    const unlinked = createUser('customer', { google_sub: null });
    api.post.and.returnValues(of(linked), of(unlinked));

    const linkedUser = readSync(service.completeGoogleLink('code-1', 'state-1', 'pw-1'));
    const unlinkedUser = readSync(service.unlinkGoogle('pw-2'));

    expect(linkedUser).toEqual(linked);
    expect(unlinkedUser).toEqual(unlinked);
    expect(service.user()).toEqual(unlinked);
    expect(api.post).toHaveBeenCalledWith('/auth/google/link', { code: 'code-1', state: 'state-1', password: 'pw-1' });
    expect(api.post).toHaveBeenCalledWith('/auth/google/unlink', { password: 'pw-2' });
  });

  it('short-circuits user update endpoints when unauthenticated', () => {
    const { service, api } = createService();

    const avatarResponse = readSync(service.uploadAvatar(new File(['x'], 'avatar.png', { type: 'image/png' })));
    const languageResponse = readSync(service.updatePreferredLanguage('ro'));
    const profileResponse = readSync(service.updateProfile({ name: 'Ana' }));

    expect(avatarResponse).toEqual({} as AuthUser);
    expect(languageResponse).toEqual({} as AuthUser);
    expect(profileResponse).toEqual({} as AuthUser);
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('updates authenticated users and refreshes local user signal', () => {
    const { service, api, internals } = createService();
    internals.setUser(createUser('customer'));

    const nextUser = createUser('customer', { preferred_language: 'ro' });
    api.patch.and.returnValue(of(nextUser));

    const response = readSync(service.updatePreferredLanguage('ro'));

    expect(response).toEqual(nextUser);
    expect(api.patch).toHaveBeenCalledWith('/auth/me/language', { preferred_language: 'ro' });
    expect(service.user()).toEqual(nextUser);
  });

  it('normalizes optional next query params for verification endpoints', () => {
    const { service, api } = createService();
    api.post.and.returnValue(of({ detail: 'ok' }));

    readSync(service.requestEmailVerification('   '));
    expect(api.post).toHaveBeenCalledWith('/auth/verify/request', {}, undefined, undefined);

    readSync(service.requestEmailVerification(' /account/profile '));
    expect(api.post).toHaveBeenCalledWith('/auth/verify/request', {}, undefined, { next: '/account/profile' });

    readSync(service.requestSecondaryEmailVerification('secondary-1', '  '));
    expect(api.post).toHaveBeenCalledWith('/auth/me/emails/secondary-1/verify/request', {}, undefined, undefined);

    readSync(service.requestSecondaryEmailVerification('secondary-1', ' /account/security '));
    expect(api.post).toHaveBeenCalledWith('/auth/me/emails/secondary-1/verify/request', {}, undefined, { next: '/account/security' });
  });

  it('normalizes passkey login identifiers before API calls', () => {
    const { service, api } = createService();
    api.post.and.returnValue(of({ authentication_token: 'token', options: {} }));

    readSync(service.startPasskeyLogin('  ana@example.com  ', true));
    expect(api.post).toHaveBeenCalledWith('/auth/passkeys/login/options', {
      identifier: 'ana@example.com',
      remember: true
    });

    readSync(service.startPasskeyLogin('   ', false));
    expect(api.post).toHaveBeenCalledWith('/auth/passkeys/login/options', {
      identifier: null,
      remember: false
    });
  });

  it('persists auth response when completing passkey login', () => {
    const { service, api, internals } = createService();
    const authResponse: AuthResponse = { user: createUser('customer'), tokens: createTokens() };
    api.post.and.returnValue(of(authResponse));
    const persistSpy = spyOn(internals, 'persist').and.callThrough();

    const response = readSync(service.completePasskeyLogin('auth-token', { id: 'cred-1' }, true));

    expect(response).toEqual(authResponse);
    expect(persistSpy).toHaveBeenCalledWith(authResponse, true);
    expect(api.post).toHaveBeenCalledWith('/auth/passkeys/login/verify', {
      authentication_token: 'auth-token',
      credential: { id: 'cred-1' }
    });
  });

  it('uses silent admin-access checks by default and supports explicit non-silent checks', () => {
    const { service, api } = createService();
    api.get.and.returnValue(of({ allowed: true }));

    readSync(service.checkAdminAccess());
    expect(api.get).toHaveBeenCalledWith('/auth/admin/access', undefined, { 'X-Silent': '1' });

    readSync(service.checkAdminAccess({ silent: false }));
    expect(api.get).toHaveBeenCalledWith('/auth/admin/access', undefined, undefined);
  });

  it('forwards admin IP bypass set and clear requests', () => {
    const { service, api } = createService();
    api.post.and.returnValue(of(void 0));
    api.delete.and.returnValue(of(void 0));

    readSync(service.setAdminIpBypass('bypass-token'));
    readSync(service.clearAdminIpBypass());

    expect(api.post).toHaveBeenCalledWith('/auth/admin/ip-bypass', { token: 'bypass-token' });
    expect(api.delete).toHaveBeenCalledWith('/auth/admin/ip-bypass');
  });

  it('returns null refresh immediately while impersonating', () => {
    const { service, api } = createService();
    service.setTokens(createTokens({ impersonator: 'owner-1' }));

    const refreshed = readSync(service.refresh());

    expect(refreshed).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('reuses in-flight refresh observable and refreshes tokens for valid refresh sessions', () => {
    const { service, api, internals } = createService();

    const inFlight = of<AuthTokens | null>(createTokens({ accessExpOffsetSec: 900 }));
    internals.refreshInFlight = inFlight;
    expect(service.refresh()).toBe(inFlight);

    internals.refreshInFlight = null;
    const current = createTokens({ accessExpOffsetSec: 3_600, refreshExpOffsetSec: 3_600 });
    const refreshed = createTokens({ accessExpOffsetSec: 7_200, refreshExpOffsetSec: 7_200 });
    service.setTokens(current);
    api.post.and.returnValue(of(refreshed));

    const result = readSync(service.refresh({ silent: true }));

    expect(result).toEqual(refreshed);
    expect(api.post).toHaveBeenCalledWith(
      '/auth/refresh',
      { refresh_token: current.refresh_token },
      { 'X-Silent': '1' }
    );
    expect(service.getAccessToken()).toBe(refreshed.access_token);
  });

  it('refreshes with an empty body for expired refresh tokens and swallows refresh errors', () => {
    const { service, api } = createService();
    const expiredRefresh = createTokens({ accessExpOffsetSec: 3_600, refreshExpOffsetSec: -300 });
    service.setTokens(expiredRefresh);
    api.post.and.returnValue(throwError(() => new Error('refresh failed')));

    const result = readSync(service.refresh());

    expect(result).toBeNull();
    expect(api.post).toHaveBeenCalledWith('/auth/refresh', {}, undefined);
  });

  it('logs out impersonated sessions through exit flow', () => {
    const { service, api } = createService();
    service.setTokens(createTokens({ impersonator: 'staff-user' }));
    const exitSpy = spyOn(service, 'exitImpersonation').and.callThrough();

    const result = readSync(service.logout());

    expect(result).toBeUndefined();
    expect(exitSpy).toHaveBeenCalledWith({ redirectTo: '/' });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('clears session before normal logout API call and tolerates API failures', () => {
    const { service, api } = createService();
    const current = createTokens({ accessExpOffsetSec: 3_600, refreshExpOffsetSec: 7_200 });
    service.setTokens(current);
    const clearSessionSpy = spyOn(service, 'clearSession').and.callThrough();
    api.post.and.returnValue(throwError(() => new Error('network failure')));

    const result = readSync(service.logout());

    expect(result).toBeUndefined();
    expect(clearSessionSpy).toHaveBeenCalledWith({ redirectTo: '/' });
    expect(api.post).toHaveBeenCalledWith(
      '/auth/logout',
      { refresh_token: current.refresh_token },
      { Authorization: `Bearer ${current.access_token}` }
    );
  });

  it('returns existing in-flight ensureAuthenticated observables', () => {
    const { service, internals } = createService();
    const inFlight = of(true);
    internals.ensureInFlight = inFlight;

    expect(service.ensureAuthenticated()).toBe(inFlight);
  });

  it('uses /auth/me directly when access token is valid', () => {
    const { service, api } = createService();
    service.setTokens(createTokens({ accessExpOffsetSec: 3_600, refreshExpOffsetSec: 7_200 }));
    api.get.and.returnValue(of(createUser('admin')));
    const refreshSpy = spyOn(service, 'refresh').and.callThrough();

    const isAuthed = readSync(service.ensureAuthenticated({ silent: true }));

    expect(isAuthed).toBeTrue();
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledWith('/auth/me', undefined, { 'X-Silent': '1' });
  });

  it('clears session when refresh yields no tokens during ensureAuthenticated', () => {
    const { service } = createService();
    spyOn(service, 'refresh').and.returnValue(of(null));
    const clearSessionSpy = spyOn(service, 'clearSession').and.stub();

    const isAuthed = readSync(service.ensureAuthenticated());

    expect(isAuthed).toBeFalse();
    expect(clearSessionSpy).toHaveBeenCalled();
  });

  it('clears session when /auth/me fails after a refresh during ensureAuthenticated', () => {
    const { service, api } = createService();
    spyOn(service, 'refresh').and.returnValue(of(createTokens()));
    api.get.and.returnValue(throwError(() => new Error('forbidden')));
    const clearSessionSpy = spyOn(service, 'clearSession').and.callThrough();

    const isAuthed = readSync(service.ensureAuthenticated());

    expect(isAuthed).toBeFalse();
    expect(clearSessionSpy).toHaveBeenCalled();
  });

  it('drops fully expired persisted tokens during bootstrap', () => {
    const expired = createTokens({ accessExpOffsetSec: -7_200, refreshExpOffsetSec: -7_200 });
    window.sessionStorage.setItem('auth_tokens', JSON.stringify(expired));

    const { service } = createService();

    expect(service.getAccessToken()).toBeNull();
    expect(service.getRefreshToken()).toBeNull();
  });

  it('keeps persisted tokens when at least one token is still valid', () => {
    const partial = createTokens({ accessExpOffsetSec: -7_200, refreshExpOffsetSec: 7_200 });
    window.sessionStorage.setItem('auth_tokens', JSON.stringify(partial));

    const { service } = createService();

    expect(service.getAccessToken()).toBe(partial.access_token);
    expect(service.getRefreshToken()).toBe(partial.refresh_token);
  });
});
