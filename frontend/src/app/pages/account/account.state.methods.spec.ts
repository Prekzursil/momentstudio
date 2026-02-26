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

function createStateHarness(): any {
  const state = Object.create(AccountState.prototype) as any;
  const nowMs = Date.parse('2026-02-27T00:00:00Z');

  state.now = mockSignal(nowMs);
  state.profile = mockSignal<any>(null);
  state.cooldowns = mockSignal<any>(null);
  state.deletionStatus = mockSignal<any>(null);
  state.orders = mockSignal<any[]>([]);
  state.latestOrder = mockSignal<any>(null);
  state.ordersLoaded = mockSignal(false);
  state.ordersLoading = mockSignal(false);
  state.addresses = mockSignal<any[]>([]);
  state.addressesLoaded = mockSignal(false);
  state.addressesLoading = mockSignal(false);
  state.tickets = mockSignal<any[]>([]);
  state.ticketsLoaded = mockSignal(false);
  state.ticketsLoading = mockSignal(false);
  state.ticketsError = mockSignal<string | null>(null);
  state.emailVerified = mockSignal(false);
  state.googleEmail = mockSignal<string | null>(null);

  state.wishlist = {
    isLoaded: () => true,
    items: () => [] as any[],
  };
  state.translate = {
    instant: (key: string, params?: Record<string, unknown>) => {
      if (params && 'status' in params) return `${key}:${String(params['status'])}`;
      if (params && 'count' in params) return `${key}:${String(params['count'])}`;
      if (params && 'ref' in params) return `${key}:${String(params['ref'])}`;
      return key;
    },
  };

  state.notifyBlogComments = false;
  state.notifyBlogCommentReplies = false;
  state.notifyMarketing = false;

  state.profileName = '';
  state.profileUsername = '';
  state.profileFirstName = '';
  state.profileMiddleName = '';
  state.profileLastName = '';
  state.profileDateOfBirth = '';
  state.profilePhoneCountry = 'RO';
  state.profilePhoneNational = '';
  state.profileLanguage = 'en';
  state.profileThemePreference = 'system';
  state.profileUsernamePassword = '';
  state.profileError = null;
  state.profileSaved = false;

  state.notificationsMessage = null;
  state.notificationsError = null;

  state.showAddressForm = false;
  state.addressFormBaseline = null;
  state.addressModel = {
    label: '',
    line1: '',
    line2: '',
    city: '',
    region: '',
    postal_code: '',
    country: 'US',
    phone: null,
    is_default_shipping: false,
    is_default_billing: false,
  };

  state.closeAddressForm = jasmine.createSpy('closeAddressForm');
  return state;
}

describe('AccountState cooldown and duration helpers', () => {
  it('computes cooldown remaining seconds from next-allowed timestamps', () => {
    const state = createStateHarness();
    state.cooldowns.set({
      username: { next_allowed_at: '2026-02-27T00:00:30Z' },
      display_name: { next_allowed_at: '2026-02-27T00:01:00Z' },
      email: { next_allowed_at: 'bad-date' },
    });

    expect(state.usernameCooldownSeconds()).toBe(30);
    expect(state.displayNameCooldownSeconds()).toBe(60);
    expect(state.emailCooldownSeconds()).toBe(0);
  });

  it('formats cooldown and short duration values', () => {
    const state = createStateHarness();

    expect(state.formatCooldown(0)).toBe('');
    expect(state.formatCooldown(62)).toBe('1m 2s');
    expect(state.formatCooldown(3661)).toBe('1h 1m');
    expect(state.formatCooldown(90061)).toBe('1d 1h');

    expect(state.formatDurationShort(500)).toBe('0s');
    expect(state.formatDurationShort(90_000)).toBe('1m 30s');
    expect(state.formatDurationShort(3_700_000)).toBe('1h 1m');
  });
});

describe('AccountState overview labels', () => {
  it('builds order labels when latest order exists', () => {
    const state = createStateHarness();
    state.ordersLoaded.set(true);
    state.ordersLoading.set(false);
    state.orders.set([
      {
        id: 'o-1',
        reference_code: 'REF-1',
        status: 'paid',
        total_amount: 150,
        currency: 'RON',
        created_at: '2026-02-26T08:00:00Z',
      },
    ]);

    const label = state.lastOrderLabel();
    const subcopy = state.lastOrderSubcopy();

    expect(label).toContain('account.overview.lastOrderLabel');
    expect(label).toContain('paid');
    expect(subcopy).toContain('RON');
  });

  it('returns placeholder strings when order/address data is not loaded', () => {
    const state = createStateHarness();

    expect(state.lastOrderLabel()).toBe('...');
    expect(state.lastOrderSubcopy()).toBe('');
    expect(state.defaultAddressLabel()).toBe('...');
    expect(state.defaultAddressSubcopy()).toBe('');
  });

  it('renders address, wishlist, notifications, security and support labels', () => {
    const state = createStateHarness();
    state.addressesLoaded.set(true);
    state.addresses.set([{ label: 'Home', line1: 'Main 1', city: 'Bucharest', is_default_shipping: true }]);
    state.wishlist = { isLoaded: () => true, items: () => [{ id: 'p1' }, { id: 'p2' }] };
    state.profile.set({ id: 'u1', username: 'ana' });
    state.notifyBlogComments = true;
    state.notifyBlogCommentReplies = true;
    state.notifyMarketing = false;
    state.emailVerified.set(true);
    state.googleEmail.set('ana@example.com');
    state.ticketsLoaded.set(true);
    state.tickets.set([{ status: 'open' }, { status: 'resolved' }]);

    expect(state.defaultAddressLabel()).toBe('Home');
    expect(state.defaultAddressSubcopy()).toContain('Main 1');
    expect(state.wishlistCountLabel()).toContain('2');
    expect(state.notificationsLabel()).toContain('2');
    expect(state.securityLabel()).toContain('emailVerified');
    expect(state.supportTicketsLabel()).toContain('openOne');
    expect(state.supportTicketsSubcopy()).toContain('hint');
  });
});

describe('AccountState deletion helpers', () => {
  it('computes deletion cooldown remaining milliseconds and progress', () => {
    const state = createStateHarness();
    state.deletionStatus.set({
      requested_at: '2026-02-26T00:00:00Z',
      scheduled_for: '2026-02-28T00:00:00Z',
    });

    expect(state.deletionCooldownRemainingMs()).toBe(24 * 60 * 60 * 1000);
    expect(state.deletionCooldownProgressPercent()).toBe(50);
  });

  it('returns safe defaults when deletion timeline is missing', () => {
    const state = createStateHarness();
    state.deletionStatus.set({ requested_at: null, scheduled_for: null });

    expect(state.deletionCooldownRemainingMs()).toBeNull();
    expect(state.deletionCooldownProgressPercent()).toBe(0);
  });
});

describe('AccountState profile unsaved snapshot helpers', () => {
  it('detects and discards profile changes', () => {
    const state = createStateHarness();
    state.profileBaseline = {
      name: 'Ana',
      username: 'ana',
      firstName: 'Ana',
      middleName: '',
      lastName: 'Pop',
      dateOfBirth: '1990-01-01',
      phoneCountry: 'RO',
      phoneNational: '123',
      preferredLanguage: 'en',
      themePreference: 'system',
    };

    state.profileName = 'Ana 2';
    expect(state.profileHasUnsavedChanges()).toBeTrue();

    state.discardProfileChanges();
    expect(state.profileName).toBe('Ana');
    expect(state.profileHasUnsavedChanges()).toBeFalse();
  });
});

describe('AccountState notifications and address unsaved helpers', () => {
  it('detects notifications/address unsaved changes and can discard', () => {
    const state = createStateHarness();
    state.notificationsBaseline = {
      notifyBlogComments: false,
      notifyBlogCommentReplies: false,
      notifyMarketing: false,
    };
    state.notifyBlogComments = true;

    expect(state.notificationsHasUnsavedChanges()).toBeTrue();
    state.discardNotificationChanges();
    expect(state.notificationsHasUnsavedChanges()).toBeFalse();

    state.showAddressForm = true;
    state.addressFormBaseline = {
      label: 'Home',
      line1: 'Main',
      line2: '',
      city: 'B',
      region: '',
      postal_code: '123',
      country: 'RO',
      phone: null,
      is_default_shipping: true,
      is_default_billing: false,
    };
    state.addressModel = { ...state.addressFormBaseline, city: 'Cluj' };

    expect(state.addressesHasUnsavedChanges()).toBeTrue();
    state.discardAddressChanges();
    expect(state.closeAddressForm).toHaveBeenCalled();
  });
});

describe('AccountState address snapshot normalization', () => {
  it('normalizes and compares address snapshots', () => {
    const state = createStateHarness();
    const a = {
      label: ' Home ',
      line1: ' Main ',
      line2: '',
      city: 'City',
      region: '',
      postal_code: ' 123 ',
      country: ' RO ',
      phone: ' 07123 ',
      is_default_shipping: 1,
      is_default_billing: 0,
    };
    const b = {
      label: 'Home',
      line1: 'Main',
      line2: '',
      city: 'City',
      region: '',
      postal_code: '123',
      country: 'RO',
      phone: '07123',
      is_default_shipping: true,
      is_default_billing: false,
    };

    expect(state.sameAddressSnapshot(a, b)).toBeTrue();
  });
});
