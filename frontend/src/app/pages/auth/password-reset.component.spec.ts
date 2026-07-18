import { TestBed } from '@angular/core/testing';
import { NgForm } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { PasswordResetComponent } from './password-reset.component';

describe('PasswordResetComponent', () => {
  let auth: jasmine.SpyObj<AuthService>;
  let toast: jasmine.SpyObj<ToastService>;
  let queryParam: string | null;
  let translate: TranslateService;

  function setup(): PasswordResetComponent {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['confirmPasswordReset']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    auth.confirmPasswordReset.and.returnValue(of(undefined));

    TestBed.configureTestingModule({
      imports: [PasswordResetComponent, RouterTestingModule, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => queryParam } } },
        },
      ],
    });

    translate = TestBed.inject(TranslateService);
    translate.use('en');
    return TestBed.createComponent(PasswordResetComponent).componentInstance;
  }

  function validForm(): NgForm {
    return { valid: true } as unknown as NgForm;
  }

  beforeEach(() => {
    queryParam = null;
  });

  it('seeds default state for the breadcrumb and form fields', () => {
    const cmp = setup();
    expect(cmp.crumbs.length).toBe(2);
    expect(cmp.token).toBe('');
    expect(cmp.password).toBe('');
    expect(cmp.confirmPassword).toBe('');
    expect(cmp.showPassword).toBeFalse();
    expect(cmp.showConfirmPassword).toBeFalse();
    expect(cmp.error).toBe('');
    expect(cmp.loading).toBeFalse();
  });

  it('prefills the token from the query param on init', () => {
    queryParam = 'reset-token-123';
    const cmp = setup();
    cmp.ngOnInit();
    expect(cmp.token).toBe('reset-token-123');
  });

  it('leaves the token empty when no query param is present', () => {
    queryParam = null;
    const cmp = setup();
    cmp.ngOnInit();
    expect(cmp.token).toBe('');
  });

  it('rejects an invalid form with a required-field error', () => {
    const cmp = setup();
    cmp.onSubmit({ valid: false } as unknown as NgForm);
    expect(cmp.error).toContain('required');
    expect(auth.confirmPasswordReset).not.toHaveBeenCalled();
    expect(cmp.loading).toBeFalse();
  });

  it('rejects mismatched passwords', () => {
    const cmp = setup();
    cmp.token = 'tok';
    cmp.password = 'secret1';
    cmp.confirmPassword = 'secret2';
    cmp.onSubmit(validForm());
    expect(cmp.error).toContain('passwordMismatch');
    expect(auth.confirmPasswordReset).not.toHaveBeenCalled();
  });

  it('confirms the reset and toasts success on a valid submission', () => {
    const cmp = setup();
    cmp.token = 'tok';
    cmp.password = 'secret1';
    cmp.confirmPassword = 'secret1';
    cmp.onSubmit(validForm());
    expect(cmp.error).toBe('');
    expect(auth.confirmPasswordReset).toHaveBeenCalledWith('tok', 'secret1');
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.loading).toBeFalse();
  });

  it('keeps loading true while the request is pending and resets it on completion', () => {
    const cmp = setup();
    const subject = new Subject<void>();
    auth.confirmPasswordReset.and.returnValue(subject.asObservable());
    cmp.token = 'tok';
    cmp.password = 'secret1';
    cmp.confirmPassword = 'secret1';
    cmp.onSubmit(validForm());
    expect(cmp.loading).toBeTrue();
    subject.next();
    subject.complete();
    expect(cmp.loading).toBeFalse();
    expect(toast.success).toHaveBeenCalled();
  });

  it('shows the backend error detail when the reset fails', () => {
    const cmp = setup();
    auth.confirmPasswordReset.and.returnValue(
      throwError(() => ({ error: { detail: 'token expired' } })),
    );
    cmp.token = 'tok';
    cmp.password = 'secret1';
    cmp.confirmPassword = 'secret1';
    cmp.onSubmit(validForm());
    expect(toast.error).toHaveBeenCalledWith('token expired');
    expect(cmp.loading).toBeFalse();
  });

  it('falls back to a generic error when the backend gives no detail', () => {
    const cmp = setup();
    auth.confirmPasswordReset.and.returnValue(throwError(() => ({})));
    cmp.token = 'tok';
    cmp.password = 'secret1';
    cmp.confirmPassword = 'secret1';
    cmp.onSubmit(validForm());
    expect(toast.error).toHaveBeenCalledWith('auth.errorReset');
    expect(cmp.loading).toBeFalse();
  });
});
