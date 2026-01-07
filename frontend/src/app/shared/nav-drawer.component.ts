import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgClass, NgForOf, NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { formatIdentity, initialsFromIdentity } from './user-identity';
import { ThemePreference } from '../core/theme.service';
import { ThemeSegmentedControlComponent } from './theme-segmented-control.component';

export interface NavLink {
  label: string;
  path: string;
}

export interface NavDrawerUser {
  email: string;
  username: string;
  name?: string | null;
  name_tag?: number | null;
  avatar_url?: string | null;
  google_picture_url?: string | null;
}

@Component({
  selector: 'app-nav-drawer',
  standalone: true,
  imports: [NgForOf, NgClass, NgIf, RouterLink, TranslateModule, FormsModule, ThemeSegmentedControlComponent],
  template: `
    <div
      class="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm transition-opacity dark:bg-black/60"
      [ngClass]="{ 'opacity-0 pointer-events-none': !open }"
      (click)="onClose()"
    ></div>
    <aside
      class="fixed inset-y-0 left-0 z-50 w-72 overflow-x-hidden bg-white shadow-xl border-r border-slate-200 transform transition-transform dark:bg-slate-900 dark:border-slate-700"
      [ngClass]="{ '-translate-x-full': !open, 'translate-x-0': open }"
      role="dialog"
      aria-modal="true"
    >
      <div class="p-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-700">
        <span class="font-semibold text-slate-900 dark:text-slate-50">{{ 'nav.menu' | translate }}</span>
        <button
          class="text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          (click)="onClose()"
          aria-label="Close menu"
        >
          ✕
        </button>
      </div>
      <div *ngIf="user" class="p-4 border-b border-slate-200 dark:border-slate-700">
        <div class="flex items-center gap-3">
          <img
            *ngIf="avatarUrl() as src"
            class="h-10 w-10 rounded-full object-cover border border-slate-200 dark:border-slate-800 shrink-0"
            [src]="src"
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
          />
          <div
            *ngIf="!avatarUrl()"
            class="h-10 w-10 rounded-full bg-slate-200 text-slate-700 grid place-items-center font-semibold dark:bg-slate-800 dark:text-slate-200 shrink-0"
            aria-hidden="true"
          >
            {{ initials() }}
          </div>
          <div class="min-w-0">
            <div class="font-semibold text-slate-900 dark:text-slate-50 truncate">
              {{ displayName() }}
            </div>
            <div class="text-xs text-slate-500 dark:text-slate-400 truncate">
              {{ user.email }}
            </div>
          </div>
        </div>
      </div>
      <nav class="p-4 grid gap-3">
        <a
          *ngFor="let link of links"
          [routerLink]="link.path"
          (click)="onClose()"
          class="text-slate-800 hover:text-slate-900 font-medium dark:text-slate-200 dark:hover:text-white"
        >
          {{ link.label | translate }}
        </a>
      </nav>
      <div class="p-4 border-t border-slate-200 dark:border-slate-700">
        <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
          {{ 'nav.preferences' | translate }}
        </div>
        <div class="mt-3 grid gap-3">
          <div class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'nav.theme' | translate }}</span>
            <app-theme-segmented-control
              class="w-full"
              [preference]="themePreference"
              (preferenceChange)="onThemeChange($event)"
              [showLabels]="true"
              [size]="'lg'"
              [stretch]="true"
              [layout]="'stacked'"
              [ariaLabel]="'nav.theme' | translate"
            ></app-theme-segmented-control>
          </div>
          <label class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'nav.language' | translate }}</span>
            <select
              class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
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
      <div *ngIf="isAuthenticated" class="p-4 border-t border-slate-200 dark:border-slate-700">
        <button
          type="button"
          class="w-full h-11 rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200 dark:hover:bg-rose-950/40"
          (click)="onSignOut()"
        >
          {{ 'nav.signOut' | translate }}
        </button>
      </div>
    </aside>
  `
})
export class NavDrawerComponent {
  @Input() open = false;
  @Input() links: NavLink[] = [];
  @Input() user: NavDrawerUser | null = null;
  @Input() isAuthenticated = false;
  @Output() signOut = new EventEmitter<void>();
  @Input() themePreference: ThemePreference = 'system';
  @Output() themeChange = new EventEmitter<ThemePreference>();
  @Input() language = 'en';
  @Output() languageChange = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();

  onClose(): void {
    this.closed.emit();
  }

  onSignOut(): void {
    this.signOut.emit();
    this.onClose();
  }

  onThemeChange(pref: ThemePreference): void {
    this.themeChange.emit(pref);
  }

  onLanguageChange(lang: string): void {
    this.languageChange.emit(lang);
  }

  avatarUrl(): string | null {
    const user = this.user;
    if (!user) return null;
    return user.avatar_url || user.google_picture_url || null;
  }

  displayName(): string {
    return formatIdentity(this.user, '');
  }

  initials(): string {
    return initialsFromIdentity(this.user, '?');
  }
}
