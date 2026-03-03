import { AccountState } from './account.state';

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
