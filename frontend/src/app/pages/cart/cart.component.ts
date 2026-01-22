import { CommonModule } from '@angular/common';
import { Component, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
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
import { WishlistService } from '../../core/wishlist.service';
import { ToastService } from '../../core/toast.service';
import { CatalogService, Product } from '../../core/catalog.service';
import { ProductCardComponent } from '../../shared/product-card.component';
import { LockerProvider } from '../../core/shipping.service';
import { CheckoutDeliveryType, CheckoutPrefsService } from '../../core/checkout-prefs.service';

type SavedForLaterItem = {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
  name: string;
  slug: string;
  price: number;
  currency: string;
  image?: string;
  saved_at: string;
};

const SAVED_FOR_LATER_KEY = 'cart_saved_for_later';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ContainerComponent, ButtonComponent, BreadcrumbComponent, LocalizedCurrencyPipe, TranslateModule, ImgFallbackDirective, ProductCardComponent],
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
            <p class="text-sm text-slate-600 dark:text-slate-300">
              {{ (redirectedFromCheckout ? 'cart.emptyFromCheckout' : 'cart.emptyCopy') | translate }}
            </p>
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
	                  <div class="flex items-center gap-3">
	                    <button
	                      type="button"
	                      class="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-50"
	                      [disabled]="savingForLater[item.id]"
	                      (click)="saveForLater(item)"
	                    >
	                      {{ 'cart.saveForLater' | translate }}
	                    </button>
	                    <button
	                      *ngIf="auth.isAuthenticated()"
	                      type="button"
	                      class="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-50"
	                      [disabled]="movingToWishlist[item.id] || savingForLater[item.id]"
	                      (click)="moveToWishlist(item)"
	                    >
	                      {{ 'cart.moveToWishlist' | translate }}
	                    </button>
	                    <button
	                      type="button"
	                      class="text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50"
	                      [disabled]="savingForLater[item.id]"
	                      (click)="remove(item.id)"
	                    >
	                      {{ 'cart.remove' | translate }}
	                    </button>
	                  </div>
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
	              <span>{{ 'checkout.discount' | translate }}</span>
	              <span class="text-emerald-700 dark:text-emerald-300">{{ -quotePromoSavings() | localizedCurrency : currency }}</span>
	            </div>
	            <div class="border-t border-slate-200 pt-3 flex items-center justify-between text-base font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-50">
	              <span>{{ 'cart.estimatedTotal' | translate }}</span>
	              <span>{{ quoteTotal() | localizedCurrency : currency }}</span>
	            </div>
	          </div>

	          <div *ngIf="items().length" class="grid gap-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800/40 dark:text-slate-200">
	            <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'checkout.deliveryTitle' | translate }}</p>
	            <div class="grid gap-2">
	              <div class="grid grid-cols-2 gap-2">
	                <button
	                  type="button"
	                  class="rounded-xl border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
	                  [ngClass]="
	                    deliveryType === 'home'
	                      ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/30 dark:text-indigo-100'
	                      : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
	                  "
	                  (click)="setDeliveryType('home')"
	                  [attr.aria-pressed]="deliveryType === 'home'"
	                >
	                  {{ 'checkout.deliveryHome' | translate }}
	                </button>
	                <button
	                  type="button"
	                  class="rounded-xl border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
	                  [ngClass]="
	                    deliveryType === 'locker'
	                      ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/30 dark:text-indigo-100'
	                      : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
	                  "
	                  (click)="setDeliveryType('locker')"
	                  [attr.aria-pressed]="deliveryType === 'locker'"
	                >
	                  {{ 'checkout.deliveryLocker' | translate }}
	                </button>
	              </div>
	              <label class="grid gap-1 text-xs font-semibold text-slate-500 dark:text-slate-300">
	                {{ 'checkout.courier' | translate }}
	                <select
	                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                  name="courier"
	                  [(ngModel)]="courier"
	                  (ngModelChange)="onCourierChanged()"
	                >
	                  <option value="sameday">{{ 'checkout.courierSameday' | translate }}</option>
	                  <option value="fan_courier">{{ 'checkout.courierFanCourier' | translate }}</option>
	                </select>
	              </label>
	              <p *ngIf="deliveryEstimateKey()" class="text-xs text-slate-600 dark:text-slate-300">
	                {{ deliveryEstimateKey() | translate : deliveryEstimateParams() }}
	              </p>
	            </div>
	          </div>

	          <div *ngIf="items().length && freeShippingThreshold() !== null" class="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
	            <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'cart.freeShippingTitle' | translate }}</p>
	            <p *ngIf="freeShippingAppliedByCoupon()" class="text-sm text-emerald-700 dark:text-emerald-300">
	              {{ 'cart.freeShippingApplied' | translate }}
	            </p>
	            <ng-container *ngIf="!freeShippingAppliedByCoupon()">
	              <p *ngIf="freeShippingRemaining() !== null && freeShippingRemaining() > 0" class="text-sm">
	                {{ 'cart.freeShippingRemaining' | translate : { amount: (freeShippingRemaining() | localizedCurrency : currency) } }}
	              </p>
	              <p *ngIf="freeShippingRemaining() !== null && freeShippingRemaining() <= 0" class="text-sm text-emerald-700 dark:text-emerald-300">
	                {{ 'cart.freeShippingUnlocked' | translate }}
	              </p>
	              <div class="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
	                <div class="h-full bg-emerald-500" [style.width.%]="freeShippingProgressPct()"></div>
	              </div>
	              <div *ngIf="freeShippingRemaining() !== null && freeShippingRemaining() > 0 && suggestedAddOns().length" class="grid gap-1">
	                <p class="text-xs font-semibold text-slate-500 dark:text-slate-300">{{ 'cart.suggestedAddOns' | translate }}</p>
	                <a
	                  *ngFor="let p of suggestedAddOns()"
	                  [routerLink]="['/products', p.slug]"
	                  class="text-xs text-indigo-700 hover:underline dark:text-indigo-300"
	                >
	                  {{ p.name }} · {{ displayProductPrice(p) | localizedCurrency : p.currency }}
	                </a>
	              </div>
	            </ng-container>
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

	      <section *ngIf="savedForLater.length" class="grid gap-4">
	        <div class="flex items-center justify-between gap-3">
	          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'cart.savedForLaterTitle' | translate }}</h2>
	        </div>
	        <div class="grid gap-3">
	          <div
	            *ngFor="let saved of savedForLater"
	            class="flex flex-wrap items-start gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
	          >
	            <a [routerLink]="['/products', saved.slug]" class="shrink-0">
	              <img
	                [src]="saved.image || 'assets/placeholder/product-placeholder.svg'"
	                [alt]="saved.name"
	                class="h-24 w-24 rounded-xl object-cover border border-slate-100 dark:border-slate-800"
	                [appImgFallback]="'assets/placeholder/product-placeholder.svg'"
	              />
	            </a>
	            <div class="flex-1 grid gap-2">
	              <div class="flex items-start justify-between gap-3">
	                <div>
	                  <a
	                    [routerLink]="['/products', saved.slug]"
	                    class="font-semibold text-slate-900 dark:text-slate-50 hover:underline"
	                  >
	                    {{ saved.name }}
	                  </a>
	                  <p class="text-sm text-slate-600 dark:text-slate-300">
	                    {{ 'cart.qty' | translate }}: {{ saved.quantity }} · {{ saved.price | localizedCurrency : saved.currency }}
	                  </p>
	                </div>
	                <div class="flex items-center gap-3">
	                  <button
	                    type="button"
	                    class="text-sm text-indigo-700 hover:text-indigo-900 disabled:opacity-50 dark:text-indigo-300 dark:hover:text-indigo-200"
	                    [disabled]="restoringSaved[saveKey(saved)]"
	                    (click)="moveSavedToCart(saved)"
	                  >
	                    {{ 'cart.moveToCart' | translate }}
	                  </button>
	                  <button
	                    type="button"
	                    class="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-50"
	                    [disabled]="restoringSaved[saveKey(saved)]"
	                    (click)="removeSavedForLater(saved)"
	                  >
	                    {{ 'cart.remove' | translate }}
	                  </button>
	                </div>
	              </div>
	            </div>
	          </div>
	        </div>
	      </section>

	      <section *ngIf="items().length" class="grid gap-4">
	        <div class="flex items-center justify-between gap-3">
	          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'cart.recommendationsTitle' | translate }}</h2>
	          <a routerLink="/shop" class="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50">
	            {{ 'cart.recommendationsBrowse' | translate }}
	          </a>
	        </div>

        <div *ngIf="recommendationsLoading" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div
            *ngFor="let _ of skeletonRows"
            class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 animate-pulse dark:bg-slate-900 dark:border-slate-800"
          >
            <div class="aspect-square w-full rounded-xl bg-slate-100 dark:bg-slate-800"></div>
            <div class="h-4 w-2/3 rounded bg-slate-100 dark:bg-slate-800"></div>
            <div class="h-4 w-1/3 rounded bg-slate-100 dark:bg-slate-800"></div>
          </div>
        </div>

        <p *ngIf="recommendationsError" class="text-sm text-slate-600 dark:text-slate-300">{{ recommendationsError }}</p>

        <div *ngIf="!recommendationsLoading && recommendations.length" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <app-product-card *ngFor="let product of recommendations" [product]="product"></app-product-card>
        </div>
      </section>
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
  movingToWishlist: Record<string, boolean> = {};
  savingForLater: Record<string, boolean> = {};
  restoringSaved: Record<string, boolean> = {};
  promo = '';
  promoMessage = '';
  promoStatus: 'success' | 'warn' | 'info' = 'info';
  promoValid = true;
  promoApplying = false;
  appliedCouponOffer: CouponOffer | null = null;
  private pendingPromoRefresh = false;
  recommendations: Product[] = [];
  recommendationsLoading = false;
  recommendationsError = '';
  private recommendationsKey = '';
  courier: LockerProvider = 'sameday';
  deliveryType: CheckoutDeliveryType = 'home';
  savedForLater: SavedForLaterItem[] = [];
  redirectedFromCheckout = false;

  constructor(
    private cart: CartStore,
    public auth: AuthService,
    private cartApi: CartApi,
    private coupons: CouponsService,
    private wishlist: WishlistService,
    private toast: ToastService,
    private catalog: CatalogService,
    private checkoutPrefs: CheckoutPrefsService,
    private translate: TranslateService,
    private route: ActivatedRoute
  ) {
    const prefs = this.checkoutPrefs.loadDeliveryPrefs();
    this.courier = prefs.courier;
    this.deliveryType = prefs.deliveryType;
    this.savedForLater = this.loadSavedForLater();

    effect(() => {
      if (this.cart.syncing()) return;
      if (!this.pendingPromoRefresh) return;
      if (this.promoStatus !== 'success') return;
      const code = (this.promo || '').trim().toUpperCase();
      if (!code) return;
      this.pendingPromoRefresh = false;
      this.refreshPromoQuote(code);
    });

    effect(() => {
      const productIds = this.items()
        .map((i) => i.product_id)
        .filter(Boolean)
        .sort()
        .join(',');
      if (!productIds) {
        this.recommendations = [];
        this.recommendationsError = '';
        this.recommendationsLoading = false;
        this.recommendationsKey = '';
        return;
      }
      if (productIds === this.recommendationsKey) return;
      this.recommendationsKey = productIds;
      this.loadRecommendations(new Set(productIds.split(',')));
    });
  }

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      this.redirectedFromCheckout = params.get('from') === 'checkout';
    });
    this.cart.loadFromBackend();
    this.wishlist.ensureLoaded();
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

  freeShippingThreshold(): number | null {
    const threshold = this.quote().freeShippingThresholdRon;
    if (threshold === null) return null;
    if (!Number.isFinite(threshold) || threshold < 0) return null;
    return threshold;
  }

  freeShippingRemaining(): number | null {
    const threshold = this.freeShippingThreshold();
    if (threshold === null) return null;
    const taxable = Math.max(0, this.quoteSubtotal() - this.quoteDiscount());
    return Math.max(0, threshold - taxable);
  }

  freeShippingProgressPct(): number {
    const threshold = this.freeShippingThreshold();
    if (threshold === null) return 0;
    if (threshold <= 0) return 100;
    const taxable = Math.max(0, this.quoteSubtotal() - this.quoteDiscount());
    return Math.max(0, Math.min(100, (taxable / threshold) * 100));
  }

  suggestedAddOns(): Product[] {
    const remaining = this.freeShippingRemaining();
    if (remaining === null || remaining <= 0) return [];
    const sorted = [...(this.recommendations ?? [])].sort(
      (a, b) => this.displayProductPrice(a) - this.displayProductPrice(b)
    );
    const under = sorted.filter((p) => this.displayProductPrice(p) <= remaining);
    return (under.length ? under : sorted).slice(0, 2);
  }

  freeShippingAppliedByCoupon(): boolean {
    return this.couponShippingDiscount() > 0;
  }

  setDeliveryType(value: CheckoutDeliveryType): void {
    this.deliveryType = value;
    this.checkoutPrefs.saveDeliveryPrefs({ courier: this.courier, deliveryType: this.deliveryType });
  }

  onCourierChanged(): void {
    this.checkoutPrefs.saveDeliveryPrefs({ courier: this.courier, deliveryType: this.deliveryType });
  }

  deliveryEstimate(): { min: number; max: number } | null {
    const est: Record<LockerProvider, Record<CheckoutDeliveryType, { min: number; max: number }>> = {
      sameday: { home: { min: 1, max: 2 }, locker: { min: 1, max: 3 } },
      fan_courier: { home: { min: 1, max: 3 }, locker: { min: 2, max: 4 } }
    };
    return est[this.courier]?.[this.deliveryType] ?? null;
  }

  deliveryEstimateKey(): string | null {
    const est = this.deliveryEstimate();
    if (!est) return null;
    return est.min === est.max ? 'cart.deliveryEstimateSingle' : 'cart.deliveryEstimateRange';
  }

  deliveryEstimateParams(): Record<string, number> {
    const est = this.deliveryEstimate();
    if (!est) return {};
    return est.min === est.max ? { days: est.min } : { min: est.min, max: est.max };
  }

  displayProductPrice(product: Product): number {
    const sale = product?.sale_price;
    if (typeof sale === 'number' && Number.isFinite(sale) && sale < product.base_price) return sale;
    return product.base_price ?? 0;
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
    delete this.movingToWishlist[id];
    delete this.savingForLater[id];
    if (this.promoStatus === 'success') this.pendingPromoRefresh = true;
  }

  saveForLater(item: CartItem): void {
    if (!item?.id) return;
    if (this.savingForLater[item.id]) return;
    this.savingForLater[item.id] = true;
    this.cart.remove(item.id, {
      onSuccess: () => {
        this.addSavedForLater(item);
        delete this.savingForLater[item.id];
      },
      onError: () => {
        delete this.savingForLater[item.id];
        this.toast.error(this.translate.instant('cart.saveForLater'), this.translate.instant('cart.saveForLaterFailed'));
      }
    });
  }

  saveKey(item: Pick<SavedForLaterItem, 'product_id' | 'variant_id'>): string {
    return `${item.product_id}::${item.variant_id || ''}`;
  }

  moveSavedToCart(saved: SavedForLaterItem): void {
    const key = this.saveKey(saved);
    if (this.restoringSaved[key]) return;
    this.restoringSaved[key] = true;
    this.cartApi
      .addItem({
        product_id: saved.product_id,
        variant_id: saved.variant_id ?? undefined,
        quantity: saved.quantity
      })
      .subscribe({
        next: () => {
          this.removeSavedForLater(saved);
          this.cart.loadFromBackend();
          delete this.restoringSaved[key];
        },
        error: () => {
          delete this.restoringSaved[key];
          this.toast.error(this.translate.instant('cart.moveToCart'), this.translate.instant('cart.moveToCartFailed'));
        }
      });
  }

  removeSavedForLater(saved: SavedForLaterItem): void {
    const key = this.saveKey(saved);
    this.savedForLater = this.savedForLater.filter((item) => this.saveKey(item) !== key);
    this.persistSavedForLater();
    delete this.restoringSaved[key];
  }

  private addSavedForLater(item: CartItem): void {
    const key = this.saveKey({ product_id: item.product_id, variant_id: item.variant_id ?? null });
    const next: SavedForLaterItem[] = [];
    let merged = false;
    for (const existing of this.savedForLater) {
      if (this.saveKey(existing) === key) {
        next.push({
          ...existing,
          quantity: existing.quantity + item.quantity,
          saved_at: new Date().toISOString()
        });
        merged = true;
      } else {
        next.push(existing);
      }
    }
    if (!merged) {
      next.unshift({
        product_id: item.product_id,
        variant_id: item.variant_id ?? null,
        quantity: item.quantity,
        name: item.name,
        slug: item.slug,
        price: item.price,
        currency: item.currency,
        image: item.image,
        saved_at: new Date().toISOString()
      });
    }
    this.savedForLater = next.slice(0, 50);
    this.persistSavedForLater();
  }

  private loadSavedForLater(): SavedForLaterItem[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(SAVED_FOR_LATER_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as any;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((entry) => ({
          product_id: String(entry?.product_id || ''),
          variant_id: entry?.variant_id == null ? null : String(entry.variant_id),
          quantity: Math.max(1, Number(entry?.quantity || 1)),
          name: String(entry?.name || ''),
          slug: String(entry?.slug || ''),
          price: Number(entry?.price || 0),
          currency: String(entry?.currency || 'RON'),
          image: entry?.image ? String(entry.image) : '',
          saved_at: String(entry?.saved_at || '')
        }))
        .filter((entry) => entry.product_id && entry.slug && entry.name && Number.isFinite(entry.price));
    } catch {
      return [];
    }
  }

  private persistSavedForLater(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SAVED_FOR_LATER_KEY, JSON.stringify(this.savedForLater));
  }

  clearCart(): void {
    if (!confirm(this.translate.instant('cart.confirmClear'))) return;
    this.cart.clear();
    this.itemErrors = {};
    this.itemNotes = {};
    this.itemNoteErrors = {};
    this.movingToWishlist = {};
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

  moveToWishlist(item: CartItem): void {
    if (!this.auth.isAuthenticated()) return;
    const productId = item.product_id;
    if (!productId) return;

    if (this.wishlist.isWishlisted(productId)) {
      this.cart.remove(item.id);
      this.toast.info(this.translate.instant('wishlist.addedTitle'), this.translate.instant('wishlist.addedBody', { name: item.name }));
      return;
    }

    this.movingToWishlist[item.id] = true;
    this.wishlist.add(productId).subscribe({
      next: (product) => {
        this.wishlist.addLocal(product);
        this.cart.remove(item.id);
        this.toast.success(
          this.translate.instant('wishlist.addedTitle'),
          this.translate.instant('wishlist.addedBody', { name: item.name })
        );
        delete this.movingToWishlist[item.id];
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('cart.moveToWishlistFailed');
        this.toast.error(this.translate.instant('cart.moveToWishlist'), msg);
        delete this.movingToWishlist[item.id];
      }
    });
  }

  private loadRecommendations(cartProductIds: Set<string>): void {
    this.recommendationsLoading = true;
    this.recommendationsError = '';
    this.catalog.listProducts({ is_featured: true, limit: 12, sort: 'newest' }).subscribe({
      next: (res) => {
        const items = (res?.items ?? []).filter((p) => p?.id && !cartProductIds.has(p.id));
        this.recommendations = items.slice(0, 4);
        this.recommendationsLoading = false;
      },
      error: () => {
        this.recommendations = [];
        this.recommendationsLoading = false;
        this.recommendationsError = this.translate.instant('cart.recommendationsError');
      }
    });
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
