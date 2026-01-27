import { NgClass, NgForOf, NgIf } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

import { SiteCompanyInfo, SiteCompanyService } from '../core/site-company.service';
import { SiteSocialService, SiteSocialLink } from '../core/site-social.service';
import { ImgFallbackDirective } from '../shared/img-fallback.directive';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [NgIf, NgForOf, NgClass, RouterLink, TranslateModule, ImgFallbackDirective],
  template: `
    <footer class="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid gap-10 lg:grid-cols-4 text-sm text-slate-600 dark:text-slate-300">
        <div class="grid gap-4">
          <div class="grid gap-1">
            <p class="text-lg font-semibold text-slate-900 dark:text-slate-100">{{ 'app.name' | translate }}</p>
            <p class="text-slate-500 dark:text-slate-400">{{ 'app.tagline' | translate }}</p>
          </div>

          <div class="flex flex-wrap items-center gap-4">
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
                class="absolute bottom-full left-0 mb-2 w-72 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden dark:border-slate-700 dark:bg-slate-900"
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
                  <ng-container *ngIf="page.thumbnailUrl; else instagramAvatar">
                    <img
                      [src]="page.thumbnailUrl"
                      [alt]="page.label"
                      class="h-8 w-8 rounded-full border border-slate-200 object-cover dark:border-slate-700"
                      appImgFallback="assets/placeholder/avatar-placeholder.svg"
                      loading="lazy"
                    />
                  </ng-container>
                  <ng-template #instagramAvatar>
                    <span class="h-8 w-8 rounded-full grid place-items-center text-xs font-semibold text-white" [ngClass]="page.avatarClass">
                      {{ page.initials }}
                    </span>
                  </ng-template>
                  <span class="truncate">{{ page.label }}</span>
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
                class="absolute bottom-full left-0 mb-2 w-72 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden dark:border-slate-700 dark:bg-slate-900"
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
                  <ng-container *ngIf="page.thumbnailUrl; else facebookAvatar">
                    <img
                      [src]="page.thumbnailUrl"
                      [alt]="page.label"
                      class="h-8 w-8 rounded-full border border-slate-200 object-cover dark:border-slate-700"
                      appImgFallback="assets/placeholder/avatar-placeholder.svg"
                      loading="lazy"
                    />
                  </ng-container>
                  <ng-template #facebookAvatar>
                    <span class="h-8 w-8 rounded-full grid place-items-center text-xs font-semibold text-white" [ngClass]="page.avatarClass">
                      {{ page.initials }}
                    </span>
                  </ng-template>
                  <span class="truncate">{{ page.label }}</span>
                </a>
              </div>
            </div>

            <a class="font-medium hover:text-slate-900 dark:hover:text-white" routerLink="/contact">{{ 'footer.contact' | translate }}</a>
          </div>
        </div>

        <div class="grid gap-2 content-start">
          <p class="font-semibold text-slate-900 dark:text-slate-100">{{ 'footer.handcraftedArt' | translate }}</p>
          <a class="hover:text-slate-900 dark:hover:text-white" routerLink="/shop">{{ 'nav.shop' | translate }}</a>
          <a class="hover:text-slate-900 dark:hover:text-white" routerLink="/about">{{ 'nav.about' | translate }}</a>
          <a class="hover:text-slate-900 dark:hover:text-white" routerLink="/contact">{{ 'nav.contact' | translate }}</a>
          <a class="hover:text-slate-900 dark:hover:text-white" routerLink="/pages/terms">{{ 'nav.terms' | translate }}</a>
        </div>

        <div class="grid gap-2 content-start">
          <p class="font-semibold text-slate-900 dark:text-slate-100">{{ 'footer.legal' | translate }}</p>
          <a class="hover:text-slate-900 dark:hover:text-white" routerLink="/pages/terms">{{ 'nav.terms' | translate }}</a>
          <a class="hover:text-slate-900 dark:hover:text-white" routerLink="/pages/privacy-policy">{{ 'footer.privacyPolicy' | translate }}</a>
          <a class="hover:text-slate-900 dark:hover:text-white" routerLink="/pages/anpc">{{ 'footer.anpc' | translate }}</a>
        </div>

        <div class="grid gap-2 content-start">
          <p class="font-semibold text-slate-900 dark:text-slate-100">{{ 'footer.companyInfo' | translate }}</p>
          <p *ngIf="companyInfo.name" class="font-medium text-slate-800 dark:text-slate-100">{{ companyInfo.name }}</p>
          <p *ngIf="companyInfo.registrationNumber">{{ 'footer.registrationNumber' | translate }}: {{ companyInfo.registrationNumber }}</p>
          <p *ngIf="companyInfo.cui">{{ 'footer.cui' | translate }}: {{ companyInfo.cui }}</p>
          <p *ngIf="companyInfo.address">{{ 'footer.address' | translate }}: {{ companyInfo.address }}</p>
          <p *ngIf="companyInfo.phone">{{ 'footer.phone' | translate }}: {{ companyInfo.phone }}</p>
          <p *ngIf="companyInfo.email">{{ 'footer.email' | translate }}: {{ companyInfo.email }}</p>
        </div>
      </div>
    </footer>
  `
})
export class FooterComponent implements OnInit, OnDestroy {
  openMenu: 'instagram' | 'facebook' | null = null;

  instagramPages: Array<{ label: string; url: string; thumbnailUrl?: string | null; initials: string; avatarClass: string }> = [];
  facebookPages: Array<{ label: string; url: string; thumbnailUrl?: string | null; initials: string; avatarClass: string }> = [];
  companyInfo: SiteCompanyInfo = {
    name: null,
    registrationNumber: null,
    cui: null,
    address: null,
    phone: null,
    email: null
  };

  private socialSub?: Subscription;
  private companySub?: Subscription;

  constructor(
    private elementRef: ElementRef<HTMLElement>,
    private social: SiteSocialService,
    private company: SiteCompanyService
  ) {}

  ngOnInit(): void {
    this.socialSub = this.social.get().subscribe((data) => {
      this.instagramPages = this.toFooterPages('instagram', data.instagramPages);
      this.facebookPages = this.toFooterPages('facebook', data.facebookPages);
    });
    this.companySub = this.company.get().subscribe((info) => {
      this.companyInfo = info;
    });
  }

  ngOnDestroy(): void {
    this.socialSub?.unsubscribe();
    this.companySub?.unsubscribe();
  }

  private toFooterPages(
    platform: 'instagram' | 'facebook',
    pages: SiteSocialLink[]
  ): Array<{ label: string; url: string; thumbnailUrl?: string | null; initials: string; avatarClass: string }> {
    const palettes =
      platform === 'instagram'
        ? ['bg-gradient-to-br from-fuchsia-500 to-rose-500', 'bg-gradient-to-br from-amber-500 to-rose-500']
        : ['bg-gradient-to-br from-blue-600 to-sky-500', 'bg-gradient-to-br from-blue-600 to-fuchsia-500'];
    return pages.map((page, index) => ({
      label: page.label,
      url: page.url,
      thumbnailUrl: page.thumbnail_url || null,
      initials: this.initialsForLabel(page.label),
      avatarClass: palettes[index % palettes.length]
    }));
  }

  private initialsForLabel(label: string): string {
    const cleaned = (label || '').trim();
    if (!cleaned) return 'MS';
    const parts = cleaned.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? cleaned[0] ?? 'M';
    const second = parts[1]?.[0] ?? parts[0]?.[1] ?? 'S';
    return `${first}${second}`.toUpperCase();
  }

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
