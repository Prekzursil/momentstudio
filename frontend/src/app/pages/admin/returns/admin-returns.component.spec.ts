import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';

import {
  AdminReturnsService,
  ReturnRequestListItem,
  ReturnRequestRead,
} from '../../../core/admin-returns.service';
import { ToastService } from '../../../core/toast.service';
import { AdminReturnsComponent } from './admin-returns.component';

const listItem: ReturnRequestListItem = {
  id: 'r1',
  order_id: 'order-1234567890',
  order_reference: 'ORD-1',
  customer_email: 'c@x.com',
  customer_name: 'Cust',
  status: 'requested',
  created_at: '2026-01-01T00:00:00Z',
};

const detail: ReturnRequestRead = {
  id: 'r1',
  order_id: 'order-1234567890',
  order_reference: 'ORD-1',
  customer_email: 'c@x.com',
  customer_name: 'Cust',
  status: 'approved',
  reason: 'It broke',
  customer_message: 'please help',
  admin_note: 'note',
  has_return_label: true,
  return_label_filename: 'label.pdf',
  return_label_uploaded_at: '2026-01-02T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  items: [{ id: 'i1', quantity: 2, product_name: 'Widget' }],
};

describe('AdminReturnsComponent', () => {
  let api: jasmine.SpyObj<AdminReturnsService>;
  let toast: jasmine.SpyObj<ToastService>;
  let route$: Subject<ParamMap>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<AdminReturnsService>('AdminReturnsService', [
      'search',
      'get',
      'update',
      'uploadReturnLabel',
      'downloadReturnLabel',
      'deleteReturnLabel',
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    route$ = new Subject<ParamMap>();

    api.search.and.returnValue(of({ items: [], meta: {} } as any));
    api.get.and.returnValue(of(detail));
    api.update.and.returnValue(of(detail));
    api.uploadReturnLabel.and.returnValue(of(detail));
    api.downloadReturnLabel.and.returnValue(of(new Blob(['x'])));
    api.deleteReturnLabel.and.returnValue(of(undefined as unknown as void));

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminReturnsComponent],
      providers: [
        provideRouter([]),
        { provide: AdminReturnsService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: ActivatedRoute, useValue: { queryParamMap: route$.asObservable() } },
      ],
    }).compileComponents();
  });

  function make(): {
    fixture: ComponentFixture<AdminReturnsComponent>;
    cmp: AdminReturnsComponent;
  } {
    const fixture = TestBed.createComponent(AdminReturnsComponent);
    return { fixture, cmp: fixture.componentInstance };
  }

  function emit(obj: Record<string, string>): void {
    route$.next(convertToParamMap(obj));
  }

  it('loads the list and applies a valid `status` query param', () => {
    const { cmp } = make();
    emit({ status: 'approved' });
    expect(cmp.statusFilter).toBe('approved');
    expect(cmp.viewMode()).toBe('list');
    expect(api.search).toHaveBeenCalledWith(
      jasmine.objectContaining({ status_filter: 'approved', page: 1, limit: 25 }),
    );
  });

  it('falls back to the `status_filter` param and captures order_id + items', () => {
    api.search.and.returnValue(
      of({ items: [listItem], meta: { page: 1, total_pages: 2, total_items: 10 } } as any),
    );
    const { cmp } = make();
    emit({ status_filter: 'received', order_id: 'ord-7' });
    expect(cmp.statusFilter).toBe('received');
    expect(cmp.orderIdFilter).toBe('ord-7');
    expect(cmp.items().length).toBe(1);
    expect(api.search).toHaveBeenCalledWith(jasmine.objectContaining({ order_id: 'ord-7' }));
  });

  it('ignores an unrecognised status param', () => {
    const { cmp } = make();
    emit({ status: 'bogus' });
    expect(cmp.statusFilter).toBe('');
  });

  it('loads the board when a param emits while in board view', () => {
    api.search.and.returnValue(of({ items: [listItem], meta: { total_items: 3 } } as any));
    const { cmp } = make();
    cmp.viewMode.set('board');
    emit({});
    expect(cmp.board().requested.total).toBe(3);
    expect(cmp.boardLoading()).toBeFalse();
  });

  it('defaults items to an empty array and surfaces the request id on load error', () => {
    api.search.and.returnValue(of({ items: undefined, meta: {} } as any));
    const { cmp } = make();
    emit({});
    expect(cmp.items()).toEqual([]);

    api.search.and.returnValue(
      throwError(() => new HttpErrorResponse({ error: { request_id: 'rid-1' } })),
    );
    cmp.retryLoad();
    expect(cmp.error()).toBeTruthy();
    expect(cmp.errorRequestId()).toBe('rid-1');
    expect(cmp.loading()).toBeFalse();
  });

  it('clears the current selection when reloading the list', () => {
    const { cmp } = make();
    cmp.selectedId.set('r1');
    cmp.selected.set(detail);
    emit({});
    expect(cmp.selectedId()).toBeNull();
    expect(cmp.selected()).toBeNull();
  });

  it('applyFilters sends trimmed query + status in list mode', () => {
    const { cmp } = make();
    emit({});
    cmp.query = '  hello  ';
    cmp.statusFilter = 'approved';
    cmp.applyFilters();
    expect(cmp.page).toBe(1);
    expect(api.search).toHaveBeenCalledWith(
      jasmine.objectContaining({ q: 'hello', status_filter: 'approved' }),
    );
  });

  it('applyFilters and retryLoad use the board loader in board mode', () => {
    api.search.and.returnValue(of({ items: [listItem], meta: { total_items: 4 } } as any));
    const { cmp } = make();
    cmp.viewMode.set('board');
    cmp.query = '  q  ';
    cmp.orderIdFilter = 'ord-9';
    cmp.applyFilters();
    expect(api.search).toHaveBeenCalledWith(
      jasmine.objectContaining({ q: 'q', order_id: 'ord-9', status_filter: 'requested' }),
    );
    cmp.retryLoad();
    expect(cmp.board().approved.total).toBe(4);
  });

  it('retryLoad reloads the list in list mode', () => {
    const { cmp } = make();
    api.search.calls.reset();
    cmp.retryLoad();
    expect(api.search).toHaveBeenCalledTimes(1);
  });

  it('computes pagination guards and paginates', () => {
    const { cmp } = make();
    cmp.meta.set({});
    expect(cmp.hasPrev()).toBeFalse();
    expect(cmp.hasNext()).toBeFalse();
    cmp.prev();
    cmp.next();

    cmp.meta.set({ page: 2, total_pages: 3 });
    expect(cmp.hasPrev()).toBeTrue();
    expect(cmp.hasNext()).toBeTrue();
    cmp.prev();
    expect(cmp.page).toBe(1);
    cmp.meta.set({ page: 2, total_pages: 3 });
    cmp.next();
    expect(cmp.page).toBe(3);
  });

  it('prev/next default the page to 1 when meta omits a page number', () => {
    const { cmp } = make();
    spyOn(cmp, 'hasPrev').and.returnValue(true);
    cmp.meta.set({});
    cmp.prev();
    expect(cmp.page).toBe(0);

    spyOn(cmp, 'hasNext').and.returnValue(true);
    cmp.meta.set({});
    cmp.next();
    expect(cmp.page).toBe(2);
  });

  it('selects a return and populates the edit form', () => {
    const { cmp } = make();
    cmp.select('');
    expect(api.get).not.toHaveBeenCalled();

    cmp.select('r1');
    expect(cmp.selected()).toEqual(detail);
    expect(cmp.editStatus).toBe('approved');
    expect(cmp.editNote).toBe('note');
    expect(cmp.detailLoading()).toBeFalse();

    api.get.and.returnValue(of({ ...detail, admin_note: null }));
    cmp.select('r2');
    expect(cmp.editNote).toBe('');
  });

  it('toasts and stops loading when a detail fetch fails', () => {
    api.get.and.returnValue(throwError(() => new Error('x')));
    const { cmp } = make();
    cmp.select('r1');
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.detailLoading()).toBeFalse();
  });

  it('setView ignores no-op, switches to board (clearing status) and back to list', () => {
    const { cmp } = make();
    cmp.statusFilter = 'approved';
    cmp.setView('list');
    expect(cmp.viewMode()).toBe('list');

    cmp.setView('board');
    expect(cmp.viewMode()).toBe('board');
    expect(cmp.statusFilter).toBe('');

    api.search.calls.reset();
    cmp.setView('list');
    expect(cmp.viewMode()).toBe('list');
    expect(api.search).toHaveBeenCalled();
  });

  it('openStatusList switches to a filtered list view', () => {
    const { cmp } = make();
    api.search.calls.reset();
    cmp.openStatusList('refunded');
    expect(cmp.viewMode()).toBe('list');
    expect(cmp.statusFilter).toBe('refunded');
    expect(cmp.page).toBe(1);
    expect(api.search).toHaveBeenCalled();
  });

  it('returnLabelFileName uses the selected name or a translated placeholder', () => {
    const { cmp } = make();
    cmp.returnLabelSelectedName.set('a.pdf');
    expect(cmp.returnLabelFileName()).toBe('a.pdf');
    cmp.returnLabelSelectedName.set('');
    expect(cmp.returnLabelFileName()).toBe('adminUi.returns.detail.returnLabelNoFile');
  });

  it('onReturnLabelSelected handles a chosen file, an empty list and a null target', () => {
    const { cmp } = make();
    const file = new File(['x'], 'chosen.pdf');
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.value = '';
    cmp.onReturnLabelSelected({ target: input } as unknown as Event);
    expect(cmp.returnLabelFile).toBe(file);
    expect(cmp.returnLabelSelectedName()).toBe('chosen.pdf');

    const empty = document.createElement('input');
    Object.defineProperty(empty, 'files', { value: [], configurable: true });
    cmp.onReturnLabelSelected({ target: empty } as unknown as Event);
    expect(cmp.returnLabelFile).toBeNull();
    expect(cmp.returnLabelSelectedName()).toBe('');

    cmp.onReturnLabelSelected({ target: null } as unknown as Event);
    expect(cmp.returnLabelFile).toBeNull();
  });

  it('uploadReturnLabel guards on missing id/file then uploads successfully', () => {
    const { cmp } = make();
    const file = new File(['x'], 'a.pdf');

    cmp.selectedId.set(null);
    cmp.returnLabelFile = file;
    cmp.uploadReturnLabel();
    expect(api.uploadReturnLabel).not.toHaveBeenCalled();

    cmp.selectedId.set('r1');
    cmp.returnLabelFile = null;
    cmp.uploadReturnLabel();
    expect(api.uploadReturnLabel).not.toHaveBeenCalled();

    cmp.returnLabelFile = file;
    cmp.uploadReturnLabel();
    expect(cmp.selected()).toEqual(detail);
    expect(cmp.returnLabelFile).toBeNull();
    expect(cmp.returnLabelBusy()).toBeFalse();
    expect(toast.success).toHaveBeenCalled();
  });

  it('uploadReturnLabel reports the server detail then a translated fallback', () => {
    const { cmp } = make();
    cmp.selectedId.set('r1');
    cmp.returnLabelFile = new File(['x'], 'a.pdf');
    api.uploadReturnLabel.and.returnValue(throwError(() => ({ error: { detail: 'too big' } })));
    cmp.uploadReturnLabel();
    expect(cmp.returnLabelError()).toBe('too big');
    expect(toast.error).toHaveBeenCalledWith('too big');

    cmp.returnLabelFile = new File(['x'], 'a.pdf');
    api.uploadReturnLabel.and.returnValue(throwError(() => null));
    cmp.uploadReturnLabel();
    expect(cmp.returnLabelError()).toBe('adminUi.returns.errors.save');
  });

  it('downloadReturnLabel guards on missing id', () => {
    const { cmp } = make();
    cmp.selectedId.set(null);
    cmp.downloadReturnLabel();
    expect(api.downloadReturnLabel).not.toHaveBeenCalled();
  });

  it('downloadReturnLabel saves a blob using the stored filename', () => {
    const { cmp } = make();
    const createSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    const revokeSpy = spyOn(URL, 'revokeObjectURL');
    const clickSpy = spyOn(HTMLAnchorElement.prototype, 'click');
    cmp.selectedId.set('r1234567890');
    cmp.selected.set(detail);
    cmp.downloadReturnLabel();
    expect(createSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalled();
    expect(cmp.returnLabelBusy()).toBeFalse();
  });

  it('downloadReturnLabel derives the filename from the order id slice', () => {
    const { cmp } = make();
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    spyOn(URL, 'revokeObjectURL');
    const anchor = document.createElement('a');
    const clickSpy = spyOn(anchor, 'click');
    spyOn(document, 'createElement').and.returnValue(anchor);
    cmp.selectedId.set('idABCDEFGH');
    cmp.selected.set({ ...detail, order_reference: null, return_label_filename: null });
    cmp.downloadReturnLabel();
    expect(clickSpy).toHaveBeenCalled();
    expect(anchor.download).toBe('return-order-12-label');
  });

  it('downloadReturnLabel falls back to the selection id when no selection is loaded', () => {
    const { cmp } = make();
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    spyOn(URL, 'revokeObjectURL');
    const anchor = document.createElement('a');
    spyOn(anchor, 'click');
    spyOn(document, 'createElement').and.returnValue(anchor);
    cmp.selectedId.set('idABCDEFGH');
    cmp.selected.set(null);
    cmp.downloadReturnLabel();
    expect(anchor.download).toBe('return-idABCDEF-label');
  });

  it('downloadReturnLabel reports the server detail then a translated fallback', () => {
    const { cmp } = make();
    cmp.selectedId.set('r1');
    api.downloadReturnLabel.and.returnValue(throwError(() => ({ error: { detail: 'gone' } })));
    cmp.downloadReturnLabel();
    expect(cmp.returnLabelError()).toBe('gone');
    expect(toast.error).toHaveBeenCalledWith('gone');

    api.downloadReturnLabel.and.returnValue(throwError(() => null));
    cmp.downloadReturnLabel();
    expect(cmp.returnLabelError()).toBe('adminUi.returns.errors.loadDetail');
  });

  it('deleteReturnLabel guards on missing id and declined confirmation', () => {
    const { cmp } = make();
    cmp.selectedId.set(null);
    cmp.deleteReturnLabel();
    expect(api.deleteReturnLabel).not.toHaveBeenCalled();

    cmp.selectedId.set('r1');
    spyOn(window, 'confirm').and.returnValue(false);
    cmp.deleteReturnLabel();
    expect(api.deleteReturnLabel).not.toHaveBeenCalled();
  });

  it('deleteReturnLabel clears label fields on the current selection', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    const { cmp } = make();
    cmp.selectedId.set('r1');
    cmp.selected.set(detail);
    cmp.deleteReturnLabel();
    expect(cmp.selected()!.has_return_label).toBeFalse();
    expect(cmp.selected()!.return_label_filename).toBeNull();
    expect(cmp.returnLabelBusy()).toBeFalse();
    expect(toast.success).toHaveBeenCalled();
  });

  it('deleteReturnLabel succeeds without a loaded selection', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    const { cmp } = make();
    cmp.selectedId.set('r1');
    cmp.selected.set(null);
    cmp.deleteReturnLabel();
    expect(cmp.selected()).toBeNull();
    expect(toast.success).toHaveBeenCalled();
  });

  it('deleteReturnLabel reports the server detail then a translated fallback', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    const { cmp } = make();
    cmp.selectedId.set('r1');
    api.deleteReturnLabel.and.returnValue(throwError(() => ({ error: { detail: 'locked' } })));
    cmp.deleteReturnLabel();
    expect(cmp.returnLabelError()).toBe('locked');

    api.deleteReturnLabel.and.returnValue(throwError(() => null));
    cmp.deleteReturnLabel();
    expect(cmp.returnLabelError()).toBe('adminUi.returns.errors.save');
  });

  it('save guards on missing id then persists status and trimmed note', () => {
    const { cmp } = make();
    cmp.selectedId.set(null);
    cmp.save();
    expect(api.update).not.toHaveBeenCalled();

    cmp.selectedId.set('r1');
    cmp.editStatus = 'received';
    cmp.editNote = '  hello  ';
    api.search.calls.reset();
    cmp.save();
    expect(api.update).toHaveBeenCalledWith('r1', { status: 'received', admin_note: 'hello' });
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.saving()).toBeFalse();
    expect(api.search).toHaveBeenCalled();

    cmp.editNote = '   ';
    cmp.save();
    expect(api.update).toHaveBeenCalledWith('r1', jasmine.objectContaining({ admin_note: null }));
  });

  it('save reports the server detail then a translated fallback', () => {
    const { cmp } = make();
    cmp.selectedId.set('r1');
    api.update.and.returnValue(throwError(() => ({ error: { detail: 'conflict' } })));
    cmp.save();
    expect(toast.error).toHaveBeenCalledWith('conflict');
    expect(cmp.saving()).toBeFalse();

    api.update.and.returnValue(throwError(() => null));
    cmp.save();
    expect(toast.error).toHaveBeenCalledWith('adminUi.returns.errors.save');
  });

  it('loadBoard defaults empty columns and surfaces the request id on error', () => {
    const { cmp } = make();
    cmp.viewMode.set('board');
    api.search.and.returnValue(of({} as any));
    cmp.retryLoad();
    expect(cmp.board().requested.items).toEqual([]);
    expect(cmp.board().refunded.total).toBe(0);

    api.search.and.returnValue(
      throwError(() => new HttpErrorResponse({ error: { request_id: 'rid-b' } })),
    );
    cmp.retryLoad();
    expect(cmp.boardError()).toBeTruthy();
    expect(cmp.boardErrorRequestId()).toBe('rid-b');
    expect(cmp.boardLoading()).toBeFalse();
  });

  it('returns the breadcrumb trail and runs the empty lifecycle hook', () => {
    const { cmp } = make();
    cmp.ngOnInit();
    expect(cmp.crumbs().length).toBe(3);
  });

  it('unsubscribes on destroy and tolerates a missing subscription', () => {
    const { cmp } = make();
    cmp.ngOnDestroy();
    const { cmp: c2 } = make();
    (c2 as unknown as { routeSub?: unknown }).routeSub = undefined;
    expect(() => c2.ngOnDestroy()).not.toThrow();
  });

  it('renders the list table and the loaded detail panel', () => {
    api.search.and.returnValue(
      of({ items: [listItem], meta: { page: 1, total_pages: 1, total_items: 1 } } as any),
    );
    const { fixture, cmp } = make();
    emit({});
    cmp.selected.set(detail);
    cmp.detailLoading.set(false);
    fixture.detectChanges();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('ORD-1');
    expect(text).toContain('Cust');
    expect(text).toContain('Widget');
  });

  it('renders the board columns', () => {
    api.search.and.returnValue(of({ items: [listItem], meta: { total_items: 1 } } as any));
    const { fixture, cmp } = make();
    cmp.viewMode.set('board');
    emit({});
    fixture.detectChanges();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('adminUi.returns.status.requested');
  });
});
