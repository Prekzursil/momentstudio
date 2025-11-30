import { Component, EventEmitter, Output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '../shared/button.component';
import { NavDrawerComponent, NavLink } from '../shared/nav-drawer.component';
import { NgIf } from '@angular/common';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, ButtonComponent, NavDrawerComponent, NgIf],
  template: `
    <header class="border-b border-slate-200 bg-white/80 backdrop-blur">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-6">
        <a routerLink="/" class="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span class="h-10 w-10 rounded-full bg-slate-900 text-white grid place-items-center font-bold">AA</span>
          <span>AdrianaArt</span>
        </a>
        <nav class="hidden md:flex items-center gap-6 text-sm font-medium text-slate-700">
          <a routerLink="/" class="hover:text-slate-900">Home</a>
          <a routerLink="/shop" class="hover:text-slate-900">Shop</a>
          <a routerLink="/about" class="hover:text-slate-900">About</a>
        </nav>
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="md:hidden text-slate-700 hover:text-slate-900"
            (click)="drawerOpen = true"
            aria-label="Open navigation"
          >
            ☰
          </button>
          <button type="button" class="text-sm font-medium text-slate-700 hover:text-slate-900 hidden sm:inline">
            Sign in
          </button>
          <app-button label="Toggle theme" size="sm" variant="ghost" (action)="toggleTheme.emit()"></app-button>
        </div>
      </div>
    </header>
    <app-nav-drawer [open]="drawerOpen" [links]="navLinks" (closed)="drawerOpen = false"></app-nav-drawer>
  `
})
export class HeaderComponent {
  @Output() toggleTheme = new EventEmitter<void>();
  drawerOpen = false;
  navLinks: NavLink[] = [
    { label: 'Home', path: '/' },
    { label: 'Shop', path: '/shop' },
    { label: 'About', path: '/about' },
    { label: 'Admin', path: '/admin' }
  ];
}
