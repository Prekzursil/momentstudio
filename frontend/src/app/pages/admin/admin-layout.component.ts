import { CommonModule } from '@angular/common';
import { Component, EffectRef, HostListener, Injector, OnDestroy, OnInit, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../core/auth.service';
import { AdminFavoritesService } from '../../core/admin-favorites.service';
import { AdminRecentService } from '../../core/admin-recent.service';
import { AdminSupportService } from '../../core/admin-support.service';
import { AdminService } from '../../core/admin.service';
import { AdminUiPrefsService } from '../../core/admin-ui-prefs.service';
import { OpsService } from '../../core/ops.service';
import { ToastService } from '../../core/toast.service';
import { ContainerComponent } from '../../layout/container.component';
import { ModalComponent } from '../../shared/modal.component';

type AdminNavItem = {
  path: string;
  labelKey: string;
  section: string;
  exact?: boolean;
};

type AdminNavGroupKey =
  | 'overview'
  | 'ordersFulfillment'
  | 'catalog'
  | 'content'
  | 'customersSupport'
  | 'marketing'
  | 'operationsSecurity';

type AdminNavGroup = {
  key: AdminNavGroupKey;
  labelKey: string;
  items: AdminNavItemView[];
};

type AdminNavItemView = AdminNavItem & {
  label: string;
  highlightBefore: string;
  highlightMatch: string;
  highlightAfter: string;
  isFavorite: boolean;
};

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive, RouterOutlet, TranslateModule, ContainerComponent, ModalComponent],
	  template: `
	    <app-container classes="py-8">
        <div class="mb-3 flex lg:hidden items-center justify-between gap-3">
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            (click)="toggleMobileSidebar()"
            [attr.aria-expanded]="mobileSidebarOpen"
            [attr.aria-label]="'adminUi.nav.openMenu' | translate"
          >
            ☰
            <span>{{ 'adminUi.nav.title' | translate }}</span>
          </button>
        </div>

        <button
          *ngIf="!isDesktop && mobileSidebarOpen"
          type="button"
          class="fixed inset-0 z-[130] bg-slate-950/40 backdrop-blur-[1px] lg:hidden"
          [attr.aria-label]="'adminUi.actions.cancel' | translate"
          (click)="closeMobileSidebar()"
        ></button>

	      <div class="grid lg:grid-cols-[260px_1fr] gap-6">
	        <aside
	          class="rounded-2xl border border-slate-200 bg-white grid text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 lg:self-start lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto"
            [ngClass]="[
              uiPrefs.sidebarCompact() ? 'p-3 gap-0.5 text-xs' : 'p-4 gap-1 text-sm',
              !isDesktop && !mobileSidebarOpen ? 'hidden' : '',
              !isDesktop && mobileSidebarOpen ? 'fixed inset-y-0 left-0 z-[140] w-[86vw] max-w-xs max-h-none overflow-y-auto shadow-2xl' : ''
            ]"
	        >
          <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400 pb-2">
            {{ 'adminUi.nav.title' | translate }}
          </div>

          <label class="grid gap-1 pb-2">
            <span class="sr-only">{{ 'adminUi.actions.search' | translate }}</span>
            <div class="relative">
              <input
                class="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 pr-10 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [ngModel]="navQuery"
                (ngModelChange)="onNavQueryChange($event)"
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

          <div *ngIf="navQuery.trim() && filteredNavItemsView.length === 0" class="px-3 pb-2 text-xs text-slate-500 dark:text-slate-400">
            {{ 'adminUi.nav.searchEmpty' | translate }}
          </div>

            <details *ngIf="!navQuery.trim()" class="group pb-2">
              <summary
                class="flex items-center justify-between gap-3 px-3 pb-1 text-[11px] font-semibold tracking-wide uppercase text-slate-500 cursor-pointer select-none dark:text-slate-400 [&::-webkit-details-marker]:hidden"
              >
                <span>{{ 'adminUi.nav.preferences' | translate }}</span>
                <span aria-hidden="true" class="text-slate-400 transition group-open:rotate-90">▸</span>
              </summary>

              <div class="px-3 pt-2 grid gap-3">
                <label class="flex items-center justify-between gap-3 text-xs font-medium text-slate-600 dark:text-slate-300">
                  <span>{{ 'adminUi.nav.compactSidebar' | translate }}</span>
                  <input type="checkbox" [checked]="uiPrefs.sidebarCompact()" (change)="toggleSidebarCompact($event)" />
                </label>

                <div *ngIf="auth.role() === 'owner'">
                  <div class="flex items-center justify-between gap-3 text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                    <span>{{ 'adminUi.uiPreset.title' | translate }}</span>
                  </div>
                  <div class="mt-1 flex items-center justify-between gap-3">
                    <div class="inline-flex overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                      <button
                        type="button"
                        class="px-3 py-1.5 text-xs font-semibold"
                        [class.bg-slate-900]="uiPrefs.preset() === 'owner_basic'"
                        [class.text-white]="uiPrefs.preset() === 'owner_basic'"
                        [class.text-slate-700]="uiPrefs.preset() !== 'owner_basic'"
                        [class.dark:text-slate-200]="uiPrefs.preset() !== 'owner_basic'"
                        (click)="uiPrefs.setPreset('owner_basic')"
                      >
                        {{ 'adminUi.uiPreset.ownerBasic' | translate }}
                      </button>
                      <button
                        type="button"
                        class="px-3 py-1.5 text-xs font-semibold"
                        [class.bg-slate-900]="uiPrefs.preset() === 'custom'"
                        [class.text-white]="uiPrefs.preset() === 'custom'"
                        [class.text-slate-700]="uiPrefs.preset() !== 'custom'"
                        [class.dark:text-slate-200]="uiPrefs.preset() !== 'custom'"
                        (click)="uiPrefs.setPreset('custom')"
                      >
                        {{ 'adminUi.uiPreset.custom' | translate }}
                      </button>
                    </div>
                  </div>
                  <div *ngIf="!uiPrefs.sidebarCompact()" class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.uiPreset.hint' | translate }}
                  </div>
                </div>

                <div>
                  <div class="flex items-center justify-between gap-3 text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                    <span>{{ 'adminUi.uiMode.title' | translate }}</span>
                  </div>
                  <div class="mt-1 flex items-center justify-between gap-3">
                    <div class="inline-flex overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                      <button
                        type="button"
                        class="px-3 py-1.5 text-xs font-semibold"
                        [class.bg-slate-900]="uiPrefs.mode() === 'simple'"
                        [class.text-white]="uiPrefs.mode() === 'simple'"
                        [class.text-slate-700]="uiPrefs.mode() !== 'simple'"
                        [class.dark:text-slate-200]="uiPrefs.mode() !== 'simple'"
                        (click)="uiPrefs.setMode('simple')"
                      >
                        {{ 'adminUi.uiMode.simple' | translate }}
                      </button>
                      <button
                        type="button"
                        class="px-3 py-1.5 text-xs font-semibold"
                        [class.bg-slate-900]="uiPrefs.mode() === 'advanced'"
                        [class.text-white]="uiPrefs.mode() === 'advanced'"
                        [class.text-slate-700]="uiPrefs.mode() !== 'advanced'"
                        [class.dark:text-slate-200]="uiPrefs.mode() !== 'advanced'"
                        (click)="uiPrefs.setMode('advanced')"
                      >
                        {{ 'adminUi.uiMode.advanced' | translate }}
                      </button>
                    </div>
                  </div>
                  <div *ngIf="!uiPrefs.sidebarCompact()" class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {{ (uiPrefs.mode() === 'simple' ? 'adminUi.uiMode.simpleHint' : 'adminUi.uiMode.advancedHint') | translate }}
                  </div>
                </div>

                <div>
                  <div class="flex items-center justify-between gap-3 text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                    <span>{{ 'adminUi.trainingMode.title' | translate }}</span>
                    <label class="inline-flex items-center gap-2 text-xs font-medium normal-case text-slate-600 dark:text-slate-300">
                      <input
                        type="checkbox"
                        [checked]="isTrainingMode()"
                        [disabled]="trainingSaving"
                        (change)="toggleTrainingMode($event)"
                      />
                      <span>{{ isTrainingMode() ? ('adminUi.trainingMode.on' | translate) : ('adminUi.trainingMode.off' | translate) }}</span>
                    </label>
                  </div>
                  <div *ngIf="isTrainingMode() && !uiPrefs.sidebarCompact()" class="mt-1 text-xs text-amber-700 dark:text-amber-200">
                    {{ 'adminUi.trainingMode.hint' | translate }}
                  </div>
                  <div *ngIf="trainingError" class="mt-1 text-xs text-rose-700 dark:text-rose-200">
                    {{ trainingError }}
                  </div>
                </div>
              </div>

              <div class="my-2 h-px bg-slate-200 dark:bg-slate-800/70"></div>
            </details>

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
                class="w-full flex items-center justify-between gap-3 rounded-lg hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800/60 dark:hover:text-white"
                [ngClass]="uiPrefs.sidebarCompact() ? 'px-2.5 py-1.5' : 'px-3 py-2'"
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
                class="w-full flex items-center justify-between gap-3 rounded-lg hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800/60 dark:hover:text-white"
                [ngClass]="uiPrefs.sidebarCompact() ? 'px-2.5 py-1.5' : 'px-3 py-2'"
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
                class="w-full flex items-center justify-between gap-3 rounded-lg hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800/60 dark:hover:text-white"
                [ngClass]="uiPrefs.sidebarCompact() ? 'px-2.5 py-1.5' : 'px-3 py-2'"
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

          <div *ngIf="!navQuery.trim() && favoriteNavItemsView.length" class="pb-2">
            <div class="px-3 pb-1 text-[11px] font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
              {{ 'adminUi.favorites.title' | translate }}
            </div>
            <div class="grid gap-1">
              <a
                *ngFor="let item of favoriteNavItemsView; trackBy: trackByNavPath"
                [routerLink]="item.path"
                routerLinkActive="bg-slate-100 text-slate-900 dark:bg-slate-800/70 dark:text-white"
                [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
                class="rounded-lg hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800/60 dark:hover:text-white"
                [ngClass]="uiPrefs.sidebarCompact() ? 'px-2.5 py-1.5' : 'px-3 py-2'"
                (click)="handleNavSelection()"
              >
                {{ item.label }}
              </a>
            </div>
            <div class="my-2 h-px bg-slate-200 dark:bg-slate-800/70"></div>
          </div>

          <ng-container *ngFor="let group of groupedFilteredNavItemsView; trackBy: trackByGroupKey">
            <div
              *ngIf="!navQuery.trim()"
              class="px-3 pb-1 pt-2 text-[11px] font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400"
            >
              {{ group.labelKey | translate }}
            </div>

            <div *ngFor="let item of group.items; trackBy: trackByNavPath" class="flex items-center gap-1">
              <a
                [routerLink]="item.path"
                routerLinkActive="bg-slate-100 text-slate-900 dark:bg-slate-800/70 dark:text-white"
                [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
                class="flex-1 min-w-0 rounded-lg hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800/60 dark:hover:text-white"
                [ngClass]="uiPrefs.sidebarCompact() ? 'px-2.5 py-1.5' : 'px-3 py-2'"
                (click)="handleNavSelection()"
              >
                <ng-container *ngIf="navQuery.trim(); else fullLabel">
                  <span>{{ item.highlightBefore }}</span>
                  <span class="font-semibold text-slate-900 dark:text-slate-50">{{ item.highlightMatch }}</span>
                  <span>{{ item.highlightAfter }}</span>
                </ng-container>
                <ng-template #fullLabel>{{ item.label }}</ng-template>
              </a>
              <button
                type="button"
                class="h-9 w-9 rounded-lg border border-transparent text-slate-400 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                [attr.aria-label]="(item.isFavorite ? 'adminUi.favorites.unpin' : 'adminUi.favorites.pin') | translate"
                (click)="toggleNavFavorite(item, $event)"
              >
                <span aria-hidden="true" class="text-base leading-none" [class.text-amber-500]="item.isFavorite">
                  {{ item.isFavorite ? '★' : '☆' }}
                </span>
              </button>
            </div>
          </ng-container>

            <div class="mt-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                class="w-full rounded-lg hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800/60 dark:hover:text-white"
                [ngClass]="uiPrefs.sidebarCompact() ? 'px-2.5 py-1.5 text-xs font-semibold' : 'px-3 py-2 text-sm font-semibold'"
                (click)="openFeedback(); handleNavSelection()"
              >
                {{ 'adminUi.feedback.open' | translate }}
              </button>
            </div>
	        </aside>
	
	        <main class="min-w-0">
	          <router-outlet></router-outlet>
	        </main>
	      </div>

        <app-modal
          [open]="feedbackOpen"
          [title]="'adminUi.feedback.title' | translate"
          [subtitle]="'adminUi.feedback.subtitle' | translate"
          [cancelLabel]="'adminUi.actions.cancel' | translate"
          [confirmLabel]="'adminUi.feedback.submit' | translate"
          [confirmDisabled]="feedbackSending || !(feedbackMessage || '').trim()"
          (confirm)="submitFeedback()"
          (closed)="closeFeedback()"
        >
          <div class="grid gap-3">
            <p class="text-xs text-slate-600 dark:text-slate-300">
              {{ 'adminUi.feedback.hint' | translate }}
            </p>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'adminUi.feedback.messageLabel' | translate }}
              <textarea
                class="min-h-[120px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                [placeholder]="'adminUi.feedback.messagePlaceholder' | translate"
                [(ngModel)]="feedbackMessage"
              ></textarea>
            </label>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'adminUi.feedback.contextLabel' | translate }}
              <textarea
                class="min-h-[84px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                [placeholder]="'adminUi.feedback.contextPlaceholder' | translate"
                [(ngModel)]="feedbackContext"
              ></textarea>
            </label>

            <label class="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
              <input type="checkbox" [(ngModel)]="feedbackIncludePage" />
              {{ 'adminUi.feedback.includePage' | translate }}
            </label>

            <div *ngIf="feedbackError" class="text-sm text-rose-700 dark:text-rose-200">
              {{ feedbackError }}
            </div>
          </div>
        </app-modal>
	    </app-container>
	  `
})
export class AdminLayoutComponent implements OnInit, OnDestroy {
  constructor(
    public auth: AuthService,
    private router: Router,
    private translate: TranslateService,
    public favorites: AdminFavoritesService,
    public uiPrefs: AdminUiPrefsService,
    private recent: AdminRecentService,
    private admin: AdminService,
    private ops: OpsService,
    private support: AdminSupportService,
    private toast: ToastService
  ) {}

  private readonly injector = inject(Injector);
  private pendingGoAt: number | null = null;
  isDesktop = typeof window !== 'undefined' ? window.innerWidth >= 1024 : true;
  mobileSidebarOpen = false;
  navQuery = '';
  private navSub?: Subscription;
  private langSub?: Subscription;
  private navViewEffect?: EffectRef;
  private alertsIntervalId: number | null = null;
  private feedbackSub?: Subscription;

  alertsLoading = false;
  alertsError: string | null = null;
  lowStockCount = 0;
  failedWebhooksCount = 0;
  failedEmailsCount = 0;
  trainingSaving = false;
  trainingError: string | null = null;

  feedbackOpen = false;
  feedbackMessage = '';
  feedbackContext = '';
  feedbackIncludePage = true;
  feedbackSending = false;
  feedbackError: string | null = null;
  filteredNavItemsView: AdminNavItemView[] = [];
  favoriteNavItemsView: AdminNavItemView[] = [];
  groupedFilteredNavItemsView: AdminNavGroup[] = [];

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
  private readonly ownerBasicSections = new Set(['dashboard', 'content', 'products', 'orders', 'returns', 'support']);
  private readonly sectionGroupMap: Record<string, AdminNavGroupKey> = {
    dashboard: 'overview',
    orders: 'ordersFulfillment',
    returns: 'ordersFulfillment',
    inventory: 'ordersFulfillment',
    products: 'catalog',
    content: 'content',
    users: 'customersSupport',
    support: 'customersSupport',
    coupons: 'marketing',
    ops: 'operationsSecurity'
  };
  private readonly groupOrder: AdminNavGroupKey[] = [
    'overview',
    'ordersFulfillment',
    'catalog',
    'content',
    'customersSupport',
    'marketing',
    'operationsSecurity'
  ];
  private readonly groupLabelKey: Record<AdminNavGroupKey, string> = {
    overview: 'adminUi.navGroup.overview',
    ordersFulfillment: 'adminUi.navGroup.ordersFulfillment',
    catalog: 'adminUi.navGroup.catalog',
    content: 'adminUi.navGroup.content',
    customersSupport: 'adminUi.navGroup.customersSupport',
    marketing: 'adminUi.navGroup.marketing',
    operationsSecurity: 'adminUi.navGroup.operationsSecurity'
  };

  get navItems(): AdminNavItem[] {
    return this.allNavItems.filter((item) => this.auth.canAccessAdminSection(item.section));
  }

  ngOnInit(): void {
    this.favorites.init();
    this.navViewEffect = effect(
      () => {
        this.favorites.items();
        this.uiPrefs.preset();
        this.uiPrefs.mode();
        this.auth.role();
        this.auth.user();
        this.recomputeNavViews();
      },
      { injector: this.injector }
    );
    this.langSub = this.translate.onLangChange.subscribe(() => this.recomputeNavViews());
    this.recomputeNavViews();
    this.recordRecent(this.router.url);
    this.loadAlerts();
    this.alertsIntervalId = window.setInterval(() => this.loadAlerts(), 5 * 60 * 1000);
    this.navSub = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.recordRecent(event.urlAfterRedirects || event.url);
        this.mobileSidebarOpen = false;
      });
  }

  ngOnDestroy(): void {
    this.navSub?.unsubscribe();
    this.langSub?.unsubscribe();
    this.navViewEffect?.destroy();
    this.feedbackSub?.unsubscribe();
    if (this.alertsIntervalId !== null) {
      window.clearInterval(this.alertsIntervalId);
      this.alertsIntervalId = null;
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.isDesktop = window.innerWidth >= 1024;
    if (this.isDesktop) this.mobileSidebarOpen = false;
  }

  toggleMobileSidebar(): void {
    if (this.isDesktop) return;
    this.mobileSidebarOpen = !this.mobileSidebarOpen;
  }

  closeMobileSidebar(): void {
    this.mobileSidebarOpen = false;
  }

  handleNavSelection(): void {
    if (!this.isDesktop) this.mobileSidebarOpen = false;
  }

  trackByNavPath(index: number, item: AdminNavItemView): string {
    void index;
    return item.path;
  }

  trackByGroupKey(index: number, group: AdminNavGroup): string {
    void index;
    return group.key;
  }

  openFeedback(): void {
    this.feedbackOpen = true;
    this.feedbackMessage = '';
    this.feedbackContext = '';
    this.feedbackIncludePage = true;
    this.feedbackSending = false;
    this.feedbackError = null;
  }

  closeFeedback(): void {
    this.feedbackOpen = false;
    this.feedbackSending = false;
    this.feedbackError = null;
  }

  submitFeedback(): void {
    if (this.feedbackSending) return;
    const message = (this.feedbackMessage || '').trim();
    if (!message) return;

    const contextParts: string[] = [];
    if (this.feedbackIncludePage) contextParts.push(`Page: ${this.router.url}`);
    const extra = (this.feedbackContext || '').trim();
    if (extra) contextParts.push(extra);
    const context = contextParts.join('\n').trim() || null;

    this.feedbackSending = true;
    this.feedbackError = null;
    this.feedbackSub?.unsubscribe();
    this.feedbackSub = this.support.submitFeedback({ message, context }).subscribe({
      next: () => {
        this.feedbackSending = false;
        this.toast.success(this.translate.instant('adminUi.feedback.success'));
        this.closeFeedback();
      },
      error: () => {
        this.feedbackSending = false;
        this.feedbackError = this.translate.instant('adminUi.feedback.errors.send');
      }
    });
  }

  isTrainingMode(): boolean {
    return Boolean(this.auth.user()?.admin_training_mode);
  }

  toggleTrainingMode(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const enabled = Boolean(target?.checked);
    if (this.trainingSaving) return;
    this.trainingSaving = true;
    this.trainingError = null;
    this.auth.updateTrainingMode(enabled).subscribe({
      next: () => {
        this.trainingSaving = false;
      },
      error: () => {
        this.trainingSaving = false;
        this.trainingError = this.translate.instant('adminUi.trainingMode.errors.save');
      }
    });
  }

  toggleSidebarCompact(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.uiPrefs.setSidebarCompact(Boolean(target?.checked));
  }

  toggleNavFavorite(item: AdminNavItemView, event: MouseEvent): void {
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
    this.recomputeNavViews();
  }

  clearNavQuery(): void {
    this.onNavQueryChange('');
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
    if (this.uiPrefs.preset() === 'owner_basic') return false;
    if (this.alertsLoading) return true;
    if (this.alertsError) return true;
    if (this.lowStockCount > 0 && this.auth.canAccessAdminSection('inventory')) return true;
    if (this.failedWebhooksCount > 0 && this.auth.canAccessAdminSection('ops')) return true;
    if (this.failedEmailsCount > 0 && this.auth.canAccessAdminSection('ops')) return true;
    return false;
  }

  onNavQueryChange(value: string): void {
    this.navQuery = typeof value === 'string' ? value : '';
    this.recomputeNavViews();
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (!this.isDesktop && event.key === 'Escape' && this.mobileSidebarOpen) {
      this.mobileSidebarOpen = false;
      return;
    }
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

  private recomputeNavViews(): void {
    const query = this.navQuery.trim().toLowerCase();
    const isOwnerBasic = this.uiPrefs.preset() === 'owner_basic';
    const allowAdvanced = this.uiPrefs.mode() === 'advanced' && !isOwnerBasic;
    const visibleBaseItems = allowAdvanced ? this.navItems : this.navItems.filter((item) => this.ownerBasicSections.has(item.section));

    const favoritePaths = new Set(
      this.favorites
        .items()
        .filter((item) => item?.type === 'page')
        .map((item) => (item?.url || '').trim())
        .filter(Boolean)
    );

    const toView = (item: AdminNavItem): AdminNavItemView => {
      const label = this.navLabel(item);
      const lowerLabel = label.toLowerCase();
      const idx = query ? lowerLabel.indexOf(query) : -1;
      const highlightBefore = idx >= 0 ? label.slice(0, idx) : label;
      const highlightMatch = idx >= 0 ? label.slice(idx, idx + query.length) : '';
      const highlightAfter = idx >= 0 ? label.slice(idx + query.length) : '';
      return {
        ...item,
        label,
        highlightBefore,
        highlightMatch,
        highlightAfter,
        isFavorite: favoritePaths.has(item.path)
      };
    };

    let filtered = visibleBaseItems;
    if (query) {
      filtered = visibleBaseItems.filter((item) => {
        const label = this.navLabel(item).toLowerCase();
        return label.includes(query) || item.section.includes(query);
      });
    }

    this.filteredNavItemsView = filtered.map(toView);

    const filteredByPath = new Map(this.filteredNavItemsView.map((item) => [item.path, item]));
    this.favoriteNavItemsView = Array.from(favoritePaths)
      .map((path) => filteredByPath.get(path))
      .filter((item): item is AdminNavItemView => Boolean(item));

    const grouped = new Map<AdminNavGroupKey, AdminNavItemView[]>();
    for (const key of this.groupOrder) grouped.set(key, []);
    for (const item of this.filteredNavItemsView) {
      const groupKey = this.sectionGroupMap[item.section] ?? 'operationsSecurity';
      grouped.get(groupKey)?.push(item);
    }
    this.groupedFilteredNavItemsView = this.groupOrder
      .map((key) => ({
        key,
        labelKey: this.groupLabelKey[key],
        items: grouped.get(key) ?? []
      }))
      .filter((group) => group.items.length > 0);
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
