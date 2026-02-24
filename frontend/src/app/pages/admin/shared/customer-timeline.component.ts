import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, OnDestroy, SimpleChanges, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AdminOrderListItem, AdminOrdersService } from '../../../core/admin-orders.service';
import { AdminContactSubmissionListItem, AdminSupportService } from '../../../core/admin-support.service';
import { AuthService } from '../../../core/auth.service';
import { EmailEventRead, OpsService } from '../../../core/ops.service';
import { LocalizedCurrencyPipe } from '../../../shared/localized-currency.pipe';

type CustomerTimelineEvent =
  | { kind: 'order'; created_at: string; order: AdminOrderListItem }
  | { kind: 'ticket'; created_at: string; ticket: AdminContactSubmissionListItem }
  | { kind: 'email'; created_at: string; email: EmailEventRead };

@Component({
  selector: 'app-customer-timeline',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, LocalizedCurrencyPipe],
  template: `
    <div class="grid gap-2">
      <div class="flex items-start justify-between gap-3">
        <div class="grid gap-0.5">
          <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.customerTimeline.title' | translate }}</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.customerTimeline.subtitle' | translate }}</p>
        </div>
        <button
          *ngIf="showOpsShortcut()"
          type="button"
          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          (click)="openOpsEmails()"
        >
          {{ 'adminUi.customerTimeline.openOps' | translate }}
        </button>
      </div>

      <div *ngIf="gatedMessage() as gatedKey" class="text-xs text-slate-500 dark:text-slate-400">
        {{ gatedKey | translate }}
      </div>

      <div *ngIf="loading()" class="text-sm text-slate-600 dark:text-slate-300">
        {{ 'adminUi.customerTimeline.loading' | translate }}
      </div>

      <div *ngIf="!loading() && error()" class="text-sm text-rose-700 dark:text-rose-300">
        {{ error() }}
      </div>

      <div *ngIf="!loading() && !error() && events().length === 0 && !gatedMessage()" class="text-sm text-slate-500 dark:text-slate-400">
        {{ 'adminUi.customerTimeline.empty' | translate }}
      </div>

      <div *ngIf="!loading() && events().length > 0" class="grid gap-2">
        <div
          *ngFor="let ev of events()"
          class="rounded-lg border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                  [ngClass]="kindBadgeClass(ev.kind)"
                >
                  {{ ('adminUi.customerTimeline.kinds.' + ev.kind) | translate }}
                </span>

                <ng-container [ngSwitch]="ev.kind">
                  <a
                    *ngSwitchCase="'order'"
                    class="min-w-0 truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                    [routerLink]="['/admin/orders', ev.order.id]"
                  >
                    {{ orderTitle(ev.order) }}
                  </a>
                  <a
                    *ngSwitchCase="'ticket'"
                    class="min-w-0 truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                    [routerLink]="['/admin/support']"
                    [queryParams]="{ ticket: ev.ticket.id }"
                  >
                    {{ ticketTitle(ev.ticket) }}
                  </a>
                  <div *ngSwitchCase="'email'" class="min-w-0 truncate font-medium text-slate-900 dark:text-slate-50">
                    {{ ev.email.subject || ('adminUi.customerTimeline.kinds.email' | translate) }}
                  </div>
                </ng-container>
              </div>

              <div class="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                <ng-container [ngSwitch]="ev.kind">
                  <div *ngSwitchCase="'order'">
                    {{ ('adminUi.orders.' + ev.order.status) | translate }} ·
                    {{ ev.order.total_amount | localizedCurrency : ev.order.currency }}
                  </div>
                  <div *ngSwitchCase="'ticket'">
                    {{ ('adminUi.support.topics.' + ev.ticket.topic) | translate }} ·
                    {{ ('adminUi.support.status.' + ev.ticket.status) | translate }}
                  </div>
                  <div *ngSwitchCase="'email'">
                    <span class="font-semibold">{{ ('adminUi.customerTimeline.emailStatus.' + ev.email.status) | translate }}</span>
                    <span *ngIf="ev.email.status === 'failed'" class="break-words"> · {{ ev.email.error_message || '—' }}</span>
                  </div>
                </ng-container>
              </div>
            </div>

            <div class="shrink-0 text-xs text-slate-500 dark:text-slate-400">
              {{ ev.created_at | date: 'short' }}
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class CustomerTimelineComponent implements OnChanges, OnDestroy {
  @Input() userId?: string | null;
  @Input() customerEmail?: string | null;
  @Input() includePii?: boolean;
  @Input() excludeOrderId?: string | null;

  loading = signal(false);
  error = signal<string | null>(null);
  events = signal<CustomerTimelineEvent[]>([]);
  gatedMessage = signal<string | null>(null);

  private subs = new Subscription();
  private lastKey: string | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly ordersApi: AdminOrdersService,
    private readonly supportApi: AdminSupportService,
    private readonly opsApi: OpsService,
    private readonly router: Router,
    private readonly translate: TranslateService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['userId'] || changes['customerEmail'] || changes['includePii'] || changes['excludeOrderId']) {
      this.reload();
    }
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  showOpsShortcut(): boolean {
    const email = (this.customerEmail || '').trim();
    return this.auth.canAccessAdminSection('ops') && !!email && !!this.includePii;
  }

  openOpsEmails(): void {
    const email = (this.customerEmail || '').trim();
    void this.router.navigate(['/admin/ops'], {
      queryParams: { to_email: email || undefined, since_hours: 168 },
      state: { focusOpsSection: 'emails' } as any
    });
  }

  kindBadgeClass(kind: CustomerTimelineEvent['kind']): string {
    if (kind === 'order')
      return 'border-indigo-200 text-indigo-800 bg-indigo-50 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100';
    if (kind === 'ticket')
      return 'border-amber-200 text-amber-900 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100';
    return 'border-rose-200 text-rose-900 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100';
  }

  orderTitle(order: AdminOrderListItem): string {
    const ref = (order.reference_code || '').trim();
    return ref ? `#${ref}` : order.id.slice(0, 8);
  }

  ticketTitle(ticket: AdminContactSubmissionListItem): string {
    const short = (ticket.id || '').slice(0, 8);
    return short ? `#${short}` : ticket.id;
  }

  private reload(): void {
    const userId = (this.userId || '').trim();
    const email = (this.customerEmail || '').trim();
    const includePii = !!this.includePii;
    const excludeOrderId = (this.excludeOrderId || '').trim();

    const identity = userId ? `u:${userId}` : email ? `e:${email}` : '';
    const key = `${identity}|pii:${includePii}|x:${excludeOrderId || '-'}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.subs.unsubscribe();
    this.subs = new Subscription();

    this.loading.set(false);
    this.error.set(null);
    this.events.set([]);

    const hasIdentity = !!userId || (!!email && includePii);
    if (!hasIdentity) {
      this.gatedMessage.set(email ? 'adminUi.customerTimeline.emailGated' : 'adminUi.customerTimeline.noCustomer');
      return;
    }
    this.gatedMessage.set(null);

    const canOrders = this.auth.canAccessAdminSection('orders');
    const canSupport = this.auth.canAccessAdminSection('support');
    const canOps = this.auth.canAccessAdminSection('ops');

    let hadError = false;

    const requests: Record<string, any> = {};

    if (canOrders) {
      const params: any = { page: 1, limit: 5, include_test: true };
      if (userId) {
        params.user_id = userId;
      } else {
        params.q = email;
        params.include_pii = true;
      }
      requests['orders'] = this.ordersApi.search(params).pipe(
        map((res) => (res?.items || []).filter((o) => !excludeOrderId || o.id !== excludeOrderId)),
        catchError(() => {
          hadError = true;
          return of([] as AdminOrderListItem[]);
        })
      );
    } else {
      requests['orders'] = of([] as AdminOrderListItem[]);
    }

    if (canSupport) {
      const customer_filter = userId ? userId : email;
      requests['tickets'] = this.supportApi.list({ customer_filter, page: 1, limit: 5 }).pipe(
        map((res) => res?.items || []),
        catchError(() => {
          hadError = true;
          return of([] as AdminContactSubmissionListItem[]);
        })
      );
    } else {
      requests['tickets'] = of([] as AdminContactSubmissionListItem[]);
    }

    if (canOps && includePii && email) {
      requests['emails'] = this.opsApi.listEmailEvents({ limit: 10, since_hours: 168, to_email: email }).pipe(
        catchError(() => {
          hadError = true;
          return of([] as EmailEventRead[]);
        })
      );
    } else {
      requests['emails'] = of([] as EmailEventRead[]);
    }

    this.loading.set(true);
    this.subs.add(
      forkJoin(requests).subscribe({
        next: (res: any) => {
          const events: CustomerTimelineEvent[] = [
            ...(res?.orders || []).map((o: AdminOrderListItem) => ({ kind: 'order' as const, created_at: o.created_at, order: o })),
            ...(res?.tickets || []).map((t: AdminContactSubmissionListItem) => ({ kind: 'ticket' as const, created_at: t.created_at, ticket: t })),
            ...(res?.emails || []).map((e: EmailEventRead) => ({ kind: 'email' as const, created_at: e.created_at, email: e }))
          ];

          events.sort((a, b) => {
            const at = new Date(a.created_at).getTime();
            const bt = new Date(b.created_at).getTime();
            if (!Number.isFinite(at) && !Number.isFinite(bt)) return 0;
            if (!Number.isFinite(at)) return 1;
            if (!Number.isFinite(bt)) return -1;
            return bt - at;
          });
          this.events.set(events.slice(0, 20));

          if (hadError) {
            this.error.set(this.translate.instant('adminUi.customerTimeline.errors.load'));
          }
          this.loading.set(false);
        },
        error: () => {
          this.error.set(this.translate.instant('adminUi.customerTimeline.errors.load'));
          this.loading.set(false);
        }
      })
    );
  }
}

