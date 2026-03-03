import { Router } from '@angular/router';

import { ApiService } from './api.service';
import { AuthService, type AuthTokens, type AuthUser } from './auth.service';

type ApiSpy = jasmine.SpyObj<Pick<ApiService, 'get' | 'post' | 'patch' | 'delete'>>;
type RouterSpy = jasmine.SpyObj<Pick<Router, 'navigateByUrl'>>;

function base64UrlEncode(input: string): string {
  const encoded = btoa(input).replaceAll('+', '-').replaceAll('/', '_');
  return encoded.replace(/=+$/g, '');
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
  const originalInstallHooks = proto.installRevalidationHooks;
  proto.installRevalidationHooks = () => void 0;
  const service = new AuthService(api as unknown as ApiService, router as unknown as Router);
  proto.installRevalidationHooks = originalInstallHooks;
  return { service, api, router };
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
    const expired = createJwt({ exp: Math.floor(Date.now() / 1000) - 5 });

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

    globalThis.sessionStorage.setItem('auth_tokens', '{bad');
    globalThis.localStorage.setItem(
      'auth_tokens',
      JSON.stringify({
        access_token: createJwt({ exp: Math.floor(Date.now() / 1000) + 600 }),
        refresh_token: createJwt({ exp: Math.floor(Date.now() / 1000) + 1200 }),
        token_type: 'bearer',
      } satisfies AuthTokens)
    );
    globalThis.localStorage.setItem('auth_user', JSON.stringify({ id: 'u-1', email: 'u@example.test', role: 'customer' } satisfies Partial<AuthUser>));

    const loaded = internals.loadPersisted();
    expect(loaded.mode).toBe('local');
    expect(loaded.tokens?.access_token).toContain('.');
    expect(loaded.user?.id).toBe('u-1');

    expect(internals.loadTokensFrom('session')).toBeNull();
    expect(internals.loadUserFrom('session')).toBeNull();
  });

  it('covers impersonation bootstrap from URL hash and invalid token cleanup', () => {
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

  it('covers setTokens and clearSession branches with and without redirect', async () => {
    const { service, router } = createService();

    const token = createJwt({ exp: Math.floor(Date.now() / 1000) + 1200 });
    service.setTokens({ access_token: token, refresh_token: token, token_type: 'bearer' });
    expect(service.getAccessToken()).toBe(token);

    service.setTokens(null);
    expect(service.getAccessToken()).toBeNull();

    service.clearSession();
    expect(router.navigateByUrl).not.toHaveBeenCalled();

    service.clearSession({ redirectTo: '/login' });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');

    router.navigateByUrl.calls.reset();
    service.clearSession({ redirectTo: '' });
    expect(router.navigateByUrl).not.toHaveBeenCalled();

    service.clearSession({ redirectTo: '/account' });
    await Promise.resolve();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/account');
  });
});

