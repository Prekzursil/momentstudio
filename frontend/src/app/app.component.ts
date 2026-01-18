import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './layout/header.component';
import { FooterComponent } from './layout/footer.component';
import { ContainerComponent } from './layout/container.component';
import { ToastComponent } from './shared/toast.component';
import { ToastService } from './core/toast.service';
import { ThemeService, ThemePreference } from './core/theme.service';
import { TranslateService } from '@ngx-translate/core';
import { LanguageService } from './core/language.service';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FooterComponent, ContainerComponent, ToastComponent],
  template: `
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <div class="min-h-screen flex flex-col bg-gradient-to-b from-slate-50 to-white text-slate-900 dark:from-slate-950 dark:to-slate-900 dark:text-slate-50 transition-colors">
      <app-header
        [themePreference]="preference()"
        [language]="language()"
        (themeChange)="onThemeChange($event)"
        (languageChange)="onLanguageChange($event)"
      ></app-header>
      <app-container id="main-content" class="flex-1 py-8">
        <router-outlet></router-outlet>
      </app-container>
      <app-footer></app-footer>
    </div>
    <app-toast [messages]="toasts()"></app-toast>
  `
})
export class AppComponent {
  toasts = this.toast.messages();
  preference = this.theme.preference();
  language = this.lang.language;

  constructor(
    private toast: ToastService,
    private theme: ThemeService,
    private translate: TranslateService,
    private lang: LanguageService,
    private auth: AuthService
  ) {
    // Language is handled by LanguageService (localStorage + preferred_language + browser fallback).
    // Revalidate any persisted session on startup to avoid "logged in but unauthorized" UI states.
    this.auth.ensureAuthenticated().subscribe({ error: () => void 0 });
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
