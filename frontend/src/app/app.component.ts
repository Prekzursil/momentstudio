import { Component, OnDestroy } from '@angular/core';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { HeaderComponent } from './layout/header.component';
import { FooterComponent } from './layout/footer.component';
import { ContainerComponent } from './layout/container.component';
import { CmsGlobalSectionBlocksComponent } from './shared/cms-global-section-blocks.component';
import { ToastComponent } from './shared/toast.component';
import { ToastService } from './core/toast.service';
import { ThemeService, ThemePreference } from './core/theme.service';
import { TranslateService } from '@ngx-translate/core';
import { LanguageService } from './core/language.service';
import { AuthService } from './core/auth.service';
import { AnalyticsService } from './core/analytics.service';
import { Subscription } from 'rxjs';
import { HttpErrorBusService, HttpErrorEvent } from './core/http-error-bus.service';
import { RouteHeadingFocusService } from './core/route-heading-focus.service';
import { RouteRobotsService } from './core/route-robots.service';
import { ClarityService } from './core/clarity.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FooterComponent, ContainerComponent, CmsGlobalSectionBlocksComponent, ToastComponent],
  template: `
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <div class="min-h-screen flex flex-col bg-gradient-to-b from-slate-50 to-white text-slate-900 dark:from-slate-950 dark:to-slate-900 dark:text-slate-50 transition-colors">
      <app-header
        [themePreference]="preference()"
        [language]="language()"
        (themeChange)="onThemeChange($event)"
        (languageChange)="onLanguageChange($event)"
      ></app-header>
      <app-cms-global-section-blocks
        contentKey="site.header-banners"
        containerClasses="py-6"
        reserveLoadingHeightClass="min-h-[5rem]"
        [loadingSkeletonCount]="2"
      ></app-cms-global-section-blocks>
      <main id="main-content" class="flex-1 py-8">
        <app-container>
          <router-outlet></router-outlet>
        </app-container>
      </main>
      <app-cms-global-section-blocks
        contentKey="site.footer-promo"
        containerClasses="py-8"
        reserveLoadingHeightClass="min-h-[7rem]"
        [loadingSkeletonCount]="3"
      ></app-cms-global-section-blocks>
      <app-footer></app-footer>
    </div>
    <app-toast [messages]="toasts()"></app-toast>
  `
})
export class AppComponent implements OnDestroy {
  toasts = this.toast.messages();
  preference = this.theme.preference();
  language = this.lang.language;
  private querySub?: Subscription;
  private httpErrorSub?: Subscription;
  private lastGlobalNetworkToastAt = 0;
  private lastGlobalServerToastAt = 0;

  constructor(
    private toast: ToastService,
    private theme: ThemeService,
    private translate: TranslateService,
    private lang: LanguageService,
    private auth: AuthService,
    private route: ActivatedRoute,
    private analytics: AnalyticsService,
    private clarity: ClarityService,
    private httpErrors: HttpErrorBusService,
    private routeHeadingFocus: RouteHeadingFocusService,
    private routeRobots: RouteRobotsService
  ) {
    // Language is handled by LanguageService (localStorage + preferred_language + browser fallback).
    // Revalidate any persisted session on startup to avoid "logged in but unauthorized" UI states.
    this.auth.ensureAuthenticated({ silent: true }).subscribe({
      next: () => this.clarity.start(),
      error: () => this.clarity.start(),
    });
    this.analytics.startSession();

    this.querySub = this.route.queryParams.subscribe((params) => {
      const lang = typeof params['lang'] === 'string' ? params['lang'].trim().toLowerCase() : '';
      if (lang === 'en' || lang === 'ro') {
        this.lang.setLanguage(lang, { persist: false, syncBackend: false });
      }

      const theme = typeof params['theme'] === 'string' ? params['theme'].trim().toLowerCase() : '';
      if (theme === 'light' || theme === 'dark') {
        this.theme.setPreference(theme, false);
      }
    });

    // A DI-safe global fallback: surface only offline + 5xx errors.
    // Keep this out of the HTTP interceptor to avoid circular dependencies during i18n bootstrap.
    this.httpErrorSub = this.httpErrors.events$.subscribe((event) => this.onGlobalHttpError(event));
    this.routeHeadingFocus.focusCurrentRouteHeading();
    this.routeRobots.start();
  }

  ngOnDestroy(): void {
    this.querySub?.unsubscribe();
    this.httpErrorSub?.unsubscribe();
  }

  onThemeChange(pref: ThemePreference): void {
    this.theme.setPreference(pref);
    const mode = this.theme.mode()().toUpperCase();
    this.toast.success(this.translate.instant('theme.switched'), this.translate.instant('theme.now', { mode }));
  }

  onLanguageChange(lang: string): void {
    if (lang === 'en' || lang === 'ro') {
      this.lang.setLanguage(lang);
    }
  }

  private onGlobalHttpError(event: HttpErrorEvent): void {
    const status = event?.status ?? 0;
    const now = Date.now();

    // Throttle to avoid spamming the user when multiple calls fail at once.
    if (status === 0) {
      if (now - this.lastGlobalNetworkToastAt < 10_000) return;
      this.lastGlobalNetworkToastAt = now;
      this.toast.error(
        this.translate.instant('errors.network.title'),
        this.translate.instant('errors.network.body')
      );
      return;
    }

    if (status >= 500 && status < 600) {
      if (now - this.lastGlobalServerToastAt < 10_000) return;
      this.lastGlobalServerToastAt = now;
      this.toast.error(
        this.translate.instant('errors.server.title'),
        this.translate.instant('errors.server.body')
      );
    }
  }
}
