import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgClass, NgForOf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';

export interface NavLink {
  label: string;
  path: string;
}

export type ThemePreference = 'system' | 'light' | 'dark';

@Component({
  selector: 'app-nav-drawer',
  standalone: true,
  imports: [NgForOf, NgClass, RouterLink, TranslateModule, FormsModule],
  template: `
    <div
      class="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm transition-opacity dark:bg-black/60"
      [ngClass]="{ 'opacity-0 pointer-events-none': !open }"
      (click)="onClose()"
    ></div>
    <aside
      class="fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-xl border-r border-slate-200 transform transition-transform dark:bg-slate-900 dark:border-slate-700"
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
          <label class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'nav.theme' | translate }}</span>
            <select
              class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
              [ngModel]="themePreference"
              (ngModelChange)="onThemeChange($event)"
              aria-label="Theme"
            >
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="system">System</option>
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="light">Light</option>
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="dark">Dark</option>
            </select>
          </label>
          <label class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'nav.language' | translate }}</span>
            <select
              class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
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
    </aside>
  `
})
export class NavDrawerComponent {
  @Input() open = false;
  @Input() links: NavLink[] = [];
  @Input() themePreference: ThemePreference = 'system';
  @Output() themeChange = new EventEmitter<ThemePreference>();
  @Input() language = 'en';
  @Output() languageChange = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();

  onClose(): void {
    this.closed.emit();
  }

  onThemeChange(pref: ThemePreference): void {
    this.themeChange.emit(pref);
  }

  onLanguageChange(lang: string): void {
    this.languageChange.emit(lang);
  }
}
