import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './layout/header.component';
import { FooterComponent } from './layout/footer.component';
import { ContainerComponent } from './layout/container.component';
import { ToastComponent } from './shared/toast.component';
import { AsyncPipe } from '@angular/common';
import { ToastService } from './core/toast.service';
import { ThemeService } from './core/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FooterComponent, ContainerComponent, ToastComponent, AsyncPipe],
  template: `
    <div class="min-h-screen flex flex-col bg-gradient-to-b from-slate-50 to-white text-slate-900 dark:from-slate-950 dark:to-slate-900 dark:text-slate-50">
      <app-header (toggleTheme)="onToggleTheme()"></app-header>
      <app-container class="flex-1 py-8">
        <router-outlet></router-outlet>
      </app-container>
      <app-footer></app-footer>
    </div>
    <app-toast [messages]="toasts$ | async"></app-toast>
  `
})
export class AppComponent {
  toasts$ = this.toast.messages().asObservable();

  constructor(private toast: ToastService, private theme: ThemeService) {}

  onToggleTheme(): void {
    this.theme.toggle();
    this.toast.success('Theme switched', `Theme is now ${this.theme.theme()().toUpperCase()}`);
  }
}
