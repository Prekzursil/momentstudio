import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import {
  AdminOrderDocumentExport,
  AdminOrderDocumentExportListResponse,
  AdminOrdersService,
} from '../../../core/admin-orders.service';
import { ToastService } from '../../../core/toast.service';
import { AdminOrderExportsComponent } from './admin-order-exports.component';

function makeResponse(
  items: AdminOrderDocumentExport[],
  totalPages: number,
): AdminOrderDocumentExportListResponse {
  return {
    items,
    meta: { total_items: items.length, total_pages: totalPages, page: 1, limit: 50 },
  };
}

function makeExport(overrides: Partial<AdminOrderDocumentExport> = {}): AdminOrderDocumentExport {
  return {
    id: 'exp-1',
    kind: 'packing_slip',
    filename: 'slip.pdf',
    mime_type: 'application/pdf',
    created_at: '2026-02-17T00:00:00Z',
    expires_at: null,
    order_id: null,
    order_reference: 'ORD-1',
    order_count: 0,
    ...overrides,
  };
}

describe('AdminOrderExportsComponent', () => {
  let api: jasmine.SpyObj<AdminOrdersService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: jasmine.SpyObj<Router>;
  let translate: TranslateService;

  function createComponent(): AdminOrderExportsComponent {
    return TestBed.inject(AdminOrderExportsComponent);
  }

  beforeEach(() => {
    api = jasmine.createSpyObj<AdminOrdersService>('AdminOrdersService', [
      'listDocumentExports',
      'downloadDocumentExport',
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    router = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);

    // Default: empty success so ngOnInit's load() resolves cleanly.
    api.listDocumentExports.and.returnValue(of(makeResponse([], 1)));
    router.navigateByUrl.and.returnValue(Promise.resolve(true));

    TestBed.configureTestingModule({
      imports: [AdminOrderExportsComponent, TranslateModule.forRoot()],
      providers: [
        AdminOrderExportsComponent,
        { provide: AdminOrdersService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: Router, useValue: router },
      ],
    });

    translate = TestBed.inject(TranslateService);
    translate.use('en');
    spyOn(translate, 'instant').and.callFake((key: string | string[]) => key as string);
  });

  it('loads exports on init', () => {
    const items = [makeExport()];
    api.listDocumentExports.and.returnValue(of(makeResponse(items, 3)));

    const component = createComponent();
    component.ngOnInit();

    expect(api.listDocumentExports).toHaveBeenCalledWith({ page: 1, limit: 50 });
    expect(component.items()).toEqual(items);
    expect(component.meta()?.total_pages).toBe(3);
    expect(component.loading()).toBeFalse();
    expect(component.error()).toBeNull();
  });

  it('falls back to empty collections when the response is null', () => {
    api.listDocumentExports.and.returnValue(
      of(null as unknown as AdminOrderDocumentExportListResponse),
    );

    const component = createComponent();
    component.load();

    expect(component.items()).toEqual([]);
    expect(component.meta()).toBeNull();
    expect(component.loading()).toBeFalse();
  });

  it('falls back to empty collections when items and meta are missing', () => {
    api.listDocumentExports.and.returnValue(
      of({ items: undefined, meta: undefined } as unknown as AdminOrderDocumentExportListResponse),
    );

    const component = createComponent();
    component.load();

    expect(component.items()).toEqual([]);
    expect(component.meta()).toBeNull();
  });

  it('records the error state and request id when loading fails', () => {
    api.listDocumentExports.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 500, error: { request_id: 'req-99' } })),
    );

    const component = createComponent();
    component.load();

    expect(component.error()).toBe('adminUi.orders.exports.errors.load');
    expect(component.errorRequestId()).toBe('req-99');
    expect(component.items()).toEqual([]);
    expect(component.meta()).toBeNull();
    expect(component.loading()).toBeFalse();
  });

  it('navigates back to the orders list', () => {
    const component = createComponent();
    component.backToOrders();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/orders');
  });

  it('clamps pagination to a minimum of page 1 and reloads', () => {
    const component = createComponent();
    api.listDocumentExports.calls.reset();

    component.goTo(0);
    expect(component.page).toBe(1);
    expect(api.listDocumentExports).toHaveBeenCalledWith({ page: 1, limit: 50 });

    component.goTo(4);
    expect(component.page).toBe(4);
    expect(api.listDocumentExports).toHaveBeenCalledWith({ page: 4, limit: 50 });
  });

  describe('isExpired', () => {
    let component: AdminOrderExportsComponent;

    beforeEach(() => {
      component = createComponent();
    });

    it('returns false when expires_at is null', () => {
      expect(component.isExpired(makeExport({ expires_at: null }))).toBeFalse();
    });

    it('returns false when expires_at is blank', () => {
      expect(component.isExpired(makeExport({ expires_at: '   ' }))).toBeFalse();
    });

    it('returns false when expires_at is not a valid date', () => {
      expect(component.isExpired(makeExport({ expires_at: 'not-a-date' }))).toBeFalse();
    });

    it('returns false when expiry is in the future', () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      expect(component.isExpired(makeExport({ expires_at: future }))).toBeFalse();
    });

    it('returns true when expiry is in the past', () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      expect(component.isExpired(makeExport({ expires_at: past }))).toBeTrue();
    });
  });

  describe('kindLabel', () => {
    let component: AdminOrderExportsComponent;

    beforeEach(() => {
      component = createComponent();
    });

    it('maps every known kind to its translation key', () => {
      expect(component.kindLabel('packing_slip')).toBe('adminUi.orders.exports.kinds.packingSlip');
      expect(component.kindLabel('packing_slips_batch')).toBe(
        'adminUi.orders.exports.kinds.packingSlipsBatch',
      );
      expect(component.kindLabel('shipping_label')).toBe(
        'adminUi.orders.exports.kinds.shippingLabel',
      );
      expect(component.kindLabel('receipt')).toBe('adminUi.orders.exports.kinds.receipt');
    });

    it('returns the raw kind for an unknown kind', () => {
      expect(component.kindLabel('mystery')).toBe('mystery');
    });
  });

  describe('download', () => {
    let component: AdminOrderExportsComponent;
    let anchor: { href: string; download: string; click: jasmine.Spy };

    beforeEach(() => {
      component = createComponent();
      anchor = { href: '', download: '', click: jasmine.createSpy('click') };
      spyOn(document, 'createElement').and.returnValue(anchor as unknown as HTMLAnchorElement);
      spyOn(URL, 'createObjectURL').and.returnValue('blob:fake-url');
      spyOn(URL, 'revokeObjectURL');
    });

    it('does nothing when the item has no id', () => {
      component.download(makeExport({ id: '' }));
      expect(api.downloadDocumentExport).not.toHaveBeenCalled();
      expect(component.busyId()).toBeNull();
    });

    it('does nothing when the item is missing', () => {
      component.download(null as unknown as AdminOrderDocumentExport);
      expect(api.downloadDocumentExport).not.toHaveBeenCalled();
    });

    it('toasts and aborts when the export is already expired', () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      component.download(makeExport({ expires_at: past }));

      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.exports.errors.expired');
      expect(api.downloadDocumentExport).not.toHaveBeenCalled();
      expect(component.busyId()).toBeNull();
    });

    it('downloads the blob via a synthesized anchor', () => {
      const blob = new Blob(['pdf']);
      api.downloadDocumentExport.and.returnValue(of(blob));

      component.download(makeExport({ id: 'exp-7', filename: 'label.pdf' }));

      expect(api.downloadDocumentExport).toHaveBeenCalledWith('exp-7');
      expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
      expect(anchor.href).toBe('blob:fake-url');
      expect(anchor.download).toBe('label.pdf');
      expect(anchor.click).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
      expect(component.busyId()).toBeNull();
    });

    it('falls back to a default filename when none is provided', () => {
      api.downloadDocumentExport.and.returnValue(of(new Blob(['pdf'])));

      component.download(makeExport({ filename: '' }));

      expect(anchor.download).toBe('export.pdf');
    });

    it('toasts a download error and clears the busy id on failure', () => {
      api.downloadDocumentExport.and.returnValue(throwError(() => new Error('boom')));

      component.download(makeExport({ id: 'exp-9' }));

      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.exports.errors.download');
      expect(component.busyId()).toBeNull();
    });
  });
});
