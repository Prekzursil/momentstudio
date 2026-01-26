import { CommonModule } from '@angular/common';
import { Component, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
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
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive, RouterOutlet, TranslateModule, ContainerComponent],
  template: `
    <app-container classes="py-8">
      <div class="grid lg:grid-cols-[260px_1fr] gap-6">
        <aside
          class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-1 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
        >
          <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400 pb-2">
            {{ 'adminUi.nav.title' | translate }}
          </div>

          <label class="grid gap-1 pb-2">
            <span class="sr-only">{{ 'adminUi.actions.search' | translate }}</span>
            <div class="relative">
              <input
                class="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 pr-10 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="navQuery"
                [placeholder]="'adminUi.nav.searchPlaceholder' | translate"
                autocomplete="off"
                spellcheck="false"
              />
              <button
                *ngIf="navQuery.trim()"
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-white"
                [attr.aria-label]="'adminUi.actions.reset' | translate"
                (click)="clearNavQuery()"
              >
                ×
              </button>
            </div>
          </label>

          <div *ngIf="navQuery.trim() && filteredNavItems().length === 0" class="px-3 pb-2 text-xs text-slate-500 dark:text-slate-400">
            {{ 'adminUi.nav.searchEmpty' | translate }}
          </div>

          <a
            *ngFor="let item of filteredNavItems()"
            [routerLink]="item.path"
            routerLinkActive="bg-slate-100 text-slate-900 dark:bg-slate-800/70 dark:text-white"
            [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
            class="rounded-lg px-3 py-2 hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800/60 dark:hover:text-white"
          >
            <ng-container *ngIf="navQuery.trim(); else fullLabel">
              <ng-container *ngIf="navLabelParts(item) as parts">
                <span>{{ parts.before }}</span>
                <span class="font-semibold text-slate-900 dark:text-slate-50">{{ parts.match }}</span>
                <span>{{ parts.after }}</span>
              </ng-container>
            </ng-container>
            <ng-template #fullLabel>{{ item.labelKey | translate }}</ng-template>
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
    private router: Router,
    private translate: TranslateService
  ) {}

  private pendingGoAt: number | null = null;
  navQuery = '';

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

  filteredNavItems(): AdminNavItem[] {
    const items = this.navItems;
    const query = this.navQuery.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => {
      const label = this.navLabel(item).toLowerCase();
      return label.includes(query) || item.section.includes(query);
    });
  }

  clearNavQuery(): void {
    this.navQuery = '';
  }

  navLabelParts(item: AdminNavItem): { before: string; match: string; after: string } {
    const label = this.navLabel(item);
    const query = this.navQuery.trim().toLowerCase();
    if (!query) return { before: label, match: '', after: '' };
    const idx = label.toLowerCase().indexOf(query);
    if (idx === -1) return { before: label, match: '', after: '' };
    return {
      before: label.slice(0, idx),
      match: label.slice(idx, idx + query.length),
      after: label.slice(idx + query.length),
    };
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

  private navLabel(item: AdminNavItem): string {
    const value = this.translate.instant(item.labelKey);
    return typeof value === 'string' && value.trim() ? value : item.labelKey;
  }
}
