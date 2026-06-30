import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AdminService } from '../../../core/admin.service';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';

interface CheckoutSettingsForm {
  shipping_fee_ron: number | string;
  free_shipping_threshold_ron: number | string;
  phone_required_home: boolean;
  phone_required_locker: boolean;
  fee_enabled: boolean;
  fee_type: 'flat' | 'percent';
  fee_value: number | string;
  vat_enabled: boolean;
  vat_rate_percent: number | string;
  vat_apply_to_shipping: boolean;
  vat_apply_to_fee: boolean;
  receipt_share_days: number | string;
  money_rounding: 'half_up' | 'half_even' | 'up' | 'down';
}

const defaultCheckoutSettings = (): CheckoutSettingsForm => ({
  shipping_fee_ron: 20,
  free_shipping_threshold_ron: 300,
  phone_required_home: true,
  phone_required_locker: true,
  fee_enabled: false,
  fee_type: 'flat',
  fee_value: 0,
  vat_enabled: true,
  vat_rate_percent: 10,
  vat_apply_to_shipping: false,
  vat_apply_to_fee: false,
  receipt_share_days: 365,
  money_rounding: 'half_up',
});

/**
 * Settings > Checkout settings panel, extracted (behaviour-preserving) from the
 * monolithic AdminComponent. Owns the checkout pricing form state and its
 * load/save logic; the shared CMS content-version bookkeeping stays on the
 * parent and is threaded in through the four callback inputs so all CMS panels
 * keep sharing one `contentVersions` map.
 */
@Component({
  selector: 'app-admin-checkout-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, TranslateModule, ButtonComponent, InputComponent],
  template: `
    <section
      class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
          {{ 'adminUi.site.checkout.title' | translate }}
        </h2>
        <div class="flex items-center gap-2">
          <app-button
            size="sm"
            variant="ghost"
            [label]="'adminUi.actions.refresh' | translate"
            (action)="loadCheckoutSettings()"
          ></app-button>
          <app-button
            size="sm"
            [label]="'adminUi.actions.save' | translate"
            (action)="saveCheckoutSettings()"
          ></app-button>
        </div>
      </div>
      <p class="text-xs text-slate-600 dark:text-slate-300">
        {{ 'adminUi.site.checkout.hint' | translate }}
      </p>
      <div class="grid md:grid-cols-2 gap-3 text-sm">
        <app-input
          [label]="'adminUi.site.checkout.shippingFee' | translate"
          type="number"
          [min]="0"
          [step]="0.01"
          placeholder="20.00"
          [(value)]="checkoutSettingsForm.shipping_fee_ron"
        ></app-input>
        <app-input
          [label]="'adminUi.site.checkout.freeShippingThreshold' | translate"
          type="number"
          [min]="0"
          [step]="0.01"
          placeholder="300.00"
          [(value)]="checkoutSettingsForm.free_shipping_threshold_ron"
        ></app-input>
      </div>

      <div
        class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950"
      >
        <p
          class="text-xs font-semibold text-slate-600 uppercase tracking-[0.2em] dark:text-slate-300"
        >
          {{ 'adminUi.site.checkout.roundingTitle' | translate }}
        </p>
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'adminUi.site.checkout.roundingMode' | translate }}
          <select
            class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            [(ngModel)]="checkoutSettingsForm.money_rounding"
          >
            <option value="half_up">
              {{ 'adminUi.site.checkout.roundingModeHalfUp' | translate }}
            </option>
            <option value="half_even">
              {{ 'adminUi.site.checkout.roundingModeHalfEven' | translate }}
            </option>
            <option value="up">{{ 'adminUi.site.checkout.roundingModeUp' | translate }}</option>
            <option value="down">
              {{ 'adminUi.site.checkout.roundingModeDown' | translate }}
            </option>
          </select>
          <span class="text-xs font-normal text-slate-500 dark:text-slate-400">
            {{ 'adminUi.site.checkout.roundingHint' | translate }}
          </span>
        </label>
      </div>

      <div
        class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950"
      >
        <p
          class="text-xs font-semibold text-slate-600 uppercase tracking-[0.2em] dark:text-slate-300"
        >
          {{ 'adminUi.site.checkout.phoneRequirementsTitle' | translate }}
        </p>
        <label class="flex items-center gap-2">
          <input type="checkbox" [(ngModel)]="checkoutSettingsForm.phone_required_home" />
          <span class="text-slate-700 dark:text-slate-200">{{
            'adminUi.site.checkout.phoneRequiredHome' | translate
          }}</span>
        </label>
        <label class="flex items-center gap-2">
          <input type="checkbox" [(ngModel)]="checkoutSettingsForm.phone_required_locker" />
          <span class="text-slate-700 dark:text-slate-200">{{
            'adminUi.site.checkout.phoneRequiredLocker' | translate
          }}</span>
        </label>
      </div>

      <div class="grid gap-3 text-sm">
        <label class="flex items-center gap-2">
          <input type="checkbox" [(ngModel)]="checkoutSettingsForm.fee_enabled" />
          <span class="text-slate-700 dark:text-slate-200">{{
            'adminUi.site.checkout.feeEnabled' | translate
          }}</span>
        </label>
        <div class="grid md:grid-cols-2 gap-3" *ngIf="checkoutSettingsForm.fee_enabled">
          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.site.checkout.feeType' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="checkoutSettingsForm.fee_type"
            >
              <option value="flat">
                {{ 'adminUi.site.checkout.feeTypeFlat' | translate }}
              </option>
              <option value="percent">
                {{ 'adminUi.site.checkout.feeTypePercent' | translate }}
              </option>
            </select>
          </label>
          <app-input
            [label]="'adminUi.site.checkout.feeValue' | translate"
            type="number"
            [min]="0"
            [step]="0.01"
            placeholder="0.00"
            [(value)]="checkoutSettingsForm.fee_value"
          ></app-input>
        </div>
      </div>

      <div class="grid gap-3 text-sm">
        <label class="flex items-center gap-2">
          <input type="checkbox" [(ngModel)]="checkoutSettingsForm.vat_enabled" />
          <span class="text-slate-700 dark:text-slate-200">{{
            'adminUi.site.checkout.vatEnabled' | translate
          }}</span>
        </label>
        <div class="grid md:grid-cols-2 gap-3" *ngIf="checkoutSettingsForm.vat_enabled">
          <app-input
            [label]="'adminUi.site.checkout.vatRatePercent' | translate"
            type="number"
            [min]="0"
            [max]="100"
            [step]="0.01"
            placeholder="10.00"
            [(value)]="checkoutSettingsForm.vat_rate_percent"
          ></app-input>
          <div
            class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950"
          >
            <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" [(ngModel)]="checkoutSettingsForm.vat_apply_to_shipping" />
              <span>{{ 'adminUi.site.checkout.vatApplyToShipping' | translate }}</span>
            </label>
            <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" [(ngModel)]="checkoutSettingsForm.vat_apply_to_fee" />
              <span>{{ 'adminUi.site.checkout.vatApplyToFee' | translate }}</span>
            </label>
          </div>
        </div>
      </div>

      <div class="grid md:grid-cols-2 gap-3 text-sm">
        <app-input
          [label]="'adminUi.site.checkout.receiptShareDays' | translate"
          type="number"
          [min]="1"
          [step]="1"
          placeholder="365"
          [(value)]="checkoutSettingsForm.receipt_share_days"
        ></app-input>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <span
          class="text-xs text-emerald-700 dark:text-emerald-300"
          *ngIf="checkoutSettingsMessage"
          >{{ checkoutSettingsMessage }}</span
        >
        <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="checkoutSettingsError">{{
          checkoutSettingsError
        }}</span>
      </div>
    </section>
  `,
})
export class AdminCheckoutSettingsComponent implements OnInit {
  /** Shared CMS version bookkeeping, owned by the parent AdminComponent. */
  @Input({ required: true }) rememberContentVersion!: (
    key: string,
    block: { version?: number } | null | undefined,
  ) => void;
  @Input({ required: true }) withExpectedVersion!: <T extends Record<string, unknown>>(
    key: string,
    payload: T,
  ) => T & { expected_version?: number };
  @Input({ required: true }) handleContentConflict!: (
    err: any,
    key: string,
    reload: () => void,
  ) => boolean;
  @Input({ required: true }) forgetContentVersion!: (key: string) => void;

  checkoutSettingsForm: CheckoutSettingsForm = defaultCheckoutSettings();
  checkoutSettingsMessage: string | null = null;
  checkoutSettingsError: string | null = null;

  constructor(
    private readonly admin: AdminService,
    private readonly translate: TranslateService,
  ) {}

  ngOnInit(): void {
    this.loadCheckoutSettings();
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }

  loadCheckoutSettings(): void {
    this.checkoutSettingsError = null;
    this.checkoutSettingsMessage = null;
    this.admin.getContent('site.checkout').subscribe({
      next: (block) => {
        this.rememberContentVersion('site.checkout', block);
        const meta = (block.meta || {}) as Record<string, any>;
        const parseBool = (value: any, fallback: boolean) => {
          if (typeof value === 'boolean') return value;
          if (typeof value === 'number') return Boolean(value);
          if (typeof value === 'string') {
            const v = value.trim().toLowerCase();
            if (['1', 'true', 'yes', 'on'].includes(v)) return true;
            if (['0', 'false', 'no', 'off'].includes(v)) return false;
          }
          return fallback;
        };
        const shipping = Number(meta['shipping_fee_ron']);
        const threshold = Number(meta['free_shipping_threshold_ron']);
        const phoneRequiredHome = parseBool(meta['phone_required_home'], true);
        const phoneRequiredLocker = parseBool(meta['phone_required_locker'], true);
        const feeEnabled = parseBool(meta['fee_enabled'], false);
        const feeTypeRaw = String(meta['fee_type'] ?? 'flat')
          .trim()
          .toLowerCase();
        const feeType = feeTypeRaw === 'percent' ? 'percent' : 'flat';
        const feeValueRaw = Number(meta['fee_value']);
        const feeValue = Number.isFinite(feeValueRaw) && feeValueRaw >= 0 ? feeValueRaw : 0;
        const vatEnabled = parseBool(meta['vat_enabled'], true);
        const vatRateRaw = Number(meta['vat_rate_percent']);
        const vatRate =
          Number.isFinite(vatRateRaw) && vatRateRaw >= 0 && vatRateRaw <= 100 ? vatRateRaw : 10;
        const vatApplyToShipping = parseBool(meta['vat_apply_to_shipping'], false);
        const vatApplyToFee = parseBool(meta['vat_apply_to_fee'], false);
        const receiptDaysRaw = Number(meta['receipt_share_days']);
        const receiptShareDays =
          Number.isFinite(receiptDaysRaw) && receiptDaysRaw >= 1 && receiptDaysRaw <= 3650
            ? Math.trunc(receiptDaysRaw)
            : 365;
        const roundingRaw = String(meta['money_rounding'] ?? 'half_up')
          .trim()
          .toLowerCase();
        const moneyRounding: 'half_up' | 'half_even' | 'up' | 'down' =
          roundingRaw === 'half_even' || roundingRaw === 'up' || roundingRaw === 'down'
            ? roundingRaw
            : 'half_up';
        this.checkoutSettingsForm = {
          shipping_fee_ron: Number.isFinite(shipping) && shipping >= 0 ? shipping : 20,
          free_shipping_threshold_ron:
            Number.isFinite(threshold) && threshold >= 0 ? threshold : 300,
          phone_required_home: phoneRequiredHome,
          phone_required_locker: phoneRequiredLocker,
          fee_enabled: feeEnabled,
          fee_type: feeType,
          fee_value: feeValue,
          vat_enabled: vatEnabled,
          vat_rate_percent: vatRate,
          vat_apply_to_shipping: vatApplyToShipping,
          vat_apply_to_fee: vatApplyToFee,
          receipt_share_days: receiptShareDays,
          money_rounding: moneyRounding,
        };
      },
      error: () => {
        this.forgetContentVersion('site.checkout');
        this.checkoutSettingsForm = defaultCheckoutSettings();
      },
    });
  }

  saveCheckoutSettings(): void {
    this.checkoutSettingsMessage = null;
    this.checkoutSettingsError = null;
    const shippingRaw = Number(this.checkoutSettingsForm.shipping_fee_ron);
    const thresholdRaw = Number(this.checkoutSettingsForm.free_shipping_threshold_ron);
    const shipping =
      Number.isFinite(shippingRaw) && shippingRaw >= 0 ? Math.round(shippingRaw * 100) / 100 : 20;
    const threshold =
      Number.isFinite(thresholdRaw) && thresholdRaw >= 0
        ? Math.round(thresholdRaw * 100) / 100
        : 300;

    const phoneRequiredHome = Boolean(this.checkoutSettingsForm.phone_required_home);
    const phoneRequiredLocker = Boolean(this.checkoutSettingsForm.phone_required_locker);

    const feeEnabled = Boolean(this.checkoutSettingsForm.fee_enabled);
    const feeType = this.checkoutSettingsForm.fee_type === 'percent' ? 'percent' : 'flat';
    const feeValueRaw = Number(this.checkoutSettingsForm.fee_value);
    const feeValue =
      Number.isFinite(feeValueRaw) && feeValueRaw >= 0 ? Math.round(feeValueRaw * 100) / 100 : 0;

    const vatEnabled = Boolean(this.checkoutSettingsForm.vat_enabled);
    const vatRateRaw = Number(this.checkoutSettingsForm.vat_rate_percent);
    const vatRate =
      Number.isFinite(vatRateRaw) && vatRateRaw >= 0 && vatRateRaw <= 100
        ? Math.round(vatRateRaw * 100) / 100
        : 10;
    const vatApplyToShipping = Boolean(this.checkoutSettingsForm.vat_apply_to_shipping);
    const vatApplyToFee = Boolean(this.checkoutSettingsForm.vat_apply_to_fee);

    const receiptDaysRaw = Number(this.checkoutSettingsForm.receipt_share_days);
    const receiptShareDays =
      Number.isFinite(receiptDaysRaw) && receiptDaysRaw >= 1 && receiptDaysRaw <= 3650
        ? Math.trunc(receiptDaysRaw)
        : 365;

    const roundingRaw = String(this.checkoutSettingsForm.money_rounding || 'half_up')
      .trim()
      .toLowerCase();
    const moneyRounding: 'half_up' | 'half_even' | 'up' | 'down' =
      roundingRaw === 'half_even' || roundingRaw === 'up' || roundingRaw === 'down'
        ? roundingRaw
        : 'half_up';

    const payload = {
      title: 'Checkout settings',
      body_markdown:
        'Checkout pricing settings (shipping, discounts, VAT, additional fees, and receipt sharing).',
      status: 'published',
      meta: {
        version: 1,
        shipping_fee_ron: shipping,
        free_shipping_threshold_ron: threshold,
        phone_required_home: phoneRequiredHome,
        phone_required_locker: phoneRequiredLocker,
        fee_enabled: feeEnabled,
        fee_type: feeType,
        fee_value: feeValue,
        vat_enabled: vatEnabled,
        vat_rate_percent: vatRate,
        vat_apply_to_shipping: vatApplyToShipping,
        vat_apply_to_fee: vatApplyToFee,
        receipt_share_days: receiptShareDays,
        money_rounding: moneyRounding,
      },
    };

    const onSuccess = (block?: { version?: number } | null) => {
      this.rememberContentVersion('site.checkout', block);
      this.checkoutSettingsMessage = this.t('adminUi.site.checkout.success.save');
      this.checkoutSettingsError = null;
    };

    this.admin
      .updateContentBlock('site.checkout', this.withExpectedVersion('site.checkout', payload))
      .subscribe({
        next: (block) => onSuccess(block),
        error: (err) => {
          if (this.handleContentConflict(err, 'site.checkout', () => this.loadCheckoutSettings())) {
            this.checkoutSettingsError = this.t('adminUi.site.checkout.errors.save');
            this.checkoutSettingsMessage = null;
            return;
          }
          this.admin.createContent('site.checkout', payload).subscribe({
            next: (created) => onSuccess(created),
            error: () => {
              this.checkoutSettingsError = this.t('adminUi.site.checkout.errors.save');
              this.checkoutSettingsMessage = null;
            },
          });
        },
      });
  }
}
