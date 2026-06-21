import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { ChangePasswordComponent } from './change-password.component';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';

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
        { provide: AuthService, useValue: auth },
      ],
    });
  });

  it('shows error when passwords do not match', () => {
    const fixture = TestBed.createComponent(ChangePasswordComponent);
    const cmp = fixture.componentInstance;
    cmp.current = 'old';
    cmp.password = 'new1';
    cmp.confirm = 'new2';

    cmp.onSubmit({ valid: true } as any);

    expect(cmp.error).toContain('account.passwordChange.errors.mismatch');
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it('submits change password and clears fields', () => {
    const fixture = TestBed.createComponent(ChangePasswordComponent);
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
  });

  it('shows backend error detail when change fails', () => {
    auth.changePassword.and.returnValue(throwError(() => ({ error: { detail: 'Nope' } })));
    const fixture = TestBed.createComponent(ChangePasswordComponent);
    const cmp = fixture.componentInstance;
    cmp.current = 'old';
    cmp.password = 'new';
    cmp.confirm = 'new';

    cmp.onSubmit({ valid: true } as any);

    expect(cmp.error).toBe('Nope');
    expect(toast.error).toHaveBeenCalledWith('Nope');
  });

  it('shows an invalid-form error and does not call the API', () => {
    const fixture = TestBed.createComponent(ChangePasswordComponent);
    const cmp = fixture.componentInstance;
    cmp.onSubmit({ valid: false } as never);
    expect(cmp.error).toBe('account.passwordChange.errors.invalidForm');
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it('falls back to a generic error when the failure has no detail', () => {
    auth.changePassword.and.returnValue(throwError(() => ({ error: {} })));
    const fixture = TestBed.createComponent(ChangePasswordComponent);
    const cmp = fixture.componentInstance;
    cmp.current = 'old';
    cmp.password = 'new';
    cmp.confirm = 'new';
    cmp.onSubmit({ valid: true } as never);
    expect(cmp.error).toBe('account.passwordChange.errors.updateFailed');
    expect(toast.error).toHaveBeenCalledWith('account.passwordChange.errors.updateFailed');
  });

  it('ignores a whitespace-only error detail and uses the generic message', () => {
    auth.changePassword.and.returnValue(throwError(() => ({ error: { detail: '   ' } })));
    const fixture = TestBed.createComponent(ChangePasswordComponent);
    const cmp = fixture.componentInstance;
    cmp.current = 'old';
    cmp.password = 'new';
    cmp.confirm = 'new';
    cmp.onSubmit({ valid: true } as never);
    expect(cmp.error).toBe('account.passwordChange.errors.updateFailed');
  });

  it('renders the form and toggles password visibility flags via the template', () => {
    const fixture = TestBed.createComponent(ChangePasswordComponent);
    const cmp = fixture.componentInstance;
    cmp.error = 'account.passwordChange.errors.mismatch';
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll(
      'button[type="button"]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(buttons.length).toBe(3);
    buttons[0].click();
    buttons[1].click();
    buttons[2].click();
    expect(cmp.showCurrent).toBeTrue();
    expect(cmp.showNew).toBeTrue();
    expect(cmp.showConfirm).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('account.passwordChange.errors.mismatch');
  });
});
