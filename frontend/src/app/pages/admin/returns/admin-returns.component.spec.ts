import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';

import {
  AdminReturnsService,
  ReturnRequestListResponse,
  ReturnRequestRead,
} from '../../../core/admin-returns.service';
import { ToastService } from '../../../core/toast.service';
import { AdminReturnsComponent } from './admin-returns.component';

function makeDetail(overrides: Partial<ReturnRequestRead> = {}): ReturnRequestRead {
  return {
    id: 'ret-1',
    order_id: 'order-12345678-extra',
    order_reference: 'ORD-REF',
    customer_email: 'c@example.com',
    customer_name: 'Jane',
    status: 'requested',
    reason: 'broken',
    customer_message: 'please help',
    admin_note: 'note',
    has_return_label: true,
    return_label_filename: 'label.pdf',
    return_label_uploaded_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    items: [{ id: 'i1', order_item_id: 'oi1', quantity: 2, product_name: 'Widget' }],
    ...overrides,
  };
}

function listResponse(over: Partial<ReturnRequestListResponse> = {}): ReturnRequestListResponse {
  return {
    items: [
      {
        id: 'ret-1',
        order_id: 'order-1234',
        order_reference: 'ORD-REF',
        customer_email: 'c@example.com',
        customer_name: 'Jane',
        status: 'requested',
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
    meta: { page: 1, total_pages: 1, total_items: 1 } as any,
    ...over,
  };
}

describe('AdminReturnsComponent', () => {
  let api: jasmine.SpyObj<AdminReturnsService>;
  let toast: jasmine.SpyObj<ToastService>;
  let route$: Subject<any>;

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
    route$ = new Subject<any>();

    api.search.and.returnValue(of(listResponse()));
    api.get.and.returnValue(of(makeDetail()));
    api.update.and.returnValue(of(makeDetail()));
    api.uploadReturnLabel.and.returnValue(of(makeDetail()));
    api.downloadReturnLabel.and.returnValue(of(new Blob(['x'])));
    api.deleteReturnLabel.and.returnValue(of(undefined));

    await TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), AdminReturnsComponent],
      providers: [
        { provide: AdminReturnsService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: ActivatedRoute, useValue: { queryParamMap: route$ } },
      ],
    }).compileComponents();
  });

  function create(): AdminReturnsComponent {
    return TestBed.createComponent(AdminReturnsComponent).componentInstance;
  }

  // --- constructor / route handling --------------------------------------

  it('loads the list with defaults on an empty query param emission', () => {
    const cmp = create();
    api.search.calls.reset();
    route$.next(convertToParamMap({}));
    expect(cmp.orderIdFilter).toBeNull();
    expect(cmp.statusFilter).toBe('');
    expect(cmp.viewMode()).toBe('list');
    expect(api.search).toHaveBeenCalled();
  });

  it('applies an order_id and a normalized valid status from query params', () => {
    const cmp = create();
    route$.next(convertToParamMap({ order_id: 'o1', status: '  Approved  ' }));
    expect(cmp.orderIdFilter).toBe('o1');
    expect(cmp.statusFilter).toBe('approved');
    expect(cmp.viewMode()).toBe('list');
  });

  it('reads status_filter as a fallback and ignores invalid statuses', () => {
    const cmp = create();
    route$.next(convertToParamMap({ status_filter: 'bogus' }));
    expect(cmp.statusFilter).toBe('');
  });

  it('reloads the board view when query params change while in board mode', () => {
    const cmp = create();
    cmp.viewMode.set('board');
    api.search.calls.reset();
    route$.next(convertToParamMap({}));
    // board mode issues four parallel searches
    expect(api.search).toHaveBeenCalledTimes(4);
  });

  it('ngOnInit is a no-op and ngOnDestroy unsubscribes from the route', () => {
    const cmp = create();
    expect(() => cmp.ngOnInit()).not.toThrow();
    cmp.ngOnDestroy();
    api.search.calls.reset();
    route$.next(convertToParamMap({}));
    expect(api.search).not.toHaveBeenCalled();
  });

  // --- breadcrumbs / filters / pagination --------------------------------

  it('returns a three-item breadcrumb trail', () => {
    expect(create().crumbs().length).toBe(3);
  });

  it('applyFilters reloads list or board depending on the view', () => {
    const cmp = create();
    api.search.calls.reset();
    cmp.applyFilters();
    expect(api.search).toHaveBeenCalledTimes(1);

    cmp.viewMode.set('board');
    api.search.calls.reset();
    cmp.applyFilters();
    expect(api.search).toHaveBeenCalledTimes(4);
  });

  it('retryLoad reloads list or board depending on the view', () => {
    const cmp = create();
    api.search.calls.reset();
    cmp.retryLoad();
    expect(api.search).toHaveBeenCalledTimes(1);

    cmp.viewMode.set('board');
    api.search.calls.reset();
    cmp.retryLoad();
    expect(api.search).toHaveBeenCalledTimes(4);
  });

  it('computes hasPrev and hasNext from meta with sensible defaults', () => {
    const cmp = create();
    cmp.meta.set({});
    expect(cmp.hasPrev()).toBeFalse();
    expect(cmp.hasNext()).toBeFalse();

    cmp.meta.set({ page: 2, total_pages: 3 });
    expect(cmp.hasPrev()).toBeTrue();
    expect(cmp.hasNext()).toBeTrue();

    cmp.meta.set({ page: 3, total_pages: 3 });
    expect(cmp.hasNext()).toBeFalse();
  });

  it('prev does nothing on the first page and steps back otherwise', () => {
    const cmp = create();
    cmp.meta.set({ page: 1, total_pages: 3 });
    api.search.calls.reset();
    cmp.prev();
    expect(api.search).not.toHaveBeenCalled();

    cmp.meta.set({ page: 3, total_pages: 3 });
    cmp.prev();
    expect(cmp.page).toBe(2);
    expect(api.search).toHaveBeenCalled();
  });

  it('next does nothing on the last page and steps forward otherwise', () => {
    const cmp = create();
    cmp.meta.set({ page: 3, total_pages: 3 });
    api.search.calls.reset();
    cmp.next();
    expect(api.search).not.toHaveBeenCalled();

    cmp.meta.set({ page: 1, total_pages: 3 });
    cmp.next();
    expect(cmp.page).toBe(2);
    expect(api.search).toHaveBeenCalled();
  });

  it('next falls back to page 1 when meta has no page but more pages exist', () => {
    const cmp = create();
    cmp.meta.set({ total_pages: 3 });
    cmp.next();
    expect(cmp.page).toBe(2);
  });

  it('prev falls back to page 1 when the guard passes without a meta page', () => {
    const cmp = create();
    spyOn(cmp, 'hasPrev').and.returnValue(true);
    cmp.meta.set({});
    cmp.prev();
    expect(cmp.page).toBe(0);
  });

  // --- selection / detail ------------------------------------------------

  it('select ignores empty ids', () => {
    const cmp = create();
    cmp.select('');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('select loads a detail and seeds the edit form', () => {
    const cmp = create();
    api.get.and.returnValue(of(makeDetail({ admin_note: 'hello', status: 'approved' })));
    cmp.select('ret-1');
    expect(cmp.selectedId()).toBe('ret-1');
    expect(cmp.selected()?.id).toBe('ret-1');
    expect(cmp.editStatus).toBe('approved');
    expect(cmp.editNote).toBe('hello');
    expect(cmp.detailLoading()).toBeFalse();
  });

  it('select defaults the note to empty when admin_note is missing', () => {
    const cmp = create();
    api.get.and.returnValue(of(makeDetail({ admin_note: null })));
    cmp.select('ret-1');
    expect(cmp.editNote).toBe('');
  });

  it('select toasts and clears loading on a detail error', () => {
    const cmp = create();
    api.get.and.returnValue(throwError(() => new Error('boom')));
    cmp.select('ret-1');
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.detailLoading()).toBeFalse();
  });

  // --- view switching ----------------------------------------------------

  it('setView ignores the current mode', () => {
    const cmp = create();
    api.search.calls.reset();
    cmp.setView('list');
    expect(api.search).not.toHaveBeenCalled();
  });

  it('setView switches to board (clearing the status filter) and back to list', () => {
    const cmp = create();
    cmp.statusFilter = 'approved';
    api.search.calls.reset();
    cmp.setView('board');
    expect(cmp.viewMode()).toBe('board');
    expect(cmp.statusFilter).toBe('');
    expect(api.search).toHaveBeenCalledTimes(4);

    api.search.calls.reset();
    cmp.setView('list');
    expect(cmp.viewMode()).toBe('list');
    expect(api.search).toHaveBeenCalledTimes(1);
  });

  it('openStatusList switches to a filtered list without clearing the selection', () => {
    const cmp = create();
    cmp.selectedId.set('keep-me');
    cmp.viewMode.set('board');
    api.search.calls.reset();
    cmp.openStatusList('refunded');
    expect(cmp.viewMode()).toBe('list');
    expect(cmp.statusFilter).toBe('refunded');
    expect(cmp.selectedId()).toBe('keep-me');
    expect(api.search).toHaveBeenCalledTimes(1);
  });

  // --- return label file selection ---------------------------------------

  it('returnLabelFileName returns the selected name or a translated placeholder', () => {
    const cmp = create();
    expect(cmp.returnLabelFileName()).toBe('adminUi.returns.detail.returnLabelNoFile');
    cmp.returnLabelSelectedName.set('doc.pdf');
    expect(cmp.returnLabelFileName()).toBe('doc.pdf');
  });

  it('onReturnLabelSelected captures a chosen file and resets the input', () => {
    const cmp = create();
    const file = new File(['x'], 'label.pdf');
    const input = { files: [file], value: 'prev' } as any;
    cmp.onReturnLabelSelected({ target: input } as any);
    expect(cmp.returnLabelFile).toBe(file);
    expect(cmp.returnLabelSelectedName()).toBe('label.pdf');
    expect(input.value).toBe('');
  });

  it('onReturnLabelSelected clears state when no file is chosen', () => {
    const cmp = create();
    const input = { files: [], value: 'prev' } as any;
    cmp.onReturnLabelSelected({ target: input } as any);
    expect(cmp.returnLabelFile).toBeNull();
    expect(cmp.returnLabelSelectedName()).toBe('');
    expect(input.value).toBe('');
  });

  it('onReturnLabelSelected tolerates a null event target', () => {
    const cmp = create();
    cmp.onReturnLabelSelected({ target: null } as any);
    expect(cmp.returnLabelFile).toBeNull();
    expect(cmp.returnLabelSelectedName()).toBe('');
  });

  // --- upload return label ----------------------------------------------

  it('uploadReturnLabel does nothing without an id or a file', () => {
    const cmp = create();
    cmp.uploadReturnLabel();
    expect(api.uploadReturnLabel).not.toHaveBeenCalled();

    cmp.selectedId.set('ret-1');
    cmp.returnLabelFile = null;
    cmp.uploadReturnLabel();
    expect(api.uploadReturnLabel).not.toHaveBeenCalled();
  });

  it('uploadReturnLabel uploads and refreshes the detail on success', () => {
    const cmp = create();
    cmp.selectedId.set('ret-1');
    cmp.returnLabelFile = new File(['x'], 'label.pdf');
    cmp.returnLabelSelectedName.set('label.pdf');
    cmp.uploadReturnLabel();
    expect(api.uploadReturnLabel).toHaveBeenCalled();
    expect(cmp.returnLabelFile).toBeNull();
    expect(cmp.returnLabelSelectedName()).toBe('');
    expect(cmp.returnLabelBusy()).toBeFalse();
    expect(toast.success).toHaveBeenCalled();
  });

  it('uploadReturnLabel surfaces the server detail then a fallback on failure', () => {
    const cmp = create();
    cmp.selectedId.set('ret-1');
    cmp.returnLabelFile = new File(['x'], 'label.pdf');
    api.uploadReturnLabel.and.returnValue(throwError(() => ({ error: { detail: 'too big' } })));
    cmp.uploadReturnLabel();
    expect(cmp.returnLabelError()).toBe('too big');
    expect(toast.error).toHaveBeenCalledWith('too big');

    cmp.returnLabelFile = new File(['x'], 'label.pdf');
    api.uploadReturnLabel.and.returnValue(throwError(() => ({})));
    cmp.uploadReturnLabel();
    expect(cmp.returnLabelError()).toBe('adminUi.returns.errors.save');
    expect(cmp.returnLabelBusy()).toBeFalse();
  });

  // --- download return label --------------------------------------------

  it('downloadReturnLabel does nothing without an id', () => {
    const cmp = create();
    cmp.downloadReturnLabel();
    expect(api.downloadReturnLabel).not.toHaveBeenCalled();
  });

  it('downloadReturnLabel triggers a browser download using the stored filename', () => {
    const cmp = create();
    cmp.selectedId.set('ret-1');
    cmp.selected.set(makeDetail({ order_reference: 'REF1', return_label_filename: 'label.pdf' }));
    const createSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    const revokeSpy = spyOn(URL, 'revokeObjectURL');
    const clickSpy = spyOn(HTMLAnchorElement.prototype, 'click');
    cmp.downloadReturnLabel();
    expect(createSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalled();
    expect(cmp.returnLabelBusy()).toBeFalse();
  });

  it('downloadReturnLabel derives the name from the order id when no filename is present', () => {
    const cmp = create();
    cmp.selectedId.set('ret-1');
    cmp.selected.set(
      makeDetail({
        order_reference: null,
        order_id: 'orderABCDEF',
        return_label_filename: null,
      }),
    );
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    spyOn(URL, 'revokeObjectURL');
    const anchor = document.createElement('a');
    spyOn(document, 'createElement').and.returnValue(anchor);
    spyOn(anchor, 'click');
    cmp.downloadReturnLabel();
    expect(anchor.download).toBe('return-orderABC-label');
  });

  it('downloadReturnLabel falls back to the return id when no detail is loaded', () => {
    const cmp = create();
    cmp.selectedId.set('returnIDvalue');
    cmp.selected.set(null);
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    spyOn(URL, 'revokeObjectURL');
    const anchor = document.createElement('a');
    spyOn(document, 'createElement').and.returnValue(anchor);
    spyOn(anchor, 'click');
    cmp.downloadReturnLabel();
    expect(anchor.download).toBe('return-returnID-label');
  });

  it('downloadReturnLabel surfaces the server detail then a fallback on failure', () => {
    const cmp = create();
    cmp.selectedId.set('ret-1');
    cmp.selected.set(makeDetail());
    api.downloadReturnLabel.and.returnValue(throwError(() => ({ error: { detail: 'no file' } })));
    cmp.downloadReturnLabel();
    expect(cmp.returnLabelError()).toBe('no file');
    expect(toast.error).toHaveBeenCalledWith('no file');

    api.downloadReturnLabel.and.returnValue(throwError(() => ({})));
    cmp.downloadReturnLabel();
    expect(cmp.returnLabelError()).toBe('adminUi.returns.errors.loadDetail');
    expect(cmp.returnLabelBusy()).toBeFalse();
  });

  // --- delete return label ----------------------------------------------

  it('deleteReturnLabel does nothing without an id', () => {
    const cmp = create();
    cmp.deleteReturnLabel();
    expect(api.deleteReturnLabel).not.toHaveBeenCalled();
  });

  it('deleteReturnLabel aborts when the confirmation is declined', () => {
    const cmp = create();
    cmp.selectedId.set('ret-1');
    spyOn(window, 'confirm').and.returnValue(false);
    cmp.deleteReturnLabel();
    expect(api.deleteReturnLabel).not.toHaveBeenCalled();
  });

  it('deleteReturnLabel clears the label fields on the loaded detail', () => {
    const cmp = create();
    cmp.selectedId.set('ret-1');
    cmp.selected.set(makeDetail({ has_return_label: true }));
    spyOn(window, 'confirm').and.returnValue(true);
    cmp.deleteReturnLabel();
    expect(cmp.selected()?.has_return_label).toBeFalse();
    expect(cmp.selected()?.return_label_filename).toBeNull();
    expect(cmp.returnLabelBusy()).toBeFalse();
    expect(toast.success).toHaveBeenCalled();
  });

  it('deleteReturnLabel succeeds even when no detail is loaded', () => {
    const cmp = create();
    cmp.selectedId.set('ret-1');
    cmp.selected.set(null);
    spyOn(window, 'confirm').and.returnValue(true);
    cmp.deleteReturnLabel();
    expect(cmp.selected()).toBeNull();
    expect(toast.success).toHaveBeenCalled();
  });

  it('deleteReturnLabel surfaces the server detail then a fallback on failure', () => {
    const cmp = create();
    cmp.selectedId.set('ret-1');
    spyOn(window, 'confirm').and.returnValue(true);
    api.deleteReturnLabel.and.returnValue(throwError(() => ({ error: { detail: 'locked' } })));
    cmp.deleteReturnLabel();
    expect(cmp.returnLabelError()).toBe('locked');
    expect(toast.error).toHaveBeenCalledWith('locked');

    api.deleteReturnLabel.and.returnValue(throwError(() => ({})));
    cmp.deleteReturnLabel();
    expect(cmp.returnLabelError()).toBe('adminUi.returns.errors.save');
    expect(cmp.returnLabelBusy()).toBeFalse();
  });

  // --- save --------------------------------------------------------------

  it('save does nothing without a selected id', () => {
    const cmp = create();
    cmp.save();
    expect(api.update).not.toHaveBeenCalled();
  });

  it('save persists the status and trimmed note, then reloads the list', () => {
    const cmp = create();
    cmp.selectedId.set('ret-1');
    cmp.editStatus = 'refunded';
    cmp.editNote = '  done  ';
    api.search.calls.reset();
    cmp.save();
    expect(api.update).toHaveBeenCalledWith('ret-1', { status: 'refunded', admin_note: 'done' });
    expect(cmp.saving()).toBeFalse();
    expect(toast.success).toHaveBeenCalled();
    expect(api.search).toHaveBeenCalled();
  });

  it('save sends a null note when the note is blank', () => {
    const cmp = create();
    cmp.selectedId.set('ret-1');
    cmp.editNote = '   ';
    cmp.save();
    expect(api.update).toHaveBeenCalledWith('ret-1', jasmine.objectContaining({ admin_note: null }));
  });

  it('save surfaces the server detail then a fallback on failure', () => {
    const cmp = create();
    cmp.selectedId.set('ret-1');
    api.update.and.returnValue(throwError(() => ({ error: { detail: 'invalid' } })));
    cmp.save();
    expect(toast.error).toHaveBeenCalledWith('invalid');
    expect(cmp.saving()).toBeFalse();

    toast.error.calls.reset();
    api.update.and.returnValue(throwError(() => ({})));
    cmp.save();
    expect(toast.error).toHaveBeenCalledWith('adminUi.returns.errors.save');
  });

  // --- private load ------------------------------------------------------

  it('load forwards query, status and order filters to the search', () => {
    const cmp = create();
    cmp.query = '  hello  ';
    cmp.statusFilter = 'approved';
    cmp.orderIdFilter = 'o9';
    api.search.calls.reset();
    cmp.applyFilters();
    expect(api.search).toHaveBeenCalledWith(
      jasmine.objectContaining({
        page: 1,
        limit: 25,
        q: 'hello',
        status_filter: 'approved',
        order_id: 'o9',
      }),
    );
  });

  it('load clears an existing selection by default and defaults missing items', () => {
    const cmp = create();
    cmp.selectedId.set('ret-1');
    cmp.selected.set(makeDetail());
    api.search.and.returnValue(of({ meta: {} } as any));
    cmp.retryLoad();
    expect(cmp.items()).toEqual([]);
    expect(cmp.selectedId()).toBeNull();
    expect(cmp.selected()).toBeNull();
  });

  it('load records the error message and request id on failure', () => {
    const cmp = create();
    const err = new HttpErrorResponse({
      error: { request_id: 'req-123' },
      headers: new HttpHeaders({ 'X-Request-ID': 'req-123' }),
      status: 500,
    });
    api.search.and.returnValue(throwError(() => err));
    cmp.retryLoad();
    expect(cmp.error()).toBe('adminUi.returns.errors.load');
    expect(cmp.errorRequestId()).toBe('req-123');
    expect(cmp.loading()).toBeFalse();
  });

  // --- private loadBoard -------------------------------------------------

  it('loadBoard aggregates the four status columns', () => {
    const cmp = create();
    api.search.and.callFake((params: any) =>
      of(
        listResponse({
          items: [{ ...listResponse().items[0], status: params.status_filter }],
          meta: { total_items: 7 } as any,
        }),
      ),
    );
    cmp.viewMode.set('board');
    cmp.applyFilters();
    const board = cmp.board();
    expect(board.requested.total).toBe(7);
    expect(board.approved.items.length).toBe(1);
    expect(board.received.total).toBe(7);
    expect(board.refunded.items.length).toBe(1);
    expect(cmp.boardLoading()).toBeFalse();
  });

  it('loadBoard defaults missing items and totals to empty/zero', () => {
    const cmp = create();
    api.search.and.returnValue(of({} as any));
    cmp.viewMode.set('board');
    cmp.applyFilters();
    const board = cmp.board();
    expect(board.requested.items).toEqual([]);
    expect(board.requested.total).toBe(0);
    expect(board.refunded.total).toBe(0);
  });

  it('loadBoard forwards query and order filters to every column search', () => {
    const cmp = create();
    cmp.query = '  q  ';
    cmp.orderIdFilter = 'o5';
    api.search.calls.reset();
    cmp.viewMode.set('board');
    cmp.applyFilters();
    expect(api.search).toHaveBeenCalledWith(
      jasmine.objectContaining({ q: 'q', order_id: 'o5', status_filter: 'requested' }),
    );
  });

  it('loadBoard records the error message and request id on failure', () => {
    const cmp = create();
    const err = new HttpErrorResponse({ error: { request_id: 'b-9' }, status: 500 });
    api.search.and.returnValue(throwError(() => err));
    cmp.viewMode.set('board');
    cmp.applyFilters();
    expect(cmp.boardError()).toBe('adminUi.returns.errors.load');
    expect(cmp.boardErrorRequestId()).toBe('b-9');
    expect(cmp.boardLoading()).toBeFalse();
  });

  // --- template rendering ------------------------------------------------

  it('renders the list table, detail panel and board columns', () => {
    const fixture = TestBed.createComponent(AdminReturnsComponent);
    const cmp = fixture.componentInstance;
    cmp.loading.set(false);
    cmp.items.set(listResponse().items);
    cmp.meta.set({ page: 1, total_pages: 2, total_items: 1 });
    cmp.selected.set(makeDetail());
    cmp.selectedId.set('ret-1');
    cmp.board.set({
      requested: { items: listResponse().items, total: 3 },
      approved: { items: [], total: 0 },
      received: { items: [], total: 0 },
      refunded: { items: [], total: 0 },
    });
    fixture.detectChanges();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('Jane');
    expect(text).toContain('Widget');

    cmp.viewMode.set('board');
    cmp.boardLoading.set(false);
    fixture.detectChanges();
    const boardText = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(boardText).toContain('adminUi.returns.board.viewAll');
  });

  it('renders error and empty states for list and board', () => {
    const fixture = TestBed.createComponent(AdminReturnsComponent);
    const cmp = fixture.componentInstance;
    cmp.loading.set(false);
    cmp.items.set([]);
    cmp.error.set('list failed');
    cmp.selected.set(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('list failed');

    cmp.viewMode.set('board');
    cmp.boardLoading.set(false);
    cmp.boardError.set('board failed');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('board failed');
  });
});
