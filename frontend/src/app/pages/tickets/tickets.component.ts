import { CommonModule, DatePipe, NgClass, NgForOf, NgIf } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AccountService, Order } from '../../core/account.service';
import { ToastService } from '../../core/toast.service';
import { TicketsService, TicketListItem, TicketRead, TicketTopic } from '../../core/tickets.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { ContainerComponent } from '../../layout/container.component';

@Component({
  selector: 'app-tickets',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TranslateModule,
    BreadcrumbComponent,
    ButtonComponent,
    ContainerComponent,
    NgIf,
    NgForOf,
    NgClass,
    DatePipe
  ],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-5xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <header class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'tickets.title' | translate }}</h1>
          <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'tickets.subtitle' | translate }}</p>
        </div>
        <a routerLink="/contact" class="text-sm font-medium text-indigo-600 dark:text-indigo-300">
          {{ 'tickets.contactLink' | translate }}
        </a>
      </header>

      <div class="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <section class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'tickets.inbox' | translate }}</h2>
            <button
              type="button"
              class="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              (click)="refresh()"
            >
              {{ 'tickets.refresh' | translate }}
            </button>
          </div>

          <div *ngIf="loading()" class="mt-4 text-sm text-slate-600 dark:text-slate-300">
            {{ 'tickets.loading' | translate }}
          </div>
          <div *ngIf="!loading() && tickets().length === 0" class="mt-4 text-sm text-slate-600 dark:text-slate-300">
            {{ 'tickets.empty' | translate }}
          </div>

          <div *ngIf="!loading() && tickets().length" class="mt-4 grid gap-2">
            <button
              *ngFor="let t of tickets()"
              type="button"
              class="w-full text-left rounded-xl border border-slate-200 p-3 hover:border-slate-300 hover:bg-slate-50 transition dark:border-slate-800 dark:hover:border-slate-700 dark:hover:bg-slate-950/40"
              [ngClass]="selected()?.id === t.id ? 'ring-2 ring-indigo-500/30 border-indigo-200 dark:border-indigo-700' : ''"
              (click)="openTicket(t.id)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">
                    {{ ('adminUi.support.topics.' + t.topic) | translate }}
                  </div>
                  <div *ngIf="t.order_reference" class="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                    {{ 'tickets.order' | translate }}: {{ t.order_reference }}
                  </div>
                </div>
                <span class="shrink-0 text-xs font-semibold rounded-full px-2 py-1"
                  [ngClass]="statusPillClass(t.status)">
                  {{ ('adminUi.support.status.' + t.status) | translate }}
                </span>
              </div>
              <div class="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {{ t.updated_at | date: 'short' }}
              </div>
            </button>
          </div>
        </section>

        <div class="grid gap-6">
          <section class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'tickets.newTitle' | translate }}</h2>
            <form #ticketForm="ngForm" class="mt-4 grid gap-4" (ngSubmit)="submit(ticketForm)">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'tickets.category' | translate }}
                <select
                  class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
                  name="topic"
                  [(ngModel)]="topic"
                  required
                >
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="refund">
                    {{ 'tickets.categories.refund' | translate }}
                  </option>
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="support">
                    {{ 'tickets.categories.product' | translate }}
                  </option>
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="dispute">
                    {{ 'tickets.categories.payments' | translate }}
                  </option>
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="contact">
                    {{ 'tickets.categories.other' | translate }}
                  </option>
                </select>
              </label>

              <div class="grid gap-2">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'tickets.orderOptional' | translate }}
                  <input
                    class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                    name="orderQuery"
                    [(ngModel)]="orderQuery"
                    [placeholder]="'tickets.orderSearchPlaceholder' | translate"
                    autocomplete="off"
                    spellcheck="false"
                  />
                </label>
                <select
                  class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
                  name="orderReference"
                  [(ngModel)]="orderReference"
                >
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" [ngValue]="null">
                    {{ 'tickets.noOrder' | translate }}
                  </option>
                  <option
                    *ngFor="let o of filteredOrders()"
                    class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"
                    [ngValue]="orderKey(o)"
                  >
                    {{ orderLabel(o) }}
                  </option>
                </select>
                <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'tickets.orderHint' | translate }}</p>
              </div>

              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'tickets.description' | translate }}
                <textarea
                  class="min-h-[140px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                  name="message"
                  [(ngModel)]="message"
                  required
                  maxlength="10000"
                  [placeholder]="'tickets.descriptionPlaceholder' | translate"
                ></textarea>
              </label>

              <app-button [label]="'tickets.send' | translate" type="submit"></app-button>
            </form>
          </section>

          <section class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'tickets.thread' | translate }}</h2>
            <div *ngIf="!selected()" class="mt-4 text-sm text-slate-600 dark:text-slate-300">
              {{ 'tickets.threadEmpty' | translate }}
            </div>
            <div *ngIf="selected() as ticket" class="mt-4 grid gap-4">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {{ ('adminUi.support.topics.' + ticket.topic) | translate }}
                  </div>
                  <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {{ 'tickets.created' | translate }}: {{ ticket.created_at | date: 'short' }}
                  </div>
                </div>
                <span class="shrink-0 text-xs font-semibold rounded-full px-2 py-1" [ngClass]="statusPillClass(ticket.status)">
                  {{ ('adminUi.support.status.' + ticket.status) | translate }}
                </span>
              </div>

              <div class="grid gap-3">
                <div
                  *ngFor="let m of ticket.messages"
                  class="rounded-2xl border border-slate-200 p-3 text-sm dark:border-slate-800"
                  [ngClass]="m.from_admin ? 'bg-slate-50 dark:bg-slate-950/30' : 'bg-white dark:bg-slate-900'"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                      {{ m.from_admin ? ('tickets.fromSupport' | translate) : ('tickets.fromYou' | translate) }}
                    </div>
                    <div class="text-xs text-slate-500 dark:text-slate-400">{{ m.created_at | date: 'short' }}</div>
                  </div>
                  <div class="mt-2 whitespace-pre-wrap text-slate-800 dark:text-slate-100">{{ m.message }}</div>
                </div>
              </div>

              <form class="grid gap-2" #replyForm="ngForm" (ngSubmit)="reply(replyForm)">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'tickets.reply' | translate }}
                  <textarea
                    class="min-h-[120px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                    name="replyMessage"
                    [(ngModel)]="replyMessage"
                    required
                    maxlength="10000"
                    [disabled]="ticket.status === 'resolved'"
                    [placeholder]="ticket.status === 'resolved' ? ('tickets.solvedHint' | translate) : ('tickets.replyPlaceholder' | translate)"
                  ></textarea>
                </label>
                <app-button
                  size="sm"
                  [disabled]="ticket.status === 'resolved'"
                  [label]="'tickets.sendReply' | translate"
                  type="submit"
                ></app-button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </app-container>
  `
})
export class TicketsComponent {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'tickets.title' }
  ];

  loading = signal(true);
  tickets = signal<TicketListItem[]>([]);
  selected = signal<TicketRead | null>(null);

  orders = signal<Order[]>([]);
  orderQuery = '';
  orderReference: string | null = null;

  topic: TicketTopic = 'support';
  message = '';
  replyMessage = '';

  filteredOrders = computed(() => {
    const q = (this.orderQuery || '').trim().toLowerCase();
    const orders = this.orders();
    if (!q) return orders;
    return orders.filter((o) => this.orderLabel(o).toLowerCase().includes(q));
  });

  constructor(
    private ticketsApi: TicketsService,
    private account: AccountService,
    private toast: ToastService,
    private translate: TranslateService
  ) {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.ticketsApi.listMine().subscribe({
      next: (rows) => {
        this.tickets.set(rows || []);
        this.loading.set(false);
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('tickets.errors.load');
        this.toast.error(msg);
        this.loading.set(false);
      }
    });

    this.account.getOrders().subscribe({
      next: (orders) => this.orders.set(orders || []),
      error: () => this.orders.set([])
    });
  }

  openTicket(id: string): void {
    this.ticketsApi.getOne(id).subscribe({
      next: (ticket) => {
        this.selected.set(ticket);
        this.replyMessage = '';
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('tickets.errors.loadDetail');
        this.toast.error(msg);
      }
    });
  }

  submit(form: NgForm): void {
    if (!form.valid) {
      this.toast.error(this.translate.instant('tickets.errors.form'));
      return;
    }
    const order_reference = (this.orderReference || '').trim() || null;
    this.ticketsApi
      .create({
        topic: this.topic,
        message: (this.message || '').trim(),
        order_reference
      })
      .subscribe({
        next: (ticket) => {
          this.toast.success(this.translate.instant('tickets.success.created'));
          this.message = '';
          this.orderReference = null;
          this.orderQuery = '';
          this.selected.set(ticket);
          this.refresh();
        },
        error: (err) => {
          const msg = err?.error?.detail || this.translate.instant('tickets.errors.create');
          this.toast.error(msg);
        }
      });
  }

  reply(form: NgForm): void {
    const ticket = this.selected();
    if (!ticket) return;
    if (!form.valid) {
      this.toast.error(this.translate.instant('tickets.errors.form'));
      return;
    }
    this.ticketsApi.addMessage(ticket.id, (this.replyMessage || '').trim()).subscribe({
      next: (updated) => {
        this.selected.set(updated);
        this.replyMessage = '';
        this.toast.success(this.translate.instant('tickets.success.sent'));
        this.refresh();
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('tickets.errors.reply');
        this.toast.error(msg);
      }
    });
  }

  orderKey(order: Order): string {
    return (order.reference_code || order.id || '').trim();
  }

  orderLabel(order: Order): string {
    const ref = this.orderKey(order);
    const date = order.created_at ? new Date(order.created_at) : null;
    const stamp = date ? new DatePipe('en-US').transform(date, 'mediumDate') : null;
    return stamp ? `${ref} · ${stamp}` : ref;
  }

  statusPillClass(status: string): string {
    if (status === 'resolved') return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200';
    if (status === 'triaged') return 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200';
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
  }
}

