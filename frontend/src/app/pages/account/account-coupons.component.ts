import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { CouponsService, type CouponRead } from '../../core/coupons.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent } from '../../shared/button.component';
import { SkeletonComponent } from '../../shared/skeleton.component';

@Component({
  selector: 'app-account-coupons',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, ButtonComponent, SkeletonComponent],
  template: `
    <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'nav.myCoupons' | translate }}</h2>
        <app-button
          size="sm"
          variant="ghost"
          [label]="'account.coupons.goToCheckout' | translate"
          routerLink="/checkout"
        ></app-button>
      </div>

      <div *ngIf="loading()" class="grid gap-3">
        <app-skeleton height="18px" width="200px"></app-skeleton>
        <app-skeleton height="92px"></app-skeleton>
        <app-skeleton height="92px"></app-skeleton>
      </div>

      <div
        *ngIf="!loading() && error()"
        class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
      >
        {{ error() }}
      </div>

      <div
        *ngIf="!loading() && !error() && coupons().length === 0"
        class="border border-dashed border-slate-200 rounded-xl p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"
      >
        {{ 'account.coupons.empty' | translate }}
      </div>

      <div *ngIf="!loading() && !error() && coupons().length" class="grid gap-3">
        <div
          *ngFor="let c of coupons()"
          class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none"
        >
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0 grid gap-1">
              <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                {{ c.promotion?.name || ('account.coupons.coupon' | translate) }}
              </p>
              <p *ngIf="c.promotion?.description" class="text-sm text-slate-600 dark:text-slate-300">
                {{ c.promotion?.description }}
              </p>
              <div class="flex flex-wrap gap-2 pt-1">
                <span
                  class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {{ describeDiscount(c) }}
                </span>
                <span
                  *ngIf="c.promotion?.min_subtotal"
                  class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {{ 'account.coupons.minSubtotal' | translate }}: {{ c.promotion?.min_subtotal }} RON
                </span>
                <span
                  *ngIf="c.promotion"
                  class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {{
                    c.promotion.allow_on_sale_items
                      ? ('account.coupons.allowOnSale' | translate)
                      : ('account.coupons.excludeOnSale' | translate)
                  }}
                </span>
                <span
                  *ngIf="statusLabel(c) as status"
                  class="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold"
                  [ngClass]="status.className"
                >
                  {{ status.label }}
                </span>
              </div>
            </div>

            <div class="flex flex-col items-start sm:items-end gap-2 shrink-0">
              <div class="font-mono text-sm text-slate-900 dark:text-slate-50">{{ c.code }}</div>
              <div class="flex gap-2">
                <app-button size="sm" variant="ghost" [label]="'account.coupons.copy' | translate" (action)="copyCode(c.code)"></app-button>
                <app-button size="sm" [label]="'account.coupons.useInCheckout' | translate" routerLink="/checkout" [queryParams]="{ promo: c.code }"></app-button>
              </div>
              <p *ngIf="c.ends_at" class="text-xs text-slate-500 dark:text-slate-400">
                {{ 'account.coupons.validUntil' | translate }} {{ c.ends_at | date: 'yyyy-MM-dd' }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  `
})
export class AccountCouponsComponent implements OnInit {
  protected readonly coupons = signal<CouponRead[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor(
    private couponsService: CouponsService,
    private toast: ToastService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.couponsService.myCoupons().subscribe({
      next: (coupons) => {
        this.coupons.set(coupons ?? []);
        this.loading.set(false);
      },
      error: (err) => {
        const detail = err?.error?.detail;
        this.error.set(detail || this.translate.instant('account.coupons.loadError'));
        this.loading.set(false);
      }
    });
  }

  describeDiscount(coupon: CouponRead): string {
    const promo = coupon.promotion;
    if (!promo) return this.translate.instant('account.coupons.coupon');

    if (promo.discount_type === 'free_shipping') {
      return this.translate.instant('account.coupons.freeShipping');
    }

    if (promo.discount_type === 'amount') {
      const value = promo.amount_off ?? '0';
      return this.translate.instant('account.coupons.amountOff', { value });
    }

    const value = promo.percentage_off ?? '0';
    return this.translate.instant('account.coupons.percentOff', { value });
  }

  statusLabel(coupon: CouponRead): { label: string; className: string } | null {
    const now = Date.now();
    const promo = coupon.promotion;

    const endsAt = coupon.ends_at ? Date.parse(coupon.ends_at) : null;
    if (endsAt && endsAt < now) {
      return {
        label: this.translate.instant('account.coupons.expired'),
        className: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
      };
    }

    if (!coupon.is_active || (promo && !promo.is_active)) {
      return {
        label: this.translate.instant('account.coupons.inactive'),
        className: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100'
      };
    }

    return null;
  }

  async copyCode(code: string): Promise<void> {
    const value = (code || '').trim().toUpperCase();
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      this.toast.success(this.translate.instant('account.coupons.copiedTitle'), this.translate.instant('account.coupons.copiedCopy'));
    } catch {
      // Clipboard might be blocked; still show the code in UI.
      this.toast.info(this.translate.instant('account.coupons.copy'), value);
    }
  }
}

