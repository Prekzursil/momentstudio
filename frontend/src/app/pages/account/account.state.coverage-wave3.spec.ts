import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { AccountState } from './account.state';

type SignalLike<T> = (() => T) & { set: (next: T) => void };

function makeSignal<T>(initial: T): SignalLike<T> {
  let value = initial;
  const fn = (() => value) as SignalLike<T>;
  fn.set = (next: T) => {
    value = next;
  };
  return fn;
}

function createState(): any {
  const state: any = Object.create(AccountState.prototype);
  state.profile = makeSignal<any>(null);
  state.now = makeSignal(Date.parse('2026-03-03T00:00:00Z'));
  state.primaryVerificationResendUntil = makeSignal<number | null>(null);
  state.verificationStatus = null;
  state.toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
  state.auth = jasmine.createSpyObj('AuthService', ['requestEmailVerification']);
  state.auth.requestEmailVerification.and.returnValue(of({}));
  state.t = (key: string) => key;
  return state;
}

function createConstructedState(): AccountState {
  const toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
  const auth = jasmine.createSpyObj('AuthService', ['requestEmailVerification', 'isAuthenticated']);
  auth.requestEmailVerification.and.returnValue(of({}));
  auth.isAuthenticated.and.returnValue(true);

  return TestBed.runInInjectionContext(
    () =>
      new AccountState(
        toast as any,
        auth as any,
        {} as any,
        {} as any,
        { loadFromBackend: jasmine.createSpy('loadFromBackend') } as any,
        {
          events: of(),
          url: '/account/overview',
          navigate: () => Promise.resolve(true),
          navigateByUrl: () => Promise.resolve(true),
        } as any,
        { snapshot: { queryParamMap: { get: () => null } } } as any,
        {} as any,
        { ensureLoaded: jasmine.createSpy('ensureLoaded'), isLoaded: () => true, items: () => [] } as any,
        { unreadCount: () => 0, refreshUnreadCount: jasmine.createSpy('refreshUnreadCount') } as any,
        {} as any,
        { myCoupons: jasmine.createSpy('myCoupons').and.returnValue(of([])) } as any,
        { setPreference: jasmine.createSpy('setPreference') } as any,
        { language: () => 'en', setLanguage: jasmine.createSpy('setLanguage') } as any,
        { instant: (key: string) => key } as any,
        { read: () => null, clear: jasmine.createSpy('clear') } as any
      )
  );
}

describe('AccountState coverage wave 3', () => {
  it('initializes constructor defaults and phone-country derived state', () => {
    const state = createConstructedState();

    expect(state.profile()).toBeNull();
    expect(state.profileThemePreference).toBe('system');
    expect(Array.isArray(state.phoneCountries)).toBeTrue();
    expect(state.requiredFieldLabelKey('phone')).toBe('auth.phone');
  });

  it('maps required profile fields to translation keys', () => {
    const state = createState();

    expect(state.requiredFieldLabelKey('name')).toBe('auth.displayName');
    expect(state.requiredFieldLabelKey('username')).toBe('auth.username');
    expect(state.requiredFieldLabelKey('first_name')).toBe('auth.firstName');
    expect(state.requiredFieldLabelKey('last_name')).toBe('auth.lastName');
    expect(state.requiredFieldLabelKey('date_of_birth')).toBe('auth.dateOfBirth');
    expect(state.requiredFieldLabelKey('phone')).toBe('auth.phone');
  });

  it('normalizes localized address labels and preserves unknown custom labels', () => {
    const state = createState();

    expect(state.normalizeAddressLabel('serviciu')).toBe('work');
    expect(state.normalizeAddressLabel('altele')).toBe('other');
    expect(state.normalizeAddressLabel('Vacation Home')).toBe('Vacation Home');
  });

  it('requests verification and applies resend cooldown on success', () => {
    const state = createState();

    state.resendVerification();

    expect(state.auth.requestEmailVerification).toHaveBeenCalledWith('/account');
    expect(state.verificationStatus).toBe('account.verification.sentStatus');
    expect(state.primaryVerificationResendUntil()).not.toBeNull();
    expect(state.toast.success).toHaveBeenCalledWith('account.verification.sentToast');

    state.auth.requestEmailVerification.calls.reset();
    state.resendVerification();
    expect(state.auth.requestEmailVerification).not.toHaveBeenCalled();
  });

  it('shows verification resend errors from auth endpoint failures', () => {
    const state = createState();
    state.auth.requestEmailVerification.and.returnValue(
      throwError(() => new Error('mail failure'))
    );

    state.resendVerification();

    expect(state.toast.error).toHaveBeenCalledWith('account.verification.sendError');
  });
});
