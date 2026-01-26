import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ReceiptRead, ReceiptService } from '../../core/receipt.service';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';

@Component({
  selector: 'app-receipt',
  standalone: true,
  imports: [CommonModule, RouterModule, LocalizedCurrencyPipe],
  providers: [DatePipe],
  template: `
    <div class="mx-auto max-w-4xl px-4 py-10">
      <div class="flex flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="grid gap-1">
            <p class="text-xs font-semibold tracking-[0.2em] uppercase text-slate-500 dark:text-slate-400">
              Receipt / Chitanță
            </p>
            <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">
              {{ receipt?.reference_code || receipt?.order_id || '—' }}
            </h1>
            <p class="text-sm text-slate-600 dark:text-slate-300" *ngIf="receipt?.created_at">
              Date / Dată: {{ receipt?.created_at | date: 'medium' }}
            </p>
          </div>

          <div class="flex flex-wrap gap-2">
            <a
              *ngIf="token"
              class="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
              [href]="pdfUrl"
              target="_blank"
              rel="noopener"
            >
              Download PDF
            </a>
            <button
              *ngIf="token && receipt && auth.isAuthenticated()"
              type="button"
              class="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
              [disabled]="loading"
              (click)="toggleReveal()"
            >
              {{ reveal ? 'Hide details' : 'Show full details' }}
            </button>
            <a
              class="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
              routerLink="/"
            >
              Back home
            </a>
          </div>
        </div>

        <div *ngIf="loading" class="text-sm text-slate-600 dark:text-slate-300">Loading…</div>
        <div *ngIf="error" class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          {{ error }}
        </div>

        <ng-container *ngIf="!loading && receipt">
          <div
            *ngIf="receipt.pii_redacted"
            class="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            <div class="grid gap-1">
              <p>This shared receipt hides personal details by default.</p>
              <p>Această chitanță partajată ascunde datele personale în mod implicit.</p>
              <p class="text-xs text-slate-500 dark:text-slate-400" *ngIf="auth.isAuthenticated() && reveal">
                Full details are available only to the order owner or an admin.
              </p>
            </div>
          </div>

          <div class="grid gap-4 sm:grid-cols-2" *ngIf="receipt.customer_name || receipt.customer_email">
            <div class="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
              <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                Customer / Client
              </p>
              <p class="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-50" *ngIf="receipt.customer_name">
                {{ receipt.customer_name }}
              </p>
              <p class="mt-1 text-sm text-slate-700 dark:text-slate-200" *ngIf="receipt.customer_email">
                {{ receipt.customer_email }}
              </p>
            </div>
            <div class="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
              <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                Status / Stare
              </p>
              <p class="mt-1 text-sm text-slate-700 dark:text-slate-200">
                {{ receipt.status }}
              </p>
              <p class="mt-1 text-sm text-slate-700 dark:text-slate-200" *ngIf="receipt.payment_method">
                Payment / Plată: {{ paymentMethodLabel() }}
              </p>
              <p class="mt-1 text-sm text-slate-700 dark:text-slate-200" *ngIf="receipt.courier || receipt.delivery_type">
                Delivery / Livrare: {{ receipt.courier || '—' }} · {{ receipt.delivery_type || '—' }}
              </p>
              <p class="mt-1 text-sm text-slate-700 dark:text-slate-200" *ngIf="receipt.delivery_type === 'locker' && (receipt.locker_name || receipt.locker_address)">
                Locker: {{ receipt.locker_name }} <span *ngIf="receipt.locker_address">— {{ receipt.locker_address }}</span>
              </p>
              <p class="mt-1 text-sm text-slate-700 dark:text-slate-200" *ngIf="receipt.tracking_number">
                AWB / Tracking: {{ receipt.tracking_number }}
              </p>
            </div>
          </div>

          <div class="grid gap-4 sm:grid-cols-2" *ngIf="receipt.shipping_address || receipt.billing_address">
            <div class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
              <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                Shipping / Livrare
              </p>
              <div class="mt-2 text-sm text-slate-700 dark:text-slate-200" *ngIf="receipt.shipping_address as a; else missingShip">
                <p>{{ a.line1 }}</p>
                <p *ngIf="a.line2">{{ a.line2 }}</p>
                <p>{{ a.postal_code }} {{ a.city }}</p>
                <p *ngIf="a.region">{{ a.region }}</p>
                <p>{{ a.country }}</p>
              </div>
              <ng-template #missingShip>
                <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">—</p>
              </ng-template>
            </div>
            <div class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
              <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                Billing / Facturare
              </p>
              <div class="mt-2 text-sm text-slate-700 dark:text-slate-200" *ngIf="receipt.billing_address as a; else missingBill">
                <p>{{ a.line1 }}</p>
                <p *ngIf="a.line2">{{ a.line2 }}</p>
                <p>{{ a.postal_code }} {{ a.city }}</p>
                <p *ngIf="a.region">{{ a.region }}</p>
                <p>{{ a.country }}</p>
              </div>
              <ng-template #missingBill>
                <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">—</p>
              </ng-template>
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
              Items / Produse
            </p>
            <div class="mt-3 overflow-auto">
              <table class="min-w-full text-sm">
                <thead>
                  <tr class="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <th class="py-2 pr-4">Product / Produs</th>
                    <th class="py-2 pr-4">Qty</th>
                    <th class="py-2 pr-4">Unit</th>
                    <th class="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody class="text-slate-800 dark:text-slate-100">
                  <tr *ngFor="let it of receipt.items" class="border-t border-slate-200 dark:border-slate-800">
                    <td class="py-3 pr-4">
                      <a
                        *ngIf="it.slug; else noSlug"
                        class="font-semibold text-indigo-600 hover:underline dark:text-indigo-300"
                        [routerLink]="['/products', it.slug]"
                      >
                        {{ it.name }}
                      </a>
                      <ng-template #noSlug>{{ it.name }}</ng-template>
                    </td>
                    <td class="py-3 pr-4">{{ it.quantity }}</td>
                    <td class="py-3 pr-4">{{ it.unit_price | localizedCurrency: receipt.currency }}</td>
                    <td class="py-3 text-right">{{ it.subtotal | localizedCurrency: receipt.currency }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="mt-4 grid gap-1 text-sm">
              <div class="flex items-center justify-between text-slate-600 dark:text-slate-300">
                <span>Shipping / Livrare</span>
                <span>{{ (receipt.shipping_amount || 0) | localizedCurrency: receipt.currency }}</span>
              </div>
              <div class="flex items-center justify-between text-slate-600 dark:text-slate-300" *ngIf="(receipt.fee_amount || 0) > 0">
                <span>Additional / Cost supl.</span>
                <span>{{ (receipt.fee_amount || 0) | localizedCurrency: receipt.currency }}</span>
              </div>
              <div class="flex items-center justify-between text-slate-600 dark:text-slate-300" *ngIf="(receipt.tax_amount || 0) > 0">
                <span>VAT / TVA</span>
                <span>{{ (receipt.tax_amount || 0) | localizedCurrency: receipt.currency }}</span>
              </div>
              <div class="flex items-center justify-between pt-2 text-base font-semibold text-slate-900 dark:text-slate-50">
                <span>Total / Total</span>
                <span>{{ (receipt.total_amount || 0) | localizedCurrency: receipt.currency }}</span>
              </div>
            </div>
          </div>

          <div
            *ngIf="(receipt.refunds || []).length > 0"
            class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950"
          >
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
              Refunds / Rambursări
            </p>
            <div class="mt-3 grid gap-2">
              <div
                *ngFor="let rf of receipt.refunds"
                class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <div class="flex items-start justify-between gap-4">
                  <div class="grid gap-0.5">
                    <div class="font-semibold text-slate-900 dark:text-slate-50">
                      {{ rf.amount | localizedCurrency: receipt.currency }}
                    </div>
                    <div class="text-xs text-slate-500 dark:text-slate-400">
                      {{ rf.created_at | date: 'short' }} · {{ rf.provider }}
                    </div>
                    <div *ngIf="rf.note" class="text-xs text-slate-600 dark:text-slate-300">
                      {{ rf.note }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p class="text-xs text-slate-500 dark:text-slate-400">Thank you! / Mulțumim!</p>
        </ng-container>
      </div>
    </div>
  `
})
export class ReceiptComponent implements OnInit, OnDestroy {
  receipt: ReceiptRead | null = null;
  token = '';
  pdfUrl = '';
  loading = true;
  error = '';
  reveal = false;

  private sub?: Subscription;

  constructor(private route: ActivatedRoute, private receipts: ReceiptService, public auth: AuthService) {}

  paymentMethodLabel(): string {
    const method = (this.receipt?.payment_method ?? '').trim().toLowerCase();
    if (!method) return '';
    if (method === 'stripe') return 'Stripe';
    if (method === 'paypal') return 'PayPal';
    if (method === 'netopia') return 'Netopia';
    if (method === 'cod') return 'Cash / Numerar';
    return method.toUpperCase();
  }

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      this.token = params.get('token') || '';
      this.reveal = false;
      this.loadReceipt();
    });
  }

  toggleReveal(): void {
    if (!this.token) return;
    this.reveal = !this.reveal;
    this.loadReceipt();
  }

  private loadReceipt(): void {
    if (!this.token) {
      this.loading = false;
      this.receipt = null;
      this.error = 'Missing receipt token.';
      return;
    }
    this.loading = true;
    this.error = '';
    this.pdfUrl = this.receipts.pdfUrl(this.token, { reveal: this.reveal });
    this.receipts.getByToken(this.token, { reveal: this.reveal }).subscribe({
      next: (data) => {
        this.receipt = data;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.receipt = null;
        this.error = err?.error?.detail || 'Receipt not found or link expired.';
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
