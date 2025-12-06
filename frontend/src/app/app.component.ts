import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './layout/header.component';
import { FooterComponent } from './layout/footer.component';
import { ContainerComponent } from './layout/container.component';
import { ToastComponent } from './shared/toast.component';
import { ToastService } from './core/toast.service';
import { ThemeService, ThemePreference } from './core/theme.service';
import { TranslateService } from '@ngx-translate/core';
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
        [language]="language"
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
  language = 'en';

  constructor(
    private toast: ToastService,
    private theme: ThemeService,
    private translate: TranslateService,
    private auth: AuthService
  ) {
    const savedLang = typeof localStorage !== 'undefined' ? localStorage.getItem('lang') : null;
    const userLang = this.auth.user()?.preferred_language;
    const browserLang = this.translate.getBrowserLang() ?? 'en';
    this.language = userLang || savedLang || (browserLang === 'ro' ? 'ro' : 'en');
    this.translate.use(this.language);
  }

  onThemeChange(pref: ThemePreference): void {
    this.theme.setPreference(pref);
    const mode = this.theme.mode()().toUpperCase();
    this.toast.success(this.translate.instant('theme.switched'), this.translate.instant('theme.now', { mode }));
  }

  onLanguageChange(lang: string): void {
    this.language = lang;
    this.translate.use(lang);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('lang', lang);
    }
    if (this.auth.isAuthenticated()) {
      this.auth.updatePreferredLanguage(lang).subscribe({
        error: () =>
          this.toast.error(
            this.translate.instant('auth.languageNotSaved'),
            this.translate.instant('auth.languageNotSavedDetail')
          )
      });
    }
  }
}
