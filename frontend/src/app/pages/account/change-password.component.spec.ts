import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { ChangePasswordComponent } from './change-password.component';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';

function expectPasswordMismatchValidation(
  auth: jasmine.SpyObj<AuthService>,
  fixture = TestBed.createComponent(ChangePasswordComponent)
): void {
  const cmp = fixture.componentInstance;
  cmp.current = 'old';
  cmp.password = 'new1';
  cmp.confirm = 'new2';

  cmp.onSubmit({ valid: true } as any);

  expect(cmp.error).toContain('account.passwordChange.errors.mismatch');
  expect(auth.changePassword).not.toHaveBeenCalled();
}

function expectSubmitChangePasswordSuccess(
  toast: jasmine.SpyObj<ToastService>,
  auth: jasmine.SpyObj<AuthService>,
  fixture = TestBed.createComponent(ChangePasswordComponent)
): void {
  const cmp = fixture.componentInstance;
  cmp.current = 'old';
  cmp.password = 'new';
  cmp.confirm = 'new';

  cmp.onSubmit({ valid: true } as any);

  expect(auth.changePassword).toHaveBeenCalledWith('old', 'new');
  expect(toast.success).toHaveBeenCalled();
  expect(cmp.current).toBe('');
  expect(cmp.password).toBe('');
  expect(cmp.confirm).toBe('');
}

function expectBackendErrorDetailOnFailure(
  toast: jasmine.SpyObj<ToastService>,
  auth: jasmine.SpyObj<AuthService>,
  fixture = TestBed.createComponent(ChangePasswordComponent)
): void {
  auth.changePassword.and.returnValue(throwError(() => ({ error: { detail: 'Nope' } })));
  const cmp = fixture.componentInstance;
  cmp.current = 'old';
  cmp.password = 'new';
  cmp.confirm = 'new';

  cmp.onSubmit({ valid: true } as any);

  expect(cmp.error).toBe('Nope');
  expect(toast.error).toHaveBeenCalledWith('Nope');
}

describe('ChangePasswordComponent', () => {
  let toast: jasmine.SpyObj<ToastService>;
  let auth: jasmine.SpyObj<AuthService>;

  beforeEach(() => {
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['changePassword']);
    auth.changePassword.and.returnValue(of({ detail: 'Password updated' }));

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), ChangePasswordComponent],
      providers: [
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: auth }
      ]
    });
  });

  it('shows error when passwords do not match', () => {
    expectPasswordMismatchValidation(auth);
  });

  it('submits change password and clears fields', () => {
    expectSubmitChangePasswordSuccess(toast, auth);
  });

  it('shows backend error detail when change fails', () => {
    expectBackendErrorDetailOnFailure(toast, auth);
  });
});
