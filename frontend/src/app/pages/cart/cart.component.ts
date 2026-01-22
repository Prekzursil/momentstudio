import { CommonModule } from '@angular/common';
import { Component, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { CartItem, CartStore } from '../../core/cart.store';
import { CartApi } from '../../core/cart.api';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { ImgFallbackDirective } from '../../shared/img-fallback.directive';
import { OnInit } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../core/auth.service';
import { CouponOffer, CouponsService } from '../../core/coupons.service';
import { parseMoney } from '../../shared/money';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ContainerComponent, ButtonComponent, BreadcrumbComponent, LocalizedCurrencyPipe, TranslateModule, ImgFallbackDirective],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div class="grid lg:grid-cols-[2fr_1fr] gap-6 items-start">
        <section class="grid gap-4">
          <div class="flex items-center justify-between">
            <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'cart.title' | translate }}</h1>
            <div class="flex items-center gap-3">
              <span class="text-sm text-slate-600 dark:text-slate-300">{{ 'cart.items' | translate : { count: items().length } }}</span>
              <span *ngIf="syncing()" class="text-xs text-slate-500 dark:text-slate-400">{{ 'cart.syncing' | translate }}</span>
              <app-button
                *ngIf="items().length"
                size="sm"
                variant="ghost"
                [label]="'cart.clear' | translate"
                (action)="clearCart()"
              ></app-button>
            </div>
          </div>

          <div *ngIf="syncing() && !items().length" class="grid gap-3">
            <div
              *ngFor="let _ of skeletonRows"
              class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 animate-pulse dark:border-slate-800 dark:bg-slate-900"
            >
              <div class="flex gap-4">
                <div class="h-24 w-24 rounded-xl bg-slate-100 dark:bg-slate-800"></div>
                <div class="flex-1 grid gap-2">
                  <div class="h-4 w-1/3 rounded bg-slate-100 dark:bg-slate-800"></div>
                  <div class="h-3 w-1/4 rounded bg-slate-100 dark:bg-slate-800"></div>
                  <div class="h-8 w-56 rounded bg-slate-100 dark:bg-slate-800"></div>
                </div>
              </div>
            </div>
          </div>

          <div *ngIf="!syncing() && !items().length" class="border border-dashed border-slate-200 rounded-2xl p-10 text-center grid gap-3 dark:border-slate-800">
            <p class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'cart.emptyTitle' | translate }}</p>
            <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'cart.emptyCopy' | translate }}</p>
            <div class="flex justify-center">
              <app-button routerLink="/shop" [label]="'cart.backToShop' | translate"></app-button>
            </div>
          </div>

          <div *ngFor="let item of items()" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex gap-4">
              <a [routerLink]="['/products', item.slug]" class="shrink-0">
                <img
                  [src]="item.image ?? 'assets/placeholder/product-placeholder.svg'"
                  [alt]="item.name"
                  class="h-24 w-24 rounded-xl object-cover border border-slate-100 dark:border-slate-800"
                  [appImgFallback]="'assets/placeholder/product-placeholder.svg'"
                />
              </a>
              <div class="flex-1 grid gap-2">
                <div class="flex items-start justify-between">
                  <div>
                    <a
                      [routerLink]="['/products', item.slug]"
                      class="font-semibold text-slate-900 dark:text-slate-50 hover:underline"
                      >{{ item.name }}</a
                    >
                    <p class="text-sm text-slate-500 dark:text-slate-400">
                      <ng-container *ngIf="isLowStock(item); else cartInStock">{{ 'cart.onlyLeft' | translate : { count: item.stock } }}</ng-container>
                      <ng-template #cartInStock>{{ 'cart.inStock' | translate : { count: item.stock } }}</ng-template>
                    </p>
                  </div>
                  <button class="text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50" (click)="remove(item.id)">
                    {{ 'cart.remove' | translate }}
                  </button>
                </div>
                <div class="flex items-center gap-3 text-sm">
                  <div class="flex items-center gap-2">
                    <span class="text-slate-700 dark:text-slate-200">{{ 'cart.qty' | translate }}</span>
                    <div
                      class="inline-flex items-center rounded-lg border bg-white dark:bg-slate-800 dark:border-slate-700"
                      [class.border-amber-300]="isMaxQuantity(item)"
                      [class.dark:border-amber-700]="isMaxQuantity(item)"
                    >
                      <button
                        type="button"
                        class="px-2 py-1 text-slate-700 hover:text-slate-900 disabled:opacity-50 dark:text-slate-200 dark:hover:text-slate-50"
                        [attr.aria-label]="'cart.decreaseQty' | translate"
                        [disabled]="item.quantity <= 1"
                        (click)="stepQuantity(item, -1)"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        class="w-16 bg-transparent px-2 py-1 text-center text-slate-900 outline-none dark:text-slate-100"
                        [value]="item.quantity"
                        (change)="onQuantityChange(item.id, $any($event.target).value)"
                        min="1"
                        [max]="item.stock"
                      />
                      <button
                        type="button"
                        class="px-2 py-1 text-slate-700 hover:text-slate-900 disabled:opacity-50 dark:text-slate-200 dark:hover:text-slate-50"
                        [attr.aria-label]="'cart.increaseQty' | translate"
                        [disabled]="item.stock > 0 && item.quantity >= item.stock"
                        (click)="stepQuantity(item, 1)"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <span class="text-slate-600 dark:text-slate-300">
                    {{ item.price | localizedCurrency : item.currency }} {{ 'cart.each' | translate }}
                  </span>
                  <span class="font-semibold text-slate-900 dark:text-slate-50">
                    {{ item.price * item.quantity | localizedCurrency : item.currency }}
                  </span>
                </div>
                <p *ngIf="isMaxQuantity(item)" class="text-xs text-amber-700 dark:text-amber-300">{{ 'cart.maxQtyReached' | translate }}</p>
                <p *ngIf="itemErrors[item.id]" class="text-sm text-amber-700 dark:text-amber-300">{{ itemErrors[item.id] | translate }}</p>
                <div class="grid gap-1">
                  <label class="text-xs text-slate-500 dark:text-slate-400" [attr.for]="'note-' + item.id">{{ 'cart.noteLabel' | translate }}</label>
                  <textarea
                    class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    rows="2"
                    maxlength="255"
                    [id]="'note-' + item.id"
                    [name]="'note-' + item.id"
                    [placeholder]="'cart.notePlaceholder' | translate"
                    [ngModel]="itemNotes[item.id] ?? item.note ?? ''"
                    (ngModelChange)="itemNotes[item.id] = $event"
                    (blur)="saveNote(item.id)"
                  ></textarea>
                  <p *ngIf="itemNoteErrors[item.id]" class="text-xs text-amber-700 dark:text-amber-300">{{ itemNoteErrors[item.id] | translate }}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'cart.summary' | translate }}</h2>
          <div class="grid gap-3">
            <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
              <span>{{ 'cart.subtotal' | translate }}</span>
              <span>{{ quoteSubtotal() | localizedCurrency : currency }}</span>
            </div>
            <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200" *ngIf="quoteFee() > 0">
              <span>{{ 'checkout.additionalCost' | translate }}</span>
              <span>{{ quoteFee() | localizedCurrency : currency }}</span>
            </div>
            <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200" *ngIf="quoteTax() > 0">
              <span>{{ 'cart.tax' | translate }}</span>
              <span>{{ quoteTax() | localizedCurrency : currency }}</span>
            </div>
            <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
              <span>{{ 'cart.shipping' | translate }}</span>
              <span>{{ quoteShipping() | localizedCurrency : currency }}</span>
            </div>
            <div
              class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200"
              *ngIf="promoStatus === 'success' && quotePromoSavings() > 0"
            >
              <span>{{ 'checkout.promo' | translate }}</span>
              <span class="text-emerald-700 dark:text-emerald-300">-{{ quotePromoSavings() | localizedCurrency : currency }}</span>
            </div>
            <div class="border-t border-slate-200 pt-3 flex items-center justify-between text-base font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-50">
              <span>{{ 'cart.estimatedTotal' | translate }}</span>
              <span>{{ quoteTotal() | localizedCurrency : currency }}</span>
            </div>
          </div>

          <div class="grid gap-2">
            <div class="flex items-center justify-between gap-2">
              <label class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'checkout.step3' | translate }}</label>
              <button
                *ngIf="promoStatus === 'success' && promo"
                type="button"
                class="text-xs text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50"
                (click)="clearPromo()"
              >
                {{ 'cart.remove' | translate }}
              </button>
            </div>
            <div class="flex gap-2">
              <input
                type="text"
                class="flex-1 rounded-lg border px-3 py-2 text-sm bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                [class.border-amber-300]="promoStatus === 'warn'"
                [class.border-slate-200]="promoStatus !== 'warn'"
                [class.dark:border-amber-700]="promoStatus === 'warn'"
                [class.dark:border-slate-700]="promoStatus !== 'warn'"
                [placeholder]="'checkout.promoPlaceholder' | translate"
                [(ngModel)]="promo"
                [disabled]="!auth.isAuthenticated() || promoApplying"
              />
              <app-button
                size="sm"
                [label]="'checkout.apply' | translate"
                [disabled]="promoApplying || !auth.isAuthenticated() || !promo.trim()"
                (action)="applyPromo()"
              ></app-button>
            </div>
            <p *ngIf="!auth.isAuthenticated()" class="text-xs text-slate-600 dark:text-slate-300">
              {{ 'checkout.couponsLoginRequired' | translate }}
            </p>
            <p *ngIf="promoMessage" class="text-xs" [class.text-emerald-700]="promoStatus === 'success'" [class.text-amber-700]="promoStatus === 'warn'" [class.dark:text-emerald-300]="promoStatus === 'success'" [class.dark:text-amber-300]="promoStatus === 'warn'">
              {{ promoMessage }}
            </p>
          </div>
          <app-button
            [label]="'cart.checkout' | translate"
            [routerLink]="['/checkout']"
            [disabled]="!items().length"
          ></app-button>
          <app-button variant="ghost" [label]="'cart.continue' | translate" [routerLink]="['/shop']"></app-button>
        </aside>
      </div>
    </app-container>
  `
})
export class CartComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.cart' }
  ];
  skeletonRows = [0, 1, 2];
  itemErrors: Record<string, string> = {};
  itemNotes: Record<string, string> = {};
  itemNoteErrors: Record<string, string> = {};
  promo = '';
  promoMessage = '';
  promoStatus: 'success' | 'warn' | 'info' = 'info';
  promoValid = true;
  promoApplying = false;
  appliedCouponOffer: CouponOffer | null = null;
  private pendingPromoRefresh = false;

  constructor(
    private cart: CartStore,
    public auth: AuthService,
    private cartApi: CartApi,
    private coupons: CouponsService,
    private translate: TranslateService
  ) {
    effect(() => {
      if (this.cart.syncing()) return;
      if (!this.pendingPromoRefresh) return;
      if (this.promoStatus !== 'success') return;
      const code = (this.promo || '').trim().toUpperCase();
      if (!code) return;
      this.pendingPromoRefresh = false;
      this.refreshPromoQuote(code);
    });
  }

  ngOnInit(): void {
    this.cart.loadFromBackend();
  }

  items = this.cart.items;
  subtotal = this.cart.subtotal;
  quote = this.cart.quote;
  syncing = this.cart.syncing;

  get currency(): string {
    return this.quote().currency ?? this.items().find((i) => i.currency)?.currency ?? 'RON';
  }

  quoteSubtotal(): number {
    const q = this.quote();
    return Number.isFinite(q.subtotal) && q.subtotal > 0 ? q.subtotal : this.subtotal();
  }

  quoteFee(): number {
    return this.quote().fee ?? 0;
  }

  quoteTax(): number {
    return this.quote().tax ?? 0;
  }

  quoteShipping(): number {
    return this.quote().shipping ?? 0;
  }

  quoteTotal(): number {
    const q = this.quote();
    return Number.isFinite(q.total) && q.total > 0 ? q.total : this.subtotal();
  }

  quoteDiscount(): number {
    const q = this.quote();
    return Math.max(0, q.subtotal + q.fee + q.tax + q.shipping - q.total);
  }

  private couponShippingDiscount(): number {
    const offer = this.appliedCouponOffer;
    if (!offer || !offer.eligible) return 0;
    const currentCode = (this.promo || '').trim().toUpperCase();
    if (!currentCode || offer.coupon.code.toUpperCase() !== currentCode) return 0;
    return parseMoney(offer.estimated_shipping_discount_ron);
  }

  quotePromoSavings(): number {
    const discount = this.quoteDiscount();
    return Math.max(0, discount + this.couponShippingDiscount());
  }

  onQuantityChange(id: string, value: unknown): void {
    const item = this.items().find((i) => i.id === id);
    const stock = item?.stock ?? 0;
    let qty = Number(value);
    if (!Number.isFinite(qty)) return;
    qty = Math.floor(qty);
    if (qty < 1) qty = 1;
    if (stock > 0) qty = Math.min(qty, stock);
    const { errorKey } = this.cart.updateQuantity(id, qty);
    if (errorKey) {
      this.itemErrors[id] = errorKey;
      return;
    }
    delete this.itemErrors[id];
    if (this.promoStatus === 'success') this.pendingPromoRefresh = true;
  }

  stepQuantity(item: CartItem, delta: number): void {
    const next = item.quantity + delta;
    this.onQuantityChange(item.id, next);
  }

  isLowStock(item: CartItem): boolean {
    return item.stock > 0 && item.stock <= 3;
  }

  isMaxQuantity(item: CartItem): boolean {
    return item.stock > 0 && item.quantity >= item.stock;
  }

  remove(id: string): void {
    this.cart.remove(id);
    delete this.itemErrors[id];
    delete this.itemNotes[id];
    delete this.itemNoteErrors[id];
    if (this.promoStatus === 'success') this.pendingPromoRefresh = true;
  }

  clearCart(): void {
    if (!confirm(this.translate.instant('cart.confirmClear'))) return;
    this.cart.clear();
    this.itemErrors = {};
    this.itemNotes = {};
    this.itemNoteErrors = {};
    this.resetPromoState();
  }

  saveNote(id: string): void {
    const current = this.items().find((i) => i.id === id)?.note ?? '';
    const next = (this.itemNotes[id] ?? '').trim();
    if ((current ?? '') === next) return;
    const { errorKey } = this.cart.updateNote(id, next);
    if (errorKey) {
      this.itemNoteErrors[id] = errorKey;
      return;
    }
    delete this.itemNoteErrors[id];
    if (this.promoStatus === 'success') this.pendingPromoRefresh = true;
  }

  clearPromo(): void {
    this.resetPromoState();
    this.cart.loadFromBackend();
  }

  private resetPromoState(): void {
    this.promo = '';
    this.promoMessage = '';
    this.promoStatus = 'info';
    this.promoValid = true;
    this.appliedCouponOffer = null;
  }

  applyPromo(): void {
    const normalized = (this.promo || '').trim().toUpperCase();
    this.promo = normalized;
    this.promoValid = true;

    if (!normalized) {
      this.clearPromo();
      return;
    }

    if (!this.auth.isAuthenticated()) {
      this.appliedCouponOffer = null;
      this.promoStatus = 'warn';
      this.promoValid = false;
      this.promoMessage = this.translate.instant('checkout.couponsLoginRequired');
      this.promo = '';
      this.cart.loadFromBackend();
      return;
    }

    this.promoApplying = true;
    this.coupons.validate(normalized).subscribe({
      next: (offer) => {
        this.appliedCouponOffer = offer;
        if (!offer.eligible) {
          this.promoStatus = 'warn';
          this.promoValid = false;
          const reasons = this.describeCouponReasons(offer.reasons ?? []);
          this.promoMessage = `${this.translate.instant('checkout.couponNotEligible')}: ${reasons}`;
          this.promoApplying = false;
          this.cart.loadFromBackend();
          return;
        }
        this.promoStatus = 'success';
        this.promoMessage = this.translate.instant('checkout.promoApplied', { code: normalized });
        this.promoApplying = false;
        this.refreshPromoQuote(normalized);
      },
      error: (err) => {
        if (err?.status === 404) {
          this.appliedCouponOffer = null;
          this.promoStatus = 'success';
          this.promoMessage = this.translate.instant('checkout.promoApplied', { code: normalized });
          this.promoApplying = false;
          this.refreshPromoQuote(normalized);
          return;
        }

        this.appliedCouponOffer = null;
        this.promoStatus = 'warn';
        this.promoValid = false;
        this.promoMessage = err?.error?.detail || this.translate.instant('checkout.promoPending', { code: normalized });
        this.promoApplying = false;
        this.cart.loadFromBackend();
      }
    });
  }

  private refreshPromoQuote(code: string): void {
    this.cartApi.get({ promo_code: code }).subscribe({
      next: (res) => {
        this.cart.hydrateFromBackend(res);
      },
      error: (err) => {
        this.promoStatus = 'warn';
        this.promoValid = false;
        this.promoMessage = err?.error?.detail || this.translate.instant('checkout.promoPending', { code });
        this.appliedCouponOffer = null;
        this.cart.loadFromBackend();
      }
    });
  }

  private describeCouponReasons(reasons: string[]): string {
    if (!reasons || reasons.length === 0) {
      return this.translate.instant('checkout.couponNotEligible');
    }
    const labels = reasons.map((reason) => {
      const key = `checkout.couponReasons.${reason}`;
      const translated = this.translate.instant(key);
      return translated === key ? reason : translated;
    });
    return labels.join(' • ');
  }
}
