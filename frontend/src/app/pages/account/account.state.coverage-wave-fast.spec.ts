import { AccountState } from './account.state';
import { of, throwError } from 'rxjs';

type SignalLike<T> = (() => T) & { set: (next: T) => void };

function mockSignal<T>(initial: T): SignalLike<T> {
  let value = initial;
  const fn = (() => value) as SignalLike<T>;
  fn.set = (next: T) => {
    value = next;
  };
  return fn;
}

function createAccountHarness(): any {
  const state: any = Object.create(AccountState.prototype);
  state.now = mockSignal(Date.parse('2026-03-03T00:00:00Z'));
  state.lastSectionStorageKey = 'account.lastSection';
  state.router = {
    url: '/account/overview',
    navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)),
  };
  state.route = {};
  state.translate = {
    instant: (key: string) => {
      const map: Record<string, string> = {
        'account.addresses.labels.home': 'Acasa',
        'account.addresses.labels.work': 'Serviciu',
        'account.addresses.labels.other': 'Altul',
      };
      return map[key] ?? key;
    },
  };

  state.stopExportJobPolling = jasmine.createSpy('stopExportJobPolling');
  state.loadCooldowns = jasmine.createSpy('loadCooldowns');
  state.loadAliases = jasmine.createSpy('loadAliases');
  state.loadOrders = jasmine.createSpy('loadOrders');
  state.loadAddresses = jasmine.createSpy('loadAddresses');
  state.loadSecondaryEmails = jasmine.createSpy('loadSecondaryEmails');
  state.loadSessions = jasmine.createSpy('loadSessions');
  state.loadSecurityEvents = jasmine.createSpy('loadSecurityEvents');
  state.loadTwoFactorStatus = jasmine.createSpy('loadTwoFactorStatus');
  state.loadPasskeys = jasmine.createSpy('loadPasskeys');
  state.loadMyComments = jasmine.createSpy('loadMyComments');
  state.loadDeletionStatus = jasmine.createSpy('loadDeletionStatus');
  state.loadLatestExportJob = jasmine.createSpy('loadLatestExportJob');
  state.loadTickets = jasmine.createSpy('loadTickets');
  state.wishlist = { ensureLoaded: jasmine.createSpy('ensureLoaded') };

  state.deletionStatus = mockSignal<any>(null);
  state.myCommentsMeta = mockSignal<any>(null);
  state.addressFormBaseline = null;
  state.addressModel = {
    label: 'home',
    line1: 'Main',
    line2: '',
    city: 'City',
    region: 'Region',
    postal_code: '12345',
    country: 'RO',
    phone: null,
    is_default_shipping: false,
    is_default_billing: false,
  };

  return state;
}

describe('AccountState fast URL and storage helpers', () => {
  it('extracts and normalizes account sections from URLs', () => {
    const state = createAccountHarness();

    expect(state.activeSectionFromUrl('/account/security?tab=2#anchor')).toBe('security');
    expect(state.activeSectionFromUrl('/shop')).toBe('overview');
    expect(state.isAccountRootUrl('/account')).toBeTrue();
    expect(state.isAccountRootUrl('/account/orders')).toBeFalse();
  });

  it('maps password section to security for navigation label', () => {
    const state = createAccountHarness();
    state.router.url = '/account/password';

    expect(state.navigationSection()).toBe('security');
  });

  it('reads and stores last visited section with safe fallbacks', () => {
    const state = createAccountHarness();
    const getSpy = spyOn(localStorage, 'getItem').and.returnValue(' wishlist ');
    const setSpy = spyOn(localStorage, 'setItem');

    expect(state.lastVisitedSection()).toBe('wishlist');
    expect(getSpy).toHaveBeenCalledWith('account.lastSection');

    state.rememberLastVisitedSection('orders');
    expect(setSpy).toHaveBeenCalledWith('account.lastSection', 'orders');

    setSpy.calls.reset();
    state.rememberLastVisitedSection('password');
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('falls back to overview when storage read throws or value is invalid', () => {
    const state = createAccountHarness();
    spyOn(localStorage, 'getItem').and.returnValue('unknown-section');
    expect(state.lastVisitedSection()).toBe('overview');

    (localStorage.getItem as jasmine.Spy).and.throwError('storage-failed');
    expect(state.lastVisitedSection()).toBe('overview');
  });
});

describe('AccountState fast coupon and time helpers', () => {
  it('normalizes preferred language and coupon date boundary parsing', () => {
    const state = createAccountHarness();

    expect(state.normalizePreferredLanguage('ro')).toBe('ro');
    expect(state.normalizePreferredLanguage('en')).toBe('en');
    expect(state.normalizePreferredLanguage(null)).toBe('en');

    expect(state.parseCouponDateBoundary(undefined)).toBeNull();
    expect(state.parseCouponDateBoundary('not-a-date')).toBeNull();
    expect(state.parseCouponDateBoundary('2026-03-05T10:00:00Z')).toBe(Date.parse('2026-03-05T10:00:00Z'));
  });

  it('evaluates coupon availability against active flags and date boundaries', () => {
    const state = createAccountHarness();
    const now = Date.parse('2026-03-03T12:00:00Z');

    expect(state.isCouponAvailableAt(null, now)).toBeFalse();
    expect(state.isCouponAvailableAt({ is_active: false }, now)).toBeFalse();
    expect(state.isCouponAvailableAt({ is_active: true, promotion: { is_active: false } }, now)).toBeFalse();

    expect(
      state.isCouponAvailableAt(
        { is_active: true, starts_at: '2026-03-04T12:00:00Z', ends_at: null },
        now
      )
    ).toBeFalse();

    expect(
      state.isCouponAvailableAt(
        { is_active: true, starts_at: null, ends_at: '2026-03-02T12:00:00Z' },
        now
      )
    ).toBeFalse();

    expect(
      state.isCouponAvailableAt(
        { is_active: true, starts_at: '2026-03-01T12:00:00Z', ends_at: '2026-03-05T12:00:00Z' },
        now
      )
    ).toBeTrue();
  });
});

describe('AccountState fast coupon counting and timestamp helpers', () => {
  it('counts available coupons using current time', () => {
    const state = createAccountHarness();
    spyOn(Date, 'now').and.returnValue(Date.parse('2026-03-03T12:00:00Z'));

    const count = state.countAvailableCoupons([
      { is_active: true, starts_at: '2026-03-02T12:00:00Z', ends_at: '2026-03-04T12:00:00Z' },
      { is_active: true, starts_at: '2026-03-04T12:00:00Z', ends_at: null },
      { is_active: false },
    ]);

    expect(count).toBe(1);
  });

  it('computes cooldown and timestamp parsing helpers', () => {
    const state = createAccountHarness();

    expect(state.cooldownRemainingSeconds(undefined)).toBe(0);
    expect(state.cooldownRemainingSeconds({ next_allowed_at: 'invalid' })).toBe(0);
    expect(state.cooldownRemainingSeconds({ next_allowed_at: '2026-03-03T00:00:05Z' })).toBe(5);

    expect(state.parseTimestampMs('2026-03-03T00:00:10Z')).toBe(Date.parse('2026-03-03T00:00:10Z'));
    expect(state.parseTimestampMs('bad-date')).toBeNull();
    expect(state.parseTimestampMs(null)).toBeNull();
  });
});

describe('AccountState fast address and section loaders', () => {
  it('normalizes semantic address labels with translation-aware aliases', () => {
    const state = createAccountHarness();

    expect(state.normalizeAddressLabel('')).toBe('home');
    expect(state.normalizeAddressLabel('WORK')).toBe('work');
    expect(state.normalizeAddressLabel('Acasa')).toBe('home');
    expect(state.normalizeAddressLabel('Serviciu')).toBe('work');
    expect(state.normalizeAddressLabel('Altul')).toBe('other');
    expect(state.normalizeAddressLabel('Custom Label')).toBe('Custom Label');
  });
});

describe('AccountState fast snapshot helpers', () => {
  it('normalizes and compares address snapshots', () => {
    const state = createAccountHarness();
    const left = {
      label: ' Home ',
      line1: ' Main ',
      line2: ' Apt ',
      city: ' Bucharest ',
      region: ' B ',
      postal_code: ' 010101 ',
      country: ' RO ',
      phone: ' +40123 ',
      is_default_shipping: 1,
      is_default_billing: 0,
    };
    const right = {
      label: 'Home',
      line1: 'Main',
      line2: 'Apt',
      city: 'Bucharest',
      region: 'B',
      postal_code: '010101',
      country: 'RO',
      phone: '+40123',
      is_default_shipping: true,
      is_default_billing: false,
    };

    expect(state.sameAddressSnapshot(left, right)).toBeTrue();

    const different = { ...right, city: 'Cluj' };
    expect(state.sameAddressSnapshot(left, different)).toBeFalse();
  });
});

describe('AccountState fast section dispatch helpers', () => {
  it('routes section-dependent lazy loads through ensureLoadedForSection', () => {
    const state = createAccountHarness();

    state.ensureLoadedForSection('profile');
    expect(state.loadCooldowns).toHaveBeenCalled();
    expect(state.loadAliases).toHaveBeenCalled();

    state.ensureLoadedForSection('security');
    expect(state.loadSecondaryEmails).toHaveBeenCalled();
    expect(state.loadSessions).toHaveBeenCalled();
    expect(state.loadSecurityEvents).toHaveBeenCalled();
    expect(state.loadTwoFactorStatus).toHaveBeenCalled();
    expect(state.loadPasskeys).toHaveBeenCalled();

    state.ensureLoadedForSection('comments');
    expect(state.loadMyComments).toHaveBeenCalled();

    state.ensureLoadedForSection('privacy');
    expect(state.loadDeletionStatus).toHaveBeenCalled();
    expect(state.loadLatestExportJob).toHaveBeenCalled();

    state.ensureLoadedForSection('overview');
    expect(state.loadOrders).toHaveBeenCalled();
    expect(state.loadAddresses).toHaveBeenCalled();
    expect(state.loadTickets).toHaveBeenCalled();
    expect(state.wishlist.ensureLoaded).toHaveBeenCalled();
  });
});

describe('AccountState fast navigation and formatting helpers', () => {
  it('navigates only to allowed sections', () => {
    const state = createAccountHarness();

    state.navigateToSection(' ');
    state.navigateToSection('password');
    expect(state.router.navigate).not.toHaveBeenCalled();

    state.navigateToSection('overview');
    expect(state.router.navigate).toHaveBeenCalledWith(['overview'], { relativeTo: state.route });

    state.router.navigate.calls.reset();
    state.navigateToSection('orders');
    expect(state.router.navigate).toHaveBeenCalledWith(['orders'], { relativeTo: state.route });
  });

  it('formats cooldown values across empty/day/minute/second branches', () => {
    const state = createAccountHarness();

    expect(state.formatCooldown(0)).toBe('');
    expect(state.formatCooldown(90_061)).toBe('1d 1h');
    expect(state.formatCooldown(3_661)).toBe('1h 1m');
    expect(state.formatCooldown(125)).toBe('2m 5s');
    expect(state.formatCooldown(5)).toBe('5s');
  });

  it('formats short durations across hour/minute/second branches', () => {
    const state = createAccountHarness();

    expect(state.formatDurationShort(3_700_000)).toBe('1h 1m');
    expect(state.formatDurationShort(125_000)).toBe('2m 5s');
    expect(state.formatDurationShort(5_000)).toBe('5s');
    expect(state.formatDurationShort(-200)).toBe('0s');
  });
});

describe('AccountState fast privacy section branch', () => {
  it('keeps export polling active on privacy and skips deletion reload when already loaded', () => {
    const state = createAccountHarness();
    state.deletionStatus.set({ status: 'requested' });

    state.ensureLoadedForSection('privacy');

    expect(state.stopExportJobPolling).not.toHaveBeenCalled();
    expect(state.loadDeletionStatus).not.toHaveBeenCalled();
    expect(state.loadLatestExportJob).toHaveBeenCalled();
  });
});

describe('AccountState fast address unsaved-change branch', () => {
  it('reports address unsaved-change states for hidden form and baseline deltas', () => {
    const state = createAccountHarness();
    state.showAddressForm = false;
    expect(state.addressesHasUnsavedChanges()).toBeFalse();

    state.showAddressForm = true;
    state.addressFormBaseline = null;
    expect(state.addressesHasUnsavedChanges()).toBeTrue();

    state.addressFormBaseline = {
      label: 'home',
      line1: 'Main',
      line2: '',
      city: 'City',
      region: 'Region',
      postal_code: '12345',
      country: 'RO',
      phone: null,
      is_default_shipping: false,
      is_default_billing: false,
    };
    expect(state.addressesHasUnsavedChanges()).toBeFalse();

    state.addressModel.city = 'Cluj';
    expect(state.addressesHasUnsavedChanges()).toBeTrue();
  });
});

describe('AccountState fast notification unsaved-change branch', () => {
  it('reports notification unsaved-change status based on baseline presence and toggles', () => {
    const state = createAccountHarness();
    state.notifyBlogComments = false;
    state.notifyBlogCommentReplies = false;
    state.notifyMarketing = false;
    state.notificationsBaseline = null;
    expect(state.notificationsHasUnsavedChanges()).toBeFalse();

    state.notificationsBaseline = {
      notifyBlogComments: false,
      notifyBlogCommentReplies: false,
      notifyMarketing: false,
    };
    expect(state.notificationsHasUnsavedChanges()).toBeFalse();

    state.notifyMarketing = true;
    expect(state.notificationsHasUnsavedChanges()).toBeTrue();
  });
});

describe('AccountState fast comments and security loaders', () => {
  function primeAsyncSignals(state: any): void {
    state.myCommentsLoading = mockSignal(false);
    state.myCommentsError = mockSignal<string | null>(null);
    state.myComments = mockSignal<any[]>([]);
    state.myCommentsMeta = mockSignal<any>(null);
    state.secondaryEmailsLoading = mockSignal(false);
    state.secondaryEmailsLoaded = mockSignal(false);
    state.secondaryEmailsError = mockSignal<string | null>(null);
    state.secondaryEmails = mockSignal<any[]>([]);
    state.sessionsLoading = mockSignal(false);
    state.sessionsLoaded = mockSignal(false);
    state.sessionsError = mockSignal<string | null>(null);
    state.sessions = mockSignal<any[]>([]);
    state.securityEventsLoading = mockSignal(false);
    state.securityEventsLoaded = mockSignal(false);
    state.securityEventsError = mockSignal<string | null>(null);
    state.securityEvents = mockSignal<any[]>([]);
    state.twoFactorLoading = mockSignal(false);
    state.twoFactorLoaded = mockSignal(false);
    state.twoFactorError = mockSignal<string | null>(null);
    state.twoFactorStatus = mockSignal<any>(null);
  }

  it('loads my comments and paginates forward/backward', () => {
    const state = createAccountHarness();
    primeAsyncSignals(state);
    state.auth = { isAuthenticated: () => true };
    state.lang = { language: () => 'en' };
    state.blog = {
      listMyComments: jasmine.createSpy('listMyComments').and.returnValue(
        of({
          items: [{ id: 'c1' }],
          meta: { page: 2, total_pages: 3 },
        })
      ),
    };
    state.loadMyComments = (AccountState.prototype as any).loadMyComments;
    const loadMyCommentsSpy = spyOn(state, 'loadMyComments').and.callThrough();

    state.loadMyComments(2);
    expect(state.myComments().length).toBe(1);
    expect(state.myCommentsMeta().page).toBe(2);
    expect(state.myCommentsPage).toBe(2);
    expect(state.myCommentsLoading()).toBeFalse();

    state.nextMyCommentsPage();
    expect(loadMyCommentsSpy).toHaveBeenCalledWith(3);

    state.myCommentsMeta.set({ page: 2, total_pages: 3 });
    state.prevMyCommentsPage();
    expect(loadMyCommentsSpy).toHaveBeenCalledWith(1);
  });

  it('handles my comments load errors and status chip/timestamp fallbacks', () => {
    const state = createAccountHarness();
    primeAsyncSignals(state);
    state.auth = { isAuthenticated: () => true };
    state.lang = { language: () => 'ro' };
    state.blog = {
      listMyComments: jasmine.createSpy('listMyComments').and.returnValue(
        throwError(() => ({ error: { detail: 'fail' } }))
      ),
    };

    state.t = (key: string) => key;
    state.myCommentsLimit = 10;
    state.loadMyComments = (AccountState.prototype as any).loadMyComments;
    state.loadMyComments(1);
    expect(state.myCommentsError()).toContain('account.comments.loadError');
    expect(state.myCommentsLoading()).toBeFalse();
    expect(state.commentStatusChipClass('posted')).toContain('emerald');
    expect(state.commentStatusChipClass('hidden')).toContain('amber');
    expect(state.commentStatusChipClass('deleted')).toContain('slate');
    expect(state.commentStatusChipClass('other')).toContain('slate');
    expect(state.formatTimestamp(null)).toBe('');
    expect(typeof state.formatTimestamp('2026-03-03T00:00:00Z')).toBe('string');
  });

  it('loads security side resources and records error states', () => {
    const state = createAccountHarness();
    primeAsyncSignals(state);
    state.auth = {
      isAuthenticated: () => true,
      listEmails: jasmine.createSpy('listEmails').and.returnValue(throwError(() => new Error('email-fail'))),
      listSessions: jasmine.createSpy('listSessions').and.returnValue(throwError(() => new Error('sessions-fail'))),
      listSecurityEvents: jasmine.createSpy('listSecurityEvents').and.returnValue(throwError(() => new Error('events-fail'))),
      getTwoFactorStatus: jasmine.createSpy('getTwoFactorStatus').and.returnValue(throwError(() => new Error('2fa-fail'))),
    };
    spyOn(state, 'passkeysSupported').and.returnValue(true);
    state.t = (key: string) => key;
    state.loadSecondaryEmails = (AccountState.prototype as any).loadSecondaryEmails;
    state.loadSessions = (AccountState.prototype as any).loadSessions;
    state.loadSecurityEvents = (AccountState.prototype as any).loadSecurityEvents;
    state.loadTwoFactorStatus = (AccountState.prototype as any).loadTwoFactorStatus;
    state.loadSecondaryEmails(true);
    state.loadSessions(true);
    state.loadSecurityEvents(true);
    state.loadTwoFactorStatus(true);

    expect(state.secondaryEmailsError()).toContain('account.security.emails.loadError');
    expect(state.sessionsError()).toContain('account.security.devices.loadError');
    expect(state.securityEventsError()).toContain('account.security.activity.loadError');
    expect(state.twoFactorError()).toContain('account.security.twoFactor.loadError');
    expect(state.twoFactorLoaded()).toBeTrue();
  });
});

describe('AccountState fast idle and destroy branches', () => {
  it('resets idle timer and triggers warning/signout callback', () => {
    const state = createAccountHarness();
    state.idleWarning = mockSignal<string | null>('old-warning');
    state.idleTimer = 111;
    state.signOut = jasmine.createSpy('signOut');
    state.t = (key: string) => key;
    const clearTimeoutSpy = spyOn(globalThis, 'clearTimeout').and.stub();
    const setTimeoutSpy = spyOn(globalThis, 'setTimeout').and.callFake(((fn: unknown) => {
      if (typeof fn === 'function') fn();
      return 222 as any;
    }) as any);

    state.resetIdleTimer();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(111);
    expect(setTimeoutSpy).toHaveBeenCalled();
    expect(state.idleWarning()).toContain('account.security.session.idleLogout');
    expect(state.signOut).toHaveBeenCalled();
  });

  it('cleans subscriptions/effects/listeners on destroy', () => {
    const state = createAccountHarness();
    state.nowInterval = 100;
    state.idleTimer = 200;
    state.routerEventsSub = { unsubscribe: jasmine.createSpy('unsubscribe') };
    state.phoneCountriesEffect = { destroy: jasmine.createSpy('destroy') };
    state.handleUserActivity = () => undefined;
    state.handleBeforeUnload = () => undefined;
    const clearIntervalSpy = spyOn(globalThis, 'clearInterval').and.stub();
    const clearTimeoutSpy = spyOn(globalThis, 'clearTimeout').and.stub();
    const removeSpy = spyOn(globalThis, 'removeEventListener').and.stub();

    state.ngOnDestroy();
    expect(clearIntervalSpy).toHaveBeenCalledWith(100);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(200);
    expect(state.stopExportJobPolling).toHaveBeenCalled();
    expect(state.routerEventsSub.unsubscribe).toHaveBeenCalled();
    expect(state.phoneCountriesEffect.destroy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
  });
});

describe('AccountState fast profile-save and completion branches', () => {
  function primeProfile(state: any) {
    state.profile = mockSignal({
      id: 'user-1',
      username: 'existing-user',
      name: 'Existing Name',
      email: 'user@example.com',
      email_verified: true,
      google_sub: 'google-user',
      avatar_url: null,
    });
    state.auth = {
      isAuthenticated: () => true,
      updateUsername: jasmine.createSpy('updateUsername').and.returnValue(of(null)),
      updateProfile: jasmine.createSpy('updateProfile').and.returnValue(
        of({
          id: 'user-1',
          username: 'new-user',
          name: 'Updated Name',
          email: 'user@example.com',
          email_verified: true,
          google_sub: 'google-user',
          avatar_url: null,
        })
      ),
    };
    state.theme = { setPreference: jasmine.createSpy('setPreference') };
    state.lang = { setLanguage: jasmine.createSpy('setLanguage') };
    state.toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    state.translate = { instant: (key: string) => key };
    state.t = (key: string) => key;
    state.captureProfileSnapshot = jasmine.createSpy('captureProfileSnapshot').and.returnValue({ username: 'new-user' });
    state.syncProfileFormFromUser = jasmine.createSpy('syncProfileFormFromUser');
    state.completeForcedProfileFlowIfSatisfied = jasmine.createSpy('completeForcedProfileFlowIfSatisfied');
    state.loadAliases = jasmine.createSpy('loadAliases');
    state.loadCooldowns = jasmine.createSpy('loadCooldowns');
    state.profileThemePreference = 'system';
    state.profileLanguage = 'en';
    state.profileSaved = false;
    state.profileError = null;
    state.savingProfile = false;
  }

  it('covers required-profile validation and username-password guard branches', () => {
    const state = createAccountHarness();
    primeProfile(state);
    state.forceProfileCompletion = true;

    state.profileName = '';
    state.profileUsername = 'valid_user';
    state.profileFirstName = 'First';
    state.profileMiddleName = '';
    state.profileLastName = 'Last';
    state.profileDateOfBirth = '2000-01-01';
    state.profilePhoneCountry = 'RO';
    state.profilePhoneNational = '0712345678';
    state.profileUsernamePassword = '';

    state.saveProfile();
    expect(state.profileError).toContain('account.profile.errors.displayNameRequired');
    expect(state.savingProfile).toBeFalse();

    state.profileName = 'Display';
    state.profileUsername = 'new-user';
    state.profileFirstName = 'First';
    state.profileLastName = 'Last';
    state.profileDateOfBirth = '2000-01-01';
    state.profilePhoneNational = '0712345678';
    state.profileUsernamePassword = '';
    state.saveProfile();
    expect(state.profileError).toContain('auth.currentPasswordRequired');
    expect(state.auth.updateUsername).not.toHaveBeenCalled();
  });

  it('covers profile save success path and forced-profile completion navigation', () => {
    const state = createAccountHarness();
    primeProfile(state);
    state.forceProfileCompletion = true;
    state.router = {
      ...state.router,
      navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)),
    };

    state.profileName = 'Updated Name';
    state.profileUsername = 'new-user';
    state.profileFirstName = 'First';
    state.profileMiddleName = '';
    state.profileLastName = 'Last';
    state.profileDateOfBirth = '2000-01-01';
    state.profilePhoneCountry = 'RO';
    state.profilePhoneNational = '0712345678';
    state.profileUsernamePassword = 'current-password';

    state.saveProfile();
    expect(state.theme.setPreference).toHaveBeenCalledWith('system');
    expect(state.lang.setLanguage).toHaveBeenCalledWith('en', { syncBackend: false });
    expect(state.auth.updateUsername).toHaveBeenCalledWith('new-user', 'current-password');
    expect(state.auth.updateProfile).toHaveBeenCalled();
    expect(state.profileSaved).toBeTrue();
    expect(state.loadAliases).toHaveBeenCalledWith(true);
    expect(state.loadCooldowns).toHaveBeenCalledWith(true);
    expect(state.completeForcedProfileFlowIfSatisfied).toHaveBeenCalled();

    const completionState = createAccountHarness();
    completionState.forceProfileCompletion = true;
    completionState.router = {
      ...completionState.router,
      navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)),
    };
    completionState.route = {};
    completionState.completeForcedProfileFlowIfSatisfied = (AccountState.prototype as any).completeForcedProfileFlowIfSatisfied;
    completionState.completeForcedProfileFlowIfSatisfied.call(completionState, {
      id: 'user-1',
      username: 'new-user',
      name: 'Updated Name',
      email: 'user@example.com',
      email_verified: true,
      first_name: 'First',
      last_name: 'Last',
      date_of_birth: '2000-01-01',
      phone: '+40712345678',
      google_sub: 'google-user',
    });
    expect(completionState.router.navigate).toHaveBeenCalled();
  });

  it('covers alias/cooldown load success branches and guards', () => {
    const state = createAccountHarness();
    primeProfile(state);
    state.aliasesLoading = mockSignal(false);
    state.aliasesError = mockSignal<string | null>(null);
    state.aliases = mockSignal<any>(null);
    state.cooldownsLoading = mockSignal(false);
    state.cooldownsError = mockSignal<string | null>(null);
    state.cooldownsLoaded = mockSignal(false);
    state.cooldowns = mockSignal<any>(null);

    state.auth.getAliases = jasmine.createSpy('getAliases').and.returnValue(of({ aliases: [{ email: 'alt@example.com' }] }));
    state.auth.getCooldowns = jasmine.createSpy('getCooldowns').and.returnValue(
      of({
        username: { next_allowed_at: '2026-03-03T00:00:05Z' },
      })
    );

    state.t = (key: string) => key;
    state.loadAliases = (AccountState.prototype as any).loadAliases;
    state.loadCooldowns = (AccountState.prototype as any).loadCooldowns;

    state.loadAliases();
    expect(state.aliases()?.aliases?.length).toBe(1);
    expect(state.aliasesLoading()).toBeFalse();

    state.loadCooldowns();
    expect(state.cooldownsLoaded()).toBeTrue();
    expect(state.cooldowns()?.username?.next_allowed_at).toContain('2026-03-03');
    expect(state.cooldownsLoading()).toBeFalse();
  });
});


describe('AccountState fast export/passkey branches', () => {
  it('covers requestDataExport running path and start-error fallback', () => {
    const state = createAccountHarness();
    state.t = (key: string) => key;
    state.auth = { isAuthenticated: () => true };
    state.toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);
    state.account = {
      startExportJob: jasmine.createSpy('startExportJob').and.returnValue(of({ id: 'job-1', status: 'running' })),
      downloadExportJob: jasmine.createSpy('downloadExportJob')
    };
    state.exportJobLoading = mockSignal(false);
    state.exportJob = mockSignal<any>(null);
    state.exportingData = false;
    state.exportError = null;
    state.startExportJobPolling = jasmine.createSpy('startExportJobPolling');
    state.requestDataExport = (AccountState.prototype as any).requestDataExport;

    state.requestDataExport();
    expect(state.startExportJobPolling).toHaveBeenCalledWith('job-1');
    expect(state.toast.success).toHaveBeenCalledWith('account.privacy.export.startedToast');
    expect(state.exportJobLoading()).toBeFalse();

    state.account.startExportJob.and.returnValue(throwError(() => ({ error: { detail: 'start-failed' } })));
    state.requestDataExport();
    expect(state.exportError).toBe('start-failed');
    expect(state.toast.error).toHaveBeenCalledWith('start-failed');
    expect(state.exportJobLoading()).toBeFalse();
  });

  it('covers downloadExportJob success and error branches', () => {
    const state = createAccountHarness();
    const anchor = { href: '', download: '', click: jasmine.createSpy('click') } as any;
    const createUrl = (window.URL as any).createObjectURL ?? (() => 'blob:mock');
    const revokeUrl = (window.URL as any).revokeObjectURL ?? (() => undefined);
    if (!(window.URL as any).createObjectURL) {
      (window.URL as any).createObjectURL = createUrl;
    }
    if (!(window.URL as any).revokeObjectURL) {
      (window.URL as any).revokeObjectURL = revokeUrl;
    }
    const createSpy = spyOn(window.URL as any, 'createObjectURL').and.returnValue('blob:test');
    const revokeSpy = spyOn(window.URL as any, 'revokeObjectURL').and.stub();
    spyOn(document, 'createElement').and.returnValue(anchor);

    state.t = (key: string) => key;
    state.auth = { isAuthenticated: () => true };
    state.toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);
    state.account = {
      startExportJob: jasmine.createSpy('startExportJob'),
      downloadExportJob: jasmine.createSpy('downloadExportJob').and.returnValue(of(new Blob(['{"ok":true}'])))
    };
    state.exportingData = false;
    state.exportError = null;
    state.exportJob = mockSignal<any>({ id: 'job-succeeded', status: 'succeeded' });
    state.downloadExportJob = (AccountState.prototype as any).downloadExportJob;

    state.downloadExportJob();
    expect(state.account.downloadExportJob).toHaveBeenCalledWith('job-succeeded');
    expect(createSpy).toHaveBeenCalled();
    expect(anchor.click).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalledWith('blob:test');
    expect(state.toast.success).toHaveBeenCalledWith('account.privacy.export.downloaded');
    expect(state.exportingData).toBeFalse();

    state.account.downloadExportJob.and.returnValue(throwError(() => ({ error: { detail: 'download-failed' } })));
    state.downloadExportJob();
    expect(state.exportError).toBe('download-failed');
    expect(state.toast.error).toHaveBeenCalledWith('download-failed');
    expect(state.exportingData).toBeTrue();
  });

  it('covers copyReceiptUrl timer branch and fallback toast branch', async () => {
    const state = createAccountHarness();
    state.t = (key: string) => key;
    state.toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);
    state.receiptCopiedId = mockSignal<string | null>(null);
    state.receiptCopiedTimer = 321;

    const clearSpy = spyOn(window, 'clearTimeout').and.stub();
    const setSpy = spyOn(window, 'setTimeout').and.callFake(((fn: unknown) => {
      if (typeof fn === 'function') fn();
      return 654 as any;
    }) as any);

    state.copyToClipboard = jasmine.createSpy('copyToClipboard').and.resolveTo(true);
    await (AccountState.prototype as any).copyReceiptUrl.call(state, 'order-1', 'https://share.example', 'account.orders.receiptReady');
    expect(state.copyToClipboard).toHaveBeenCalledWith('https://share.example');
    expect(clearSpy).toHaveBeenCalledWith(321);
    expect(setSpy).toHaveBeenCalled();
    expect(state.toast.success).toHaveBeenCalledWith('account.orders.receiptCopied');

    state.toast.success.calls.reset();
    state.copyToClipboard.and.resolveTo(false);
    await (AccountState.prototype as any).copyReceiptUrl.call(state, 'order-2', 'https://share2.example', 'account.orders.receiptReady');
    expect(state.toast.success).toHaveBeenCalledWith('account.orders.receiptReady');
  });

  it('covers registerPasskey success, empty credential, and cancellation branches', async () => {
    const state = createAccountHarness();
    state.t = (key: string) => key;
    state.passkeysSupported = jasmine.createSpy('passkeysSupported').and.returnValue(true);
    state.auth = {
      isAuthenticated: () => true,
      startPasskeyRegistration: jasmine
        .createSpy('startPasskeyRegistration')
        .and.returnValue(
          of({
            options: {
              challenge: 'AQI',
              user: { id: 'AQI', name: 'user@example.com', displayName: 'User' },
              rp: { id: 'momentstudio.test', name: 'MomentStudio' },
              pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
              timeout: 60000,
              excludeCredentials: []
            },
            registration_token: 'reg-token'
          })
        ),
      completePasskeyRegistration: jasmine.createSpy('completePasskeyRegistration').and.returnValue(of({}))
    };
    state.toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);
    state.passkeysError = mockSignal<string | null>(null);
    state.passkeys = mockSignal<any[]>([]);
    state.registeringPasskey = false;
    state.passkeyRegisterPassword = 'password-1';
    state.passkeyRegisterName = 'Laptop key';
    state.loadPasskeys = jasmine.createSpy('loadPasskeys');
    state.refreshSecurityEvents = jasmine.createSpy('refreshSecurityEvents');
    state.registerPasskey = (AccountState.prototype as any).registerPasskey;

    const fakeCredential = {
      id: 'cred-1',
      rawId: new Uint8Array([1, 2, 3]).buffer,
      type: 'public-key',
      response: {
        clientDataJSON: new Uint8Array([1]).buffer,
        attestationObject: new Uint8Array([2]).buffer,
      },
      getClientExtensionResults: () => ({})
    } as any;

    const credentialsCreate = jasmine.createSpy('credentials.create').and.resolveTo(fakeCredential);
    spyOnProperty(navigator, 'credentials', 'get').and.returnValue({ create: credentialsCreate } as any);

    state.registerPasskey();
    await Promise.resolve();
    await Promise.resolve();
    expect(state.auth.startPasskeyRegistration).toHaveBeenCalledWith('password-1');
    expect(credentialsCreate).toHaveBeenCalled();
    expect(state.auth.completePasskeyRegistration).toHaveBeenCalled();
    expect(state.toast.success).toHaveBeenCalledWith('account.security.passkeys.added');
    expect(state.loadPasskeys).toHaveBeenCalledWith(true);
    expect(state.refreshSecurityEvents).toHaveBeenCalled();

    state.toast.info.calls.reset();
    credentialsCreate.and.resolveTo(null);
    state.registerPasskey();
    await Promise.resolve();
    await Promise.resolve();
    expect(state.registeringPasskey).toBeFalse();

    credentialsCreate.and.rejectWith({ name: 'NotAllowedError' });
    state.registerPasskey();
    await Promise.resolve();
    await Promise.resolve();
    expect(state.toast.info.calls.count() + state.toast.error.calls.count()).toBeGreaterThan(0);
    expect(state.registeringPasskey).toBeFalse();
  });

  it('covers accountHeaderLabel branch variants', () => {
    const state = createAccountHarness();
    state.profile = mockSignal<any>({ username: 'user1', name: 'Alice', name_tag: 42 });

    const headerWithTag = (AccountState.prototype as any).accountHeaderLabel.call(state, null);
    expect(headerWithTag).toBe('user1 (Alice#42)');

    const headerWithNameOnly = (AccountState.prototype as any).accountHeaderLabel.call(
      state,
      { username: 'user2', name: 'Bob', name_tag: null } as any
    );
    expect(headerWithNameOnly).toBe('user2 (Bob)');

    const headerUsernameOnly = (AccountState.prototype as any).accountHeaderLabel.call(
      state,
      { username: 'user3', name: '', name_tag: null } as any
    );
    expect(headerUsernameOnly).toBe('user3');
  });
});
