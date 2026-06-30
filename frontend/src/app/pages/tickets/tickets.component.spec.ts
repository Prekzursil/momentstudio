import { TestBed } from '@angular/core/testing';
import { NgForm } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AccountService, Order } from '../../core/account.service';
import { ToastService } from '../../core/toast.service';
import { TicketsService, TicketListItem, TicketRead } from '../../core/tickets.service';
import { TicketsComponent } from './tickets.component';

function listItem(over: Partial<TicketListItem> = {}): TicketListItem {
  return {
    id: 't1',
    topic: 'support',
    status: 'new',
    order_reference: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    ...over,
  };
}

function ticketRead(over: Partial<TicketRead> = {}): TicketRead {
  return {
    ...listItem(),
    name: 'Ana',
    email: 'a@b.com',
    messages: [
      { id: 'm1', from_admin: false, message: 'Hello', created_at: '2024-01-01T00:00:00Z' },
      { id: 'm2', from_admin: true, message: 'Hi there', created_at: '2024-01-01T01:00:00Z' },
    ],
    ...over,
  };
}

function order(over: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    reference_code: 'REF-1',
    status: 'paid',
    total_amount: 100,
    currency: 'EUR',
    created_at: '2024-03-04T00:00:00Z',
    updated_at: '2024-03-04T00:00:00Z',
    ...over,
  } as Order;
}

function form(valid: boolean): NgForm {
  return { valid } as unknown as NgForm;
}

describe('TicketsComponent', () => {
  let tickets: jasmine.SpyObj<TicketsService>;
  let account: jasmine.SpyObj<AccountService>;
  let toast: jasmine.SpyObj<ToastService>;

  function configure(): void {
    TestBed.configureTestingModule({
      imports: [TicketsComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: TicketsService, useValue: tickets },
        { provide: AccountService, useValue: account },
        { provide: ToastService, useValue: toast },
      ],
    });
    TestBed.inject(TranslateService).use('en');
  }

  function create(): TicketsComponent {
    configure();
    const fixture = TestBed.createComponent(TicketsComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    tickets = jasmine.createSpyObj<TicketsService>('TicketsService', [
      'listMine',
      'create',
      'getOne',
      'addMessage',
    ]);
    account = jasmine.createSpyObj<AccountService>('AccountService', ['getOrders']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);

    // Sensible happy-path defaults; individual tests override as needed.
    tickets.listMine.and.returnValue(of([listItem()]));
    tickets.getOne.and.returnValue(of(ticketRead()));
    tickets.create.and.returnValue(of(ticketRead({ id: 't-new' })));
    tickets.addMessage.and.returnValue(of(ticketRead({ id: 't1' })));
    account.getOrders.and.returnValue(of([order()]));
  });

  it('loads tickets and orders on construction and renders the inbox', () => {
    const cmp = create();
    expect(tickets.listMine).toHaveBeenCalled();
    expect(account.getOrders).toHaveBeenCalled();
    expect(cmp.loading()).toBe(false);
    expect(cmp.tickets().length).toBe(1);
    expect(cmp.orders().length).toBe(1);
  });

  describe('refresh', () => {
    it('coerces a null ticket list to an empty array', () => {
      tickets.listMine.and.returnValue(of(null as unknown as TicketListItem[]));
      const cmp = create();
      expect(cmp.tickets()).toEqual([]);
      expect(cmp.loading()).toBe(false);
    });

    it('coerces a null orders list to an empty array', () => {
      account.getOrders.and.returnValue(of(null as unknown as Order[]));
      const cmp = create();
      expect(cmp.orders()).toEqual([]);
    });

    it('surfaces the API error detail when loading tickets fails', () => {
      tickets.listMine.and.returnValue(throwError(() => ({ error: { detail: 'load-failed' } })));
      const cmp = create();
      expect(toast.error).toHaveBeenCalledWith('load-failed');
      expect(cmp.loading()).toBe(false);
    });

    it('falls back to a translated message when the error has no detail', () => {
      tickets.listMine.and.returnValue(throwError(() => ({})));
      create();
      expect(toast.error).toHaveBeenCalledWith('tickets.errors.load');
    });

    it('falls back to a translated message when the error itself is nullish', () => {
      tickets.listMine.and.returnValue(throwError(() => null));
      create();
      expect(toast.error).toHaveBeenCalledWith('tickets.errors.load');
    });

    it('resets orders to an empty array when loading orders fails', () => {
      account.getOrders.and.returnValue(throwError(() => new Error('boom')));
      const cmp = create();
      expect(cmp.orders()).toEqual([]);
    });

    it('reloads when the refresh button is invoked', () => {
      const cmp = create();
      tickets.listMine.calls.reset();
      account.getOrders.calls.reset();
      cmp.refresh();
      expect(tickets.listMine).toHaveBeenCalled();
      expect(account.getOrders).toHaveBeenCalled();
    });
  });

  describe('openTicket', () => {
    it('selects the loaded ticket and clears the reply draft', () => {
      const cmp = create();
      cmp.replyMessage = 'leftover';
      cmp.openTicket('t1');
      expect(tickets.getOne).toHaveBeenCalledWith('t1');
      expect(cmp.selected()?.id).toBe('t1');
      expect(cmp.replyMessage).toBe('');
    });

    it('surfaces the API error detail when loading a ticket fails', () => {
      tickets.getOne.and.returnValue(throwError(() => ({ error: { detail: 'detail-failed' } })));
      const cmp = create();
      cmp.openTicket('t1');
      expect(toast.error).toHaveBeenCalledWith('detail-failed');
    });

    it('falls back to a translated message when the error has no detail', () => {
      tickets.getOne.and.returnValue(throwError(() => ({})));
      const cmp = create();
      cmp.openTicket('t1');
      expect(toast.error).toHaveBeenCalledWith('tickets.errors.loadDetail');
    });

    it('falls back to a translated message when the error is nullish', () => {
      tickets.getOne.and.returnValue(throwError(() => undefined));
      const cmp = create();
      cmp.openTicket('t1');
      expect(toast.error).toHaveBeenCalledWith('tickets.errors.loadDetail');
    });
  });

  describe('submit', () => {
    it('rejects an invalid form without calling the API', () => {
      const cmp = create();
      cmp.submit(form(false));
      expect(tickets.create).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('tickets.errors.form');
    });

    it('creates a ticket, trims input, and resets the form on success', () => {
      const cmp = create();
      cmp.topic = 'refund';
      cmp.message = '  Need help  ';
      cmp.orderReference = '  REF-1  ';
      cmp.orderQuery = 'REF';
      tickets.listMine.calls.reset();
      cmp.submit(form(true));
      expect(tickets.create).toHaveBeenCalledWith({
        topic: 'refund',
        message: 'Need help',
        order_reference: 'REF-1',
      });
      expect(toast.success).toHaveBeenCalledWith('tickets.success.created');
      expect(cmp.message).toBe('');
      expect(cmp.orderReference).toBeNull();
      expect(cmp.orderQuery).toBe('');
      expect(cmp.selected()?.id).toBe('t-new');
      expect(tickets.listMine).toHaveBeenCalled();
    });

    it('sends a null order reference and empty message when both are blank/nullish', () => {
      const cmp = create();
      cmp.message = null as unknown as string;
      cmp.orderReference = '   ';
      cmp.submit(form(true));
      expect(tickets.create).toHaveBeenCalledWith({
        topic: 'support',
        message: '',
        order_reference: null,
      });
    });

    it('surfaces the API error detail when creation fails', () => {
      tickets.create.and.returnValue(throwError(() => ({ error: { detail: 'create-failed' } })));
      const cmp = create();
      cmp.submit(form(true));
      expect(toast.error).toHaveBeenCalledWith('create-failed');
    });

    it('falls back to a translated message when the create error has no detail', () => {
      tickets.create.and.returnValue(throwError(() => ({})));
      const cmp = create();
      cmp.submit(form(true));
      expect(toast.error).toHaveBeenCalledWith('tickets.errors.create');
    });

    it('falls back to a translated message when the create error is nullish', () => {
      tickets.create.and.returnValue(throwError(() => null));
      const cmp = create();
      cmp.submit(form(true));
      expect(toast.error).toHaveBeenCalledWith('tickets.errors.create');
    });
  });

  describe('reply', () => {
    it('does nothing when no ticket is selected', () => {
      const cmp = create();
      cmp.selected.set(null);
      cmp.reply(form(true));
      expect(tickets.addMessage).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('rejects an invalid form once a ticket is selected', () => {
      const cmp = create();
      cmp.selected.set(ticketRead());
      cmp.reply(form(false));
      expect(tickets.addMessage).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('tickets.errors.form');
    });

    it('sends the trimmed reply and refreshes on success', () => {
      const cmp = create();
      cmp.selected.set(ticketRead({ id: 't1' }));
      cmp.replyMessage = '  thanks  ';
      tickets.listMine.calls.reset();
      cmp.reply(form(true));
      expect(tickets.addMessage).toHaveBeenCalledWith('t1', 'thanks');
      expect(cmp.replyMessage).toBe('');
      expect(toast.success).toHaveBeenCalledWith('tickets.success.sent');
      expect(tickets.listMine).toHaveBeenCalled();
    });

    it('sends an empty reply when the draft is nullish', () => {
      const cmp = create();
      cmp.selected.set(ticketRead({ id: 't1' }));
      cmp.replyMessage = null as unknown as string;
      cmp.reply(form(true));
      expect(tickets.addMessage).toHaveBeenCalledWith('t1', '');
    });

    it('surfaces the API error detail when the reply fails', () => {
      tickets.addMessage.and.returnValue(throwError(() => ({ error: { detail: 'reply-failed' } })));
      const cmp = create();
      cmp.selected.set(ticketRead());
      cmp.replyMessage = 'hi';
      cmp.reply(form(true));
      expect(toast.error).toHaveBeenCalledWith('reply-failed');
    });

    it('falls back to a translated message when the reply error has no detail', () => {
      tickets.addMessage.and.returnValue(throwError(() => ({})));
      const cmp = create();
      cmp.selected.set(ticketRead());
      cmp.replyMessage = 'hi';
      cmp.reply(form(true));
      expect(toast.error).toHaveBeenCalledWith('tickets.errors.reply');
    });

    it('falls back to a translated message when the reply error is nullish', () => {
      tickets.addMessage.and.returnValue(throwError(() => undefined));
      const cmp = create();
      cmp.selected.set(ticketRead());
      cmp.replyMessage = 'hi';
      cmp.reply(form(true));
      expect(toast.error).toHaveBeenCalledWith('tickets.errors.reply');
    });
  });

  describe('orderKey', () => {
    it('prefers the reference code', () => {
      expect(create().orderKey(order({ reference_code: '  REF-9  ', id: 'o9' }))).toBe('REF-9');
    });

    it('falls back to the id when there is no reference code', () => {
      expect(create().orderKey(order({ reference_code: null, id: '  o9  ' }))).toBe('o9');
    });

    it('returns an empty string when neither is present', () => {
      expect(
        create().orderKey(order({ reference_code: null, id: null as unknown as string })),
      ).toBe('');
    });
  });

  describe('orderLabel', () => {
    it('appends a formatted date when created_at is present', () => {
      const label = create().orderLabel(
        order({ reference_code: 'REF-1', created_at: '2024-03-04T00:00:00Z' }),
      );
      expect(label.startsWith('REF-1 · ')).toBe(true);
    });

    it('returns just the reference when created_at is missing', () => {
      const label = create().orderLabel(
        order({ reference_code: 'REF-2', created_at: null as unknown as string }),
      );
      expect(label).toBe('REF-2');
    });
  });

  describe('filteredOrders', () => {
    it('returns all orders when the query is empty', () => {
      const cmp = create();
      cmp.orders.set([
        order({ reference_code: 'AAA' }),
        order({ id: 'o2', reference_code: 'BBB' }),
      ]);
      cmp.orderQuery = '';
      expect(cmp.filteredOrders().length).toBe(2);
    });

    it('filters orders case-insensitively by label', () => {
      const cmp = create();
      cmp.orders.set([
        order({ reference_code: 'ALPHA' }),
        order({ id: 'o2', reference_code: 'BETA' }),
      ]);
      cmp.orderQuery = '  alpha ';
      const filtered = cmp.filteredOrders();
      expect(filtered.length).toBe(1);
      expect(filtered[0].reference_code).toBe('ALPHA');
    });
  });

  describe('statusPillClass', () => {
    it('returns the resolved palette', () => {
      expect(create().statusPillClass('resolved')).toContain('emerald');
    });

    it('returns the triaged palette', () => {
      expect(create().statusPillClass('triaged')).toContain('amber');
    });

    it('returns the default palette for any other status', () => {
      expect(create().statusPillClass('new')).toContain('slate');
    });
  });
});
