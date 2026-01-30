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
import { Subscription } from 'rxjs';

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
      <app-cms-global-section-blocks contentKey="site.header-banners" containerClasses="py-6"></app-cms-global-section-blocks>
      <app-container id="main-content" class="flex-1 py-8">
        <router-outlet></router-outlet>
      </app-container>
      <app-cms-global-section-blocks contentKey="site.footer-promo" containerClasses="py-8"></app-cms-global-section-blocks>
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

  constructor(
    private toast: ToastService,
    private theme: ThemeService,
    private translate: TranslateService,
    private lang: LanguageService,
    private auth: AuthService,
    private route: ActivatedRoute
  ) {
    // Language is handled by LanguageService (localStorage + preferred_language + browser fallback).
    // Revalidate any persisted session on startup to avoid "logged in but unauthorized" UI states.
    this.auth.ensureAuthenticated({ silent: true }).subscribe({ error: () => void 0 });

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
  }

  ngOnDestroy(): void {
    this.querySub?.unsubscribe();
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
}
