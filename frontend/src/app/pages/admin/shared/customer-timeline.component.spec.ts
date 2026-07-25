import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AdminOrderListItem, AdminOrdersService } from '../../../core/admin-orders.service';
import {
  AdminContactSubmissionListItem,
  AdminSupportService,
} from '../../../core/admin-support.service';
import { AuthService } from '../../../core/auth.service';
import { EmailEventRead, OpsService } from '../../../core/ops.service';
import { CustomerTimelineComponent } from './customer-timeline.component';

function order(overrides: Partial<AdminOrderListItem> = {}): AdminOrderListItem {
  return {
    id: 'order-1234abcd',
    reference_code: 'REF-1',
    status: 'paid',
    total_amount: 99,
    currency: 'RON',
    created_at: '2030-01-03T00:00:00+00:00',
    ...overrides,
  } as AdminOrderListItem;
}

function ticket(
  overrides: Partial<AdminContactSubmissionListItem> = {},
): AdminContactSubmissionListItem {
  return {
    id: 'ticket-5678efgh',
    topic: 'general',
    status: 'open',
    created_at: '2030-01-02T00:00:00+00:00',
    ...overrides,
  } as AdminContactSubmissionListItem;
}

function email(overrides: Partial<EmailEventRead> = {}): EmailEventRead {
  return {
    id: 'email-1',
    to_email: 'jane@example.com',
    subject: 'Welcome',
    status: 'delivered',
    error_message: null,
    created_at: '2030-01-01T00:00:00+00:00',
    ...overrides,
  } as EmailEventRead;
}

describe('CustomerTimelineComponent', () => {
  let auth: jasmine.SpyObj<AuthService>;
  let ordersApi: jasmine.SpyObj<AdminOrdersService>;
  let supportApi: jasmine.SpyObj<AdminSupportService>;
  let opsApi: jasmine.SpyObj<OpsService>;
  let router: Router;
  let navigateSpy: jasmine.Spy;
  let fixture: ComponentFixture<CustomerTimelineComponent>;
  let component: CustomerTimelineComponent;
  let allowedSections: Set<string>;

  beforeEach(() => {
    allowedSections = new Set(['orders', 'support', 'ops']);

    auth = jasmine.createSpyObj<AuthService>('AuthService', ['canAccessAdminSection']);
    auth.canAccessAdminSection.and.callFake((section: string) => allowedSections.has(section));

    ordersApi = jasmine.createSpyObj<AdminOrdersService>('AdminOrdersService', ['search']);
    supportApi = jasmine.createSpyObj<AdminSupportService>('AdminSupportService', ['list']);
    opsApi = jasmine.createSpyObj<OpsService>('OpsService', ['listEmailEvents']);

    ordersApi.search.and.returnValue(of({ items: [order()] } as any));
    supportApi.list.and.returnValue(of({ items: [ticket()] } as any));
    opsApi.listEmailEvents.and.returnValue(of([email()]));

    TestBed.configureTestingModule({
      imports: [CustomerTimelineComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: AdminOrdersService, useValue: ordersApi },
        { provide: AdminSupportService, useValue: supportApi },
        { provide: OpsService, useValue: opsApi },
      ],
    });
    router = TestBed.inject(Router);
    navigateSpy = spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
    fixture = TestBed.createComponent(CustomerTimelineComponent);
    component = fixture.componentInstance;
  });

  function change(key: string): SimpleChangeRecord {
    return {
      currentValue: (component as any)[key],
      previousValue: undefined,
      firstChange: true,
      isFirstChange: () => true,
    };
  }

  interface SimpleChangeRecord {
    currentValue: unknown;
    previousValue: unknown;
    firstChange: boolean;
    isFirstChange: () => boolean;
  }

  function applyInputs(
    inputs: Partial<
      Pick<CustomerTimelineComponent, 'userId' | 'customerEmail' | 'includePii' | 'excludeOrderId'>
    >,
    render = true,
  ): void {
    Object.assign(component, inputs);
    const changes: Record<string, SimpleChangeRecord> = {};
    for (const key of Object.keys(inputs)) {
      changes[key] = change(key);
    }
    component.ngOnChanges(changes as any);
    // Synchronous `of()` mocks make the reload + forkJoin resolve immediately,
    // so events() is populated before any template render. We skip rendering for
    // cases that intentionally feed invalid dates the template DatePipe rejects.
    if (render) {
      fixture.detectChanges();
    }
  }

  describe('ngOnChanges', () => {
    it('reloads when userId changes', () => {
      applyInputs({ userId: 'u-1' });
      expect(ordersApi.search).toHaveBeenCalled();
    });

    it('reloads when customerEmail changes', () => {
      applyInputs({ customerEmail: 'jane@example.com', includePii: true });
      expect(supportApi.list).toHaveBeenCalled();
    });

    it('reloads when includePii changes', () => {
      component.customerEmail = 'jane@example.com';
      applyInputs({ includePii: true });
      expect(opsApi.listEmailEvents).toHaveBeenCalled();
    });

    it('reloads when excludeOrderId changes', () => {
      component.userId = 'u-1';
      applyInputs({ excludeOrderId: 'x-1' });
      expect(ordersApi.search).toHaveBeenCalled();
    });

    it('does not reload when no tracked input changes', () => {
      component.ngOnChanges({
        somethingElse: change('userId'),
      } as any);
      expect(ordersApi.search).not.toHaveBeenCalled();
    });
  });

  describe('reload identity + gating', () => {
    it('gates with noCustomer when there is no identity at all', () => {
      applyInputs({ userId: '   ', customerEmail: '  ' });
      expect(component.gatedMessage()).toBe('adminUi.customerTimeline.noCustomer');
      expect(ordersApi.search).not.toHaveBeenCalled();
    });

    it('gates with emailGated when an email is present but PII is excluded', () => {
      applyInputs({ customerEmail: 'jane@example.com', includePii: false });
      expect(component.gatedMessage()).toBe('adminUi.customerTimeline.emailGated');
      expect(ordersApi.search).not.toHaveBeenCalled();
    });

    it('builds order params by user id when a userId is supplied', () => {
      applyInputs({ userId: 'u-1' });
      const params = ordersApi.search.calls.mostRecent().args[0] as any;
      expect(params.user_id).toBe('u-1');
      expect(params.q).toBeUndefined();
      expect(component.gatedMessage()).toBeNull();
    });

    it('builds order params by email query when only an email identity is present', () => {
      applyInputs({ customerEmail: 'jane@example.com', includePii: true });
      const params = ordersApi.search.calls.mostRecent().args[0] as any;
      expect(params.q).toBe('jane@example.com');
      expect(params.include_pii).toBeTrue();
      expect(params.user_id).toBeUndefined();
    });

    it('does not reload when the dedupe key is unchanged', () => {
      applyInputs({ userId: 'u-1' });
      ordersApi.search.calls.reset();
      component.ngOnChanges({ userId: change('userId') } as any);
      expect(ordersApi.search).not.toHaveBeenCalled();
    });
  });

  describe('section access branches', () => {
    it('skips orders/support/ops calls when sections are not accessible', () => {
      allowedSections.clear();
      applyInputs({ userId: 'u-1' });
      expect(ordersApi.search).not.toHaveBeenCalled();
      expect(supportApi.list).not.toHaveBeenCalled();
      expect(opsApi.listEmailEvents).not.toHaveBeenCalled();
      expect(component.events()).toEqual([]);
      expect(component.loading()).toBeFalse();
    });

    it('uses the userId as the support customer filter', () => {
      applyInputs({ userId: 'u-1' });
      const args = supportApi.list.calls.mostRecent().args[0] as any;
      expect(args.customer_filter).toBe('u-1');
    });

    it('uses the email as the support customer filter when no userId', () => {
      applyInputs({ customerEmail: 'jane@example.com', includePii: true });
      const args = supportApi.list.calls.mostRecent().args[0] as any;
      expect(args.customer_filter).toBe('jane@example.com');
    });

    it('does not query email events when identity is userId-only (no email)', () => {
      applyInputs({ userId: 'u-1' });
      expect(opsApi.listEmailEvents).not.toHaveBeenCalled();
    });
  });

  describe('event aggregation + sorting', () => {
    it('merges orders, tickets and emails into a sorted timeline', () => {
      applyInputs({ customerEmail: 'jane@example.com', includePii: true });
      const events = component.events();
      expect(events.length).toBe(3);
      expect(events[0].kind).toBe('order');
      expect(events[1].kind).toBe('ticket');
      expect(events[2].kind).toBe('email');
      expect(component.error()).toBeNull();
    });

    it('excludes the current order by id', () => {
      ordersApi.search.and.returnValue(
        of({ items: [order({ id: 'keep-1' }), order({ id: 'drop-1' })] } as any),
      );
      applyInputs({ userId: 'u-1', excludeOrderId: 'drop-1' });
      const orders = component.events().filter((e) => e.kind === 'order');
      expect(orders.length).toBe(1);
      expect((orders[0] as any).order.id).toBe('keep-1');
    });

    it('sorts valid dates descending and pushes invalid dates to the end', () => {
      // Interleaved valid/invalid ordering so the comparator is exercised with an
      // invalid value as both the first and second argument (return 1, return -1)
      // and with two invalid values (return 0), plus two valid values (bt - at).
      ordersApi.search.and.returnValue(
        of({
          items: [
            order({ id: 'good-old', created_at: '2030-01-01T00:00:00+00:00' }),
            order({ id: 'bad-a', created_at: 'not-a-date' }),
            order({ id: 'good-new', created_at: '2030-05-01T00:00:00+00:00' }),
            order({ id: 'bad-b', created_at: 'also-bad' }),
          ],
        } as any),
      );
      supportApi.list.and.returnValue(of({ items: [] } as any));
      opsApi.listEmailEvents.and.returnValue(of([]));
      applyInputs({ userId: 'u-1' }, false);
      const ids = component.events().map((e) => (e as any).order.id);
      // Newest valid date first, older valid date second.
      expect(ids[0]).toBe('good-new');
      expect(ids[1]).toBe('good-old');
      // Both invalid-date entries sort to the tail.
      expect(ids.slice(2).sort()).toEqual(['bad-a', 'bad-b']);
    });

    it('caps the timeline at 20 events', () => {
      const many = Array.from({ length: 25 }, (_, i) =>
        order({
          id: `o-${i}`,
          created_at: `2030-01-${String((i % 27) + 1).padStart(2, '0')}T00:00:00+00:00`,
        }),
      );
      ordersApi.search.and.returnValue(of({ items: many } as any));
      supportApi.list.and.returnValue(of({ items: [] } as any));
      opsApi.listEmailEvents.and.returnValue(of([]));
      applyInputs({ userId: 'u-1' });
      expect(component.events().length).toBe(20);
    });

    it('tolerates null item collections from the services', () => {
      ordersApi.search.and.returnValue(of({ items: null } as any));
      supportApi.list.and.returnValue(of({ items: null } as any));
      opsApi.listEmailEvents.and.returnValue(of(null as any));
      applyInputs({ customerEmail: 'jane@example.com', includePii: true });
      expect(component.events()).toEqual([]);
    });

    it('tolerates a null forkJoin response object', () => {
      ordersApi.search.and.returnValue(of(null as any));
      supportApi.list.and.returnValue(of(null as any));
      opsApi.listEmailEvents.and.returnValue(of(null as any));
      applyInputs({ userId: 'u-1' });
      expect(component.events()).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('surfaces a load error when an orders request fails', () => {
      ordersApi.search.and.returnValue(throwError(() => new Error('boom')));
      applyInputs({ userId: 'u-1' });
      expect(component.error()).toContain('errors.load');
      expect(component.loading()).toBeFalse();
    });

    it('surfaces a load error when a support request fails', () => {
      supportApi.list.and.returnValue(throwError(() => new Error('boom')));
      applyInputs({ userId: 'u-1' });
      expect(component.error()).toContain('errors.load');
    });

    it('surfaces a load error when an email events request fails', () => {
      opsApi.listEmailEvents.and.returnValue(throwError(() => new Error('boom')));
      applyInputs({ customerEmail: 'jane@example.com', includePii: true });
      expect(component.error()).toContain('errors.load');
    });
  });

  describe('showOpsShortcut', () => {
    it('is true when ops is accessible, email is present, and PII is included', () => {
      component.customerEmail = 'jane@example.com';
      component.includePii = true;
      expect(component.showOpsShortcut()).toBeTrue();
    });

    it('is false when ops access is denied', () => {
      allowedSections.delete('ops');
      component.customerEmail = 'jane@example.com';
      component.includePii = true;
      expect(component.showOpsShortcut()).toBeFalse();
    });

    it('is false when there is no email', () => {
      component.customerEmail = '   ';
      component.includePii = true;
      expect(component.showOpsShortcut()).toBeFalse();
    });

    it('is false when PII is not included', () => {
      component.customerEmail = 'jane@example.com';
      component.includePii = false;
      expect(component.showOpsShortcut()).toBeFalse();
    });
  });

  describe('openOpsEmails', () => {
    it('navigates to ops with the customer email', () => {
      component.customerEmail = 'jane@example.com';
      component.openOpsEmails();
      const [path, extras] = navigateSpy.calls.mostRecent().args as any;
      expect(path).toEqual(['/admin/ops']);
      expect(extras.queryParams.to_email).toBe('jane@example.com');
      expect(extras.queryParams.since_hours).toBe(168);
      expect(extras.state.focusOpsSection).toBe('emails');
    });

    it('omits the email when none is set', () => {
      component.customerEmail = '';
      component.openOpsEmails();
      const [, extras] = navigateSpy.calls.mostRecent().args as any;
      expect(extras.queryParams.to_email).toBeUndefined();
    });
  });

  describe('presentation helpers', () => {
    it('returns a distinct badge class per kind', () => {
      expect(component.kindBadgeClass('order')).toContain('indigo');
      expect(component.kindBadgeClass('ticket')).toContain('amber');
      expect(component.kindBadgeClass('email')).toContain('rose');
    });

    it('builds an order title from the reference code when present', () => {
      expect(component.orderTitle(order({ reference_code: 'ABC' }))).toBe('#ABC');
    });

    it('falls back to a shortened id when no reference code', () => {
      expect(component.orderTitle(order({ reference_code: null, id: '1234567890' }))).toBe(
        '12345678',
      );
    });

    it('builds a ticket title from a shortened id', () => {
      expect(component.ticketTitle(ticket({ id: 'abcdefghxyz' }))).toBe('#abcdefgh');
    });

    it('returns the raw ticket id when it is empty', () => {
      expect(component.ticketTitle(ticket({ id: '' }))).toBe('');
    });
  });

  describe('lifecycle', () => {
    it('unsubscribes cleanly on destroy', () => {
      applyInputs({ userId: 'u-1' });
      expect(() => component.ngOnDestroy()).not.toThrow();
    });
  });
});
