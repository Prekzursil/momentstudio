import { Component, EffectRef, EventEmitter, Input, Output, computed, effect, inject, OnDestroy, PLATFORM_ID, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NavDrawerComponent, NavLink } from '../shared/nav-drawer.component';
import { DatePipe, isPlatformBrowser, NgClass, NgForOf, NgIf } from '@angular/common';
import { CartStore } from '../core/cart.store';
import { ThemePreference } from '../core/theme.service';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../core/auth.service';
import { StorefrontAdminModeService } from '../core/storefront-admin-mode.service';
import { ThemeSegmentedControlComponent } from '../shared/theme-segmented-control.component';
import { NotificationsService, UserNotification } from '../core/notifications.service';
import { MaintenanceBannerPublic, OpsService } from '../core/ops.service';
import { ToastService } from '../core/toast.service';
import { CmsAnnouncementBarComponent } from '../shared/cms-announcement-bar.component';
import { SiteNavigationService, SiteNavigationData } from '../core/site-navigation.service';
import { PwaService } from '../core/pwa.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    RouterLink,
    NavDrawerComponent,
    NgIf,
    NgForOf,
    NgClass,
    DatePipe,
    FormsModule,
    TranslateModule,
    ThemeSegmentedControlComponent,
    CmsAnnouncementBarComponent
  ],
  template: `
    <header class="sticky top-0 z-[100] isolate border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
      <div *ngIf="bannerText() as bannerMessage" class="border-b border-slate-200 dark:border-slate-800" [ngClass]="bannerClasses()">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div class="whitespace-pre-line">{{ bannerMessage }}</div>
          <a
            *ngIf="bannerLinkUrl() as href"
            class="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:opacity-80"
            [href]="href"
            [attr.target]="isExternalLink(href) ? '_blank' : null"
            [attr.rel]="isExternalLink(href) ? 'noopener noreferrer' : null"
          >
            {{ bannerLinkLabel() || ('adminUi.ops.banner.linkDefault' | translate) }}
          </a>
        </div>
      </div>
      <app-cms-announcement-bar></app-cms-announcement-bar>
      <div class="max-w-7xl mx-auto px-4 sm:px-6">
        <nav class="py-4 grid grid-cols-[auto,1fr,auto] items-center gap-4" aria-label="Header controls">
          <a routerLink="/" class="flex items-center gap-3 min-w-0">
          <img
            class="h-8 sm:h-10 w-auto shrink-0"
            src="assets/brand/momentstudio-flower.png"
            [alt]="'app.brandMarkAlt' | translate"
            loading="eager"
          />
            <span class="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-slate-100 truncate">
              {{ 'app.name' | translate }}
            </span>
          </a>
          <form class="hidden lg:flex min-w-0" (submit)="submitSearch($event)">
            <div class="relative w-full max-w-2xl xl:max-w-3xl min-w-0 mx-auto">
              <label class="sr-only" for="header-search-input">{{ 'shop.searchPlaceholder' | translate }}</label>
              <input
                id="header-search-input"
                name="q"
                type="search"
                class="w-full h-10 rounded-full border border-slate-200 bg-white px-4 pr-10 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                [placeholder]="'shop.searchPlaceholder' | translate"
                [(ngModel)]="searchQuery"
              />
              <button
                type="submit"
                class="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded-full text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                aria-label="Search"
              >
                <span aria-hidden="true">🔎</span>
                <span class="sr-only">Search</span>
              </button>
            </div>
          </form>
          <div class="flex items-center gap-3 justify-end">
            <button
              type="button"
              class="lg:hidden text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
              (click)="toggleDrawer()"
              aria-label="Open navigation"
              [attr.aria-expanded]="drawerOpen"
            >
              <span aria-hidden="true">☰</span>
              <span class="sr-only">Open navigation</span>
            </button>
            <button
              type="button"
              class="lg:hidden inline-flex items-center justify-center h-10 w-10 rounded-full bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100"
              aria-label="Search"
              (click)="openSearch()"
            >
              <span aria-hidden="true">🔎</span>
              <span class="sr-only">Search</span>
            </button>
            <a
              routerLink="/cart"
              class="relative inline-flex items-center justify-center h-10 w-10 rounded-full bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100"
              [attr.aria-label]="'Cart with ' + cartCount() + ' items'"
            >
              <span aria-hidden="true">🛒</span>
              <span class="sr-only">Cart</span>
              <span
                *ngIf="cartCount() > 0"
                class="absolute -top-1 -right-1 min-w-[20px] rounded-full bg-slate-900 px-1 text-[11px] font-semibold text-white text-center dark:bg-slate-50 dark:text-slate-900"
              >
                {{ cartCount() }}
              </span>
            </a>
            <a
              *ngIf="!pwaOnline()"
              routerLink="/offline"
              class="inline-flex items-center justify-center h-10 w-10 rounded-full bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
              [attr.aria-label]="'pwa.offlineBadge' | translate"
            >
              <span aria-hidden="true">⚠️</span>
              <span class="sr-only">{{ 'pwa.offlineBadge' | translate }}</span>
            </a>
            <a
              *ngIf="!isAuthenticated()"
              routerLink="/login"
              class="text-sm font-medium text-slate-700 hover:text-slate-900 hidden sm:inline dark:text-slate-200 dark:hover:text-white"
            >
              {{ 'nav.signIn' | translate }}
            </a>
            <div *ngIf="isAuthenticated()" class="relative hidden sm:block">
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:text-white"
                (click)="toggleUserMenu()"
                aria-haspopup="menu"
                [attr.aria-expanded]="userMenuOpen"
              >
                <span class="truncate max-w-[160px]">{{ currentUser()?.username }}</span>
                <span class="text-slate-500 dark:text-slate-300">▾</span>
              </button>
                <div
                  *ngIf="userMenuOpen"
                  class="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900 z-[110]"
                  role="menu"
                >
                  <a
                    routerLink="/account/profile"
                    role="menuitem"
                    class="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
                    (click)="closeUserMenu()"
                  >
                    {{ 'nav.myProfile' | translate }}
                  </a>
                  <a
                    routerLink="/account/orders"
                    role="menuitem"
                    class="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
                    (click)="closeUserMenu()"
                  >
                    {{ 'nav.myOrders' | translate }}
                  </a>
                    <a
                      routerLink="/account/wishlist"
                      role="menuitem"
                      class="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
                      (click)="closeUserMenu()"
                    >
                      {{ 'nav.myWishlist' | translate }}
                    </a>
                    <a
                      routerLink="/account/coupons"
                      role="menuitem"
                      class="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
                      (click)="closeUserMenu()"
                    >
                      {{ 'nav.myCoupons' | translate }}
                    </a>
                    <a
                      routerLink="/tickets"
                      role="menuitem"
                      class="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
                      (click)="closeUserMenu()"
                  >
                    {{ 'nav.helpCenter' | translate }}
                  </a>
                  <div class="my-1 border-t border-slate-200 dark:border-slate-800"></div>
                  <button
                    type="button"
                    role="menuitem"
                    class="w-full text-left rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
                    (click)="signOut()"
                  >
                    {{ (isImpersonating() ? 'nav.exitImpersonation' : 'nav.signOut') | translate }}
                  </button>
                </div>
            </div>
            <div *ngIf="isAuthenticated()" class="relative">
              <button
                type="button"
                class="relative inline-flex items-center justify-center h-10 w-10 rounded-full bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                [attr.aria-label]="'notifications.title' | translate"
                aria-haspopup="menu"
                [attr.aria-expanded]="notificationsOpen"
                (click)="toggleNotifications()"
              >
                <span aria-hidden="true">🔔</span>
                <span class="sr-only">{{ 'notifications.title' | translate }}</span>
                <span
                  *ngIf="unreadCount() > 0"
                  class="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white grid place-items-center"
                >
                  {{ unreadBadge() }}
                </span>
              </button>
              <div
                *ngIf="notificationsOpen"
                class="absolute right-0 mt-2 w-[min(92vw,360px)] rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900 z-50 overflow-hidden"
                role="menu"
              >
                <div class="px-4 py-3 border-b border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between">
                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'notifications.title' | translate }}</p>
                  <button
                    type="button"
                    class="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                    (click)="closeNotifications()"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>
                <div class="max-h-[360px] overflow-auto">
                  <div *ngIf="notificationsLoading()" class="p-4 text-sm text-slate-600 dark:text-slate-300">
                    {{ 'notifications.loading' | translate }}
                  </div>
                  <div *ngIf="!notificationsLoading() && notifications().length === 0" class="p-4 text-sm text-slate-600 dark:text-slate-300">
                    {{ 'notifications.empty' | translate }}
                  </div>
                  <ul *ngIf="!notificationsLoading() && notifications().length" class="divide-y divide-slate-200/60 dark:divide-slate-800/60">
                    <li *ngFor="let n of notifications()" class="p-4">
                      <div
                        class="rounded-xl p-3 border border-slate-200 dark:border-slate-800"
                        [ngClass]="n.read_at || n.dismissed_at ? 'bg-white dark:bg-slate-900' : 'bg-amber-50/70 dark:bg-amber-950/25'"
                      >
                        <button
                          type="button"
                          class="w-full text-left"
                          (click)="openNotification(n)"
                        >
                          <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                              <p class="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">{{ n.title }}</p>
                              <p *ngIf="n.body" class="mt-1 text-sm text-slate-700 dark:text-slate-200 break-words">{{ n.body }}</p>
                            </div>
                            <p class="shrink-0 text-xs text-slate-500 dark:text-slate-400">{{ n.created_at | date: 'short' }}</p>
                          </div>
                        </button>
                        <div class="mt-3 flex items-center justify-end gap-2">
                          <button
                            *ngIf="!n.read_at && !n.dismissed_at"
                            type="button"
                            class="h-8 px-3 rounded-full text-xs font-medium border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            (click)="markRead(n); $event.stopPropagation()"
                          >
                            {{ 'notifications.markRead' | translate }}
                          </button>
                          <button
                            type="button"
                            class="h-8 px-3 rounded-full text-xs font-medium border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            (click)="dismiss(n); $event.stopPropagation()"
                          >
                            {{ 'notifications.dismiss' | translate }}
                          </button>
                        </div>
                      </div>
                    </li>
                    </ul>
                  </div>
                <div class="px-4 py-3 border-t border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between gap-3">
                  <a
                    routerLink="/account/notifications"
                    class="text-sm font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-200"
                    (click)="closeNotifications()"
                  >
                    {{ 'notifications.viewAll' | translate }}
                  </a>
                  <a
                    routerLink="/account/notifications/settings"
                    class="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                    (click)="closeNotifications()"
                  >
                    {{ 'notifications.settings' | translate }}
                  </a>
                </div>
                </div>
              </div>
            <div class="hidden lg:flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-2 py-1 shadow-sm dark:border-slate-700 dark:bg-slate-800/70">
              <app-theme-segmented-control
                [preference]="themePreference"
                (preferenceChange)="onThemeChange($event)"
                [showLabels]="false"
                [size]="'sm'"
                [variant]="'embedded'"
                [ariaLabel]="'nav.theme' | translate"
              ></app-theme-segmented-control>
              <div class="h-6 w-px bg-slate-200 dark:bg-slate-700"></div>
              <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <span class="sr-only">{{ 'nav.language' | translate }}</span>
                <select
                  class="h-9 rounded-full bg-transparent px-2 text-sm text-slate-900 focus:outline-none [color-scheme:light] dark:text-slate-100 dark:[color-scheme:dark]"
                  [ngModel]="language"
                  (ngModelChange)="onLanguageChange($event)"
                  [attr.aria-label]="'nav.language' | translate"
                >
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="en">EN</option>
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="ro">RO</option>
                </select>
              </label>
            </div>
          </div>
        </nav>
          <nav
            class="hidden lg:flex items-center gap-6 border-t border-slate-200/60 py-2 text-sm font-medium text-slate-700 dark:border-slate-800/60 dark:text-slate-200 overflow-x-auto whitespace-nowrap"
            aria-label="Primary storefront navigation"
          >
            <ng-container *ngFor="let link of storefrontLinks(); trackBy: trackNavLink">
              <a *ngIf="!link.external; else externalStorefrontLink" [routerLink]="link.path" class="hover:text-slate-900 dark:hover:text-white">
                {{ link.translate === false ? link.label : (link.label | translate) }}
              </a>
              <ng-template #externalStorefrontLink>
                <a
                  [href]="link.path"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="hover:text-slate-900 dark:hover:text-white"
                >
                  {{ link.translate === false ? link.label : (link.label | translate) }}
                </a>
              </ng-template>
            </ng-container>
            <button
              *ngIf="isAdmin() && !isImpersonating()"
              type="button"
              class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition"
              [ngClass]="storefrontEditMode() ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'"
              (click)="toggleStorefrontEditMode()"
              [attr.aria-pressed]="storefrontEditMode()"
            >
              {{ 'nav.editMode' | translate }}
            </button>
            <a
              *ngIf="isStaff()"
              routerLink="/admin"
              class="hover:text-slate-900 dark:hover:text-white"
          >
            {{ 'nav.viewAdmin' | translate }}
          </a>
        </nav>
      </div>
      </header>
    <div *ngIf="userMenuOpen || notificationsOpen" class="fixed inset-0 z-40" (click)="closeOverlays()"></div>
    <div *ngIf="searchOpen" class="fixed inset-0 z-50" (click)="closeSearch()">
      <div class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm dark:bg-black/60"></div>
      <div
        class="absolute top-20 left-1/2 -translate-x-1/2 w-[min(92vw,560px)] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        (click)="$event.stopPropagation()"
        role="dialog"
        aria-modal="true"
      >
        <form class="flex gap-2" (submit)="submitSearch($event); closeSearch()">
          <label class="sr-only" for="mobile-search-input">{{ 'shop.searchPlaceholder' | translate }}</label>
          <input
            id="mobile-search-input"
            name="q"
            type="search"
            class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            [placeholder]="'shop.searchPlaceholder' | translate"
            [(ngModel)]="searchQuery"
            (keydown.escape)="closeSearch()"
          />
          <button
            type="submit"
            class="h-10 px-4 rounded-xl bg-slate-900 text-white text-sm font-medium dark:bg-slate-50 dark:text-slate-900"
          >
            {{ 'shop.search' | translate }}
          </button>
        </form>
      </div>
    </div>
    <app-nav-drawer
      [open]="drawerOpen"
      [links]="navLinks()"
      [user]="currentUser()"
      [isAuthenticated]="isAuthenticated()"
      (signOut)="signOut()"
      [themePreference]="themePreference"
      (themeChange)="onThemeChange($event)"
      [language]="language"
      (languageChange)="onLanguageChange($event)"
      (closed)="drawerOpen = false"
    ></app-nav-drawer>
  `
})
export class HeaderComponent implements OnDestroy {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  @Input() themePreference: ThemePreference = 'system';
  @Output() themeChange = new EventEmitter<ThemePreference>();
  private readonly languageSig = signal<'en' | 'ro'>('en');
  @Input() set language(value: string) {
    this.languageSig.set(value === 'ro' ? 'ro' : 'en');
  }
  get language(): string {
    return this.languageSig();
  }
  @Output() languageChange = new EventEmitter<string>();
  drawerOpen = false;
  searchOpen = false;
  userMenuOpen = false;
  notificationsOpen = false;
  searchQuery = '';
  private unreadPoll?: number;
  private readonly bannerPoll?: number;
  private readonly authEffect?: EffectRef;
  private readonly navSub?: Subscription;

  banner = signal<MaintenanceBannerPublic | null>(null);
  private readonly cmsNavigation = signal<SiteNavigationData | null>(null);

    readonly isAuthenticated = computed(() => this.auth.isAuthenticated());
    readonly currentUser = computed(() => this.auth.user());
    readonly isStaff = computed(() => this.auth.isStaff());
    readonly isAdmin = computed(() => this.auth.isAdmin());
    readonly isImpersonating = computed(() => this.auth.isImpersonating());
      readonly storefrontEditMode = this.storefrontAdminMode.enabled;
      readonly notifications = computed(() => this.notificationsService.items());
      readonly notificationsLoading = computed(() => this.notificationsService.loading());
      readonly unreadCount = computed(() => this.notificationsService.unreadCount());
      readonly pwaOnline = computed(() => this.pwa.isOnline());

  private readonly fallbackStorefrontLinks: NavLink[] = [
    { label: 'nav.home', path: '/' },
    { label: 'nav.blog', path: '/blog' },
    { label: 'nav.shop', path: '/shop' },
    { label: 'nav.about', path: '/about' },
    { label: 'nav.contact', path: '/contact' },
    { label: 'nav.terms', path: '/pages/terms' }
  ];

  readonly storefrontLinks = computed<NavLink[]>(() => this.resolveStorefrontLinks());

  readonly navLinks = computed<NavLink[]>(() => {
    const authenticated = this.isAuthenticated();
    const links: NavLink[] = [...this.storefrontLinks()];
    if (authenticated) {
      links.push({ label: 'nav.account', path: '/account' });
    } else {
      links.push({ label: 'nav.signIn', path: '/login' });
      links.push({ label: 'nav.register', path: '/register' });
    }
    if (authenticated && this.isStaff()) {
      links.push({ label: 'nav.admin', path: '/admin' });
    }
    return links;
  });

  private resolveStorefrontLinks(): NavLink[] {
    const nav = this.cmsNavigation();
    const items = nav?.headerLinks ?? [];
    if (!items.length) return this.fallbackStorefrontLinks;
    const links = this.toStorefrontLinks(items, this.languageSig());
    return links.length ? links : this.fallbackStorefrontLinks;
  }

  private toStorefrontLinks(items: SiteNavigationData['headerLinks'], lang: 'en' | 'ro'): NavLink[] {
    return items
      .map((item) => this.toStorefrontLink(item, lang))
      .filter((link): link is NavLink => Boolean(link));
  }

  private toStorefrontLink(item: SiteNavigationData['headerLinks'][number], lang: 'en' | 'ro'): NavLink | null {
    const url = (item.url || '').trim();
    const label = (lang === 'ro' ? item.label.ro : item.label.en).trim();
    if (!url || !label) return null;
    return { label, path: url, translate: false, external: this.isExternalLink(url) };
  }

    constructor(
      private readonly cart: CartStore,
      private readonly router: Router,
      private readonly auth: AuthService,
      private readonly navigation: SiteNavigationService,
      private readonly storefrontAdminMode: StorefrontAdminModeService,
      private readonly notificationsService: NotificationsService,
      private readonly ops: OpsService,
        private readonly pwa: PwaService,
        private readonly toast: ToastService,
        private readonly translate: TranslateService
      ) {
    if (!this.isBrowser) {
      return;
    }

    this.authEffect = effect(() => {
      const authed = this.isAuthenticated();
      if (!authed) {
        this.stopUnreadPolling();
        this.notificationsService.reset();
        this.notificationsOpen = false;
        return;
      }
      this.notificationsService.refreshUnreadCount();
      this.startUnreadPolling();
    });

    this.refreshBanner();
    this.bannerPoll = window.setInterval(() => this.refreshBanner(), 60_000);

    this.navSub = this.navigation.get().subscribe((nav) => this.cmsNavigation.set(nav));
  }

  cartCount = this.cart.count;

    onThemeChange(pref: ThemePreference): void {
      this.themeChange.emit(pref);
    }

    toggleStorefrontEditMode(): void {
      if (this.storefrontEditMode()) {
        this.storefrontAdminMode.setEnabled(false);
        return;
      }
      if (!this.auth.isAdmin() || this.auth.isImpersonating()) return;

      this.auth.checkAdminAccess({ silent: true }).subscribe({
        next: () => {
          this.storefrontAdminMode.setEnabled(true);
        },
        error: (err) => {
          const detail = err?.error?.detail;
          if (detail === 'Two-factor authentication or passkey required for admin access') {
            this.toast.error(this.translate.instant('adminUi.security.mfaRequired'));
            void this.router.navigateByUrl('/account/security');
            return;
          }
          if (
            detail === 'Admin access is blocked from this IP address' ||
            detail === 'Admin access is restricted to approved IP addresses'
          ) {
            this.toast.error(this.translate.instant('adminUi.ipBypass.restricted'));
            const nextUrl = encodeURIComponent(this.router.url || '/admin/dashboard');
            void this.router.navigateByUrl(`/admin/ip-bypass?returnUrl=${nextUrl}`);
            return;
          }
          this.toast.error(detail || this.translate.instant('adminUi.errors.generic'));
        }
      });
    }

      toggleDrawer(): void {
        this.drawerOpen = !this.drawerOpen;
        if (this.drawerOpen) {
          this.searchOpen = false;
        this.userMenuOpen = false;
      this.notificationsOpen = false;
    }
  }

  onLanguageChange(lang: string): void {
    this.languageChange.emit(lang);
  }

  openSearch(): void {
    this.searchOpen = true;
    this.drawerOpen = false;
    this.userMenuOpen = false;
    this.notificationsOpen = false;
  }

  closeSearch(): void {
    this.searchOpen = false;
  }

  toggleUserMenu(): void {
    this.userMenuOpen = !this.userMenuOpen;
    if (this.userMenuOpen) {
      this.searchOpen = false;
      this.drawerOpen = false;
      this.notificationsOpen = false;
    }
  }

  closeUserMenu(): void {
    this.userMenuOpen = false;
  }

  toggleNotifications(): void {
    this.notificationsOpen = !this.notificationsOpen;
    if (this.notificationsOpen) {
      this.searchOpen = false;
      this.drawerOpen = false;
      this.userMenuOpen = false;
      this.notificationsService.load(25);
    }
  }

  closeNotifications(): void {
    this.notificationsOpen = false;
  }

  bannerText(): string | null {
    const banner = this.banner();
    if (!banner) return null;
    const preferred = this.language === 'ro' ? banner.message_ro : banner.message_en;
    const fallback = this.language === 'ro' ? banner.message_en : banner.message_ro;
    const message = (preferred || fallback || '').trim();
    return message || null;
  }

  bannerLinkUrl(): string | null {
    const url = (this.banner()?.link_url || '').trim();
    return url || null;
  }

  bannerLinkLabel(): string | null {
    const banner = this.banner();
    if (!banner) return null;
    const preferred = this.language === 'ro' ? banner.link_label_ro : banner.link_label_en;
    const fallback = this.language === 'ro' ? banner.link_label_en : banner.link_label_ro;
    const label = (preferred || fallback || '').trim();
    return label || null;
  }

  bannerClasses(): string {
    const level = (this.banner()?.level || 'info').toLowerCase();
    if (level === 'warning') {
      return 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100';
    }
    if (level === 'promo') {
      return 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100';
    }
    return 'bg-indigo-50 text-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-100';
  }

  trackNavLink(_: number, link: NavLink): string {
    const label = (link?.label || '').trim();
    const path = (link?.path || '').trim();
    return `${path}|${label}`;
  }

  isExternalLink(url: string): boolean {
    const value = (url || '').trim();
    return value.startsWith('http://') || value.startsWith('https://');
  }

  closeOverlays(): void {
    this.userMenuOpen = false;
    this.notificationsOpen = false;
  }

  unreadBadge(): string {
    const count = this.unreadCount();
    if (count <= 0) return '';
    if (count > 9) return '9+';
    return String(count);
  }

  markRead(n: UserNotification): void {
    this.notificationsService.markRead(n.id);
  }

  dismiss(n: UserNotification): void {
    this.notificationsService.dismiss(n.id);
  }

  openNotification(n: UserNotification): void {
    if (!n.read_at && !n.dismissed_at) {
      this.notificationsService.markRead(n.id);
    }
    this.notificationsOpen = false;
    if (n.url) {
      void this.router.navigateByUrl(n.url);
      return;
    }
    void this.router.navigateByUrl('/account/notifications');
  }

  submitSearch(event: Event): void {
    event.preventDefault();
    const q = this.searchQuery.trim();
    void this.router.navigate(['/shop'], { queryParams: q ? { q } : {} });
  }

  signOut(): void {
    this.drawerOpen = false;
    this.searchOpen = false;
    this.userMenuOpen = false;
    this.notificationsOpen = false;
    this.stopUnreadPolling();
    this.notificationsService.reset();
    this.auth.logout().subscribe();
  }

  ngOnDestroy(): void {
    this.stopUnreadPolling();
    this.navSub?.unsubscribe();
    this.authEffect?.destroy();
    if (this.bannerPoll && this.isBrowser) window.clearInterval(this.bannerPoll);
  }

  private startUnreadPolling(): void {
    if (!this.isBrowser) return;
    if (this.unreadPoll) return;
    this.unreadPoll = window.setInterval(() => this.notificationsService.refreshUnreadCount(), 60_000);
  }

  private stopUnreadPolling(): void {
    if (!this.isBrowser) return;
    if (!this.unreadPoll) return;
    window.clearInterval(this.unreadPoll);
    this.unreadPoll = undefined;
  }

  private refreshBanner(): void {
    this.ops.getActiveBanner().subscribe({
      next: (banner) => this.banner.set(banner),
      error: () => this.banner.set(null)
    });
  }
}
