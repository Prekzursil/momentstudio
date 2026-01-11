import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ContainerComponent } from '../../layout/container.component';

type AdminNavItem = {
  path: string;
  labelKey: string;
  exact?: boolean;
};

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, TranslateModule, ContainerComponent],
  template: `
    <app-container classes="py-8">
      <div class="grid lg:grid-cols-[260px_1fr] gap-6">
        <aside
          class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-1 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
        >
          <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400 pb-2">
            {{ 'adminUi.nav.title' | translate }}
          </div>
          <a
            *ngFor="let item of navItems"
            [routerLink]="item.path"
            routerLinkActive="bg-slate-100 text-slate-900 dark:bg-slate-800/70 dark:text-white"
            [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
            class="rounded-lg px-3 py-2 hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800/60 dark:hover:text-white"
          >
            {{ item.labelKey | translate }}
          </a>
        </aside>

        <main class="min-w-0">
          <router-outlet></router-outlet>
        </main>
      </div>
    </app-container>
  `
})
export class AdminLayoutComponent {
  readonly navItems: AdminNavItem[] = [
    { path: '/admin/dashboard', labelKey: 'adminUi.nav.dashboard', exact: true },
    { path: '/admin/products', labelKey: 'adminUi.nav.products' },
    { path: '/admin/orders', labelKey: 'adminUi.nav.orders' },
    { path: '/admin/users', labelKey: 'adminUi.nav.users' }
  ];
}
