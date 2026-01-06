import { Component, EventEmitter, Input, Output, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '../shared/button.component';
import { NavDrawerComponent, NavLink } from '../shared/nav-drawer.component';
import { NgIf, NgForOf } from '@angular/common';
import { CartStore } from '../core/cart.store';
import { ThemePreference } from '../core/theme.service';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, ButtonComponent, NavDrawerComponent, NgIf, NgForOf, FormsModule, TranslateModule],
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
            <a routerLink="/login" class="text-sm font-medium text-slate-700 hover:text-slate-900 hidden sm:inline dark:text-slate-200 dark:hover:text-white">
              {{ 'nav.signIn' | translate }}
            </a>
            <div class="hidden sm:flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-2 py-1 shadow-sm dark:border-slate-700 dark:bg-slate-800/70">
              <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <span class="sr-only">Theme</span>
                <select
                  class="h-9 rounded-full bg-transparent px-2 text-sm text-slate-900 focus:outline-none [color-scheme:light] dark:text-slate-100 dark:[color-scheme:dark]"
                  [ngModel]="themePreference"
                  (ngModelChange)="onThemeChange($event)"
                  aria-label="Theme"
                >
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="system">System</option>
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="light">Light</option>
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="dark">Dark</option>
                </select>
              </label>
              <div class="h-6 w-px bg-slate-200 dark:bg-slate-700"></div>
              <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <span class="sr-only">Language</span>
                <select
                  class="h-9 rounded-full bg-transparent px-2 text-sm text-slate-900 focus:outline-none [color-scheme:light] dark:text-slate-100 dark:[color-scheme:dark]"
                  [ngModel]="language"
                  (ngModelChange)="onLanguageChange($event)"
                  aria-label="Language"
                >
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="en">EN</option>
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="ro">RO</option>
                </select>
              </label>
            </div>
            <app-button label="Theme" size="sm" variant="ghost" class="sm:hidden" (action)="cycleTheme()"></app-button>
            <label class="sm:hidden flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <span class="sr-only">Language</span>
              <select
                class="h-10 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
                [ngModel]="language"
                (ngModelChange)="onLanguageChange($event)"
                aria-label="Language"
              >
                <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="en">EN</option>
                <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="ro">RO</option>
              </select>
            </label>
          </div>
        </div>
        <nav class="hidden lg:flex items-center gap-6 border-t border-slate-200/60 py-2 text-sm font-medium text-slate-700 dark:border-slate-800/60 dark:text-slate-200 overflow-x-auto whitespace-nowrap">
          <a routerLink="/" class="hover:text-slate-900 dark:hover:text-white">{{ 'nav.home' | translate }}</a>
          <a routerLink="/blog" class="hover:text-slate-900 dark:hover:text-white">{{ 'nav.blog' | translate }}</a>
          <a routerLink="/shop" class="hover:text-slate-900 dark:hover:text-white">{{ 'nav.shop' | translate }}</a>
          <a routerLink="/about" class="hover:text-slate-900 dark:hover:text-white">{{ 'nav.about' | translate }}</a>
          <a routerLink="/contact" class="hover:text-slate-900 dark:hover:text-white">{{ 'nav.contact' | translate }}</a>
        </nav>
      </div>
    </header>
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
    <app-nav-drawer [open]="drawerOpen" [links]="navLinks()" (closed)="drawerOpen = false"></app-nav-drawer>
  `
})
export class HeaderComponent {
  @Input() themePreference: ThemePreference = 'system';
  @Output() themeChange = new EventEmitter<ThemePreference>();
  @Input() language = 'en';
  @Output() languageChange = new EventEmitter<string>();
  drawerOpen = false;
  searchOpen = false;
  searchQuery = '';

  readonly navLinks = computed<NavLink[]>(() => {
    const links: NavLink[] = [
      { label: 'nav.home', path: '/' },
      { label: 'nav.blog', path: '/blog' },
      { label: 'nav.shop', path: '/shop' },
      { label: 'nav.about', path: '/about' },
      { label: 'nav.contact', path: '/contact' }
    ];
    if (this.auth.role() === 'admin') {
      links.push({ label: 'nav.admin', path: '/admin' });
    }
    return links;
  });

  constructor(
    private cart: CartStore,
    private router: Router,
    private auth: AuthService
  ) {}

  cartCount = this.cart.count;

  onThemeChange(pref: ThemePreference): void {
    this.themeChange.emit(pref);
  }

  cycleTheme(): void {
    const order: ThemePreference[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(this.themePreference) + 1) % order.length];
    this.onThemeChange(next);
  }

  toggleDrawer(): void {
    this.drawerOpen = !this.drawerOpen;
    if (this.drawerOpen) {
      this.searchOpen = false;
    }
  }

  onLanguageChange(lang: string): void {
    this.languageChange.emit(lang);
  }

  openSearch(): void {
    this.searchOpen = true;
    this.drawerOpen = false;
  }

  closeSearch(): void {
    this.searchOpen = false;
  }

  submitSearch(event: Event): void {
    event.preventDefault();
    const q = this.searchQuery.trim();
    void this.router.navigate(['/shop'], { queryParams: q ? { q } : {} });
  }
}
