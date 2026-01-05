import { NgClass, NgForOf, NgIf } from '@angular/common';
import { Component, ElementRef, HostListener } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [NgIf, NgForOf, NgClass, TranslateModule],
  template: `
    <footer class="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
        <p class="font-medium text-slate-700 dark:text-slate-100">{{ 'app.name' | translate }}</p>
        <p class="text-slate-500 dark:text-slate-400">{{ 'footer.tagline' | translate }}</p>
        <div class="flex flex-wrap items-center justify-center gap-4">
          <div class="relative" data-footer-dropdown>
            <button
              type="button"
              class="inline-flex items-center gap-1 font-medium hover:text-slate-900 dark:hover:text-white"
              (click)="toggleMenu('instagram')"
              [attr.aria-expanded]="openMenu === 'instagram'"
              aria-haspopup="menu"
            >
              {{ 'footer.instagram' | translate }}
              <span class="text-xs text-slate-500 dark:text-slate-400">▴</span>
            </button>
            <div
              *ngIf="openMenu === 'instagram'"
              class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden dark:border-slate-700 dark:bg-slate-900"
              role="menu"
            >
              <a
                *ngFor="let page of instagramPages"
                class="flex items-center gap-3 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
                [href]="page.url"
                target="_blank"
                rel="noopener noreferrer"
                (click)="closeMenu()"
                role="menuitem"
              >
                <span class="h-8 w-8 rounded-full grid place-items-center text-xs font-semibold text-white" [ngClass]="page.avatarClass">
                  {{ page.initials }}
                </span>
                <span class="truncate">{{ page.name }}</span>
              </a>
            </div>
          </div>

          <div class="relative" data-footer-dropdown>
            <button
              type="button"
              class="inline-flex items-center gap-1 font-medium hover:text-slate-900 dark:hover:text-white"
              (click)="toggleMenu('facebook')"
              [attr.aria-expanded]="openMenu === 'facebook'"
              aria-haspopup="menu"
            >
              {{ 'footer.facebook' | translate }}
              <span class="text-xs text-slate-500 dark:text-slate-400">▴</span>
            </button>
            <div
              *ngIf="openMenu === 'facebook'"
              class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden dark:border-slate-700 dark:bg-slate-900"
              role="menu"
            >
              <a
                *ngFor="let page of facebookPages"
                class="flex items-center gap-3 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
                [href]="page.url"
                target="_blank"
                rel="noopener noreferrer"
                (click)="closeMenu()"
                role="menuitem"
              >
                <span class="h-8 w-8 rounded-full grid place-items-center text-xs font-semibold text-white" [ngClass]="page.avatarClass">
                  {{ page.initials }}
                </span>
                <span class="truncate">{{ page.name }}</span>
              </a>
            </div>
          </div>

          <a class="font-medium hover:text-slate-900 dark:hover:text-white" href="#">{{ 'footer.contact' | translate }}</a>
        </div>
      </div>
    </footer>
  `
})
export class FooterComponent {
  openMenu: 'instagram' | 'facebook' | null = null;

  readonly instagramPages = [
    {
      name: 'Moments in Clay - Studio',
      url: 'https://www.instagram.com/moments_in_clay_studio?igsh=ZmdnZTdudnNieDQx',
      initials: 'MC',
      avatarClass: 'bg-gradient-to-br from-fuchsia-500 to-rose-500'
    },
    {
      name: 'AdrianaArt',
      url: 'https://www.instagram.com/adrianaartizanat?igsh=ZmZmaDU1MGcxZHEy',
      initials: 'AA',
      avatarClass: 'bg-gradient-to-br from-indigo-500 to-sky-500'
    }
  ];

  readonly facebookPages = [
    {
      name: 'Moments in Clay - Studio',
      url: 'https://www.facebook.com/share/17YqBmfX5x/',
      initials: 'MC',
      avatarClass: 'bg-gradient-to-br from-blue-600 to-sky-500'
    },
    {
      name: 'AdrianaArt',
      url: 'https://www.facebook.com/share/1APqKJM6Zi/',
      initials: 'AA',
      avatarClass: 'bg-gradient-to-br from-blue-600 to-indigo-600'
    }
  ];

  constructor(private elementRef: ElementRef<HTMLElement>) {}

  toggleMenu(menu: 'instagram' | 'facebook'): void {
    this.openMenu = this.openMenu === menu ? null : menu;
  }

  closeMenu(): void {
    this.openMenu = null;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.openMenu) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('[data-footer-dropdown]')) return;
    this.openMenu = null;
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.openMenu = null;
    }
  }
}
