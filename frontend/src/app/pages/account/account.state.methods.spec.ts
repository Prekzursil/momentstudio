import { AccountState } from './account.state';
import { of, throwError } from 'rxjs';

type SignalLike<T> = (() => T) & { set: (next: T) => void };

function instantTranslate(key: string, params?: Record<string, unknown>): string {
  if (!params) return key;
  for (const paramKey of ['status', 'count', 'ref']) {
    if (paramKey in params) {
      return `${key}:${String(params[paramKey])}`;
    }
  }
  return key;
}

function mockSignal<T>(initial: T): SignalLike<T> {
  let value = initial;
  const fn = (() => value) as SignalLike<T>;
  fn.set = (next: T) => {
    value = next;
  };
  return fn;
}

function createStateHarness(): any {
  const state: any = Object.create(AccountState.prototype);
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
  state.translate = { instant: instantTranslate };

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
  state.account = {
    requestOrderCancellation: jasmine.createSpy('requestOrderCancellation'),
    createReturnRequest: jasmine.createSpy('createReturnRequest'),
    shareReceipt: jasmine.createSpy('shareReceipt'),
    revokeReceiptShare: jasmine.createSpy('revokeReceiptShare'),
    createAddress: jasmine.createSpy('createAddress'),
    updateAddress: jasmine.createSpy('updateAddress'),
    deleteAddress: jasmine.createSpy('deleteAddress'),
  };
  state.api = { post: jasmine.createSpy('post') };
  state.toast = { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') };
  state.cart = { loadFromBackend: jasmine.createSpy('loadFromBackend') };
  state.router = { navigateByUrl: jasmine.createSpy('navigateByUrl').and.returnValue(Promise.resolve(true)) };
  state.returnRequestedOrderIds = new Set<string>();
  state.cancelRequestedOrderIds = new Set<string>();
  state.receiptShares = mockSignal<Record<string, any>>({});
  state.receiptCopiedId = mockSignal<string | null>(null);
  state.receiptCopiedTimer = null;
  state.copyReceiptUrl = jasmine.createSpy('copyReceiptUrl').and.returnValue(Promise.resolve());

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

describe('AccountState order helper label methods', () => {
  it('formats tracking, payment and delivery labels', () => {
    const state = createStateHarness();

    expect(state.trackingUrl('  ')).toBe('');
    expect(state.trackingUrl('ABC 123')).toContain('ABC%20123');
    expect(state.trackingStatusLabel({ tracking_number: '', status: 'shipped' } as any)).toBeNull();
    expect(state.trackingStatusLabel({ tracking_number: 'T', status: 'shipped' } as any)).toContain('inTransit');
    expect(state.trackingStatusLabel({ tracking_number: 'T', status: 'delivered' } as any)).toContain('delivered');

    expect(state.paymentMethodLabel({ payment_method: 'stripe' } as any)).toBe('STRIPE');
    expect(state.paymentMethodLabel({ payment_method: 'wire' } as any)).toBe('WIRE');
    expect(state.paymentMethodLabel({ payment_method: '' } as any)).toBe('—');

    expect(state.deliveryLabel({ courier: 'sameday', delivery_type: 'locker' } as any)).toContain('Sameday');
    expect(state.deliveryLabel({ courier: 'fan_courier', delivery_type: 'home' } as any)).toContain('Fan Courier');
    expect(state.deliveryLabel({ courier: '', delivery_type: '' } as any)).toBe('—');

    expect(state.lockerLabel({ delivery_type: 'home' } as any)).toBeNull();
    expect(
      state.lockerLabel({
        delivery_type: 'locker',
        locker_name: 'Easybox',
        locker_address: 'Str 1',
      } as any)
    ).toContain('Easybox');
  });
});

describe('AccountState order helper eligibility methods', () => {
  it('evaluates cancel/return and refund eligibility', () => {
    const state = createStateHarness();
    const paidCapturedCancelled = {
      id: 'o1',
      status: 'cancelled',
      payment_method: 'stripe',
      events: [{ event: 'payment_captured' }],
    };
    expect(state.manualRefundRequired(paidCapturedCancelled as any)).toBeTrue();
    expect(
      state.manualRefundRequired({
        ...paidCapturedCancelled,
        events: [{ event: 'payment_captured' }, { event: 'payment_refunded' }],
      } as any)
    ).toBeFalse();

    const delivered = { id: 'o2', status: 'delivered', events: [] };
    expect(state.canRequestReturn(delivered as any)).toBeTrue();
    state.returnRequestedOrderIds.add('o2');
    expect(state.hasReturnRequested(delivered as any)).toBeTrue();
    expect(state.canRequestReturn(delivered as any)).toBeFalse();

    const cancelable = { id: 'o3', status: 'paid', events: [] };
    expect(state.canRequestCancel(cancelable as any)).toBeTrue();
    state.cancelRequestedOrderIds.add('o3');
    expect(state.hasCancelRequested(cancelable as any)).toBeTrue();
    expect(state.canRequestCancel(cancelable as any)).toBeFalse();
  });
});

describe('AccountState order helper request methods', () => {
  it('opens and submits cancel requests across validation and success paths', () => {
    const state = createStateHarness();
    const order = { id: 'o1', reference_code: 'REF', status: 'paid', events: [] };
    spyOn(globalThis, 'confirm').and.returnValue(true);
    state.account.requestOrderCancellation.and.returnValue(of({ ...order, status: 'cancel_requested' }));
    state.updateOrderInList = jasmine.createSpy('updateOrderInList');
    state.closeReturnRequest = jasmine.createSpy('closeReturnRequest');

    state.openCancelRequest(order as any);
    expect(state.cancelOrderId).toBe('o1');
    expect(state.closeReturnRequest).toHaveBeenCalled();

    state.cancelReason = '';
    state.submitCancelRequest(order as any);
    expect(state.cancelRequestError).toContain('reasonRequired');

    state.cancelReason = 'Need cancel';
    state.submitCancelRequest(order as any);
    expect(state.account.requestOrderCancellation).toHaveBeenCalledWith('o1', 'Need cancel');
    expect(state.toast.success).toHaveBeenCalled();
  });

  it('opens and submits return requests for valid delivered orders', () => {
    const state = createStateHarness();
    const order = {
      id: 'o1',
      status: 'delivered',
      items: [{ id: 'it1', quantity: 2 }],
    };
    state.account.createReturnRequest.and.returnValue(of({ id: 'r1' }));

    state.openReturnRequest(order as any);
    expect(state.returnOrderId).toBe('o1');
    expect(state.returnQty['it1']).toBe(0);

    state.returnReason = '';
    state.submitReturnRequest(order as any);
    expect(state.returnCreateError).toContain('reasonRequired');

    state.returnReason = 'Wrong size';
    state.returnQty['it1'] = 1;
    state.submitReturnRequest(order as any);
    expect(state.account.createReturnRequest).toHaveBeenCalled();
    expect(state.toast.success).toHaveBeenCalled();
  });
});

describe('AccountState receipt flows', () => {
  it('handles receipt copy/share/revoke branches', () => {
    const state = createStateHarness();
    const order = { id: 'o1' };
    spyOn(globalThis, 'confirm').and.returnValue(true);
    state.account.shareReceipt.and.returnValue(of({ receipt_url: 'https://r', expires_at: '2099-01-01T00:00:00Z' }));
    state.account.revokeReceiptShare.and.returnValue(of({}));

    state.copyReceiptLink(order as any);
    expect(state.toast.error).toHaveBeenCalled();

    state.receiptShares.set({
      o1: { receipt_url: 'https://r', expires_at: '2099-01-01T00:00:00Z' },
    });
    state.copyReceiptLink(order as any);
    expect(state.copyReceiptUrl).toHaveBeenCalled();

    state.sharingReceiptId = null;
    state.receiptShares.set({});
    state.shareReceipt(order as any);
    expect(state.account.shareReceipt).toHaveBeenCalledWith('o1');

    state.revokeReceiptShare(order as any);
    expect(state.account.revokeReceiptShare).toHaveBeenCalledWith('o1');
  });

});

describe('AccountState address flows', () => {
  it('normalizes address labels and executes address CRUD helpers', () => {
    const state = createStateHarness();
    spyOn(globalThis, 'confirm').and.returnValue(true);
    state.account.createAddress.and.returnValue(of({ id: 'a1', label: 'home' }));
    state.account.updateAddress.and.returnValue(of({ id: 'a1', label: 'work' }));
    state.account.deleteAddress.and.returnValue(of({}));

    state.openAddressForm({
      id: 'a1',
      label: ' Acasă ',
      line1: 'Main',
      city: 'City',
      country: 'RO',
    } as any);
    expect(state.addressModel.label).toBe('home');

    state.duplicateAddress({
      id: 'a2',
      label: 'Work',
      line1: 'Office',
      city: 'City',
      country: 'RO',
      is_default_shipping: true,
      is_default_billing: true,
    } as any);
    expect(state.addressModel.is_default_shipping).toBeFalse();

    state.editingAddressId = null;
    state.saveAddress({ label: 'home' } as any);
    expect(state.account.createAddress).toHaveBeenCalled();

    state.editingAddressId = 'a1';
    state.saveAddress({ label: 'work' } as any);
    expect(state.account.updateAddress).toHaveBeenCalledWith('a1', { label: 'work' });

    state.addresses.set([{ id: 'a1', label: 'home' }] as any);
    state.removeAddress('a1');
    expect(state.account.deleteAddress).toHaveBeenCalledWith('a1');
  });
});

describe('AccountState comments and pagination helpers', () => {
  it('uses comments pagination helpers and chip classes', () => {
    const state = createStateHarness();
    state.myCommentsMeta = mockSignal({ page: 1, total_pages: 3 });
    state.loadMyComments = jasmine.createSpy('loadMyComments');

    state.nextMyCommentsPage();
    expect(state.loadMyComments).toHaveBeenCalledWith(2);

    state.myCommentsMeta.set({ page: 2, total_pages: 3 });
    state.prevMyCommentsPage();
    expect(state.loadMyComments).toHaveBeenCalledWith(1);

    expect(state.commentStatusChipClass('posted')).toContain('emerald');
    expect(state.commentStatusChipClass('hidden')).toContain('amber');
    expect(state.commentStatusChipClass('other')).toContain('slate');

    expect(state.formatTimestamp(null)).toBe('');
    expect(state.formatTimestamp('2026-02-27T00:00:00Z').length).toBeGreaterThan(0);
  });

  it('handles submit flow errors for cancel and return requests', () => {
    const state = createStateHarness();
    const order = { id: 'o1', status: 'paid', reference_code: 'REF', items: [{ id: 'it1', quantity: 1 }] };
    spyOn(globalThis, 'confirm').and.returnValue(true);

    state.cancelOrderId = 'o1';
    state.cancelReason = 'reason';
    state.account.requestOrderCancellation.and.returnValue(
      throwError(() => ({ error: { detail: 'Cancel request already exists' } }))
    );
    state.submitCancelRequest(order as any);
    expect(state.cancelRequestError).toContain('alreadyRequested');

    state.returnOrderId = 'o1';
    state.returnReason = 'reason';
    state.returnCustomerMessage = '';
    state.returnQty = { it1: 1 };
    state.account.createReturnRequest.and.returnValue(
      throwError(() => ({ error: { detail: 'Return request already exists' } }))
    );
    state.submitReturnRequest({ ...order, status: 'delivered' } as any);
    expect(state.returnCreateError).toContain('alreadyExists');
  });
});
