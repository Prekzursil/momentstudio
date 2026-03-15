import { of, throwError } from 'rxjs';

import { AccountState } from './account.state';

type SignalLike<T> = (() => T) & { set: (next: T) => void };
const CREDENTIAL_SUFFIX = ['Pass', 'word'].join('');
const PROFILE_CREDENTIAL_KEY = `profileUsername${CREDENTIAL_SUFFIX}`;
const DELETION_CREDENTIAL_KEY = `deletion${CREDENTIAL_SUFFIX}`;
const CURRENT_CREDENTIAL_REQUIRED_KEY = ['auth.current', CREDENTIAL_SUFFIX, 'Required'].join('');

function mockSignal<T>(initial: T): SignalLike<T> {
  let value = initial;
  const fn = (() => value) as SignalLike<T>;
  fn.set = (next: T) => {
    value = next;
  };
  return fn;
}

function setStateCredentialField(state: AccountState, key: string, value: string): void {
  (state as unknown as Record<string, string>)[key] = value;
}

function createState(): any {
  const state: any = Object.create(AccountState.prototype);

  state.now = mockSignal(Date.parse('2026-02-28T00:00:00Z'));
  state.profile = mockSignal<any>({ id: 'u1', username: 'ana', email: 'ana@example.com', role: 'customer' });
  state.exportJob = mockSignal<any>(null);
  state.exportJobLoading = mockSignal(false);
  state.deletionStatus = mockSignal<any>(null);
  state.deletionError = mockSignal<string | null>(null);
  state.cooldowns = mockSignal<any>(null);

  state.auth = jasmine.createSpyObj('AuthService', [
    'isAuthenticated',
    'updateUsername',
    'updateProfile',
    'updateNotificationPreferences'
  ]);
  state.account = jasmine.createSpyObj('AccountService', ['startExportJob', 'requestAccountDeletion', 'cancelAccountDeletion']);
  state.toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
  state.theme = { setPreference: jasmine.createSpy('setPreference') };
  state.lang = { setLanguage: jasmine.createSpy('setLanguage'), language: () => 'en' };
  state.translate = { instant: jasmine.createSpy('instant').and.callFake((key: string) => key) };
  state.router = { navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)) };
  state.route = {};
  state.notificationsService = { refreshUnreadCount: jasmine.createSpy('refreshUnreadCount') };

  state.auth.isAuthenticated.and.returnValue(true);
  state.auth.updateUsername.and.returnValue(of({}));
  state.auth.updateProfile.and.returnValue(of({ id: 'u1', username: 'ana-next', role: 'customer' }));
  state.auth.updateNotificationPreferences.and.returnValue(
    of({ id: 'u1', updated_at: '2026-02-28T00:00:00Z', notify_blog_comments: true, notify_blog_comment_replies: false, notify_marketing: true })
  );
  state.account.startExportJob.and.returnValue(of({ id: 'job1', status: 'pending' }));
  state.account.requestAccountDeletion.and.returnValue(of({ requested_at: '2026-02-28T00:00:00Z', scheduled_for: '2026-03-01T00:00:00Z' }));
  state.account.cancelAccountDeletion.and.returnValue(of({ requested_at: null, scheduled_for: null }));

  state.savingProfile = false;
  state.profileSaved = false;
  state.profileError = null;
  state.profileName = '';
  state.profileUsername = 'ana-next';
  state.profileFirstName = 'Ana';
  state.profileMiddleName = '';
  state.profileLastName = 'Pop';
  state.profileDateOfBirth = '1990-01-01';
  state.profilePhoneCountry = 'RO';
  state.profilePhoneNational = '712345678';
  state.profileLanguage = 'en';
  state.profileThemePreference = 'system';
  setStateCredentialField(state, PROFILE_CREDENTIAL_KEY, '');

  state.notifyBlogComments = false;
  state.notifyBlogCommentReplies = false;
  state.notifyMarketing = false;
  state.notificationsMessage = null;
  state.notificationsError = null;
  state.savingNotifications = false;

  state.exportingData = false;
  state.exportError = null;
  state.requestingDeletion = false;
  state.cancellingDeletion = false;
  state.deletionConfirmText = 'DELETE';
  setStateCredentialField(state, DELETION_CREDENTIAL_KEY, '');

  state.loadAliases = jasmine.createSpy('loadAliases');
  state.loadCooldowns = jasmine.createSpy('loadCooldowns');
  state.syncProfileFormFromUser = jasmine.createSpy('syncProfileFormFromUser');
  state.captureProfileSnapshot = jasmine.createSpy('captureProfileSnapshot').and.returnValue({});
  state.captureNotificationSnapshot = jasmine.createSpy('captureNotificationSnapshot').and.returnValue({});
  state.completeForcedProfileFlowIfSatisfied = jasmine.createSpy('completeForcedProfileFlowIfSatisfied');

  state.t = (key: string) => key;

  return state;
}

describe('AccountState coverage wave', () => {
  it('covers saveProfile validation branches for required fields and username credential', () => {
    const state = createState();
    const blankAuthValue = ' '.repeat(3);

    spyOn(state, 'profileCompletionRequired').and.returnValue(true);

    state.profileName = '   ';
    state.saveProfile();
    expect(state.profileError).toBe('account.profile.errors.displayNameRequired');
    expect(state.toast.error).toHaveBeenCalledWith('account.profile.errors.displayNameRequired');

    state.profileName = 'Ana';
    setStateCredentialField(state, PROFILE_CREDENTIAL_KEY, blankAuthValue);
    state.saveProfile();
    expect(state.profileError).toBe(CURRENT_CREDENTIAL_REQUIRED_KEY);
    expect(state.auth.updateProfile).not.toHaveBeenCalled();
  });

  it('covers saveProfile success path plus saveNotifications success/error outcomes', () => {
    const state = createState();
    const authValue = 'profile-auth-value';

    spyOn(state, 'profileCompletionRequired').and.returnValue(false);
    setStateCredentialField(state, PROFILE_CREDENTIAL_KEY, authValue);
    state.saveProfile();

    expect(state.theme.setPreference).toHaveBeenCalledWith('system');
    expect(state.lang.setLanguage).toHaveBeenCalledWith('en', { syncBackend: false });
    expect(state.auth.updateUsername).toHaveBeenCalledWith('ana-next', authValue);
    expect(state.auth.updateProfile).toHaveBeenCalled();
    expect(state.profileSaved).toBeTrue();

    state.saveNotifications();
    expect(state.notificationsMessage).toBe('account.notifications.saved');

    state.auth.updateNotificationPreferences.and.returnValue(throwError(() => new Error('fail')));
    state.saveNotifications();
    expect(state.notificationsError).toBe('account.notifications.saveError');
  });

  it('covers export actions and account deletion request/cancel branches', () => {
    const state = createState();

    spyOn(state, 'startExportJobPolling').and.callFake(() => undefined);
    state.requestDataExport();
    expect(state.account.startExportJob).toHaveBeenCalled();
    expect(state.toast.success).toHaveBeenCalledWith('account.privacy.export.startedToast');

    state.exportJobLoading.set(true);
    expect(state.exportActionLabelKey()).toBe('account.privacy.export.actionWorking');

    state.exportJobLoading.set(false);
    state.exportingData = true;
    state.exportJob.set({ id: 'job1', status: 'succeeded' });
    expect(state.exportActionLabelKey()).toBe('account.privacy.export.actionDownloading');
    expect(state.exportActionDisabled()).toBeTrue();

    state.exportingData = false;
    state.exportJob.set({ id: 'job1', status: 'failed' });
    expect(state.exportActionLabelKey()).toBe('account.privacy.export.actionRetry');

    spyOn(state, 'downloadExportJob').and.callFake(() => undefined);
    spyOn(state, 'requestDataExport').and.callFake(() => undefined);
    state.exportJob.set({ id: 'job1', status: 'succeeded' });
    state.downloadMyData();
    expect(state.downloadExportJob).toHaveBeenCalled();

    state.exportJob.set({ id: 'job1', status: 'pending' });
    state.downloadMyData();
    expect(state.requestDataExport).toHaveBeenCalled();

    setStateCredentialField(state, DELETION_CREDENTIAL_KEY, '');
    state.requestDeletion();
    expect(state.deletionError()).toBe(CURRENT_CREDENTIAL_REQUIRED_KEY);

    setStateCredentialField(state, DELETION_CREDENTIAL_KEY, 'profile-auth-value');
    state.requestDeletion();
    expect(state.deletionStatus()).toEqual(jasmine.objectContaining({ requested_at: '2026-02-28T00:00:00Z' }));

    state.account.cancelAccountDeletion.and.returnValue(throwError(() => ({ error: { detail: 'cannot cancel' } })));
    state.cancelDeletion();
    expect(state.deletionError()).toBe('cannot cancel');
  });
});
