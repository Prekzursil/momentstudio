import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../core/auth.service';
import { AdminFavoritesService } from '../../core/admin-favorites.service';
import { AdminRecentService } from '../../core/admin-recent.service';
import { AdminService } from '../../core/admin.service';
import { OpsService } from '../../core/ops.service';
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

          <div *ngIf="shouldShowAlerts()" class="pb-2">
            <div class="flex items-center justify-between px-3 pb-1 text-[11px] font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
              <span>{{ 'adminUi.alerts.title' | translate }}</span>
              <button
                type="button"
                class="h-7 w-7 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-white"
                [attr.aria-label]="'adminUi.actions.refresh' | translate"
                [disabled]="alertsLoading"
                (click)="refreshAlerts()"
              >
                ⟳
              </button>
            </div>

            <div *ngIf="alertsLoading" class="px-3 pb-2 text-xs text-slate-500 dark:text-slate-400">
              {{ 'adminUi.alerts.loading' | translate }}
            </div>

            <div *ngIf="alertsError" class="px-3 pb-2 text-xs text-rose-700 dark:text-rose-200">
              {{ alertsError }}
            </div>

            <div class="grid gap-1">
              <button
                *ngIf="lowStockCount > 0 && auth.canAccessAdminSection('inventory')"
                type="button"
                class="w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800/60 dark:hover:text-white"
                (click)="goToInventory()"
              >
                <span class="truncate">{{ 'adminUi.alerts.lowStock' | translate }}</span>
                <span class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
                  {{ lowStockCount }}
                </span>
              </button>

              <button
                *ngIf="failedWebhooksCount > 0 && auth.canAccessAdminSection('ops')"
                type="button"
                class="w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800/60 dark:hover:text-white"
                (click)="goToOps('webhooks')"
              >
                <span class="truncate">{{ 'adminUi.alerts.failedWebhooks' | translate }}</span>
                <span class="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-900 dark:bg-rose-900/30 dark:text-rose-100">
                  {{ failedWebhooksCount }}
                </span>
              </button>

              <button
                *ngIf="failedEmailsCount > 0 && auth.canAccessAdminSection('ops')"
                type="button"
                class="w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800/60 dark:hover:text-white"
                (click)="goToOps('emails')"
              >
                <span class="truncate">{{ 'adminUi.alerts.failedEmails' | translate }}</span>
                <span class="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-900 dark:bg-rose-900/30 dark:text-rose-100">
                  {{ failedEmailsCount }}
                </span>
              </button>
            </div>

            <div class="my-2 h-px bg-slate-200 dark:bg-slate-800/70"></div>
          </div>

          <div *ngIf="!navQuery.trim() && favoriteNavItems().length" class="pb-2">
            <div class="px-3 pb-1 text-[11px] font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
              {{ 'adminUi.favorites.title' | translate }}
            </div>
            <div class="grid gap-1">
              <a
                *ngFor="let item of favoriteNavItems()"
                [routerLink]="item.path"
                routerLinkActive="bg-slate-100 text-slate-900 dark:bg-slate-800/70 dark:text-white"
                [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
                class="rounded-lg px-3 py-2 hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800/60 dark:hover:text-white"
              >
                {{ item.labelKey | translate }}
              </a>
            </div>
            <div class="my-2 h-px bg-slate-200 dark:bg-slate-800/70"></div>
          </div>

          <div *ngFor="let item of filteredNavItems()" class="flex items-center gap-1">
            <a
              [routerLink]="item.path"
              routerLinkActive="bg-slate-100 text-slate-900 dark:bg-slate-800/70 dark:text-white"
              [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
              class="flex-1 min-w-0 rounded-lg px-3 py-2 hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800/60 dark:hover:text-white"
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
            <button
              type="button"
              class="h-9 w-9 rounded-lg border border-transparent text-slate-400 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
              [attr.aria-label]="(isNavFavorite(item) ? 'adminUi.favorites.unpin' : 'adminUi.favorites.pin') | translate"
              (click)="toggleNavFavorite(item, $event)"
            >
              <span aria-hidden="true" class="text-base leading-none" [class.text-amber-500]="isNavFavorite(item)">
                {{ isNavFavorite(item) ? '★' : '☆' }}
              </span>
            </button>
          </div>
        </aside>

        <main class="min-w-0">
          <router-outlet></router-outlet>
        </main>
      </div>
    </app-container>
  `
})
export class AdminLayoutComponent implements OnInit, OnDestroy {
  constructor(
    public auth: AuthService,
    private router: Router,
    private translate: TranslateService,
    public favorites: AdminFavoritesService,
    private recent: AdminRecentService,
    private admin: AdminService,
    private ops: OpsService
  ) {}

  private pendingGoAt: number | null = null;
  navQuery = '';
  private navSub?: Subscription;
  private alertsIntervalId: number | null = null;

  alertsLoading = false;
  alertsError: string | null = null;
  lowStockCount = 0;
  failedWebhooksCount = 0;
  failedEmailsCount = 0;

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

  ngOnInit(): void {
    this.favorites.init();
    this.recordRecent(this.router.url);
    this.loadAlerts();
    this.alertsIntervalId = window.setInterval(() => this.loadAlerts(), 5 * 60 * 1000);
    this.navSub = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => this.recordRecent(event.urlAfterRedirects || event.url));
  }

  ngOnDestroy(): void {
    this.navSub?.unsubscribe();
    if (this.alertsIntervalId !== null) {
      window.clearInterval(this.alertsIntervalId);
      this.alertsIntervalId = null;
    }
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

  favoriteNavItems(): AdminNavItem[] {
    const urls = this.favorites.items()
      .filter((item) => item?.type === 'page')
      .map((item) => (item?.url || '').trim())
      .filter(Boolean);
    const byPath = new Map(this.navItems.map((item) => [item.path, item]));
    return urls.map((url) => byPath.get(url)).filter((item): item is AdminNavItem => Boolean(item));
  }

  isNavFavorite(item: AdminNavItem): boolean {
    return this.favorites.isFavorite(this.favoriteKey(item));
  }

  toggleNavFavorite(item: AdminNavItem, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const key = this.favoriteKey(item);
    const label = this.navLabel(item);
    this.favorites.toggle({
      key,
      type: 'page',
      label,
      subtitle: '',
      url: item.path,
      state: null
    });
  }

  clearNavQuery(): void {
    this.navQuery = '';
  }

  refreshAlerts(): void {
    this.loadAlerts();
  }

  goToInventory(): void {
    void this.router.navigateByUrl('/admin/inventory');
  }

  goToOps(section: 'webhooks' | 'emails'): void {
    void this.router.navigateByUrl('/admin/ops', { state: { focusOpsSection: section } });
  }

  shouldShowAlerts(): boolean {
    if (this.alertsLoading) return true;
    if (this.alertsError) return true;
    if (this.lowStockCount > 0 && this.auth.canAccessAdminSection('inventory')) return true;
    if (this.failedWebhooksCount > 0 && this.auth.canAccessAdminSection('ops')) return true;
    if (this.failedEmailsCount > 0 && this.auth.canAccessAdminSection('ops')) return true;
    return false;
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

  private favoriteKey(item: AdminNavItem): string {
    return `page:${item.path}`;
  }

  private loadAlerts(): void {
    this.alertsLoading = true;
    this.alertsError = null;

    let pending = 0;
    const done = (): void => {
      pending -= 1;
      if (pending <= 0) {
        this.alertsLoading = false;
      }
    };

    if (this.auth.canAccessAdminSection('inventory')) {
      pending += 1;
      this.admin.summary({ range_days: 30 }).subscribe({
        next: (res) => {
          const count = Number((res as any)?.low_stock ?? 0);
          this.lowStockCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
        },
        error: () => {
          this.lowStockCount = 0;
          this.alertsError = this.translate.instant('adminUi.alerts.errors.load');
          done();
        },
        complete: done
      });
    } else {
      this.lowStockCount = 0;
    }

    if (this.auth.canAccessAdminSection('ops')) {
      pending += 1;
      this.ops.getWebhookFailureStats({ since_hours: 24 }).subscribe({
        next: (res) => {
          const count = Number((res as any)?.failed ?? 0);
          this.failedWebhooksCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
        },
        error: () => {
          this.failedWebhooksCount = 0;
          this.alertsError = this.translate.instant('adminUi.alerts.errors.load');
          done();
        },
        complete: done
      });

      pending += 1;
      this.ops.getEmailFailureStats({ since_hours: 24 }).subscribe({
        next: (res) => {
          const count = Number((res as any)?.failed ?? 0);
          this.failedEmailsCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
        },
        error: () => {
          this.failedEmailsCount = 0;
          this.alertsError = this.translate.instant('adminUi.alerts.errors.load');
          done();
        },
        complete: done
      });
    } else {
      this.failedWebhooksCount = 0;
      this.failedEmailsCount = 0;
    }

    if (pending === 0) {
      this.alertsLoading = false;
    }
  }

  private recordRecent(url: string): void {
    const raw = (url || '').trim();
    if (!raw.startsWith('/admin')) return;
    const normalized = raw.split('?')[0].split('#')[0];
    if (!normalized) return;
    if (/^\/admin\/orders\/[^/]+$/.test(normalized)) return;

    const candidates = this.navItems.filter((item) => normalized === item.path || normalized.startsWith(`${item.path}/`));
    if (!candidates.length) return;
    const match = candidates.sort((a, b) => b.path.length - a.path.length)[0];
    if (!match) return;

    const label = this.navLabel(match);
    let subtitle = '';
    let type: 'page' | 'content' = 'page';

    if (normalized.startsWith('/admin/content')) {
      type = 'content';
      const section = (normalized.split('/')[3] || '').trim();
      if (section) {
        const key = `adminUi.content.nav.${section}`;
        const translated = this.translate.instant(key);
        subtitle = translated === key ? section : translated;
      }
    }

    this.recent.add({
      key: `page:${normalized}`,
      type,
      label,
      subtitle,
      url: normalized,
      state: null
    });
  }
}
