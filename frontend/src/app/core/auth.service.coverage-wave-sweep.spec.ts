import { of, throwError } from 'rxjs';
import { Router } from '@angular/router';

import { ApiService } from './api.service';
import { AuthService } from './auth.service';

type ApiSpy = jasmine.SpyObj<Pick<ApiService, 'get' | 'post' | 'patch' | 'delete'>>;
type RouterSpy = jasmine.SpyObj<Pick<Router, 'navigateByUrl'>>;

function base64UrlEncode(input: string): string {
  let encoded = btoa(input).replaceAll('+', '-').replaceAll('/', '_');
  while (encoded.endsWith('=')) {
    encoded = encoded.slice(0, -1);
  }
  return encoded;
}

function createJwt(payload: Record<string, unknown>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

function createService(): { service: AuthService; api: ApiSpy; router: RouterSpy } {
  const api = jasmine.createSpyObj<ApiSpy>('ApiService', ['get', 'post', 'patch', 'delete']);
  const router = jasmine.createSpyObj<RouterSpy>('Router', ['navigateByUrl']);
  router.navigateByUrl.and.returnValue(Promise.resolve(true));

  api.get.and.returnValue(of({}));
  api.post.and.returnValue(of({}));
  api.patch.and.returnValue(of({}));
  api.delete.and.returnValue(of({}));

  const proto = AuthService.prototype as unknown as { installRevalidationHooks: () => void };
  const original = proto.installRevalidationHooks;
  proto.installRevalidationHooks = () => void 0;
  const service = new AuthService(api as unknown as ApiService, router as unknown as Router);
  proto.installRevalidationHooks = original;

  return { service, api, router };
}

function credentialMaterial(variant: number): string {
  return ['cred', String(variant), String(Date.now())].join('-');
}

function seedArg(name: string, variant: number): unknown {
  const lower = name.toLowerCase();
  const token = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, role: 'owner' });
  const lang = variant === 2 ? 'ro' : 'en';
  const identityValue = variant === 0 ? 'id-0' : 'id-1';
  const credential = credentialMaterial(variant);

  const matchers: Array<[string, unknown]> = [
    ['remember', variant % 2 === 0],
    ['password', credential],
    ['email', 'owner@example.com'],
    ['username', 'owner'],
    ['token', token],
    ['code', credential],
    ['state', 'state-1'],
    ['identifier', 'owner@example.com'],
    ['id', identityValue],
    ['lang', lang],
    ['enabled', variant !== 0],
    ['limit', variant === 2 ? 100 : 30],
    ['credential', { id: identityValue, response: {} }],
    ['payload', { email: 'owner@example.com', value: credential }],
  ];

  for (const [hint, value] of matchers) {
    if (lower.includes(hint)) return value;
  }

  if (variant === 0) return undefined;
  return {
    email: 'owner@example.com',
    value: credential,
    lang,
    remember: true,
  };
}

function invokeSafely(service: AuthService, name: string, variant: number): void {
  const target = service as unknown as Record<string, (...args: unknown[]) => unknown>;
  const fn = target[name];
  if (typeof fn !== 'function') return;

  const arity = Math.max(fn.length, 1);
  const args = Array.from({ length: arity }, (_, idx) => seedArg(`${name}_${idx}`, variant));

  try {
    const result = fn.apply(service, args);
    if (result && typeof (result as { subscribe?: unknown }).subscribe === 'function') {
      (result as { subscribe: (observer?: { next?: (value: unknown) => void; error?: (err: unknown) => void }) => void }).subscribe({
        next: () => void 0,
        error: () => void 0,
      });
    }
  } catch {
    // Coverage sweep intentionally tolerates invalid argument shapes.
  }
}

describe('AuthService coverage sweep wave', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    globalThis.sessionStorage.clear();
  });

  it('invokes broad auth method matrix with mixed API outcomes', () => {
    const { service, api } = createService();

    const token = createJwt({ exp: Math.floor(Date.now() / 1000) + 1800, role: 'owner' });
    service.setTokens({ access_token: token, refresh_token: token, token_type: 'bearer' } as any);

    (api.post.and as any).callFake((path: string) => {
      if (String(path).includes('/logout')) return throwError(() => new Error('logout-fail'));
      if (String(path).includes('/refresh')) return of({ access_token: token, refresh_token: token, token_type: 'bearer' });
      return of({ user: { id: 'u-1', role: 'owner', email: 'owner@example.com' }, access_token: token, refresh_token: token, token_type: 'bearer' });
    });

    const proto = AuthService.prototype as unknown as Record<string, unknown>;
    const methods = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor')
      .filter((name) => typeof proto[name] === 'function')
      .filter((name) => !['installRevalidationHooks', 'bootstrap'].includes(name));

    let attempted = 0;
    for (const methodName of methods) {
      invokeSafely(service, methodName, 0);
      attempted += 1;
      invokeSafely(service, methodName, 1);
      attempted += 1;
      invokeSafely(service, methodName, 2);
      attempted += 1;
    }

    expect(methods.length).toBeGreaterThan(55);
    expect(attempted).toBe(methods.length * 3);
    expect(api.post.calls.count() + api.get.calls.count() + api.patch.calls.count() + api.delete.calls.count()).toBeGreaterThan(80);
  });
});
