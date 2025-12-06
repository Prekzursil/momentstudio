import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '../shared/button.component';
import { NavDrawerComponent, NavLink } from '../shared/nav-drawer.component';
import { NgIf, NgForOf } from '@angular/common';
import { CartStore } from '../core/cart.store';
import { ThemePreference } from '../core/theme.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, ButtonComponent, NavDrawerComponent, NgIf, NgForOf, FormsModule],
  template: `
    <header class="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-6">
        <a routerLink="/" class="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          <span class="h-10 w-10 rounded-full bg-slate-900 text-white grid place-items-center font-bold dark:bg-slate-50 dark:text-slate-900">AA</span>
          <span>AdrianaArt</span>
        </a>
        <nav class="hidden md:flex items-center gap-6 text-sm font-medium text-slate-700 dark:text-slate-200">
          <a routerLink="/" class="hover:text-slate-900 dark:hover:text-white">Home</a>
          <a routerLink="/shop" class="hover:text-slate-900 dark:hover:text-white">Shop</a>
          <a routerLink="/about" class="hover:text-slate-900 dark:hover:text-white">About</a>
        </nav>
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="md:hidden text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
            (click)="drawerOpen = true"
            aria-label="Open navigation"
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
            Sign in
          </a>
          <label class="hidden sm:flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <span class="sr-only">Theme</span>
            <select
              class="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [ngModel]="themePreference"
              (ngModelChange)="onThemeChange($event)"
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <app-button label="Theme" size="sm" variant="ghost" class="sm:hidden" (action)="cycleTheme()"></app-button>
        </div>
      </div>
    </header>
    <app-nav-drawer [open]="drawerOpen" [links]="navLinks" (closed)="drawerOpen = false"></app-nav-drawer>
  `
})
export class HeaderComponent {
  @Input() themePreference: ThemePreference = 'system';
  @Output() themeChange = new EventEmitter<ThemePreference>();
  drawerOpen = false;
  navLinks: NavLink[] = [
    { label: 'Home', path: '/' },
    { label: 'Shop', path: '/shop' },
    { label: 'About', path: '/about' },
    { label: 'Admin', path: '/admin' }
  ];

  constructor(private cart: CartStore) {}

  cartCount = this.cart.count;

  onThemeChange(pref: ThemePreference): void {
    this.themeChange.emit(pref);
  }

  cycleTheme(): void {
    const order: ThemePreference[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(this.themePreference) + 1) % order.length];
    this.onThemeChange(next);
  }
}
