import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './layout/header.component';
import { FooterComponent } from './layout/footer.component';
import { ContainerComponent } from './layout/container.component';
import { ToastComponent } from './shared/toast.component';
import { ToastService } from './core/toast.service';
import { ThemeService, ThemePreference } from './core/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FooterComponent, ContainerComponent, ToastComponent],
  template: `
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <div class="min-h-screen flex flex-col bg-gradient-to-b from-slate-50 to-white text-slate-900 dark:from-slate-950 dark:to-slate-900 dark:text-slate-50 transition-colors">
      <app-header
        [themePreference]="preference()"
        (themeChange)="onThemeChange($event)"
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

  constructor(private toast: ToastService, private theme: ThemeService) {}

  onThemeChange(pref: ThemePreference): void {
    this.theme.setPreference(pref);
    const mode = this.theme.mode()().toUpperCase();
    this.toast.success('Theme switched', `Theme is now ${mode}`);
  }
}
