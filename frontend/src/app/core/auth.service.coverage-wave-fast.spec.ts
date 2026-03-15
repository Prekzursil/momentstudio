import { Router } from '@angular/router';
import { firstValueFrom, of, throwError } from 'rxjs';

import { ApiService } from './api.service';
import { AuthService, type AuthResponse, type AuthTokens, type AuthUser } from './auth.service';

type ApiSpy = jasmine.SpyObj<Pick<ApiService, 'get' | 'post' | 'patch' | 'delete'>>;
type RouterSpy = jasmine.SpyObj<Pick<Router, 'navigateByUrl'>>;

function base64UrlEncode(input: string): string {
  let encoded = btoa(input).replaceAll('+', '-').replaceAll('/', '_');
  while (encoded.endsWith('=')) encoded = encoded.slice(0, -1);
  return encoded;
}

function createJwt(payload: Record<string, unknown>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

function createService(): { service: AuthService; api: ApiSpy; router: RouterSpy } {
  const api = jasmine.createSpyObj<ApiSpy>('ApiService', ['get', 'post', 'patch', 'delete']);
  const router = jasmine.createSpyObj<RouterSpy>('Router', ['navigateByUrl']);
  router.navigateByUrl.and.returnValue(Promise.resolve(true));

  const proto = AuthService.prototype as unknown as { installRevalidationHooks: () => void };
  const originalInstall = proto.installRevalidationHooks;
  proto.installRevalidationHooks = () => void 0;
  const service = new AuthService(api as unknown as ApiService, router as unknown as Router);
  proto.installRevalidationHooks = originalInstall;
  return { service, api, router };
}

function authUser(overrides?: Partial<AuthUser>): AuthUser {
  return {
    id: 'u-1',
    email: 'u@example.test',
    username: 'user',
    role: 'customer',
    ...overrides,
  };
}

describe('AuthService coverage fast wave', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    globalThis.sessionStorage.clear();
    globalThis.history.replaceState({}, document.title, '/');
  });

  it('covers jwt payload/expiry parsing and impersonation detection helpers', () => {
    const { service } = createService();
    const internals = service as any;

    const valid = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, impersonator: 'owner-1' });
    const expired = createJwt({ exp: Math.floor(Date.now() / 1000) - 10 });

    expect(internals.parseJwtPayload('bad-token')).toBeNull();
    expect(internals.parseJwtExpiry('bad-token')).toBeNull();
    expect(internals.parseJwtPayload(valid)).toEqual(jasmine.objectContaining({ impersonator: 'owner-1' }));
    expect(internals.parseJwtExpiry(valid)).toEqual(jasmine.any(Number));
    expect(internals.isImpersonationToken(valid)).toBeTrue();
    expect(internals.isJwtExpired(expired)).toBeTrue();
    expect(internals.isJwtExpired(valid, 0)).toBeFalse();
  });

  it('covers persisted token/user loading with malformed and local/session fallback states', () => {
    const { service } = createService();
    const internals = service as any;

    globalThis.sessionStorage.setItem('auth_tokens', '{broken');
    globalThis.localStorage.setItem(
      'auth_tokens',
      JSON.stringify({
        access_token: createJwt({ exp: Math.floor(Date.now() / 1000) + 600 }),
        refresh_token: createJwt({ exp: Math.floor(Date.now() / 1000) + 1200 }),
        token_type: 'bearer',
      } satisfies AuthTokens),
    );
    globalThis.localStorage.setItem('auth_user', JSON.stringify(authUser()));

    const loaded = internals.loadPersisted();
    expect(loaded.mode).toBe('local');
    expect(loaded.tokens?.access_token).toContain('.');
    expect(loaded.user?.email).toBe('u@example.test');
    expect(internals.loadTokensFrom('session')).toBeNull();
    expect(internals.loadUserFrom('session')).toBeNull();
  });

  it('covers impersonation bootstrap from URL and invalid token cleanup', () => {
    const good = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, impersonator: 'owner-1' });
    globalThis.history.replaceState({}, document.title, `/#impersonate=${encodeURIComponent(good)}`);

    const { service } = createService();
    const internals = service as any;
    expect(service.getAccessToken()).toBe(good);
    expect(service.isImpersonating()).toBeTrue();

    globalThis.sessionStorage.setItem('impersonation_access_token', 'bad');
    internals.bootstrapImpersonation();
    expect(globalThis.sessionStorage.getItem('impersonation_access_token')).toBeNull();
  });

  it('covers setTokens and clearSession branches with redirect variations', () => {
    const { service, router } = createService();
    const token = createJwt({ exp: Math.floor(Date.now() / 1000) + 900 });

    service.setTokens({ access_token: token, refresh_token: token, token_type: 'bearer' });
    expect(service.getAccessToken()).toBe(token);

    service.setTokens(null);
    expect(service.getAccessToken()).toBeNull();

    service.clearSession();
    expect(router.navigateByUrl).not.toHaveBeenCalled();

    service.clearSession({ redirectTo: '/login' });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('covers profile/account wrapper endpoints and unauthenticated short-circuit', async () => {
    const { service, api } = createService();
    const internals = service as any;
    const user = authUser();
    internals.setUser(user);

    const patchMap: Record<string, AuthUser> = {
      '/auth/me/language': authUser({ name: 'lang' }),
      '/auth/me/notifications': authUser({ name: 'notify' }),
      '/auth/me/training-mode': authUser({ name: 'train' }),
      '/auth/me': authUser({ name: 'profile' }),
      '/auth/me/username': authUser({ username: 'updated' }),
      '/auth/me/email': authUser({ email: 'new@example.test' }),
    };

    const postMap: Record<string, unknown> = {
      '/auth/password/change': { detail: 'ok' },
      '/auth/verify/request': { detail: 'requested' },
      '/auth/verify/confirm': { detail: 'confirmed', email_verified: true },
      '/auth/me/emails/sec-1/verify/request': { detail: 'secondary-requested' },
      '/auth/me/emails/verify/confirm': { id: 's1', email: 's@example.test', verified: true, created_at: 'now' },
      '/auth/me/emails/sec-1/make-primary': authUser({ email: 's@example.test' }),
      '/auth/password-reset/request': void 0,
      '/auth/password-reset/confirm': void 0,
    };

    const getMap: Record<string, unknown> = {
      '/auth/google/start': { auth_url: 'https://idp.test' },
      '/auth/google/link/start': { auth_url: 'https://idp.test' },
      '/auth/me/aliases': { usernames: [], display_names: [] },
      '/auth/me/cooldowns': {
        username: { remaining_seconds: 0 },
        display_name: { remaining_seconds: 0 },
        email: { remaining_seconds: 0 },
      },
      '/auth/me/emails': { primary_email: 'u@example.test', primary_verified: true, secondary_emails: [] },
    };

    (api.patch as any).and.callFake((url: string) => of((patchMap[url] ?? user) as any));
    (api.post as any).and.callFake((url: string) => of((postMap[url] ?? user) as any));
    (api.get as any).and.callFake((url: string) => of((getMap[url] ?? {}) as any));
    (api.delete as any).and.callFake(() => of(void 0));

    await firstValueFrom(service.changePassword('old', 'new'));
    await firstValueFrom(service.startGoogleLogin());
    await firstValueFrom(service.startGoogleLink());
    await firstValueFrom(service.updatePreferredLanguage('ro'));
    await firstValueFrom(service.updateNotificationPreferences({ notify_marketing: true }));
    await firstValueFrom(service.updateTrainingMode(true));
    await firstValueFrom(service.updateProfile({ name: 'Updated' }));
    await firstValueFrom(service.updateUsername('newu', 'pw'));
    await firstValueFrom(service.updateEmail('new@example.test', 'pw'));
    await firstValueFrom(service.getAliases());
    await firstValueFrom(service.getCooldowns());
    await firstValueFrom(service.requestEmailVerification('/account'));
    await firstValueFrom(service.confirmEmailVerification('token'));
    await firstValueFrom(service.listEmails());
    await firstValueFrom(service.requestSecondaryEmailVerification('sec-1', '/next'));
    await firstValueFrom(service.confirmSecondaryEmailVerification('token2'));
    await firstValueFrom(service.deleteSecondaryEmail('sec-1', 'pw'));
    await firstValueFrom(service.makeSecondaryEmailPrimary('sec-1', 'pw'));
    await firstValueFrom(service.requestPasswordReset('u@example.test'));
    await firstValueFrom(service.confirmPasswordReset('token', 'pw'));

    internals.setUser(null);
    const unauthProfile = await firstValueFrom(service.updateProfile({ name: 'Noop' }));
    expect(unauthProfile).toEqual({} as AuthUser);
  });

  it('covers 2fa, passkey, refresh/logout and ensureAuthenticated fallback branches', async () => {
    const { service, api, router } = createService();
    const user = authUser({ id: 'u-2' });
    const fresh = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    const expired = createJwt({ exp: Math.floor(Date.now() / 1000) - 10 });

    const postMap: Record<string, unknown> = {
      '/auth/me/sessions/revoke-others': { revoked: 1 },
      '/auth/me/2fa/setup': { secret: 'sec', otpauth_url: 'otpauth://x' },
      '/auth/me/2fa/enable': { recovery_codes: ['a'] },
      '/auth/me/2fa/disable': { enabled: false },
      '/auth/me/2fa/recovery-codes/regenerate': { recovery_codes: ['b'] },
      '/auth/me/passkeys/register/options': { registration_token: 'reg', options: {} },
      '/auth/me/passkeys/register/verify': { id: 'pk', created_at: 'now' },
      '/auth/passkeys/login/options': { authentication_token: 'auth', options: {} },
      '/auth/passkeys/login/verify': {
        user,
        tokens: { access_token: fresh, refresh_token: fresh, token_type: 'bearer' },
      } satisfies AuthResponse,
      '/auth/admin/ip-bypass': void 0,
    };

    (api.get as any).and.callFake((url: string) => {
      if (url === '/auth/me/passkeys') return of([]);
      if (url === '/auth/me/sessions') return of([]);
      if (url === '/auth/me/security-events') return of([]);
      if (url === '/auth/me/2fa') return of({ enabled: false });
      if (url === '/auth/admin/access') return of({ allowed: true });
      if (url === '/auth/me') return of(user);
      return of({});
    });

    (api.post as any).and.callFake((url: string, body?: unknown, headers?: Record<string, string>) => {
      if (url === '/auth/refresh') {
        if (headers?.['X-Silent'] === '1') return of({ access_token: fresh, refresh_token: fresh, token_type: 'bearer' });
        return throwError(() => new Error('refresh-fail'));
      }
      if (url === '/auth/logout') return throwError(() => new Error('logout-fail'));
      return of((postMap[url] ?? void 0) as any);
    });

    (api.delete as any).and.callFake((url: string) => {
      if (url === '/auth/admin/ip-bypass' || url === '/auth/me/passkeys/pk') return of(void 0);
      return of(void 0);
    });

    await firstValueFrom(service.listSessions());
    await firstValueFrom(service.revokeOtherSessions('pw'));
    await firstValueFrom(service.listSecurityEvents(5));
    await firstValueFrom(service.getTwoFactorStatus());
    await firstValueFrom(service.startTwoFactorSetup('pw'));
    await firstValueFrom(service.enableTwoFactor('123456'));
    await firstValueFrom(service.disableTwoFactor('pw', '123456'));
    await firstValueFrom(service.regenerateTwoFactorRecoveryCodes('pw', '123456'));
    await firstValueFrom(service.listPasskeys());
    await firstValueFrom(service.startPasskeyRegistration('pw'));
    await firstValueFrom(service.completePasskeyRegistration('reg', { id: 'cred' }, 'Key'));
    await firstValueFrom(service.startPasskeyLogin('u@example.test', true));
    await firstValueFrom(service.completePasskeyLogin('auth', { id: 'cred' }, true));
    await firstValueFrom(service.deletePasskey('pk', 'pw'));
    await firstValueFrom(service.checkAdminAccess({ silent: false }));
    await firstValueFrom(service.setAdminIpBypass('token'));
    await firstValueFrom(service.clearAdminIpBypass());

    service.setTokens({ access_token: fresh, refresh_token: fresh, token_type: 'bearer' });
    const refreshed = await firstValueFrom(service.refresh({ silent: true }));
    expect(refreshed?.access_token).toBe(fresh);

    service.setTokens({ access_token: fresh, refresh_token: fresh, token_type: 'bearer' });
    await firstValueFrom(service.logout());
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');

    service.setTokens({ access_token: expired, refresh_token: fresh, token_type: 'bearer' });
    const ensured = await firstValueFrom(service.ensureAuthenticated());
    expect(ensured).toBeFalse();
  });
});