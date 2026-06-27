import { fakeAsync, tick } from '@angular/core/testing';
import { of, throwError, Subject } from 'rxjs';

import { AdminOrderDetail } from '../../../core/admin-orders.service';
import { OrderItem } from '../../../core/account.service';
import { AdminOrderDetailComponent } from './admin-order-detail.component';

type OrdersSpy = jasmine.SpyObj<{
  search: (...args: unknown[]) => unknown;
  get: (...args: unknown[]) => unknown;
  listEmailEvents: (...args: unknown[]) => unknown;
  update: (...args: unknown[]) => unknown;
  reviewFraud: (...args: unknown[]) => unknown;
  updateAddresses: (...args: unknown[]) => unknown;
  createShipment: (...args: unknown[]) => unknown;
  updateShipment: (...args: unknown[]) => unknown;
  deleteShipment: (...args: unknown[]) => unknown;
  fulfillItem: (...args: unknown[]) => unknown;
  uploadShippingLabel: (...args: unknown[]) => unknown;
  downloadShippingLabel: (...args: unknown[]) => unknown;
  deleteShippingLabel: (...args: unknown[]) => unknown;
  retryPayment: (...args: unknown[]) => unknown;
  voidPayment: (...args: unknown[]) => unknown;
  requestRefund: (...args: unknown[]) => unknown;
  createPartialRefund: (...args: unknown[]) => unknown;
  addAdminNote: (...args: unknown[]) => unknown;
  addOrderTag: (...args: unknown[]) => unknown;
  removeOrderTag: (...args: unknown[]) => unknown;
  sendDeliveryEmail: (...args: unknown[]) => unknown;
  downloadPackingSlip: (...args: unknown[]) => unknown;
  downloadReceiptPdf: (...args: unknown[]) => unknown;
  shareReceipt: (...args: unknown[]) => unknown;
  revokeReceiptShare: (...args: unknown[]) => unknown;
}>;

function makeItem(over: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'item-1',
    product_id: 'prod-1',
    product: { id: 'prod-1', slug: 'slug', name: 'Product One' },
    quantity: 2,
    shipped_quantity: 0,
    unit_price: 10,
    subtotal: 20,
    ...over,
  };
}

function makeOrder(over: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  return {
    id: 'order-1234567890ab',
    reference_code: 'REF-1',
    status: 'paid',
    payment_method: 'cod',
    total_amount: 100,
    currency: 'RON',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    items: [makeItem()],
    ...over,
  } as AdminOrderDetail;
}

function paramMap(obj: Record<string, string>): { get: (k: string) => string | null } {
  return { get: (k: string) => (k in obj ? obj[k] : null) };
}

interface Ctx {
  cmp: AdminOrderDetailComponent;
  api: OrdersSpy;
  returnsApi: jasmine.SpyObj<{
    listByOrder: (...a: unknown[]) => unknown;
    create: (...a: unknown[]) => unknown;
  }>;
  toast: jasmine.SpyObj<{ success: (m: string) => void; error: (m: string) => void }>;
  recent: jasmine.SpyObj<{ add: (i: unknown) => void }>;
  router: jasmine.SpyObj<{ navigate: (...a: unknown[]) => Promise<boolean> }>;
  translate: { instant: jasmine.Spy };
  query: Subject<{ get: (k: string) => string | null }>;
  param: Subject<{ get: (k: string) => string | null }>;
}

function setup(): Ctx {
  const api = jasmine.createSpyObj('AdminOrdersService', [
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
  ]) as OrdersSpy;
  const returnsApi = jasmine.createSpyObj('AdminReturnsService', ['listByOrder', 'create']);
  const toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
  const recent = jasmine.createSpyObj('AdminRecentService', ['add']);
  const router = jasmine.createSpyObj('Router', ['navigate']);
  const translate = { instant: jasmine.createSpy('instant').and.callFake((k: string) => k) };

  const order = makeOrder();
  api.search.and.returnValue(of({ items: [], meta: {} }));
  api.get.and.returnValue(of(order));
  api.listEmailEvents.and.returnValue(of([]));
  api.update.and.returnValue(of(order));
  api.reviewFraud.and.returnValue(of(order));
  api.updateAddresses.and.returnValue(of(order));
  api.createShipment.and.returnValue(of(order));
  api.updateShipment.and.returnValue(of(order));
  api.deleteShipment.and.returnValue(of(order));
  api.fulfillItem.and.returnValue(of(order));
  api.uploadShippingLabel.and.returnValue(of(order));
  api.downloadShippingLabel.and.returnValue(of(new Blob(['x'])));
  api.deleteShippingLabel.and.returnValue(of(undefined));
  api.retryPayment.and.returnValue(of(order));
  api.voidPayment.and.returnValue(of(order));
  api.requestRefund.and.returnValue(of(order));
  api.createPartialRefund.and.returnValue(of(order));
  api.addAdminNote.and.returnValue(of(order));
  api.addOrderTag.and.returnValue(of(order));
  api.removeOrderTag.and.returnValue(of(order));
  api.sendDeliveryEmail.and.returnValue(of(order));
  api.downloadPackingSlip.and.returnValue(of(new Blob(['x'])));
  api.downloadReceiptPdf.and.returnValue(of(new Blob(['x'])));
  api.shareReceipt.and.returnValue(
    of({
      token: 't',
      receipt_url: 'https://r/x',
      receipt_pdf_url: 'https://r/p',
      expires_at: '2999-01-01T00:00:00Z',
    }),
  );
  api.revokeReceiptShare.and.returnValue(
    of({ token: 't', receipt_url: '', receipt_pdf_url: '', expires_at: '' }),
  );
  returnsApi.listByOrder.and.returnValue(of([]));
  returnsApi.create.and.returnValue(of({}));

  const query = new Subject<{ get: (k: string) => string | null }>();
  const param = new Subject<{ get: (k: string) => string | null }>();
  const route = { queryParamMap: query.asObservable(), paramMap: param.asObservable() } as never;

  const cmp = new AdminOrderDetailComponent(
    route,
    router as never,
    api as never,
    returnsApi as never,
    toast as never,
    translate as never,
    recent as never,
  );
  return { cmp, api, returnsApi, toast, recent, router, translate, query, param };
}

describe('AdminOrderDetailComponent', () => {
  it('constructs', () => {
    const { cmp } = setup();
    expect(cmp).toBeTruthy();
    expect(cmp.loading()).toBeTrue();
  });

  describe('ngOnInit', () => {
    it('loads the order and disables nav when no nav query param', () => {
      const c = setup();
      c.cmp.ngOnInit();
      c.query.next(paramMap({}));
      c.param.next(paramMap({ orderId: 'order-1234567890ab' }));
      expect(c.cmp.navEnabled()).toBeFalse();
      expect(c.api.get).toHaveBeenCalled();
      expect(c.cmp.order()).toBeTruthy();
    });

    it('errors when route has no orderId', () => {
      const c = setup();
      c.cmp.ngOnInit();
      c.query.next(paramMap({}));
      c.param.next(paramMap({}));
      expect(c.cmp.error()).toBe('adminUi.orders.notFound');
      expect(c.cmp.loading()).toBeFalse();
    });

    it('enables nav context from query params and refreshes nav', () => {
      const c = setup();
      c.api.search.and.returnValue(
        of({ items: [{ id: 'order-1234567890ab' }], meta: { total_pages: 1 } }),
      );
      c.cmp.ngOnInit();
      c.param.next(paramMap({ orderId: 'order-1234567890ab' }));
      c.query.next(
        paramMap({
          nav: '1',
          nav_page: '2',
          nav_limit: '10',
          nav_q: 'foo',
          nav_status: 'paid',
          nav_sla: 'due',
          nav_fraud: 'high',
          nav_tag: 'vip',
          nav_from: 'a',
          nav_to: 'b',
          nav_include_test: '0',
        }),
      );
      expect(c.cmp.navEnabled()).toBeTrue();
      expect(c.api.search).toHaveBeenCalled();
    });
  });

  describe('applyNavContext / refreshNav', () => {
    it('clamps invalid page/limit and ignores empty optional filters', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp['applyNavContext'](
        paramMap({ nav: '1', nav_page: 'NaN', nav_limit: '500', nav_include_test: '1' }) as never,
      );
      const ctx = c.cmp['navContext'];
      expect(ctx?.page).toBe(1);
      expect(ctx?.limit).toBe(100);
      expect(ctx?.q).toBeUndefined();
      expect(ctx?.include_test).toBeUndefined();
    });

    it('resets nav state when disabled', () => {
      const c = setup();
      c.cmp.navEnabled.set(true);
      c.cmp['applyNavContext'](paramMap({}) as never);
      expect(c.cmp.navEnabled()).toBeFalse();
      expect(c.cmp['navContext']).toBeNull();
    });

    it('does not refresh nav at the end when no orderId is set', () => {
      const c = setup();
      c.cmp['orderId'] = null;
      c.cmp['applyNavContext'](paramMap({ nav: '1', nav_page: '1', nav_limit: '20' }) as never);
      expect(c.api.search).not.toHaveBeenCalled();
    });

    it('clears prev/next when refreshNav called without context', () => {
      const c = setup();
      c.cmp.navPrev.set({ id: 'x', page: 1 });
      c.cmp['refreshNav']('order-1234567890ab');
      expect(c.cmp.navPrev()).toBeNull();
      expect(c.cmp.navNext()).toBeNull();
    });

    it('sets prev and next for a middle order', () => {
      const c = setup();
      c.cmp.navEnabled.set(true);
      c.cmp['navContext'] = {
        page: 1,
        limit: 20,
        q: 'q',
        status: 's',
        sla: 'sl',
        fraud: 'f',
        tag: 't',
        from: 'fr',
        to: 'to',
        include_test: false,
      };
      c.api.search.and.returnValue(
        of({
          items: [{ id: 'a' }, { id: 'order-1234567890ab' }, { id: 'b' }],
          meta: { total_pages: 1 },
        }),
      );
      c.cmp['refreshNav']('order-1234567890ab');
      expect(c.cmp.navPrev()).toEqual({ id: 'a', page: 1 });
      expect(c.cmp.navNext()).toEqual({ id: 'b', page: 1 });
    });

    it('looks up the previous page when the order is first', () => {
      const c = setup();
      c.cmp.navEnabled.set(true);
      c.cmp['navContext'] = { page: 2, limit: 20 };
      c.api.search.and.returnValues(
        of({ items: [{ id: 'order-1234567890ab' }, { id: 'b' }], meta: { total_pages: 3 } }),
        of({ items: [{ id: 'z0' }, { id: 'prev-last' }], meta: {} }),
      );
      c.cmp['refreshNav']('order-1234567890ab');
      expect(c.cmp.navPrev()).toEqual({ id: 'prev-last', page: 1 });
      expect(c.cmp.navNext()).toEqual({ id: 'b', page: 2 });
    });

    it('ignores an empty previous page and swallows its error', () => {
      const c = setup();
      c.cmp.navEnabled.set(true);
      c.cmp['navContext'] = { page: 2, limit: 20 };
      c.api.search.and.returnValues(
        of({ items: [{ id: 'order-1234567890ab' }, { id: 'b' }], meta: { total_pages: 3 } }),
        of({ items: [] }),
      );
      c.cmp['refreshNav']('order-1234567890ab');
      expect(c.cmp.navPrev()).toBeNull();

      c.api.search.and.returnValues(
        of({ items: [{ id: 'order-1234567890ab' }, { id: 'b' }], meta: { total_pages: 3 } }),
        throwError(() => new Error('boom')),
      );
      c.cmp['refreshNav']('order-1234567890ab');
      expect(c.cmp.navPrev()).toBeNull();
    });

    it('looks up the next page when the order is last', () => {
      const c = setup();
      c.cmp.navEnabled.set(true);
      c.cmp['navContext'] = { page: 1, limit: 20 };
      c.api.search.and.returnValues(
        of({ items: [{ id: 'a' }, { id: 'order-1234567890ab' }], meta: { total_pages: 3 } }),
        of({ items: [{ id: 'next-first' }] }),
      );
      c.cmp['refreshNav']('order-1234567890ab');
      expect(c.cmp.navNext()).toEqual({ id: 'next-first', page: 2 });
      expect(c.cmp.navPrev()).toEqual({ id: 'a', page: 1 });
    });

    it('ignores an empty next page and swallows its error', () => {
      const c = setup();
      c.cmp.navEnabled.set(true);
      c.cmp['navContext'] = { page: 1, limit: 20 };
      c.api.search.and.returnValues(
        of({ items: [{ id: 'a' }, { id: 'order-1234567890ab' }], meta: { total_pages: 3 } }),
        of({ items: [] }),
      );
      c.cmp['refreshNav']('order-1234567890ab');
      expect(c.cmp.navNext()).toBeNull();

      c.api.search.and.returnValues(
        of({ items: [{ id: 'a' }, { id: 'order-1234567890ab' }], meta: { total_pages: 3 } }),
        throwError(() => new Error('boom')),
      );
      c.cmp['refreshNav']('order-1234567890ab');
      expect(c.cmp.navNext()).toBeNull();
    });

    it('uses page as total when meta is missing and clears on error', () => {
      const c = setup();
      c.cmp.navEnabled.set(true);
      c.cmp['navContext'] = { page: 1, limit: 20 };
      c.api.search.and.returnValue(of({ items: [{ id: 'order-1234567890ab' }] }));
      c.cmp['refreshNav']('order-1234567890ab');
      expect(c.cmp.navPrev()).toBeNull();

      c.api.search.and.returnValue(throwError(() => new Error('x')));
      c.cmp['refreshNav']('order-1234567890ab');
      expect(c.cmp.navNext()).toBeNull();
    });
  });

  describe('goPrev / goNext / navigateWithNav', () => {
    it('does nothing when there is no target', () => {
      const c = setup();
      c.cmp.goPrev();
      c.cmp.goNext();
      expect(c.router.navigate).not.toHaveBeenCalled();
    });

    it('navigates with full nav query params', () => {
      const c = setup();
      c.cmp['navContext'] = {
        page: 1,
        limit: 20,
        q: 'q',
        status: 's',
        sla: 'sl',
        fraud: 'f',
        tag: 't',
        from: 'fr',
        to: 'to',
        include_test: false,
      };
      c.cmp.navPrev.set({ id: 'p', page: 1 });
      c.cmp.navNext.set({ id: 'n', page: 2 });
      c.cmp.goPrev();
      c.cmp.goNext();
      expect(c.router.navigate).toHaveBeenCalledTimes(2);
    });

    it('navigates without query params when no context', () => {
      const c = setup();
      c.cmp['navContext'] = null;
      c.cmp.navPrev.set({ id: 'p', page: 1 });
      c.cmp.goPrev();
      expect(c.router.navigate).toHaveBeenCalledWith(['/admin/orders', 'p']);
    });
  });

  describe('keyboard shortcuts', () => {
    function key(over: Partial<KeyboardEvent> = {}): KeyboardEvent {
      return {
        key: 's',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        defaultPrevented: false,
        target: null,
        preventDefault: () => undefined,
        ...over,
      } as KeyboardEvent;
    }

    it('ignores shortcuts from editable targets and prevented events', () => {
      const c = setup();
      c.cmp.order.set(makeOrder());
      c.cmp.loading.set(false);
      const saveSpy = spyOn(c.cmp, 'save');
      c.cmp.onDocumentKeydown(key({ defaultPrevented: true }));
      c.cmp.onDocumentKeydown(key({ target: { tagName: 'INPUT' } as HTMLElement }));
      c.cmp.onDocumentKeydown(
        key({ target: { tagName: 'DIV', isContentEditable: true } as HTMLElement }),
      );
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('returns when no order / loading / error / action active', () => {
      const c = setup();
      const saveSpy = spyOn(c.cmp, 'save');
      c.cmp.order.set(null);
      c.cmp.loading.set(false);
      c.cmp.onDocumentKeydown(key({ ctrlKey: true }));
      c.cmp.order.set(makeOrder());
      c.cmp.action.set('save');
      c.cmp.onDocumentKeydown(key({ ctrlKey: true }));
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('triggers save, refund and packing slip via shortcuts', () => {
      const c = setup();
      c.cmp.order.set(makeOrder({ status: 'paid' }));
      c.cmp.loading.set(false);
      c.cmp['orderId'] = 'order-1234567890ab';
      const saveSpy = spyOn(c.cmp, 'save');
      const refundSpy = spyOn(c.cmp, 'openRefundWizard');
      const slipSpy = spyOn(c.cmp, 'downloadPackingSlip');
      c.cmp.onDocumentKeydown(
        key({ ctrlKey: true, key: 'S', target: { tagName: 'BODY' } as HTMLElement }),
      );
      c.cmp.onDocumentKeydown(
        key({ shiftKey: true, key: 'R', target: { tagName: 'BODY' } as HTMLElement }),
      );
      c.cmp.onDocumentKeydown(
        key({ shiftKey: true, key: 'P', target: { tagName: 'BODY' } as HTMLElement }),
      );
      c.cmp.onDocumentKeydown(key({ key: 'x', target: { tagName: 'BODY' } as HTMLElement }));
      expect(saveSpy).toHaveBeenCalled();
      expect(refundSpy).toHaveBeenCalled();
      expect(slipSpy).toHaveBeenCalled();
    });

    it('treats a missing target as not editable', () => {
      const c = setup();
      expect(c.cmp['shouldIgnoreShortcut'](key({ target: null }))).toBeFalse();
    });
  });

  describe('display helpers', () => {
    it('statusChipClass delegates to the helper', () => {
      const { cmp } = setup();
      expect(cmp.statusChipClass('paid')).toContain('indigo');
    });

    it('crumbs uses the order reference when present and falls back', () => {
      const { cmp } = setup();
      expect(cmp.crumbs().length).toBe(4);
      cmp.order.set(makeOrder({ reference_code: 'REF-9' }));
      expect(cmp.crumbs()[3].label).toContain('REF-9');
    });

    it('orderRef returns empty, reference, or sliced id', () => {
      const { cmp } = setup();
      expect(cmp.orderRef()).toBe('');
      cmp.order.set(makeOrder({ reference_code: 'REF-2' }));
      expect(cmp.orderRef()).toBe('REF-2');
      cmp.order.set(makeOrder({ reference_code: null, id: 'abcdefghij' }));
      expect(cmp.orderRef()).toBe('abcdefgh');
    });

    it('customerLabel covers all branches', () => {
      const { cmp } = setup();
      expect(cmp.customerLabel()).toBe('');
      cmp.order.set(makeOrder({ customer_email: 'a@b.com', customer_username: 'amy' }));
      expect(cmp.customerLabel()).toBe('a@b.com (amy)');
      cmp.order.set(makeOrder({ customer_email: 'a@b.com', customer_username: null }));
      expect(cmp.customerLabel()).toBe('a@b.com');
      cmp.order.set(makeOrder({ customer_email: null, customer_username: 'amy' }));
      expect(cmp.customerLabel()).toBe('amy');
      cmp.order.set(makeOrder({ customer_email: null, customer_username: null }));
      expect(cmp.customerLabel()).toBe('adminUi.orders.guest');
    });

    it('courierName covers all branches', () => {
      const { cmp, translate } = setup();
      expect(cmp.courierName(null)).toBe('—');
      expect(cmp.courierName('sameday')).toBe('checkout.courierSameday');
      expect(cmp.courierName('fan_courier')).toBe('checkout.courierFanCourier');
      expect(cmp.courierName('DPD')).toBe('DPD');
      translate.instant.and.callFake((k: string) => k);
    });

    it('paymentMethodLabel covers all branches', () => {
      const { cmp } = setup();
      expect(cmp.paymentMethodLabel()).toBe('—');
      cmp.order.set(makeOrder({ payment_method: 'cod' }));
      expect(cmp.paymentMethodLabel()).toBe('adminUi.orders.paymentCod');
      cmp.order.set(makeOrder({ payment_method: 'paypal' }));
      expect(cmp.paymentMethodLabel()).toBe('adminUi.orders.paymentPaypal');
      cmp.order.set(makeOrder({ payment_method: 'stripe' }));
      expect(cmp.paymentMethodLabel()).toBe('adminUi.orders.paymentStripe');
      cmp.order.set(makeOrder({ payment_method: 'foo' }));
      expect(cmp.paymentMethodLabel()).toBe('foo');
      cmp.order.set(makeOrder({ payment_method: '' }));
      expect(cmp.paymentMethodLabel()).toBe('—');
    });

    it('deliveryTypeLabel covers all branches', () => {
      const { cmp } = setup();
      expect(cmp.deliveryTypeLabel()).toBe('—');
      cmp.order.set(makeOrder({ delivery_type: 'locker' }));
      expect(cmp.deliveryTypeLabel()).toBe('adminUi.orders.deliveryLocker');
      cmp.order.set(makeOrder({ delivery_type: 'home' }));
      expect(cmp.deliveryTypeLabel()).toBe('adminUi.orders.deliveryHome');
      cmp.order.set(makeOrder({ delivery_type: 'pickup' }));
      expect(cmp.deliveryTypeLabel()).toBe('pickup');
      cmp.order.set(makeOrder({ delivery_type: '' }));
      expect(cmp.deliveryTypeLabel()).toBe('—');
    });

    it('tagLabel returns translation or raw tag', () => {
      const { cmp, translate } = setup();
      expect(cmp.tagLabel('vip')).toBe('vip');
      translate.instant.and.returnValue('VIP');
      expect(cmp.tagLabel('vip')).toBe('VIP');
    });

    it('tagChipColorClass delegates', () => {
      const { cmp } = setup();
      expect(cmp.tagChipColorClass('vip')).toContain('violet');
    });

    it('emailStatusLabel returns translation or raw', () => {
      const { cmp, translate } = setup();
      expect(cmp.emailStatusLabel('sent')).toBe('sent');
      translate.instant.and.returnValue('Sent');
      expect(cmp.emailStatusLabel('sent')).toBe('Sent');
    });

    it('emailStatusChipClass covers sent/failed/other', () => {
      const { cmp } = setup();
      expect(cmp.emailStatusChipClass('sent')).toContain('emerald');
      expect(cmp.emailStatusChipClass('failed')).toContain('rose');
      expect(cmp.emailStatusChipClass('queued')).toContain('slate');
    });

    it('isTestOrder reflects the test tag', () => {
      const { cmp } = setup();
      expect(cmp.isTestOrder()).toBeFalse();
      cmp.order.set(makeOrder({ tags: ['test'] }));
      expect(cmp.isTestOrder()).toBeTrue();
    });

    it('canRefund covers refundable and non-refundable statuses', () => {
      const { cmp } = setup();
      expect(cmp.canRefund()).toBeFalse();
      cmp.order.set(makeOrder({ status: 'paid' }));
      expect(cmp.canRefund()).toBeTrue();
      cmp.order.set(makeOrder({ status: 'shipped' }));
      expect(cmp.canRefund()).toBeTrue();
      cmp.order.set(makeOrder({ status: 'delivered' }));
      expect(cmp.canRefund()).toBeTrue();
      cmp.order.set(makeOrder({ status: 'pending' }));
      expect(cmp.canRefund()).toBeFalse();
    });

    it('fraudReviewStatus reads tags', () => {
      const { cmp } = setup();
      expect(cmp.fraudReviewStatus()).toBeNull();
      cmp.order.set(makeOrder({ tags: ['fraud_approved'] }));
      expect(cmp.fraudReviewStatus()).toBe('approved');
      cmp.order.set(makeOrder({ tags: ['Fraud_Denied'] }));
      expect(cmp.fraudReviewStatus()).toBe('denied');
    });
  });

  describe('fraud signal helpers', () => {
    it('renders titles, descriptions and params', () => {
      const { cmp, translate } = setup();
      expect(cmp.fraudSignalTitle({ code: 'velocity_email', severity: 'high' })).toBe(
        'velocity_email',
      );
      expect(
        cmp.fraudSignalDescription({
          code: 'velocity_email',
          severity: 'high',
          data: { count: 3, window_minutes: 10 },
        }),
      ).toBe('');
      translate.instant.and.returnValue('translated');
      expect(cmp.fraudSignalTitle({ code: 'x', severity: 'high' })).toBe('translated');
      expect(
        cmp.fraudSignalDescription({ code: 'velocity_user', severity: 'high', data: {} }),
      ).toBe('translated');
      expect(cmp.fraudSeverityLabel('high')).toBe('translated');
    });

    it('builds params for each known signal code', () => {
      const { cmp } = setup();
      expect(
        cmp['fraudSignalParams']({
          code: 'velocity_user',
          severity: 'low',
          data: { count: 1, window_minutes: 5 },
        }),
      ).toEqual({ count: 1, window_minutes: 5 });
      expect(
        cmp['fraudSignalParams']({
          code: 'country_mismatch',
          severity: 'low',
          data: { shipping_country: 'RO', billing_country: 'US' },
        }),
      ).toEqual({ shipping_country: 'RO', billing_country: 'US' });
      expect(
        cmp['fraudSignalParams']({ code: 'payment_retries', severity: 'low', data: { count: 4 } }),
      ).toEqual({ count: 4 });
      expect(cmp['fraudSignalParams']({ code: 'other', severity: 'low' })).toEqual({});
    });

    it('fraudSeverityLabel returns the raw severity when untranslated', () => {
      const { cmp } = setup();
      expect(cmp.fraudSeverityLabel('low')).toBe('low');
    });

    it('fraudSeverityDotClass covers all severities', () => {
      const { cmp } = setup();
      expect(cmp.fraudSeverityDotClass('high')).toBe('bg-rose-500');
      expect(cmp.fraudSeverityDotClass('medium')).toBe('bg-amber-500');
      expect(cmp.fraudSeverityDotClass('low')).toBe('bg-sky-500');
      expect(cmp.fraudSeverityDotClass('info')).toBe('bg-slate-400');
    });

    it('fraudSeverityBadgeClass covers all severities', () => {
      const { cmp } = setup();
      expect(cmp.fraudSeverityBadgeClass('high')).toContain('rose');
      expect(cmp.fraudSeverityBadgeClass('medium')).toContain('amber');
      expect(cmp.fraudSeverityBadgeClass('low')).toContain('sky');
      expect(cmp.fraudSeverityBadgeClass('info')).toContain('slate');
    });
  });

  describe('status transitions', () => {
    it('paymentCaptureBlocked covers all branches', () => {
      const { cmp } = setup();
      expect(cmp.paymentCaptureBlocked()).toBeFalse();
      cmp.order.set(makeOrder({ status: 'paid', payment_method: 'stripe' }));
      expect(cmp.paymentCaptureBlocked()).toBeFalse();
      cmp.order.set(makeOrder({ status: 'pending_acceptance', payment_method: 'cod' }));
      expect(cmp.paymentCaptureBlocked()).toBeFalse();
      cmp.order.set(
        makeOrder({ status: 'pending_acceptance', payment_method: 'stripe', events: [] }),
      );
      expect(cmp.paymentCaptureBlocked()).toBeTrue();
      cmp.order.set(
        makeOrder({
          status: 'pending_acceptance',
          payment_method: 'stripe',
          events: [{ id: 'e', event: 'payment_captured', created_at: 'now' }],
        }),
      );
      expect(cmp.paymentCaptureBlocked()).toBeFalse();
    });

    it('hasPaymentCaptured handles paypal capture id', () => {
      const { cmp } = setup();
      cmp.order.set(
        makeOrder({
          status: 'pending_acceptance',
          payment_method: 'paypal',
          paypal_capture_id: '',
        }),
      );
      expect(cmp.paymentCaptureBlocked()).toBeTrue();
      cmp.order.set(
        makeOrder({
          status: 'pending_acceptance',
          payment_method: 'paypal',
          paypal_capture_id: 'cap-1',
        }),
      );
      expect(cmp.paymentCaptureBlocked()).toBeFalse();
    });

    it('statusOptions reflects allowed transitions and falls back to statusValue', () => {
      const { cmp } = setup();
      cmp.statusValue = 'paid';
      const opts = cmp.statusOptions();
      expect(opts.find((o) => o.value === 'shipped')?.disabled).toBeFalse();
      cmp.order.set(makeOrder({ status: 'pending_acceptance', payment_method: 'cod' }));
      expect(cmp.statusOptions().find((o) => o.value === 'shipped')?.disabled).toBeFalse();
    });

    it('statusOptions removes paid when stripe payment not captured and handles unknown status', () => {
      const { cmp } = setup();
      cmp.order.set(
        makeOrder({ status: 'pending_acceptance', payment_method: 'stripe', events: [] }),
      );
      expect(cmp.statusOptions().find((o) => o.value === 'paid')?.disabled).toBeTrue();
      cmp.order.set(makeOrder({ status: 'weird' as never, payment_method: 'stripe' }));
      expect(cmp.statusOptions().length).toBeGreaterThan(0);
    });
  });

  describe('address validation helpers', () => {
    it('addressIssueKeys returns empty for missing address', () => {
      const { cmp } = setup();
      expect(cmp.addressIssueKeys(null, 'shipping')).toEqual([]);
    });

    it('flags a missing shipping phone and invalid RO postal', () => {
      const { cmp } = setup();
      const issues = cmp.addressIssueKeys(
        { line1: 'a', city: 'c', postal_code: '12', country: 'ro', phone: '' } as never,
        'shipping',
      );
      expect(issues).toContain('adminUi.orders.addressValidate.phoneMissing');
      expect(issues).toContain('adminUi.orders.addressValidate.postalInvalidRo');
    });

    it('warns on non-E164 RO phone and non-standard RO postal', () => {
      const { cmp } = setup();
      const issues = cmp.addressIssueKeys(
        {
          line1: 'a',
          city: 'c',
          postal_code: '12345 6',
          country: 'RO',
          phone: '0721234567',
        } as never,
        'shipping',
      );
      expect(issues).toContain('adminUi.orders.addressValidate.phoneNonE164');
      expect(issues).toContain('adminUi.orders.addressValidate.postalNonStandardRo');
    });

    it('flags an invalid phone and invalid non-RO postal', () => {
      const { cmp } = setup();
      const issues = cmp.addressIssueKeys(
        { line1: 'a', city: 'c', postal_code: '', country: 'US', phone: '12' } as never,
        'shipping',
      );
      expect(issues).toContain('adminUi.orders.addressValidate.phoneInvalid');
      expect(issues).toContain('adminUi.orders.addressValidate.postalInvalid');
    });

    it('treats a billing phone as optional and accepts valid data', () => {
      const { cmp } = setup();
      expect(
        cmp.addressIssueKeys(
          {
            line1: 'a',
            city: 'c',
            postal_code: '123456',
            country: 'RO',
            phone: '+40721234567',
          } as never,
          'billing',
        ),
      ).toEqual([]);
      expect(
        cmp.addressNeedsAttention(
          {
            line1: 'a',
            city: 'c',
            postal_code: '123456',
            country: 'RO',
            phone: '+40721234567',
          } as never,
          'billing',
        ),
      ).toBeFalse();
    });

    it('phoneState covers RO 9-digit, 11-digit-40, blank-billing-invalid and invalid +', () => {
      const { cmp } = setup();
      expect(
        cmp.addressIssueKeys(
          {
            line1: 'a',
            city: 'c',
            postal_code: '123456',
            country: 'RO',
            phone: '721234567',
          } as never,
          'shipping',
        ),
      ).toContain('adminUi.orders.addressValidate.phoneNonE164');
      expect(
        cmp.addressIssueKeys(
          {
            line1: 'a',
            city: 'c',
            postal_code: '123456',
            country: 'RO',
            phone: '40721234567',
          } as never,
          'shipping',
        ),
      ).toContain('adminUi.orders.addressValidate.phoneNonE164');
      expect(
        cmp.addressIssueKeys(
          { line1: 'a', city: 'c', postal_code: '123456', country: 'RO', phone: '+abc' } as never,
          'billing',
        ),
      ).toContain('adminUi.orders.addressValidate.phoneInvalid');
      // RO 10-digit not starting with 0 -> invalid
      expect(
        cmp.addressIssueKeys(
          {
            line1: 'a',
            city: 'c',
            postal_code: '123456',
            country: 'RO',
            phone: '1234567890',
          } as never,
          'shipping',
        ),
      ).toContain('adminUi.orders.addressValidate.phoneInvalid');
    });

    it('cleanPhoneValue handles 00 prefix and a billing phone that cleans to empty', () => {
      const { cmp } = setup();
      expect(
        cmp.addressIssueKeys(
          {
            line1: 'a',
            city: 'c',
            postal_code: '123456',
            country: 'RO',
            phone: '0040721234567',
          } as never,
          'billing',
        ),
      ).toEqual([]);
      // a phone that becomes empty after cleaning, billing -> invalid
      expect(
        cmp.addressIssueKeys(
          { line1: 'a', city: 'c', postal_code: '123456', country: 'RO', phone: '()' } as never,
          'billing',
        ),
      ).toContain('adminUi.orders.addressValidate.phoneInvalid');
      // shipping phone that becomes empty -> missing
      expect(
        cmp.addressIssueKeys(
          { line1: 'a', city: 'c', postal_code: '123456', country: 'RO', phone: '   ' } as never,
          'shipping',
        ),
      ).toContain('adminUi.orders.addressValidate.phoneMissing');
    });

    it('addressPhoneHint covers each state', () => {
      const { cmp } = setup();
      cmp.addressEditorKind.set('shipping');
      cmp.addressCountry = 'RO';
      cmp.addressPhone = '';
      expect(cmp.addressPhoneHint()).toBe('adminUi.orders.addressValidate.phoneMissing');
      cmp.addressPhone = '0721234567';
      expect(cmp.addressPhoneHint()).toBe('adminUi.orders.addressValidate.phoneNonE164');
      cmp.addressPhone = '+abc';
      expect(cmp.addressPhoneHint()).toBe('adminUi.orders.addressValidate.phoneInvalid');
      cmp.addressPhone = '+40721234567';
      expect(cmp.addressPhoneHint()).toBe('');
    });

    it('addressPhoneSuggestion and applyAddressPhoneSuggestion', () => {
      const { cmp } = setup();
      cmp.addressEditorKind.set('shipping');
      cmp.addressCountry = 'RO';
      cmp.addressPhone = '0721234567';
      expect(cmp.addressPhoneSuggestion()).toBe('+40721234567');
      cmp.addressPhone = '+40721234567';
      expect(cmp.addressPhoneSuggestion()).toBeNull();
      cmp.applyAddressPhoneSuggestion('  +40123  ');
      expect(cmp.addressPhone).toBe('+40123');
    });

    it('addressPostalHint covers RO and non-RO states', () => {
      const { cmp } = setup();
      cmp.addressCountry = 'RO';
      cmp.addressPostalCode = '12';
      expect(cmp.addressPostalHint()).toBe('adminUi.orders.addressValidate.postalInvalidRo');
      cmp.addressPostalCode = '12 34 56';
      expect(cmp.addressPostalHint()).toBe('adminUi.orders.addressValidate.postalNonStandardRo');
      cmp.addressPostalCode = '123456';
      expect(cmp.addressPostalHint()).toBe('');
      cmp.addressCountry = 'US';
      cmp.addressPostalCode = '';
      expect(cmp.addressPostalHint()).toBe('adminUi.orders.addressValidate.postalInvalid');
      cmp.addressPostalCode = '90210';
      expect(cmp.addressPostalHint()).toBe('');
    });

    it('addressPostalSuggestion and applyAddressPostalSuggestion', () => {
      const { cmp } = setup();
      cmp.addressCountry = 'RO';
      cmp.addressPostalCode = '12 34 56';
      expect(cmp.addressPostalSuggestion()).toBe('123456');
      cmp.applyAddressPostalSuggestion('  654321 ');
      expect(cmp.addressPostalCode).toBe('654321');
    });
  });

  describe('pii reveal', () => {
    it('does nothing without an order id', () => {
      const c = setup();
      c.cmp.togglePiiReveal();
      expect(c.api.get).not.toHaveBeenCalled();
    });

    it('toggles and reloads', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.togglePiiReveal();
      expect(c.cmp.piiReveal()).toBeFalse();
      expect(c.api.get).toHaveBeenCalled();
    });
  });

  describe('address editor', () => {
    it('does nothing without order or address', () => {
      const c = setup();
      c.cmp.openAddressEditor('shipping');
      c.cmp.order.set(makeOrder({ shipping_address: null }));
      c.cmp.openAddressEditor('shipping');
      expect(c.cmp.addressEditorOpen()).toBeFalse();
    });

    it('opens with shipping values and nullish fallbacks', () => {
      const c = setup();
      c.cmp.order.set(
        makeOrder({
          shipping_address: {
            line1: 'L1',
            city: 'City',
            postal_code: '123456',
            country: 'RO',
          } as never,
        }),
      );
      c.cmp.openAddressEditor('shipping');
      expect(c.cmp.addressEditorOpen()).toBeTrue();
      expect(c.cmp.addressLine1).toBe('L1');
      expect(c.cmp.addressLabel).toBe('');
    });

    it('opens billing editor and closes', () => {
      const c = setup();
      c.cmp.order.set(
        makeOrder({
          billing_address: {
            label: 'Home',
            phone: '+40721234567',
            line1: 'L1',
            line2: 'L2',
            city: 'C',
            region: 'R',
            postal_code: '123456',
            country: 'RO',
          } as never,
        }),
      );
      c.cmp.openAddressEditor('billing');
      expect(c.cmp.addressEditorKind()).toBe('billing');
      expect(c.cmp.addressLabel).toBe('Home');
      c.cmp.closeAddressEditor();
      expect(c.cmp.addressEditorOpen()).toBeFalse();
    });

    it('saveAddressEditor returns without order id', () => {
      const c = setup();
      c.cmp.saveAddressEditor();
      expect(c.api.updateAddresses).not.toHaveBeenCalled();
    });

    it('saves a shipping address successfully', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.addressEditorKind.set('shipping');
      c.cmp.addressLine1 = 'L1';
      c.cmp.addressCity = 'C';
      c.cmp.addressPostalCode = '123456';
      c.cmp.addressCountry = 'ro';
      c.cmp.addressNote = '  hello ';
      c.cmp.saveAddressEditor();
      expect(c.api.updateAddresses).toHaveBeenCalled();
      expect(c.toast.success).toHaveBeenCalled();
      expect(c.cmp.addressEditorOpen()).toBeFalse();
    });

    it('saves a billing address and surfaces an error detail', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.addressEditorKind.set('billing');
      c.cmp.addressNote = '';
      c.api.updateAddresses.and.returnValue(throwError(() => ({ error: { detail: 'bad' } })));
      c.cmp.saveAddressEditor();
      expect(c.cmp.addressEditorError()).toBe('bad');
      expect(c.toast.error).toHaveBeenCalledWith('bad');
    });

    it('uses a fallback message when the error has no detail', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.api.updateAddresses.and.returnValue(throwError(() => ({})));
      c.cmp.saveAddressEditor();
      expect(c.cmp.addressEditorError()).toBe('adminUi.orders.addressEdit.errors.update');
    });
  });

  describe('shipment editor', () => {
    it('opens for an existing shipment and a new one', () => {
      const c = setup();
      c.cmp.openShipmentEditor({
        id: 's1',
        order_id: 'o',
        courier: 'dpd',
        tracking_number: 'T1',
        tracking_url: 'https://t/1',
        created_at: 'now',
      });
      expect(c.cmp.shipmentEditingId).toBe('s1');
      expect(c.cmp.shipmentTrackingNumber).toBe('T1');
      c.cmp.openShipmentEditor();
      expect(c.cmp.shipmentEditingId).toBeNull();
      expect(c.cmp.shipmentTrackingNumber).toBe('');
    });

    it('opens for a shipment with nullish fields', () => {
      const c = setup();
      c.cmp.openShipmentEditor({
        id: 's2',
        order_id: 'o',
        tracking_number: 'T2',
        created_at: 'now',
      });
      expect(c.cmp.shipmentCourier).toBe('');
      expect(c.cmp.shipmentTrackingUrl).toBe('');
    });

    it('closes and resets', () => {
      const c = setup();
      c.cmp.shipmentCourier = 'x';
      c.cmp.closeShipmentEditor();
      expect(c.cmp.shipmentEditorOpen()).toBeFalse();
      expect(c.cmp.shipmentCourier).toBe('');
    });

    it('saveShipmentEditor returns without order id', () => {
      const c = setup();
      c.cmp.saveShipmentEditor();
      expect(c.api.createShipment).not.toHaveBeenCalled();
    });

    it('requires a tracking number', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.shipmentTrackingNumber = '   ';
      c.cmp.saveShipmentEditor();
      expect(c.cmp.shipmentEditorError()).toBe('adminUi.orders.shipments.errors.trackingRequired');
    });

    it('rejects an invalid tracking url', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.shipmentTrackingNumber = 'T1';
      c.cmp.shipmentTrackingUrl = 'ftp://bad';
      c.cmp.saveShipmentEditor();
      expect(c.cmp.shipmentEditorError()).toBe('adminUi.orders.errors.invalidTrackingUrl');
    });

    it('rejects an unparseable tracking url', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.shipmentTrackingNumber = 'T1';
      c.cmp.shipmentTrackingUrl = 'http://';
      c.cmp.saveShipmentEditor();
      expect(c.cmp.shipmentEditorError()).toBe('adminUi.orders.errors.invalidTrackingUrl');
    });

    it('creates a new shipment successfully', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.shipmentEditingId = null;
      c.cmp.shipmentCourier = 'dpd';
      c.cmp.shipmentTrackingNumber = 'T1';
      c.cmp.shipmentTrackingUrl = 'https://t/1';
      c.cmp.saveShipmentEditor();
      expect(c.api.createShipment).toHaveBeenCalled();
      expect(c.cmp.shipmentEditorOpen()).toBeFalse();
    });

    it('updates an existing shipment and surfaces an error', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.shipmentEditingId = 's1';
      c.cmp.shipmentCourier = '';
      c.cmp.shipmentTrackingNumber = 'T1';
      c.cmp.shipmentTrackingUrl = '';
      c.api.updateShipment.and.returnValue(throwError(() => ({ error: { detail: 'no' } })));
      c.cmp.saveShipmentEditor();
      expect(c.cmp.shipmentEditorError()).toBe('no');
    });

    it('uses a fallback when the shipment save error has no detail', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.shipmentTrackingNumber = 'T1';
      c.api.createShipment.and.returnValue(throwError(() => ({})));
      c.cmp.saveShipmentEditor();
      expect(c.cmp.shipmentEditorError()).toBe('adminUi.orders.shipments.errors.save');
    });

    it('deleteShipment returns without order id', () => {
      const c = setup();
      c.cmp.deleteShipment('s1');
      expect(c.api.deleteShipment).not.toHaveBeenCalled();
    });

    it('deletes a shipment and handles errors', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.deleteShipment('s1');
      expect(c.toast.success).toHaveBeenCalled();
      c.api.deleteShipment.and.returnValue(throwError(() => ({ error: { detail: 'err' } })));
      c.cmp.deleteShipment('s1');
      expect(c.toast.error).toHaveBeenCalledWith('err');
      c.api.deleteShipment.and.returnValue(throwError(() => ({})));
      c.cmp.deleteShipment('s1');
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.shipments.errors.delete');
    });
  });

  describe('fulfillment', () => {
    it('returns without order id', () => {
      const c = setup();
      c.cmp.saveFulfillment('item-1', 2);
      expect(c.api.fulfillItem).not.toHaveBeenCalled();
    });

    it('clamps non-finite quantities and rebuilds the map on success', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.fulfillmentQty['item-1'] = 'abc' as never;
      c.api.fulfillItem.and.returnValue(
        of(makeOrder({ items: [makeItem({ id: 'item-1', shipped_quantity: 1 })] })),
      );
      c.cmp.saveFulfillment('item-1', 2);
      expect(c.cmp.fulfillmentQty['item-1']).toBe(1);
      expect(c.toast.success).toHaveBeenCalled();
    });

    it('clamps finite quantities and handles errors', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.fulfillmentQty['item-1'] = 99;
      c.api.fulfillItem.and.returnValue(throwError(() => ({ error: { detail: 'fe' } })));
      c.cmp.saveFulfillment('item-1', 2);
      expect(c.toast.error).toHaveBeenCalledWith('fe');
      c.api.fulfillItem.and.returnValue(throwError(() => ({})));
      c.cmp.saveFulfillment('item-1', 2);
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.items.fulfillError');
    });
  });

  describe('event diff helpers', () => {
    it('eventDiffRows returns changes from data', () => {
      const { cmp } = setup();
      const rows = cmp.eventDiffRows({
        id: 'e',
        event: 'update',
        data: { changes: { status: { from: 'paid', to: 'shipped' } } },
        created_at: 'now',
      });
      expect(rows.length).toBe(1);
    });

    it('eventDiffRows parses a status_change note', () => {
      const { cmp } = setup();
      const rows = cmp.eventDiffRows({
        id: 'e',
        event: 'status_change',
        note: 'paid -> shipped',
        created_at: 'now',
      });
      expect(rows[0].label).toBeDefined();
    });

    it('eventDiffRows handles status_auto_ship and notes without an arrow', () => {
      const { cmp } = setup();
      expect(
        cmp.eventDiffRows({
          id: 'e',
          event: 'status_auto_ship',
          note: 'paid -> shipped',
          created_at: 'now',
        }).length,
      ).toBe(1);
      // note contains an arrow but both sides are blank -> still a single row
      expect(
        cmp.eventDiffRows({ id: 'e', event: 'status_change', note: '->', created_at: 'now' })
          .length,
      ).toBe(1);
      // status_change with no arrow falls through to []
      expect(
        cmp.eventDiffRows({
          id: 'e',
          event: 'status_change',
          note: 'no arrow here',
          created_at: 'now',
        }),
      ).toEqual([]);
      expect(cmp.eventDiffRows({ id: 'e', event: 'other', note: 'x', created_at: 'now' })).toEqual(
        [],
      );
    });

    it('eventChanges skips equal and non-object changes', () => {
      const { cmp } = setup();
      expect(cmp.eventDiffRows({ id: 'e', event: 'u', data: null, created_at: 'now' })).toEqual([]);
      expect(
        cmp.eventDiffRows({ id: 'e', event: 'u', data: { changes: null }, created_at: 'now' }),
      ).toEqual([]);
      expect(
        cmp.eventDiffRows({
          id: 'e',
          event: 'u',
          data: { changes: { a: null, b: { from: 'x', to: 'x' } } },
          created_at: 'now',
        }),
      ).toEqual([]);
      expect(
        cmp.eventDiffRows({ id: 'e', event: 'u', data: ['x'] as never, created_at: 'now' }),
      ).toEqual([]);
    });

    it('eventAddressDiff covers shipping, billing and empties', () => {
      const { cmp } = setup();
      expect(
        cmp.eventAddressDiff({ id: 'e', event: 'u', data: null, created_at: 'now' }),
      ).toBeNull();
      expect(
        cmp.eventAddressDiff({ id: 'e', event: 'u', data: { changes: null }, created_at: 'now' }),
      ).toBeNull();
      expect(
        cmp.eventAddressDiff({
          id: 'e',
          event: 'u',
          data: { changes: { other: 1 } },
          created_at: 'now',
        }),
      ).toBeNull();
      const both = cmp.eventAddressDiff({
        id: 'e',
        event: 'u',
        data: {
          changes: {
            shipping_address: { from: { line1: 'a' }, to: { line1: 'b' } },
            billing_address: { from: null },
          },
        },
        created_at: 'now',
      });
      expect(both?.shipping).toBeDefined();
      expect(both?.billing).toBeDefined();
    });

    it('eventAddressDiff ignores array data', () => {
      const { cmp } = setup();
      expect(
        cmp.eventAddressDiff({ id: 'e', event: 'u', data: [1] as never, created_at: 'now' }),
      ).toBeNull();
      expect(
        cmp.eventAddressDiff({
          id: 'e',
          event: 'u',
          data: { changes: { shipping_address: ['x'] } },
          created_at: 'now',
        }),
      ).toBeNull();
    });

    it('diffLabel maps known fields and falls back', () => {
      const { cmp, translate } = setup();
      const ev = (changes: Record<string, unknown>) => ({
        id: 'e',
        event: 'u',
        data: { changes },
        created_at: 'now',
      });
      translate.instant.and.callFake((k: string) => `T:${k}`);
      expect(cmp.eventDiffRows(ev({ tracking_number: { from: 'a', to: 'b' } }))[0].label).toBe(
        'T:adminUi.orders.trackingNumber',
      );
      expect(cmp.eventDiffRows(ev({ tracking_url: { from: 'a', to: 'b' } }))[0].label).toBe(
        'T:adminUi.orders.trackingUrl',
      );
      expect(cmp.eventDiffRows(ev({ cancel_reason: { from: 'a', to: 'b' } }))[0].label).toBe(
        'T:adminUi.orders.cancelReason',
      );
      expect(cmp.eventDiffRows(ev({ courier: { from: 'a', to: 'b' } }))[0].label).toBe(
        'T:adminUi.orders.diff.courier',
      );
      expect(cmp.eventDiffRows(ev({ shipping_method: { from: 'a', to: 'b' } }))[0].label).toBe(
        'T:adminUi.orders.diff.shippingMethod',
      );
      translate.instant.and.callFake((k: string) => k);
      expect(cmp.eventDiffRows(ev({ some_field: { from: 'a', to: 'b' } }))[0].label).toBe(
        'some field',
      );
      expect(cmp.eventDiffRows(ev({ status: { from: 'paid', to: 'shipped' } }))[0].label).toBe(
        'status',
      );
    });

    it('diffValue covers all value types', () => {
      const { cmp, translate } = setup();
      const ev = (changes: Record<string, unknown>) => ({
        id: 'e',
        event: 'u',
        data: { changes },
        created_at: 'now',
      });
      expect(cmp.eventDiffRows(ev({ f: { from: null, to: 5 } }))[0]).toEqual(
        jasmine.objectContaining({ from: '—', to: '5' }),
      );
      expect(cmp.eventDiffRows(ev({ f: { from: true, to: false } }))[0]).toEqual(
        jasmine.objectContaining({ from: 'true', to: 'false' }),
      );
      expect(cmp.eventDiffRows(ev({ f: { from: '  spaced  ', to: 'plain' } }))[0]).toEqual(
        jasmine.objectContaining({ from: 'spaced' }),
      );
      expect(cmp.eventDiffRows(ev({ f: { from: { a: 1 }, to: 'x' } }))[0]).toEqual(
        jasmine.objectContaining({ from: '—' }),
      );
      expect(cmp.eventDiffRows(ev({ f: { from: '', to: 'y' } }))[0]).toEqual(
        jasmine.objectContaining({ from: '—' }),
      );
      translate.instant.and.callFake((k: string) => `T:${k}`);
      expect(cmp.eventDiffRows(ev({ status: { from: 'paid', to: 'shipped' } }))[0]).toEqual(
        jasmine.objectContaining({ from: 'T:adminUi.orders.paid' }),
      );
    });

    it('formatAddressSnapshot renders and handles non-objects', () => {
      const { cmp } = setup();
      expect(cmp.formatAddressSnapshot(null)).toBe('—');
      expect(cmp.formatAddressSnapshot(['x'])).toBe('—');
      expect(cmp.formatAddressSnapshot({})).toBe('—');
      const out = cmp.formatAddressSnapshot({
        label: 'L',
        phone: 'P',
        line1: '1',
        line2: '2',
        city: 'C',
        region: 'R',
        postal_code: 'Z',
        country: 'RO',
      });
      expect(out).toContain('L');
      expect(out).toContain('C, R Z');
      expect(out).toContain('RO');
    });
  });

  describe('refund breakdown and partial refunds', () => {
    it('refundBreakdown returns null without an order', () => {
      const { cmp } = setup();
      expect(cmp.refundBreakdown()).toBeNull();
    });

    it('refundBreakdown computes subtotal', () => {
      const { cmp } = setup();
      cmp.order.set(
        makeOrder({ total_amount: 100, shipping_amount: 10, tax_amount: 5, fee_amount: 5 }),
      );
      expect(cmp.refundBreakdown()).toEqual({
        subtotal: 80,
        shipping: 10,
        vat: 5,
        fee: 5,
        total: 100,
      });
    });

    it('refundsTotal and refundableRemaining', () => {
      const { cmp } = setup();
      cmp.order.set(
        makeOrder({
          total_amount: 100,
          refunds: [{ id: 'r', amount: 30, currency: 'RON', provider: 'p', created_at: 'now' }],
        }),
      );
      expect(cmp.refundsTotal()).toBe(30);
      expect(cmp.refundableRemaining()).toBe(70);
      cmp.order.set(
        makeOrder({
          total_amount: 10,
          refunds: [{ id: 'r', amount: 30, currency: 'RON', provider: 'p', created_at: 'now' }],
        }),
      );
      expect(cmp.refundableRemaining()).toBe(0);
    });

    it('partial refund quantity helpers', () => {
      const { cmp } = setup();
      expect(cmp.partialRefundQtyFor('item-1')).toBe(0);
      cmp.partialRefundQty['item-1'] = 3;
      expect(cmp.partialRefundQtyFor('item-1')).toBe(3);
      cmp.order.set(makeOrder());
      expect(cmp.partialRefundMaxQty(makeItem({ quantity: 5 }))).toBe(5);
      expect(cmp.partialRefundLineTotal(makeItem({ id: 'item-1', unit_price: 10 }))).toBe(30);
      expect(
        cmp.partialRefundSelectionTotal(
          makeOrder({ items: [makeItem({ id: 'item-1', unit_price: 10 })] }),
        ),
      ).toBe(30);
    });

    it('partialRefundAlreadyRefundedQty aggregates and guards malformed data', () => {
      const { cmp } = setup();
      cmp.order.set(
        makeOrder({
          refunds: [
            {
              id: 'r1',
              amount: 1,
              currency: 'RON',
              provider: 'p',
              created_at: 'now',
              data: {
                items: [
                  { order_item_id: 'item-1', quantity: 2 },
                  { order_item_id: 'item-2', quantity: 5 },
                  null,
                  { order_item_id: 'item-1', quantity: 'x' },
                ],
              },
            },
            {
              id: 'r2',
              amount: 1,
              currency: 'RON',
              provider: 'p',
              created_at: 'now',
              data: { items: 'nope' },
            },
          ],
        }),
      );
      expect(cmp.partialRefundMaxQty(makeItem({ id: 'item-1', quantity: 5 }))).toBe(3);
    });

    it('canProcessPartialRefund and processPartialRefundHint cover all methods', () => {
      const { cmp } = setup();
      expect(cmp.canProcessPartialRefund()).toBeFalse();
      expect(cmp.processPartialRefundHint()).toBe('');
      cmp.order.set(makeOrder({ payment_method: 'stripe', stripe_payment_intent_id: 'pi' }));
      expect(cmp.canProcessPartialRefund()).toBeTrue();
      expect(cmp.processPartialRefundHint()).toBe(
        'adminUi.orders.partialRefundWizard.processPaymentHintSupported',
      );
      cmp.order.set(makeOrder({ payment_method: 'stripe', stripe_payment_intent_id: null }));
      expect(cmp.processPartialRefundHint()).toBe(
        'adminUi.orders.partialRefundWizard.processPaymentHintMissingStripe',
      );
      cmp.order.set(makeOrder({ payment_method: 'paypal', paypal_capture_id: 'cap' }));
      expect(cmp.canProcessPartialRefund()).toBeTrue();
      cmp.order.set(makeOrder({ payment_method: 'paypal', paypal_capture_id: null }));
      expect(cmp.processPartialRefundHint()).toBe(
        'adminUi.orders.partialRefundWizard.processPaymentHintMissingPaypal',
      );
      cmp.order.set(makeOrder({ payment_method: 'cod' }));
      expect(cmp.processPartialRefundHint()).toBe(
        'adminUi.orders.partialRefundWizard.processPaymentHintUnsupported',
      );
    });

    it('openPartialRefundWizard guards and initialises', () => {
      const c = setup();
      c.cmp.openPartialRefundWizard();
      expect(c.cmp.partialRefundWizardOpen()).toBeFalse();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.order.set(makeOrder({ status: 'pending' }));
      c.cmp.openPartialRefundWizard();
      expect(c.cmp.partialRefundWizardOpen()).toBeFalse();
      c.cmp.order.set(
        makeOrder({ status: 'paid', items: [makeItem({ id: 'item-1', unit_price: 10 })] }),
      );
      c.cmp.openPartialRefundWizard();
      expect(c.cmp.partialRefundWizardOpen()).toBeTrue();
      expect(c.cmp.partialRefundQty['item-1']).toBe(0);
      c.cmp.closePartialRefundWizard();
      expect(c.cmp.partialRefundWizardOpen()).toBeFalse();
    });

    it('setPartialRefundQty clamps numeric and non-numeric values', () => {
      const c = setup();
      c.cmp.order.set(makeOrder({ items: [makeItem({ id: 'item-1', unit_price: 10 })] }));
      c.cmp.setPartialRefundQty('item-1', 3, 5);
      expect(c.cmp.partialRefundQty['item-1']).toBe(3);
      c.cmp.setPartialRefundQty('item-1', '2', 5);
      expect(c.cmp.partialRefundQty['item-1']).toBe(2);
      c.cmp.setPartialRefundQty('item-1', 'xyz', 5);
      expect(c.cmp.partialRefundQty['item-1']).toBe(0);
      c.cmp.setPartialRefundQty('item-1', 99, 5);
      expect(c.cmp.partialRefundQty['item-1']).toBe(5);
      c.cmp.order.set(null);
      c.cmp.setPartialRefundQty('item-1', 1, 5);
      expect(c.cmp.partialRefundQty['item-1']).toBe(1);
    });

    it('adjustPartialRefundQty steps the value', () => {
      const c = setup();
      c.cmp.order.set(makeOrder({ items: [makeItem({ id: 'item-1', unit_price: 10 })] }));
      c.cmp.partialRefundQty['item-1'] = 2;
      c.cmp.adjustPartialRefundQty('item-1', 1, 5);
      expect(c.cmp.partialRefundQty['item-1']).toBe(3);
    });

    it('confirmPartialRefund validates and succeeds', () => {
      const c = setup();
      c.cmp.confirmPartialRefund();
      expect(c.api.createPartialRefund).not.toHaveBeenCalled();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.order.set(makeOrder({ status: 'pending' }));
      c.cmp.confirmPartialRefund();
      expect(c.api.createPartialRefund).not.toHaveBeenCalled();

      c.cmp.order.set(
        makeOrder({
          status: 'paid',
          total_amount: 100,
          items: [makeItem({ id: 'item-1', unit_price: 10 })],
        }),
      );
      c.cmp.partialRefundNote = '';
      c.cmp.confirmPartialRefund();
      expect(c.cmp.partialRefundWizardError()).toBe(
        'adminUi.orders.partialRefundWizard.noteRequired',
      );

      c.cmp.partialRefundNote = 'note';
      c.cmp.partialRefundQty = { 'item-1': 0 };
      c.cmp.confirmPartialRefund();
      expect(c.cmp.partialRefundWizardError()).toBe(
        'adminUi.orders.partialRefundWizard.itemsRequired',
      );

      c.cmp.partialRefundQty = { 'item-1': 1 };
      c.cmp.partialRefundAmount = '0';
      c.cmp.confirmPartialRefund();
      expect(c.cmp.partialRefundWizardError()).toBe(
        'adminUi.orders.partialRefundWizard.amountRequired',
      );

      c.cmp.partialRefundAmount = '9999';
      c.cmp.confirmPartialRefund();
      expect(c.cmp.partialRefundWizardError()).toBe(
        'adminUi.orders.partialRefundWizard.amountTooHigh',
      );

      c.cmp.partialRefundAmount = '10';
      c.cmp.partialRefundProcessPayment = true;
      c.cmp.confirmPartialRefund();
      expect(c.api.createPartialRefund).toHaveBeenCalled();
      expect(c.toast.success).toHaveBeenCalled();
    });

    it('confirmPartialRefund surfaces server errors', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.order.set(
        makeOrder({
          status: 'paid',
          total_amount: 100,
          items: [makeItem({ id: 'item-1', unit_price: 10 })],
        }),
      );
      c.cmp.partialRefundNote = 'note';
      c.cmp.partialRefundQty = { 'item-1': 1 };
      c.cmp.partialRefundAmount = '10';
      c.api.createPartialRefund.and.returnValue(
        throwError(() => ({ error: { detail: 'pr-err' } })),
      );
      c.cmp.confirmPartialRefund();
      expect(c.cmp.partialRefundWizardError()).toBe('pr-err');
      c.api.createPartialRefund.and.returnValue(throwError(() => ({})));
      c.cmp.confirmPartialRefund();
      expect(c.cmp.partialRefundWizardError()).toBe('adminUi.orders.errors.partialRefund');
    });
  });

  describe('refund wizard', () => {
    it('openRefundWizard guards', () => {
      const c = setup();
      c.cmp.openRefundWizard();
      expect(c.cmp.refundWizardOpen()).toBeFalse();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.order.set(makeOrder({ status: 'pending' }));
      c.cmp.openRefundWizard();
      expect(c.cmp.refundWizardOpen()).toBeFalse();
      c.cmp.order.set(makeOrder({ status: 'paid' }));
      c.cmp.openRefundWizard();
      expect(c.cmp.refundWizardOpen()).toBeTrue();
      c.cmp.closeRefundWizard();
      expect(c.cmp.refundWizardOpen()).toBeFalse();
    });

    it('requestRefund opens the wizard', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.order.set(makeOrder({ status: 'paid' }));
      c.cmp.requestRefund();
      expect(c.cmp.refundWizardOpen()).toBeTrue();
    });

    it('confirmRefund validates and succeeds', () => {
      const c = setup();
      c.cmp.confirmRefund();
      expect(c.api.requestRefund).not.toHaveBeenCalled();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.order.set(makeOrder({ status: 'pending' }));
      c.cmp.confirmRefund();
      expect(c.api.requestRefund).not.toHaveBeenCalled();
      c.cmp.order.set(makeOrder({ status: 'paid' }));
      c.cmp.refundNote = '';
      c.cmp.confirmRefund();
      expect(c.cmp.refundWizardError()).toBe('adminUi.orders.refundWizard.noteRequired');
      c.cmp.refundNote = 'note';
      c.cmp.confirmRefund();
      expect(c.api.requestRefund).toHaveBeenCalled();
      expect(c.toast.success).toHaveBeenCalled();
    });

    it('confirmRefund surfaces server errors', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.order.set(makeOrder({ status: 'paid' }));
      c.cmp.refundNote = 'note';
      c.api.requestRefund.and.returnValue(throwError(() => ({ error: { detail: 'rf' } })));
      c.cmp.confirmRefund();
      expect(c.cmp.refundWizardError()).toBe('rf');
      c.api.requestRefund.and.returnValue(throwError(() => ({})));
      c.cmp.confirmRefund();
      expect(c.cmp.refundWizardError()).toBe('adminUi.orders.errors.refund');
    });
  });

  describe('admin notes', () => {
    it('returns without order id', () => {
      const c = setup();
      c.cmp.addAdminNote();
      expect(c.api.addAdminNote).not.toHaveBeenCalled();
    });

    it('requires a note', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.adminNoteText = '   ';
      c.cmp.addAdminNote();
      expect(c.cmp.adminNoteError()).toBe('adminUi.orders.errors.noteRequired');
    });

    it('adds a note and handles errors', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.adminNoteText = 'hi';
      c.cmp.addAdminNote();
      expect(c.api.addAdminNote).toHaveBeenCalled();
      c.cmp.adminNoteText = 'hi';
      c.api.addAdminNote.and.returnValue(throwError(() => ({ error: { detail: 'ne' } })));
      c.cmp.addAdminNote();
      expect(c.cmp.adminNoteError()).toBe('ne');
      c.cmp.adminNoteText = 'hi';
      c.api.addAdminNote.and.returnValue(throwError(() => ({})));
      c.cmp.addAdminNote();
      expect(c.cmp.adminNoteError()).toBe('adminUi.orders.errors.note');
    });
  });

  describe('tags', () => {
    it('addTag guards and succeeds', () => {
      const c = setup();
      c.cmp.addTag();
      expect(c.api.addOrderTag).not.toHaveBeenCalled();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.tagToAdd = '   ';
      c.cmp.addTag();
      expect(c.api.addOrderTag).not.toHaveBeenCalled();
      c.cmp.tagToAdd = 'vip';
      c.cmp.addTag();
      expect(c.api.addOrderTag).toHaveBeenCalled();
      expect(c.cmp.tagToAdd).toBe('');
    });

    it('addTag handles errors', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.tagToAdd = 'vip';
      c.api.addOrderTag.and.returnValue(throwError(() => ({ error: { detail: 'te' } })));
      c.cmp.addTag();
      expect(c.toast.error).toHaveBeenCalledWith('te');
      c.cmp.tagToAdd = 'vip';
      c.api.addOrderTag.and.returnValue(throwError(() => ({})));
      c.cmp.addTag();
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.tags.errors.add');
    });

    it('removeTag guards and succeeds', () => {
      const c = setup();
      c.cmp.removeTag('vip');
      expect(c.api.removeOrderTag).not.toHaveBeenCalled();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.removeTag('   ');
      expect(c.api.removeOrderTag).not.toHaveBeenCalled();
      c.cmp.removeTag('vip');
      expect(c.api.removeOrderTag).toHaveBeenCalled();
    });

    it('removeTag handles errors', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.api.removeOrderTag.and.returnValue(throwError(() => ({ error: { detail: 're' } })));
      c.cmp.removeTag('vip');
      expect(c.toast.error).toHaveBeenCalledWith('re');
      c.api.removeOrderTag.and.returnValue(throwError(() => ({})));
      c.cmp.removeTag('vip');
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.tags.errors.remove');
    });

    it('toggleTestTag guards and adds the test tag', () => {
      const c = setup();
      c.cmp.toggleTestTag();
      expect(c.api.addOrderTag).not.toHaveBeenCalled();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.action.set('save');
      c.cmp.toggleTestTag();
      expect(c.api.addOrderTag).not.toHaveBeenCalled();
      c.cmp.action.set(null);
      c.cmp.order.set(makeOrder({ tags: [] }));
      c.cmp.toggleTestTag();
      expect(c.api.addOrderTag).toHaveBeenCalledWith(
        'order-1234567890ab',
        'test',
        jasmine.anything(),
      );
    });

    it('toggleTestTag removes the test tag', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.order.set(makeOrder({ tags: ['test'] }));
      c.cmp.toggleTestTag();
      expect(c.api.removeOrderTag).toHaveBeenCalledWith(
        'order-1234567890ab',
        'test',
        jasmine.anything(),
      );
    });

    it('toggleTestTag handles add and remove errors', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.order.set(makeOrder({ tags: [] }));
      c.api.addOrderTag.and.returnValue(throwError(() => ({ error: { detail: 'add-err' } })));
      c.cmp.toggleTestTag();
      expect(c.toast.error).toHaveBeenCalledWith('add-err');

      c.cmp.order.set(makeOrder({ tags: ['test'] }));
      c.api.removeOrderTag.and.returnValue(throwError(() => ({})));
      c.cmp.toggleTestTag();
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.tags.errors.remove');
    });
  });

  describe('fraud review', () => {
    it('guards on missing order id, order, or active action', () => {
      const c = setup();
      c.cmp.reviewFraud('approve');
      expect(c.api.reviewFraud).not.toHaveBeenCalled();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.order.set(null);
      c.cmp.reviewFraud('approve');
      expect(c.api.reviewFraud).not.toHaveBeenCalled();
      c.cmp.order.set(makeOrder());
      c.cmp.action.set('save');
      c.cmp.reviewFraud('approve');
      expect(c.api.reviewFraud).not.toHaveBeenCalled();
    });

    it('approves with a prompt note and denies with an empty prompt', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.order.set(makeOrder());
      spyOn(window, 'prompt').and.returnValue('looks fine');
      c.cmp.reviewFraud('approve');
      expect(c.api.reviewFraud).toHaveBeenCalledWith(
        'order-1234567890ab',
        { decision: 'approve', note: 'looks fine' },
        jasmine.anything(),
      );
      expect(c.toast.success).toHaveBeenCalled();

      (window.prompt as jasmine.Spy).and.returnValue(null);
      c.cmp.reviewFraud('deny');
      expect(c.api.reviewFraud).toHaveBeenCalledWith(
        'order-1234567890ab',
        { decision: 'deny', note: null },
        jasmine.anything(),
      );
    });

    it('surfaces fraud review errors', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.order.set(makeOrder());
      spyOn(window, 'prompt').and.returnValue('');
      c.api.reviewFraud.and.returnValue(throwError(() => ({ error: { detail: 'frd' } })));
      c.cmp.reviewFraud('approve');
      expect(c.toast.error).toHaveBeenCalledWith('frd');
      c.api.reviewFraud.and.returnValue(throwError(() => ({})));
      c.cmp.reviewFraud('approve');
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.fraudReview.errors.failed');
    });
  });

  describe('save', () => {
    it('returns without an order', () => {
      const c = setup();
      c.cmp.save();
      expect(c.api.update).not.toHaveBeenCalled();
    });

    it('requires a cancel reason when cancelling', () => {
      const c = setup();
      c.cmp.order.set(makeOrder({ id: 'o1', status: 'paid' }));
      c.cmp.statusValue = 'cancelled';
      c.cmp.cancelReason = '';
      c.cmp.save();
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.errors.cancelReasonRequired');
      expect(c.api.update).not.toHaveBeenCalled();
    });

    it('rejects an invalid tracking url before saving', () => {
      const c = setup();
      c.cmp.order.set(makeOrder({ id: 'o1', status: 'paid' }));
      c.cmp.statusValue = 'paid';
      c.cmp.trackingNumber = 'T1';
      c.cmp.trackingUrl = 'ftp://nope';
      c.cmp.save();
      expect(c.api.update).not.toHaveBeenCalled();
    });

    it('saves changes successfully and resets fields', () => {
      const c = setup();
      c.cmp.order.set(makeOrder({ id: 'o1', status: 'paid' }));
      c.cmp.statusValue = 'shipped';
      c.cmp.trackingNumber = 'T1';
      c.cmp.trackingUrl = 'https://t/1';
      c.api.update.and.returnValue(
        of(
          makeOrder({
            id: 'o1',
            status: 'shipped',
            tracking_number: 'T1',
            tracking_url: 'https://t/1',
            cancel_reason: 'r',
          }),
        ),
      );
      c.cmp.save();
      expect(c.api.update).toHaveBeenCalled();
      expect(c.cmp.statusValue).toBe('shipped');
      expect(c.toast.success).toHaveBeenCalled();
    });

    it('saves a cancellation and defaults the status when missing', () => {
      const c = setup();
      c.cmp.order.set(makeOrder({ id: 'o1', status: 'paid' }));
      c.cmp.statusValue = 'cancelled';
      c.cmp.cancelReason = 'damaged';
      c.api.update.and.returnValue(of(makeOrder({ id: 'o1', status: '' as never })));
      c.cmp.save();
      expect(c.cmp.statusValue).toBe('pending_acceptance');
    });

    it('shows the server detail or a fallback on error', () => {
      const c = setup();
      c.cmp.order.set(makeOrder({ id: 'o1', status: 'paid' }));
      c.cmp.statusValue = 'shipped';
      c.api.update.and.returnValue(throwError(() => ({ error: { detail: '  bad  ' } })));
      c.cmp.save();
      expect(c.toast.error).toHaveBeenCalledWith('  bad  ');
      c.api.update.and.returnValue(throwError(() => ({ error: { detail: '   ' } })));
      c.cmp.save();
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.errors.status');
    });

    it('onStatusValueChange clears the cancel reason for non-cancel statuses', () => {
      const { cmp } = setup();
      cmp.cancelReason = 'x';
      cmp.onStatusValueChange('cancelled');
      expect(cmp.cancelReason).toBe('x');
      cmp.onStatusValueChange('paid');
      expect(cmp.cancelReason).toBe('');
    });
  });

  describe('shipping label', () => {
    it('shippingLabelFileName returns the file name or a placeholder', () => {
      const { cmp } = setup();
      expect(cmp.shippingLabelFileName()).toBe('adminUi.orders.shippingLabelNoFile');
      cmp.shippingLabelFile = new File(['x'], 'label.pdf');
      expect(cmp.shippingLabelFileName()).toBe('label.pdf');
    });

    it('onShippingLabelSelected reads a chosen file and resets the input', () => {
      const { cmp } = setup();
      const file = new File(['x'], 'label.pdf');
      const input = {
        files: { item: () => file },
        value: 'C:/fakepath',
      } as unknown as HTMLInputElement;
      cmp.onShippingLabelSelected({ target: input } as unknown as Event);
      expect(cmp.shippingLabelFile).toBe(file);
      expect(input.value).toBe('');
    });

    it('onShippingLabelSelected handles a missing target', () => {
      const { cmp } = setup();
      cmp.onShippingLabelSelected({ target: null } as unknown as Event);
      expect(cmp.shippingLabelFile).toBeNull();
    });

    it('uploadShippingLabel guards and succeeds', () => {
      const c = setup();
      c.cmp.uploadShippingLabel();
      expect(c.api.uploadShippingLabel).not.toHaveBeenCalled();
      c.cmp.order.set(makeOrder({ id: 'o1' }));
      c.cmp.shippingLabelFile = new File(['x'], 'l.pdf');
      c.cmp.uploadShippingLabel();
      expect(c.api.uploadShippingLabel).toHaveBeenCalled();
      expect(c.cmp.shippingLabelFile).toBeNull();
    });

    it('uploadShippingLabel surfaces an error', () => {
      const c = setup();
      c.cmp.order.set(makeOrder({ id: 'o1' }));
      c.cmp.shippingLabelFile = new File(['x'], 'l.pdf');
      c.api.uploadShippingLabel.and.returnValue(throwError(() => new Error('x')));
      c.cmp.uploadShippingLabel();
      expect(c.cmp.shippingLabelError()).toBe('adminUi.orders.errors.shippingLabelUpload');
    });

    it('downloadShippingLabel guards, downloads with filename, and falls back', () => {
      const c = setup();
      c.cmp.downloadShippingLabel();
      expect(c.api.downloadShippingLabel).not.toHaveBeenCalled();
      c.cmp.order.set(
        makeOrder({ id: 'o1', reference_code: 'REF', shipping_label_filename: 'name.pdf' }),
      );
      c.cmp.downloadShippingLabel();
      expect(c.api.downloadShippingLabel).toHaveBeenCalled();
      c.cmp.order.set(makeOrder({ id: 'o1', reference_code: null }));
      c.cmp.downloadShippingLabel();
      expect(c.api.downloadShippingLabel).toHaveBeenCalledTimes(2);
    });

    it('downloadShippingLabel surfaces an error', () => {
      const c = setup();
      c.cmp.order.set(makeOrder({ id: 'o1' }));
      c.api.downloadShippingLabel.and.returnValue(throwError(() => new Error('x')));
      c.cmp.downloadShippingLabel();
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.errors.shippingLabelDownload');
    });

    it('printShippingLabel guards, prints, and falls back', () => {
      const c = setup();
      c.cmp.printShippingLabel();
      expect(c.api.downloadShippingLabel).not.toHaveBeenCalled();
      c.cmp.order.set(makeOrder({ id: 'o1', shipping_label_filename: 'name.pdf' }));
      c.cmp.printShippingLabel();
      expect(c.api.downloadShippingLabel).toHaveBeenCalledWith('o1', { action: 'print' });
      c.cmp.order.set(makeOrder({ id: 'o1', reference_code: null, shipping_label_filename: null }));
      c.cmp.printShippingLabel();
      c.api.downloadShippingLabel.and.returnValue(throwError(() => new Error('x')));
      c.cmp.printShippingLabel();
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.errors.shippingLabelDownload');
    });

    it('deleteShippingLabel guards, confirms, and handles errors', () => {
      const c = setup();
      c.cmp.deleteShippingLabel();
      expect(c.api.deleteShippingLabel).not.toHaveBeenCalled();
      c.cmp.order.set(makeOrder({ id: 'o1' }));
      spyOn(window, 'confirm').and.returnValue(false);
      c.cmp.deleteShippingLabel();
      expect(c.api.deleteShippingLabel).not.toHaveBeenCalled();
      (window.confirm as jasmine.Spy).and.returnValue(true);
      c.cmp.deleteShippingLabel();
      expect(c.api.deleteShippingLabel).toHaveBeenCalled();
      c.api.deleteShippingLabel.and.returnValue(throwError(() => new Error('x')));
      c.cmp.deleteShippingLabel();
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.errors.shippingLabelDelete');
    });

    it('shippingLabelHistory filters, sorts and limits events', () => {
      const { cmp } = setup();
      cmp.order.set(
        makeOrder({
          events: [
            { id: '1', event: 'shipping_label_uploaded', created_at: '2026-01-01' },
            { id: '2', event: 'shipping_label_printed', created_at: '2026-01-03' },
            { id: '3', event: 'other', created_at: '2026-01-02' },
            { id: '4', event: 'shipping_label_deleted', created_at: '2026-01-03' },
          ],
        }),
      );
      const hist = cmp.shippingLabelHistory();
      expect(hist.length).toBe(3);
      expect(hist[0].event).toBe('shipping_label_printed');
    });

    it('shippingLabelEventLabel maps known events', () => {
      const { cmp } = setup();
      expect(cmp.shippingLabelEventLabel('shipping_label_uploaded')).toBe(
        'adminUi.orders.shippingLabelEvents.uploaded',
      );
      expect(cmp.shippingLabelEventLabel('shipping_label_downloaded')).toBe(
        'adminUi.orders.shippingLabelEvents.downloaded',
      );
      expect(cmp.shippingLabelEventLabel('shipping_label_printed')).toBe(
        'adminUi.orders.shippingLabelEvents.printed',
      );
      expect(cmp.shippingLabelEventLabel('shipping_label_deleted')).toBe(
        'adminUi.orders.shippingLabelEvents.deleted',
      );
      expect(cmp.shippingLabelEventLabel('unknown')).toBe('unknown');
    });
  });

  describe('payment actions', () => {
    it('retryPayment guards, succeeds and errors', () => {
      const c = setup();
      c.cmp.retryPayment();
      expect(c.api.retryPayment).not.toHaveBeenCalled();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.retryPayment();
      expect(c.toast.success).toHaveBeenCalled();
      c.api.retryPayment.and.returnValue(throwError(() => new Error('x')));
      c.cmp.retryPayment();
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.errors.retry');
    });

    it('voidPayment guards, succeeds and errors', () => {
      const c = setup();
      c.cmp.voidPayment();
      expect(c.api.voidPayment).not.toHaveBeenCalled();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.voidPayment();
      expect(c.toast.success).toHaveBeenCalled();
      c.api.voidPayment.and.returnValue(throwError(() => new Error('x')));
      c.cmp.voidPayment();
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.errors.void');
    });

    it('sendDeliveryEmail guards, succeeds and errors', () => {
      const c = setup();
      c.cmp.sendDeliveryEmail();
      expect(c.api.sendDeliveryEmail).not.toHaveBeenCalled();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.sendDeliveryEmail();
      expect(c.toast.success).toHaveBeenCalled();
      c.api.sendDeliveryEmail.and.returnValue(throwError(() => new Error('x')));
      c.cmp.sendDeliveryEmail();
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.errors.deliveryEmail');
    });
  });

  describe('document downloads', () => {
    it('downloadPackingSlip guards, downloads with fallback id, and errors', () => {
      const c = setup();
      c.cmp.downloadPackingSlip();
      expect(c.api.downloadPackingSlip).not.toHaveBeenCalled();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.order.set(makeOrder({ reference_code: null, id: 'order-1234567890ab' }));
      c.cmp.downloadPackingSlip();
      expect(c.api.downloadPackingSlip).toHaveBeenCalled();
      c.api.downloadPackingSlip.and.returnValue(throwError(() => new Error('x')));
      c.cmp.downloadPackingSlip();
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.errors.packingSlip');
    });

    it('downloadReceiptPdf guards, downloads, and errors', () => {
      const c = setup();
      c.cmp.downloadReceiptPdf();
      expect(c.api.downloadReceiptPdf).not.toHaveBeenCalled();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.order.set(makeOrder({ reference_code: 'REF' }));
      c.cmp.downloadReceiptPdf();
      expect(c.api.downloadReceiptPdf).toHaveBeenCalled();
      c.api.downloadReceiptPdf.and.returnValue(throwError(() => new Error('x')));
      c.cmp.downloadReceiptPdf();
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.errors.receiptPdf');
    });
  });

  describe('receipt sharing', () => {
    it('returns without an order id', () => {
      const c = setup();
      c.cmp.shareReceipt();
      expect(c.api.shareReceipt).not.toHaveBeenCalled();
    });

    it('reuses a cached, unexpired link', fakeAsync(() => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.receiptShare.set({
        token: 't',
        receipt_url: 'https://r/x',
        receipt_pdf_url: '',
        expires_at: '2999-01-01T00:00:00Z',
      });
      spyOn(navigator.clipboard, 'writeText').and.resolveTo(undefined);
      c.cmp.shareReceipt();
      tick();
      expect(c.api.shareReceipt).not.toHaveBeenCalled();
      expect(c.toast.success).toHaveBeenCalledWith('adminUi.orders.receiptLinks.copied');
    }));

    it('requests a new link and reports a failed copy', fakeAsync(() => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      spyOn(navigator.clipboard, 'writeText').and.rejectWith(new Error('blocked'));
      c.cmp.shareReceipt();
      tick();
      expect(c.api.shareReceipt).toHaveBeenCalled();
      expect(c.toast.success).toHaveBeenCalledWith('adminUi.orders.receiptLinks.ready');
    }));

    it('surfaces share errors', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.api.shareReceipt.and.returnValue(throwError(() => ({ error: { detail: 'se' } })));
      c.cmp.shareReceipt();
      expect(c.toast.error).toHaveBeenCalledWith('se');
      c.api.shareReceipt.and.returnValue(throwError(() => ({})));
      c.cmp.shareReceipt();
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.errors.receiptShare');
    });

    it('revokeReceiptShare guards, confirms, succeeds, and errors', () => {
      const c = setup();
      c.cmp.revokeReceiptShare();
      expect(c.api.revokeReceiptShare).not.toHaveBeenCalled();
      c.cmp['orderId'] = 'order-1234567890ab';
      spyOn(window, 'confirm').and.returnValue(false);
      c.cmp.revokeReceiptShare();
      expect(c.api.revokeReceiptShare).not.toHaveBeenCalled();
      (window.confirm as jasmine.Spy).and.returnValue(true);
      c.cmp.revokeReceiptShare();
      expect(c.toast.success).toHaveBeenCalled();
      c.api.revokeReceiptShare.and.returnValue(throwError(() => ({ error: { detail: 'rv' } })));
      c.cmp.revokeReceiptShare();
      expect(c.toast.error).toHaveBeenCalledWith('rv');
      c.api.revokeReceiptShare.and.returnValue(throwError(() => ({})));
      c.cmp.revokeReceiptShare();
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.errors.receiptRevoke');
    });
  });

  describe('copyToClipboard', () => {
    it('returns true on success', fakeAsync(() => {
      const c = setup();
      spyOn(navigator.clipboard, 'writeText').and.resolveTo(undefined);
      let result: boolean | undefined;
      void c.cmp['copyToClipboard']('text').then((r) => (result = r));
      tick();
      expect(result).toBeTrue();
    }));

    it('returns false when navigator is undefined', fakeAsync(() => {
      const c = setup();
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
      let result: boolean | undefined;
      void c.cmp['copyToClipboard']('text').then((r) => (result = r));
      tick();
      if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
      expect(result).toBeFalse();
    }));

    it('returns false when writeText is unavailable', fakeAsync(() => {
      const c = setup();
      const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      let result: boolean | undefined;
      void c.cmp['copyToClipboard']('text').then((r) => (result = r));
      tick();
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else delete (navigator as unknown as { clipboard?: unknown }).clipboard;
      expect(result).toBeFalse();
    }));

    it('returns false when writeText rejects', fakeAsync(() => {
      const c = setup();
      spyOn(navigator.clipboard, 'writeText').and.rejectWith(new Error('no'));
      let result: boolean | undefined;
      void c.cmp['copyToClipboard']('text').then((r) => (result = r));
      tick();
      expect(result).toBeFalse();
    }));
  });

  describe('load lifecycle', () => {
    it('loads an order, records recent activity and seeds quantities', () => {
      const c = setup();
      c.api.get.and.returnValue(
        of(
          makeOrder({
            id: 'o9',
            reference_code: null,
            customer_email: 'a@b.com',
            status: '' as never,
            items: [makeItem({ id: 'i1', shipped_quantity: 1 })],
          }),
        ),
      );
      c.cmp['load']('o9');
      expect(c.recent.add).toHaveBeenCalled();
      expect(c.cmp.statusValue).toBe('pending_acceptance');
      expect(c.cmp.fulfillmentQty['i1']).toBe(1);
      expect(c.cmp.loading()).toBeFalse();
    });

    it('seeds tracking fields from the loaded order', () => {
      const c = setup();
      c.api.get.and.returnValue(
        of(
          makeOrder({
            id: 'o9',
            status: 'shipped',
            tracking_number: 'T',
            tracking_url: 'U',
            cancel_reason: 'C',
          }),
        ),
      );
      c.cmp['load']('o9');
      expect(c.cmp.trackingNumber).toBe('T');
      expect(c.cmp.cancelReason).toBe('C');
    });

    it('sets an error and request id on load failure', () => {
      const c = setup();
      c.api.get.and.returnValue(throwError(() => ({ headers: { get: () => 'rid-1' } })));
      c.cmp['load']('o9');
      expect(c.cmp.error()).toBe('adminUi.orders.errors.load');
      expect(c.cmp.loading()).toBeFalse();
    });

    it('retryLoad guards and reloads', () => {
      const c = setup();
      c.cmp.retryLoad();
      expect(c.api.get).not.toHaveBeenCalled();
      c.cmp['orderId'] = 'o9';
      c.cmp.retryLoad();
      expect(c.api.get).toHaveBeenCalled();
    });
  });

  describe('returns', () => {
    it('toggleReturnCreate resets and toggles', () => {
      const c = setup();
      c.cmp.order.set(makeOrder({ items: [makeItem({ id: 'i1' })] }));
      c.cmp.toggleReturnCreate();
      expect(c.cmp.showReturnCreate()).toBeTrue();
      expect(c.cmp.returnQty['i1']).toBe(0);
      c.cmp.toggleReturnCreate();
      expect(c.cmp.showReturnCreate()).toBeFalse();
    });

    it('toggleReturnCreate opens without an order', () => {
      const c = setup();
      c.cmp.order.set(null);
      c.cmp.toggleReturnCreate();
      expect(c.cmp.showReturnCreate()).toBeTrue();
    });

    it('createReturnRequest validates and succeeds', () => {
      const c = setup();
      c.cmp.createReturnRequest();
      expect(c.returnsApi.create).not.toHaveBeenCalled();
      c.cmp.order.set(makeOrder({ id: 'o1', items: [makeItem({ id: 'i1', quantity: 3 })] }));
      c.cmp.returnReason = '';
      c.cmp.createReturnRequest();
      expect(c.cmp.returnCreateError()).toBe('adminUi.returns.create.reasonRequired');
      c.cmp.returnReason = 'broken';
      c.cmp.returnQty = { i1: 0 };
      c.cmp.createReturnRequest();
      expect(c.cmp.returnCreateError()).toBe('adminUi.returns.create.itemsRequired');
      c.cmp.returnQty = { i1: 2 };
      c.cmp.returnCustomerMessage = 'msg';
      c.cmp.createReturnRequest();
      expect(c.returnsApi.create).toHaveBeenCalled();
      expect(c.cmp.creatingReturn()).toBeFalse();
    });

    it('createReturnRequest sends a null customer message when blank and handles errors', () => {
      const c = setup();
      c.cmp.order.set(makeOrder({ id: 'o1', items: [makeItem({ id: 'i1', quantity: 3 })] }));
      c.cmp.returnReason = 'broken';
      c.cmp.returnQty = { i1: 2 };
      c.cmp.returnCustomerMessage = '   ';
      c.returnsApi.create.and.returnValue(throwError(() => ({ error: { detail: 'ce' } })));
      c.cmp.createReturnRequest();
      expect(c.cmp.returnCreateError()).toBe('ce');
      c.returnsApi.create.and.returnValue(throwError(() => ({})));
      c.cmp.createReturnRequest();
      expect(c.cmp.returnCreateError()).toBe('adminUi.returns.create.errors.create');
    });

    it('loadReturns succeeds and errors', () => {
      const c = setup();
      c.cmp['loadReturns']('o1');
      expect(c.cmp.returnRequests()).toEqual([]);
      c.returnsApi.listByOrder.and.returnValue(throwError(() => new Error('x')));
      c.cmp['loadReturns']('o1');
      expect(c.cmp.returnsError()).toBe('adminUi.returns.errors.load');
    });

    it('loadReturns defaults a null payload to an empty list', () => {
      const c = setup();
      c.returnsApi.listByOrder.and.returnValue(of(null));
      c.cmp['loadReturns']('o1');
      expect(c.cmp.returnRequests()).toEqual([]);
    });
  });

  describe('comms', () => {
    it('reloadComms guards and reloads', () => {
      const c = setup();
      c.cmp.reloadComms();
      expect(c.api.listEmailEvents).not.toHaveBeenCalled();
      c.cmp['orderId'] = 'o1';
      c.cmp.reloadComms();
      expect(c.api.listEmailEvents).toHaveBeenCalled();
    });

    it('loadComms succeeds, defaults null, and errors', () => {
      const c = setup();
      c.api.listEmailEvents.and.returnValue(
        of([{ id: 'e', to_email: 'a@b', subject: 's', status: 'sent', created_at: 'now' }]),
      );
      c.cmp['loadComms']('o1');
      expect(c.cmp.commsEvents().length).toBe(1);
      c.api.listEmailEvents.and.returnValue(of(null));
      c.cmp['loadComms']('o1');
      expect(c.cmp.commsEvents()).toEqual([]);
      c.api.listEmailEvents.and.returnValue(throwError(() => ({ error: { detail: 'comm-err' } })));
      c.cmp['loadComms']('o1');
      expect(c.cmp.commsError()).toBe('comm-err');
      c.api.listEmailEvents.and.returnValue(throwError(() => ({})));
      c.cmp['loadComms']('o1');
      expect(c.cmp.commsError()).toBe('adminUi.orders.comms.errors.load');
    });
  });

  describe('defensive branch coverage', () => {
    it('hasPaymentCaptured handles null, missing method, cod, and missing events/event', () => {
      const { cmp } = setup();
      expect(cmp['hasPaymentCaptured'](null)).toBeFalse();
      expect(cmp['hasPaymentCaptured'](makeOrder({ payment_method: undefined }))).toBeFalse();
      expect(cmp['hasPaymentCaptured'](makeOrder({ payment_method: 'cod' }))).toBeFalse();
      expect(
        cmp['hasPaymentCaptured'](makeOrder({ payment_method: 'stripe', events: undefined })),
      ).toBeFalse();
      expect(
        cmp['hasPaymentCaptured'](
          makeOrder({
            payment_method: 'stripe',
            events: [{ id: 'e', event: undefined as never, created_at: 'now' }],
          }),
        ),
      ).toBeFalse();
    });

    it('paymentCaptureBlocked defaults a blank status and method', () => {
      const { cmp } = setup();
      cmp.order.set(makeOrder({ status: '' as never, payment_method: 'stripe', events: [] }));
      expect(cmp.paymentCaptureBlocked()).toBeTrue();
      cmp.order.set(makeOrder({ status: 'pending_acceptance', payment_method: undefined }));
      expect(cmp.paymentCaptureBlocked()).toBeFalse();
    });

    it('applyNavContext uses defaults and clamps a non-numeric limit', () => {
      const c = setup();
      c.cmp['orderId'] = null;
      c.cmp['applyNavContext'](paramMap({ nav: '1' }) as never);
      expect(c.cmp['navContext']).toEqual(jasmine.objectContaining({ page: 1, limit: 20 }));
      c.cmp['applyNavContext'](paramMap({ nav: '1', nav_limit: 'abc' }) as never);
      expect(c.cmp['navContext']?.limit).toBe(20);
    });

    it('refreshNav tolerates responses without an items array', () => {
      const c = setup();
      c.cmp.navEnabled.set(true);
      c.cmp['navContext'] = { page: 1, limit: 20 };
      c.api.search.and.returnValue(of({ meta: { total_pages: 1 } }));
      c.cmp['refreshNav']('order-1234567890ab');
      expect(c.cmp.navPrev()).toBeNull();
    });

    it('refreshNav tolerates inner pages without an items array', () => {
      const c = setup();
      c.cmp.navEnabled.set(true);
      c.cmp['navContext'] = { page: 2, limit: 20 };
      c.api.search.and.returnValues(
        of({ items: [{ id: 'order-1234567890ab' }, { id: 'b' }], meta: { total_pages: 3 } }),
        of({ meta: {} }),
      );
      c.cmp['refreshNav']('order-1234567890ab');
      expect(c.cmp.navPrev()).toBeNull();

      c.cmp['navContext'] = { page: 1, limit: 20 };
      c.api.search.and.returnValues(
        of({ items: [{ id: 'a' }, { id: 'order-1234567890ab' }], meta: { total_pages: 3 } }),
        of({ meta: {} }),
      );
      c.cmp['refreshNav']('order-1234567890ab');
      expect(c.cmp.navNext()).toBeNull();
    });

    it('onDocumentKeydown defaults a blank key and shouldIgnoreShortcut a blank tag', () => {
      const c = setup();
      c.cmp.order.set(makeOrder());
      c.cmp.loading.set(false);
      c.cmp.onDocumentKeydown({
        key: undefined,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        defaultPrevented: false,
        target: { tagName: 'BODY' } as HTMLElement,
        preventDefault: () => undefined,
      } as unknown as KeyboardEvent);
      expect(
        c.cmp['shouldIgnoreShortcut']({
          defaultPrevented: false,
          target: { tagName: undefined } as unknown as HTMLElement,
        } as unknown as KeyboardEvent),
      ).toBeFalse();
    });

    it('cleanPhoneValue handles blank and null inputs directly', () => {
      const { cmp } = setup();
      expect(cmp['cleanPhoneValue']('')).toBe('');
      expect(cmp['cleanPhoneValue'](null)).toBe('');
    });

    it('phoneState defaults a null phone and treats a cleaned-empty shipping phone as missing', () => {
      const { cmp } = setup();
      expect(
        cmp.addressIssueKeys(
          { line1: 'a', city: 'c', postal_code: '123456', country: 'RO' } as never,
          'billing',
        ),
      ).toEqual([]);
      expect(
        cmp.addressIssueKeys(
          { line1: 'a', city: 'c', postal_code: '123456', country: 'RO', phone: '()' } as never,
          'shipping',
        ),
      ).toContain('adminUi.orders.addressValidate.phoneMissing');
    });

    it('normalizeCountry defaults a missing country', () => {
      const { cmp } = setup();
      expect(
        cmp.addressIssueKeys(
          { line1: 'a', city: 'c', postal_code: '90210', phone: '+40721234567' } as never,
          'shipping',
        ),
      ).toEqual([]);
    });

    it('validateTrackingFields defaults null fields and returns null when both are empty', () => {
      const { cmp } = setup();
      expect(cmp['validateTrackingFields']('dpd', null as never, null as never)).toBeNull();
    });

    it('openShipmentEditor defaults a missing tracking number', () => {
      const { cmp } = setup();
      cmp.openShipmentEditor({
        id: 's',
        order_id: 'o',
        tracking_number: undefined as never,
        created_at: 'now',
      });
      expect(cmp.shipmentTrackingNumber).toBe('');
    });

    it('saveFulfillment defaults a missing quantity and rebuilds with missing items/shipped_quantity', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      delete c.cmp.fulfillmentQty['item-x'];
      c.api.fulfillItem.and.returnValue(of(makeOrder({ items: undefined as never })));
      c.cmp.saveFulfillment('item-x', undefined as never);
      expect(c.api.fulfillItem).toHaveBeenCalled();
      c.api.fulfillItem.and.returnValue(
        of(makeOrder({ items: [makeItem({ id: 'i9', shipped_quantity: undefined })] })),
      );
      c.cmp.saveFulfillment('item-1', 2);
      expect(c.cmp.fulfillmentQty['i9']).toBe(0);
    });

    it('paymentMethodLabel defaults a missing method', () => {
      const { cmp } = setup();
      cmp.order.set(makeOrder({ payment_method: undefined }));
      expect(cmp.paymentMethodLabel()).toBe('—');
    });

    it('eventDiffRows handles a status_change note without an arrow', () => {
      const { cmp } = setup();
      expect(
        cmp.eventDiffRows({
          id: 'e',
          event: 'status_change',
          note: 'plain note',
          created_at: 'now',
        }),
      ).toEqual([]);
    });

    it('eventAddressDiff defaults missing from/to values', () => {
      const { cmp } = setup();
      const res = cmp.eventAddressDiff({
        id: 'e',
        event: 'u',
        data: { changes: { shipping_address: {} } },
        created_at: 'now',
      });
      expect(res?.shipping).toEqual({ from: null, to: null });
    });

    it('refundBreakdown defaults missing amounts to zero', () => {
      const { cmp } = setup();
      cmp.order.set(
        makeOrder({
          total_amount: undefined as never,
          shipping_amount: undefined,
          tax_amount: undefined,
          fee_amount: undefined,
        }),
      );
      expect(cmp.refundBreakdown()).toEqual({ subtotal: 0, shipping: 0, vat: 0, fee: 0, total: 0 });
    });

    it('fraudReviewStatus defaults a null tag entry', () => {
      const { cmp } = setup();
      cmp.order.set(makeOrder({ tags: [null as never, 'vip'] }));
      expect(cmp.fraudReviewStatus()).toBeNull();
    });

    it('toggleTestTag covers detail/fallback across add and remove', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.order.set(makeOrder({ tags: [] }));
      c.api.addOrderTag.and.returnValue(throwError(() => ({})));
      c.cmp.toggleTestTag();
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.tags.errors.add');
      c.cmp.order.set(makeOrder({ tags: ['test'] }));
      c.api.removeOrderTag.and.returnValue(throwError(() => ({ error: { detail: 'rm' } })));
      c.cmp.toggleTestTag();
      expect(c.toast.error).toHaveBeenCalledWith('rm');
    });

    it('removeTag tolerates a null error object', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.api.removeOrderTag.and.returnValue(throwError(() => null));
      c.cmp.removeTag('vip');
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.tags.errors.remove');
    });

    it('addTag tolerates a null error object', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.tagToAdd = 'vip';
      c.api.addOrderTag.and.returnValue(throwError(() => null));
      c.cmp.addTag();
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.tags.errors.add');
    });

    it('refund totals default missing amounts', () => {
      const { cmp } = setup();
      cmp.order.set(
        makeOrder({
          total_amount: undefined as never,
          refunds: [
            {
              id: 'r',
              amount: undefined as never,
              currency: 'RON',
              provider: 'p',
              created_at: 'now',
            },
          ],
        }),
      );
      expect(cmp.refundsTotal()).toBe(0);
      expect(cmp.refundableRemaining()).toBe(0);
      cmp.order.set(makeOrder({ refunds: undefined }));
      expect(cmp.refundsTotal()).toBe(0);
    });

    it('partial refund helpers default missing values', () => {
      const { cmp } = setup();
      cmp.order.set(
        makeOrder({
          refunds: [
            {
              id: 'r',
              amount: 1,
              currency: 'RON',
              provider: 'p',
              created_at: 'now',
              data: { items: [{ quantity: 1 }, { order_item_id: 'item-1' }] },
            },
          ],
        }),
      );
      expect(
        cmp.partialRefundMaxQty(makeItem({ id: 'item-1', quantity: undefined as never })),
      ).toBe(0);
      expect(
        cmp.partialRefundLineTotal(makeItem({ id: 'item-1', unit_price: undefined as never })),
      ).toBe(0);
      expect(cmp.partialRefundSelectionTotal(makeOrder({ items: undefined as never }))).toBe(0);
    });

    it('canProcessPartialRefund and the hint default a missing method', () => {
      const { cmp } = setup();
      cmp.order.set(makeOrder({ payment_method: undefined }));
      expect(cmp.canProcessPartialRefund()).toBeFalse();
      expect(cmp.processPartialRefundHint()).toBe(
        'adminUi.orders.partialRefundWizard.processPaymentHintUnsupported',
      );
    });

    it('openPartialRefundWizard defaults missing items', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.order.set(makeOrder({ status: 'paid', items: undefined as never }));
      c.cmp.openPartialRefundWizard();
      expect(c.cmp.partialRefundWizardOpen()).toBeTrue();
    });

    it('save defaults a blank current status and clears tracking fields', () => {
      const c = setup();
      c.cmp.order.set(
        makeOrder({
          id: 'o1',
          status: '' as never,
          tracking_number: 'OLD',
          tracking_url: 'https://old',
        }),
      );
      c.cmp.statusValue = 'pending_acceptance';
      c.cmp.trackingNumber = '';
      c.cmp.trackingUrl = '';
      c.cmp.save();
      const payload = c.api.update.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(payload['status']).toBeUndefined();
      expect(payload['tracking_number']).toBeNull();
      expect(payload['tracking_url']).toBeNull();
    });

    it('deliveryTypeLabel defaults a missing delivery type', () => {
      const { cmp } = setup();
      cmp.order.set(makeOrder({ delivery_type: undefined }));
      expect(cmp.deliveryTypeLabel()).toBe('—');
    });

    it('shippingLabelHistory defaults missing events and a blank event name', () => {
      const { cmp } = setup();
      cmp.order.set(makeOrder({ events: undefined }));
      expect(cmp.shippingLabelHistory()).toEqual([]);
      cmp.order.set(
        makeOrder({
          events: [
            { id: '1', event: '' as never, created_at: '2026-01-01' },
            { id: '2', event: 'shipping_label_uploaded', created_at: '2026-01-02' },
          ],
        }),
      );
      expect(cmp.shippingLabelHistory().length).toBe(1);
    });

    it('downloadPackingSlip and downloadReceiptPdf fall back to the order id when no order is loaded', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.order.set(null);
      c.cmp.downloadPackingSlip();
      expect(c.api.downloadPackingSlip).toHaveBeenCalled();
      c.cmp.downloadReceiptPdf();
      expect(c.api.downloadReceiptPdf).toHaveBeenCalled();
    });

    it('shareReceipt skips an expired or detail-less cached link and copies a fresh link', fakeAsync(() => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      const writeText = spyOn(navigator.clipboard, 'writeText').and.resolveTo(undefined);
      c.cmp.receiptShare.set({
        token: 't',
        receipt_url: 'https://r/x',
        receipt_pdf_url: '',
        expires_at: '',
      });
      c.cmp.shareReceipt();
      tick();
      expect(c.api.shareReceipt).toHaveBeenCalled();
      expect(c.toast.success).toHaveBeenCalledWith('adminUi.orders.receiptLinks.copied');
      expect(writeText).toHaveBeenCalled();
    }));

    it('shareReceipt ignores a past cached expiry', fakeAsync(() => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      spyOn(navigator.clipboard, 'writeText').and.resolveTo(undefined);
      c.cmp.receiptShare.set({
        token: 't',
        receipt_url: 'https://r/x',
        receipt_pdf_url: '',
        expires_at: '2000-01-01T00:00:00Z',
      });
      c.cmp.shareReceipt();
      tick();
      expect(c.api.shareReceipt).toHaveBeenCalled();
    }));

    it('load defaults missing items and shipped quantities', () => {
      const c = setup();
      c.api.get.and.returnValue(of(makeOrder({ id: 'o9', items: undefined as never })));
      c.cmp['load']('o9');
      expect(c.cmp.fulfillmentQty).toEqual({});
      c.api.get.and.returnValue(
        of(makeOrder({ id: 'o9', items: [makeItem({ id: 'i7', shipped_quantity: undefined })] })),
      );
      c.cmp['load']('o9');
      expect(c.cmp.fulfillmentQty['i7']).toBe(0);
    });

    it('toggleReturnCreate defaults missing items', () => {
      const c = setup();
      c.cmp.order.set(makeOrder({ items: undefined as never }));
      c.cmp.toggleReturnCreate();
      expect(c.cmp.showReturnCreate()).toBeTrue();
    });

    it('createReturnRequest defaults missing items, quantities and order quantity', () => {
      const c = setup();
      c.cmp.order.set(makeOrder({ id: 'o1', items: undefined as never }));
      c.cmp.returnReason = 'broken';
      c.cmp.createReturnRequest();
      expect(c.cmp.returnCreateError()).toBe('adminUi.returns.create.itemsRequired');
      c.cmp.order.set(
        makeOrder({ id: 'o1', items: [makeItem({ id: 'i1', quantity: undefined as never })] }),
      );
      c.cmp.returnReason = 'broken';
      c.cmp.returnQty = {};
      c.cmp.createReturnRequest();
      expect(c.cmp.returnCreateError()).toBe('adminUi.returns.create.itemsRequired');
    });

    it('applyAddressPhoneSuggestion and applyAddressPostalSuggestion default blank values', () => {
      const { cmp } = setup();
      cmp.applyAddressPhoneSuggestion('');
      expect(cmp.addressPhone).toBe('');
      cmp.applyAddressPostalSuggestion('');
      expect(cmp.addressPostalCode).toBe('');
    });

    it('addressPostalSuggestion returns null when there is no suggestion', () => {
      const { cmp } = setup();
      cmp.addressCountry = 'US';
      cmp.addressPostalCode = '90210';
      expect(cmp.addressPostalSuggestion()).toBeNull();
    });

    it('email status helpers default a blank status', () => {
      const { cmp } = setup();
      expect(cmp.emailStatusLabel('')).toBe('');
      expect(cmp.emailStatusChipClass('')).toContain('slate');
    });

    it('openAddressEditor defaults every missing address field', () => {
      const c = setup();
      c.cmp.order.set(makeOrder({ shipping_address: {} as never }));
      c.cmp.openAddressEditor('shipping');
      expect(c.cmp.addressLine1).toBe('');
      expect(c.cmp.addressCity).toBe('');
      expect(c.cmp.addressPostalCode).toBe('');
      expect(c.cmp.addressCountry).toBe('');
    });

    it('removeTag falls back when the error has an empty error object', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.api.removeOrderTag.and.returnValue(throwError(() => ({ error: {} })));
      c.cmp.removeTag('vip');
      expect(c.toast.error).toHaveBeenCalledWith('adminUi.orders.tags.errors.remove');
    });

    it('shippingLabelHistory orders ascending timestamps correctly', () => {
      const { cmp } = setup();
      cmp.order.set(
        makeOrder({
          events: [
            { id: '1', event: 'shipping_label_uploaded', created_at: '2026-01-01' },
            { id: '2', event: 'shipping_label_printed', created_at: '2026-01-05' },
          ],
        }),
      );
      const hist = cmp.shippingLabelHistory();
      expect(hist[0].event).toBe('shipping_label_printed');
    });

    it('shareReceipt requests a new link when the cached link has no url', fakeAsync(() => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      spyOn(navigator.clipboard, 'writeText').and.resolveTo(undefined);
      c.cmp.receiptShare.set({
        token: 't',
        receipt_url: '',
        receipt_pdf_url: '',
        expires_at: '2999-01-01T00:00:00Z',
      });
      c.cmp.shareReceipt();
      tick();
      expect(c.api.shareReceipt).toHaveBeenCalled();
    }));

    it('eventDiffRows defaults a missing event name', () => {
      const { cmp } = setup();
      expect(
        cmp.eventDiffRows({ id: 'e', event: undefined as never, note: 'x', created_at: 'now' }),
      ).toEqual([]);
    });

    it('removeTag defaults a null tag argument', () => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      c.cmp.removeTag(null as never);
      expect(c.api.removeOrderTag).not.toHaveBeenCalled();
    });

    it('shareReceipt reports a failed copy of a cached link', fakeAsync(() => {
      const c = setup();
      c.cmp['orderId'] = 'order-1234567890ab';
      spyOn(navigator.clipboard, 'writeText').and.rejectWith(new Error('blocked'));
      c.cmp.receiptShare.set({
        token: 't',
        receipt_url: 'https://r/x',
        receipt_pdf_url: '',
        expires_at: '2999-01-01T00:00:00Z',
      });
      c.cmp.shareReceipt();
      tick();
      expect(c.api.shareReceipt).not.toHaveBeenCalled();
      expect(c.toast.success).toHaveBeenCalledWith('adminUi.orders.receiptLinks.ready');
    }));

    it('shippingLabelHistory sorts a descending input (older after newer)', () => {
      const { cmp } = setup();
      cmp.order.set(
        makeOrder({
          events: [
            { id: '1', event: 'shipping_label_printed', created_at: '2026-01-05' },
            { id: '2', event: 'shipping_label_uploaded', created_at: '2026-01-01' },
          ],
        }),
      );
      expect(cmp.shippingLabelHistory()[0].event).toBe('shipping_label_printed');
    });
  });
});
