import { TestBed } from '@angular/core/testing';
import { NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';
import { AuthResponse, AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { RegisterComponent } from './register.component';

describe('RegisterComponent', () => {
  it('submits registration payload with derived E.164 phone', () => {
    const auth = jasmine.createSpyObj<AuthService>('AuthService', ['register', 'startGoogleLogin']);
    const toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    const router = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);
    router.navigateByUrl.and.returnValue(Promise.resolve(true));

    auth.register.and.returnValue(
      of({
        user: { email: 'ana@example.com', username: 'ana2005l', id: 'u1', role: 'user' },
        tokens: { access_token: 'a', refresh_token: 'r', token_type: 'bearer' },
      } as AuthResponse),
    );

    TestBed.configureTestingModule({
      imports: [RegisterComponent, RouterTestingModule, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: Router, useValue: router },
      ],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { auth: { successRegister: 'Account created' } }, true);
    translate.use('en');

    const fixture = TestBed.createComponent(RegisterComponent);
    const cmp = fixture.componentInstance;
    cmp.step = 2;
    cmp.displayName = 'Ana';
    cmp.username = 'ana2005l';
    cmp.email = 'ana@example.com';
    cmp.password = 'supersecret';
    cmp.confirmPassword = 'supersecret';
    cmp.firstName = 'Ana';
    cmp.middleName = '';
    cmp.lastName = 'Test';
    cmp.dateOfBirth = '2000-01-01';
    cmp.phoneCountry = 'RO';
    cmp.phoneNational = '723204204';
    cmp.acceptTerms = true;
    cmp.acceptPrivacy = true;

    cmp.onSubmit({ valid: true, form: { markAllAsTouched: () => {} } } as any);

    expect(auth.register).toHaveBeenCalledWith({
      name: 'Ana',
      username: 'ana2005l',
      email: 'ana@example.com',
      password: 'supersecret',
      first_name: 'Ana',
      middle_name: null,
      last_name: 'Test',
      date_of_birth: '2000-01-01',
      phone: '+40723204204',
      preferred_language: 'en',
      accept_terms: true,
      accept_privacy: true,
    });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/account');
    expect(toast.success).toHaveBeenCalled();
  });
});

describe('RegisterComponent (behaviour)', () => {
  let auth: jasmine.SpyObj<AuthService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: jasmine.SpyObj<Router>;
  let queryParam: string | null;
  let translateSvc: TranslateService;

  function setup(): RegisterComponent {
    auth = jasmine.createSpyObj<AuthService>('AuthService', [
      'register',
      'startGoogleLogin',
      'completeGoogleRegistration',
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    router = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);
    router.navigateByUrl.and.returnValue(Promise.resolve(true));
    auth.register.and.returnValue(
      of({
        user: { email: 'a@b.c', username: 'ana', id: 'u1', role: 'user' },
        tokens: { access_token: 'a', refresh_token: 'r', token_type: 'bearer' },
      } as AuthResponse),
    );
    auth.startGoogleLogin.and.returnValue(of('https://google/oauth'));
    auth.completeGoogleRegistration.and.returnValue(
      of({
        user: { email: 'a@b.c', username: 'ana', id: 'u1', role: 'user' },
        tokens: { access_token: 'a', refresh_token: 'r', token_type: 'bearer' },
      } as AuthResponse),
    );

    TestBed.configureTestingModule({
      imports: [RegisterComponent, RouterTestingModule, TranslateModule.forRoot()],
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

    translateSvc = TestBed.inject(TranslateService);
    translateSvc.use('en');
    return TestBed.createComponent(RegisterComponent).componentInstance;
  }

  function validForm(): NgForm {
    return { valid: true, form: { markAllAsTouched: () => undefined } } as unknown as NgForm;
  }

  beforeEach(() => {
    queryParam = null;
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('refreshes the country list on language change', () => {
    const cmp = setup();
    translateSvc.use('ro');
    expect(cmp.countries.length).toBeGreaterThan(0);
  });

  it('skips completion mode without the complete query param', () => {
    queryParam = null;
    const cmp = setup();
    cmp.ngOnInit();
    expect(cmp.completionMode).toBeFalse();
  });

  it('skips completion mode when storage data is missing', () => {
    queryParam = '1';
    const cmp = setup();
    cmp.ngOnInit();
    expect(cmp.completionMode).toBeFalse();
  });

  it('skips completion mode when the stored user is malformed', () => {
    queryParam = '1';
    sessionStorage.setItem('google_completion_token', 'tok');
    sessionStorage.setItem('google_completion_user', '{bad json');
    const cmp = setup();
    cmp.ngOnInit();
    expect(cmp.completionMode).toBeFalse();
  });

  it('skips completion mode when no profile fields are missing', () => {
    queryParam = '1';
    sessionStorage.setItem('google_completion_token', 'tok');
    sessionStorage.setItem(
      'google_completion_user',
      JSON.stringify({
        google_sub: 'g1',
        name: 'A',
        username: 'a',
        email: 'a@b.c',
        first_name: 'A',
        last_name: 'B',
        date_of_birth: '2000-01-01',
        phone: '+40723204204',
      }),
    );
    const cmp = setup();
    cmp.ngOnInit();
    expect(cmp.completionMode).toBeFalse();
  });

  it('enters completion mode and prefills from the stored google user', () => {
    queryParam = '1';
    sessionStorage.setItem('google_completion_token', 'tok');
    sessionStorage.setItem(
      'google_completion_user',
      JSON.stringify({ google_sub: 'g1', name: 'Ana', email: 'a@b.c', phone: '+40723204204' }),
    );
    const cmp = setup();
    cmp.ngOnInit();
    expect(cmp.completionMode).toBeTrue();
    expect(cmp.displayName).toBe('Ana');
    expect(cmp.phoneCountry).toBe('RO');
    expect(cmp.phoneNational).toBe('723204204');
  });

  it('opens and confirms the consent modal for terms and privacy', () => {
    const cmp = setup();
    const event = { preventDefault: () => undefined, stopPropagation: () => undefined } as Event;
    cmp.onConsentAttempt(event, 'terms');
    expect(cmp.consentModalOpen).toBeTrue();
    cmp.confirmConsentModal();
    expect(cmp.acceptTerms).toBeTrue();
    expect(cmp.consentModalOpen).toBeFalse();

    cmp.onConsentAttempt(event, 'privacy');
    cmp.confirmConsentModal();
    expect(cmp.acceptPrivacy).toBeTrue();
  });

  it('does not open the consent modal when already accepted or loading', () => {
    const cmp = setup();
    const event = { preventDefault: () => undefined, stopPropagation: () => undefined } as Event;
    cmp.acceptTerms = true;
    cmp.onConsentAttempt(event, 'terms');
    expect(cmp.consentModalOpen).toBeFalse();
    cmp.acceptTerms = false;
    cmp.loading = true;
    cmp.onConsentAttempt(event, 'terms');
    expect(cmp.consentModalOpen).toBeFalse();
  });

  it('previews the display name in its three states', () => {
    const cmp = setup();
    expect(cmp.displayNamePreview()).toContain('auth.displayNameHintEmpty');
    cmp.displayName = 'Ana';
    cmp.username = 'ana';
    expect(cmp.displayNamePreview()).toContain('auth.displayNameHint');
    cmp.username = '';
    expect(cmp.displayNamePreview()).toContain('auth.displayNameHintPartial');
  });

  it('starts the google login flow and persists the flow marker', () => {
    const cmp = setup();
    // Pending observable: covers the subscribe + localStorage write without assigning
    // window.location.href (which would navigate and disconnect the Karma runner).
    auth.startGoogleLogin.and.returnValue(new Subject<string>().asObservable());
    cmp.startGoogle();
    expect(localStorage.getItem('google_flow')).toBe('login');
    expect(auth.startGoogleLogin).toHaveBeenCalled();
  });

  it('toasts when google login fails', () => {
    const cmp = setup();
    auth.startGoogleLogin.and.returnValue(throwError(() => ({ error: { detail: 'no google' } })));
    cmp.startGoogle();
    expect(toast.error).toHaveBeenCalledWith('no google');
  });

  it('goNext validates required fields and password match', () => {
    const cmp = setup();
    cmp.goNext({ valid: false, form: { markAllAsTouched: () => undefined } } as unknown as NgForm);
    expect(cmp.error).toContain('required');

    cmp.password = 'a';
    cmp.confirmPassword = 'b';
    cmp.goNext(validForm());
    expect(cmp.error).toContain('passwordMismatch');

    cmp.confirmPassword = 'a';
    cmp.goNext(validForm());
    expect(cmp.step as number).toBe(2);
  });

  it('onSubmit on step 1 advances to step 2', () => {
    const cmp = setup();
    cmp.step = 1;
    cmp.password = 'a';
    cmp.confirmPassword = 'a';
    cmp.onSubmit(validForm());
    expect(cmp.step as number).toBe(2);
  });

  function fillStep2(cmp: RegisterComponent): void {
    cmp.step = 2;
    cmp.displayName = 'Ana';
    cmp.username = 'ana';
    cmp.email = 'a@b.c';
    cmp.password = 'supersecret';
    cmp.confirmPassword = 'supersecret';
    cmp.firstName = 'Ana';
    cmp.lastName = 'Test';
    cmp.dateOfBirth = '2000-01-01';
    cmp.phoneCountry = 'RO';
    cmp.phoneNational = '723204204';
    cmp.acceptTerms = true;
    cmp.acceptPrivacy = true;
  }

  it('onSubmit rejects an invalid form', () => {
    const cmp = setup();
    cmp.step = 2;
    cmp.onSubmit({
      valid: false,
      form: { markAllAsTouched: () => undefined },
    } as unknown as NgForm);
    expect(cmp.error).toContain('required');
  });

  it('onSubmit requires a date of birth', () => {
    const cmp = setup();
    fillStep2(cmp);
    cmp.dateOfBirth = '';
    cmp.onSubmit(validForm());
    expect(cmp.error).toContain('required');
  });

  it('onSubmit requires a valid phone number', () => {
    const cmp = setup();
    fillStep2(cmp);
    cmp.phoneNational = '';
    cmp.onSubmit(validForm());
    expect(cmp.error).toContain('phoneInvalid');
  });

  it('onSubmit requires a captcha token when captcha is enabled', () => {
    const cmp = setup();
    fillStep2(cmp);
    cmp.captchaEnabled = true;
    cmp.captchaToken = null;
    cmp.onSubmit(validForm());
    expect(cmp.error).toContain('captchaRequired');
  });

  it('onSubmit includes a captcha token when present', () => {
    const cmp = setup();
    fillStep2(cmp);
    cmp.captchaEnabled = true;
    cmp.captchaToken = 'cap-1';
    cmp.onSubmit(validForm());
    expect(auth.register).toHaveBeenCalledWith(
      jasmine.objectContaining({ captcha_token: 'cap-1' }),
    );
  });

  it('onSubmit shows the backend error detail and resets the captcha', () => {
    const cmp = setup();
    fillStep2(cmp);
    const resetSpy = jasmine.createSpy('reset');
    cmp.captcha = { reset: resetSpy } as unknown as RegisterComponent['captcha'];
    auth.register.and.returnValue(throwError(() => ({ error: { detail: 'taken' } })));
    cmp.onSubmit(validForm());
    expect(cmp.error).toBe('taken');
    expect(resetSpy).toHaveBeenCalled();
  });

  it('onSubmit falls back to a generic error when no detail is given', () => {
    const cmp = setup();
    fillStep2(cmp);
    auth.register.and.returnValue(throwError(() => ({})));
    cmp.onSubmit(validForm());
    expect(cmp.error).toContain('errorRegister');
  });

  it('completes a google registration', () => {
    queryParam = '1';
    sessionStorage.setItem('google_completion_token', 'tok');
    sessionStorage.setItem(
      'google_completion_user',
      JSON.stringify({ google_sub: 'g1', name: 'Ana' }),
    );
    const cmp = setup();
    cmp.ngOnInit();
    fillStep2(cmp);
    cmp.middleName = 'Mid';
    cmp.onSubmit(validForm());
    expect(auth.completeGoogleRegistration).toHaveBeenCalledWith(
      'tok',
      jasmine.objectContaining({ middle_name: 'Mid', date_of_birth: '2000-01-01' }),
    );
    expect(toast.success).toHaveBeenCalled();
    expect(sessionStorage.getItem('google_completion_token')).toBeNull();
  });

  it('aborts google completion when the token is missing', () => {
    queryParam = '1';
    sessionStorage.setItem('google_completion_token', 'tok');
    sessionStorage.setItem(
      'google_completion_user',
      JSON.stringify({ google_sub: 'g1', name: 'Ana' }),
    );
    const cmp = setup();
    cmp.ngOnInit();
    fillStep2(cmp);
    (cmp as unknown as { googleCompletionToken: string | null }).googleCompletionToken = null;
    cmp.onSubmit(validForm());
    expect(toast.error).toHaveBeenCalled();
    expect(auth.completeGoogleRegistration).not.toHaveBeenCalled();
  });

  it('shows the backend error when google completion fails', () => {
    queryParam = '1';
    sessionStorage.setItem('google_completion_token', 'tok');
    sessionStorage.setItem(
      'google_completion_user',
      JSON.stringify({ google_sub: 'g1', name: 'Ana' }),
    );
    const cmp = setup();
    cmp.ngOnInit();
    fillStep2(cmp);
    auth.completeGoogleRegistration.and.returnValue(
      throwError(() => ({ error: { detail: 'bad' } })),
    );
    cmp.onSubmit(validForm());
    expect(cmp.error).toBe('bad');
  });

  it('does not reopen the privacy consent modal when already accepted', () => {
    const cmp = setup();
    const event = { preventDefault: () => undefined, stopPropagation: () => undefined } as Event;
    cmp.acceptPrivacy = true;
    cmp.onConsentAttempt(event, 'privacy');
    expect(cmp.consentModalOpen).toBeFalse();
  });

  it('skips completion when the stored user has no google_sub', () => {
    queryParam = '1';
    sessionStorage.setItem('google_completion_token', 'tok');
    sessionStorage.setItem('google_completion_user', JSON.stringify({ name: 'Ana' }));
    const cmp = setup();
    cmp.ngOnInit();
    expect(cmp.completionMode).toBeFalse();
  });

  it('defaults missing google profile fields to empty strings', () => {
    queryParam = '1';
    sessionStorage.setItem('google_completion_token', 'tok');
    sessionStorage.setItem('google_completion_user', JSON.stringify({ google_sub: 'g1' }));
    const cmp = setup();
    cmp.ngOnInit();
    expect(cmp.completionMode).toBeTrue();
    expect(cmp.displayName).toBe('');
    expect(cmp.email).toBe('');
  });

  it('includes the trimmed middle name in the register payload', () => {
    const cmp = setup();
    fillStep2(cmp);
    cmp.middleName = '  Mid  ';
    cmp.onSubmit(validForm());
    expect(auth.register).toHaveBeenCalledWith(jasmine.objectContaining({ middle_name: 'Mid' }));
  });

  it('falls back to a generic google error when no detail is present', () => {
    const cmp = setup();
    auth.startGoogleLogin.and.returnValue(throwError(() => ({})));
    cmp.startGoogle();
    expect(toast.error).toHaveBeenCalledWith('auth.googleError');
  });

  it('falls back to a generic error when google completion detail is not a string', () => {
    queryParam = '1';
    sessionStorage.setItem('google_completion_token', 'tok');
    sessionStorage.setItem(
      'google_completion_user',
      JSON.stringify({ google_sub: 'g1', name: 'Ana' }),
    );
    const cmp = setup();
    cmp.ngOnInit();
    fillStep2(cmp);
    auth.completeGoogleRegistration.and.returnValue(throwError(() => ({ error: { detail: 42 } })));
    cmp.onSubmit(validForm());
    expect(cmp.error).toContain('errorRegister');
  });

  it('defaults the preferred language to en when currentLang is empty', () => {
    const cmp = setup();
    Object.defineProperty(translateSvc, 'currentLang', { value: '', configurable: true });
    fillStep2(cmp);
    cmp.onSubmit(validForm());
    expect(auth.register).toHaveBeenCalledWith(
      jasmine.objectContaining({ preferred_language: 'en' }),
    );
  });

  it('unsubscribes from language changes on destroy', () => {
    const cmp = setup();
    expect(() => cmp.ngOnDestroy()).not.toThrow();
  });
});
