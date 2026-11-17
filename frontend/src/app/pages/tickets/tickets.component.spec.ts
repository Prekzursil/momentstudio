import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AccountService } from '../../core/account.service';
import { TicketListItem, TicketRead, TicketsService } from '../../core/tickets.service';
import { ToastService } from '../../core/toast.service';
import { TicketsComponent } from './tickets.component';

/**
 * Golden WU tix49 — first tickets status / empty-error specs.
 * Covers status pill classes, refresh empty + load error arms, and
 * openTicket success/error detail/fallback.
 */
describe('TicketsComponent status / empty-error helpers', () => {
  let ticketsApi: jasmine.SpyObj<TicketsService>;
  let account: jasmine.SpyObj<AccountService>;
  let toast: jasmine.SpyObj<ToastService>;

  const listItem: TicketListItem = {
    id: 't-1',
    topic: 'support',
    status: 'new',
    order_reference: null,
    created_at: '2026-03-15T12:00:00Z',
    updated_at: '2026-03-15T12:00:00Z',
  };

  const detail: TicketRead = {
    ...listItem,
    name: 'Ada',
    email: 'ada@example.com',
    messages: [
      {
        id: 'm-1',
        from_admin: false,
        message: 'hello',
        created_at: '2026-03-15T12:00:00Z',
      },
    ],
  };

  beforeEach(() => {
    ticketsApi = jasmine.createSpyObj<TicketsService>('TicketsService', [
      'listMine',
      'getOne',
      'create',
      'addMessage',
    ]);
    ticketsApi.listMine.and.returnValue(of([]));
    account = jasmine.createSpyObj<AccountService>('AccountService', ['getOrders']);
    account.getOrders.and.returnValue(of([]));
    toast = jasmine.createSpyObj<ToastService>('ToastService', [
      'info',
      'success',
      'error',
      'action',
    ]);

    TestBed.configureTestingModule({
      imports: [TicketsComponent, RouterTestingModule, TranslateModule.forRoot()],
      providers: [
        { provide: TicketsService, useValue: ticketsApi },
        { provide: AccountService, useValue: account },
        { provide: ToastService, useValue: toast },
      ],
    });
  });

  it('statusPillClass maps resolved/triaged and falls back for other statuses', () => {
    const fixture = TestBed.createComponent(TicketsComponent);
    const cmp = fixture.componentInstance;

    expect(cmp.statusPillClass('resolved')).toContain('emerald');
    expect(cmp.statusPillClass('triaged')).toContain('amber');
    expect(cmp.statusPillClass('new')).toContain('slate');
    expect(cmp.statusPillClass('unknown')).toContain('slate');
  });

  it('refresh loads empty inbox and surfaces list error detail or translate fallback', () => {
    const fixture = TestBed.createComponent(TicketsComponent);
    const cmp = fixture.componentInstance;

    // constructor refresh: empty success arm
    expect(ticketsApi.listMine).toHaveBeenCalled();
    expect(cmp.loading()).toBeFalse();
    expect(cmp.tickets()).toEqual([]);

    // error with backend detail
    ticketsApi.listMine.and.returnValue(throwError(() => ({ error: { detail: 'list-down' } })));
    cmp.refresh();
    expect(cmp.loading()).toBeFalse();
    expect(toast.error).toHaveBeenCalledWith('list-down');

    // error without detail → translate key fallback
    toast.error.calls.reset();
    ticketsApi.listMine.and.returnValue(throwError(() => ({ error: {} })));
    cmp.refresh();
    expect(cmp.loading()).toBeFalse();
    expect(toast.error).toHaveBeenCalledWith('tickets.errors.load');
  });

  it('openTicket sets selected on success and toasts detail/fallback on error', () => {
    const fixture = TestBed.createComponent(TicketsComponent);
    const cmp = fixture.componentInstance;

    ticketsApi.getOne.and.returnValue(of(detail));
    cmp.replyMessage = 'stale';
    cmp.openTicket('t-1');
    expect(ticketsApi.getOne).toHaveBeenCalledWith('t-1');
    expect(cmp.selected()).toEqual(detail);
    expect(cmp.replyMessage).toBe('');

    ticketsApi.getOne.and.returnValue(throwError(() => ({ error: { detail: 'missing-ticket' } })));
    cmp.openTicket('missing');
    expect(toast.error).toHaveBeenCalledWith('missing-ticket');

    toast.error.calls.reset();
    ticketsApi.getOne.and.returnValue(throwError(() => ({ error: {} })));
    cmp.openTicket('missing-2');
    expect(toast.error).toHaveBeenCalledWith('tickets.errors.loadDetail');
  });
});
