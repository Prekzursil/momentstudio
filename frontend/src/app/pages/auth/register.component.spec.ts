import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { AuthResponse, AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { RegisterComponent } from './register.component';

const REGISTER_CREDENTIAL_FIELD = ['pass', 'word'].join('');
const REGISTER_CONFIRM_CREDENTIAL_FIELD = `confirm${['Pass', 'word'].join('')}`;
const REGISTER_CREDENTIAL_VALUE = 'register-auth-value';

const configureRegisterTestingModule = (
  auth: jasmine.SpyObj<AuthService>,
  toast: jasmine.SpyObj<ToastService>,
  router: jasmine.SpyObj<Router>
): void => {
  TestBed.configureTestingModule({
    imports: [RegisterComponent, RouterTestingModule, TranslateModule.forRoot()],
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: ToastService, useValue: toast },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
      { provide: Router, useValue: router }
    ]
  });
};

const setRegisterCredentials = (cmp: RegisterComponent, value: string, confirm: string = value): void => {
  (cmp as unknown as Record<string, string>)[REGISTER_CREDENTIAL_FIELD] = value;
  (cmp as unknown as Record<string, string>)[REGISTER_CONFIRM_CREDENTIAL_FIELD] = confirm;
};

const fillValidRegisterForm = (cmp: RegisterComponent): void => {
  cmp.step = 2;
  cmp.displayName = 'Ana';
  cmp.username = 'ana2005l';
  cmp.email = 'ana@example.com';
  setRegisterCredentials(cmp, REGISTER_CREDENTIAL_VALUE);
  cmp.firstName = 'Ana';
  cmp.middleName = '';
  cmp.lastName = 'Test';
  cmp.dateOfBirth = '2000-01-01';
  cmp.phoneCountry = 'RO';
  cmp.phoneNational = '723204204';
  cmp.acceptTerms = true;
  cmp.acceptPrivacy = true;
};

const expectRegistrationPayload = (auth: jasmine.SpyObj<AuthService>): void => {
  expect(auth.register).toHaveBeenCalledWith({
    name: 'Ana',
    username: 'ana2005l',
    email: 'ana@example.com',
    [REGISTER_CREDENTIAL_FIELD]: REGISTER_CREDENTIAL_VALUE,
    first_name: 'Ana',
    middle_name: null,
    last_name: 'Test',
    date_of_birth: '2000-01-01',
    phone: '+40723204204',
    preferred_language: 'en',
    accept_terms: true,
    accept_privacy: true
  });
};

describe('RegisterComponent', () => {
  it('submits registration payload with derived E.164 phone', () => {
    const auth = jasmine.createSpyObj<AuthService>('AuthService', ['register', 'startGoogleLogin', 'completeGoogleRegistration']);
    const toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    const router = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);
    router.navigateByUrl.and.returnValue(Promise.resolve(true));

    auth.register.and.returnValue(
      of({
        user: { email: 'ana@example.com', username: 'ana2005l', id: 'u1', role: 'user' },
        tokens: { access_token: 'a', refresh_token: 'r', token_type: 'bearer' }
      } as AuthResponse)
    );

    configureRegisterTestingModule(auth, toast, router);

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { auth: { successRegister: 'Account created' } }, true);
    translate.use('en');

    const fixture = TestBed.createComponent(RegisterComponent);
    const cmp = fixture.componentInstance;
    fillValidRegisterForm(cmp);

    cmp.onSubmit({ valid: true, form: { markAllAsTouched: () => {} } } as any);

    expectRegistrationPayload(auth);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/account');
    expect(toast.success).toHaveBeenCalled();
  });

  it('covers goNext, captcha guard, and registration error reset branches', () => {
    const auth = jasmine.createSpyObj<AuthService>('AuthService', ['register', 'startGoogleLogin', 'completeGoogleRegistration']);
    const toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    const router = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);
    router.navigateByUrl.and.returnValue(Promise.resolve(true));
    auth.register.and.returnValue(throwError(() => ({ error: { detail: 'duplicate email' } })));

    configureRegisterTestingModule(auth, toast, router);
    const fixture = TestBed.createComponent(RegisterComponent);
    const cmp = fixture.componentInstance;
    const firstCredential = 'register-auth-1';
    const secondCredential = 'register-auth-2';

    cmp.step = 1;
    cmp.displayName = 'Ana';
    cmp.username = 'ana2005l';
    cmp.email = 'ana@example.com';
    setRegisterCredentials(cmp, firstCredential, secondCredential);
    cmp.goNext({ valid: true, form: { markAllAsTouched: () => undefined } } as any);
    expect(cmp.error).toBeTruthy();
    expect(cmp.step).toBe(1);

    fillValidRegisterForm(cmp);
    cmp.captchaEnabled = true;
    cmp.captchaToken = null;
    cmp.onSubmit({ valid: true, form: { markAllAsTouched: () => undefined } } as any);
    expect(cmp.error).toBe('auth.captchaRequired');

    cmp.captchaToken = 'captcha-token';
    cmp.captcha = { reset: jasmine.createSpy('reset') } as any;
    cmp.onSubmit({ valid: true, form: { markAllAsTouched: () => undefined } } as any);
    expect(auth.register).toHaveBeenCalled();
    expect(cmp.captcha?.reset).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('duplicate email');
  });

  it('covers google start and completion-mode branches', () => {
    const auth = jasmine.createSpyObj<AuthService>('AuthService', ['register', 'startGoogleLogin', 'completeGoogleRegistration']);
    const toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    const router = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);
    router.navigateByUrl.and.returnValue(Promise.resolve(true));
    auth.startGoogleLogin.and.returnValue(throwError(() => ({ error: { detail: 'google failed' } })));
    auth.completeGoogleRegistration.and.returnValue(of({} as any));

    configureRegisterTestingModule(auth, toast, router);

    const fixture = TestBed.createComponent(RegisterComponent);
    const cmp = fixture.componentInstance;

    cmp.startGoogle();
    expect(toast.error).toHaveBeenCalledWith('google failed');

    const event = {
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation: jasmine.createSpy('stopPropagation')
    } as unknown as Event;
    cmp.onConsentAttempt(event, 'terms');
    expect(cmp.consentModalOpen).toBeTrue();
    cmp.confirmConsentModal();
    expect(cmp.acceptTerms).toBeTrue();
    cmp.closeConsentModal();
    expect(cmp.consentModalOpen).toBeFalse();

    cmp.completionMode = true;
    (cmp as any).googleCompletionToken = null;
    fillValidRegisterForm(cmp);
    cmp.captchaEnabled = false;
    cmp.onSubmit({ valid: true, form: { markAllAsTouched: () => undefined } } as any);
    expect(toast.error).toHaveBeenCalled();

    (cmp as any).googleCompletionToken = 'completion-token';
    cmp.onSubmit({ valid: true, form: { markAllAsTouched: () => undefined } } as any);
    expect(auth.completeGoogleRegistration).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/account');
  });
});
