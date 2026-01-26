import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { ControlContainer, FormsModule, NgForm } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonComponent } from '../../shared/button.component';

@Component({
  selector: 'app-checkout-promo-step',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslateModule, ButtonComponent],
  viewProviders: [{ provide: ControlContainer, useExisting: NgForm }],
  template: `
    <div id="checkout-step-3" class="scroll-mt-24 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div class="flex items-center justify-between gap-3">
        <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em] dark:text-slate-200">{{ 'checkout.step3' | translate }}</p>
        <span *ngIf="vm.step3Complete()" class="text-xs font-semibold text-emerald-700 dark:text-emerald-300">✓</span>
      </div>
      <ng-container *ngIf="vm.auth.isAuthenticated(); else guestCoupons">
        <div class="flex gap-3">
          <input
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 flex-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            [(ngModel)]="vm.promo"
            name="promo"
            [placeholder]="'checkout.promoPlaceholder' | translate"
          />
          <app-button size="sm" [label]="'checkout.apply' | translate" (action)="vm.applyPromo()"></app-button>
        </div>
        <p
          class="text-sm"
          [ngClass]="
            vm.promoStatus === 'success'
              ? 'text-emerald-700 dark:text-emerald-300'
              : vm.promoStatus === 'warn'
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-slate-700 dark:text-slate-300'
          "
          *ngIf="vm.promoMessage"
        >
          {{ vm.promoMessage }}
        </p>

        <div class="grid gap-2 pt-2">
          <div class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200">
            <p class="font-semibold text-slate-800 dark:text-slate-100">{{ 'checkout.couponRulesTitle' | translate }}</p>
            <ul class="list-disc pl-5 text-slate-600 dark:text-slate-300">
              <li>{{ 'checkout.couponRulesSubtotal' | translate }}</li>
              <li>{{ 'checkout.couponRulesOneCoupon' | translate }}</li>
              <li>{{ 'checkout.couponRulesSaleItems' | translate }}</li>
            </ul>
            <label class="flex items-center gap-2 pt-1">
              <input type="checkbox" [checked]="vm.autoApplyBestCoupon" (change)="vm.setAutoApplyBestCouponPreference($any($event.target).checked)" />
              <span>{{ 'checkout.autoApplyBestCoupon' | translate }}</span>
            </label>
          </div>
          <p *ngIf="vm.couponEligibilityLoading" class="text-xs text-slate-500 dark:text-slate-400">
            {{ 'checkout.couponsLoading' | translate }}
          </p>
          <p *ngIf="vm.couponEligibilityError" class="text-xs text-amber-700 dark:text-amber-300">
            {{ vm.couponEligibilityError }}
          </p>

          <ng-container *ngIf="!vm.couponEligibilityLoading && !vm.couponEligibilityError && vm.couponEligibility">
            <div *ngIf="vm.couponEligibility.eligible.length" class="grid gap-2">
              <div
                *ngIf="vm.suggestedCouponOffer && !vm.appliedCouponOffer"
                class="grid gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-900/40 dark:bg-indigo-950/30"
              >
                <p class="text-xs font-semibold text-indigo-900 dark:text-indigo-100">
                  {{ 'checkout.bestCouponTitle' | translate }}
                </p>
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-slate-900 dark:text-slate-50">
                      {{ vm.suggestedCouponOffer.coupon.promotion?.name || vm.suggestedCouponOffer.coupon.code }}
                    </p>
                    <p class="text-xs text-slate-700 dark:text-slate-200">
                      {{ vm.describeCouponOffer(vm.suggestedCouponOffer) }}
                    </p>
                    <div *ngIf="vm.suggestedCouponOffer.coupon.promotion as promo" class="pt-1 flex flex-wrap gap-1">
                      <span
                        class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
                        [ngClass]="
                          promo.allow_on_sale_items
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200'
                            : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200'
                        "
                      >
                        {{
                          (promo.allow_on_sale_items ? 'checkout.couponStacksWithSales' : 'checkout.couponExcludesSaleItems') | translate
                        }}
                      </span>
                    </div>
                  </div>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'checkout.apply' | translate"
                    (action)="vm.applyCouponOffer(vm.suggestedCouponOffer)"
                  ></app-button>
                </div>
              </div>
              <p class="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {{ 'checkout.availableCoupons' | translate }}
              </p>
              <div class="grid gap-2">
                <div
                  *ngFor="let offer of vm.couponEligibility.eligible"
                  class="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/30"
                >
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-slate-900 dark:text-slate-50">
                      {{ offer.coupon.promotion?.name || offer.coupon.code }}
                    </p>
                    <p class="text-xs text-slate-600 dark:text-slate-300">
                      {{ vm.describeCouponOffer(offer) }}
                    </p>
                    <div *ngIf="offer.coupon.promotion as promo" class="pt-1 flex flex-wrap gap-1">
                      <span
                        class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
                        [ngClass]="
                          promo.allow_on_sale_items
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200'
                            : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200'
                        "
                      >
                        {{ (promo.allow_on_sale_items ? 'checkout.couponStacksWithSales' : 'checkout.couponExcludesSaleItems') | translate }}
                      </span>
                    </div>
                  </div>
                  <app-button size="sm" variant="ghost" [label]="'checkout.apply' | translate" (action)="vm.applyCouponOffer(offer)"></app-button>
                </div>
              </div>
            </div>

            <details *ngIf="vm.couponEligibility.ineligible.length" class="grid gap-2">
              <summary class="cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-200">
                {{ 'checkout.unavailableCoupons' | translate }}
              </summary>
              <div class="grid gap-2">
                <div
                  *ngFor="let offer of vm.couponEligibility.ineligible"
                  class="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-slate-900 dark:text-slate-50">
                      {{ offer.coupon.promotion?.name || offer.coupon.code }}
                    </p>
                    <p class="text-xs text-slate-600 dark:text-slate-300">
                      {{ vm.describeCouponOffer(offer) }}
                    </p>
                    <div *ngIf="offer.coupon.promotion as promo" class="pt-1 flex flex-wrap gap-1">
                      <span
                        class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
                        [ngClass]="
                          promo.allow_on_sale_items
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200'
                            : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200'
                        "
                      >
                        {{ (promo.allow_on_sale_items ? 'checkout.couponStacksWithSales' : 'checkout.couponExcludesSaleItems') | translate }}
                      </span>
                    </div>
                    <p *ngIf="offer.reasons?.length" class="text-xs text-amber-700 dark:text-amber-300 pt-1">
                      {{ vm.describeCouponReasons(offer.reasons) }}
                    </p>
                    <ng-container *ngIf="vm.minSubtotalShortfall(offer) as minInfo">
                      <p class="text-xs text-slate-600 dark:text-slate-300 pt-1">
                        {{
                          'checkout.couponMinSubtotalRemaining' | translate : { amount: minInfo.remaining.toFixed(2), min: minInfo.min.toFixed(2) }
                        }}
                      </p>
                      <div class="mt-1 h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800">
                        <div class="h-2 rounded-full bg-indigo-600" [style.width.%]="minInfo.progress * 100"></div>
                      </div>
                    </ng-container>
                  </div>
                  <span class="font-mono text-xs text-slate-500 dark:text-slate-400">{{ offer.coupon.code }}</span>
                </div>
              </div>
            </details>
          </ng-container>
        </div>
      </ng-container>

      <ng-template #guestCoupons>
        <div class="grid gap-2">
          <p class="text-sm text-slate-700 dark:text-slate-300">{{ 'checkout.couponsLoginRequired' | translate }}</p>
          <div class="flex flex-wrap gap-2">
            <app-button size="sm" variant="ghost" [label]="'nav.signIn' | translate" routerLink="/login"></app-button>
            <app-button size="sm" variant="ghost" [label]="'nav.register' | translate" routerLink="/register"></app-button>
          </div>
        </div>
      </ng-template>

      <div class="flex justify-end">
        <app-button
          size="sm"
          variant="ghost"
          [label]="'checkout.continue' | translate"
          [disabled]="!vm.step3Complete()"
          (action)="vm.scrollToStep('checkout-step-4')"
        ></app-button>
      </div>
    </div>
  `
})
export class CheckoutPromoStepComponent {
  @Input({ required: true }) vm!: any;
}
