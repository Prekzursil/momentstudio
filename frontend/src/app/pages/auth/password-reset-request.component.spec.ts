import { TestBed } from '@angular/core/testing';
import { NgForm } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { PasswordResetRequestComponent } from './password-reset-request.component';

describe('PasswordResetRequestComponent', () => {
  let auth: jasmine.SpyObj<AuthService>;
  let toast: jasmine.SpyObj<ToastService>;
  let translate: TranslateService;

  function setup(): PasswordResetRequestComponent {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['requestPasswordReset']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    auth.requestPasswordReset.and.returnValue(of(undefined));

    TestBed.configureTestingModule({
      imports: [PasswordResetRequestComponent, RouterTestingModule, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
      ],
    });

    translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        auth: {
          resetLinkSent: 'Sent',
          resetLinkSentBody: 'Sent to {{email}}',
          errorReset: 'Generic reset error',
        },
      },
      true,
    );
    translate.use('en');

    return TestBed.createComponent(PasswordResetRequestComponent).componentInstance;
  }

  function validForm(): NgForm {
    return { valid: true } as unknown as NgForm;
  }

  function invalidForm(): NgForm {
    return { valid: false } as unknown as NgForm;
  }

  it('initialises default state', () => {
    const cmp = setup();
    expect(cmp.email).toBe('');
    expect(cmp.loading).toBeFalse();
    expect(cmp.crumbs.length).toBe(2);
    expect(cmp.crumbs[1].label).toBe('auth.resetRequestTitle');
  });

  it('renders the title, copy and submit button', () => {
    setup();
    const fixture = TestBed.createComponent(PasswordResetRequestComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('h1')).not.toBeNull();
    expect(host.querySelector('input[name="email"]')).not.toBeNull();
    expect(host.querySelector('app-button')).not.toBeNull();
  });

  it('ignores submission when the form is invalid', () => {
    const cmp = setup();
    cmp.email = 'user@example.com';
    cmp.onSubmit(invalidForm());
    expect(auth.requestPasswordReset).not.toHaveBeenCalled();
    expect(cmp.loading).toBeFalse();
  });

  it('keeps loading true while the request is pending', () => {
    const cmp = setup();
    auth.requestPasswordReset.and.returnValue(new Subject<void>().asObservable());
    cmp.email = 'user@example.com';
    cmp.onSubmit(validForm());
    expect(cmp.loading).toBeTrue();
    expect(auth.requestPasswordReset).toHaveBeenCalledWith('user@example.com');
  });

  it('toasts success and clears loading when the request resolves', () => {
    const cmp = setup();
    cmp.email = 'user@example.com';
    cmp.onSubmit(validForm());
    expect(toast.success).toHaveBeenCalledWith('Sent', 'Sent to user@example.com');
    expect(cmp.loading).toBeFalse();
  });

  it('shows the backend error detail on failure', () => {
    const cmp = setup();
    auth.requestPasswordReset.and.returnValue(
      throwError(() => ({ error: { detail: 'Email not found' } })),
    );
    cmp.email = 'user@example.com';
    cmp.onSubmit(validForm());
    expect(toast.error).toHaveBeenCalledWith('Email not found');
    expect(cmp.loading).toBeFalse();
  });

  it('falls back to a generic error when no detail is provided', () => {
    const cmp = setup();
    auth.requestPasswordReset.and.returnValue(throwError(() => ({})));
    cmp.email = 'user@example.com';
    cmp.onSubmit(validForm());
    expect(toast.error).toHaveBeenCalledWith('Generic reset error');
    expect(cmp.loading).toBeFalse();
  });
});
