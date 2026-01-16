import { CommonModule } from '@angular/common';
import { Component, OnInit, AfterViewInit, OnDestroy, signal, ViewChild, ElementRef, effect, EffectRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { AddressFormComponent } from '../../shared/address-form.component';
import { ToastService } from '../../core/toast.service';
import { AuthService, AuthUser, UserAliasesResponse } from '../../core/auth.service';
import { AccountService, AccountDeletionStatus, Address, Order, AddressCreateRequest } from '../../core/account.service';
import { BlogMyComment, BlogService, PaginationMeta } from '../../core/blog.service';
import { forkJoin, map, of, switchMap } from 'rxjs';
import type { Stripe, StripeElements, StripeCardElement, StripeCardElementChangeEvent } from '@stripe/stripe-js';
import { ApiService } from '../../core/api.service';
import { appConfig } from '../../core/app-config';
import { WishlistService } from '../../core/wishlist.service';
import { ProductCardComponent } from '../../shared/product-card.component';
import { ThemeMode, ThemePreference, ThemeService } from '../../core/theme.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { LanguageService } from '../../core/language.service';
import { CartStore } from '../../core/cart.store';
import { formatIdentity } from '../../shared/user-identity';
import { type CountryCode } from 'libphonenumber-js';
import { buildE164, listPhoneCountries, splitE164, type PhoneCountryOption } from '../../shared/phone';
import { missingRequiredProfileFields as computeMissingRequiredProfileFields, type RequiredProfileField } from '../../shared/profile-requirements';

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
        <header class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <p class="text-sm text-slate-500 dark:text-slate-400">Signed in as</p>
            <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50 truncate">{{ profile()?.email || '...' }}</h1>
            <div
              *ngIf="!emailVerified()"
              class="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm grid gap-3 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <div class="flex items-start justify-between gap-3">
                <span>{{ 'auth.emailVerificationNeeded' | translate }}</span>
                <app-button size="sm" variant="ghost" [label]="'auth.emailVerificationResend' | translate" (action)="resendVerification()"></app-button>
              </div>
              <form class="flex gap-2 items-center" (ngSubmit)="submitVerification()">
                <input
                  [(ngModel)]="verificationToken"
                  name="verificationToken"
                  type="text"
                  [placeholder]="'auth.emailVerificationTokenPlaceholder' | translate"
                  class="border border-amber-300 bg-white rounded-lg px-3 py-2 text-sm flex-1 text-slate-900 dark:border-amber-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                  required
                />
                <app-button size="sm" [label]="'auth.emailVerificationConfirm' | translate" type="submit"></app-button>
              </form>
              <p *ngIf="verificationStatus" class="text-xs text-amber-800 dark:text-amber-200">{{ verificationStatus }}</p>
            </div>
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
          <div
            *ngIf="profileCompletionRequired()"
            class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm grid gap-2 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
          >
            <p class="font-semibold">{{ 'account.completeProfile.title' | translate }}</p>
            <p class="text-xs text-amber-900/90 dark:text-amber-100/90">{{ 'account.completeProfile.copy' | translate }}</p>
            <ul class="grid gap-1 text-xs text-amber-900/90 dark:text-amber-100/90">
              <li *ngFor="let field of missingProfileFields()">• {{ requiredFieldLabelKey(field) | translate }}</li>
            </ul>
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
              <app-button
                *ngIf="googlePicture() && (profile()?.avatar_url || '') !== (googlePicture() || '')"
                size="sm"
                variant="ghost"
                label="Use Google photo"
                [disabled]="avatarBusy"
                (action)="useGoogleAvatar()"
              ></app-button>
              <app-button
                *ngIf="profile()?.avatar_url"
                size="sm"
                variant="ghost"
                label="Remove"
                [disabled]="avatarBusy"
                (action)="removeAvatar()"
              ></app-button>
              <span class="text-xs text-slate-500 dark:text-slate-400">JPG/PNG/WebP up to 5MB</span>
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.displayName' | translate }}
              <input
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="profileName"
                autocomplete="name"
                [required]="profileCompletionRequired()"
                [(ngModel)]="profileName"
              />
              <span class="text-xs font-normal text-slate-500 dark:text-slate-400">
                Public: {{ publicIdentityLabel() }}
              </span>
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.username' | translate }}
              <input
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="profileUsername"
                autocomplete="username"
                minlength="3"
                maxlength="30"
                pattern="^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$"
                [required]="profileCompletionRequired()"
                [(ngModel)]="profileUsername"
              />
              <span class="text-xs font-normal text-slate-500 dark:text-slate-400">
                Use this to sign in and as a stable handle in public activity.
              </span>
            </label>

            <label
              *ngIf="usernameChanged()"
              class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200"
            >
              {{ 'auth.currentPassword' | translate }}
	              <input
	                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                name="profileUsernamePassword"
	                type="password"
	                autocomplete="current-password"
	                required
	                [(ngModel)]="profileUsernamePassword"
	              />
              <span class="text-xs font-normal text-slate-500 dark:text-slate-400">
                Required to change your username.
              </span>
            </label>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.firstName' | translate }}
              <input
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="profileFirstName"
                autocomplete="given-name"
                [required]="profileCompletionRequired()"
                [(ngModel)]="profileFirstName"
              />
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.middleName' | translate }}
              <input
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="profileMiddleName"
                autocomplete="additional-name"
                [(ngModel)]="profileMiddleName"
              />
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.lastName' | translate }}
              <input
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="profileLastName"
                autocomplete="family-name"
                [required]="profileCompletionRequired()"
                [(ngModel)]="profileLastName"
              />
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.dateOfBirth' | translate }}
              <input
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="profileDateOfBirth"
                type="date"
                [required]="profileCompletionRequired()"
                [(ngModel)]="profileDateOfBirth"
              />
            </label>

            <div class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.phone' | translate }}
              <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
                <select
                  name="profilePhoneCountry"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="profilePhoneCountry"
                >
                  <option *ngFor="let c of phoneCountries" [ngValue]="c.code">{{ c.flag }} {{ c.name }} ({{ c.dial }})</option>
                </select>
                <input
                  name="profilePhoneNational"
                  type="tel"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                  autocomplete="tel-national"
                  pattern="^[0-9]{6,14}$"
                  placeholder="723204204"
                  [required]="profileCompletionRequired()"
                  [(ngModel)]="profilePhoneNational"
                />
              </div>
              <span class="text-xs font-normal text-slate-500 dark:text-slate-400">
                {{ 'auth.phoneHint' | translate }}
              </span>
            </div>

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
                <option value="system">{{ 'theme.system' | translate }}</option>
                <option value="light">{{ 'theme.light' | translate }}</option>
                <option value="dark">{{ 'theme.dark' | translate }}</option>
              </select>
            </label>
          </div>

          <div class="grid gap-3 sm:grid-cols-2" *ngIf="auth.isAuthenticated()">
            <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
              <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">Username history</p>
              <div *ngIf="aliasesLoading()" class="mt-2">
                <app-skeleton height="44px"></app-skeleton>
              </div>
              <p *ngIf="!aliasesLoading() && aliases()?.usernames?.length === 0" class="mt-2 text-sm text-slate-600 dark:text-slate-300">
                No history yet.
              </p>
              <ul *ngIf="!aliasesLoading() && aliases()?.usernames?.length" class="mt-2 grid gap-2 text-sm">
                <li *ngFor="let h of aliases()!.usernames" class="flex items-center justify-between gap-2">
                  <span class="font-medium text-slate-900 dark:text-slate-50 truncate">{{ h.username }}</span>
                  <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">{{ h.created_at | date: 'short' }}</span>
                </li>
              </ul>
            </div>
            <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
              <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">Display name history</p>
              <div *ngIf="aliasesLoading()" class="mt-2">
                <app-skeleton height="44px"></app-skeleton>
              </div>
              <p *ngIf="!aliasesLoading() && aliases()?.display_names?.length === 0" class="mt-2 text-sm text-slate-600 dark:text-slate-300">
                No history yet.
              </p>
              <ul *ngIf="!aliasesLoading() && aliases()?.display_names?.length" class="mt-2 grid gap-2 text-sm">
                <li *ngFor="let h of aliases()!.display_names" class="flex items-center justify-between gap-2">
                  <span class="font-medium text-slate-900 dark:text-slate-50 truncate">{{ h.name }}#{{ h.name_tag }}</span>
                  <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">{{ h.created_at | date: 'short' }}</span>
                </li>
              </ul>
            </div>
          </div>
          <p *ngIf="aliasesError()" class="text-sm text-rose-700 dark:text-rose-300">{{ aliasesError() }}</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            Session timeout: 30m. Your theme is saved on this device; language is saved to your profile when signed in.
          </p>
          <p *ngIf="profileError" class="text-sm text-rose-700 dark:text-rose-300">{{ profileError }}</p>
          <p *ngIf="profileSaved" class="text-sm text-emerald-700 dark:text-emerald-300">Saved.</p>
        </section>

        <section id="notifications" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-start justify-between gap-3">
            <div class="grid gap-1">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'account.notifications.title' | translate }}</h2>
              <p *ngIf="notificationLastUpdated" class="text-xs text-slate-500 dark:text-slate-400">
                {{ 'account.notifications.lastUpdated' | translate: { date: formatTimestamp(notificationLastUpdated) } }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="showNotificationPreview ? ('account.notifications.hidePreview' | translate) : ('account.notifications.showPreview' | translate)"
                (action)="toggleNotificationPreview()"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'account.notifications.save' | translate"
                [disabled]="savingNotifications"
                (action)="saveNotifications()"
              ></app-button>
            </div>
          </div>

          <div class="grid gap-4 text-sm text-slate-700 dark:text-slate-200">
            <div class="grid gap-2">
              <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {{ 'account.notifications.communityHeading' | translate }}
              </p>
              <label class="flex items-center gap-2">
                <input type="checkbox" [(ngModel)]="notifyBlogCommentReplies" />
                <span>{{ 'account.notifications.replyLabel' | translate }}</span>
              </label>
            </div>

            <div class="grid gap-2" *ngIf="isAdmin()">
              <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {{ 'account.notifications.adminHeading' | translate }}
              </p>
              <label class="flex items-center gap-2">
                <input type="checkbox" [(ngModel)]="notifyBlogComments" />
                <span>{{ 'account.notifications.adminLabel' | translate }}</span>
              </label>
            </div>

            <div class="grid gap-2">
              <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {{ 'account.notifications.marketingHeading' | translate }}
              </p>
              <label class="flex items-center gap-2">
                <input type="checkbox" [(ngModel)]="notifyMarketing" />
                <span>{{ 'account.notifications.marketingLabel' | translate }}</span>
              </label>
            </div>

            <div
              *ngIf="showNotificationPreview"
              class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 grid gap-2"
            >
              <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {{ 'account.notifications.previewTitle' | translate }}
              </p>
              <p class="whitespace-pre-wrap">{{ 'account.notifications.previewReply' | translate }}</p>
              <p *ngIf="isAdmin()" class="whitespace-pre-wrap">{{ 'account.notifications.previewAdmin' | translate }}</p>
              <p class="whitespace-pre-wrap">{{ 'account.notifications.previewMarketing' | translate }}</p>
            </div>

            <span *ngIf="notificationsMessage" class="text-xs text-emerald-700 dark:text-emerald-300">{{
              notificationsMessage | translate
            }}</span>
            <span *ngIf="notificationsError" class="text-xs text-rose-700 dark:text-rose-300">{{
              notificationsError | translate
            }}</span>
          </div>
        </section>

        <section id="security" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-start justify-between gap-3">
            <div class="grid gap-1">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Security</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400">Manage password and connected accounts.</p>
            </div>
            <app-button routerLink="/account/password" size="sm" variant="ghost" label="Change password"></app-button>
          </div>

          <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-3">
            <div class="grid gap-1">
              <p class="font-semibold text-slate-900 dark:text-slate-50">Email</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                Update your email address (max once every 30 days). Disabled while Google is linked.
              </p>
            </div>
            <div class="grid gap-2 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                New email
                <input
                  name="emailChange"
                  type="email"
                  autocomplete="email"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                  [disabled]="!!googleEmail() || emailChanging"
                  [(ngModel)]="emailChangeEmail"
                />
              </label>
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                Confirm password
                <input
                  name="emailChangePassword"
                  type="password"
                  autocomplete="current-password"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                  [disabled]="!!googleEmail() || emailChanging"
                  [(ngModel)]="emailChangePassword"
                />
              </label>
              <app-button
                size="sm"
                variant="ghost"
                label="Update email"
                [disabled]="!!googleEmail() || emailChanging || !emailChangeEmail.trim() || !emailChangePassword"
                (action)="updateEmail()"
              ></app-button>
            </div>
            <p *ngIf="emailChangeError" class="text-xs text-rose-700 dark:text-rose-300">{{ emailChangeError }}</p>
            <p *ngIf="emailChangeSuccess" class="text-xs text-emerald-700 dark:text-emerald-300">{{ emailChangeSuccess }}</p>
          </div>

          <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-2">
            <div class="flex flex-col sm:flex-row sm:items-center gap-3 text-sm">
              <img
                *ngIf="googlePicture()"
                [src]="googlePicture()"
                alt="Google profile"
                class="h-10 w-10 rounded-full border border-slate-200 dark:border-slate-700 object-cover"
              />
              <div class="min-w-0">
                <p class="font-semibold text-slate-900 dark:text-slate-50">Google</p>
                <p class="text-slate-600 dark:text-slate-300 truncate">{{ googleEmail() || 'No Google account linked' }}</p>
              </div>
              <div class="flex flex-col sm:flex-row gap-2 sm:ml-auto w-full sm:w-auto">
                <input
                  type="password"
                  name="googlePassword"
                  [(ngModel)]="googlePassword"
                  autocomplete="current-password"
                  placeholder="Confirm password"
                  aria-label="Confirm password for Google account"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                />
                <app-button
                  size="sm"
                  variant="ghost"
                  label="Link Google"
                  *ngIf="!googleEmail()"
                  [disabled]="googleBusy || !googlePassword"
                  (action)="linkGoogle()"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  label="Unlink"
                  *ngIf="googleEmail()"
                  [disabled]="googleBusy || !googlePassword"
                  (action)="unlinkGoogle()"
                ></app-button>
              </div>
            </div>
            <p *ngIf="googleError" class="text-xs text-rose-700 dark:text-rose-300">{{ googleError }}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              Linking Google lets you sign in faster. We never post without permission.
            </p>
          </div>
        </section>

        <section id="community" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">My comments</h2>
            <app-button size="sm" variant="ghost" label="Refresh" (action)="loadMyComments(myCommentsPage)"></app-button>
          </div>

          <div *ngIf="myCommentsLoading(); else myCommentsBody" class="grid gap-3">
            <app-skeleton height="64px"></app-skeleton>
            <app-skeleton height="64px"></app-skeleton>
          </div>
          <ng-template #myCommentsBody>
            <div *ngIf="myCommentsError()" class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
              {{ myCommentsError() }}
            </div>
            <div
              *ngIf="!myCommentsError() && myComments().length === 0"
              class="border border-dashed border-slate-200 rounded-xl p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"
            >
              No comments yet. <a routerLink="/blog" class="text-indigo-600 dark:text-indigo-300 font-medium">Browse the blog</a>.
            </div>

            <div *ngIf="!myCommentsError() && myComments().length" class="grid gap-3">
              <div *ngFor="let c of myComments()" class="rounded-lg border border-slate-200 p-3 grid gap-2 dark:border-slate-700">
                <div class="flex items-start justify-between gap-3">
                  <a [routerLink]="['/blog', c.post_slug]" class="font-semibold text-slate-900 dark:text-slate-50 hover:underline">
                    {{ c.post_title || c.post_slug }}
                  </a>
                  <span class="text-xs rounded-full px-2 py-1 whitespace-nowrap" [ngClass]="commentStatusChipClass(c.status)">
                    {{ c.status }}
                  </span>
                </div>
                <p class="text-xs text-slate-500 dark:text-slate-400">{{ formatTimestamp(c.created_at) }}</p>
                <p *ngIf="c.body" class="text-sm text-slate-700 dark:text-slate-200">{{ c.body }}</p>
                <p *ngIf="!c.body && c.status === 'deleted'" class="text-sm text-slate-500 dark:text-slate-400">This comment was deleted.</p>
                <p *ngIf="!c.body && c.status === 'hidden'" class="text-sm text-slate-500 dark:text-slate-400">This comment was hidden by moderators.</p>

                <div
                  *ngIf="c.parent"
                  class="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200"
                >
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    Replying to {{ c.parent.author_name || ('blog.comments.anonymous' | translate) }}
                  </p>
                  <p>{{ c.parent.snippet }}</p>
                </div>

                <div *ngIf="c.reply_count" class="text-sm text-slate-700 dark:text-slate-200">
                  {{ c.reply_count }} repl{{ c.reply_count === 1 ? 'y' : 'ies' }}
                  <span *ngIf="c.last_reply">
                    · Latest: {{ c.last_reply.author_name || ('blog.comments.anonymous' | translate) }} — {{ c.last_reply.snippet }}
                  </span>
                </div>
              </div>

              <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200" *ngIf="myCommentsMeta()">
                <span>Page {{ myCommentsMeta()?.page }} / {{ myCommentsMeta()?.total_pages }}</span>
                <div class="flex gap-2">
                  <app-button size="sm" variant="ghost" label="Prev" [disabled]="(myCommentsMeta()?.page || 1) <= 1" (action)="prevMyCommentsPage()"></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    label="Next"
                    [disabled]="(myCommentsMeta()?.page || 1) >= (myCommentsMeta()?.total_pages || 1)"
                    (action)="nextMyCommentsPage()"
                  ></app-button>
                </div>
              </div>
            </div>
          </ng-template>
        </section>

        <section id="privacy" class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Privacy & data</h2>

          <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-2">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="font-semibold text-slate-900 dark:text-slate-50">Download my data</p>
                <p class="text-sm text-slate-600 dark:text-slate-300">Export your profile, orders, wishlist, and blog activity as JSON.</p>
              </div>
              <app-button size="sm" variant="ghost" [label]="exportingData ? 'Downloading…' : 'Download'" [disabled]="exportingData" (action)="downloadMyData()"></app-button>
            </div>
            <p *ngIf="exportError" class="text-xs text-rose-700 dark:text-rose-300">{{ exportError }}</p>
          </div>

          <div class="rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/40 dark:bg-rose-950/30 grid gap-3">
            <div class="flex items-center justify-between">
              <p class="font-semibold text-rose-900 dark:text-rose-100">Delete account</p>
              <span *ngIf="deletionStatus()?.scheduled_for" class="text-xs text-rose-800 dark:text-rose-200">
                Scheduled
              </span>
            </div>

            <div *ngIf="deletionLoading(); else deletionBody" class="grid gap-2">
              <app-skeleton height="18px" width="70%"></app-skeleton>
              <app-skeleton height="18px" width="90%"></app-skeleton>
            </div>
            <ng-template #deletionBody>
              <p class="text-sm text-rose-900 dark:text-rose-100">
                Requesting deletion schedules your account to be removed after {{ deletionStatus()?.cooldown_hours || 24 }} hours.
              </p>

              <div *ngIf="deletionStatus()?.scheduled_for; else requestDelete" class="grid gap-2">
                <p class="text-sm text-rose-900 dark:text-rose-100">
                  Scheduled for {{ formatTimestamp(deletionStatus()?.scheduled_for || '') }}.
                </p>
                <div class="flex gap-2">
                  <app-button size="sm" variant="ghost" label="Cancel deletion" [disabled]="cancellingDeletion" (action)="cancelDeletion()"></app-button>
                </div>
              </div>
              <ng-template #requestDelete>
                <p class="text-sm text-rose-900 dark:text-rose-100">
                  Type <span class="font-semibold">DELETE</span> to confirm. You can cancel during the {{ deletionStatus()?.cooldown_hours || 24 }}h cooldown window.
                </p>
                <div class="flex flex-col sm:flex-row gap-2">
                  <input
                    name="deletionConfirmText"
                    [(ngModel)]="deletionConfirmText"
                    placeholder="DELETE"
                    aria-label="Confirm account deletion"
                    class="rounded-lg border border-rose-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-rose-900/40 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                  />
                  <app-button
                    size="sm"
                    label="Request deletion"
                    [disabled]="requestingDeletion || deletionConfirmText.trim().toUpperCase() !== 'DELETE'"
                    (action)="requestDeletion()"
                  ></app-button>
                </div>
              </ng-template>

              <p *ngIf="deletionError()" class="text-xs text-rose-700 dark:text-rose-300">{{ deletionError() }}</p>
            </ng-template>
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
                <option value="">{{ 'adminUi.orders.all' | translate }}</option>
                <option value="pending">{{ 'adminUi.orders.pending' | translate }}</option>
                <option value="paid">{{ 'adminUi.orders.paid' | translate }}</option>
                <option value="shipped">{{ 'adminUi.orders.shipped' | translate }}</option>
                <option value="delivered">{{ 'adminUi.orders.delivered' | translate }}</option>
                <option value="cancelled">{{ 'adminUi.orders.cancelled' | translate }}</option>
                <option value="refunded">{{ 'adminUi.orders.refunded' | translate }}</option>
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
                  <span class="text-xs rounded-full px-2 py-1" [ngClass]="orderStatusChipClass(order.status)">
                    {{ ('adminUi.orders.' + order.status) | translate }}
                  </span>
                </div>
                <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {{ order.created_at | date: 'mediumDate' }} · {{ order.items.length }} item{{ order.items.length === 1 ? '' : 's' }}
                </p>
              </div>
              <div class="text-right">
                <p class="font-semibold text-slate-900 dark:text-slate-50">{{ order.total_amount | localizedCurrency : order.currency || 'RON' }}</p>
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
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-slate-500 dark:text-slate-400">Delivery</span>
                  <span>{{ deliveryLabel(order) }}</span>
                </div>
                <div *ngIf="lockerLabel(order)" class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-slate-500 dark:text-slate-400">Locker</span>
                  <span class="truncate">{{ lockerLabel(order) }}</span>
                </div>
                <div *ngIf="order.status === 'cancelled' && order.cancel_reason" class="flex flex-wrap items-start justify-between gap-2">
                  <span class="text-slate-500 dark:text-slate-400">{{ 'adminUi.orders.cancelReason' | translate }}</span>
                  <span class="max-w-[520px] text-right whitespace-pre-wrap">{{ order.cancel_reason }}</span>
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
                      {{ item.subtotal | localizedCurrency : order.currency || 'RON' }}
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
                      <span>{{ (order.tax_amount || 0) | localizedCurrency : order.currency || 'RON' }}</span>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-slate-500 dark:text-slate-400">Shipping</span>
                      <span>{{ (order.shipping_amount || 0) | localizedCurrency : order.currency || 'RON' }}</span>
                    </div>
                    <div class="flex items-center justify-between font-semibold text-slate-900 dark:text-slate-50 pt-1">
                      <span>Total</span>
                      <span>{{ order.total_amount | localizedCurrency : order.currency || 'RON' }}</span>
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
  avatarBusy = false;
  placeholderAvatar = 'assets/placeholder/avatar-placeholder.svg';
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
  private phoneCountriesEffect?: EffectRef;
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
  showNotificationPreview = false;
  notificationLastUpdated: string | null = null;
  savingProfile = false;
  profileSaved = false;
  profileError: string | null = null;
  profileName = '';
  profileUsername = '';
  profileUsernamePassword = '';
  profileFirstName = '';
  profileMiddleName = '';
  profileLastName = '';
  profileDateOfBirth = '';
  profilePhone = '';
  profilePhoneCountry: CountryCode = 'RO';
  profilePhoneNational = '';
  phoneCountries: PhoneCountryOption[] = [];
  profileLanguage: 'en' | 'ro' = 'en';
  profileThemePreference: ThemePreference = 'system';
  reorderingOrderId: string | null = null;
  downloadingReceiptId: string | null = null;

  private forceProfileCompletion = false;

  googlePassword = '';
  googleBusy = false;
  googleError: string | null = null;

  emailChanging = false;
  emailChangeEmail = '';
  emailChangePassword = '';
  emailChangeError: string | null = null;
  emailChangeSuccess: string | null = null;

  exportingData = false;
  exportError: string | null = null;

  deletionStatus = signal<AccountDeletionStatus | null>(null);
  deletionLoading = signal<boolean>(false);
  deletionError = signal<string | null>(null);
  deletionConfirmText = '';
  requestingDeletion = false;
  cancellingDeletion = false;

  myComments = signal<BlogMyComment[]>([]);
  myCommentsMeta = signal<PaginationMeta | null>(null);
  myCommentsLoading = signal<boolean>(false);
  myCommentsError = signal<string | null>(null);
  myCommentsPage = 1;
  myCommentsLimit = 10;

  aliases = signal<UserAliasesResponse | null>(null);
  aliasesLoading = signal<boolean>(false);
  aliasesError = signal<string | null>(null);

  constructor(
    private toast: ToastService,
    private auth: AuthService,
    private account: AccountService,
    private blog: BlogService,
    private cart: CartStore,
    private router: Router,
    private route: ActivatedRoute,
    private api: ApiService,
    public wishlist: WishlistService,
    private theme: ThemeService,
    private lang: LanguageService,
    private translate: TranslateService
  ) {
    this.computeTotalPages();
    this.stripeThemeEffect = effect(() => {
      const mode = this.theme.mode()();
      if (this.card) {
        this.card.update({ style: this.buildStripeCardStyle(mode) });
      }
    });
    this.phoneCountriesEffect = effect(() => {
      this.phoneCountries = listPhoneCountries(this.lang.language());
    });
  }

  ngOnInit(): void {
    this.forceProfileCompletion = this.route.snapshot.queryParamMap.get('complete') === '1';
    this.wishlist.refresh();
    this.loadData();
    this.loadAliases();
    this.loadDeletionStatus();
    this.loadMyComments();
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
        this.notificationLastUpdated = profile.updated_at ?? null;
        this.addresses.set(addresses);
        this.orders.set(orders);
        this.avatar = profile.avatar_url ?? null;
        this.profileName = profile.name ?? '';
        this.profileUsername = (profile.username ?? '').trim();
        this.profileFirstName = profile.first_name ?? '';
        this.profileMiddleName = profile.middle_name ?? '';
        this.profileLastName = profile.last_name ?? '';
        this.profileDateOfBirth = profile.date_of_birth ?? '';
        this.profilePhone = profile.phone ?? '';
        const phoneSplit = splitE164(this.profilePhone);
        this.profilePhoneCountry = phoneSplit.country ?? 'RO';
        this.profilePhoneNational = phoneSplit.nationalNumber || '';
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
      delivered: 'bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-100',
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

  deliveryLabel(order: Order): string {
    const courierRaw = (order.courier ?? '').trim().toLowerCase();
    const courier =
      courierRaw === 'sameday'
        ? 'Sameday'
        : courierRaw === 'fan_courier'
          ? 'Fan Courier'
          : (order.courier ?? '').trim();
    const typeRaw = (order.delivery_type ?? '').trim().toLowerCase();
    const deliveryType = typeRaw === 'home' ? 'Home delivery' : typeRaw === 'locker' ? 'Locker pickup' : (order.delivery_type ?? '').trim();
    const parts = [courier, deliveryType].filter((p) => (p || '').trim());
    return parts.length ? parts.join(' · ') : '—';
  }

  lockerLabel(order: Order): string | null {
    if ((order.delivery_type ?? '').trim().toLowerCase() !== 'locker') return null;
    const name = (order.locker_name ?? '').trim();
    const address = (order.locker_address ?? '').trim();
    const detail = [name, address].filter((p) => p).join(' — ');
    return detail || null;
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
        this.auth.loadCurrentUser().subscribe({
          next: (user) => {
            this.profile.set(user);
            this.emailVerified.set(Boolean(user.email_verified));
          }
        });
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
    this.auth.uploadAvatar(file).subscribe({
      next: (user) => {
        this.profile.set(user);
        this.avatar = user.avatar_url ?? null;
        this.toast.success('Avatar updated');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not upload avatar.';
        this.toast.error(message);
      }
    });
  }

  useGoogleAvatar(): void {
    if (this.avatarBusy) return;
    this.avatarBusy = true;
    this.auth.useGoogleAvatar().subscribe({
      next: (user) => {
        this.profile.set(user);
        this.avatar = user.avatar_url ?? null;
        this.toast.success('Avatar updated');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not use Google photo.';
        this.toast.error(message);
      },
      complete: () => {
        this.avatarBusy = false;
      }
    });
  }

  removeAvatar(): void {
    if (this.avatarBusy) return;
    if (!confirm('Remove your avatar?')) return;
    this.avatarBusy = true;
    this.auth.removeAvatar().subscribe({
      next: (user) => {
        this.profile.set(user);
        this.avatar = user.avatar_url ?? null;
        this.toast.success('Avatar removed');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not remove avatar.';
        this.toast.error(message);
      },
      complete: () => {
        this.avatarBusy = false;
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
    return this.auth.isAdmin();
  }

  profileCompleteness(): { completed: number; total: number; percent: number } {
    const total = 8;
    let completed = 0;

    if (this.profileName.trim()) completed += 1;
    if (this.profileFirstName.trim()) completed += 1;
    if (this.profileLastName.trim()) completed += 1;
    if (this.profileDateOfBirth.trim()) completed += 1;
    if (buildE164(this.profilePhoneCountry, this.profilePhoneNational)) completed += 1;
    if (this.avatar || this.profile()?.avatar_url) completed += 1;
    if (this.profileLanguage === 'en' || this.profileLanguage === 'ro') completed += 1;
    if (this.emailVerified()) completed += 1;

    return {
      completed,
      total,
      percent: Math.round((completed / total) * 100)
    };
  }

  missingProfileFields(): RequiredProfileField[] {
    return computeMissingRequiredProfileFields(this.profile());
  }

  profileCompletionRequired(): boolean {
    const user = this.profile();
    if (!user) return false;
    const missing = computeMissingRequiredProfileFields(user);
    if (!missing.length) return false;
    return this.forceProfileCompletion || Boolean(user.google_sub);
  }

  usernameChanged(): boolean {
    const current = (this.profile()?.username ?? '').trim();
    const next = this.profileUsername.trim();
    return Boolean(next && next !== current);
  }

  requiredFieldLabelKey(field: RequiredProfileField): string {
    switch (field) {
      case 'name':
        return 'auth.displayName';
      case 'username':
        return 'auth.username';
      case 'first_name':
        return 'auth.firstName';
      case 'last_name':
        return 'auth.lastName';
      case 'date_of_birth':
        return 'auth.dateOfBirth';
      case 'phone':
        return 'auth.phone';
    }
  }

  saveProfile(): void {
    if (!this.auth.isAuthenticated()) return;
    this.savingProfile = true;
    this.profileSaved = false;
    this.profileError = null;

    const name = this.profileName.trim();
    const username = this.profileUsername.trim();
    const firstName = this.profileFirstName.trim();
    const middleName = this.profileMiddleName.trim();
    const lastName = this.profileLastName.trim();
    const dob = this.profileDateOfBirth.trim();
    const phoneNational = this.profilePhoneNational.trim();
    const phone = phoneNational ? buildE164(this.profilePhoneCountry, phoneNational) : null;

    const usernameOk = /^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$/.test(username);
    if (this.profileCompletionRequired()) {
      if (!name) {
        this.profileError = 'Display name is required.';
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
      if (!username || !usernameOk) {
        this.profileError = 'Enter a valid username.';
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
      if (!firstName) {
        this.profileError = 'First name is required.';
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
      if (!lastName) {
        this.profileError = 'Last name is required.';
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
      if (!dob) {
        this.profileError = 'Date of birth is required.';
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
      if (!phoneNational || !phone) {
        this.profileError = 'Enter a valid phone number.';
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
    }

    if (phoneNational && !phone) {
      this.profileError = 'Enter a valid phone number.';
      this.toast.error(this.profileError);
      this.savingProfile = false;
      return;
    }
    if (dob) {
      const parsed = new Date(`${dob}T00:00:00Z`);
      if (!Number.isNaN(parsed.valueOf()) && parsed.getTime() > Date.now()) {
        this.profileError = 'Date of birth cannot be in the future.';
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
    }

    const payload: {
      name?: string | null;
      phone?: string | null;
      first_name?: string | null;
      middle_name?: string | null;
      last_name?: string | null;
      date_of_birth?: string | null;
      preferred_language?: string | null;
    } = {
      name: name ? name : null,
      phone,
      first_name: firstName ? firstName : null,
      middle_name: middleName ? middleName : null,
      last_name: lastName ? lastName : null,
      date_of_birth: dob ? dob : null,
      preferred_language: this.profileLanguage
    };

    this.theme.setPreference(this.profileThemePreference);
    this.lang.setLanguage(this.profileLanguage, { syncBackend: false });

    const current = this.profile();
    const currentUsername = (current?.username ?? '').trim();

    const usernameNeedsUpdate = Boolean(username && username !== currentUsername);
    if (usernameNeedsUpdate && !this.profileUsernamePassword.trim()) {
      const msg = this.translate.instant('auth.currentPasswordRequired');
      this.profileError = msg;
      this.toast.error(msg);
      this.savingProfile = false;
      return;
    }

    const maybeUpdateUsername$ = usernameNeedsUpdate
      ? this.auth.updateUsername(username, this.profileUsernamePassword).pipe(map(() => null))
      : of(null);

    maybeUpdateUsername$
      .pipe(switchMap(() => this.auth.updateProfile(payload)))
      .subscribe({
        next: (user) => {
          this.profile.set(user);
          this.profileName = user.name ?? '';
          this.profileUsername = (user.username ?? '').trim();
          this.profileFirstName = user.first_name ?? '';
          this.profileMiddleName = user.middle_name ?? '';
          this.profileLastName = user.last_name ?? '';
          this.profileDateOfBirth = user.date_of_birth ?? '';
          this.profilePhone = user.phone ?? '';
          const phoneSplit = splitE164(this.profilePhone);
          this.profilePhoneCountry = phoneSplit.country ?? 'RO';
          this.profilePhoneNational = phoneSplit.nationalNumber || '';
          this.profileLanguage = (user.preferred_language === 'ro' ? 'ro' : 'en') as 'en' | 'ro';
          this.avatar = user.avatar_url ?? this.avatar;
          this.profileUsernamePassword = '';
          this.profileSaved = true;
          this.toast.success('Profile saved');
          this.loadAliases();

          if (this.forceProfileCompletion && computeMissingRequiredProfileFields(user).length === 0) {
            this.forceProfileCompletion = false;
            void this.router.navigate([], {
              relativeTo: this.route,
              queryParams: { complete: null },
              queryParamsHandling: 'merge',
              replaceUrl: true,
              fragment: 'profile'
            });
          }
        },
        error: (err) => {
          const message = err?.error?.detail || 'Could not save profile.';
          this.profileError = message;
          this.toast.error(message);
        },
        complete: () => (this.savingProfile = false)
      });
  }

  loadAliases(): void {
    if (!this.auth.isAuthenticated()) return;
    this.aliasesLoading.set(true);
    this.aliasesError.set(null);
    this.auth.getAliases().subscribe({
      next: (resp) => this.aliases.set(resp),
      error: () => this.aliasesError.set('Could not load your username/display name history.'),
      complete: () => this.aliasesLoading.set(false)
    });
  }

  publicIdentityLabel(user?: AuthUser | null): string {
    const u = user ?? this.profile();
    return formatIdentity(u, '');
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
        notify_blog_comment_replies: this.notifyBlogCommentReplies,
        notify_marketing: this.notifyMarketing
      })
      .subscribe({
        next: (user) => {
          this.profile.set(user);
          this.notifyBlogComments = Boolean(user?.notify_blog_comments);
          this.notifyBlogCommentReplies = Boolean(user?.notify_blog_comment_replies);
          this.notifyMarketing = Boolean(user?.notify_marketing);
          this.notificationLastUpdated = user.updated_at ?? null;
          this.notificationsMessage = 'account.notifications.saved';
        },
        error: () => {
          this.notificationsError = 'account.notifications.saveError';
          this.savingNotifications = false;
        },
        complete: () => (this.savingNotifications = false)
      });
  }

  toggleNotificationPreview(): void {
    this.showNotificationPreview = !this.showNotificationPreview;
  }

  private loadDeletionStatus(): void {
    if (!this.auth.isAuthenticated()) return;
    this.deletionLoading.set(true);
    this.deletionError.set(null);
    this.account.getDeletionStatus().subscribe({
      next: (status) => {
        this.deletionStatus.set(status);
      },
      error: () => {
        this.deletionError.set('Could not load deletion status.');
      },
      complete: () => this.deletionLoading.set(false)
    });
  }

  downloadMyData(): void {
    if (this.exportingData || !this.auth.isAuthenticated()) return;
    this.exportingData = true;
    this.exportError = null;
    this.account.downloadExport().subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        const date = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `moment-studio-export-${date}.json`;
        a.click();
        window.URL.revokeObjectURL(url);
        this.toast.success('Export downloaded');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not download export.';
        this.exportError = message;
        this.toast.error(message);
      },
      complete: () => {
        this.exportingData = false;
      }
    });
  }

  requestDeletion(): void {
    if (this.requestingDeletion || !this.auth.isAuthenticated()) return;
    this.requestingDeletion = true;
    this.deletionError.set(null);
    this.account.requestAccountDeletion(this.deletionConfirmText).subscribe({
      next: (status) => {
        this.deletionStatus.set(status);
        this.deletionConfirmText = '';
        this.toast.success('Deletion scheduled');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not request account deletion.';
        this.deletionError.set(message);
        this.toast.error(message);
      },
      complete: () => {
        this.requestingDeletion = false;
      }
    });
  }

  cancelDeletion(): void {
    if (this.cancellingDeletion || !this.auth.isAuthenticated()) return;
    this.cancellingDeletion = true;
    this.deletionError.set(null);
    this.account.cancelAccountDeletion().subscribe({
      next: (status) => {
        this.deletionStatus.set(status);
        this.toast.success('Deletion canceled');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not cancel account deletion.';
        this.deletionError.set(message);
        this.toast.error(message);
      },
      complete: () => {
        this.cancellingDeletion = false;
      }
    });
  }

  loadMyComments(page: number = 1): void {
    if (!this.auth.isAuthenticated()) return;
    this.myCommentsLoading.set(true);
    this.myCommentsError.set(null);
    const lang = this.lang.language();
    this.blog.listMyComments({ lang, page, limit: this.myCommentsLimit }).subscribe({
      next: (res) => {
        this.myComments.set(res.items);
        this.myCommentsMeta.set(res.meta);
        this.myCommentsPage = res.meta.page;
      },
      error: () => {
        this.myCommentsError.set('Could not load your comments.');
      },
      complete: () => this.myCommentsLoading.set(false)
    });
  }

  nextMyCommentsPage(): void {
    const meta = this.myCommentsMeta();
    if (!meta) return;
    if (meta.page < meta.total_pages) {
      this.loadMyComments(meta.page + 1);
    }
  }

  prevMyCommentsPage(): void {
    const meta = this.myCommentsMeta();
    if (!meta) return;
    if (meta.page > 1) {
      this.loadMyComments(meta.page - 1);
    }
  }

  commentStatusChipClass(status: string): string {
    switch (status) {
      case 'posted':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100';
      case 'hidden':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100';
      case 'deleted':
        return 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
      default:
        return 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
    }
  }

  formatTimestamp(value: string | null | undefined): string {
    if (!value) return '';
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
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
    this.phoneCountriesEffect?.destroy();
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
    const { loadStripe } = await import('@stripe/stripe-js');
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

  updateEmail(): void {
    if (this.emailChanging) return;
    if (this.googleEmail()) {
      this.emailChangeError = 'Unlink Google before changing your email.';
      this.toast.error(this.emailChangeError);
      return;
    }
    const email = this.emailChangeEmail.trim();
    const password = this.emailChangePassword;
    this.emailChangeError = null;
    this.emailChangeSuccess = null;
    if (!email) {
      this.emailChangeError = 'Enter a new email.';
      this.toast.error(this.emailChangeError);
      return;
    }
    if (!password) {
      this.emailChangeError = 'Confirm your password to change email.';
      this.toast.error(this.emailChangeError);
      return;
    }
    this.emailChanging = true;
    this.auth.updateEmail(email, password).subscribe({
      next: (user) => {
        this.profile.set(user);
        this.emailVerified.set(Boolean(user.email_verified));
        this.emailChangeEmail = '';
        this.emailChangePassword = '';
        this.emailChangeSuccess = 'Email updated. Please verify your new email.';
        this.toast.success('Email updated');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not change email.';
        this.emailChangeError = message;
        this.toast.error(message);
      },
      complete: () => {
        this.emailChanging = false;
      }
    });
  }

  linkGoogle(): void {
    const password = this.googlePassword.trim();
    this.googleError = null;
    if (!password) {
      this.googleError = 'Enter your password to link Google.';
      return;
    }
    this.googleBusy = true;
    sessionStorage.setItem('google_link_password', password);
    localStorage.setItem('google_flow', 'link');
    this.auth.startGoogleLink().subscribe({
      next: (url) => {
        window.location.href = url;
      },
      error: (err) => {
        sessionStorage.removeItem('google_link_password');
        const message = err?.error?.detail || 'Could not start Google link flow.';
        this.googleError = message;
        this.toast.error(message);
        this.googleBusy = false;
      }
    });
  }

  unlinkGoogle(): void {
    const password = this.googlePassword.trim();
    this.googleError = null;
    if (!password) {
      this.googleError = 'Enter your password to unlink Google.';
      return;
    }
    this.googleBusy = true;
    this.auth.unlinkGoogle(password).subscribe({
      next: (user) => {
        this.googleEmail.set(user.google_email ?? null);
        this.googlePicture.set(user.google_picture_url ?? null);
        this.profile.set(user);
        this.googlePassword = '';
        this.toast.success('Google account disconnected');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not unlink Google account.';
        this.googleError = message;
        this.toast.error(message);
      },
      complete: () => {
        this.googleBusy = false;
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
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'RON' }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${currency || ''}`.trim();
    }
  }
}
