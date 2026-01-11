import { Component, EffectRef, EventEmitter, Input, Output, computed, effect, OnDestroy } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NavDrawerComponent, NavLink } from '../shared/nav-drawer.component';
import { DatePipe, NgClass, NgForOf, NgIf } from '@angular/common';
import { CartStore } from '../core/cart.store';
import { ThemePreference } from '../core/theme.service';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../core/auth.service';
import { ThemeSegmentedControlComponent } from '../shared/theme-segmented-control.component';
import { NotificationsService, UserNotification } from '../core/notifications.service';

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
    ThemeSegmentedControlComponent
  ],
  template: `
    <header class="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
      <div class="max-w-7xl mx-auto px-4 sm:px-6">
        <div class="py-4 grid grid-cols-[auto,1fr,auto] items-center gap-4">
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
              <input
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
                🔎
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
              ☰
            </button>
            <button
              type="button"
              class="lg:hidden inline-flex items-center justify-center h-10 w-10 rounded-full bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100"
              aria-label="Search"
              (click)="openSearch()"
            >
              🔎
            </button>
            <a
              routerLink="/cart"
              class="relative inline-flex items-center justify-center h-10 w-10 rounded-full bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100"
              [attr.aria-label]="'Cart with ' + cartCount() + ' items'"
            >
              🛒
              <span
                *ngIf="cartCount() > 0"
                class="absolute -top-1 -right-1 min-w-[20px] rounded-full bg-slate-900 px-1 text-[11px] font-semibold text-white text-center dark:bg-slate-50 dark:text-slate-900"
              >
                {{ cartCount() }}
              </span>
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
                class="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900 z-50"
                role="menu"
              >
                <a
                  routerLink="/account"
                  role="menuitem"
                  class="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
                  (click)="closeUserMenu()"
                >
                  {{ 'nav.myProfile' | translate }}
                </a>
                <button
                  type="button"
                  role="menuitem"
                  class="w-full text-left rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
                  (click)="signOut()"
                >
                  {{ 'nav.signOut' | translate }}
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
                🔔
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
        </div>
        <nav class="hidden lg:flex items-center gap-6 border-t border-slate-200/60 py-2 text-sm font-medium text-slate-700 dark:border-slate-800/60 dark:text-slate-200 overflow-x-auto whitespace-nowrap">
          <a routerLink="/" class="hover:text-slate-900 dark:hover:text-white">{{ 'nav.home' | translate }}</a>
          <a routerLink="/blog" class="hover:text-slate-900 dark:hover:text-white">{{ 'nav.blog' | translate }}</a>
          <a routerLink="/shop" class="hover:text-slate-900 dark:hover:text-white">{{ 'nav.shop' | translate }}</a>
          <a routerLink="/about" class="hover:text-slate-900 dark:hover:text-white">{{ 'nav.about' | translate }}</a>
          <a routerLink="/contact" class="hover:text-slate-900 dark:hover:text-white">{{ 'nav.contact' | translate }}</a>
          <a
            *ngIf="isAdmin()"
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
          <input
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
  @Input() themePreference: ThemePreference = 'system';
  @Output() themeChange = new EventEmitter<ThemePreference>();
  @Input() language = 'en';
  @Output() languageChange = new EventEmitter<string>();
  drawerOpen = false;
  searchOpen = false;
  userMenuOpen = false;
  notificationsOpen = false;
  searchQuery = '';
  private unreadPoll?: number;
  private authEffect?: EffectRef;

  readonly isAuthenticated = computed(() => Boolean(this.auth.user()));
  readonly currentUser = computed(() => this.auth.user());
  readonly isAdmin = computed(() => this.auth.isAdmin());
  readonly notifications = computed(() => this.notificationsService.items());
  readonly notificationsLoading = computed(() => this.notificationsService.loading());
  readonly unreadCount = computed(() => this.notificationsService.unreadCount());

  readonly navLinks = computed<NavLink[]>(() => {
    const authenticated = this.isAuthenticated();
    const links: NavLink[] = [
      { label: 'nav.home', path: '/' },
      { label: 'nav.blog', path: '/blog' },
      { label: 'nav.shop', path: '/shop' },
      { label: 'nav.about', path: '/about' },
      { label: 'nav.contact', path: '/contact' }
    ];
    if (authenticated) {
      links.push({ label: 'nav.account', path: '/account' });
    } else {
      links.push({ label: 'nav.signIn', path: '/login' });
      links.push({ label: 'nav.register', path: '/register' });
    }
    if (this.auth.isAdmin()) {
      links.push({ label: 'nav.admin', path: '/admin' });
    }
    return links;
  });

  constructor(
    private cart: CartStore,
    private router: Router,
    private auth: AuthService,
    private notificationsService: NotificationsService
  ) {
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
  }

  cartCount = this.cart.count;

  onThemeChange(pref: ThemePreference): void {
    this.themeChange.emit(pref);
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
    }
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
    this.authEffect?.destroy();
  }

  private startUnreadPolling(): void {
    if (this.unreadPoll) return;
    this.unreadPoll = window.setInterval(() => this.notificationsService.refreshUnreadCount(), 60_000);
  }

  private stopUnreadPolling(): void {
    if (!this.unreadPoll) return;
    window.clearInterval(this.unreadPoll);
    this.unreadPoll = undefined;
  }
}
