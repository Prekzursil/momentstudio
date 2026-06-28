import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { AdminOrderDetail, AdminOrdersService } from '../../../core/admin-orders.service';
import { AdminReturnsService } from '../../../core/admin-returns.service';
import { AdminRecentService } from '../../../core/admin-recent.service';
import { ToastService } from '../../../core/toast.service';
import { AdminOrderDetailComponent } from './admin-order-detail.component';

/**
 * Behavioural unit tests for AdminOrderDetailComponent.
 *
 * Services are replaced with jasmine spies so every test asserts on the real
 * control-flow of the component (the signals it mutates, the payloads it sends
 * to the API layer, the toasts it raises, the navigation it triggers) rather
 * than on rendered markup. The inline template is exercised indirectly through
 * the accessor methods it binds to.
 */

type ParamMapLike = {
  get: (key: string) => string | null;
  has: (key: string) => boolean;
};

function makeParamMap(values: Record<string, string>): ParamMapLike {
  return {
    get: (key: string) => (key in values ? values[key] : null),
    has: (key: string) => key in values,
  };
}

function makeOrder(overrides: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  return {
    id: 'order-1234567890',
    reference_code: 'REF-001',
    status: 'paid',
    payment_method: 'stripe',
    total_amount: 100,
    tax_amount: 19,
    fee_amount: 1,
    shipping_amount: 10,
    currency: 'RON',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    customer_email: 'buyer@example.com',
    customer_username: 'buyer',
    items: [
      {
        id: 'item-1',
        product_id: 'prod-1',
        product: { id: 'prod-1', slug: 'p1', name: 'Product One' },
        quantity: 2,
        shipped_quantity: 0,
        unit_price: 25,
        subtotal: 50,
      },
    ],
    ...overrides,
  } as AdminOrderDetail;
}

describe('AdminOrderDetailComponent', () => {
  let component: AdminOrderDetailComponent;
  let api: jasmine.SpyObj<AdminOrdersService>;
  let returnsApi: jasmine.SpyObj<AdminReturnsService>;
  let recent: jasmine.SpyObj<AdminRecentService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: jasmine.SpyObj<Router>;
  let translate: TranslateService;
  let queryParamMap$: BehaviorSubject<ParamMapLike>;
  let paramMap$: BehaviorSubject<ParamMapLike>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<AdminOrdersService>('AdminOrdersService', [
      'search',
      'get',
      'listEmailEvents',
      'update',
      'reviewFraud',
      'updateAddresses',
      'createShipment',
      'updateShipment',
      'deleteShipment',
      'fulfillItem',
      'uploadShippingLabel',
      'downloadShippingLabel',
      'deleteShippingLabel',
      'retryPayment',
      'voidPayment',
      'requestRefund',
      'createPartialRefund',
      'addAdminNote',
      'addOrderTag',
      'removeOrderTag',
      'sendDeliveryEmail',
      'downloadPackingSlip',
      'downloadReceiptPdf',
      'shareReceipt',
      'revokeReceiptShare',
    ]);
    returnsApi = jasmine.createSpyObj<AdminReturnsService>('AdminReturnsService', [
      'create',
      'listByOrder',
    ]);
    recent = jasmine.createSpyObj<AdminRecentService>('AdminRecentService', ['add']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));

    // Sensible defaults so secondary loads (returns/comms) never explode.
    api.listEmailEvents.and.returnValue(of([]));
    returnsApi.listByOrder.and.returnValue(of([]));

    queryParamMap$ = new BehaviorSubject<ParamMapLike>(makeParamMap({}));
    paramMap$ = new BehaviorSubject<ParamMapLike>(makeParamMap({}));

    await TestBed.configureTestingModule({
      imports: [AdminOrderDetailComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AdminOrdersService, useValue: api },
        { provide: AdminReturnsService, useValue: returnsApi },
        { provide: AdminRecentService, useValue: recent },
        { provide: ToastService, useValue: toast },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: queryParamMap$, paramMap: paramMap$ },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AdminOrderDetailComponent);
    component = fixture.componentInstance;
    translate = TestBed.inject(TranslateService);

    // Provide a handful of translations so the "key found" branches of the
    // `translated === key ? fallback : translated` helpers are exercised, while
    // unknown keys still fall through to the "key missing" branches.
    translate.setTranslation('en', {
      adminUi: {
        orders: {
          paid: 'Paid',
          shipped: 'Shipped',
          tags: { vip: 'VIP Customer' },
          comms: { status: { sent: 'Sent' } },
          trackingNumber: 'Tracking number',
          trackingUrl: 'Tracking URL',
          table: { status: 'Status' },
          diff: { courier: 'Courier', shippingMethod: 'Shipping method' },
          fraudSignals: {
            signals: {
              velocity_email: { title: 'Velocity (email)', description: '{{count}} orders' },
            },
            severity: { high: 'High' },
          },
        },
      },
      checkout: { courierSameday: 'Sameday', courierFanCourier: 'FAN Courier' },
    });
    translate.use('en');
  });

  function prime(order: AdminOrderDetail = makeOrder()): AdminOrderDetail {
    component.order.set(order);
    (component as any).orderId = order.id;
    component.loading.set(false);
    component.error.set(null);
    component.action.set(null);
    return order;
  }

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // status helpers
  // ---------------------------------------------------------------------------

  it('statusChipClass delegates to the shared helper', () => {
    expect(component.statusChipClass('paid')).toContain('indigo');
    expect(component.statusChipClass('unknown-status')).toContain('slate');
  });

  it('paymentCaptureBlocked is false without an order', () => {
    component.order.set(null);
    expect(component.paymentCaptureBlocked()).toBeFalse();
  });

  it('paymentCaptureBlocked is false when status is not pending_acceptance', () => {
    prime(makeOrder({ status: 'paid', payment_method: 'stripe' }));
    expect(component.paymentCaptureBlocked()).toBeFalse();
  });

  it('paymentCaptureBlocked is false for non card payment methods', () => {
    prime(makeOrder({ status: 'pending_acceptance', payment_method: 'cod' }));
    expect(component.paymentCaptureBlocked()).toBeFalse();
  });

  it('paymentCaptureBlocked is true for an uncaptured stripe order awaiting acceptance', () => {
    prime(makeOrder({ status: 'pending_acceptance', payment_method: 'stripe', events: [] }));
    expect(component.paymentCaptureBlocked()).toBeTrue();
  });

  it('paymentCaptureBlocked is false once stripe payment is captured', () => {
    prime(
      makeOrder({
        status: 'pending_acceptance',
        payment_method: 'stripe',
        events: [{ id: 'e1', event: 'payment_captured', created_at: '2026-01-01T00:00:00Z' }],
      }),
    );
    expect(component.paymentCaptureBlocked()).toBeFalse();
  });

  it('paymentCaptureBlocked is false once paypal capture id exists', () => {
    prime(
      makeOrder({
        status: 'pending_acceptance',
        payment_method: 'paypal',
        paypal_capture_id: 'cap-1',
      }),
    );
    expect(component.paymentCaptureBlocked()).toBeFalse();
  });

  it('statusOptions returns every status with disabled flags (no order uses statusValue)', () => {
    component.order.set(null);
    component.statusValue = 'pending_acceptance';
    const opts = component.statusOptions();
    expect(opts.length).toBe(7);
    expect(opts.find((o) => o.value === 'pending_acceptance')!.disabled).toBeFalse();
  });

  it('statusOptions enables shipping/delivery for COD orders awaiting acceptance', () => {
    prime(makeOrder({ status: 'pending_acceptance', payment_method: 'cod' }));
    const opts = component.statusOptions();
    expect(opts.find((o) => o.value === 'shipped')!.disabled).toBeFalse();
    expect(opts.find((o) => o.value === 'delivered')!.disabled).toBeFalse();
  });

  it('statusOptions disables "paid" for uncaptured stripe orders awaiting acceptance', () => {
    prime(makeOrder({ status: 'pending_acceptance', payment_method: 'stripe', events: [] }));
    const opts = component.statusOptions();
    expect(opts.find((o) => o.value === 'paid')!.disabled).toBeTrue();
  });

  // ---------------------------------------------------------------------------
  // ngOnInit / load / route wiring
  // ---------------------------------------------------------------------------

  it('ngOnInit errors out when the route has no orderId', () => {
    paramMap$.next(makeParamMap({}));
    component.ngOnInit();
    expect(component.error()).toBeTruthy();
    expect(component.loading()).toBeFalse();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('ngOnInit loads the order, records recency and resets working state', () => {
    const order = makeOrder();
    api.get.and.returnValue(of(order));
    paramMap$.next(makeParamMap({ orderId: order.id }));
    component.ngOnInit();
    expect(api.get).toHaveBeenCalledWith(order.id, { include_pii: true });
    expect(component.order()).toBe(order);
    expect(recent.add).toHaveBeenCalled();
    expect(component.statusValue).toBe('paid');
    expect(component.fulfillmentQty['item-1']).toBe(0);
    expect(component.loading()).toBeFalse();
  });

  it('load falls back to the id prefix and blank email when missing', () => {
    const order = makeOrder({ reference_code: null, customer_email: null, status: undefined as any });
    api.get.and.returnValue(of(order));
    paramMap$.next(makeParamMap({ orderId: order.id }));
    component.ngOnInit();
    const recorded = recent.add.calls.mostRecent().args[0];
    expect(recorded.label).toBe(order.id.slice(0, 8));
    expect(recorded.subtitle).toBe('');
    expect(component.statusValue).toBe('pending_acceptance');
  });

  it('load surfaces an error state when the API fails', () => {
    api.get.and.returnValue(throwError(() => ({ status: 500 })));
    paramMap$.next(makeParamMap({ orderId: 'order-1234567890' }));
    component.ngOnInit();
    expect(component.error()).toBeTruthy();
    expect(component.loading()).toBeFalse();
    expect(component.commsLoading()).toBeFalse();
  });

  it('retryLoad does nothing without an order id and reloads with one', () => {
    component.retryLoad();
    expect(api.get).not.toHaveBeenCalled();

    const order = makeOrder();
    (component as any).orderId = order.id;
    api.get.and.returnValue(of(order));
    component.retryLoad();
    expect(api.get).toHaveBeenCalledWith(order.id, { include_pii: true });
  });

  it('togglePiiReveal flips the flag and reloads, but is a no-op without an order id', () => {
    component.togglePiiReveal();
    expect(api.get).not.toHaveBeenCalled();

    const order = makeOrder();
    (component as any).orderId = order.id;
    api.get.and.returnValue(of(order));
    component.piiReveal.set(true);
    component.togglePiiReveal();
    expect(component.piiReveal()).toBeFalse();
    expect(api.get).toHaveBeenCalledWith(order.id, { include_pii: false });
  });

  // ---------------------------------------------------------------------------
  // navigation context
  // ---------------------------------------------------------------------------

  it('applyNavContext disables navigation when nav is absent', () => {
    queryParamMap$.next(makeParamMap({}));
    component.ngOnInit();
    expect(component.navEnabled()).toBeFalse();
    expect(component.navPrev()).toBeNull();
    expect(component.navNext()).toBeNull();
  });

  it('applyNavContext parses defaults from invalid page/limit values', () => {
    queryParamMap$.next(makeParamMap({ nav: '1', nav_page: '0', nav_limit: 'abc' }));
    component.ngOnInit();
    expect(component.navEnabled()).toBeTrue();
    expect((component as any).navContext).toEqual(
      jasmine.objectContaining({ page: 1, limit: 20 }),
    );
  });

  it('applyNavContext captures all optional filters and clamps the limit', () => {
    api.search.and.returnValue(of({ items: [], meta: { total_pages: 1 } } as any));
    queryParamMap$.next(
      makeParamMap({
        nav: '1',
        nav_page: '2',
        nav_limit: '500',
        nav_q: 'shoes',
        nav_status: 'paid',
        nav_sla: 'breached',
        nav_fraud: 'high',
        nav_tag: 'vip',
        nav_from: '2026-01-01',
        nav_to: '2026-02-01',
        nav_include_test: '0',
      }),
    );
    component.ngOnInit();
    expect((component as any).navContext).toEqual({
      page: 2,
      limit: 100,
      q: 'shoes',
      status: 'paid',
      sla: 'breached',
      fraud: 'high',
      tag: 'vip',
      from: '2026-01-01',
      to: '2026-02-01',
      include_test: false,
    });
  });

  it('applyNavContext re-runs refreshNav once an order id is already known', () => {
    api.search.and.returnValue(of({ items: [], meta: { total_pages: 1 } } as any));
    (component as any).orderId = 'order-1234567890';
    queryParamMap$.next(makeParamMap({ nav: '1' }));
    component.ngOnInit();
    api.search.calls.reset();
    queryParamMap$.next(makeParamMap({ nav: '1' }));
    expect(api.search).toHaveBeenCalled();
  });

  it('refreshNav clears neighbours when navigation is disabled', () => {
    (component as any).navContext = null;
    component.navEnabled.set(false);
    component.navPrev.set({ id: 'x', page: 1 });
    (component as any).refreshNav('order-1234567890');
    expect(component.navPrev()).toBeNull();
    expect(component.navNext()).toBeNull();
  });

  it('refreshNav sets previous and next neighbours from the page results', () => {
    (component as any).navContext = {
      page: 1,
      limit: 20,
      q: 'q',
      status: 's',
      sla: 'sla',
      fraud: 'f',
      tag: 't',
      from: 'a',
      to: 'b',
      include_test: false,
    };
    component.navEnabled.set(true);
    api.search.and.returnValue(
      of({ items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], meta: { total_pages: 1 } } as any),
    );
    (component as any).refreshNav('b');
    expect(component.navPrev()).toEqual({ id: 'a', page: 1 });
    expect(component.navNext()).toEqual({ id: 'c', page: 1 });
  });

  it('refreshNav fetches the previous page when the order is first on a later page', () => {
    (component as any).navContext = { page: 2, limit: 20 };
    component.navEnabled.set(true);
    api.search.and.returnValues(
      of({ items: [{ id: 'cur' }, { id: 'next' }], meta: { total_pages: 3 } } as any),
      of({ items: [{ id: 'prevA' }, { id: 'prevB' }] } as any),
    );
    (component as any).refreshNav('cur');
    expect(component.navPrev()).toEqual({ id: 'prevB', page: 1 });
  });

  it('refreshNav fetches the next page when the order is last on an earlier page', () => {
    (component as any).navContext = { page: 1, limit: 20 };
    component.navEnabled.set(true);
    api.search.and.returnValues(
      of({ items: [{ id: 'first' }, { id: 'cur' }], meta: { total_pages: 3 } } as any),
      of({ items: [{ id: 'nextA' }, { id: 'nextB' }] } as any),
    );
    (component as any).refreshNav('cur');
    expect(component.navNext()).toEqual({ id: 'nextA', page: 2 });
  });

  it('refreshNav tolerates errors on the neighbour page fetches', () => {
    (component as any).navContext = { page: 2, limit: 20 };
    component.navEnabled.set(true);
    api.search.and.returnValues(
      of({ items: [{ id: 'cur' }], meta: { total_pages: 3 } } as any),
      throwError(() => new Error('prev fail')),
      throwError(() => new Error('next fail')),
    );
    expect(() => (component as any).refreshNav('cur')).not.toThrow();
  });

  it('refreshNav clears neighbours when the search fails', () => {
    (component as any).navContext = { page: 1, limit: 20 };
    component.navEnabled.set(true);
    api.search.and.returnValue(throwError(() => new Error('boom')));
    (component as any).refreshNav('cur');
    expect(component.navPrev()).toBeNull();
    expect(component.navNext()).toBeNull();
  });

  it('goPrev and goNext are no-ops without a target', () => {
    component.navPrev.set(null);
    component.navNext.set(null);
    component.goPrev();
    component.goNext();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('goPrev navigates without query params when there is no nav context', () => {
    (component as any).navContext = null;
    component.navPrev.set({ id: 'p1', page: 1 });
    component.goPrev();
    expect(router.navigate).toHaveBeenCalledWith(['/admin/orders', 'p1']);
  });

  it('goNext navigates with the rebuilt nav query params', () => {
    (component as any).navContext = {
      page: 2,
      limit: 20,
      q: 'q',
      status: 's',
      sla: 'sla',
      fraud: 'f',
      tag: 't',
      from: 'a',
      to: 'b',
      include_test: false,
    };
    component.navNext.set({ id: 'n1', page: 3 });
    component.goNext();
    const [path, extras] = router.navigate.calls.mostRecent().args as [unknown, any];
    expect(path).toEqual(['/admin/orders', 'n1']);
    expect(extras.queryParams).toEqual(
      jasmine.objectContaining({
        nav: 1,
        nav_page: 3,
        nav_q: 'q',
        nav_include_test: 0,
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // keyboard shortcuts
  // ---------------------------------------------------------------------------

  it('onDocumentKeydown ignores events from form fields', () => {
    prime();
    const input = document.createElement('input');
    const evt = { key: 's', ctrlKey: true, target: input, preventDefault: () => {} } as any;
    spyOn(component, 'save');
    component.onDocumentKeydown(evt);
    expect(component.save).not.toHaveBeenCalled();
  });

  it('onDocumentKeydown bails when no order is loaded', () => {
    component.order.set(null);
    const evt = {
      key: 's',
      ctrlKey: true,
      target: document.body,
      preventDefault: () => {},
    } as any;
    spyOn(component, 'save');
    component.onDocumentKeydown(evt);
    expect(component.save).not.toHaveBeenCalled();
  });

  it('onDocumentKeydown bails while an action is in flight', () => {
    prime();
    component.action.set('save');
    spyOn(component, 'save');
    component.onDocumentKeydown({
      key: 's',
      metaKey: true,
      target: document.body,
      preventDefault: () => {},
    } as any);
    expect(component.save).not.toHaveBeenCalled();
  });

  it('onDocumentKeydown triggers save on Ctrl+S', () => {
    prime();
    spyOn(component, 'save');
    const evt = { key: 's', ctrlKey: true, target: document.body, preventDefault: jasmine.createSpy() } as any;
    component.onDocumentKeydown(evt);
    expect(evt.preventDefault).toHaveBeenCalled();
    expect(component.save).toHaveBeenCalled();
  });

  it('onDocumentKeydown opens the refund wizard on Shift+R', () => {
    prime();
    spyOn(component, 'openRefundWizard');
    const evt = { key: 'R', shiftKey: true, target: document.body, preventDefault: jasmine.createSpy() } as any;
    component.onDocumentKeydown(evt);
    expect(component.openRefundWizard).toHaveBeenCalled();
  });

  it('onDocumentKeydown downloads the packing slip on Shift+P', () => {
    prime();
    spyOn(component, 'downloadPackingSlip');
    const evt = { key: 'p', shiftKey: true, target: document.body, preventDefault: jasmine.createSpy() } as any;
    component.onDocumentKeydown(evt);
    expect(component.downloadPackingSlip).toHaveBeenCalled();
  });

  it('onDocumentKeydown ignores unrelated keys', () => {
    prime();
    spyOn(component, 'save');
    component.onDocumentKeydown({
      key: 'a',
      target: document.body,
      preventDefault: () => {},
    } as any);
    expect(component.save).not.toHaveBeenCalled();
  });

  it('shouldIgnoreShortcut handles defaultPrevented, missing target and contentEditable', () => {
    const ignore = (e: any) => (component as any).shouldIgnoreShortcut(e);
    expect(ignore({ defaultPrevented: true })).toBeTrue();
    expect(ignore({ defaultPrevented: false, target: null })).toBeFalse();
    expect(ignore({ defaultPrevented: false, target: { tagName: 'DIV', isContentEditable: true } })).toBeTrue();
    expect(
      ignore({ defaultPrevented: false, target: { tagName: 'SPAN', isContentEditable: false } }),
    ).toBeFalse();
  });

  // ---------------------------------------------------------------------------
  // labels
  // ---------------------------------------------------------------------------

  it('crumbs include the reference when present and fall back otherwise', () => {
    component.order.set(null);
    expect(component.crumbs().length).toBe(4);
    prime();
    expect(component.crumbs()[3].label).toContain('REF-001');
  });

  it('orderRef prefers the reference code then the id prefix', () => {
    component.order.set(null);
    expect(component.orderRef()).toBe('');
    component.order.set(makeOrder({ reference_code: 'REF-XYZ' }));
    expect(component.orderRef()).toBe('REF-XYZ');
    component.order.set(makeOrder({ reference_code: null }));
    expect(component.orderRef()).toBe('order-12');
  });

  it('customerLabel combines email and username with sensible fallbacks', () => {
    component.order.set(null);
    expect(component.customerLabel()).toBe('');
    component.order.set(makeOrder({ customer_email: 'a@b.com', customer_username: 'alice' }));
    expect(component.customerLabel()).toBe('a@b.com (alice)');
    component.order.set(makeOrder({ customer_email: 'a@b.com', customer_username: '' }));
    expect(component.customerLabel()).toBe('a@b.com');
    component.order.set(makeOrder({ customer_email: '', customer_username: 'alice' }));
    expect(component.customerLabel()).toBe('alice');
    component.order.set(makeOrder({ customer_email: '', customer_username: '' }));
    expect(component.customerLabel()).toBe('adminUi.orders.guest');
  });

  it('paymentMethodLabel maps each method', () => {
    component.order.set(null);
    expect(component.paymentMethodLabel()).toBe('—');
    component.order.set(makeOrder({ payment_method: 'cod' }));
    expect(component.paymentMethodLabel()).toBe('adminUi.orders.paymentCod');
    component.order.set(makeOrder({ payment_method: 'paypal' }));
    expect(component.paymentMethodLabel()).toBe('adminUi.orders.paymentPaypal');
    component.order.set(makeOrder({ payment_method: 'stripe' }));
    expect(component.paymentMethodLabel()).toBe('adminUi.orders.paymentStripe');
    component.order.set(makeOrder({ payment_method: 'wire' }));
    expect(component.paymentMethodLabel()).toBe('wire');
    component.order.set(makeOrder({ payment_method: '' }));
    expect(component.paymentMethodLabel()).toBe('—');
  });

  it('deliveryTypeLabel maps each delivery type', () => {
    component.order.set(null);
    expect(component.deliveryTypeLabel()).toBe('—');
    component.order.set(makeOrder({ delivery_type: 'locker' }));
    expect(component.deliveryTypeLabel()).toBe('adminUi.orders.deliveryLocker');
    component.order.set(makeOrder({ delivery_type: 'home' }));
    expect(component.deliveryTypeLabel()).toBe('adminUi.orders.deliveryHome');
    component.order.set(makeOrder({ delivery_type: 'pickup' }));
    expect(component.deliveryTypeLabel()).toBe('pickup');
    component.order.set(makeOrder({ delivery_type: '' }));
    expect(component.deliveryTypeLabel()).toBe('—');
  });

  it('courierName maps known couriers and falls back to raw value', () => {
    expect(component.courierName('')).toBe('—');
    expect(component.courierName('sameday')).toBe('Sameday');
    expect(component.courierName('fan_courier')).toBe('FAN Courier');
    expect(component.courierName('DHL')).toBe('DHL');
  });

  it('tagLabel translates known tags and echoes unknown ones', () => {
    expect(component.tagLabel('vip')).toBe('VIP Customer');
    expect(component.tagLabel('gift')).toBe('gift');
  });

  it('tagChipColorClass returns a class string', () => {
    expect(typeof component.tagChipColorClass('vip')).toBe('string');
  });

  it('emailStatusLabel translates known statuses and echoes unknown ones', () => {
    expect(component.emailStatusLabel('sent')).toBe('Sent');
    expect(component.emailStatusLabel('bounced')).toBe('bounced');
  });

  it('emailStatusChipClass maps sent/failed/other', () => {
    expect(component.emailStatusChipClass('sent')).toContain('emerald');
    expect(component.emailStatusChipClass('failed')).toContain('rose');
    expect(component.emailStatusChipClass('queued')).toContain('slate');
  });

  // ---------------------------------------------------------------------------
  // fraud signals
  // ---------------------------------------------------------------------------

  it('fraudSignalTitle translates known codes and echoes unknown ones', () => {
    expect(component.fraudSignalTitle({ code: 'velocity_email', severity: 'high' })).toBe(
      'Velocity (email)',
    );
    expect(component.fraudSignalTitle({ code: 'mystery', severity: 'low' })).toBe('mystery');
  });

  it('fraudSignalDescription returns a translation or empty string', () => {
    expect(
      component.fraudSignalDescription({
        code: 'velocity_email',
        severity: 'high',
        data: { count: 5, window_minutes: 10 },
      }),
    ).toBe('5 orders');
    expect(component.fraudSignalDescription({ code: 'unknown', severity: 'low' })).toBe('');
  });

  it('fraudSignalParams shapes data per signal code', () => {
    const call = (s: any) => (component as any).fraudSignalParams(s);
    expect(call({ code: 'velocity_user', data: { count: 1, window_minutes: 2 } })).toEqual({
      count: 1,
      window_minutes: 2,
    });
    expect(
      call({ code: 'country_mismatch', data: { shipping_country: 'RO', billing_country: 'DE' } }),
    ).toEqual({ shipping_country: 'RO', billing_country: 'DE' });
    expect(call({ code: 'payment_retries', data: { count: 3 } })).toEqual({ count: 3 });
    expect(call({ code: 'other', data: { foo: 'bar' } })).toEqual({ foo: 'bar' });
    expect(call({ code: 'other' })).toEqual({});
  });

  it('fraudSeverityLabel translates known severities and echoes unknown ones', () => {
    expect(component.fraudSeverityLabel('high')).toBe('High');
    expect(component.fraudSeverityLabel('low')).toBe('low');
  });

  it('fraudSeverityDotClass maps every severity', () => {
    expect(component.fraudSeverityDotClass('high')).toBe('bg-rose-500');
    expect(component.fraudSeverityDotClass('medium')).toBe('bg-amber-500');
    expect(component.fraudSeverityDotClass('low')).toBe('bg-sky-500');
    expect(component.fraudSeverityDotClass('info')).toBe('bg-slate-400');
  });

  it('fraudSeverityBadgeClass maps every severity', () => {
    expect(component.fraudSeverityBadgeClass('high')).toContain('rose');
    expect(component.fraudSeverityBadgeClass('medium')).toContain('amber');
    expect(component.fraudSeverityBadgeClass('low')).toContain('sky');
    expect(component.fraudSeverityBadgeClass('info')).toContain('slate');
  });

  it('fraudReviewStatus reads the approval/denial tags', () => {
    component.order.set(makeOrder({ tags: ['fraud_approved'] }));
    expect(component.fraudReviewStatus()).toBe('approved');
    component.order.set(makeOrder({ tags: ['Fraud_Denied'] }));
    expect(component.fraudReviewStatus()).toBe('denied');
    component.order.set(makeOrder({ tags: [] }));
    expect(component.fraudReviewStatus()).toBeNull();
  });

  it('reviewFraud guards against missing order id, missing order and busy state', () => {
    component.reviewFraud('approve');
    expect(api.reviewFraud).not.toHaveBeenCalled();

    (component as any).orderId = 'order-1234567890';
    component.order.set(null);
    component.reviewFraud('approve');
    expect(api.reviewFraud).not.toHaveBeenCalled();

    prime();
    component.action.set('save');
    component.reviewFraud('approve');
    expect(api.reviewFraud).not.toHaveBeenCalled();
  });

  it('reviewFraud approves with a prompt note and refreshes the order', () => {
    prime();
    spyOn(window, 'prompt').and.returnValue('looks fine');
    const updated = makeOrder({ tags: ['fraud_approved'] });
    api.reviewFraud.and.returnValue(of(updated));
    component.reviewFraud('approve');
    expect(api.reviewFraud).toHaveBeenCalledWith(
      'order-1234567890',
      { decision: 'approve', note: 'looks fine' },
      { include_pii: true },
    );
    expect(component.order()).toBe(updated);
    expect(toast.success).toHaveBeenCalled();
    expect(component.action()).toBeNull();
  });

  it('reviewFraud denies with a null note when prompt is cancelled', () => {
    prime();
    spyOn(window, 'prompt').and.returnValue(null);
    api.reviewFraud.and.returnValue(of(makeOrder()));
    component.reviewFraud('deny');
    expect(api.reviewFraud).toHaveBeenCalledWith(
      'order-1234567890',
      { decision: 'deny', note: null },
      { include_pii: true },
    );
  });

  it('reviewFraud surfaces API errors with and without a detail', () => {
    prime();
    spyOn(window, 'prompt').and.returnValue('');
    api.reviewFraud.and.returnValue(throwError(() => ({ error: { detail: 'nope' } })));
    component.reviewFraud('approve');
    expect(toast.error).toHaveBeenCalledWith('nope');

    api.reviewFraud.and.returnValue(throwError(() => ({})));
    component.reviewFraud('approve');
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.fraudReview.errors.failed');
  });

  // ---------------------------------------------------------------------------
  // address validation helpers
  // ---------------------------------------------------------------------------

  it('addressIssueKeys returns empty when no address is provided', () => {
    expect(component.addressIssueKeys(null, 'shipping')).toEqual([]);
  });

  it('addressIssueKeys flags a missing shipping phone and invalid RO postal', () => {
    const issues = component.addressIssueKeys(
      { line1: 'x', city: 'y', postal_code: 'bad', country: 'ro', phone: '' } as any,
      'shipping',
    );
    expect(issues).toContain('adminUi.orders.addressValidate.phoneMissing');
    expect(issues).toContain('adminUi.orders.addressValidate.postalInvalidRo');
  });

  it('addressIssueKeys warns on a non-E164 RO phone and a non-standard RO postal', () => {
    const issues = component.addressIssueKeys(
      { line1: 'x', city: 'y', postal_code: '01 23 45', country: 'RO', phone: '0721234567' } as any,
      'shipping',
    );
    expect(issues).toContain('adminUi.orders.addressValidate.phoneNonE164');
    expect(issues).toContain('adminUi.orders.addressValidate.postalNonStandardRo');
  });

  it('addressIssueKeys flags an invalid phone and a non-RO invalid postal', () => {
    const issues = component.addressIssueKeys(
      { line1: 'x', city: 'y', postal_code: '', country: 'DE', phone: '12345' } as any,
      'shipping',
    );
    expect(issues).toContain('adminUi.orders.addressValidate.phoneInvalid');
    expect(issues).toContain('adminUi.orders.addressValidate.postalInvalid');
  });

  it('addressNeedsAttention reflects whether there are issues', () => {
    expect(
      component.addressNeedsAttention(
        { line1: 'x', city: 'y', postal_code: '012345', country: 'RO', phone: '+40721234567' } as any,
        'shipping',
      ),
    ).toBeFalse();
    expect(component.addressNeedsAttention({ country: 'RO' } as any, 'shipping')).toBeTrue();
  });

  it('phoneState (via addressIssueKeys) covers every phone branch', () => {
    const phoneIssues = (phone: string, country = 'RO', kind: 'shipping' | 'billing' = 'shipping') =>
      component.addressIssueKeys(
        { line1: 'x', city: 'y', postal_code: '012345', country, phone } as any,
        kind,
      );
    expect(phoneIssues('', 'RO', 'billing')).toEqual([]);
    expect(phoneIssues('0040721234567')).toEqual([]);
    expect(phoneIssues('+40')).toContain('adminUi.orders.addressValidate.phoneInvalid');
    expect(phoneIssues('721234567')).toContain('adminUi.orders.addressValidate.phoneNonE164');
    expect(phoneIssues('40721234567')).toContain('adminUi.orders.addressValidate.phoneNonE164');
    expect(phoneIssues('0721234567', 'DE')).toContain(
      'adminUi.orders.addressValidate.phoneInvalid',
    );
    expect(phoneIssues('()-', 'RO', 'billing')).toContain(
      'adminUi.orders.addressValidate.phoneInvalid',
    );
  });

  it('postalState (via addressIssueKeys) treats valid non-RO postals as ok', () => {
    expect(
      component.addressIssueKeys(
        { line1: 'x', city: 'y', postal_code: '10115', country: 'DE', phone: '+49301234567' } as any,
        'shipping',
      ),
    ).toEqual([]);
  });

  it('addressPhoneHint reflects the editor phone state', () => {
    component.addressEditorKind.set('shipping');
    component.addressCountry = 'RO';
    component.addressPhone = '';
    expect(component.addressPhoneHint()).toBe('adminUi.orders.addressValidate.phoneMissing');
    component.addressPhone = '0721234567';
    expect(component.addressPhoneHint()).toBe('adminUi.orders.addressValidate.phoneNonE164');
    component.addressPhone = '+40';
    expect(component.addressPhoneHint()).toBe('adminUi.orders.addressValidate.phoneInvalid');
    component.addressPhone = '+40721234567';
    expect(component.addressPhoneHint()).toBe('');
  });

  it('addressPhoneSuggestion and applyAddressPhoneSuggestion round-trip', () => {
    component.addressEditorKind.set('shipping');
    component.addressCountry = 'RO';
    component.addressPhone = '0721234567';
    const suggestion = component.addressPhoneSuggestion();
    expect(suggestion).toBe('+40721234567');
    component.addressPhone = '+40721234567';
    expect(component.addressPhoneSuggestion()).toBeNull();
    component.applyAddressPhoneSuggestion('  +40711111111  ');
    expect(component.addressPhone).toBe('+40711111111');
  });

  it('addressPostalHint reflects RO and non-RO postal states', () => {
    component.addressCountry = 'RO';
    component.addressPostalCode = 'bad';
    expect(component.addressPostalHint()).toBe('adminUi.orders.addressValidate.postalInvalidRo');
    component.addressPostalCode = '01 23 45';
    expect(component.addressPostalHint()).toBe('adminUi.orders.addressValidate.postalNonStandardRo');
    component.addressPostalCode = '012345';
    expect(component.addressPostalHint()).toBe('');
    component.addressCountry = 'DE';
    component.addressPostalCode = '';
    expect(component.addressPostalHint()).toBe('adminUi.orders.addressValidate.postalInvalid');
    component.addressPostalCode = '10115';
    expect(component.addressPostalHint()).toBe('');
  });

  it('addressPostalSuggestion and applyAddressPostalSuggestion round-trip', () => {
    component.addressCountry = 'RO';
    component.addressPostalCode = '01 23 45';
    expect(component.addressPostalSuggestion()).toBe('012345');
    component.addressPostalCode = '012345';
    expect(component.addressPostalSuggestion()).toBeNull();
    component.applyAddressPostalSuggestion('  654321  ');
    expect(component.addressPostalCode).toBe('654321');
  });

  // ---------------------------------------------------------------------------
  // address editor
  // ---------------------------------------------------------------------------

  it('openAddressEditor is a no-op without an order or address', () => {
    component.order.set(null);
    component.openAddressEditor('shipping');
    expect(component.addressEditorOpen()).toBeFalse();

    component.order.set(makeOrder({ shipping_address: null }));
    component.openAddressEditor('shipping');
    expect(component.addressEditorOpen()).toBeFalse();
  });

  it('openAddressEditor populates the form for the shipping address', () => {
    component.order.set(
      makeOrder({
        shipping_address: {
          label: 'Home',
          phone: '+40721234567',
          line1: 'Str 1',
          line2: 'Ap 2',
          city: 'Cluj',
          region: 'CJ',
          postal_code: '400000',
          country: 'RO',
        } as any,
      }),
    );
    component.openAddressEditor('shipping');
    expect(component.addressEditorOpen()).toBeTrue();
    expect(component.addressEditorKind()).toBe('shipping');
    expect(component.addressLine1).toBe('Str 1');
    expect(component.addressCity).toBe('Cluj');
  });

  it('openAddressEditor populates the form for the billing address with blank defaults', () => {
    component.order.set(makeOrder({ billing_address: { line1: 'B1', city: 'B', postal_code: '1', country: 'RO' } as any }));
    component.openAddressEditor('billing');
    expect(component.addressEditorKind()).toBe('billing');
    expect(component.addressLabel).toBe('');
    expect(component.addressLine2).toBe('');
  });

  it('closeAddressEditor resets editor state', () => {
    component.addressEditorOpen.set(true);
    component.addressEditorError.set('err');
    component.closeAddressEditor();
    expect(component.addressEditorOpen()).toBeFalse();
    expect(component.addressEditorError()).toBeNull();
  });

  it('saveAddressEditor is a no-op without an order id', () => {
    (component as any).orderId = null;
    component.saveAddressEditor();
    expect(api.updateAddresses).not.toHaveBeenCalled();
  });

  it('saveAddressEditor saves a shipping address and closes on success', () => {
    prime();
    component.addressEditorKind.set('shipping');
    component.addressRerateShipping = true;
    component.addressLine1 = ' Str 1 ';
    component.addressCity = ' Cluj ';
    component.addressPostalCode = ' 400000 ';
    component.addressCountry = ' ro ';
    component.addressNote = '  ';
    const updated = makeOrder();
    api.updateAddresses.and.returnValue(of(updated));
    component.saveAddressEditor();
    const [, payload] = api.updateAddresses.calls.mostRecent().args as [string, any];
    expect(payload.rerate_shipping).toBeTrue();
    expect(payload.note).toBeNull();
    expect(payload.shipping_address.line1).toBe('Str 1');
    expect(payload.shipping_address.country).toBe('RO');
    expect(component.addressEditorOpen()).toBeFalse();
    expect(component.order()).toBe(updated);
  });

  it('saveAddressEditor saves a billing address with rerate disabled', () => {
    prime();
    component.addressEditorKind.set('billing');
    component.addressNote = 'please update';
    api.updateAddresses.and.returnValue(of(makeOrder()));
    component.saveAddressEditor();
    const [, payload] = api.updateAddresses.calls.mostRecent().args as [string, any];
    expect(payload.rerate_shipping).toBeFalse();
    expect(payload.billing_address).toBeDefined();
    expect(payload.note).toBe('please update');
  });

  it('saveAddressEditor surfaces errors with and without a detail', () => {
    prime();
    component.addressEditorKind.set('shipping');
    api.updateAddresses.and.returnValue(throwError(() => ({ error: { detail: 'bad addr' } })));
    component.saveAddressEditor();
    expect(component.addressEditorError()).toBe('bad addr');

    api.updateAddresses.and.returnValue(throwError(() => ({})));
    component.saveAddressEditor();
    expect(component.addressEditorError()).toBe('adminUi.orders.addressEdit.errors.update');
  });

  // ---------------------------------------------------------------------------
  // tracking validation + shipments
  // ---------------------------------------------------------------------------

  it('validateTrackingFields accepts empty values and valid urls but rejects bad ones', () => {
    const call = (n: string, u: string) =>
      (component as any).validateTrackingFields('dhl', n, u);
    expect(call('', '')).toBeNull();
    expect(call('AWB1', 'https://track.example.com/AWB1')).toBeNull();
    expect(call('AWB1', 'ftp://track.example.com')).toBe(
      'adminUi.orders.errors.invalidTrackingUrl',
    );
    expect(call('AWB1', 'not a url')).toBe('adminUi.orders.errors.invalidTrackingUrl');
  });

  it('openShipmentEditor seeds from an existing shipment and from scratch', () => {
    component.openShipmentEditor({
      id: 's1',
      order_id: 'o1',
      courier: 'dhl',
      tracking_number: 'T1',
      tracking_url: 'https://x',
      created_at: '2026-01-01T00:00:00Z',
    });
    expect((component as any).shipmentEditingId).toBe('s1');
    expect(component.shipmentTrackingNumber).toBe('T1');

    component.openShipmentEditor();
    expect((component as any).shipmentEditingId).toBeNull();
    expect(component.shipmentTrackingNumber).toBe('');
    expect(component.shipmentEditorOpen()).toBeTrue();
  });

  it('closeShipmentEditor resets all shipment fields', () => {
    component.shipmentEditorOpen.set(true);
    (component as any).shipmentEditingId = 's1';
    component.shipmentCourier = 'dhl';
    component.closeShipmentEditor();
    expect(component.shipmentEditorOpen()).toBeFalse();
    expect((component as any).shipmentEditingId).toBeNull();
    expect(component.shipmentCourier).toBe('');
  });

  it('saveShipmentEditor is a no-op without an order id', () => {
    (component as any).orderId = null;
    component.saveShipmentEditor();
    expect(api.createShipment).not.toHaveBeenCalled();
  });

  it('saveShipmentEditor requires a tracking number', () => {
    prime();
    component.shipmentTrackingNumber = '   ';
    component.saveShipmentEditor();
    expect(component.shipmentEditorError()).toBe(
      'adminUi.orders.shipments.errors.trackingRequired',
    );
    expect(api.createShipment).not.toHaveBeenCalled();
  });

  it('saveShipmentEditor rejects an invalid tracking url', () => {
    prime();
    component.shipmentTrackingNumber = 'T1';
    component.shipmentTrackingUrl = 'ftp://nope';
    component.saveShipmentEditor();
    expect(component.shipmentEditorError()).toBe('adminUi.orders.errors.invalidTrackingUrl');
    expect(api.createShipment).not.toHaveBeenCalled();
  });

  it('saveShipmentEditor creates a new shipment on success', () => {
    prime();
    (component as any).shipmentEditingId = null;
    component.shipmentTrackingNumber = 'T1';
    component.shipmentCourier = 'dhl';
    const updated = makeOrder();
    api.createShipment.and.returnValue(of(updated));
    component.saveShipmentEditor();
    expect(api.createShipment).toHaveBeenCalled();
    expect(component.order()).toBe(updated);
    expect(component.shipmentEditorOpen()).toBeFalse();
  });

  it('saveShipmentEditor updates an existing shipment on success', () => {
    prime();
    (component as any).shipmentEditingId = 's1';
    component.shipmentTrackingNumber = 'T2';
    api.updateShipment.and.returnValue(of(makeOrder()));
    component.saveShipmentEditor();
    expect(api.updateShipment).toHaveBeenCalled();
  });

  it('saveShipmentEditor surfaces errors with and without a detail', () => {
    prime();
    component.shipmentTrackingNumber = 'T1';
    api.createShipment.and.returnValue(throwError(() => ({ error: { detail: 'dup' } })));
    component.saveShipmentEditor();
    expect(component.shipmentEditorError()).toBe('dup');

    api.createShipment.and.returnValue(throwError(() => ({})));
    component.saveShipmentEditor();
    expect(component.shipmentEditorError()).toBe('adminUi.orders.shipments.errors.save');
  });

  it('deleteShipment guards against missing order id and handles success/error', () => {
    (component as any).orderId = null;
    component.deleteShipment('s1');
    expect(api.deleteShipment).not.toHaveBeenCalled();

    prime();
    const updated = makeOrder();
    api.deleteShipment.and.returnValue(of(updated));
    component.deleteShipment('s1');
    expect(component.order()).toBe(updated);

    api.deleteShipment.and.returnValue(throwError(() => ({ error: { detail: 'busy' } })));
    component.deleteShipment('s1');
    expect(toast.error).toHaveBeenCalledWith('busy');

    api.deleteShipment.and.returnValue(throwError(() => ({})));
    component.deleteShipment('s1');
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.shipments.errors.delete');
  });

  // ---------------------------------------------------------------------------
  // fulfillment
  // ---------------------------------------------------------------------------

  it('saveFulfillment is a no-op without an order id', () => {
    (component as any).orderId = null;
    component.saveFulfillment('item-1', 2);
    expect(api.fulfillItem).not.toHaveBeenCalled();
  });

  it('saveFulfillment clamps the quantity and refreshes from the response', () => {
    prime();
    component.fulfillmentQty = { 'item-1': 99 };
    const updated = makeOrder({
      items: [
        {
          id: 'item-1',
          product_id: 'p1',
          quantity: 2,
          shipped_quantity: 2,
          unit_price: 25,
          subtotal: 50,
        },
      ],
    });
    api.fulfillItem.and.returnValue(of(updated));
    component.saveFulfillment('item-1', 2);
    expect(api.fulfillItem).toHaveBeenCalledWith('order-1234567890', 'item-1', 2, {
      include_pii: true,
    });
    expect(component.fulfillmentQty['item-1']).toBe(2);
  });

  it('saveFulfillment coerces a non-finite quantity to zero', () => {
    prime();
    component.fulfillmentQty = { 'item-1': NaN as any };
    api.fulfillItem.and.returnValue(of(makeOrder()));
    component.saveFulfillment('item-1', 2);
    expect(api.fulfillItem).toHaveBeenCalledWith('order-1234567890', 'item-1', 0, {
      include_pii: true,
    });
  });

  it('saveFulfillment surfaces errors with and without a detail', () => {
    prime();
    api.fulfillItem.and.returnValue(throwError(() => ({ error: { detail: 'stock' } })));
    component.saveFulfillment('item-1', 2);
    expect(toast.error).toHaveBeenCalledWith('stock');

    api.fulfillItem.and.returnValue(throwError(() => ({})));
    component.saveFulfillment('item-1', 2);
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.items.fulfillError');
  });

  // ---------------------------------------------------------------------------
  // event diffs
  // ---------------------------------------------------------------------------

  it('canRefund reflects refundable statuses', () => {
    component.order.set(null);
    expect(component.canRefund()).toBeFalse();
    for (const status of ['paid', 'shipped', 'delivered']) {
      component.order.set(makeOrder({ status }));
      expect(component.canRefund()).toBeTrue();
    }
    component.order.set(makeOrder({ status: 'pending' }));
    expect(component.canRefund()).toBeFalse();
  });

  it('eventDiffRows builds rows from a structured changes payload', () => {
    const rows = component.eventDiffRows({
      id: 'e1',
      event: 'order_updated',
      created_at: '2026-01-01T00:00:00Z',
      data: { changes: { tracking_number: { from: 'A', to: 'B' } } },
    });
    expect(rows).toEqual([
      jasmine.objectContaining({ from: 'A', to: 'B' }),
    ]);
  });

  it('eventDiffRows parses a status_change note arrow when there are no structured changes', () => {
    const rows = component.eventDiffRows({
      id: 'e1',
      event: 'status_change',
      note: 'paid -> shipped',
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(rows.length).toBe(1);
    expect(rows[0].from).toBe('Paid');
    expect(rows[0].to).toBe('Shipped');
  });

  it('eventDiffRows parses a status_auto_ship note arrow', () => {
    const rows = component.eventDiffRows({
      id: 'e1',
      event: 'status_auto_ship',
      note: 'paid -> shipped',
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(rows.length).toBe(1);
  });

  it('eventDiffRows returns empty for unrelated events', () => {
    expect(
      component.eventDiffRows({
        id: 'e1',
        event: 'note_added',
        note: 'hello',
        created_at: '2026-01-01T00:00:00Z',
      }),
    ).toEqual([]);
  });

  it('eventChanges skips non-object and unchanged fields', () => {
    const rows = component.eventDiffRows({
      id: 'e1',
      event: 'order_updated',
      created_at: '2026-01-01T00:00:00Z',
      data: {
        changes: {
          bogus: 'not-an-object',
          status: { from: 'paid', to: 'paid' },
        },
      },
    });
    expect(rows).toEqual([]);
  });

  it('eventAddressDiff returns null for non-change payloads', () => {
    expect(
      component.eventAddressDiff({ id: 'e', event: 'x', created_at: 'c', data: null }),
    ).toBeNull();
    expect(
      component.eventAddressDiff({
        id: 'e',
        event: 'x',
        created_at: 'c',
        data: { changes: 'nope' } as any,
      }),
    ).toBeNull();
    expect(
      component.eventAddressDiff({
        id: 'e',
        event: 'x',
        created_at: 'c',
        data: { changes: { tracking_number: { from: 'a', to: 'b' } } },
      }),
    ).toBeNull();
  });

  it('eventAddressDiff extracts shipping and billing snapshots', () => {
    const diff = component.eventAddressDiff({
      id: 'e',
      event: 'address_changed',
      created_at: 'c',
      data: {
        changes: {
          shipping_address: { from: { city: 'A' }, to: { city: 'B' } },
          billing_address: { from: null, to: { city: 'C' } },
        },
      },
    });
    expect(diff!.shipping).toEqual({ from: { city: 'A' }, to: { city: 'B' } });
    expect(diff!.billing).toEqual({ from: null, to: { city: 'C' } });
  });

  it('formatAddressSnapshot renders a multi-line address or an em dash', () => {
    expect(component.formatAddressSnapshot(null)).toBe('—');
    expect(component.formatAddressSnapshot({})).toBe('—');
    const out = component.formatAddressSnapshot({
      label: 'Home',
      phone: '+40721234567',
      line1: 'Str 1',
      line2: 'Ap 2',
      city: 'Cluj',
      region: 'CJ',
      postal_code: '400000',
      country: 'RO',
    });
    expect(out).toContain('Home');
    expect(out).toContain('Cluj, CJ 400000');
    expect(out).toContain('RO');
  });

  it('diffLabel (via eventDiffRows) translates known fields and humanises unknown ones', () => {
    const labelFor = (field: string) =>
      component.eventDiffRows({
        id: 'e',
        event: 'order_updated',
        created_at: 'c',
        data: { changes: { [field]: { from: 'x', to: 'y' } } },
      })[0].label;
    expect(labelFor('tracking_url')).toBe('Tracking URL');
    expect(labelFor('courier')).toBe('Courier');
    expect(labelFor('shipping_method')).toBe('Shipping method');
    // status maps to a key with a translation -> the "found" branch
    expect(labelFor('status')).toBe('Status');
    // cancel_reason maps to a known key with no translation -> humanised fallback
    expect(labelFor('cancel_reason')).toBe('cancel reason');
    // unmapped field -> humanised fallback
    expect(labelFor('weird_field')).toBe('weird field');
  });

  it('diffValue (via eventDiffRows) translates known statuses and echoes unknown ones', () => {
    const rows = component.eventDiffRows({
      id: 'e',
      event: 'order_updated',
      created_at: 'c',
      data: { changes: { status: { from: 'paid', to: 'delivered' } } },
    });
    expect(rows[0].from).toBe('Paid');
    expect(rows[0].to).toBe('delivered');
  });

  it('diffValue (via eventDiffRows) handles types and blanks', () => {
    const rowFor = (from: unknown, to: unknown) =>
      component.eventDiffRows({
        id: 'e',
        event: 'order_updated',
        created_at: 'c',
        data: { changes: { note: { from, to } } },
      });
    expect(rowFor(null, 'set')[0]).toEqual(jasmine.objectContaining({ from: '—', to: 'set' }));
    expect(rowFor(5, 7)[0]).toEqual(jasmine.objectContaining({ from: '5', to: '7' }));
    expect(rowFor(true, false)[0]).toEqual(jasmine.objectContaining({ from: 'true', to: 'false' }));
    expect(rowFor(10n, 20n)[0]).toEqual(jasmine.objectContaining({ from: '10', to: '20' }));
    expect(rowFor({ a: 1 }, 'x')[0]).toEqual(jasmine.objectContaining({ from: '—', to: 'x' }));
    expect(rowFor('   ', 'x')[0]).toEqual(jasmine.objectContaining({ from: '—', to: 'x' }));
  });

  // ---------------------------------------------------------------------------
  // refunds
  // ---------------------------------------------------------------------------

  it('refundBreakdown computes the subtotal or null', () => {
    component.order.set(null);
    expect(component.refundBreakdown()).toBeNull();
    component.order.set(makeOrder());
    expect(component.refundBreakdown()).toEqual({
      subtotal: 70,
      shipping: 10,
      vat: 19,
      fee: 1,
      total: 100,
    });
  });

  it('refundsTotal and refundableRemaining account for prior refunds', () => {
    component.order.set(makeOrder({ refunds: [{ amount: 30 }, { amount: 20 }] as any }));
    expect(component.refundsTotal()).toBe(50);
    expect(component.refundableRemaining()).toBe(50);
    component.order.set(makeOrder({ total_amount: 10, refunds: [{ amount: 30 }] as any }));
    expect(component.refundableRemaining()).toBe(0);
  });

  it('openRefundWizard guards order id and refundability', () => {
    (component as any).orderId = null;
    component.openRefundWizard();
    expect(component.refundWizardOpen()).toBeFalse();

    prime(makeOrder({ status: 'pending' }));
    component.openRefundWizard();
    expect(component.refundWizardOpen()).toBeFalse();

    prime(makeOrder({ status: 'paid' }));
    component.openRefundWizard();
    expect(component.refundWizardOpen()).toBeTrue();
  });

  it('closeRefundWizard resets the wizard', () => {
    component.refundWizardOpen.set(true);
    component.refundNote = 'x';
    component.closeRefundWizard();
    expect(component.refundWizardOpen()).toBeFalse();
    expect(component.refundNote).toBe('');
  });

  it('requestRefund opens the refund wizard', () => {
    prime(makeOrder({ status: 'paid' }));
    component.requestRefund();
    expect(component.refundWizardOpen()).toBeTrue();
  });

  it('confirmRefund guards order id, refundability and a required note', () => {
    (component as any).orderId = null;
    component.confirmRefund();
    expect(api.requestRefund).not.toHaveBeenCalled();

    prime(makeOrder({ status: 'pending' }));
    component.confirmRefund();
    expect(api.requestRefund).not.toHaveBeenCalled();

    prime(makeOrder({ status: 'paid' }));
    component.refundNote = '   ';
    component.confirmRefund();
    expect(component.refundWizardError()).toBe('adminUi.orders.refundWizard.noteRequired');
    expect(api.requestRefund).not.toHaveBeenCalled();
  });

  it('confirmRefund submits and refreshes on success', () => {
    prime(makeOrder({ status: 'paid' }));
    component.refundWizardOpen.set(true);
    component.refundNote = 'refund please';
    api.requestRefund.and.returnValue(of(makeOrder()));
    api.get.and.returnValue(of(makeOrder()));
    component.confirmRefund();
    expect(api.requestRefund).toHaveBeenCalledWith('order-1234567890', { note: 'refund please' });
    expect(component.refundWizardOpen()).toBeFalse();
    expect(toast.success).toHaveBeenCalled();
  });

  it('confirmRefund surfaces errors with and without a detail', () => {
    prime(makeOrder({ status: 'paid' }));
    component.refundNote = 'note';
    api.requestRefund.and.returnValue(throwError(() => ({ error: { detail: 'no money' } })));
    component.confirmRefund();
    expect(component.refundWizardError()).toBe('no money');

    api.requestRefund.and.returnValue(throwError(() => ({})));
    component.confirmRefund();
    expect(component.refundWizardError()).toBe('adminUi.orders.errors.refund');
  });

  // ---------------------------------------------------------------------------
  // partial refunds
  // ---------------------------------------------------------------------------

  it('partialRefundQtyFor reads from the quantity map', () => {
    component.partialRefundQty = { 'item-1': 3 };
    expect(component.partialRefundQtyFor('item-1')).toBe(3);
    expect(component.partialRefundQtyFor('missing')).toBe(0);
  });

  it('partialRefundMaxQty subtracts already-refunded units', () => {
    component.order.set(
      makeOrder({
        refunds: [{ data: { items: [{ order_item_id: 'item-1', quantity: 1 }] } }] as any,
      }),
    );
    expect(component.partialRefundMaxQty({ id: 'item-1', quantity: 2 } as any)).toBe(1);
  });

  it('partialRefundAlreadyRefundedQty ignores malformed refund rows', () => {
    component.order.set(
      makeOrder({
        refunds: [
          { data: { items: 'not-array' } },
          { data: { items: [null, { order_item_id: 'other', quantity: 5 }, { order_item_id: 'item-1', quantity: -2 }, { order_item_id: 'item-1', quantity: 3 }] } },
        ] as any,
      }),
    );
    expect(component.partialRefundMaxQty({ id: 'item-1', quantity: 10 } as any)).toBe(7);
  });

  it('partialRefundLineTotal and selection total multiply quantity by price', () => {
    const order = makeOrder();
    component.order.set(order);
    component.partialRefundQty = { 'item-1': 2 };
    expect(component.partialRefundLineTotal(order.items[0])).toBe(50);
    expect(component.partialRefundSelectionTotal(order)).toBe(50);
  });

  it('canProcessPartialRefund depends on captured payment references', () => {
    component.order.set(null);
    expect(component.canProcessPartialRefund()).toBeFalse();
    component.order.set(makeOrder({ payment_method: 'stripe', stripe_payment_intent_id: 'pi_1' }));
    expect(component.canProcessPartialRefund()).toBeTrue();
    component.order.set(makeOrder({ payment_method: 'stripe', stripe_payment_intent_id: null }));
    expect(component.canProcessPartialRefund()).toBeFalse();
    component.order.set(makeOrder({ payment_method: 'paypal', paypal_capture_id: 'cap_1' }));
    expect(component.canProcessPartialRefund()).toBeTrue();
    component.order.set(makeOrder({ payment_method: 'cod' }));
    expect(component.canProcessPartialRefund()).toBeFalse();
  });

  it('processPartialRefundHint covers every method branch', () => {
    component.order.set(null);
    expect(component.processPartialRefundHint()).toBe('');
    component.order.set(makeOrder({ payment_method: 'stripe', stripe_payment_intent_id: 'pi' }));
    expect(component.processPartialRefundHint()).toBe(
      'adminUi.orders.partialRefundWizard.processPaymentHintSupported',
    );
    component.order.set(makeOrder({ payment_method: 'stripe', stripe_payment_intent_id: null }));
    expect(component.processPartialRefundHint()).toBe(
      'adminUi.orders.partialRefundWizard.processPaymentHintMissingStripe',
    );
    component.order.set(makeOrder({ payment_method: 'paypal', paypal_capture_id: null }));
    expect(component.processPartialRefundHint()).toBe(
      'adminUi.orders.partialRefundWizard.processPaymentHintMissingPaypal',
    );
    component.order.set(makeOrder({ payment_method: 'cod' }));
    expect(component.processPartialRefundHint()).toBe(
      'adminUi.orders.partialRefundWizard.processPaymentHintUnsupported',
    );
  });

  it('openPartialRefundWizard guards and seeds the quantity map', () => {
    (component as any).orderId = null;
    component.openPartialRefundWizard();
    expect(component.partialRefundWizardOpen()).toBeFalse();

    prime(makeOrder({ status: 'pending' }));
    component.openPartialRefundWizard();
    expect(component.partialRefundWizardOpen()).toBeFalse();

    prime(makeOrder({ status: 'paid' }));
    component.openPartialRefundWizard();
    expect(component.partialRefundWizardOpen()).toBeTrue();
    expect(component.partialRefundQty['item-1']).toBe(0);
    expect(component.partialRefundAmount).toBe('0.00');
  });

  it('closePartialRefundWizard resets state', () => {
    component.partialRefundWizardOpen.set(true);
    component.partialRefundNote = 'x';
    component.closePartialRefundWizard();
    expect(component.partialRefundWizardOpen()).toBeFalse();
    expect(component.partialRefundNote).toBe('');
  });

  it('setPartialRefundQty clamps numeric and string inputs and recomputes the amount', () => {
    prime(makeOrder({ status: 'paid' }));
    component.setPartialRefundQty('item-1', 5, 2);
    expect(component.partialRefundQty['item-1']).toBe(2);
    expect(component.partialRefundAmount).toBe('50.00');
    component.setPartialRefundQty('item-1', '1', 2);
    expect(component.partialRefundQty['item-1']).toBe(1);
    component.setPartialRefundQty('item-1', 'abc', 2);
    expect(component.partialRefundQty['item-1']).toBe(0);
  });

  it('setPartialRefundQty leaves the amount untouched without an order', () => {
    component.order.set(null);
    component.partialRefundAmount = 'unchanged';
    component.setPartialRefundQty('item-1', 1, 5);
    expect(component.partialRefundAmount).toBe('unchanged');
  });

  it('adjustPartialRefundQty applies a delta', () => {
    prime(makeOrder({ status: 'paid' }));
    component.partialRefundQty = { 'item-1': 1 };
    component.adjustPartialRefundQty('item-1', 1, 5);
    expect(component.partialRefundQty['item-1']).toBe(2);
  });

  it('confirmPartialRefund guards order id, refundability, note, items and amount', () => {
    (component as any).orderId = null;
    component.confirmPartialRefund();
    expect(api.createPartialRefund).not.toHaveBeenCalled();

    prime(makeOrder({ status: 'pending' }));
    component.confirmPartialRefund();
    expect(api.createPartialRefund).not.toHaveBeenCalled();

    prime(makeOrder({ status: 'paid' }));
    component.partialRefundNote = '  ';
    component.confirmPartialRefund();
    expect(component.partialRefundWizardError()).toBe(
      'adminUi.orders.partialRefundWizard.noteRequired',
    );

    component.partialRefundNote = 'note';
    component.partialRefundQty = { 'item-1': 0 };
    component.confirmPartialRefund();
    expect(component.partialRefundWizardError()).toBe(
      'adminUi.orders.partialRefundWizard.itemsRequired',
    );

    component.partialRefundQty = { 'item-1': 1 };
    component.partialRefundAmount = '0';
    component.confirmPartialRefund();
    expect(component.partialRefundWizardError()).toBe(
      'adminUi.orders.partialRefundWizard.amountRequired',
    );
  });

  it('confirmPartialRefund rejects an amount above the refundable remaining', () => {
    prime(makeOrder({ status: 'paid', total_amount: 30 }));
    component.partialRefundNote = 'note';
    component.partialRefundQty = { 'item-1': 1 };
    component.partialRefundAmount = '999';
    component.confirmPartialRefund();
    expect(component.partialRefundWizardError()).toBe(
      'adminUi.orders.partialRefundWizard.amountTooHigh',
    );
  });

  it('confirmPartialRefund submits with process_payment when supported', () => {
    prime(makeOrder({ status: 'paid', payment_method: 'stripe', stripe_payment_intent_id: 'pi' }));
    component.partialRefundNote = 'note';
    component.partialRefundQty = { 'item-1': 1 };
    component.partialRefundAmount = '25';
    component.partialRefundProcessPayment = true;
    api.createPartialRefund.and.returnValue(of(makeOrder() as any));
    api.get.and.returnValue(of(makeOrder()));
    component.confirmPartialRefund();
    const [, payload] = api.createPartialRefund.calls.mostRecent().args as [string, any];
    expect(payload.amount).toBe('25.00');
    expect(payload.process_payment).toBeTrue();
    expect(payload.items).toEqual([{ order_item_id: 'item-1', quantity: 1 }]);
    expect(component.partialRefundWizardOpen()).toBeFalse();
  });

  it('confirmPartialRefund surfaces errors with and without a detail', () => {
    prime(makeOrder({ status: 'paid' }));
    component.partialRefundNote = 'note';
    component.partialRefundQty = { 'item-1': 1 };
    component.partialRefundAmount = '25';
    api.createPartialRefund.and.returnValue(throwError(() => ({ error: { detail: 'declined' } })));
    component.confirmPartialRefund();
    expect(component.partialRefundWizardError()).toBe('declined');

    api.createPartialRefund.and.returnValue(throwError(() => ({})));
    component.confirmPartialRefund();
    expect(component.partialRefundWizardError()).toBe('adminUi.orders.errors.partialRefund');
  });

  // ---------------------------------------------------------------------------
  // admin notes + tags
  // ---------------------------------------------------------------------------

  it('addAdminNote guards order id and requires a note', () => {
    (component as any).orderId = null;
    component.addAdminNote();
    expect(api.addAdminNote).not.toHaveBeenCalled();

    prime();
    component.adminNoteText = '   ';
    component.addAdminNote();
    expect(component.adminNoteError()).toBe('adminUi.orders.errors.noteRequired');
  });

  it('addAdminNote posts the note and reloads on success', () => {
    prime();
    component.adminNoteText = 'hello';
    api.addAdminNote.and.returnValue(of(makeOrder() as any));
    api.get.and.returnValue(of(makeOrder()));
    component.addAdminNote();
    expect(api.addAdminNote).toHaveBeenCalledWith('order-1234567890', 'hello');
    expect(component.adminNoteText).toBe('');
  });

  it('addAdminNote surfaces errors with and without a detail', () => {
    prime();
    component.adminNoteText = 'hello';
    api.addAdminNote.and.returnValue(throwError(() => ({ error: { detail: 'boom' } })));
    component.addAdminNote();
    expect(component.adminNoteError()).toBe('boom');

    component.adminNoteText = 'hello';
    api.addAdminNote.and.returnValue(throwError(() => ({})));
    component.addAdminNote();
    expect(component.adminNoteError()).toBe('adminUi.orders.errors.note');
  });

  it('addTag guards order id and an empty tag', () => {
    (component as any).orderId = null;
    component.addTag();
    expect(api.addOrderTag).not.toHaveBeenCalled();

    prime();
    component.tagToAdd = '  ';
    component.addTag();
    expect(api.addOrderTag).not.toHaveBeenCalled();
  });

  it('addTag posts the tag and clears the selector on success', () => {
    prime();
    component.tagToAdd = 'vip';
    const updated = makeOrder({ tags: ['vip'] });
    api.addOrderTag.and.returnValue(of(updated));
    component.addTag();
    expect(api.addOrderTag).toHaveBeenCalledWith('order-1234567890', 'vip', { include_pii: true });
    expect(component.tagToAdd).toBe('');
    expect(component.order()).toBe(updated);
  });

  it('addTag surfaces errors with and without a detail', () => {
    prime();
    component.tagToAdd = 'vip';
    api.addOrderTag.and.returnValue(throwError(() => ({ error: { detail: 'dup tag' } })));
    component.addTag();
    expect(toast.error).toHaveBeenCalledWith('dup tag');

    component.tagToAdd = 'vip';
    api.addOrderTag.and.returnValue(throwError(() => ({})));
    component.addTag();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.tags.errors.add');
  });

  it('isTestOrder reflects the test tag', () => {
    component.order.set(makeOrder({ tags: ['test'] }));
    expect(component.isTestOrder()).toBeTrue();
    component.order.set(makeOrder({ tags: [] }));
    expect(component.isTestOrder()).toBeFalse();
  });

  it('toggleTestTag guards order id and busy state', () => {
    (component as any).orderId = null;
    component.toggleTestTag();
    expect(api.addOrderTag).not.toHaveBeenCalled();

    prime();
    component.action.set('save');
    component.toggleTestTag();
    expect(api.addOrderTag).not.toHaveBeenCalled();
  });

  it('toggleTestTag adds the test tag when absent', () => {
    prime(makeOrder({ tags: [] }));
    const updated = makeOrder({ tags: ['test'] });
    api.addOrderTag.and.returnValue(of(updated));
    component.toggleTestTag();
    expect(api.addOrderTag).toHaveBeenCalledWith('order-1234567890', 'test', { include_pii: true });
    expect(component.order()).toBe(updated);
  });

  it('toggleTestTag removes the test tag when present', () => {
    prime(makeOrder({ tags: ['test'] }));
    api.removeOrderTag.and.returnValue(of(makeOrder({ tags: [] })));
    component.toggleTestTag();
    expect(api.removeOrderTag).toHaveBeenCalledWith('order-1234567890', 'test', {
      include_pii: true,
    });
  });

  it('removeTag guards order id and empty values', () => {
    (component as any).orderId = null;
    component.removeTag('vip');
    expect(api.removeOrderTag).not.toHaveBeenCalled();

    prime();
    component.removeTag('   ');
    expect(api.removeOrderTag).not.toHaveBeenCalled();
  });

  it('removeTag removes the tag on success', () => {
    prime();
    const updated = makeOrder({ tags: [] });
    api.removeOrderTag.and.returnValue(of(updated));
    component.removeTag('vip');
    expect(api.removeOrderTag).toHaveBeenCalledWith('order-1234567890', 'vip', {
      include_pii: true,
    });
    expect(component.order()).toBe(updated);
  });

  it('removeTag surfaces errors with and without a detail', () => {
    prime();
    api.removeOrderTag.and.returnValue(throwError(() => ({ error: { detail: 'locked' } })));
    component.removeTag('vip');
    expect(toast.error).toHaveBeenCalledWith('locked');

    api.removeOrderTag.and.returnValue(throwError(() => ({})));
    component.removeTag('vip');
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.tags.errors.remove');
  });

  // ---------------------------------------------------------------------------
  // save
  // ---------------------------------------------------------------------------

  it('save is a no-op without an order', () => {
    component.order.set(null);
    component.save();
    expect(api.update).not.toHaveBeenCalled();
  });

  it('save requires a cancel reason when cancelling', () => {
    prime(makeOrder({ status: 'paid' }));
    component.statusValue = 'cancelled';
    component.cancelReason = '   ';
    component.save();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.errors.cancelReasonRequired');
    expect(api.update).not.toHaveBeenCalled();
  });

  it('save aborts when the tracking url is invalid', () => {
    prime(makeOrder({ status: 'paid' }));
    component.statusValue = 'paid';
    component.trackingUrl = 'ftp://bad';
    component.save();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.errors.invalidTrackingUrl');
    expect(api.update).not.toHaveBeenCalled();
  });

  it('save submits changed status, tracking and cancel reason', () => {
    prime(makeOrder({ status: 'paid', tracking_number: '', tracking_url: '' }));
    component.statusValue = 'cancelled';
    component.cancelReason = 'customer request';
    component.trackingNumber = 'AWB9';
    component.trackingUrl = 'https://track/AWB9';
    const updated = makeOrder({ status: 'cancelled', cancel_reason: 'customer request' });
    api.update.and.returnValue(of(updated));
    component.save();
    const [, payload] = api.update.calls.mostRecent().args as [string, any];
    expect(payload.status).toBe('cancelled');
    expect(payload.cancel_reason).toBe('customer request');
    expect(payload.tracking_number).toBe('AWB9');
    expect(payload.tracking_url).toBe('https://track/AWB9');
    expect(component.order()).toBe(updated);
    expect(toast.success).toHaveBeenCalled();
  });

  it('save omits unchanged fields', () => {
    prime(makeOrder({ status: 'paid', tracking_number: 'SAME', tracking_url: 'https://same' }));
    component.statusValue = 'paid';
    component.trackingNumber = 'SAME';
    component.trackingUrl = 'https://same';
    api.update.and.returnValue(of(makeOrder({ status: 'paid' })));
    component.save();
    const [, payload] = api.update.calls.mostRecent().args as [string, any];
    expect(payload.status).toBeUndefined();
    expect(payload.tracking_number).toBeUndefined();
    expect(payload.tracking_url).toBeUndefined();
    expect(payload.cancel_reason).toBeUndefined();
  });

  it('save surfaces a string error detail and a translated fallback', () => {
    prime(makeOrder({ status: 'paid' }));
    component.statusValue = 'shipped';
    api.update.and.returnValue(throwError(() => ({ error: { detail: 'conflict' } })));
    component.save();
    expect(toast.error).toHaveBeenCalledWith('conflict');

    api.update.and.returnValue(throwError(() => ({ error: { detail: '   ' } })));
    component.save();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.errors.status');
  });

  it('onStatusValueChange clears the cancel reason unless cancelling', () => {
    component.cancelReason = 'keep?';
    component.onStatusValueChange('shipped');
    expect(component.cancelReason).toBe('');
    component.cancelReason = 'keep';
    component.onStatusValueChange('cancelled');
    expect(component.cancelReason).toBe('keep');
  });

  // ---------------------------------------------------------------------------
  // shipping label
  // ---------------------------------------------------------------------------

  it('shippingLabelFileName shows the chosen file or a placeholder', () => {
    expect(component.shippingLabelFileName()).toBe('adminUi.orders.shippingLabelNoFile');
    component.shippingLabelFile = new File(['x'], 'label.pdf');
    expect(component.shippingLabelFileName()).toBe('label.pdf');
  });

  it('onShippingLabelSelected stores the file and resets the input', () => {
    const file = new File(['x'], 'label.pdf');
    const input = { files: { item: (i: number) => (i === 0 ? file : null) }, value: 'c:/fakepath' };
    component.onShippingLabelSelected({ target: input } as any);
    expect(component.shippingLabelFile).toBe(file);
    expect(input.value).toBe('');

    component.onShippingLabelSelected({ target: null } as any);
    expect(component.shippingLabelFile).toBeNull();
  });

  it('uploadShippingLabel is a no-op without an order id or a file', () => {
    component.order.set(null);
    component.shippingLabelFile = new File(['x'], 'l.pdf');
    component.uploadShippingLabel();
    expect(api.uploadShippingLabel).not.toHaveBeenCalled();

    prime();
    component.shippingLabelFile = null;
    component.uploadShippingLabel();
    expect(api.uploadShippingLabel).not.toHaveBeenCalled();
  });

  it('uploadShippingLabel uploads on success and reports failures', () => {
    prime();
    component.shippingLabelFile = new File(['x'], 'l.pdf');
    const updated = makeOrder({ has_shipping_label: true });
    api.uploadShippingLabel.and.returnValue(of(updated));
    component.uploadShippingLabel();
    expect(component.order()).toBe(updated);
    expect(component.shippingLabelFile).toBeNull();

    component.shippingLabelFile = new File(['x'], 'l.pdf');
    api.uploadShippingLabel.and.returnValue(throwError(() => new Error('x')));
    component.uploadShippingLabel();
    expect(component.shippingLabelError()).toBe('adminUi.orders.errors.shippingLabelUpload');
  });

  it('downloadShippingLabel triggers a browser download and reloads', () => {
    prime(makeOrder({ shipping_label_filename: 'my-label.pdf' }));
    const click = jasmine.createSpy('click');
    spyOn(document, 'createElement').and.returnValue({ href: '', download: '', click } as any);
    spyOn(URL, 'createObjectURL').and.returnValue('blob:1');
    spyOn(URL, 'revokeObjectURL');
    api.downloadShippingLabel.and.returnValue(of(new Blob(['x'])));
    api.get.and.returnValue(of(makeOrder()));
    component.downloadShippingLabel();
    expect(click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('downloadShippingLabel is a no-op without an order id and reports errors', () => {
    component.order.set(null);
    component.downloadShippingLabel();
    expect(api.downloadShippingLabel).not.toHaveBeenCalled();

    prime(makeOrder({ shipping_label_filename: null, reference_code: null }));
    api.downloadShippingLabel.and.returnValue(throwError(() => new Error('x')));
    component.downloadShippingLabel();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.errors.shippingLabelDownload');
  });

  it('printShippingLabel triggers a browser download and reloads', () => {
    prime(makeOrder({ shipping_label_filename: null, reference_code: null }));
    const click = jasmine.createSpy('click');
    spyOn(document, 'createElement').and.returnValue({ href: '', download: '', click } as any);
    spyOn(URL, 'createObjectURL').and.returnValue('blob:1');
    spyOn(URL, 'revokeObjectURL');
    api.downloadShippingLabel.and.returnValue(of(new Blob(['x'])));
    api.get.and.returnValue(of(makeOrder()));
    component.printShippingLabel();
    expect(click).toHaveBeenCalled();
  });

  it('printShippingLabel is a no-op without an order id and reports errors', () => {
    component.order.set(null);
    component.printShippingLabel();
    expect(api.downloadShippingLabel).not.toHaveBeenCalled();

    prime();
    api.downloadShippingLabel.and.returnValue(throwError(() => new Error('x')));
    component.printShippingLabel();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.errors.shippingLabelDownload');
  });

  it('deleteShippingLabel guards order id, confirmation, and handles results', () => {
    component.order.set(null);
    component.deleteShippingLabel();
    expect(api.deleteShippingLabel).not.toHaveBeenCalled();

    prime();
    spyOn(window, 'confirm').and.returnValues(false, true, true);
    component.deleteShippingLabel();
    expect(api.deleteShippingLabel).not.toHaveBeenCalled();

    api.deleteShippingLabel.and.returnValue(of(undefined));
    api.get.and.returnValue(of(makeOrder()));
    component.deleteShippingLabel();
    expect(toast.success).toHaveBeenCalled();

    api.deleteShippingLabel.and.returnValue(throwError(() => new Error('x')));
    component.deleteShippingLabel();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.errors.shippingLabelDelete');
  });

  it('shippingLabelHistory filters, sorts and caps label events', () => {
    component.order.set(null);
    expect(component.shippingLabelHistory()).toEqual([]);
    const order = makeOrder({
      events: [
        { id: '1', event: 'shipping_label_uploaded', created_at: '2026-01-01T00:00:00Z' },
        { id: '2', event: 'order_updated', created_at: '2026-01-02T00:00:00Z' },
        { id: '3', event: 'shipping_label_downloaded', created_at: '2026-01-03T00:00:00Z' },
        { id: '4', event: 'shipping_label_printed', created_at: '2026-01-03T00:00:00Z' },
      ],
    });
    component.order.set(order);
    const history = component.shippingLabelHistory();
    expect(history.map((h) => h.event)).toEqual([
      'shipping_label_downloaded',
      'shipping_label_printed',
      'shipping_label_uploaded',
    ]);
  });

  it('shippingLabelEventLabel maps known events and echoes unknown ones', () => {
    expect(component.shippingLabelEventLabel('shipping_label_uploaded')).toBe(
      'adminUi.orders.shippingLabelEvents.uploaded',
    );
    expect(component.shippingLabelEventLabel('shipping_label_downloaded')).toBe(
      'adminUi.orders.shippingLabelEvents.downloaded',
    );
    expect(component.shippingLabelEventLabel('shipping_label_printed')).toBe(
      'adminUi.orders.shippingLabelEvents.printed',
    );
    expect(component.shippingLabelEventLabel('shipping_label_deleted')).toBe(
      'adminUi.orders.shippingLabelEvents.deleted',
    );
    expect(component.shippingLabelEventLabel('other')).toBe('other');
  });

  // ---------------------------------------------------------------------------
  // payment + comms actions
  // ---------------------------------------------------------------------------

  it('retryPayment guards order id and handles success/error', () => {
    (component as any).orderId = null;
    component.retryPayment();
    expect(api.retryPayment).not.toHaveBeenCalled();

    prime();
    api.retryPayment.and.returnValue(of(makeOrder() as any));
    api.get.and.returnValue(of(makeOrder()));
    component.retryPayment();
    expect(toast.success).toHaveBeenCalled();

    api.retryPayment.and.returnValue(throwError(() => new Error('x')));
    component.retryPayment();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.errors.retry');
  });

  it('voidPayment guards order id and handles success/error', () => {
    (component as any).orderId = null;
    component.voidPayment();
    expect(api.voidPayment).not.toHaveBeenCalled();

    prime();
    api.voidPayment.and.returnValue(of(makeOrder() as any));
    api.get.and.returnValue(of(makeOrder()));
    component.voidPayment();
    expect(toast.success).toHaveBeenCalled();

    api.voidPayment.and.returnValue(throwError(() => new Error('x')));
    component.voidPayment();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.errors.void');
  });

  it('sendDeliveryEmail guards order id and handles success/error', () => {
    (component as any).orderId = null;
    component.sendDeliveryEmail();
    expect(api.sendDeliveryEmail).not.toHaveBeenCalled();

    prime();
    api.sendDeliveryEmail.and.returnValue(of(makeOrder() as any));
    component.sendDeliveryEmail();
    expect(toast.success).toHaveBeenCalled();

    api.sendDeliveryEmail.and.returnValue(throwError(() => new Error('x')));
    component.sendDeliveryEmail();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.errors.deliveryEmail');
  });

  it('downloadPackingSlip guards order id, downloads and reports errors', () => {
    (component as any).orderId = null;
    component.downloadPackingSlip();
    expect(api.downloadPackingSlip).not.toHaveBeenCalled();

    prime();
    const click = jasmine.createSpy('click');
    spyOn(document, 'createElement').and.returnValue({ href: '', download: '', click } as any);
    spyOn(URL, 'createObjectURL').and.returnValue('blob:1');
    spyOn(URL, 'revokeObjectURL');
    api.downloadPackingSlip.and.returnValue(of(new Blob(['x'])));
    component.downloadPackingSlip();
    expect(click).toHaveBeenCalled();

    api.downloadPackingSlip.and.returnValue(throwError(() => new Error('x')));
    component.downloadPackingSlip();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.errors.packingSlip');
  });

  it('downloadReceiptPdf guards order id, downloads and reports errors', () => {
    (component as any).orderId = null;
    component.downloadReceiptPdf();
    expect(api.downloadReceiptPdf).not.toHaveBeenCalled();

    prime();
    const click = jasmine.createSpy('click');
    spyOn(document, 'createElement').and.returnValue({ href: '', download: '', click } as any);
    spyOn(URL, 'createObjectURL').and.returnValue('blob:1');
    spyOn(URL, 'revokeObjectURL');
    api.downloadReceiptPdf.and.returnValue(of(new Blob(['x'])));
    component.downloadReceiptPdf();
    expect(click).toHaveBeenCalled();

    api.downloadReceiptPdf.and.returnValue(throwError(() => new Error('x')));
    component.downloadReceiptPdf();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.errors.receiptPdf');
  });

  // ---------------------------------------------------------------------------
  // receipt sharing
  // ---------------------------------------------------------------------------

  it('shareReceipt is a no-op without an order id', () => {
    (component as any).orderId = null;
    component.shareReceipt();
    expect(api.shareReceipt).not.toHaveBeenCalled();
  });

  it('shareReceipt reuses a still-valid cached token without calling the API', fakeAsync(() => {
    prime();
    component.receiptShare.set({
      token: 't',
      receipt_url: 'https://r/abc',
      receipt_pdf_url: 'https://r/abc.pdf',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    const copySpy = spyOn(component as any, 'copyToClipboard').and.returnValue(
      Promise.resolve(true),
    );
    component.shareReceipt();
    tick();
    expect(copySpy).toHaveBeenCalledWith('https://r/abc');
    expect(api.shareReceipt).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('adminUi.orders.receiptLinks.copied');
  }));

  it('shareReceipt reports the not-copied fallback for a valid cached token', fakeAsync(() => {
    prime();
    component.receiptShare.set({
      token: 't',
      receipt_url: 'https://r/abc',
      receipt_pdf_url: 'https://r/abc.pdf',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    spyOn(component as any, 'copyToClipboard').and.returnValue(Promise.resolve(false));
    component.shareReceipt();
    tick();
    expect(toast.success).toHaveBeenCalledWith('adminUi.orders.receiptLinks.ready');
  }));

  it('shareReceipt requests a new token and reports the not-copied fallback', fakeAsync(() => {
    prime();
    component.receiptShare.set(null);
    spyOn(component as any, 'copyToClipboard').and.returnValue(Promise.resolve(false));
    api.shareReceipt.and.returnValue(
      of({
        token: 't',
        receipt_url: 'https://r/new',
        receipt_pdf_url: 'https://r/new.pdf',
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      }),
    );
    component.shareReceipt();
    tick();
    expect(api.shareReceipt).toHaveBeenCalledWith('order-1234567890');
    expect(toast.success).toHaveBeenCalledWith('adminUi.orders.receiptLinks.ready');
  }));

  it('shareReceipt reports a copied confirmation for a freshly minted token', fakeAsync(() => {
    prime();
    component.receiptShare.set(null);
    spyOn(component as any, 'copyToClipboard').and.returnValue(Promise.resolve(true));
    api.shareReceipt.and.returnValue(
      of({
        token: 't',
        receipt_url: 'https://r/new',
        receipt_pdf_url: 'https://r/new.pdf',
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      }),
    );
    component.shareReceipt();
    tick();
    expect(toast.success).toHaveBeenCalledWith('adminUi.orders.receiptLinks.copied');
  }));

  it('shareReceipt requests a new token when the cached one is expired', fakeAsync(() => {
    prime();
    component.receiptShare.set({
      token: 't',
      receipt_url: 'https://r/old',
      receipt_pdf_url: 'https://r/old.pdf',
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    spyOn(component as any, 'copyToClipboard').and.returnValue(Promise.resolve(true));
    api.shareReceipt.and.returnValue(
      of({
        token: 't2',
        receipt_url: 'https://r/fresh',
        receipt_pdf_url: 'https://r/fresh.pdf',
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      }),
    );
    component.shareReceipt();
    tick();
    expect(api.shareReceipt).toHaveBeenCalled();
  }));

  it('shareReceipt surfaces errors with and without a detail', () => {
    prime();
    component.receiptShare.set(null);
    api.shareReceipt.and.returnValue(throwError(() => ({ error: { detail: 'no share' } })));
    component.shareReceipt();
    expect(toast.error).toHaveBeenCalledWith('no share');

    api.shareReceipt.and.returnValue(throwError(() => ({})));
    component.shareReceipt();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.errors.receiptShare');
  });

  it('revokeReceiptShare guards order id and confirmation', () => {
    (component as any).orderId = null;
    component.revokeReceiptShare();
    expect(api.revokeReceiptShare).not.toHaveBeenCalled();

    prime();
    spyOn(window, 'confirm').and.returnValues(false, true, true, true);
    component.revokeReceiptShare();
    expect(api.revokeReceiptShare).not.toHaveBeenCalled();

    api.revokeReceiptShare.and.returnValue(of({} as any));
    component.revokeReceiptShare();
    expect(component.receiptShare()).toBeNull();
    expect(toast.success).toHaveBeenCalled();

    api.revokeReceiptShare.and.returnValue(throwError(() => ({ error: { detail: 'cannot' } })));
    component.revokeReceiptShare();
    expect(toast.error).toHaveBeenCalledWith('cannot');

    api.revokeReceiptShare.and.returnValue(throwError(() => ({})));
    component.revokeReceiptShare();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.errors.receiptRevoke');
  });

  it('copyToClipboard resolves true on success and false on rejection or absence', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
    await expectAsync((component as any).copyToClipboard('x')).toBeResolvedTo(true);

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });
    await expectAsync((component as any).copyToClipboard('x')).toBeResolvedTo(false);

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    await expectAsync((component as any).copyToClipboard('x')).toBeResolvedTo(false);

    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else delete (navigator as any).clipboard;
  });

  it('copyToClipboard returns false when navigator is undefined', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
    try {
      await expectAsync((component as any).copyToClipboard('x')).toBeResolvedTo(false);
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
    }
  });

  // ---------------------------------------------------------------------------
  // returns + comms
  // ---------------------------------------------------------------------------

  it('toggleReturnCreate opens with a fresh quantity map and toggles closed', () => {
    component.order.set(makeOrder());
    component.toggleReturnCreate();
    expect(component.showReturnCreate()).toBeTrue();
    expect(component.returnQty['item-1']).toBe(0);
    component.toggleReturnCreate();
    expect(component.showReturnCreate()).toBeFalse();
  });

  it('toggleReturnCreate opens even without an order', () => {
    component.order.set(null);
    component.toggleReturnCreate();
    expect(component.showReturnCreate()).toBeTrue();
  });

  it('createReturnRequest guards order, reason and selected items', () => {
    component.order.set(null);
    component.createReturnRequest();
    expect(returnsApi.create).not.toHaveBeenCalled();

    component.order.set(makeOrder());
    component.returnReason = '   ';
    component.createReturnRequest();
    expect(component.returnCreateError()).toBe('adminUi.returns.create.reasonRequired');

    component.returnReason = 'broken';
    component.returnQty = { 'item-1': 0 };
    component.createReturnRequest();
    expect(component.returnCreateError()).toBe('adminUi.returns.create.itemsRequired');
  });

  it('createReturnRequest submits clamped items and reloads on success', () => {
    component.order.set(makeOrder());
    component.returnReason = 'broken';
    component.returnCustomerMessage = '  sorry  ';
    component.returnQty = { 'item-1': 99 };
    returnsApi.create.and.returnValue(of({} as any));
    returnsApi.listByOrder.and.returnValue(of([]));
    component.createReturnRequest();
    const payload = returnsApi.create.calls.mostRecent().args[0];
    expect(payload.items).toEqual([{ order_item_id: 'item-1', quantity: 2 }]);
    expect(payload.customer_message).toBe('sorry');
    expect(component.showReturnCreate()).toBeFalse();
    expect(component.creatingReturn()).toBeFalse();
  });

  it('createReturnRequest sends a null customer message when blank', () => {
    component.order.set(makeOrder());
    component.returnReason = 'broken';
    component.returnCustomerMessage = '   ';
    component.returnQty = { 'item-1': 1 };
    returnsApi.create.and.returnValue(of({} as any));
    component.createReturnRequest();
    expect(returnsApi.create.calls.mostRecent().args[0].customer_message).toBeNull();
  });

  it('createReturnRequest surfaces errors with and without a detail', () => {
    component.order.set(makeOrder());
    component.returnReason = 'broken';
    component.returnQty = { 'item-1': 1 };
    returnsApi.create.and.returnValue(throwError(() => ({ error: { detail: 'dup return' } })));
    component.createReturnRequest();
    expect(component.returnCreateError()).toBe('dup return');

    returnsApi.create.and.returnValue(throwError(() => ({})));
    component.createReturnRequest();
    expect(component.returnCreateError()).toBe('adminUi.returns.create.errors.create');
  });

  it('loadReturns populates rows or an error state', () => {
    returnsApi.listByOrder.and.returnValue(of([{ id: 'r1' } as any]));
    (component as any).loadReturns('order-1234567890');
    expect(component.returnRequests().length).toBe(1);
    expect(component.returnsLoading()).toBeFalse();

    returnsApi.listByOrder.and.returnValue(throwError(() => new Error('x')));
    (component as any).loadReturns('order-1234567890');
    expect(component.returnsError()).toBe('adminUi.returns.errors.load');
  });

  it('loadReturns defaults to an empty list when the API returns null', () => {
    returnsApi.listByOrder.and.returnValue(of(null as any));
    (component as any).loadReturns('order-1234567890');
    expect(component.returnRequests()).toEqual([]);
  });

  it('reloadComms guards order id and loads on success/error', () => {
    (component as any).orderId = null;
    component.reloadComms();
    api.listEmailEvents.calls.reset();
    component.reloadComms();
    expect(api.listEmailEvents).not.toHaveBeenCalled();

    prime();
    api.listEmailEvents.and.returnValue(of([{ id: 'm1' } as any]));
    component.reloadComms();
    expect(component.commsEvents().length).toBe(1);
    expect(component.commsLoading()).toBeFalse();

    api.listEmailEvents.and.returnValue(of(null as any));
    component.reloadComms();
    expect(component.commsEvents()).toEqual([]);

    api.listEmailEvents.and.returnValue(throwError(() => ({ error: { detail: 'mail down' } })));
    component.reloadComms();
    expect(component.commsError()).toBe('mail down');

    api.listEmailEvents.and.returnValue(throwError(() => ({})));
    component.reloadComms();
    expect(component.commsError()).toBe('adminUi.orders.comms.errors.load');
  });

  // ---------------------------------------------------------------------------
  // null/empty fallback (?? / ||) branch coverage
  // ---------------------------------------------------------------------------

  it('hasPaymentCaptured copes with null orders and missing capture references', () => {
    const call = (o: any) => (component as any).hasPaymentCaptured(o);
    expect(call(null)).toBeFalse();
    expect(call({ payment_method: 'paypal', paypal_capture_id: null })).toBeFalse();
    expect(call({ payment_method: 'stripe', events: null })).toBeFalse();
    expect(call({ payment_method: 'stripe', events: [{ event: null }] })).toBeFalse();
    expect(call({ payment_method: 'paypal', paypal_capture_id: 'cap' })).toBeTrue();
  });

  it('paymentCaptureBlocked handles a missing payment method and a falsy status', () => {
    prime(makeOrder({ status: 'pending_acceptance', payment_method: undefined }));
    expect(component.paymentCaptureBlocked()).toBeFalse();

    prime(makeOrder({ status: undefined as any, payment_method: 'stripe', events: [] }));
    component.statusValue = 'pending_acceptance';
    expect(component.paymentCaptureBlocked()).toBeTrue();
  });

  it('statusOptions tolerates an unknown current status with no transitions', () => {
    prime(makeOrder({ status: 'mystery-status' as any }));
    expect(component.statusOptions().length).toBe(7);
  });

  it('refreshNav defaults missing items and meta safely', () => {
    component.navEnabled.set(true);
    (component as any).navContext = { page: 1, limit: 20 };
    api.search.and.returnValue(of({ meta: { total_pages: 1 } } as any));
    (component as any).refreshNav('cur');
    expect(component.navPrev()).toBeNull();

    (component as any).navContext = { page: 2, limit: 20 };
    api.search.and.returnValues(of({ items: [{ id: 'cur' }] } as any), of({} as any));
    (component as any).refreshNav('cur');
    expect(component.navPrev()).toBeNull();

    (component as any).navContext = { page: 1, limit: 20 };
    api.search.and.returnValues(
      of({ items: [{ id: 'first' }, { id: 'cur' }], meta: { total_pages: 3 } } as any),
      of({} as any),
    );
    (component as any).refreshNav('cur');
    expect(component.navNext()).toBeNull();
  });

  it('onDocumentKeydown tolerates an event without a key', () => {
    prime();
    spyOn(component, 'save');
    component.onDocumentKeydown({
      ctrlKey: false,
      target: document.body,
      preventDefault: () => {},
    } as any);
    expect(component.save).not.toHaveBeenCalled();
  });

  it('shouldIgnoreShortcut tolerates a target without a tagName', () => {
    expect(
      (component as any).shouldIgnoreShortcut({
        defaultPrevented: false,
        target: { isContentEditable: false },
      }),
    ).toBeFalse();
  });

  it('customerLabel falls back to guest when email and username are nullish', () => {
    component.order.set(
      makeOrder({ customer_email: undefined, customer_username: undefined }),
    );
    expect(component.customerLabel()).toBe('adminUi.orders.guest');
  });

  it('addressIssueKeys tolerates an address with no country', () => {
    const issues = component.addressIssueKeys(
      { line1: 'x', city: 'y', postal_code: '10115', phone: '+49301234567' } as any,
      'billing',
    );
    expect(issues).toEqual([]);
  });

  it('cleanPhoneValue returns empty for nullish and blank input', () => {
    const call = (p: any) => (component as any).cleanPhoneValue(p);
    expect(call(null)).toBe('');
    expect(call('')).toBe('');
  });

  it('phoneState reports a missing shipping phone when it collapses to empty', () => {
    const issues = component.addressIssueKeys(
      { line1: 'x', city: 'y', postal_code: '012345', country: 'RO', phone: '()-' } as any,
      'shipping',
    );
    expect(issues).toContain('adminUi.orders.addressValidate.phoneMissing');
  });

  it('applyAddressPhoneSuggestion and applyAddressPostalSuggestion accept nullish values', () => {
    component.applyAddressPhoneSuggestion(null as any);
    expect(component.addressPhone).toBe('');
    component.applyAddressPostalSuggestion(null as any);
    expect(component.addressPostalCode).toBe('');
  });

  it('emailStatus helpers tolerate empty status', () => {
    expect(component.emailStatusLabel('')).toBe('');
    expect(component.emailStatusChipClass('')).toContain('slate');
  });

  it('openAddressEditor blanks out every nullish field', () => {
    component.order.set(makeOrder({ shipping_address: {} as any }));
    component.openAddressEditor('shipping');
    expect(component.addressLine1).toBe('');
    expect(component.addressCity).toBe('');
    expect(component.addressPostalCode).toBe('');
    expect(component.addressCountry).toBe('');
  });

  it('courierName handles a nullish courier', () => {
    expect(component.courierName(null)).toBe('—');
  });

  it('validateTrackingFields treats nullish values as empty', () => {
    expect((component as any).validateTrackingFields('dhl', null, null)).toBeNull();
  });

  it('openShipmentEditor blanks nullish shipment fields', () => {
    component.openShipmentEditor({
      id: 's1',
      order_id: 'o1',
      courier: null,
      tracking_number: null as any,
      tracking_url: null,
      created_at: 'c',
    });
    expect(component.shipmentCourier).toBe('');
    expect(component.shipmentTrackingNumber).toBe('');
    expect(component.shipmentTrackingUrl).toBe('');
  });

  it('saveFulfillment defaults a nullish max quantity to zero', () => {
    prime();
    component.fulfillmentQty = { 'item-1': 5 };
    api.fulfillItem.and.returnValue(
      of(makeOrder({ items: [{ id: 'item-1', product_id: 'p', quantity: 0, unit_price: 0, subtotal: 0 }] as any })),
    );
    component.saveFulfillment('item-1', null as any);
    expect(api.fulfillItem).toHaveBeenCalledWith('order-1234567890', 'item-1', 0, {
      include_pii: true,
    });
  });

  it('saveFulfillment defaults a missing shipped_quantity when refreshing', () => {
    prime();
    api.fulfillItem.and.returnValue(
      of(makeOrder({ items: [{ id: 'i9', product_id: 'p', quantity: 1, unit_price: 1, subtotal: 1 }] as any })),
    );
    component.saveFulfillment('item-1', 2);
    expect(component.fulfillmentQty['i9']).toBe(0);
  });

  it('saveFulfillment tolerates a response without items', () => {
    prime();
    api.fulfillItem.and.returnValue(of(makeOrder({ items: undefined as any })));
    component.saveFulfillment('item-1', 2);
    expect(component.fulfillmentQty).toEqual({});
  });

  it('canProcessPartialRefund and the hint handle a nullish payment method', () => {
    component.order.set(makeOrder({ payment_method: undefined }));
    expect(component.canProcessPartialRefund()).toBeFalse();
    expect(component.processPartialRefundHint()).toBe(
      'adminUi.orders.partialRefundWizard.processPaymentHintUnsupported',
    );
  });

  it('paymentMethodLabel defaults a nullish payment method to an em dash', () => {
    component.order.set(makeOrder({ payment_method: undefined }));
    expect(component.paymentMethodLabel()).toBe('—');
  });

  it('eventDiffRows tolerates nullish note and event values', () => {
    expect(
      component.eventDiffRows({ id: 'e', event: null as any, note: 'x', created_at: 'c' }),
    ).toEqual([]);
    expect(
      component.eventDiffRows({ id: 'e', event: 'status_change', note: null, created_at: 'c' }),
    ).toEqual([]);
  });

  it('eventDiffRows falls back to a note arrow when changes is null or an array', () => {
    expect(
      component.eventDiffRows({
        id: 'e',
        event: 'status_change',
        note: 'paid -> shipped',
        created_at: 'c',
        data: { changes: null } as any,
      }).length,
    ).toBe(1);
    expect(
      component.eventDiffRows({
        id: 'e',
        event: 'status_change',
        note: 'paid -> shipped',
        created_at: 'c',
        data: { changes: [1, 2] } as any,
      }).length,
    ).toBe(1);
    expect(
      component.eventDiffRows({
        id: 'e',
        event: 'status_change',
        note: 'paid -> shipped',
        created_at: 'c',
        data: { changes: 'str' } as any,
      }).length,
    ).toBe(1);
  });

  it('eventAddressDiff defaults missing from/to snapshots to null', () => {
    const diff = component.eventAddressDiff({
      id: 'e',
      event: 'address_changed',
      created_at: 'c',
      data: { changes: { shipping_address: {}, billing_address: {} } },
    });
    expect(diff!.shipping).toEqual({ from: null, to: null });
    expect(diff!.billing).toEqual({ from: null, to: null });
  });

  it('refundBreakdown defaults nullish money fields to zero', () => {
    component.order.set(
      makeOrder({
        total_amount: undefined as any,
        shipping_amount: undefined,
        tax_amount: undefined,
        fee_amount: undefined,
      }),
    );
    expect(component.refundBreakdown()).toEqual({
      subtotal: 0,
      shipping: 0,
      vat: 0,
      fee: 0,
      total: 0,
    });
  });

  it('isTestOrder tolerates a null order and missing tags', () => {
    component.order.set(null);
    expect(component.isTestOrder()).toBeFalse();
    component.order.set(makeOrder({ tags: undefined }));
    expect(component.isTestOrder()).toBeFalse();
  });

  it('toggleTestTag error messages cover detail-present and both add/remove fallbacks', () => {
    prime(makeOrder({ tags: [] }));
    api.addOrderTag.and.returnValue(throwError(() => ({ error: { detail: 'explicit' } })));
    component.toggleTestTag();
    expect(toast.error).toHaveBeenCalledWith('explicit');

    prime(makeOrder({ tags: [] }));
    api.addOrderTag.and.returnValue(throwError(() => ({})));
    component.toggleTestTag();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.tags.errors.add');

    prime(makeOrder({ tags: ['test'] }));
    api.removeOrderTag.and.returnValue(throwError(() => ({})));
    component.toggleTestTag();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.tags.errors.remove');
  });

  it('removeTag tolerates a nullish tag', () => {
    prime();
    component.removeTag(null as any);
    expect(api.removeOrderTag).not.toHaveBeenCalled();
  });

  it('fraudReviewStatus tolerates missing tags and null entries', () => {
    component.order.set(makeOrder({ tags: undefined }));
    expect(component.fraudReviewStatus()).toBeNull();
    component.order.set(makeOrder({ tags: [null as any, 'fraud_approved'] }));
    expect(component.fraudReviewStatus()).toBe('approved');
  });

  it('refundsTotal and refundableRemaining default nullish amounts and a null order', () => {
    component.order.set(makeOrder({ refunds: [{ amount: null }, null] as any }));
    expect(component.refundsTotal()).toBe(0);
    component.order.set(null);
    expect(component.refundableRemaining()).toBe(0);
  });

  it('partial refund quantity helpers default nullish item and refund fields', () => {
    component.order.set(null);
    expect(component.partialRefundMaxQty({ id: 'item-1', quantity: 5 } as any)).toBe(5);
    expect(component.partialRefundMaxQty({ id: 'item-1', quantity: null } as any)).toBe(0);

    component.order.set(
      makeOrder({
        refunds: [
          {
            data: {
              items: [
                { order_item_id: null, quantity: 9 },
                { order_item_id: 'item-1', quantity: null },
                { order_item_id: 'item-1', quantity: 5 },
              ],
            },
          },
        ] as any,
      }),
    );
    expect(component.partialRefundMaxQty({ id: 'item-1', quantity: 1 } as any)).toBe(0);
  });

  it('partialRefundLineTotal and selection total default nullish prices and items', () => {
    component.partialRefundQty = { 'item-1': 2 };
    expect(component.partialRefundLineTotal({ id: 'item-1', unit_price: null } as any)).toBe(0);
    expect(component.partialRefundSelectionTotal({ items: undefined } as any)).toBe(0);
  });

  it('openPartialRefundWizard tolerates an order without items', () => {
    prime(makeOrder({ status: 'paid', items: undefined as any }));
    component.openPartialRefundWizard();
    expect(component.partialRefundWizardOpen()).toBeTrue();
    expect(component.partialRefundAmount).toBe('0.00');
  });

  it('deliveryTypeLabel defaults a nullish delivery type to an em dash', () => {
    component.order.set(makeOrder({ delivery_type: null }));
    expect(component.deliveryTypeLabel()).toBe('—');
  });

  it('save tolerates a falsy current and response status, and clears tracking to null', () => {
    prime(makeOrder({ status: undefined as any, tracking_number: 'OLD', tracking_url: 'https://old' }));
    component.statusValue = 'paid';
    component.trackingNumber = '';
    component.trackingUrl = '';
    api.update.and.returnValue(of(makeOrder({ status: undefined as any })));
    component.save();
    const [, payload] = api.update.calls.mostRecent().args as [string, any];
    expect(payload.tracking_number).toBeNull();
    expect(payload.tracking_url).toBeNull();
    expect(component.statusValue).toBe('pending_acceptance');
  });

  it('downloadPackingSlip uses the orderId fallback when the reference is empty', () => {
    prime(makeOrder({ id: '', reference_code: null }));
    (component as any).orderId = 'pkid';
    const a: any = { href: '', download: '', click: jasmine.createSpy('click') };
    spyOn(document, 'createElement').and.returnValue(a);
    spyOn(URL, 'createObjectURL').and.returnValue('blob:1');
    spyOn(URL, 'revokeObjectURL');
    api.downloadPackingSlip.and.returnValue(of(new Blob(['x'])));
    component.downloadPackingSlip();
    expect(a.download).toBe('order-pkid.pdf');
  });

  it('downloadReceiptPdf uses the orderId fallback when the reference is empty', () => {
    prime(makeOrder({ id: '', reference_code: null }));
    (component as any).orderId = 'rcid';
    const a: any = { href: '', download: '', click: jasmine.createSpy('click') };
    spyOn(document, 'createElement').and.returnValue(a);
    spyOn(URL, 'createObjectURL').and.returnValue('blob:1');
    spyOn(URL, 'revokeObjectURL');
    api.downloadReceiptPdf.and.returnValue(of(new Blob(['x'])));
    component.downloadReceiptPdf();
    expect(a.download).toBe('receipt-rcid.pdf');
  });

  it('downloadShippingLabel falls back to a generated filename', () => {
    prime(makeOrder({ shipping_label_filename: null }));
    const a: any = { href: '', download: '', click: jasmine.createSpy('click') };
    spyOn(document, 'createElement').and.returnValue(a);
    spyOn(URL, 'createObjectURL').and.returnValue('blob:1');
    spyOn(URL, 'revokeObjectURL');
    api.downloadShippingLabel.and.returnValue(of(new Blob(['x'])));
    api.get.and.returnValue(of(makeOrder()));
    component.downloadShippingLabel();
    expect(a.download).toContain('-label');
  });

  it('shippingLabelHistory tolerates events with a blank event name', () => {
    component.order.set(
      makeOrder({
        events: [
          { id: '1', event: '', created_at: '2026-01-01T00:00:00Z' },
          { id: '2', event: 'shipping_label_uploaded', created_at: '2026-01-05T00:00:00Z' },
          { id: '3', event: 'shipping_label_printed', created_at: '2026-01-02T00:00:00Z' },
        ],
      }),
    );
    expect(component.shippingLabelHistory().map((h) => h.event)).toEqual([
      'shipping_label_uploaded',
      'shipping_label_printed',
    ]);
  });

  it('load defaults missing items collections and shipped quantities', () => {
    const order = makeOrder({
      items: [{ id: 'a', product_id: 'p', quantity: 1, unit_price: 1, subtotal: 1 } as any],
    });
    api.get.and.returnValue(of(order));
    paramMap$.next(makeParamMap({ orderId: order.id }));
    component.ngOnInit();
    expect(component.fulfillmentQty['a']).toBe(0);
    expect(component.returnQty['a']).toBe(0);
  });

  it('load tolerates an order without an items collection', () => {
    const order = makeOrder({ items: undefined as any });
    api.get.and.returnValue(of(order));
    paramMap$.next(makeParamMap({ orderId: order.id }));
    component.ngOnInit();
    expect(component.fulfillmentQty).toEqual({});
    expect(component.returnQty).toEqual({});
  });

  it('toggleReturnCreate tolerates an order without items', () => {
    component.order.set(makeOrder({ items: undefined as any }));
    component.toggleReturnCreate();
    expect(component.showReturnCreate()).toBeTrue();
    expect(component.returnQty).toEqual({});
  });

  it('createReturnRequest defaults missing items and nullish quantities', () => {
    component.order.set(
      makeOrder({ items: [{ id: 'x', product_id: 'p', quantity: null as any, unit_price: 0, subtotal: 0 }] }),
    );
    component.returnReason = 'broken';
    component.returnQty = {};
    component.createReturnRequest();
    expect(component.returnCreateError()).toBe('adminUi.returns.create.itemsRequired');
  });

  it('createReturnRequest tolerates an order without an items collection', () => {
    component.order.set(makeOrder({ items: undefined as any }));
    component.returnReason = 'broken';
    component.createReturnRequest();
    expect(component.returnCreateError()).toBe('adminUi.returns.create.itemsRequired');
  });
});
