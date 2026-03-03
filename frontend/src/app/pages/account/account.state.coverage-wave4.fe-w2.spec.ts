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

const configureBaseState = (state: any): void => {
  state.profileLoaded = false;
  state.router = { url: '/account/security' };
  state.route = {};
  state.activeSectionFromUrl = jasmine.createSpy('activeSectionFromUrl').and.returnValue('security');
  state.ensureLoadedForSection = jasmine.createSpy('ensureLoadedForSection');
  state.loadProfile = jasmine.createSpy('loadProfile');
  state.toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);
  state.t = (key: string) => key;
  state.loading = makeSignal(false);
  state.error = makeSignal<string | null>('stale-error');
  state.ordersMeta = makeSignal<any>(null);
};

const configureAuthState = (state: any): void => {
  state.auth = jasmine.createSpyObj('AuthService', ['isAuthenticated', 'deletePasskey', 'revokeOtherSessions']);
  state.auth.isAuthenticated.and.returnValue(true);
  state.auth.deletePasskey.and.returnValue(of({}));
  state.auth.revokeOtherSessions.and.returnValue(of({ revoked: 1 }));
  state.auth.addSecondaryEmail = jasmine.createSpy('addSecondaryEmail').and.returnValue(of({ id: 'sec-1', verified: false }));
  state.auth.requestSecondaryEmailVerification = jasmine.createSpy('requestSecondaryEmailVerification').and.returnValue(of({}));
  state.auth.confirmSecondaryEmailVerification = jasmine
    .createSpy('confirmSecondaryEmailVerification')
    .and.returnValue(of({ id: 'sec-1', verified_at: '2026-03-03T00:00:00Z' }));
  state.auth.deleteSecondaryEmail = jasmine.createSpy('deleteSecondaryEmail').and.returnValue(of({}));
  state.auth.makeSecondaryEmailPrimary = jasmine.createSpy('makeSecondaryEmailPrimary').and.returnValue(
    of({ id: 'u-1', email_verified: true }),
  );
  state.auth.listPasskeys = jasmine.createSpy('listPasskeys').and.returnValue(of([]));
  state.account = jasmine.createSpyObj('AccountService', ['getProfile']);
  state.account.getProfile.and.returnValue(of({ id: 'u-1' }));
  state.notificationsService = jasmine.createSpyObj('NotificationsService', ['unreadCount']);
  state.notificationsService.unreadCount.and.returnValue(4);
};

const configureSecurityState = (state: any): void => {
  state.passkeysError = makeSignal<string | null>('old-error');
  state.removePasskeyConfirmId = null;
  state.removePasskeyPassword = 'to-reset';
  state.removingPasskeyId = null;
  state.sessions = makeSignal<any[]>([]);
  state.sessionsError = makeSignal<string | null>('old-session-error');
  state.sessionsLoading = makeSignal(false);
  state.sessionsLoaded = makeSignal(false);
  state.revokeOtherSessionsPassword = 'existing';
  state.revokeOtherSessionsConfirming = false;
  state.revokingOtherSessions = false;
  state.passkeys = makeSignal<any[]>([]);
  state.passkeysLoaded = makeSignal(false);
  state.passkeysLoading = makeSignal(false);
  state.passkeysSupported = jasmine.createSpy('passkeysSupported').and.returnValue(false);
};

const configureSecondaryEmailState = (state: any): void => {
  state.secondaryEmails = makeSignal<any[]>([]);
  state.secondaryEmailsLoading = makeSignal(false);
  state.secondaryEmailsLoaded = makeSignal(false);
  state.secondaryEmailsError = makeSignal<string | null>(null);
  state.secondaryEmailToAdd = '';
  state.secondaryEmailMessage = null;
  state.addingSecondaryEmail = false;
  state.verifyingSecondaryEmail = false;
  state.makingPrimaryEmail = false;
  state.emailVerified = makeSignal(false);
  state.secondaryEmailResendUntilById = makeSignal<Record<string, number>>({});
  state.secondaryVerificationEmailId = null;
  state.secondaryVerificationToken = 'token-old';
  state.secondaryVerificationStatus = 'status-old';
  state.now = makeSignal(Date.parse('2026-03-03T00:00:00Z'));
  state.removeSecondaryEmailId = 'sec-old';
  state.removeSecondaryEmailPassword = 'remove-old';
  state.removingSecondaryEmail = false;
  state.makePrimarySecondaryEmailId = 'primary-old';
  state.makePrimaryPassword = 'make-old';
  state.makePrimaryError = 'old-error';
};

const configureLifecycleState = (state: any): void => {
  state.cancelMakePrimary = jasmine.createSpy('cancelMakePrimary').and.callFake(() => {
    AccountState.prototype.cancelMakePrimary.call(state);
  });
  state.cancelDeleteSecondaryEmail = jasmine.createSpy('cancelDeleteSecondaryEmail').and.callFake(() => {
    AccountState.prototype.cancelDeleteSecondaryEmail.call(state);
  });
  state.googleLinkPendingService = jasmine.createSpyObj('GoogleLinkPendingService', ['getPending', 'clear']);
  state.googleLinkPendingService.getPending.and.returnValue(null);
  state.googleLinkPending = true;
  state.profileHasUnsavedChanges = jasmine.createSpy('profileHasUnsavedChanges').and.returnValue(false);
  state.addressesHasUnsavedChanges = jasmine.createSpy('addressesHasUnsavedChanges').and.returnValue(false);
  state.notificationsHasUnsavedChanges = jasmine.createSpy('notificationsHasUnsavedChanges').and.returnValue(false);
  state.loadSessions = jasmine.createSpy('loadSessions');
  state.loadSecondaryEmails = jasmine.createSpy('loadSecondaryEmails');
  state.loadCooldowns = jasmine.createSpy('loadCooldowns');
  state.signOut = jasmine.createSpy('signOut');
  state.idleWarning = makeSignal<string | null>(null);
  state.idleTimer = null;
  state.nowInterval = 123 as any;
  state.exportJobPoll = null;
  state.routerEventsSub = { unsubscribe: jasmine.createSpy('unsubscribe') };
  state.phoneCountriesEffect = { destroy: jasmine.createSpy('destroy') };
  state.handleUserActivity = () => undefined;
  state.handleBeforeUnload = () => undefined;
};

const createState = (): any => {
  const state: any = Object.create(AccountState.prototype);
  configureBaseState(state);
  configureAuthState(state);
  configureSecurityState(state);
  configureSecondaryEmailState(state);
  configureLifecycleState(state);
  return state;
};

describe('AccountState coverage wave 4 FE-W2', () => {
  it('retries account loading and reports unread plus pending counters', () => {
    const state = createState();
    state.profileLoaded = true;

    state.retryAccountLoad();

    expect(state.profileLoaded).toBeFalse();
    expect(state.loadProfile).toHaveBeenCalledTimes(1);
    expect(state.activeSectionFromUrl).toHaveBeenCalledWith('/account/security');
    expect(state.ensureLoadedForSection).toHaveBeenCalledWith('security');

    expect(state.unreadNotificationsCount()).toBe(4);
    expect(state.pendingOrdersCount()).toBe(0);
    state.ordersMeta.set({ pending_count: 3 });
    expect(state.pendingOrdersCount()).toBe(3);
  });

  it('covers loadProfile guard exits plus error and success transitions', () => {
    const state = createState();
    state.applyLoadedProfile = jasmine.createSpy('applyLoadedProfile');

    state.loading.set(true);
    (state as any).loadProfile();
    expect(state.account.getProfile).not.toHaveBeenCalled();

    state.loading.set(false);
    state.profileLoaded = true;
    (state as any).loadProfile();
    expect(state.account.getProfile).not.toHaveBeenCalled();

    state.profileLoaded = false;
    state.auth.isAuthenticated.and.returnValue(false);
    (state as any).loadProfile();
    expect(state.account.getProfile).not.toHaveBeenCalled();

    state.auth.isAuthenticated.and.returnValue(true);
    state.account.getProfile.and.returnValue(throwError(() => new Error('boom')));
    (state as any).loadProfile();
    expect(state.error()).toBe('account.loadError');
    expect(state.loading()).toBeFalse();
    expect(state.applyLoadedProfile).not.toHaveBeenCalled();

    const loadedProfile = { id: 'u-1', email_verified: true };
    state.account.getProfile.and.returnValue(of(loadedProfile));
    (state as any).loadProfile(true);

    expect(state.applyLoadedProfile).toHaveBeenCalledWith(loadedProfile as any);
    expect(state.profileLoaded).toBeTrue();
    expect(state.loading()).toBeFalse();
  });

  it('handles passkey removal start/cancel guards and reset transitions', () => {
    const state = createState();

    state.passkeysError.set('existing-error');
    state.startRemovePasskey('pk-1');
    expect(state.removePasskeyConfirmId).toBe('pk-1');
    expect(state.removePasskeyPassword).toBe('');
    expect(state.passkeysError()).toBeNull();

    state.auth.isAuthenticated.and.returnValue(false);
    state.startRemovePasskey('pk-2');
    expect(state.removePasskeyConfirmId).toBe('pk-1');

    state.auth.isAuthenticated.and.returnValue(true);
    state.removingPasskeyId = 'pk-1';
    state.removePasskeyConfirmId = 'pk-1';
    state.removePasskeyPassword = 'keep';
    state.cancelRemovePasskey();
    expect(state.removePasskeyConfirmId).toBe('pk-1');
    expect(state.removePasskeyPassword).toBe('keep');

    state.removingPasskeyId = null;
    state.cancelRemovePasskey();
    expect(state.removePasskeyConfirmId).toBeNull();
    expect(state.removePasskeyPassword).toBe('');
  });

  it('counts and toggles other-session revocation helper state with guards', () => {
    const state = createState();
    state.sessions.set([
      { id: 's-current', is_current: true },
      { id: 's-other-1', is_current: false },
      { id: 's-other-2', is_current: false },
    ]);

    expect(state.otherSessionsCount()).toBe(2);

    state.revokeOtherSessionsPassword = 'will-clear';
    state.revokeOtherSessionsConfirming = false;
    state.sessionsError.set('session-error');
    state.startRevokeOtherSessions();
    expect(state.revokeOtherSessionsPassword).toBe('');
    expect(state.revokeOtherSessionsConfirming).toBeTrue();
    expect(state.sessionsError()).toBeNull();

    state.revokingOtherSessions = true;
    state.revokeOtherSessionsPassword = 'kept';
    state.revokeOtherSessionsConfirming = true;
    state.cancelRevokeOtherSessions();
    expect(state.revokeOtherSessionsPassword).toBe('kept');
    expect(state.revokeOtherSessionsConfirming).toBeTrue();

    state.revokingOtherSessions = false;
    state.cancelRevokeOtherSessions();
    expect(state.revokeOtherSessionsPassword).toBe('');
    expect(state.revokeOtherSessionsConfirming).toBeFalse();

    state.auth.isAuthenticated.and.returnValue(false);
    state.startRevokeOtherSessions();
    expect(state.revokeOtherSessionsConfirming).toBeFalse();
  });

  it('covers secondary-email cooldown helpers and verification modal transitions', () => {
    const state = createState();
    const nowMs = Date.parse('2026-03-03T00:00:00Z');
    spyOn(Date, 'now').and.returnValue(nowMs);

    state.secondaryEmailResendUntilById.set({
      'sec-a': nowMs + 29_001,
      'sec-expired': nowMs - 1_000,
    });

    expect(state.secondaryEmailResendRemainingSeconds('sec-a')).toBe(30);
    expect(state.secondaryEmailResendRemainingSeconds('sec-expired')).toBe(0);
    expect(state.secondaryEmailResendRemainingSeconds('missing')).toBe(0);

    state.secondaryVerificationToken = 'old-token';
    state.secondaryVerificationStatus = 'old-status';
    state.startSecondaryEmailVerification('sec-a');
    expect(state.cancelMakePrimary).toHaveBeenCalled();
    expect(state.cancelDeleteSecondaryEmail).toHaveBeenCalled();
    expect(state.secondaryVerificationEmailId).toBe('sec-a');
    expect(state.secondaryVerificationToken).toBe('');
    expect(state.secondaryVerificationStatus).toBeNull();

    (state as any).bumpSecondaryEmailResendCooldown('sec-b');
    expect(state.secondaryEmailResendUntilById()['sec-b']).toBe(nowMs + 60_000);

    const beforeMissingClear = state.secondaryEmailResendUntilById();
    (state as any).clearSecondaryEmailResendCooldown('unknown');
    expect(state.secondaryEmailResendUntilById()).toEqual(beforeMissingClear);

    (state as any).clearSecondaryEmailResendCooldown('sec-b');
    expect(state.secondaryEmailResendUntilById()['sec-b']).toBeUndefined();

    state.cancelSecondaryEmailVerification();
    expect(state.secondaryVerificationEmailId).toBeNull();
    expect(state.secondaryVerificationToken).toBe('');
    expect(state.secondaryVerificationStatus).toBeNull();
  });

  it('covers delete/make-primary cancellations, google pending context, and unsaved aggregation', () => {
    const state = createState();

    state.removeSecondaryEmailId = 'sec-rm';
    state.removeSecondaryEmailPassword = 'rm-pass';
    state.removingSecondaryEmail = true;
    state.cancelDeleteSecondaryEmail();
    expect(state.removeSecondaryEmailId).toBe('sec-rm');
    expect(state.removeSecondaryEmailPassword).toBe('rm-pass');

    state.removingSecondaryEmail = false;
    state.cancelDeleteSecondaryEmail();
    expect(state.removeSecondaryEmailId).toBeNull();
    expect(state.removeSecondaryEmailPassword).toBe('');

    state.makePrimarySecondaryEmailId = 'sec-main';
    state.makePrimaryPassword = 'main-pass';
    state.makePrimaryError = 'main-error';
    state.cancelMakePrimary();
    expect(state.makePrimarySecondaryEmailId).toBeNull();
    expect(state.makePrimaryPassword).toBe('');
    expect(state.makePrimaryError).toBeNull();

    const pending = { code: 'pending-code', state: 'pending-state' };
    state.googleLinkPendingService.getPending.and.returnValue(pending);
    expect((state as any).readPendingGoogleLinkContext()).toEqual(pending);

    (state as any).clearPendingGoogleLinkContext();
    expect(state.googleLinkPendingService.clear).toHaveBeenCalledTimes(1);
    expect(state.googleLinkPending).toBeFalse();

    state.profileHasUnsavedChanges.and.returnValue(false);
    state.addressesHasUnsavedChanges.and.returnValue(false);
    state.notificationsHasUnsavedChanges.and.returnValue(false);
    expect((state as any).hasUnsavedChanges()).toBeFalse();

    state.notificationsHasUnsavedChanges.and.returnValue(true);
    expect((state as any).hasUnsavedChanges()).toBeTrue();
  });

  it('covers revoke-other-sessions confirmation branches for missing password, revoked=0, and error', () => {
    const state = createState();
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(true);

    state.revokeOtherSessionsConfirming = false;
    state.confirmRevokeOtherSessions();
    expect(state.auth.revokeOtherSessions).not.toHaveBeenCalled();

    state.revokeOtherSessionsConfirming = true;
    state.revokeOtherSessionsPassword = '';
    state.confirmRevokeOtherSessions();
    expect(state.toast.error).toHaveBeenCalledWith('auth.currentPasswordRequired');

    state.revokeOtherSessionsPassword = 'pw';
    state.auth.revokeOtherSessions.and.returnValue(of({ revoked: 0 }));
    state.confirmRevokeOtherSessions();
    expect(confirmSpy).toHaveBeenCalled();
    expect(state.auth.revokeOtherSessions).toHaveBeenCalledWith('pw');
    expect(state.toast.success).toHaveBeenCalledWith('account.security.devices.noneRevoked');
    expect(state.loadSessions).toHaveBeenCalledWith(true);
    expect(state.revokeOtherSessionsConfirming).toBeFalse();
    expect(state.revokeOtherSessionsPassword).toBe('');

    state.revokeOtherSessionsConfirming = true;
    state.revokeOtherSessionsPassword = 'pw-2';
    state.auth.revokeOtherSessions.and.returnValue(throwError(() => ({ error: { detail: 'revoke failed' } })));
    state.confirmRevokeOtherSessions();
    expect(state.sessionsError()).toBe('revoke failed');
    expect(state.toast.error).toHaveBeenCalledWith('revoke failed');
    expect(state.revokingOtherSessions).toBeFalse();
  });

  it('covers idle timer reset and ngOnDestroy cleanup branches', () => {
    const state = createState();
    const clearTimeoutSpy = spyOn(window, 'clearTimeout');
    const clearIntervalSpy = spyOn(window, 'clearInterval');
    const removeEventSpy = spyOn(window, 'removeEventListener');
    const setTimeoutSpy = spyOn(window, 'setTimeout').and.callFake(((handler: TimerHandler) => {
      if (typeof handler === 'function') handler();
      return 77 as any;
    }) as any);

    state.idleTimer = 66 as any;
    (state as any).resetIdleTimer();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(66 as any);
    expect(setTimeoutSpy).toHaveBeenCalled();
    expect(state.idleWarning()).toBe('account.security.session.idleLogout');
    expect(state.signOut).toHaveBeenCalled();

    state.idleTimer = 88 as any;
    state.ngOnDestroy();
    expect(clearIntervalSpy).toHaveBeenCalledWith(123 as any);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(88 as any);
    expect(state.routerEventsSub.unsubscribe).toHaveBeenCalled();
    expect(state.phoneCountriesEffect.destroy).toHaveBeenCalled();
    expect(removeEventSpy).toHaveBeenCalled();
  });

  it('covers passkey-loading unsupported branch and secondary-email lifecycle methods', () => {
    const state = createState();
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(true);
    spyOn(Date, 'now').and.returnValue(Date.parse('2026-03-03T00:00:00Z'));

    (state as any).loadPasskeys();
    expect(state.passkeys()).toEqual([]);
    expect(state.passkeysLoaded()).toBeTrue();

    state.secondaryEmailToAdd = '';
    state.addSecondaryEmail();
    expect(state.toast.error).toHaveBeenCalledWith('account.security.emails.enterEmail');

    state.secondaryEmailToAdd = 'guest2@example.com';
    state.addSecondaryEmail();
    expect(state.auth.addSecondaryEmail).toHaveBeenCalledWith('guest2@example.com');
    expect(state.secondaryEmailMessage).toBe('account.security.emails.verificationSent');
    expect(state.secondaryVerificationEmailId).toBe('sec-1');

    state.secondaryEmailResendUntilById.set({});
    state.resendSecondaryEmailVerification('sec-1');
    expect(state.auth.requestSecondaryEmailVerification).toHaveBeenCalledWith('sec-1', '/account');
    expect(state.toast.success).toHaveBeenCalledWith('account.security.emails.verificationEmailSent');

    state.secondaryVerificationEmailId = 'sec-1';
    state.secondaryVerificationToken = '';
    state.confirmSecondaryEmailVerification();
    expect(state.toast.error).toHaveBeenCalledWith('account.security.emails.enterVerificationCode');

    state.secondaryVerificationToken = '123456';
    state.confirmSecondaryEmailVerification();
    expect(state.auth.confirmSecondaryEmailVerification).toHaveBeenCalledWith('123456');
    expect(state.secondaryEmailMessage).toBe('account.security.emails.verified');

    state.startDeleteSecondaryEmail('sec-1');
    state.removeSecondaryEmailPassword = '';
    state.confirmDeleteSecondaryEmail();
    expect(state.toast.error).toHaveBeenCalledWith('auth.currentPasswordRequired');

    state.removeSecondaryEmailPassword = 'pw';
    state.confirmDeleteSecondaryEmail();
    expect(confirmSpy).toHaveBeenCalled();
    expect(state.auth.deleteSecondaryEmail).toHaveBeenCalledWith('sec-1', 'pw');
    expect(state.toast.success).toHaveBeenCalledWith('account.security.emails.removed');

    state.startMakePrimary('sec-2');
    state.makePrimaryPassword = '';
    state.confirmMakePrimary();
    expect(state.toast.error).toHaveBeenCalledWith('account.security.emails.makePrimaryPasswordRequired');

    state.makePrimaryPassword = 'pw-primary';
    state.confirmMakePrimary();
    expect(state.auth.makeSecondaryEmailPrimary).toHaveBeenCalledWith('sec-2', 'pw-primary');
    expect(state.loadSecondaryEmails).toHaveBeenCalledWith(true);
    expect(state.loadCooldowns).toHaveBeenCalledWith(true);
  });
});
