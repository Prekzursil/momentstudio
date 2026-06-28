import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CartApi } from '../../core/cart.api';
import { VerifyEmailComponent } from './verify-email.component';

type QueryParams = Record<string, string>;

interface Spies {
  api: jasmine.SpyObj<ApiService>;
  auth: jasmine.SpyObj<AuthService>;
  cartApi: jasmine.SpyObj<CartApi>;
  router: jasmine.SpyObj<Router>;
}

function setup(params: QueryParams): Spies {
  const api = jasmine.createSpyObj<ApiService>('ApiService', ['post']);
  const auth = jasmine.createSpyObj<AuthService>('AuthService', [
    'confirmEmailVerification',
    'confirmSecondaryEmailVerification',
    'loadCurrentUser',
    'isAuthenticated',
  ]);
  const cartApi = jasmine.createSpyObj<CartApi>('CartApi', ['headers']);
  const router = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);

  cartApi.headers.and.returnValue({ 'X-Cart': 'token' });
  router.navigateByUrl.and.returnValue(Promise.resolve(true));
  auth.isAuthenticated.and.returnValue(false);

  const queryParamMap = {
    get: (key: string): string | null => (key in params ? params[key] : null),
  };

  TestBed.configureTestingModule({
    imports: [VerifyEmailComponent, TranslateModule.forRoot()],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: AuthService, useValue: auth },
      { provide: CartApi, useValue: cartApi },
      { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap } } },
    ],
  });

  return { api, auth, cartApi, router };
}

function create(): VerifyEmailComponent {
  const fixture = TestBed.createComponent(VerifyEmailComponent);
  fixture.detectChanges();
  return fixture.componentInstance;
}

describe('VerifyEmailComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('token validation', () => {
    it('fails when the token query param is missing', () => {
      setup({});
      const cmp = create();

      expect(cmp.status).toBe('error');
      expect(cmp.errorMessage).toBe('auth.verifyEmail.missingToken');
      expect(cmp.subtitle).toBe('auth.verifyEmail.error');
    });

    it('renders the error banner in the DOM when verification fails', () => {
      setup({});
      const fixture = TestBed.createComponent(VerifyEmailComponent);
      fixture.detectChanges();

      const banner: HTMLElement = fixture.nativeElement.querySelector('.bg-rose-50');
      expect(banner).toBeTruthy();
      expect(banner.textContent?.trim()).toBe('auth.verifyEmail.missingToken');
    });

    it('treats a whitespace-only token as missing', () => {
      setup({ token: '   ' });
      const cmp = create();

      expect(cmp.status).toBe('error');
      expect(cmp.errorMessage).toBe('auth.verifyEmail.missingToken');
    });
  });

  describe('guest verification', () => {
    it('fails when the guest email is missing', () => {
      const { api } = setup({ token: 'tok', kind: 'guest' });
      const cmp = create();

      expect(api.post).not.toHaveBeenCalled();
      expect(cmp.kind).toBe('guest');
      expect(cmp.status).toBe('error');
      expect(cmp.errorMessage).toBe('auth.verifyEmail.missingEmail');
    });

    it('succeeds and navigates to the fallback when verified (uppercase kind normalized)', () => {
      const { api, cartApi, router } = setup({
        token: 'tok',
        kind: 'GUEST',
        email: 'guest@example.com',
      });
      api.post.and.returnValue(of({ email: 'guest@example.com', verified: true }));

      const cmp = create();

      expect(cmp.kind).toBe('guest');
      expect(api.post).toHaveBeenCalledWith(
        '/orders/guest-checkout/email/confirm',
        { email: 'guest@example.com', token: 'tok' },
        { 'X-Cart': 'token' },
      );
      expect(cartApi.headers).toHaveBeenCalled();
      expect(cmp.status).toBe('success');
      expect(cmp.subtitle).toBe('auth.verifyEmail.guestSuccess');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/checkout');
    });

    it('navigates to an allowed next target when verified', () => {
      const { api, router } = setup({
        token: 'tok',
        kind: 'guest',
        email: 'guest@example.com',
        next: '/checkout?step=2',
      });
      api.post.and.returnValue(of({ email: 'guest@example.com', verified: true }));

      create();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/checkout?step=2');
    });

    it('fails when the response reports not verified', () => {
      const { api, router } = setup({
        token: 'tok',
        kind: 'guest',
        email: 'guest@example.com',
      });
      api.post.and.returnValue(of({ email: 'guest@example.com', verified: false }));

      const cmp = create();

      expect(cmp.status).toBe('error');
      expect(cmp.errorMessage).toBe('auth.verifyEmail.invalidOrExpired');
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('fails when the response body is null', () => {
      const { api } = setup({
        token: 'tok',
        kind: 'guest',
        email: 'guest@example.com',
      });
      api.post.and.returnValue(of(null as unknown as { email: string | null; verified: boolean }));

      const cmp = create();

      expect(cmp.status).toBe('error');
      expect(cmp.errorMessage).toBe('auth.verifyEmail.invalidOrExpired');
    });

    it('fails with the device hint when the request errors', () => {
      const { api } = setup({
        token: 'tok',
        kind: 'guest',
        email: 'guest@example.com',
      });
      api.post.and.returnValue(throwError(() => new Error('network')));

      const cmp = create();

      expect(cmp.status).toBe('error');
      expect(cmp.errorMessage).toBe('auth.verifyEmail.guestDeviceHint');
    });
  });

  describe('secondary verification', () => {
    it('succeeds, refreshes the user, and navigates to the next target when authenticated', () => {
      const { auth, router } = setup({
        token: 'tok',
        kind: 'secondary',
        next: '/account/emails',
      });
      auth.isAuthenticated.and.returnValue(true);
      auth.confirmSecondaryEmailVerification.and.returnValue(of({ id: 's1' }) as never);
      auth.loadCurrentUser.and.returnValue(of({ id: 'u1' }) as never);

      const cmp = create();

      expect(auth.confirmSecondaryEmailVerification).toHaveBeenCalledWith('tok');
      expect(cmp.status).toBe('success');
      expect(cmp.subtitle).toBe('auth.verifyEmail.secondarySuccess');
      expect(auth.loadCurrentUser).toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/account/emails');
    });

    it('succeeds without navigating when no next target and not authenticated', () => {
      const { auth, router } = setup({ token: 'tok', kind: 'secondary' });
      auth.confirmSecondaryEmailVerification.and.returnValue(of({ id: 's1' }) as never);

      const cmp = create();

      expect(cmp.status).toBe('success');
      expect(auth.loadCurrentUser).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('fails when secondary confirmation errors', () => {
      const { auth } = setup({ token: 'tok', kind: 'secondary' });
      auth.confirmSecondaryEmailVerification.and.returnValue(throwError(() => new Error('bad')));

      const cmp = create();

      expect(cmp.status).toBe('error');
      expect(cmp.errorMessage).toBe('auth.verifyEmail.invalidOrExpired');
    });
  });

  describe('primary verification', () => {
    it('succeeds without refreshing the user when unauthenticated and no next', () => {
      const { auth, router } = setup({ token: 'tok' });
      auth.confirmEmailVerification.and.returnValue(of({ detail: 'ok', email_verified: true }));

      const cmp = create();

      expect(cmp.kind).toBe('primary');
      expect(auth.confirmEmailVerification).toHaveBeenCalledWith('tok');
      expect(cmp.status).toBe('success');
      expect(cmp.subtitle).toBe('auth.verifyEmail.success');
      expect(auth.loadCurrentUser).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('succeeds, tolerates a loadCurrentUser error, and navigates when authenticated', () => {
      const { auth, router } = setup({
        token: 'tok',
        kind: 'unknown-kind',
        next: '/account',
      });
      auth.isAuthenticated.and.returnValue(true);
      auth.confirmEmailVerification.and.returnValue(of({ detail: 'ok', email_verified: true }));
      auth.loadCurrentUser.and.returnValue(throwError(() => new Error('expired')));

      const cmp = create();

      expect(cmp.kind).toBe('primary');
      expect(cmp.status).toBe('success');
      expect(auth.loadCurrentUser).toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/account');
    });

    it('fails when primary confirmation errors', () => {
      const { auth } = setup({ token: 'tok' });
      auth.confirmEmailVerification.and.returnValue(throwError(() => new Error('bad')));

      const cmp = create();

      expect(cmp.status).toBe('error');
      expect(cmp.errorMessage).toBe('auth.verifyEmail.invalidOrExpired');
    });

    it('renders only the login CTA in the DOM when verification succeeds and the user is not authenticated', () => {
      // RouterTestingModule supplies a real Router so the success-state app-button
      // RouterLink children actually render (a Router spy cannot drive RouterLink).
      const auth = jasmine.createSpyObj<AuthService>('AuthService', [
        'confirmEmailVerification',
        'loadCurrentUser',
        'isAuthenticated',
      ]);
      auth.isAuthenticated.and.returnValue(false);
      auth.confirmEmailVerification.and.returnValue(of({ detail: 'ok', email_verified: true }));
      const api = jasmine.createSpyObj<ApiService>('ApiService', ['post']);
      const cartApi = jasmine.createSpyObj<CartApi>('CartApi', ['headers']);

      TestBed.configureTestingModule({
        imports: [VerifyEmailComponent, TranslateModule.forRoot(), RouterTestingModule],
        providers: [
          { provide: ApiService, useValue: api },
          { provide: AuthService, useValue: auth },
          { provide: CartApi, useValue: cartApi },
          {
            provide: ActivatedRoute,
            useValue: { snapshot: { queryParamMap: { get: () => 'tok' } } },
          },
        ],
      });

      const fixture = TestBed.createComponent(VerifyEmailComponent);
      fixture.detectChanges();

      const ctaTexts = Array.from(
        fixture.nativeElement.querySelectorAll('app-button span'),
      ).map((el) => (el as HTMLElement).textContent?.trim());
      expect(ctaTexts).toContain('auth.verifyEmail.ctaLogin');
      expect(ctaTexts).not.toContain('auth.verifyEmail.ctaAccount');
      expect(ctaTexts).not.toContain('auth.verifyEmail.ctaCheckout');
    });
  });

  describe('safeNavigateNext guardrails', () => {
    function navigate(target: string): jasmine.SpyObj<Router> {
      const { auth, router } = setup({ token: 'tok' });
      auth.confirmEmailVerification.and.returnValue(of({ detail: 'ok', email_verified: true }));
      const cmp = create();
      router.navigateByUrl.calls.reset();
      (cmp as unknown as { safeNavigateNext(next: string, fallback: string): void }).safeNavigateNext(
        target,
        '/fallback',
      );
      return router;
    }

    it('uses the fallback when the next target is empty', () => {
      expect(navigate('   ').navigateByUrl).toHaveBeenCalledWith('/fallback');
    });

    it('uses the fallback for non-root-relative targets', () => {
      expect(navigate('https://evil.test').navigateByUrl).toHaveBeenCalledWith('/fallback');
    });

    it('uses the fallback for protocol-relative targets', () => {
      expect(navigate('//evil.test').navigateByUrl).toHaveBeenCalledWith('/fallback');
    });

    it('uses the fallback for targets containing backslashes', () => {
      expect(navigate('/account\\evil').navigateByUrl).toHaveBeenCalledWith('/fallback');
    });

    it('uses the fallback for targets outside the allow-list', () => {
      expect(navigate('/settings').navigateByUrl).toHaveBeenCalledWith('/fallback');
    });

    it('allows an exact allow-listed prefix', () => {
      expect(navigate('/checkout').navigateByUrl).toHaveBeenCalledWith('/checkout');
    });

    it('allows a nested path under an allow-listed prefix', () => {
      expect(navigate('/account/emails').navigateByUrl).toHaveBeenCalledWith('/account/emails');
    });

    it('allows a query string under an allow-listed prefix', () => {
      expect(navigate('/checkout?step=1').navigateByUrl).toHaveBeenCalledWith('/checkout?step=1');
    });
  });

  describe('navigateSilently error handling', () => {
    it('ignores navigation rejections', async () => {
      const { auth, router } = setup({ token: 'tok' });
      auth.confirmEmailVerification.and.returnValue(of({ detail: 'ok', email_verified: true }));
      router.navigateByUrl.and.returnValue(Promise.reject(new Error('cancelled')));
      const cmp = create();

      expect(() =>
        (
          cmp as unknown as { navigateSilently(url: string): void }
        ).navigateSilently('/checkout'),
      ).not.toThrow();

      await Promise.resolve();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/checkout');
    });
  });
});
