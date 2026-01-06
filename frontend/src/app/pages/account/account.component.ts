import { CommonModule } from '@angular/common';
import { Component, OnInit, AfterViewInit, OnDestroy, signal, ViewChild, ElementRef, effect, EffectRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { AddressFormComponent } from '../../shared/address-form.component';
import { ToastService } from '../../core/toast.service';
import { AuthService, AuthUser } from '../../core/auth.service';
import { AccountService, Address, Order, AddressCreateRequest } from '../../core/account.service';
import { forkJoin } from 'rxjs';
import { loadStripe, Stripe, StripeElements, StripeCardElement, StripeCardElementChangeEvent } from '@stripe/stripe-js';
import { ApiService } from '../../core/api.service';
import { appConfig } from '../../core/app-config';
import { WishlistService } from '../../core/wishlist.service';
import { ProductCardComponent } from '../../shared/product-card.component';
import { ThemeMode, ThemePreference, ThemeService } from '../../core/theme.service';
import { TranslateModule } from '@ngx-translate/core';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { LanguageService } from '../../core/language.service';
import { CartStore } from '../../core/cart.store';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TranslateModule,
    ContainerComponent,
    BreadcrumbComponent,
    ButtonComponent,
    LocalizedCurrencyPipe,
    AddressFormComponent,
    ProductCardComponent,
    SkeletonComponent
  ],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <ng-container *ngIf="!loading(); else loadingTpl">
        <div *ngIf="error()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
          {{ error() }}
        </div>
        <div class="grid gap-6" *ngIf="!error()">
        <div *ngIf="!emailVerified()" class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm grid gap-3 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          <div class="flex items-start justify-between gap-3">
            <span>Verify your email to secure your account and receive updates.</span>
            <app-button size="sm" variant="ghost" label="Resend link" (action)="resendVerification()"></app-button>
          </div>
          <form class="flex gap-2 items-center" (ngSubmit)="submitVerification()">
            <input
              [(ngModel)]="verificationToken"
              name="verificationToken"
              type="text"
              placeholder="Enter verification token"
              class="border border-amber-300 bg-white rounded-lg px-3 py-2 text-sm flex-1 text-slate-900 dark:border-amber-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
              required
            />
            <app-button size="sm" label="Confirm" type="submit"></app-button>
          </form>
          <p *ngIf="verificationStatus" class="text-xs text-amber-800 dark:text-amber-200">{{ verificationStatus }}</p>
        </div>
        <header class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <p class="text-sm text-slate-500 dark:text-slate-400">Signed in as</p>
            <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50 truncate">{{ profile()?.email || '...' }}</h1>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <app-button routerLink="/account/password" variant="ghost" label="Change password"></app-button>
            <app-button variant="ghost" label="Sign out" (action)="signOut()"></app-button>
          </div>
        </header>

        <section
          id="overview"
          class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Overview</h2>
            <span class="text-xs text-slate-500 dark:text-slate-400">Quick links</span>
          </div>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <a
              href="#orders"
              class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
            >
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Orders</p>
              <p class="mt-1 font-semibold text-slate-900 dark:text-slate-50">{{ lastOrderLabel() }}</p>
              <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">{{ lastOrderSubcopy() }}</p>
            </a>
            <a
              href="#addresses"
              class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
            >
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Addresses</p>
              <p class="mt-1 font-semibold text-slate-900 dark:text-slate-50">{{ defaultAddressLabel() }}</p>
              <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">{{ defaultAddressSubcopy() }}</p>
            </a>
            <a
              href="#wishlist"
              class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
            >
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Wishlist</p>
              <p class="mt-1 font-semibold text-slate-900 dark:text-slate-50">{{ wishlistCountLabel() }}</p>
              <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">Saved items ready for later.</p>
            </a>
            <a
              href="#notifications"
              class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
            >
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Notifications</p>
              <p class="mt-1 font-semibold text-slate-900 dark:text-slate-50">{{ notificationsLabel() }}</p>
              <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">Control email updates.</p>
            </a>
            <a
              href="#security"
              class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
            >
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Security</p>
              <p class="mt-1 font-semibold text-slate-900 dark:text-slate-50">{{ securityLabel() }}</p>
              <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">Password, Google link, verification.</p>
            </a>
          </div>
        </section>

        <section
          id="profile"
          class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div class="flex items-center justify-between">
            <div class="grid gap-1">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Profile</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                Profile completeness: {{ profileCompleteness().completed }}/{{ profileCompleteness().total }} ({{ profileCompleteness().percent }}%)
              </p>
            </div>
            <app-button size="sm" variant="ghost" label="Save" [disabled]="savingProfile" (action)="saveProfile()"></app-button>
          </div>
          <div class="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div class="h-2 rounded-full bg-indigo-600" [style.width.%]="profileCompleteness().percent"></div>
          </div>
          <div class="flex flex-col sm:flex-row sm:items-center gap-4">
            <img
              [src]="avatar || profile()?.avatar_url || placeholderAvatar"
              alt="avatar"
              class="h-16 w-16 rounded-full object-cover border border-slate-200 dark:border-slate-800"
            />
            <div class="flex flex-wrap items-center gap-3">
              <label class="text-sm text-indigo-600 font-medium cursor-pointer dark:text-indigo-300">
                Upload avatar
                <input type="file" class="hidden" accept="image/*" (change)="onAvatarChange($event)" />
              </label>
              <span class="text-xs text-slate-500 dark:text-slate-400">JPG/PNG/WebP up to 5MB</span>
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              Display name
              <input
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="profileName"
                autocomplete="name"
                [(ngModel)]="profileName"
              />
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              Phone
              <input
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="profilePhone"
                autocomplete="tel"
                placeholder="+40723204204"
                [(ngModel)]="profilePhone"
              />
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              Preferred language
              <select
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                name="profileLanguage"
                [(ngModel)]="profileLanguage"
              >
                <option value="en">EN</option>
                <option value="ro">RO</option>
              </select>
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              Theme
              <select
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                name="profileTheme"
                [(ngModel)]="profileThemePreference"
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </div>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            Session timeout: 30m. Your theme is saved on this device; language is saved to your profile when signed in.
          </p>
          <p *ngIf="profileError" class="text-sm text-rose-700 dark:text-rose-300">{{ profileError }}</p>
          <p *ngIf="profileSaved" class="text-sm text-emerald-700 dark:text-emerald-300">Saved.</p>
        </section>

        <section id="notifications" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'account.notifications.title' | translate }}</h2>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'account.notifications.save' | translate"
              [disabled]="savingNotifications"
              (action)="saveNotifications()"
            ></app-button>
          </div>
          <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
            <label class="flex items-center gap-2">
              <input type="checkbox" [(ngModel)]="notifyBlogCommentReplies" />
              <span>{{ 'account.notifications.replyLabel' | translate }}</span>
            </label>
            <label *ngIf="isAdmin()" class="flex items-center gap-2">
              <input type="checkbox" [(ngModel)]="notifyBlogComments" />
              <span>{{ 'account.notifications.adminLabel' | translate }}</span>
            </label>
            <span *ngIf="notificationsMessage" class="text-xs text-emerald-700 dark:text-emerald-300">{{
              notificationsMessage | translate
            }}</span>
            <span *ngIf="notificationsError" class="text-xs text-rose-700 dark:text-rose-300">{{
              notificationsError | translate
            }}</span>
          </div>
        </section>

        <section id="security" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Connected accounts</h2>
            <span
              class="text-xs rounded-full px-2 py-1"
              [ngClass]="googleEmail() ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'"
            >
              {{ googleEmail() ? 'Google linked' : 'Not linked' }}
            </span>
          </div>
          <div class="flex items-center gap-3 text-sm">
            <img
              *ngIf="googlePicture()"
              [src]="googlePicture()"
              alt="Google profile"
              class="h-10 w-10 rounded-full border border-slate-200 dark:border-slate-700 object-cover"
            />
            <div>
              <p class="font-semibold text-slate-900 dark:text-slate-50">Google</p>
              <p class="text-slate-600 dark:text-slate-300">{{ googleEmail() || 'No Google account linked' }}</p>
            </div>
            <div class="flex gap-2 ml-auto">
              <app-button size="sm" variant="ghost" label="Link Google" *ngIf="!googleEmail()" (action)="linkGoogle()"></app-button>
              <app-button size="sm" variant="ghost" label="Unlink" *ngIf="googleEmail()" (action)="unlinkGoogle()"></app-button>
            </div>
          </div>
        </section>

        <section id="addresses" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Addresses</h2>
            <app-button size="sm" variant="ghost" label="Add address" (action)="openAddressForm()"></app-button>
          </div>
          <div *ngIf="showAddressForm" class="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <app-address-form
              [model]="addressModel"
              (save)="saveAddress($event)"
              (cancel)="closeAddressForm()"
            ></app-address-form>
          </div>
          <div *ngIf="addresses().length === 0 && !showAddressForm" class="text-sm text-slate-700 dark:text-slate-200">No addresses yet.</div>
          <div *ngFor="let addr of addresses()" class="rounded-lg border border-slate-200 p-3 grid gap-1 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-slate-900 dark:text-slate-50">{{ addr.label || 'Address' }}</span>
              <div class="flex items-center gap-2 text-xs">
                <span *ngIf="addr.is_default_shipping" class="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">Default shipping</span>
                <span *ngIf="addr.is_default_billing" class="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">Default billing</span>
              </div>
              <div class="flex flex-wrap gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  label="Default shipping"
                  *ngIf="!addr.is_default_shipping"
                  (action)="setDefaultShipping(addr)"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  label="Default billing"
                  *ngIf="!addr.is_default_billing"
                  (action)="setDefaultBilling(addr)"
                ></app-button>
                <app-button size="sm" variant="ghost" label="Edit" (action)="editAddress(addr)"></app-button>
                <app-button size="sm" variant="ghost" label="Remove" (action)="removeAddress(addr.id)"></app-button>
              </div>
            </div>
            <span>{{ addr.line1 }}<ng-container *ngIf="addr.line2">, {{ addr.line2 }}</ng-container></span>
            <span>{{ addr.city }}<ng-container *ngIf="addr.region">, {{ addr.region }}</ng-container>, {{ addr.postal_code }}</span>
            <span>{{ addr.country }}</span>
          </div>
        </section>

        <section id="orders" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Orders</h2>
            <a routerLink="/shop" class="text-sm text-indigo-600 dark:text-indigo-300 font-medium">Shop new items</a>
          </div>

          <div class="flex flex-wrap items-center gap-3 text-sm">
            <label class="flex items-center gap-2">
              <span class="text-slate-600 dark:text-slate-300">Status</span>
              <select
                class="rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="orderFilter"
                (change)="filterOrders()"
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="shipped">Shipped</option>
                <option value="cancelled">Cancelled</option>
                <option value="refunded">Refunded</option>
              </select>
            </label>
          </div>

          <div
            *ngIf="pagedOrders().length === 0"
            class="border border-dashed border-slate-200 rounded-xl p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300 grid gap-2"
          >
            <p>No orders yet.</p>
            <a routerLink="/shop" class="text-indigo-600 dark:text-indigo-300 font-medium">Browse products</a>
          </div>

          <details
            *ngFor="let order of pagedOrders()"
            class="rounded-lg border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200"
          >
            <summary
              class="flex items-start justify-between gap-4 cursor-pointer select-none [&::-webkit-details-marker]:hidden"
            >
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold text-slate-900 dark:text-slate-50">Order #{{ order.reference_code || order.id }}</span>
                  <span class="text-xs rounded-full px-2 py-1" [ngClass]="orderStatusChipClass(order.status)">{{ order.status }}</span>
                </div>
                <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {{ order.created_at | date: 'mediumDate' }} · {{ order.items.length }} item{{ order.items.length === 1 ? '' : 's' }}
                </p>
              </div>
              <div class="text-right">
                <p class="font-semibold text-slate-900 dark:text-slate-50">{{ order.total_amount | localizedCurrency : order.currency || 'USD' }}</p>
                <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">Updated {{ order.updated_at | date: 'mediumDate' }}</p>
              </div>
            </summary>

            <div class="mt-4 grid gap-4">
              <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-slate-500 dark:text-slate-400">Tracking</span>
                  <a
                    *ngIf="order.tracking_number"
                    class="text-indigo-600 dark:text-indigo-300 font-medium"
                    [href]="trackingUrl(order.tracking_number)"
                    target="_blank"
                    rel="noopener"
                    >{{ order.tracking_number }}</a
                  >
                  <span *ngIf="!order.tracking_number" class="text-slate-600 dark:text-slate-300">Not available</span>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-slate-500 dark:text-slate-400">Shipping</span>
                  <span>{{ order.shipping_method?.name || '—' }}</span>
                </div>
              </div>

              <div class="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Items</p>
                <div class="mt-2 grid gap-2">
                  <div *ngFor="let item of order.items" class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                      <a
                        *ngIf="item.product?.slug"
                        [routerLink]="['/products', item.product.slug]"
                        class="font-medium text-slate-900 dark:text-slate-50 hover:underline"
                        >{{ item.product?.name }}</a
                      >
                      <p *ngIf="!item.product?.slug" class="font-medium text-slate-900 dark:text-slate-50 truncate">
                        {{ item.product?.name || item.product_id }}
                      </p>
                      <p class="text-xs text-slate-500 dark:text-slate-400">Qty {{ item.quantity }}</p>
                    </div>
                    <div class="text-right text-sm font-medium text-slate-900 dark:text-slate-50">
                      {{ item.subtotal | localizedCurrency : order.currency || 'USD' }}
                    </div>
                  </div>
                </div>
              </div>

              <div class="grid gap-4 sm:grid-cols-2">
                <div class="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                  <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Totals</p>
                  <div class="mt-2 grid gap-1 text-slate-700 dark:text-slate-200">
                    <div class="flex items-center justify-between">
                      <span class="text-slate-500 dark:text-slate-400">Tax</span>
                      <span>{{ (order.tax_amount || 0) | localizedCurrency : order.currency || 'USD' }}</span>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-slate-500 dark:text-slate-400">Shipping</span>
                      <span>{{ (order.shipping_amount || 0) | localizedCurrency : order.currency || 'USD' }}</span>
                    </div>
                    <div class="flex items-center justify-between font-semibold text-slate-900 dark:text-slate-50 pt-1">
                      <span>Total</span>
                      <span>{{ order.total_amount | localizedCurrency : order.currency || 'USD' }}</span>
                    </div>
                  </div>
                </div>

                <div class="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                  <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Actions</p>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <app-button
                      size="sm"
                      variant="ghost"
                      label="Reorder"
                      [disabled]="reorderingOrderId === order.id"
                      (action)="reorder(order)"
                    ></app-button>
                    <app-button
                      size="sm"
                      variant="ghost"
                      label="Receipt (PDF)"
                      [disabled]="downloadingReceiptId === order.id"
                      (action)="downloadReceipt(order)"
                    ></app-button>
                  </div>
                </div>
              </div>
            </div>
          </details>

          <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200" *ngIf="pagedOrders().length">
            <span>Page {{ page }} / {{ totalPages }}</span>
            <div class="flex gap-2">
              <app-button size="sm" variant="ghost" label="Prev" [disabled]="page === 1" (action)="prevPage()"></app-button>
              <app-button size="sm" variant="ghost" label="Next" [disabled]="page === totalPages" (action)="nextPage()"></app-button>
            </div>
          </div>
        </section>

		        <section id="wishlist" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
		          <div class="flex items-center justify-between">
		            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Wishlist</h2>
		            <a routerLink="/shop" class="text-sm text-indigo-600 dark:text-indigo-300 font-medium">Browse products</a>
		          </div>
		          <div
		            *ngIf="wishlist.items().length === 0"
		            class="border border-dashed border-slate-200 rounded-xl p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"
		          >
		            No saved items yet.
		          </div>
		          <div *ngIf="wishlist.items().length" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
		            <app-product-card *ngFor="let item of wishlist.items()" [product]="item"></app-product-card>
		          </div>
		        </section>

		        <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
		          <div class="flex items-center justify-between">
		            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Payment methods</h2>
		            <div class="flex gap-2 items-center">
              <app-button size="sm" variant="ghost" label="Add card" (action)="addCard()"></app-button>
              <app-button size="sm" label="Save card" (action)="confirmCard()" [disabled]="!cardReady || savingCard"></app-button>
            </div>
          </div>
          <div *ngIf="paymentMethods.length === 0" class="text-sm text-slate-700 dark:text-slate-200">No cards saved yet.</div>
          <div class="border border-dashed border-slate-200 rounded-lg p-3 text-sm dark:border-slate-700" *ngIf="cardElementVisible">
            <p class="text-slate-600 dark:text-slate-300 mb-2">Enter card details:</p>
            <div #cardHost id="card-element" class="min-h-[48px]"></div>
            <p *ngIf="cardError" class="text-rose-700 dark:text-rose-300 text-xs mt-2">{{ cardError }}</p>
          </div>
          <div *ngFor="let pm of paymentMethods" class="flex items-center justify-between text-sm border border-slate-200 rounded-lg p-3 dark:border-slate-700">
            <div class="flex items-center gap-2">
              <span class="font-semibold">{{ pm.brand || 'Card' }}</span>
              <span *ngIf="pm.last4">•••• {{ pm.last4 }}</span>
              <span *ngIf="pm.exp_month && pm.exp_year">(exp {{ pm.exp_month }}/{{ pm.exp_year }})</span>
            </div>
            <app-button size="sm" variant="ghost" label="Remove" (action)="removePaymentMethod(pm.id)"></app-button>
          </div>
        </section>

	        <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Session</h2>
	          <p class="text-sm text-slate-700 dark:text-slate-200">
	            You will be logged out after inactivity to keep your account safe. <a class="text-indigo-600 dark:text-indigo-300" (click)="signOut()">Logout now</a>.
	          </p>
	          <div class="flex gap-2">
	            <app-button size="sm" variant="ghost" label="Refresh session" (action)="refreshSession()"></app-button>
	          </div>
	        </section>
      </div>
      </ng-container>
      <ng-template #loadingTpl>
        <div class="grid gap-4">
          <app-skeleton height="28px" width="40%"></app-skeleton>
          <app-skeleton height="140px"></app-skeleton>
          <app-skeleton height="140px"></app-skeleton>
        </div>
      </ng-template>
    </app-container>
  `
})
export class AccountComponent implements OnInit, AfterViewInit, OnDestroy {
  crumbs = [
    { label: 'Home', url: '/' },
    { label: 'Account' }
  ];

  emailVerified = signal<boolean>(false);
  addresses = signal<Address[]>([]);
  avatar: string | null = null;
  placeholderAvatar = 'https://via.placeholder.com/120?text=Avatar';
  verificationToken = '';
  verificationStatus: string | null = null;

  profile = signal<AuthUser | null>(null);
  googleEmail = signal<string | null>(null);
  googlePicture = signal<string | null>(null);
  orders = signal<Order[]>([]);
  orderFilter = '';
  page = 1;
  pageSize = 5;
  totalPages = 1;
  loading = signal<boolean>(true);
  error = signal<string | null>(null);

  paymentMethods: any[] = [];
  cardElementVisible = false;
  savingCard = false;
  cardReady = false;
  cardError: string | null = null;
  private stripe: Stripe | null = null;
  private elements?: StripeElements;
  private card?: StripeCardElement;
  private clientSecret: string | null = null;
  @ViewChild('cardHost') cardElementRef?: ElementRef<HTMLDivElement>;
  private stripeThemeEffect?: EffectRef;
  showAddressForm = false;
  editingAddressId: string | null = null;
  addressModel: AddressCreateRequest = {
    line1: '',
    city: '',
    postal_code: '',
    country: 'US'
  };
  private idleTimer?: any;
  private readonly handleUserActivity = () => this.resetIdleTimer();
  idleWarning = signal<string | null>(null);
  notifyBlogComments = false;
  notifyBlogCommentReplies = false;
  savingNotifications = false;
  notificationsMessage: string | null = null;
  notificationsError: string | null = null;
  notifyMarketing = false;
  savingProfile = false;
  profileSaved = false;
  profileError: string | null = null;
  profileName = '';
  profilePhone = '';
  profileLanguage: 'en' | 'ro' = 'en';
  profileThemePreference: ThemePreference = 'system';
  reorderingOrderId: string | null = null;
  downloadingReceiptId: string | null = null;

  constructor(
    private toast: ToastService,
    private auth: AuthService,
    private account: AccountService,
    private cart: CartStore,
    private router: Router,
    private api: ApiService,
    public wishlist: WishlistService,
    private theme: ThemeService,
    private lang: LanguageService
  ) {
    this.computeTotalPages();
    this.stripeThemeEffect = effect(() => {
      const mode = this.theme.mode()();
      if (this.card) {
        this.card.update({ style: this.buildStripeCardStyle(mode) });
      }
    });
  }

  ngOnInit(): void {
    this.wishlist.refresh();
    this.loadData();
    this.loadPaymentMethods();
    this.resetIdleTimer();
    window.addEventListener('mousemove', this.handleUserActivity);
    window.addEventListener('keydown', this.handleUserActivity);
  }

  async ngAfterViewInit(): Promise<void> {
    await this.setupStripe();
  }

  private loadData(): void {
    this.loading.set(true);
    forkJoin({
      profile: this.account.getProfile(),
      addresses: this.account.getAddresses(),
      orders: this.account.getOrders()
    }).subscribe({
      next: ({ profile, addresses, orders }) => {
        this.profile.set(profile);
        this.googleEmail.set(profile.google_email ?? null);
        this.googlePicture.set(profile.google_picture_url ?? null);
        this.emailVerified.set(Boolean(profile?.email_verified));
        this.notifyBlogComments = Boolean(profile?.notify_blog_comments);
        this.notifyBlogCommentReplies = Boolean(profile?.notify_blog_comment_replies);
        this.notifyMarketing = Boolean(profile?.notify_marketing);
        this.addresses.set(addresses);
        this.orders.set(orders);
        this.avatar = profile.avatar_url ?? null;
        this.profileName = profile.name ?? '';
        this.profilePhone = profile.phone ?? '';
        this.profileLanguage = (profile.preferred_language === 'ro' ? 'ro' : 'en') as 'en' | 'ro';
        this.profileThemePreference = (this.theme.preference()() ?? 'system') as ThemePreference;
        this.computeTotalPages();
      },
      error: () => {
        this.error.set('Unable to load account details right now.');
      },
      complete: () => this.loading.set(false)
    });
  }

  private filteredOrders() {
    const f = this.orderFilter;
    return this.orders().filter((o) => (f ? o.status === f : true));
  }

  pagedOrders = () => {
    const filtered = this.filteredOrders();
    this.computeTotalPages(filtered.length);
    const start = (this.page - 1) * this.pageSize;
    return filtered.slice(start, start + this.pageSize);
  };

  filterOrders(): void {
    this.page = 1;
  }

  nextPage(): void {
    if (this.page < this.totalPages) this.page += 1;
  }

  prevPage(): void {
    if (this.page > 1) this.page -= 1;
  }

  orderStatusChipClass(status: string): string {
    const styles: Record<string, string> = {
      pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
      paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100',
      shipped: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-100',
      cancelled: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-100',
      refunded: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
    };
    return styles[status] || styles['refunded'];
  }

  trackingUrl(trackingNumber: string): string {
    const trimmed = (trackingNumber || '').trim();
    if (!trimmed) return '';
    return `https://t.17track.net/en#nums=${encodeURIComponent(trimmed)}`;
  }

  reorder(order: Order): void {
    if (this.reorderingOrderId) return;
    this.reorderingOrderId = order.id;
    this.account.reorderOrder(order.id).subscribe({
      next: () => {
        this.cart.loadFromBackend();
        this.toast.success('Added items to cart');
        void this.router.navigateByUrl('/cart');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not reorder.';
        this.toast.error(message);
      },
      complete: () => (this.reorderingOrderId = null)
    });
  }

  downloadReceipt(order: Order): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (this.downloadingReceiptId) return;
    this.downloadingReceiptId = order.id;
    this.account.downloadReceipt(order.id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `receipt-${order.reference_code || order.id}.pdf`;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not download receipt.';
        this.toast.error(message);
      },
      complete: () => (this.downloadingReceiptId = null)
    });
  }

  openAddressForm(existing?: Address): void {
    this.showAddressForm = true;
    this.editingAddressId = existing?.id ?? null;
    this.addressModel = {
      line1: existing?.line1 || '',
      line2: existing?.line2 || '',
      city: existing?.city || '',
      region: existing?.region || '',
      postal_code: existing?.postal_code || '',
      country: existing?.country || 'US',
      label: existing?.label || 'Home',
      is_default_shipping: existing?.is_default_shipping,
      is_default_billing: existing?.is_default_billing
    };
  }

  closeAddressForm(): void {
    this.showAddressForm = false;
    this.editingAddressId = null;
  }

  saveAddress(payload: AddressCreateRequest): void {
    if (this.editingAddressId) {
      this.account.updateAddress(this.editingAddressId, payload).subscribe({
        next: (addr) => {
          this.toast.success('Address updated');
          this.upsertAddress(addr);
          this.closeAddressForm();
        },
        error: (err) => this.toast.error(err?.error?.detail || 'Could not update address.')
      });
    } else {
      this.account.createAddress(payload).subscribe({
        next: (addr) => {
          this.toast.success('Address added');
          this.upsertAddress(addr);
          this.closeAddressForm();
        },
        error: (err) => this.toast.error(err?.error?.detail || 'Could not add address.')
      });
    }
  }

  editAddress(addr: Address): void {
    this.openAddressForm(addr);
  }

  removeAddress(id: string): void {
    if (!confirm('Remove this address?')) return;
    this.account.deleteAddress(id).subscribe({
      next: () => {
        this.toast.success('Address removed');
        this.addresses.set(this.addresses().filter((a) => a.id !== id));
      },
      error: () => this.toast.error('Could not remove address.')
    });
  }

  setDefaultShipping(addr: Address): void {
    this.account.updateAddress(addr.id, { is_default_shipping: true }).subscribe({
      next: (updated) => {
        this.upsertAddress(updated);
        this.toast.success('Default shipping updated');
      },
      error: (err) => this.toast.error(err?.error?.detail || 'Could not update default shipping.')
    });
  }

  setDefaultBilling(addr: Address): void {
    this.account.updateAddress(addr.id, { is_default_billing: true }).subscribe({
      next: (updated) => {
        this.upsertAddress(updated);
        this.toast.success('Default billing updated');
      },
      error: (err) => this.toast.error(err?.error?.detail || 'Could not update default billing.')
    });
  }

  private upsertAddress(next: Address): void {
    const current = this.addresses();
    const exists = current.some((a) => a.id === next.id);
    const merged = exists ? current.map((a) => (a.id === next.id ? next : a)) : [...current, next];

    const normalized = merged.map((a) => ({
      ...a,
      is_default_shipping: next.is_default_shipping ? a.id === next.id : a.is_default_shipping,
      is_default_billing: next.is_default_billing ? a.id === next.id : a.is_default_billing
    }));

    this.addresses.set(normalized);
  }

  addCard(): void {
    this.cardError = null;
    this.savingCard = false;
    this.cardElementVisible = true;
    this.createSetupIntent();
    setTimeout(() => this.mountCardElement(), 0);
  }

  resendVerification(): void {
    this.auth.requestEmailVerification().subscribe({
      next: () => {
        this.verificationStatus = 'Verification email sent. Enter the token you received.';
        this.toast.success('Verification email sent');
      },
      error: () => this.toast.error('Could not send verification email')
    });
  }

  submitVerification(): void {
    if (!this.verificationToken) {
      this.verificationStatus = 'Enter a verification token.';
      return;
    }
    this.auth.confirmEmailVerification(this.verificationToken).subscribe({
      next: (res) => {
        this.emailVerified.set(res.email_verified);
        this.verificationStatus = 'Email verified';
        this.toast.success('Email verified');
        this.verificationToken = '';
      },
      error: () => {
        this.verificationStatus = 'Invalid or expired token';
        this.toast.error('Invalid or expired token');
      }
    });
  }

  onAvatarChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    this.api.post<{ avatar_url?: string }>('/auth/me/avatar', formData).subscribe({
      next: (res) => {
        this.avatar = res.avatar_url || null;
        this.toast.success('Avatar updated');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not upload avatar.';
        this.toast.error(message);
      }
    });
  }

  refreshSession(): void {
    this.auth.refresh().subscribe({
      next: (tokens) => {
        if (tokens) {
          this.toast.success('Session refreshed');
          this.resetIdleTimer();
        } else {
          this.toast.error('No refresh token available');
        }
      },
      error: () => this.toast.error('Could not refresh session.')
    });
  }

  signOut(): void {
    this.auth.logout().subscribe(() => {
      this.wishlist.clear();
      this.toast.success('Signed out');
      void this.router.navigateByUrl('/');
    });
  }

  isAdmin(): boolean {
    return this.auth.role() === 'admin' || this.profile()?.role === 'admin';
  }

  profileCompleteness(): { completed: number; total: number; percent: number } {
    const total = 5;
    let completed = 0;

    if (this.profileName.trim()) completed += 1;
    if (this.profilePhone.trim()) completed += 1;
    if (this.avatar || this.profile()?.avatar_url) completed += 1;
    if (this.profileLanguage === 'en' || this.profileLanguage === 'ro') completed += 1;
    if (this.emailVerified()) completed += 1;

    return {
      completed,
      total,
      percent: Math.round((completed / total) * 100)
    };
  }

  saveProfile(): void {
    if (!this.auth.isAuthenticated()) return;
    this.savingProfile = true;
    this.profileSaved = false;
    this.profileError = null;

    const name = this.profileName.trim();
    const phone = this.profilePhone.trim();
    const payload = {
      name: name ? name : null,
      phone: phone ? phone : null,
      preferred_language: this.profileLanguage
    };

    this.theme.setPreference(this.profileThemePreference);
    this.lang.setLanguage(this.profileLanguage, { syncBackend: false });

    this.auth.updateProfile(payload).subscribe({
      next: (user) => {
        this.profile.set(user);
        this.profileName = user.name ?? '';
        this.profilePhone = user.phone ?? '';
        this.profileLanguage = (user.preferred_language === 'ro' ? 'ro' : 'en') as 'en' | 'ro';
        this.avatar = user.avatar_url ?? this.avatar;
        this.profileSaved = true;
        this.toast.success('Profile saved');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not save profile.';
        this.profileError = message;
        this.toast.error(message);
      },
      complete: () => (this.savingProfile = false)
    });
  }

  lastOrderLabel(): string {
    const order = this.lastOrder();
    if (!order) return 'No orders yet';
    return `#${order.reference_code || order.id} · ${order.status}`;
  }

  lastOrderSubcopy(): string {
    const order = this.lastOrder();
    if (!order) return 'Your recent orders will appear here.';
    const when = order.created_at ? new Date(order.created_at).toLocaleDateString() : '';
    return `${this.formatMoney(order.total_amount, order.currency)}${when ? ` · ${when}` : ''}`;
  }

  defaultAddressLabel(): string {
    const addr = this.defaultShippingAddress();
    if (!addr) return 'No addresses yet';
    return addr.label || 'Default shipping';
  }

  defaultAddressSubcopy(): string {
    const addr = this.defaultShippingAddress();
    if (!addr) return 'Add a shipping address for faster checkout.';
    const line = [addr.line1, addr.city].filter(Boolean).join(', ');
    return line || 'Saved address';
  }

  wishlistCountLabel(): string {
    const count = this.wishlist.items().length;
    return `${count} saved item${count === 1 ? '' : 's'}`;
  }

  notificationsLabel(): string {
    const enabled = [this.notifyBlogCommentReplies, this.notifyBlogComments, this.notifyMarketing].filter(Boolean).length;
    return enabled ? `${enabled} enabled` : 'All off';
  }

  securityLabel(): string {
    const verified = this.emailVerified() ? 'Email verified' : 'Email unverified';
    const google = this.googleEmail() ? 'Google linked' : 'Google unlinked';
    return `${verified} · ${google}`;
  }

  saveNotifications(): void {
    if (!this.auth.isAuthenticated()) return;
    this.savingNotifications = true;
    this.notificationsMessage = null;
    this.notificationsError = null;
    this.auth
      .updateNotificationPreferences({
        notify_blog_comments: this.notifyBlogComments,
        notify_blog_comment_replies: this.notifyBlogCommentReplies
      })
      .subscribe({
        next: (user) => {
          this.profile.set(user);
          this.notifyBlogComments = Boolean(user?.notify_blog_comments);
          this.notifyBlogCommentReplies = Boolean(user?.notify_blog_comment_replies);
          this.notificationsMessage = 'account.notifications.saved';
        },
        error: () => {
          this.notificationsError = 'account.notifications.saveError';
          this.savingNotifications = false;
        },
        complete: () => (this.savingNotifications = false)
      });
  }

  private computeTotalPages(total?: number): void {
    const count = total ?? this.filteredOrders().length;
    this.totalPages = Math.max(1, Math.ceil(count / this.pageSize));
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleWarning.set(null);
    this.idleTimer = setTimeout(() => {
      this.idleWarning.set('You have been logged out due to inactivity.');
      this.signOut();
    }, 30 * 60 * 1000); // 30 minutes
  }

  ngOnDestroy(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    if (this.card) {
      this.card.destroy();
    }
    this.stripeThemeEffect?.destroy();
    window.removeEventListener('mousemove', this.handleUserActivity);
    window.removeEventListener('keydown', this.handleUserActivity);
  }

  private async setupStripe(): Promise<void> {
    if (this.stripe) return;
    const publishableKey = this.getStripePublishableKey();
    if (!publishableKey) {
      this.cardError = 'Stripe publishable key is not configured';
      return;
    }
    this.stripe = await loadStripe(publishableKey);
    if (!this.stripe) {
      this.cardError = 'Could not initialize Stripe.';
      return;
    }
    this.elements = this.stripe.elements();
    this.card = this.elements.create('card', { style: this.buildStripeCardStyle(this.theme.mode()()) });
    this.mountCardElement();
  }

  private buildStripeCardStyle(mode: ThemeMode) {
    const base =
      mode === 'dark'
        ? {
            color: '#f8fafc',
            iconColor: '#f8fafc',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '16px',
            '::placeholder': { color: '#94a3b8' }
          }
        : {
            color: '#0f172a',
            iconColor: '#0f172a',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '16px',
            '::placeholder': { color: '#64748b' }
          };
    return {
      base,
      invalid: {
        color: mode === 'dark' ? '#fca5a5' : '#b91c1c'
      }
    };
  }

  private getStripePublishableKey(): string | null {
    return appConfig.stripePublishableKey || null;
  }

  private createSetupIntent(): void {
    this.api.post<{ client_secret: string; customer_id: string }>('/payment-methods/setup-intent', {}).subscribe({
      next: (res) => {
        this.clientSecret = res.client_secret;
      },
      error: () => {
        this.cardError = 'Could not start card setup';
        this.toast.error('Could not start card setup');
      }
    });
  }

  private mountCardElement(): void {
    if (!this.card || !this.cardElementRef) return;
    this.card.mount(this.cardElementRef.nativeElement);
    this.cardReady = true;
    this.card.on('change', (event: StripeCardElementChangeEvent) => {
      this.cardError = event.error ? event.error.message ?? 'Card error' : null;
    });
  }

  async confirmCard(): Promise<void> {
    if (!this.stripe || !this.card || !this.clientSecret) {
      this.cardError = 'Card form is not ready.';
      return;
    }
    this.savingCard = true;
    const result = await this.stripe.confirmCardSetup(this.clientSecret, {
      payment_method: { card: this.card }
    });
    if (result.error) {
      this.cardError = result.error.message ?? 'Could not save card';
      this.savingCard = false;
      return;
    }
    const pmId = result.setupIntent?.payment_method;
    if (!pmId) {
      this.cardError = 'Payment method missing from setup intent.';
      this.savingCard = false;
      return;
    }
    this.api.post('/payment-methods/attach', { payment_method_id: pmId }).subscribe({
      next: () => {
        this.toast.success('Card saved');
        this.loadPaymentMethods();
        this.cardError = null;
        this.clientSecret = null;
        this.savingCard = false;
      },
      error: () => {
        this.cardError = 'Could not attach payment method';
        this.savingCard = false;
      }
    });
  }

  private loadPaymentMethods(): void {
    this.api.get<any[]>('/payment-methods').subscribe({
      next: (methods) => (this.paymentMethods = methods),
      error: () => (this.paymentMethods = [])
    });
  }

  removePaymentMethod(id: string): void {
    if (!confirm('Remove this payment method?')) return;
    this.api.delete(`/payment-methods/${id}`).subscribe({
      next: () => {
        this.toast.success('Payment method removed');
        this.paymentMethods = this.paymentMethods.filter((pm) => pm.id !== id);
      },
      error: () => this.toast.error('Could not remove payment method')
    });
  }

  linkGoogle(): void {
    const password = prompt('Confirm your password to link Google');
    if (!password) return;
    sessionStorage.setItem('google_link_password', password);
    localStorage.setItem('google_flow', 'link');
    this.auth.startGoogleLink().subscribe({
      next: (url) => {
        window.location.href = url;
      },
      error: (err) => {
        sessionStorage.removeItem('google_link_password');
        const message = err?.error?.detail || 'Could not start Google link flow.';
        this.toast.error(message);
      }
    });
  }

  unlinkGoogle(): void {
    const password = prompt('Enter your password to unlink Google');
    if (!password) return;
    this.auth.unlinkGoogle(password).subscribe({
      next: (user) => {
        this.googleEmail.set(user.google_email ?? null);
        this.googlePicture.set(user.google_picture_url ?? null);
        this.profile.set(user);
        this.toast.success('Google account disconnected');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not unlink Google account.';
        this.toast.error(message);
      }
    });
  }

  private lastOrder(): Order | null {
    const orders = this.orders();
    if (!orders.length) return null;
    return [...orders].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  }

  private defaultShippingAddress(): Address | null {
    const addresses = this.addresses();
    if (!addresses.length) return null;
    return addresses.find((a) => a.is_default_shipping) ?? addresses[0] ?? null;
  }

  private formatMoney(amount: number, currency: string): string {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${currency || ''}`.trim();
    }
  }
}
