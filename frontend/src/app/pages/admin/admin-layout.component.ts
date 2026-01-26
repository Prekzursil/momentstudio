import { CommonModule } from '@angular/common';
import { Component, HostListener } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../core/auth.service';
import { ContainerComponent } from '../../layout/container.component';

type AdminNavItem = {
  path: string;
  labelKey: string;
  section: string;
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
  constructor(
    private auth: AuthService,
    private router: Router
  ) {}

  private pendingGoAt: number | null = null;

  private readonly allNavItems: AdminNavItem[] = [
    { path: '/admin/dashboard', labelKey: 'adminUi.nav.dashboard', section: 'dashboard', exact: true },
    { path: '/admin/content', labelKey: 'adminUi.nav.content', section: 'content' },
    { path: '/admin/products', labelKey: 'adminUi.nav.products', section: 'products' },
    { path: '/admin/inventory', labelKey: 'adminUi.nav.inventory', section: 'inventory' },
    { path: '/admin/orders', labelKey: 'adminUi.nav.orders', section: 'orders' },
    { path: '/admin/returns', labelKey: 'adminUi.nav.returns', section: 'returns' },
    { path: '/admin/coupons', labelKey: 'adminUi.nav.coupons', section: 'coupons' },
    { path: '/admin/users', labelKey: 'adminUi.nav.users', section: 'users' },
    { path: '/admin/support', labelKey: 'adminUi.nav.support', section: 'support' },
    { path: '/admin/ops', labelKey: 'adminUi.nav.ops', section: 'ops' }
  ];

  get navItems(): AdminNavItem[] {
    return this.allNavItems.filter((item) => this.auth.canAccessAdminSection(item.section));
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (this.shouldIgnoreShortcut(event)) return;

    const key = (event.key || '').toLowerCase();

    if ((event.ctrlKey || event.metaKey) && key === 'k') {
      event.preventDefault();
      this.openGlobalSearch();
      return;
    }

    if (key === 'escape') {
      this.pendingGoAt = null;
      return;
    }

    if (key === 'g') {
      this.pendingGoAt = Date.now();
      return;
    }

    if (this.pendingGoAt !== null) {
      if (Date.now() - this.pendingGoAt > 1500) {
        this.pendingGoAt = null;
        return;
      }
      const destination = this.routeForGoShortcut(key);
      if (!destination) return;
      event.preventDefault();
      this.pendingGoAt = null;
      void this.router.navigate([destination]);
    }
  }

  private openGlobalSearch(): void {
    if ((this.router.url || '').startsWith('/admin/dashboard')) {
      const input = document.getElementById('admin-global-search') as HTMLInputElement | null;
      if (input) {
        input.focus();
        input.select();
      }
      return;
    }
    void this.router.navigate(['/admin/dashboard'], { state: { focusGlobalSearch: true } });
  }

  private routeForGoShortcut(key: string): string | null {
    if (key === 'd') return '/admin/dashboard';
    if (key === 'o') return '/admin/orders';
    if (key === 'p') return '/admin/products';
    if (key === 'u') return '/admin/users';
    if (key === 'c') return '/admin/coupons';
    if (key === 's') return '/admin/support';
    if (key === 'x') return '/admin/ops';
    if (key === 'i') return '/admin/inventory';
    if (key === 'r') return '/admin/returns';
    return null;
  }

  private shouldIgnoreShortcut(event: KeyboardEvent): boolean {
    if (event.defaultPrevented) return true;
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    const tag = (target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (target.isContentEditable) return true;
    return false;
  }
}
