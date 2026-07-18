import { NgClass, NgForOf, NgIf } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

import { SiteCompanyInfo, SiteCompanyService } from '../core/site-company.service';
import { SiteNavigationLink, SiteNavigationService } from '../core/site-navigation.service';
import { SiteSocialService, SiteSocialLink } from '../core/site-social.service';
import { ImgFallbackDirective } from '../shared/img-fallback.directive';

type FooterSocialPage = {
  label: string;
  url: string;
  thumbnailUrl?: string | null;
  initials: string;
  avatarClass: string;
};

const DEFAULT_INSTAGRAM_PAGES: SiteSocialLink[] = [
  { label: 'Moments in Clay - Studio', url: 'https://www.instagram.com/moments_in_clay_studio/' },
  { label: 'adrianaartizanat', url: 'https://www.instagram.com/adrianaartizanat/' },
];

const DEFAULT_FACEBOOK_PAGES: SiteSocialLink[] = [
  { label: 'Moments in Clay - Studio', url: 'https://www.facebook.com/moments.in.clay.studio' },
  { label: 'adrianaartizanat', url: 'https://www.facebook.com/adrianaartizanat' },
];

@Component({
  selector: 'app-footer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIf, NgForOf, NgClass, RouterLink, TranslateModule, ImgFallbackDirective],
  template: `
    <footer class="border-t border-border bg-background">
      <div
        class="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid gap-10 lg:grid-cols-4 text-sm text-text-secondary"
      >
        <section class="grid gap-4" aria-labelledby="footer-brand-heading">
          <div class="grid gap-1">
            <h2 id="footer-brand-heading" class="text-lg font-semibold text-text-heading">
              {{ 'app.name' | translate }}
            </h2>
            <p class="text-text-secondary">{{ 'app.tagline' | translate }}</p>
          </div>

          <div class="min-h-[2.5rem]">
            <ng-container *ngIf="socialLoading; else socialLinksReady">
              <div class="flex flex-wrap items-center gap-3" data-footer-social-loading="true">
                <span class="h-5 w-24 rounded-full bg-surface-raised animate-pulse"></span>
                <span class="h-5 w-24 rounded-full bg-surface-raised animate-pulse"></span>
                <span class="h-5 w-16 rounded-full bg-surface-raised animate-pulse"></span>
              </div>
            </ng-container>
            <ng-template #socialLinksReady>
              <nav class="flex flex-wrap items-center gap-4" aria-label="Footer social links">
                <div class="relative" data-footer-dropdown>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 font-medium hover:text-text-heading"
                    (click)="toggleMenu('instagram')"
                    [attr.aria-expanded]="openMenu === 'instagram'"
                    aria-haspopup="menu"
                  >
                    {{ 'footer.instagram' | translate }}
                    <span class="text-xs text-text-muted">▴</span>
                  </button>
                  <div
                    *ngIf="openMenu === 'instagram'"
                    class="absolute bottom-full left-0 mb-2 w-72 rounded-2xl border border-border-muted bg-background shadow-xl overflow-hidden"
                    role="menu"
                  >
                    <a
                      *ngFor="let page of instagramPages"
                      class="flex items-center gap-3 px-3 py-2 text-sm text-text hover:bg-surface-muted hover:text-text-heading"
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
                          class="h-8 w-8 rounded-full border border-border-muted object-cover"
                          appImgFallback="assets/placeholder/avatar-placeholder.svg"
                          loading="lazy"
                        />
                      </ng-container>
                      <ng-template #instagramAvatar>
                        <span
                          class="h-8 w-8 rounded-full grid place-items-center text-xs font-semibold text-onmedia"
                          [ngClass]="page.avatarClass"
                        >
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
                    class="inline-flex items-center gap-1 font-medium hover:text-text-heading"
                    (click)="toggleMenu('facebook')"
                    [attr.aria-expanded]="openMenu === 'facebook'"
                    aria-haspopup="menu"
                  >
                    {{ 'footer.facebook' | translate }}
                    <span class="text-xs text-text-muted">▴</span>
                  </button>
                  <div
                    *ngIf="openMenu === 'facebook'"
                    class="absolute bottom-full left-0 mb-2 w-72 rounded-2xl border border-border-muted bg-background shadow-xl overflow-hidden"
                    role="menu"
                  >
                    <a
                      *ngFor="let page of facebookPages"
                      class="flex items-center gap-3 px-3 py-2 text-sm text-text hover:bg-surface-muted hover:text-text-heading"
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
                          class="h-8 w-8 rounded-full border border-border-muted object-cover"
                          appImgFallback="assets/placeholder/avatar-placeholder.svg"
                          loading="lazy"
                        />
                      </ng-container>
                      <ng-template #facebookAvatar>
                        <span
                          class="h-8 w-8 rounded-full grid place-items-center text-xs font-semibold text-onmedia"
                          [ngClass]="page.avatarClass"
                        >
                          {{ page.initials }}
                        </span>
                      </ng-template>
                      <span class="truncate">{{ page.label }}</span>
                    </a>
                  </div>
                </div>

                <a class="font-medium hover:text-text-heading" routerLink="/contact">{{
                  'footer.contact' | translate
                }}</a>
              </nav>
            </ng-template>
          </div>
        </section>

        <section
          class="grid gap-2 content-start min-h-[9rem]"
          data-footer-nav-shell="handcrafted"
          aria-labelledby="footer-handcrafted-heading"
        >
          <h2 id="footer-handcrafted-heading" class="font-semibold text-text-heading">
            {{ 'footer.handcraftedArt' | translate }}
          </h2>
          <ng-container *ngIf="navLoading; else handcraftedLinksReady">
            <span
              class="h-4 w-28 rounded bg-surface-raised animate-pulse"
              data-footer-nav-loading="handcrafted"
            ></span>
            <span class="h-4 w-24 rounded bg-surface-raised animate-pulse"></span>
            <span class="h-4 w-24 rounded bg-surface-raised animate-pulse"></span>
            <span class="h-4 w-28 rounded bg-surface-raised animate-pulse"></span>
          </ng-container>
          <ng-template #handcraftedLinksReady>
            <nav class="grid gap-2" aria-labelledby="footer-handcrafted-heading">
              <ng-container *ngIf="footerHandcraftedLinks?.length; else defaultHandcraftedLinks">
                <ng-container
                  *ngFor="let link of footerHandcraftedLinks; trackBy: trackSiteNavLink"
                >
                  <a
                    *ngIf="!isExternalLink(link.url)"
                    class="hover:text-text-heading"
                    [routerLink]="link.url"
                  >
                    {{ navLabel(link) }}
                  </a>
                  <a
                    *ngIf="isExternalLink(link.url)"
                    class="hover:text-text-heading"
                    [href]="link.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ navLabel(link) }}
                  </a>
                </ng-container>
              </ng-container>
              <ng-template #defaultHandcraftedLinks>
                <a class="hover:text-text-heading" routerLink="/shop">{{
                  'nav.shop' | translate
                }}</a>
                <a class="hover:text-text-heading" routerLink="/about">{{
                  'nav.about' | translate
                }}</a>
                <a class="hover:text-text-heading" routerLink="/contact">{{
                  'nav.contact' | translate
                }}</a>
                <a class="hover:text-text-heading" routerLink="/pages/terms">{{
                  'nav.terms' | translate
                }}</a>
              </ng-template>
            </nav>
          </ng-template>
        </section>

        <section
          class="grid gap-2 content-start min-h-[9rem]"
          data-footer-nav-shell="legal"
          aria-labelledby="footer-legal-heading"
        >
          <h2 id="footer-legal-heading" class="font-semibold text-text-heading">
            {{ 'footer.legal' | translate }}
          </h2>
          <ng-container *ngIf="navLoading; else legalLinksReady">
            <span
              class="h-4 w-24 rounded bg-surface-raised animate-pulse"
              data-footer-nav-loading="legal"
            ></span>
            <span class="h-4 w-36 rounded bg-surface-raised animate-pulse"></span>
            <span class="h-4 w-20 rounded bg-surface-raised animate-pulse"></span>
          </ng-container>
          <ng-template #legalLinksReady>
            <nav class="grid gap-2" aria-labelledby="footer-legal-heading">
              <ng-container *ngIf="footerLegalLinks?.length; else defaultLegalLinks">
                <ng-container *ngFor="let link of footerLegalLinks; trackBy: trackSiteNavLink">
                  <a
                    *ngIf="!isExternalLink(link.url)"
                    class="hover:text-text-heading"
                    [routerLink]="link.url"
                  >
                    {{ navLabel(link) }}
                  </a>
                  <a
                    *ngIf="isExternalLink(link.url)"
                    class="hover:text-text-heading"
                    [href]="link.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ navLabel(link) }}
                  </a>
                </ng-container>
              </ng-container>
              <ng-template #defaultLegalLinks>
                <a class="hover:text-text-heading" routerLink="/pages/terms">{{
                  'nav.terms' | translate
                }}</a>
                <a class="hover:text-text-heading" routerLink="/pages/privacy-policy">{{
                  'footer.privacyPolicy' | translate
                }}</a>
                <a class="hover:text-text-heading" routerLink="/pages/anpc">{{
                  'footer.anpc' | translate
                }}</a>
              </ng-template>
            </nav>
          </ng-template>
        </section>

        <section
          class="grid gap-2 content-start min-h-[10.5rem]"
          data-footer-company-shell
          aria-labelledby="footer-company-heading"
        >
          <h2 id="footer-company-heading" class="font-semibold text-text-heading">
            {{ 'footer.companyInfo' | translate }}
          </h2>
          <ng-container *ngIf="companyLoading; else companyInfoReady">
            <span
              class="h-4 w-48 rounded bg-surface-raised animate-pulse"
              data-footer-company-loading="true"
            ></span>
            <span class="h-4 w-36 rounded bg-surface-raised animate-pulse"></span>
            <span class="h-4 w-28 rounded bg-surface-raised animate-pulse"></span>
            <span class="h-4 w-56 rounded bg-surface-raised animate-pulse"></span>
            <span class="h-4 w-32 rounded bg-surface-raised animate-pulse"></span>
            <span class="h-4 w-40 rounded bg-surface-raised animate-pulse"></span>
          </ng-container>
          <ng-template #companyInfoReady>
            <p *ngIf="companyInfo.name" class="font-medium text-text-strong">
              {{ companyInfo.name }}
            </p>
            <p *ngIf="companyInfo.registrationNumber">
              {{ 'footer.registrationNumber' | translate }}: {{ companyInfo.registrationNumber }}
            </p>
            <p *ngIf="companyInfo.cui">{{ 'footer.cui' | translate }}: {{ companyInfo.cui }}</p>
            <p *ngIf="companyInfo.address">
              {{ 'footer.address' | translate }}: {{ companyInfo.address }}
            </p>
            <p *ngIf="companyInfo.phone">
              {{ 'footer.phone' | translate }}: {{ companyInfo.phone }}
            </p>
            <p *ngIf="companyInfo.email">
              {{ 'footer.email' | translate }}: {{ companyInfo.email }}
            </p>
          </ng-template>
        </section>

        <section
          class="lg:col-span-4 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-border pt-6"
          aria-labelledby="footer-payments-heading"
        >
          <div class="flex flex-col sm:flex-row items-center gap-4">
            <h2
              id="footer-payments-heading"
              class="text-xs uppercase tracking-[0.2em] text-text-secondary"
            >
              {{ 'footer.paymentsAccepted' | translate }}
            </h2>
            <div class="rounded-xl bg-background px-3 py-2 shadow-sm ring-1 ring-border">
              <img
                src="assets/payments/netopia-visa-mastercard.png"
                [alt]="'footer.paymentsAcceptedAlt' | translate"
                class="h-8 w-auto"
                loading="lazy"
              />
            </div>
          </div>

          <div class="w-full sm:w-auto flex justify-center sm:justify-end">
            <img
              src="assets/brand/made-by-andrei-visalon-light.png"
              alt="Made by Andrei Visalon"
              class="block h-16 w-auto opacity-70 dark:hidden sm:h-20 md:h-24 lg:h-28"
              loading="lazy"
            />
            <img
              src="assets/brand/made-by-andrei-visalon-dark.png"
              alt="Made by Andrei Visalon"
              class="hidden h-16 w-auto opacity-90 dark:block sm:h-20 md:h-24 lg:h-28"
              loading="lazy"
            />
          </div>
        </section>
      </div>
    </footer>
  `,
})
export class FooterComponent implements OnInit, OnDestroy {
  openMenu: 'instagram' | 'facebook' | null = null;
  socialLoading = true;
  companyLoading = true;
  navLoading = true;

  instagramPages: FooterSocialPage[] = this.toFooterPages('instagram', DEFAULT_INSTAGRAM_PAGES);
  facebookPages: FooterSocialPage[] = this.toFooterPages('facebook', DEFAULT_FACEBOOK_PAGES);
  footerHandcraftedLinks: SiteNavigationLink[] | null = null;
  footerLegalLinks: SiteNavigationLink[] | null = null;
  companyInfo: SiteCompanyInfo = {
    name: null,
    registrationNumber: null,
    cui: null,
    address: null,
    phone: null,
    email: null,
  };

  private socialSub?: Subscription;
  private companySub?: Subscription;
  private navSub?: Subscription;

  constructor(
    private readonly elementRef: ElementRef<HTMLElement>,
    private readonly social: SiteSocialService,
    private readonly company: SiteCompanyService,
    private readonly navigation: SiteNavigationService,
    private readonly translate: TranslateService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.socialSub = this.social.get().subscribe({
      next: (data) => {
        const instagram = data.instagramPages?.length
          ? data.instagramPages
          : DEFAULT_INSTAGRAM_PAGES;
        const facebook = data.facebookPages?.length ? data.facebookPages : DEFAULT_FACEBOOK_PAGES;
        this.deferStateUpdate(() => {
          this.instagramPages = this.toFooterPages('instagram', instagram);
          this.facebookPages = this.toFooterPages('facebook', facebook);
          this.socialLoading = false;
        });
      },
      error: () => {
        this.deferStateUpdate(() => {
          this.socialLoading = false;
        });
      },
    });
    this.companySub = this.company.get().subscribe({
      next: (info) => {
        this.deferStateUpdate(() => {
          this.companyInfo = info;
          this.companyLoading = false;
        });
      },
      error: () => {
        this.deferStateUpdate(() => {
          this.companyLoading = false;
        });
      },
    });
    this.navSub = this.navigation.get().subscribe({
      next: (data) => {
        this.deferStateUpdate(() => {
          this.footerHandcraftedLinks = data?.footerHandcraftedLinks?.length
            ? data.footerHandcraftedLinks
            : null;
          this.footerLegalLinks = data?.footerLegalLinks?.length ? data.footerLegalLinks : null;
          this.navLoading = false;
        });
      },
      error: () => {
        this.deferStateUpdate(() => {
          this.navLoading = false;
        });
      },
    });
  }

  ngOnDestroy(): void {
    this.socialSub?.unsubscribe();
    this.companySub?.unsubscribe();
    this.navSub?.unsubscribe();
  }

  navLabel(link: SiteNavigationLink): string {
    const lang = (this.translate.currentLang || 'en').toLowerCase();
    if (lang === 'ro') return (link?.label?.ro || '').trim();
    return (link?.label?.en || '').trim();
  }

  isExternalLink(url: string): boolean {
    const value = (url || '').trim();
    return value.startsWith('http://') || value.startsWith('https://');
  }

  trackSiteNavLink(_: number, link: SiteNavigationLink): string {
    return (link?.id || '').trim() || (link?.url || '').trim();
  }

  private toFooterPages(
    platform: 'instagram' | 'facebook',
    pages: SiteSocialLink[],
  ): FooterSocialPage[] {
    const palettes =
      platform === 'instagram'
        ? [
            'bg-gradient-to-br from-fuchsia-500 to-rose-500',
            'bg-gradient-to-br from-amber-500 to-rose-500',
          ]
        : [
            'bg-gradient-to-br from-blue-600 to-sky-500',
            'bg-gradient-to-br from-blue-600 to-fuchsia-500',
          ];
    return pages.map((page, index) => ({
      label: page.label,
      url: page.url,
      thumbnailUrl: page.thumbnail_url || null,
      initials: this.initialsForLabel(page.label),
      avatarClass: palettes[index % palettes.length],
    }));
  }

  private initialsForLabel(label: string): string {
    const cleaned = (label || '').trim();
    if (!cleaned) return 'MS';
    const parts = cleaned.split(/\s+/).filter(Boolean);
    /* istanbul ignore next -- parts[0][0] is always defined (cleaned is non-empty and split+filter yields a non-empty first token), so the cleaned[0]/'M' fallbacks are unreachable */
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

  private deferStateUpdate(run: () => void): void {
    const applyUpdate = () => {
      run();
      this.cdr.markForCheck();
    };
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setTimeout(applyUpdate, 0);
      return;
    }
    window.requestAnimationFrame(() => applyUpdate());
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
