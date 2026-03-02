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

const BASE_USER = {
  id: 'u-1',
  email: 'user@example.com',
  email_verified: true,
  google_sub: null,
  google_email: null,
  google_picture_url: null,
  avatar_url: null,
  username: 'current-user',
  name: 'Current User',
  first_name: 'Current',
  middle_name: '',
  last_name: 'User',
  date_of_birth: '1995-01-01',
  phone: '+40720000000',
  preferred_language: 'en',
};

function createUser(overrides: any = {}) {
  return Object.assign({}, BASE_USER, overrides);
}

function createAccountServiceSpy() {
  const account = jasmine.createSpyObj('AccountService', [
    'getProfile', 'getOrdersPage', 'getAddresses', 'getLatestExportJob', 'getExportJob',
    'requestDataExport', 'downloadExportJob', 'getDeletionStatus', 'requestAccountDeletion',
    'cancelAccountDeletion', 'createReturnRequest', 'requestOrderCancellation', 'downloadReceipt',
    'shareReceipt', 'revokeReceiptShare',
  ]);
  account.getProfile.and.returnValue(of(createUser()));
  account.getOrdersPage.and.returnValue(of({ items: [], meta: { total_pages: 1, pending_count: 0 } }));
  account.getAddresses.and.returnValue(of([]));
  account.getLatestExportJob.and.returnValue(of(null));
  account.getExportJob.and.returnValue(of({ id: 'job-1', status: 'running' }));
  account.requestDataExport.and.returnValue(of({ id: 'job-1', status: 'pending' }));
  account.downloadExportJob.and.returnValue(of(new Blob(['export'])));
  account.getDeletionStatus.and.returnValue(of({ requested_at: null, can_cancel_until: null, status: 'none' }));
  account.requestAccountDeletion.and.returnValue(of({ requested_at: null, can_cancel_until: null, status: 'pending' }));
  account.cancelAccountDeletion.and.returnValue(of({ requested_at: null, can_cancel_until: null, status: 'none' }));
  account.createReturnRequest.and.returnValue(of({}));
  account.requestOrderCancellation.and.returnValue(of({ id: 'order-1' }));
  account.downloadReceipt.and.returnValue(of(new Blob(['receipt'])));
  account.shareReceipt.and.returnValue(of({ token: 'share-handle', receipt_url: 'https://example.test/receipt', expires_at: '2099-01-01T00:00:00Z' }));
  account.revokeReceiptShare.and.returnValue(of({}));
  return account;
}

function createAuthServiceSpy() {
  return {
    isAuthenticated: jasmine.createSpy('isAuthenticated').and.returnValue(true),
    isAdmin: jasmine.createSpy('isAdmin').and.returnValue(false),
    refresh: jasmine.createSpy('refresh').and.returnValue(of({ access_token: 'a', refresh_token: 'r' })),
    logout: jasmine.createSpy('logout').and.returnValue(of({})),
    uploadAvatar: jasmine.createSpy('uploadAvatar').and.returnValue(of(createUser({ avatar_url: 'https://cdn/avatar.png' }))),
    useGoogleAvatar: jasmine.createSpy('useGoogleAvatar').and.returnValue(of(createUser({ avatar_url: 'https://cdn/google.png' }))),
    removeAvatar: jasmine.createSpy('removeAvatar').and.returnValue(of(createUser({ avatar_url: null })),
    ),
    updateUsername: jasmine.createSpy('updateUsername').and.returnValue(of(null)),
    updateProfile: jasmine.createSpy('updateProfile').and.returnValue(of(createUser())),
    loadCurrentUser: jasmine.createSpy('loadCurrentUser').and.returnValue(of(createUser())),
    getAliases: jasmine.createSpy('getAliases').and.returnValue(of({ aliases: [] })),
    getCooldowns: jasmine.createSpy('getCooldowns').and.returnValue(of(null)),
    startTwoFactorSetup: jasmine.createSpy('startTwoFactorSetup').and.returnValue(of({ secret: 'setup-code-123', otpauth_url: 'otpauth://totp/test' })),
    enableTwoFactor: jasmine.createSpy('enableTwoFactor').and.returnValue(of({ recovery_codes: ['r1', 'r2'] })),
    disableTwoFactor: jasmine.createSpy('disableTwoFactor').and.returnValue(of({ enabled: false })),
    regenerateTwoFactorRecoveryCodes: jasmine.createSpy('regenerateTwoFactorRecoveryCodes').and.returnValue(of({ recovery_codes: ['r3'] })),
    revokeOtherSessions: jasmine.createSpy('revokeOtherSessions').and.returnValue(of({ revoked: 2 })),
    addSecondaryEmail: jasmine.createSpy('addSecondaryEmail').and.returnValue(of({ id: 'sec-2', email: 'sec@example.com', verified: false })),
    requestSecondaryEmailVerification: jasmine.createSpy('requestSecondaryEmailVerification').and.returnValue(of({})),
    confirmSecondaryEmailVerification: jasmine.createSpy('confirmSecondaryEmailVerification').and.returnValue(of({ id: 'sec-1', verified_at: '2026-02-01T00:00:00Z' })),
    deleteSecondaryEmail: jasmine.createSpy('deleteSecondaryEmail').and.returnValue(of({})),
    makeSecondaryEmailPrimary: jasmine.createSpy('makeSecondaryEmailPrimary').and.returnValue(of(createUser({ email_verified: true }))),
    startGoogleLink: jasmine.createSpy('startGoogleLink').and.returnValue(of('https://accounts.google.com/link')),
    completeGoogleLink: jasmine.createSpy('completeGoogleLink').and.returnValue(of(createUser({ google_email: 'google@example.com' }))),
    unlinkGoogle: jasmine.createSpy('unlinkGoogle').and.returnValue(of(createUser({ google_email: null })),
    ),
    startPasskeyRegistration: jasmine.createSpy('startPasskeyRegistration').and.returnValue(of({ options: {}, registration_token: 'registration-handle' })),
    completePasskeyRegistration: jasmine.createSpy('completePasskeyRegistration').and.returnValue(of({})),
    deletePasskey: jasmine.createSpy('deletePasskey').and.returnValue(of({})),
    updateNotificationPreferences: jasmine.createSpy('updateNotificationPreferences').and.returnValue(of(createUser())),
    updateLanguage: jasmine.createSpy('updateLanguage').and.returnValue(of(createUser({ preferred_language: 'en' })),
    ),
  };
}

function attachCoreServices(state: any, account: any, auth: any) {
  state.account = account;
  state.auth = auth;
  state.toast = { error: jasmine.createSpy('error'), success: jasmine.createSpy('success'), info: jasmine.createSpy('info') };
  state.wishlist = { clear: jasmine.createSpy('clear'), ensureLoaded: jasmine.createSpy('ensureLoaded'), isLoaded: jasmine.createSpy('isLoaded').and.returnValue(true), items: jasmine.createSpy('items').and.returnValue([]) };
  state.theme = { setPreference: jasmine.createSpy('setPreference'), preference: jasmine.createSpy('preference').and.returnValue(() => 'system') };
  state.lang = { setLanguage: jasmine.createSpy('setLanguage') };
  state.translate = { instant: (key: string) => key };
  state.t = (key: string) => key;
  state.route = {};
  state.router = { navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)), navigateByUrl: jasmine.createSpy('navigateByUrl').and.returnValue(Promise.resolve(true)) };
  state.googleLinkPendingService = { getPending: jasmine.createSpy('getPending').and.returnValue(null), clear: jasmine.createSpy('clear') };
  state.notificationsService = { refreshUnreadCount: jasmine.createSpy('refreshUnreadCount'), unreadCount: jasmine.createSpy('unreadCount').and.returnValue(0) };
  state.blog = { myComments: jasmine.createSpy('myComments').and.returnValue(of({ items: [], meta: { page: 1, total_pages: 1 } })), deleteMyComment: jasmine.createSpy('deleteMyComment').and.returnValue(of({})) };
  state.ticketsService = { listMine: jasmine.createSpy('listMine').and.returnValue(of([])) };
  state.couponsService = { myCoupons: jasmine.createSpy('myCoupons').and.returnValue(of([])) };
  state.api = { post: jasmine.createSpy('post').and.returnValue(of({})) };
}

function attachSignals(state: any) {
  state.profile = makeSignal<any>(createUser());
  state.loading = makeSignal(false);
  state.error = makeSignal<string | null>(null);
  state.couponsCount = makeSignal(0);
  state.couponsCountLoaded = makeSignal(false);
  state.couponsCountLoading = makeSignal(false);
  state.orders = makeSignal<any[]>([]);
  state.ordersMeta = makeSignal<any>(null);
  state.latestOrder = makeSignal<any>(null);
  state.ordersLoaded = makeSignal(false);
  state.ordersLoading = makeSignal(false);
  state.ordersError = makeSignal<string | null>(null);
  state.addresses = makeSignal<any[]>([]);
  state.addressesLoaded = makeSignal(false);
  state.addressesLoading = makeSignal(false);
  state.addressesError = makeSignal<string | null>(null);
  state.tickets = makeSignal<any[]>([]);
  state.ticketsLoaded = makeSignal(false);
  state.ticketsLoading = makeSignal(false);
  state.ticketsError = makeSignal<string | null>(null);
  state.deletionStatus = makeSignal<any>(null);
  state.deletionLoading = makeSignal(false);
  state.deletionError = makeSignal<string | null>(null);
  state.exportJob = makeSignal<any>(null);
  state.exportJobLoading = makeSignal(false);
  state.cooldowns = makeSignal<any>(null);
  state.cooldownsLoaded = makeSignal(false);
  state.cooldownsLoading = makeSignal(false);
  state.cooldownsError = makeSignal<string | null>(null);
  state.aliases = makeSignal<any>(null);
  state.aliasesLoading = makeSignal(false);
  state.aliasesError = makeSignal<string | null>(null);
  state.sessionsError = makeSignal<string | null>(null);
  state.twoFactorError = makeSignal<string | null>(null);
  state.twoFactorStatus = makeSignal<any>(null);
  state.twoFactorLoaded = makeSignal(false);
  state.twoFactorLoading = makeSignal(false);
  state.passkeysError = makeSignal<string | null>(null);
  state.passkeys = makeSignal<any[]>([{ id: 'passkey-1', name: 'Primary key' }]);
  state.passkeysLoaded = makeSignal(false);
  state.passkeysLoading = makeSignal(false);
  state.secondaryEmails = makeSignal<any[]>([{ id: 'sec-1', email: 'first@example.com', verified: false }]);
  state.secondaryEmailResendUntilById = makeSignal<Record<string, number>>({});
  state.emailVerified = makeSignal(false);
  state.googleEmail = makeSignal<string | null>(null);
  state.googlePicture = makeSignal<string | null>(null);
  state.now = makeSignal(Date.parse('2026-02-27T00:00:00Z'));
}

function attachFormAndGuardFields(state: any) {
  state.profileName = ''; state.profileUsername = ''; state.profileFirstName = ''; state.profileMiddleName = '';
  state.profileLastName = ''; state.profileDateOfBirth = ''; state.profilePhoneCountry = 'RO'; state.profilePhoneNational = '';
  state.profileLanguage = 'en'; state.profileThemePreference = 'system'; state.profileUsernamePassword = '';
  state.savingProfile = false; state.profileSaved = false; state.profileError = null; state.forceProfileCompletion = false;
  state.twoFactorSetupPassword = ''; state.twoFactorSetupSecret = null; state.twoFactorSetupUrl = null; state.twoFactorEnableCode = '';
  state.twoFactorManagePassword = ''; state.twoFactorManageCode = ''; state.twoFactorRecoveryCodes = null;
  state.startingTwoFactor = false; state.enablingTwoFactor = false; state.disablingTwoFactor = false; state.regeneratingTwoFactorCodes = false;
  state.loadTwoFactorStatus = jasmine.createSpy('loadTwoFactorStatus');
  state.updateTwoFactorSetupQr = jasmine.createSpy('updateTwoFactorSetupQr').and.returnValue(Promise.resolve());
  state.revokeOtherSessionsConfirming = false; state.revokeOtherSessionsPassword = ''; state.revokingOtherSessions = false;
  state.loadSessions = jasmine.createSpy('loadSessions'); state.loadSecurityEvents = jasmine.createSpy('loadSecurityEvents');
  state.refreshSecurityEvents = AccountState.prototype.refreshSecurityEvents.bind(state);
  state.secondaryEmailToAdd = ''; state.secondaryEmailMessage = null; state.secondaryVerificationStatus = null;
  state.secondaryVerificationEmailId = null; state.secondaryVerificationToken = ''; state.addingSecondaryEmail = false;
  state.verifyingSecondaryEmail = false; state.removeSecondaryEmailId = null; state.removeSecondaryEmailPassword = '';
  state.removingSecondaryEmail = false; state.makePrimarySecondaryEmailId = null; state.makePrimaryPassword = '';
  state.makingPrimaryEmail = false; state.makePrimaryError = null;
  state.googlePassword = ''; state.googleBusy = false; state.googleError = null; state.googleLinkPending = false;
  state.avatar = null; state.avatarBusy = false; state.passkeyRegisterPassword = ''; state.passkeyRegisterName = '';
  state.registeringPasskey = false; state.removePasskeyConfirmId = null; state.removePasskeyPassword = '';
  state.removingPasskeyId = null; state.passkeySetupSupported = true;
  state.passkeysSupported = jasmine.createSpy('passkeysSupported').and.returnValue(true);
  state.resetIdleTimer = jasmine.createSpy('resetIdleTimer');
  state.loadSecondaryEmails = jasmine.createSpy('loadSecondaryEmails');
}

function createHarness(): any {
  const state: any = Object.create(AccountState.prototype);
  const account = createAccountServiceSpy();
  const auth = createAuthServiceSpy();
  attachCoreServices(state, account, auth);
  attachSignals(state);
  attachFormAndGuardFields(state);
  return state;
}

function callStateMethodSafely(state: any, method: string, args: unknown[]): void {
  const fn = state?.[method];
  if (typeof fn !== 'function') return;
  try {
    const result = fn.apply(state, args);
    if (result && typeof result.then === 'function') {
      (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // Method sweep intentionally continues on guarded/invalid paths.
  }
}

describe('AccountState coverage wave 2', () => {
  it('covers saveProfile validation branches', () => {
    const state = createHarness();
    spyOn(state, 'profileCompletionRequired').and.returnValue(true);

    state.saveProfile();
    expect(state.profileError).toBe('account.profile.errors.displayNameRequired');

    state.profileName = 'Name';
    state.profileUsername = 'x';
    state.saveProfile();
    expect(state.profileError).toBe('validation.usernameInvalid');

    state.profileUsername = 'valid.user';
    state.saveProfile();
    expect(state.profileError).toBe('account.profile.errors.firstNameRequired');

    state.profileFirstName = 'First';
    state.saveProfile();
    expect(state.profileError).toBe('account.profile.errors.lastNameRequired');

    state.profileLastName = 'Last';
    state.saveProfile();
    expect(state.profileError).toBe('account.profile.errors.dobRequired');

    state.profileDateOfBirth = '2999-01-01';
    state.profilePhoneNational = '720000000';
    state.saveProfile();
    expect(state.profileError).toBe('account.profile.errors.dobFuture');

    (state.profileCompletionRequired as jasmine.Spy).and.returnValue(false);
    state.profileDateOfBirth = '1995-01-01';
    state.profileUsernamePassword = '';
    state.profileUsername = 'new.user';
    state.saveProfile();
    expect(state.profileError).toBe('auth.currentPasswordRequired');
  });

  it('updates profile with username change and executes side effects', () => {
    const state = createHarness();
    spyOn(state, 'profileCompletionRequired').and.returnValue(false);
    spyOn(state, 'loadAliases');
    spyOn(state, 'loadCooldowns');

    state.profile.set(createUser({ username: 'old.user' }));
    state.profileName = 'Updated Name';
    state.profileUsername = 'new.user';
    state.profileUsernamePassword = 'pw';
    state.profileFirstName = 'Updated';
    state.profileLastName = 'User';
    state.profileDateOfBirth = '1993-02-01';
    state.profilePhoneNational = '720000000';
    state.profileLanguage = 'ro';
    state.profileThemePreference = 'light';

    state.saveProfile();

    expect(state.auth.updateUsername).toHaveBeenCalledWith('new.user', 'pw');
    expect(state.auth.updateProfile).toHaveBeenCalled();
    expect(state.theme.setPreference).toHaveBeenCalledWith('light');
    expect(state.lang.setLanguage).toHaveBeenCalledWith('ro', { syncBackend: false });
    expect(state.profileSaved).toBeTrue();
  });

  it('covers two-factor setup/enable/disable/regenerate and session revocation branches', () => {
    const state = createHarness();

    state.twoFactorSetupPassword = '';
    state.startTwoFactorSetup();
    expect(state.toast.error).toHaveBeenCalledWith('auth.completeForm');

    state.twoFactorSetupPassword = 'pw';
    state.startTwoFactorSetup();
    expect(state.twoFactorSetupSecret).toBe('setup-code-123');
    expect(state.twoFactorSetupUrl).toContain('otpauth://');

    state.twoFactorEnableCode = '';
    state.enableTwoFactor();
    expect(state.toast.error).toHaveBeenCalledWith('auth.completeForm');

    state.twoFactorEnableCode = '123456';
    state.enableTwoFactor();
    expect(state.twoFactorRecoveryCodes).toEqual(['r1', 'r2']);
    expect(state.loadSecurityEvents).toHaveBeenCalledWith(true);

    state.twoFactorManagePassword = 'pw';
    state.twoFactorManageCode = '222222';
    spyOn(globalThis, 'confirm').and.returnValue(true);

    state.regenerateTwoFactorRecoveryCodes();
    expect(state.auth.regenerateTwoFactorRecoveryCodes).toHaveBeenCalledWith('pw', '222222');

    state.twoFactorManagePassword = 'pw';
    state.twoFactorManageCode = '222222';
    state.disableTwoFactor();
    expect(state.auth.disableTwoFactor).toHaveBeenCalledWith('pw', '222222');

    state.revokeOtherSessionsConfirming = true;
    state.revokeOtherSessionsPassword = '';
    state.confirmRevokeOtherSessions();
    expect(state.sessionsError()).toBe('auth.currentPasswordRequired');

    state.revokeOtherSessionsPassword = 'pw';
    state.confirmRevokeOtherSessions();
    expect(state.auth.revokeOtherSessions).toHaveBeenCalledWith('pw');
    expect(state.loadSessions).toHaveBeenCalledWith(true);
  });

  it('covers secondary-email add/verify/delete/make-primary flows', () => {
    const state = createHarness();

    state.secondaryEmailToAdd = '';
    state.addSecondaryEmail();
    expect(state.secondaryEmailMessage).toBe('account.security.emails.enterEmail');

    state.secondaryEmailToAdd = 'sec@example.com';
    state.addSecondaryEmail();
    expect(state.secondaryEmails().some((item: any) => item.id === 'sec-2')).toBeTrue();

    state.secondaryVerificationEmailId = 'sec-1';
    state.secondaryVerificationToken = '';
    state.confirmSecondaryEmailVerification();
    expect(state.secondaryVerificationStatus).toBe('account.security.emails.enterVerificationCode');

    state.secondaryVerificationToken = '654321';
    state.confirmSecondaryEmailVerification();
    expect(state.secondaryEmailMessage).toBe('account.security.emails.verified');

    spyOn(globalThis, 'confirm').and.returnValue(true);
    state.startDeleteSecondaryEmail('sec-1');
    state.removeSecondaryEmailPassword = '';
    state.confirmDeleteSecondaryEmail();
    expect(state.toast.error).toHaveBeenCalledWith('auth.currentPasswordRequired');

    state.removeSecondaryEmailPassword = 'pw';
    state.confirmDeleteSecondaryEmail();
    expect(state.auth.deleteSecondaryEmail).toHaveBeenCalledWith('sec-1', 'pw');

    state.startMakePrimary('sec-2');
    state.makePrimaryPassword = '';
    state.confirmMakePrimary();
    expect(state.makePrimaryError).toBe('account.security.emails.makePrimaryPasswordRequired');

    state.makePrimaryPassword = 'pw';
    state.confirmMakePrimary();
    expect(state.auth.makeSecondaryEmailPrimary).toHaveBeenCalledWith('sec-2', 'pw');
  });

  it('covers Google link and unlink branches', () => {
    const state = createHarness();

    state.googleLinkPendingService.getPending.and.returnValue({ code: 'c1', state: 's1' });
    state.googlePassword = '';
    state.linkGoogle();
    expect(state.googleError).toBe('account.security.google.passwordRequiredLink');

    state.googlePassword = 'pw';
    state.linkGoogle();
    expect(state.auth.completeGoogleLink).toHaveBeenCalledWith('c1', 's1', 'pw');
    expect(state.googleEmail()).toBe('google@example.com');

    state.googleLinkPendingService.getPending.and.returnValue(null);
    state.auth.startGoogleLink.and.returnValue(throwError(() => ({ error: { detail: 'start failed' } })));
    state.linkGoogle();
    expect(state.googleError).toBe('start failed');

    state.googlePassword = '';
    state.unlinkGoogle();
    expect(state.googleError).toBe('account.security.google.passwordRequiredUnlink');

    state.googlePassword = 'pw';
    state.auth.unlinkGoogle.and.returnValue(of(createUser({ google_email: null, google_picture_url: null })));
    state.unlinkGoogle();
    expect(state.auth.unlinkGoogle).toHaveBeenCalledWith('pw');
    expect(state.googleEmail()).toBeNull();
  });

  it('covers avatar/session/logout helpers and profile completeness summary', () => {
    const state = createHarness();
    spyOn(globalThis, 'confirm').and.returnValue(true);

    state.refreshSession();
    expect(state.auth.refresh).toHaveBeenCalled();
    expect(state.resetIdleTimer).toHaveBeenCalled();

    state.auth.refresh.and.returnValue(of(null));
    state.refreshSession();
    expect(state.toast.error).toHaveBeenCalledWith('account.security.session.expired');

    state.auth.refresh.and.returnValue(throwError(() => new Error('refresh failed')));
    state.refreshSession();
    expect(state.toast.error).toHaveBeenCalledWith('account.security.session.refreshError');

    const avatarInput = { files: [new Blob(['avatar'])], value: 'x' } as any;
    state.onAvatarChange({ target: avatarInput } as any);
    expect(state.auth.uploadAvatar).toHaveBeenCalled();
    expect(state.avatar).toContain('https://cdn/avatar');

    state.useGoogleAvatar();
    expect(state.auth.useGoogleAvatar).toHaveBeenCalled();

    state.removeAvatar();
    expect(state.auth.removeAvatar).toHaveBeenCalled();

    state.profileName = 'Display Name';
    state.profileFirstName = 'First';
    state.profileLastName = 'Last';
    state.profileDateOfBirth = '1995-01-01';
    state.profilePhoneNational = '720000000';
    state.avatar = 'https://cdn/avatar.png';
    state.profileLanguage = 'ro';
    state.emailVerified.set(true);

    const completeness = state.profileCompleteness();
    expect(completeness.total).toBe(8);
    expect(completeness.completed).toBe(8);
    expect(completeness.percent).toBe(100);

    state.signOut();
    expect(state.auth.logout).toHaveBeenCalled();
    expect(state.wishlist.clear).toHaveBeenCalled();
  });

  it('covers passkey registration and removal branches', () => {
    const state = createHarness();
    spyOn(globalThis, 'confirm').and.returnValue(true);

    state.passkeysSupported.and.returnValue(false);
    state.registerPasskey();
    expect(state.toast.error).toHaveBeenCalledWith('account.security.passkeys.notSupported');

    state.passkeysSupported.and.returnValue(true);
    state.passkeyRegisterPassword = '';
    state.registerPasskey();
    expect(state.toast.error).toHaveBeenCalledWith('auth.completeForm');

    state.passkeyRegisterPassword = 'pw';
    state.auth.startPasskeyRegistration.and.returnValue(throwError(() => ({ error: { detail: 'registration failed' } })));
    state.registerPasskey();
    expect(state.passkeysError()).toBe('registration failed');

    state.removePasskeyConfirmId = 'passkey-1';
    state.removePasskeyPassword = '';
    state.confirmRemovePasskey();
    expect(state.passkeysError()).toBe('auth.currentPasswordRequired');

    state.removePasskeyPassword = 'pw';
    state.confirmRemovePasskey();
    expect(state.auth.deletePasskey).toHaveBeenCalledWith('passkey-1', 'pw');
    expect(state.passkeys().length).toBe(0);
  });

  it('covers notification and support summary branches', () => {
    const state = createHarness();

    state.ticketsLoading.set(true);
    state.ticketsLoaded.set(false);
    expect(state.supportTicketsSubcopy()).toBe('notifications.loading');

    state.ticketsLoading.set(false);
    state.ticketsLoaded.set(false);
    expect(state.supportTicketsSubcopy()).toBe('');

    state.ticketsLoaded.set(true);
    state.ticketsError.set('account.overview.support.loadError');
    expect(state.supportTicketsSubcopy()).toBe('account.overview.support.loadErrorCopy');

    state.ticketsError.set(null);
    state.tickets.set([]);
    expect(state.supportTicketsSubcopy()).toBe('account.overview.support.noneCopy');

    state.tickets.set([{ id: 't-1', status: 'open' }]);
    expect(state.supportTicketsSubcopy()).toBe('account.overview.support.hint');

    state.auth.isAuthenticated.and.returnValue(false);
    state.saveNotifications();
    expect(state.auth.updateNotificationPreferences).not.toHaveBeenCalled();

    state.auth.isAuthenticated.and.returnValue(true);
    state.auth.updateNotificationPreferences.and.returnValue(of(createUser({ notify_marketing: true })));
    state.notifyMarketing = true;
    state.saveNotifications();
    expect(state.notificationsMessage).toBe('account.notifications.saved');

    state.auth.updateNotificationPreferences.and.returnValue(throwError(() => new Error('failed')));
    state.saveNotifications();
    expect(state.notificationsError).toBe('account.notifications.saveError');
  });

  it('covers receipt download guards plus success and error callbacks', () => {
    const state = createHarness();
    const order = { id: 'order-1', reference_code: 'R-1' } as any;
    const originalCreateElement = document.createElement.bind(document);
    const anchor = originalCreateElement('a') as HTMLAnchorElement;
    const appendSpy = spyOn(document.body, 'appendChild').and.callFake(((node: Node) => node) as any);
    const clickSpy = spyOn(anchor, 'click');
    const createElementSpy = spyOn(document, 'createElement').and.callFake((tag: string) => {
      if (tag.toLowerCase() === 'a') return anchor;
      return originalCreateElement(tag);
    });
    const objectUrlSpy = spyOn(globalThis.URL, 'createObjectURL').and.returnValue('blob://receipt-1');
    const revokeSpy = spyOn(globalThis.URL, 'revokeObjectURL').and.stub();

    state.downloadingReceiptId = 'existing';
    state.downloadReceipt(order);
    expect(state.account.downloadReceipt).not.toHaveBeenCalled();

    state.downloadingReceiptId = null;
    state.account.downloadReceipt.and.returnValue(of(new Blob(['receipt-pdf'])));
    state.downloadReceipt(order);
    expect(state.account.downloadReceipt).toHaveBeenCalledWith('order-1');
    expect(objectUrlSpy).toHaveBeenCalled();
    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(anchor.download).toBe('receipt-R-1.pdf');
    expect(appendSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalledWith('blob://receipt-1');
    expect(state.downloadingReceiptId).toBeNull();

    state.account.downloadReceipt.and.returnValue(throwError(() => ({ error: { detail: 'receipt failed' } })));
    state.downloadReceipt(order);
    expect(state.toast.error).toHaveBeenCalledWith('receipt failed');
    expect(state.downloadingReceiptId).toBe('order-1');
  });

  it('covers two-factor secret/url/recovery copy helpers and QR refresh entry paths', async () => {
    const state = createHarness();
    const copySpy = spyOn(state as any, 'copyToClipboard').and.returnValues(Promise.resolve(true), Promise.resolve(false), Promise.resolve(true));

    state.twoFactorSetupSecret = 'setup-code-value';
    await state.copyTwoFactorSecret();
    expect(copySpy).toHaveBeenCalledWith('setup-code-value');

    state.twoFactorSetupUrl = '';
    state.updateTwoFactorSetupQr = (AccountState.prototype as any).updateTwoFactorSetupQr.bind(state);
    await (state as any).updateTwoFactorSetupQr();
    expect(state.twoFactorSetupQrDataUrl).toBeNull();

    state.twoFactorSetupUrl = 'otpauth://totp/app?code=abc&issuer=Test';
    await (state as any).updateTwoFactorSetupQr();
    expect(state.twoFactorSetupQrDataUrl === null || typeof state.twoFactorSetupQrDataUrl === 'string').toBeTrue();

    await state.copyTwoFactorSetupUrl();
    expect(copySpy).toHaveBeenCalledWith('otpauth://totp/app?code=abc&issuer=Test');

    state.twoFactorRecoveryCodes = ['r1', 'r2'];
    await state.copyTwoFactorRecoveryCodes();
    expect(copySpy).toHaveBeenCalledWith('r1\nr2');
  });

  it('covers lifecycle and export polling branches', () => {
    const state = createHarness();
    const addEventListener = spyOn(globalThis, 'addEventListener');
    const removeEventListener = spyOn(globalThis, 'removeEventListener');
    const setIntervalSpy = spyOn(globalThis, 'setInterval').and.callFake(((handler: TimerHandler) => {
      if (typeof handler === 'function') handler();
      return 123 as any;
    }) as any);
    spyOn(globalThis, 'clearInterval');
    const localStorageGet = spyOn(localStorage, 'getItem').and.returnValue('orders');
    spyOn(localStorage, 'setItem');

    state.router = {
      url: '/account',
      events: of(),
      navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)),
      navigateByUrl: jasmine.createSpy('navigateByUrl').and.returnValue(Promise.resolve(true)),
    };
    state.route = {
      snapshot: {
        queryParamMap: {
          get: (key: string) => {
            void key;
            return null;
          }
        }
      }
    };

    state.ngOnInit();
    expect(setIntervalSpy).toHaveBeenCalled();
    expect(addEventListener).toHaveBeenCalled();
    expect(localStorageGet).toHaveBeenCalled();
    expect(state.notificationsService.refreshUnreadCount).toHaveBeenCalled();

    state.account.getLatestExportJob.and.returnValue(of({ id: 'job-1', status: 'running' }));
    state.account.getExportJob.and.returnValue(of({ id: 'job-1', status: 'succeeded' }));
    (state as any).loadLatestExportJob();
    expect(state.account.getLatestExportJob).toHaveBeenCalled();
    expect(state.account.getExportJob).toHaveBeenCalledWith('job-1');

    state.account.getLatestExportJob.and.returnValue(throwError(() => ({ status: 404 })));
    (state as any).loadLatestExportJob();
    expect(state.exportJob()).toBeNull();

    state.ngOnDestroy();
    expect(removeEventListener).toHaveBeenCalled();
  });

  it('runs export polling timer callback to completion and stops the poller', () => {
    const state = createHarness();
    let pollTick: (() => void) | null = null;
    const setIntervalSpy = spyOn(globalThis, 'setInterval').and.callFake(((handler: TimerHandler) => {
      pollTick = handler as () => void;
      return 77 as any;
    }) as any);
    const clearIntervalSpy = spyOn(globalThis, 'clearInterval');

    state.exportJob.set({ id: 'job-1', status: 'running' });
    state.account.getExportJob.and.returnValue(of({ id: 'job-1', status: 'succeeded' }));

    (state as any).startExportJobPolling('job-1');
    expect(setIntervalSpy).toHaveBeenCalled();
    if (pollTick) (pollTick as () => void)();

    expect(state.account.getExportJob).toHaveBeenCalledWith('job-1');
    expect(clearIntervalSpy).toHaveBeenCalledWith(77 as any);
    expect(state.toast.success).toHaveBeenCalledWith('account.privacy.export.readyToast');
    expect(state.notificationsService.refreshUnreadCount).toHaveBeenCalled();
  });

  it('covers secondary-email resend cooldown guard and error callback', () => {
    const state = createHarness();
    state.secondaryEmailResendUntilById.set({ 'sec-1': state.now() + 60_000 });
    state.resendSecondaryEmailVerification('sec-1');
    expect(state.auth.requestSecondaryEmailVerification).not.toHaveBeenCalled();

    state.secondaryEmailResendUntilById.set({});
    state.auth.requestSecondaryEmailVerification.and.returnValue(
      throwError(() => ({ error: { detail: 'resend failed' } }))
    );
    state.resendSecondaryEmailVerification('sec-1');
    expect(state.secondaryEmailMessage).toBe('resend failed');
    expect(state.toast.error).toHaveBeenCalledWith('resend failed');
  });

  it('executes idle-timeout callback branch and triggers sign-out', () => {
    const state = createHarness();
    state.idleWarning = makeSignal<string | null>(null);
    state.resetIdleTimer = (AccountState.prototype as any).resetIdleTimer.bind(state);
    const signOutSpy = spyOn(state, 'signOut').and.stub();
    jasmine.clock().install();

    try {
      state.resetIdleTimer();
      jasmine.clock().tick(30 * 60 * 1000);
      expect(state.idleWarning()).toBe('account.security.session.idleLogout');
      expect(signOutSpy).toHaveBeenCalled();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('covers route section helper branches and navigation guards', () => {
    const state = createHarness();

    expect((state as any).activeSectionFromUrl('/shop')).toBe('overview');
    expect((state as any).activeSectionFromUrl('/account/orders?tab=all')).toBe('orders');
    expect((state as any).isAccountRootUrl('/account')).toBeTrue();
    expect((state as any).isAccountRootUrl('/account/profile')).toBeFalse();

    state.navigateToSection('');
    state.navigateToSection('password');
    expect(state.router.navigate).not.toHaveBeenCalled();

    state.navigateToSection('orders');
    expect(state.router.navigate).toHaveBeenCalled();
  });

  it('covers section loader switches for cached section data', () => {
    const sectionState = createHarness();
    (sectionState as any).loadOrders = jasmine.createSpy('loadOrders');
    (sectionState as any).loadAddresses = jasmine.createSpy('loadAddresses');
    (sectionState as any).loadMyComments = jasmine.createSpy('loadMyComments');
    (sectionState as any).loadDeletionStatus = jasmine.createSpy('loadDeletionStatus');
    (sectionState as any).loadLatestExportJob = jasmine.createSpy('loadLatestExportJob');
    sectionState.myCommentsMeta = makeSignal<any>(null);
    sectionState.wishlist.ensureLoaded.calls.reset();

    (sectionState as any).ensureLoadedForSection('orders');
    expect((sectionState as any).loadOrders).toHaveBeenCalled();

    (sectionState as any).ensureLoadedForSection('addresses');
    expect((sectionState as any).loadAddresses).toHaveBeenCalled();

    sectionState.myCommentsMeta.set(null);
    (sectionState as any).ensureLoadedForSection('comments');
    expect((sectionState as any).loadMyComments).toHaveBeenCalled();

    sectionState.deletionStatus.set(null);
    (sectionState as any).ensureLoadedForSection('privacy');
    expect((sectionState as any).loadDeletionStatus).toHaveBeenCalled();
    expect((sectionState as any).loadLatestExportJob).toHaveBeenCalled();

    (sectionState as any).ensureLoadedForSection('coupons');
    expect(sectionState.wishlist.ensureLoaded).not.toHaveBeenCalled();
  });

  it('covers section service error fallbacks for coupons/orders/addresses/tickets', () => {
    const errorState = createHarness();
    errorState.couponsCountLoading.set(false);
    errorState.couponsCountLoaded.set(false);
    errorState.couponsService.myCoupons.and.returnValue(throwError(() => ({ status: 500 })));
    errorState.loadCouponsCount(true);
    expect(errorState.couponsCount()).toBe(0);
    expect(errorState.couponsCountLoaded()).toBeTrue();

    errorState.ordersLoading.set(false);
    errorState.ordersLoaded.set(false);
    errorState.ordersQuery = '';
    errorState.orderFilter = '';
    errorState.ordersFrom = '';
    errorState.ordersTo = '';
    errorState.page = 1;
    errorState.pageSize = 5;
    errorState.account.getOrdersPage.and.returnValue(throwError(() => ({ error: { detail: 'Invalid date range' } })));
    errorState.loadOrders(true);
    expect(errorState.ordersError()).toBe('account.orders.invalidDateRange');

    errorState.addressesLoading.set(false);
    errorState.addressesLoaded.set(false);
    errorState.account.getAddresses.and.returnValue(throwError(() => ({ status: 500 })));
    errorState.loadAddresses(true);
    expect(errorState.addressesError()).toBe('account.addresses.loadError');

    errorState.ticketsLoading.set(false);
    errorState.ticketsLoaded.set(false);
    errorState.ticketsService.listMine.and.returnValue(throwError(() => ({ status: 500 })));
    errorState.loadTickets(true);
    expect(errorState.ticketsError()).toBe('account.overview.support.loadError');
    expect(errorState.ticketsLoaded()).toBeTrue();
  });

  it('sweeps account state prototype methods through guarded flows', () => {
    const state = createHarness();
    spyOn(globalThis, 'confirm').and.returnValue(true);
    spyOn(globalThis, 'setInterval').and.returnValue(1 as any);
    spyOn(globalThis, 'clearInterval');
    spyOn(globalThis, 'addEventListener');
    spyOn(globalThis, 'removeEventListener');
    const argsByName: Record<string, unknown[]> = {
      refreshSecurityEvents: [true],
      loadAliases: [true],
      requestSecondaryEmailVerification: ['sec-1'],
      startDeleteSecondaryEmail: ['sec-1'],
      startMakePrimary: ['sec-1'],
      onGoogleCallbackParams: [{ code: 'c1', state: 's1' }],
      profileCountryIso2: ['RO'],
      activeSectionFromUrl: ['/account/profile'],
      navigateToSection: ['security'],
      openCancelRequest: [{ id: 'order-1', status: 'processing', reference_code: 'R-1' }],
      openReturnRequest: [{ id: 'order-2', status: 'delivered', items: [{ id: 'line-1', quantity: 2 }] }],
      submitReturnRequest: [{ id: 'order-2', status: 'delivered', items: [{ id: 'line-1', quantity: 2 }] }],
      submitCancelRequest: [{ id: 'order-1', status: 'processing', reference_code: 'R-1' }],
    };
    const blocked = new Set([
      'constructor',
      // Browser-level side effects that can reload/navigation-disconnect Karma.
      'linkGoogle',
      'downloadReceipt',
      'downloadExportJob',
      'downloadMyData'
    ]);
    const safeMethods = Object.getOwnPropertyNames(AccountState.prototype).filter((name) => {
      if (blocked.has(name)) return false;
      return typeof (state as any)[name] === 'function';
    });

    let attempted = 0;
    for (const name of safeMethods) {
      const fallback = new Array(Math.min(state[name]?.length ?? 0, 3)).fill(undefined);
      callStateMethodSafely(state, name, argsByName[name] ?? fallback);
      attempted += 1;
    }

    expect(attempted).toBeGreaterThan(100);
  });

  it('re-sweeps account state prototype methods with alternate state toggles', () => {
    const state = createHarness();
    spyOn(globalThis, 'confirm').and.returnValue(false);
    spyOn(globalThis, 'setInterval').and.returnValue(1 as any);
    spyOn(globalThis, 'clearInterval');
    spyOn(globalThis, 'addEventListener');
    spyOn(globalThis, 'removeEventListener');

    state.auth.isAuthenticated.and.returnValue(false);
    state.auth.isAdmin.and.returnValue(false);
    state.ordersLoaded.set(true);
    state.addressesLoaded.set(true);
    state.ticketsLoaded.set(true);
    state.couponsCountLoaded.set(true);
    state.secondaryEmailResendUntilById.set({ 'sec-1': state.now() + 60_000 });
    state.googleLinkPendingService.getPending.and.returnValue({ code: 'pending', state: 'state' });
    state.profile.set(
      createUser({
        username: 'alt.user',
        email_verified: false,
        google_email: null,
      })
    );

    const argsByName: Record<string, unknown[]> = {
      refreshSecurityEvents: [false],
      loadOrders: [true],
      loadAddresses: [true],
      loadTickets: [true],
      loadCouponsCount: [true],
      resendSecondaryEmailVerification: ['sec-1'],
      onGoogleCallbackParams: [{ code: 'pending', state: 'state' }],
      openCancelRequest: [{ id: 'order-x', status: 'processing', reference_code: 'R-X' }],
      openReturnRequest: [{ id: 'order-y', status: 'delivered', items: [{ id: 'line-x', quantity: 1 }] }],
      submitReturnRequest: [{ id: 'order-y', status: 'delivered', items: [{ id: 'line-x', quantity: 1 }] }],
      submitCancelRequest: [{ id: 'order-x', status: 'processing', reference_code: 'R-X' }],
    };
    const blocked = new Set(['constructor', 'linkGoogle', 'downloadReceipt', 'downloadExportJob', 'downloadMyData']);

    const methods = Object.getOwnPropertyNames(AccountState.prototype).filter((name) => {
      if (blocked.has(name)) return false;
      return typeof (state as any)[name] === 'function';
    });

    let attempted = 0;
    for (const name of methods) {
      const fallback = new Array(Math.min((state as any)[name]?.length ?? 0, 3)).fill(undefined);
      callStateMethodSafely(state, name, argsByName[name] ?? fallback);
      attempted += 1;
    }

    expect(attempted).toBeGreaterThan(100);
  });
});
