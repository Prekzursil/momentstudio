import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { NgForm } from '@angular/forms';
import { of, throwError } from 'rxjs';

import { TicketsComponent } from './tickets.component';
import { AccountService, Order } from '../../core/account.service';
import { ToastService } from '../../core/toast.service';
import {
  TicketsService,
  TicketListItem,
  TicketRead,
} from '../../core/tickets.service';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-id',
    reference_code: 'REF-1',
    status: 'paid',
    total_amount: 10,
    currency: 'RON',
    created_at: '2020-01-02T03:04:05Z',
    updated_at: '2020-01-02T03:04:05Z',
    items: [],
    ...overrides,
  };
}

function makeTicketListItem(overrides: Partial<TicketListItem> = {}): TicketListItem {
  return {
    id: 't1',
    topic: 'support',
    status: 'new',
    order_reference: 'REF-1',
    created_at: '2020-01-01T00:00:00Z',
    updated_at: '2020-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeTicketRead(overrides: Partial<TicketRead> = {}): TicketRead {
  return {
    ...makeTicketListItem(),
    name: 'Jane',
    email: 'jane@example.com',
    messages: [
      {
        id: 'm1',
        from_admin: false,
        message: 'Hello',
        created_at: '2020-01-01T00:00:00Z',
      },
      {
        id: 'm2',
        from_admin: true,
        message: 'Hi back',
        created_at: '2020-01-01T01:00:00Z',
      },
    ],
    ...overrides,
  };
}

function validForm(): NgForm {
  return { valid: true } as unknown as NgForm;
}

function invalidForm(): NgForm {
  return { valid: false } as unknown as NgForm;
}

describe('TicketsComponent', () => {
  let ticketsApi: jasmine.SpyObj<TicketsService>;
  let account: jasmine.SpyObj<AccountService>;
  let toast: jasmine.SpyObj<ToastService>;

  function configure(): void {
    TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), TicketsComponent],
      providers: [
        { provide: TicketsService, useValue: ticketsApi },
        { provide: AccountService, useValue: account },
        { provide: ToastService, useValue: toast },
      ],
    });
  }

  function create(): TicketsComponent {
    configure();
    const fixture = TestBed.createComponent(TicketsComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    ticketsApi = jasmine.createSpyObj<TicketsService>('TicketsService', [
      'listMine',
      'create',
      'getOne',
      'addMessage',
    ]);
    account = jasmine.createSpyObj<AccountService>('AccountService', ['getOrders']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);

    // Defaults used by the constructor's refresh() call.
    ticketsApi.listMine.and.returnValue(of([makeTicketListItem()]));
    ticketsApi.create.and.returnValue(of(makeTicketRead()));
    ticketsApi.getOne.and.returnValue(of(makeTicketRead()));
    ticketsApi.addMessage.and.returnValue(of(makeTicketRead()));
    account.getOrders.and.returnValue(of([makeOrder()]));
  });

  it('loads tickets and orders on construction and renders the inbox', () => {
    const cmp = create();
    expect(ticketsApi.listMine).toHaveBeenCalled();
    expect(account.getOrders).toHaveBeenCalled();
    expect(cmp.loading()).toBeFalse();
    expect(cmp.tickets().length).toBe(1);
    expect(cmp.orders().length).toBe(1);
  });

  it('falls back to empty arrays when the APIs return nullish payloads', () => {
    ticketsApi.listMine.and.returnValue(of(null as unknown as TicketListItem[]));
    account.getOrders.and.returnValue(of(null as unknown as Order[]));
    const cmp = create();
    expect(cmp.tickets()).toEqual([]);
    expect(cmp.orders()).toEqual([]);
    expect(cmp.loading()).toBeFalse();
  });

  it('shows a server-provided error detail when listMine fails', () => {
    ticketsApi.listMine.and.returnValue(throwError(() => ({ error: { detail: 'boom' } })));
    const cmp = create();
    expect(toast.error).toHaveBeenCalledWith('boom');
    expect(cmp.loading()).toBeFalse();
  });

  it('falls back to a translated error when listMine fails without a detail', () => {
    ticketsApi.listMine.and.returnValue(throwError(() => ({ error: {} })));
    create();
    expect(toast.error).toHaveBeenCalledWith('tickets.errors.load');
  });

  it('falls back to a translated error when listMine fails with a nullish error', () => {
    ticketsApi.listMine.and.returnValue(throwError(() => undefined));
    create();
    expect(toast.error).toHaveBeenCalledWith('tickets.errors.load');
  });

  it('resets orders to empty when getOrders fails', () => {
    account.getOrders.and.returnValue(throwError(() => new Error('nope')));
    const cmp = create();
    expect(cmp.orders()).toEqual([]);
  });

  describe('filteredOrders', () => {
    it('returns all orders when the query is empty', () => {
      const cmp = create();
      cmp.orders.set([makeOrder({ reference_code: 'AAA' }), makeOrder({ reference_code: 'BBB' })]);
      cmp.orderQuery = '';
      expect(cmp.filteredOrders().length).toBe(2);
    });

    it('filters orders by label, case-insensitively', () => {
      const cmp = create();
      cmp.orders.set([
        makeOrder({ reference_code: 'ALPHA', created_at: '' }),
        makeOrder({ reference_code: 'BETA', created_at: '' }),
      ]);
      cmp.orderQuery = '  alp ';
      const result = cmp.filteredOrders();
      expect(result.length).toBe(1);
      expect(result[0].reference_code).toBe('ALPHA');
    });

    it('treats a nullish query as empty', () => {
      const cmp = create();
      cmp.orders.set([makeOrder()]);
      cmp.orderQuery = null as unknown as string;
      expect(cmp.filteredOrders().length).toBe(1);
    });
  });

  describe('openTicket', () => {
    it('selects the loaded ticket and clears the reply field', () => {
      const cmp = create();
      cmp.replyMessage = 'leftover';
      const ticket = makeTicketRead({ id: 't42' });
      ticketsApi.getOne.and.returnValue(of(ticket));
      cmp.openTicket('t42');
      expect(ticketsApi.getOne).toHaveBeenCalledWith('t42');
      expect(cmp.selected()).toBe(ticket);
      expect(cmp.replyMessage).toBe('');
    });

    it('surfaces the server detail on failure', () => {
      const cmp = create();
      ticketsApi.getOne.and.returnValue(throwError(() => ({ error: { detail: 'gone' } })));
      cmp.openTicket('x');
      expect(toast.error).toHaveBeenCalledWith('gone');
    });

    it('falls back to a translated error on failure without a detail', () => {
      const cmp = create();
      ticketsApi.getOne.and.returnValue(throwError(() => undefined));
      cmp.openTicket('x');
      expect(toast.error).toHaveBeenCalledWith('tickets.errors.loadDetail');
    });
  });

  describe('submit', () => {
    it('rejects an invalid form', () => {
      const cmp = create();
      cmp.submit(invalidForm());
      expect(toast.error).toHaveBeenCalledWith('tickets.errors.form');
      expect(ticketsApi.create).not.toHaveBeenCalled();
    });

    it('creates a ticket, resets the form, and refreshes', () => {
      const cmp = create();
      const created = makeTicketRead({ id: 'new' });
      ticketsApi.create.and.returnValue(of(created));
      cmp.topic = 'refund';
      cmp.message = '  need help  ';
      cmp.orderReference = '  REF-9  ';
      cmp.orderQuery = 'something';
      ticketsApi.listMine.calls.reset();

      cmp.submit(validForm());

      expect(ticketsApi.create).toHaveBeenCalledWith({
        topic: 'refund',
        message: 'need help',
        order_reference: 'REF-9',
      });
      expect(toast.success).toHaveBeenCalledWith('tickets.success.created');
      expect(cmp.message).toBe('');
      expect(cmp.orderReference).toBeNull();
      expect(cmp.orderQuery).toBe('');
      expect(cmp.selected()).toBe(created);
      expect(ticketsApi.listMine).toHaveBeenCalled();
    });

    it('normalises a blank order reference and message to null/empty', () => {
      const cmp = create();
      cmp.message = '';
      cmp.orderReference = '   ';
      cmp.submit(validForm());
      expect(ticketsApi.create).toHaveBeenCalledWith({
        topic: 'support',
        message: '',
        order_reference: null,
      });
    });

    it('handles a null order reference', () => {
      const cmp = create();
      cmp.orderReference = null;
      cmp.submit(validForm());
      expect(ticketsApi.create).toHaveBeenCalledWith(
        jasmine.objectContaining({ order_reference: null }),
      );
    });

    it('shows the server detail when creation fails', () => {
      const cmp = create();
      ticketsApi.create.and.returnValue(throwError(() => ({ error: { detail: 'denied' } })));
      cmp.submit(validForm());
      expect(toast.error).toHaveBeenCalledWith('denied');
    });

    it('falls back to a translated error when creation fails without a detail', () => {
      const cmp = create();
      ticketsApi.create.and.returnValue(throwError(() => undefined));
      cmp.submit(validForm());
      expect(toast.error).toHaveBeenCalledWith('tickets.errors.create');
    });
  });

  describe('reply', () => {
    it('does nothing when no ticket is selected', () => {
      const cmp = create();
      cmp.selected.set(null);
      cmp.reply(validForm());
      expect(ticketsApi.addMessage).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('rejects an invalid form when a ticket is selected', () => {
      const cmp = create();
      cmp.selected.set(makeTicketRead());
      cmp.reply(invalidForm());
      expect(toast.error).toHaveBeenCalledWith('tickets.errors.form');
      expect(ticketsApi.addMessage).not.toHaveBeenCalled();
    });

    it('adds a trimmed message, updates the thread, and refreshes', () => {
      const cmp = create();
      const selected = makeTicketRead({ id: 'sel' });
      cmp.selected.set(selected);
      const updated = makeTicketRead({ id: 'sel', status: 'triaged' });
      ticketsApi.addMessage.and.returnValue(of(updated));
      cmp.replyMessage = '  thanks  ';
      ticketsApi.listMine.calls.reset();

      cmp.reply(validForm());

      expect(ticketsApi.addMessage).toHaveBeenCalledWith('sel', 'thanks');
      expect(cmp.selected()).toBe(updated);
      expect(cmp.replyMessage).toBe('');
      expect(toast.success).toHaveBeenCalledWith('tickets.success.sent');
      expect(ticketsApi.listMine).toHaveBeenCalled();
    });

    it('sends an empty string when the reply message is nullish', () => {
      const cmp = create();
      cmp.selected.set(makeTicketRead({ id: 'sel' }));
      cmp.replyMessage = null as unknown as string;
      cmp.reply(validForm());
      expect(ticketsApi.addMessage).toHaveBeenCalledWith('sel', '');
    });

    it('shows the server detail when the reply fails', () => {
      const cmp = create();
      cmp.selected.set(makeTicketRead({ id: 'sel' }));
      ticketsApi.addMessage.and.returnValue(throwError(() => ({ error: { detail: 'rejected' } })));
      cmp.reply(validForm());
      expect(toast.error).toHaveBeenCalledWith('rejected');
    });

    it('falls back to a translated error when the reply fails without a detail', () => {
      const cmp = create();
      cmp.selected.set(makeTicketRead({ id: 'sel' }));
      ticketsApi.addMessage.and.returnValue(throwError(() => undefined));
      cmp.reply(validForm());
      expect(toast.error).toHaveBeenCalledWith('tickets.errors.reply');
    });
  });

  describe('orderKey', () => {
    it('prefers the reference code', () => {
      const cmp = create();
      expect(cmp.orderKey(makeOrder({ reference_code: '  ABC  ', id: 'ignored' }))).toBe('ABC');
    });

    it('falls back to the id when there is no reference code', () => {
      const cmp = create();
      expect(cmp.orderKey(makeOrder({ reference_code: null, id: 'ID-1' }))).toBe('ID-1');
    });

    it('falls back to an empty string when nothing is set', () => {
      const cmp = create();
      expect(
        cmp.orderKey(makeOrder({ reference_code: null, id: '' as unknown as string })),
      ).toBe('');
    });
  });

  describe('orderLabel', () => {
    it('appends a formatted date when created_at is present', () => {
      const cmp = create();
      const label = cmp.orderLabel(makeOrder({ reference_code: 'REF-7', created_at: '2020-05-06T00:00:00Z' }));
      expect(label).toContain('REF-7');
      expect(label).toContain('·');
    });

    it('returns only the reference when there is no created_at', () => {
      const cmp = create();
      expect(cmp.orderLabel(makeOrder({ reference_code: 'REF-8', created_at: '' }))).toBe('REF-8');
    });
  });

  describe('statusPillClass', () => {
    it('styles resolved tickets in emerald', () => {
      const cmp = create();
      expect(cmp.statusPillClass('resolved')).toContain('emerald');
    });

    it('styles triaged tickets in amber', () => {
      const cmp = create();
      expect(cmp.statusPillClass('triaged')).toContain('amber');
    });

    it('styles other statuses in slate', () => {
      const cmp = create();
      expect(cmp.statusPillClass('new')).toContain('slate');
    });
  });
});
