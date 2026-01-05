import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '../shared/button.component';
import { NavDrawerComponent, NavLink } from '../shared/nav-drawer.component';
import { NgIf, NgForOf } from '@angular/common';
import { CartStore } from '../core/cart.store';
import { ThemePreference } from '../core/theme.service';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, ButtonComponent, NavDrawerComponent, NgIf, NgForOf, FormsModule, TranslateModule],
  template: `
    <header class="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-6">
        <a routerLink="/" class="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          <span class="h-10 w-10 rounded-full bg-slate-900 text-white grid place-items-center font-bold dark:bg-slate-50 dark:text-slate-900">AA</span>
          <span>{{ 'app.name' | translate }}</span>
        </a>
        <nav class="hidden md:flex items-center gap-6 text-sm font-medium text-slate-700 dark:text-slate-200">
          <a routerLink="/" class="hover:text-slate-900 dark:hover:text-white">{{ 'nav.home' | translate }}</a>
          <a routerLink="/shop" class="hover:text-slate-900 dark:hover:text-white">{{ 'nav.shop' | translate }}</a>
          <a routerLink="/about" class="hover:text-slate-900 dark:hover:text-white">{{ 'nav.about' | translate }}</a>
        </nav>
        <form class="hidden md:flex flex-1 justify-center" (submit)="submitSearch($event)">
          <div class="relative w-full max-w-md">
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
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="md:hidden text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
            (click)="toggleDrawer()"
            aria-label="Open navigation"
            [attr.aria-expanded]="drawerOpen"
          >
            ☰
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
                class="h-9 rounded-full bg-transparent px-2 text-sm text-slate-900 focus:outline-none dark:text-slate-100"
                [ngModel]="themePreference"
                (ngModelChange)="onThemeChange($event)"
                aria-label="Theme"
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <div class="h-6 w-px bg-slate-200 dark:bg-slate-700"></div>
            <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <span class="sr-only">Language</span>
              <select
                class="h-9 rounded-full bg-transparent px-2 text-sm text-slate-900 focus:outline-none dark:text-slate-100"
                [ngModel]="language"
                (ngModelChange)="onLanguageChange($event)"
                aria-label="Language"
              >
                <option value="en">EN</option>
                <option value="ro">RO</option>
              </select>
            </label>
          </div>
          <app-button label="Theme" size="sm" variant="ghost" class="sm:hidden" (action)="cycleTheme()"></app-button>
          <label class="sm:hidden flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <span class="sr-only">Language</span>
            <select
              class="h-10 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [ngModel]="language"
              (ngModelChange)="onLanguageChange($event)"
              aria-label="Language"
            >
              <option value="en">EN</option>
              <option value="ro">RO</option>
            </select>
          </label>
        </div>
      </div>
    </header>
    <app-nav-drawer [open]="drawerOpen" [links]="navLinks" (closed)="drawerOpen = false"></app-nav-drawer>
  `
})
export class HeaderComponent {
  @Input() themePreference: ThemePreference = 'system';
  @Output() themeChange = new EventEmitter<ThemePreference>();
  @Input() language = 'en';
  @Output() languageChange = new EventEmitter<string>();
  drawerOpen = false;
  searchQuery = '';
  navLinks: NavLink[] = [
    { label: 'nav.home', path: '/' },
    { label: 'nav.shop', path: '/shop' },
    { label: 'nav.about', path: '/about' },
    { label: 'nav.admin', path: '/admin' }
  ];

  constructor(private cart: CartStore, private router: Router) {}

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
  }

  onLanguageChange(lang: string): void {
    this.languageChange.emit(lang);
  }

  submitSearch(event: Event): void {
    event.preventDefault();
    const q = this.searchQuery.trim();
    void this.router.navigate(['/shop'], { queryParams: q ? { q } : {} });
  }
}
