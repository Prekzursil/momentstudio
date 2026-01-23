import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BreadcrumbComponent, Crumb } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { CardComponent } from '../../../shared/card.component';
import { InputComponent } from '../../../shared/input.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { AuthService } from '../../../core/auth.service';
import {
  AdminAuditEntriesResponse,
  AdminAuditEntity,
  AdminService,
  AdminSummary
} from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';
import { LocalizedCurrencyPipe } from '../../../shared/localized-currency.pipe';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    BreadcrumbComponent,
    CardComponent,
    ButtonComponent,
    InputComponent,
    SkeletonComponent,
    LocalizedCurrencyPipe
  ],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div *ngIf="error()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
        {{ error() }}
      </div>

      <div *ngIf="loading(); else dashboardTpl">
        <app-skeleton [rows]="6"></app-skeleton>
      </div>

      <ng-template #dashboardTpl>
        <section class="grid gap-3">
          <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.dashboardTitle' | translate }}</h1>

          <div class="flex flex-wrap items-end justify-between gap-3">
            <div class="flex flex-wrap items-end gap-3">
              <label class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'adminUi.dashboard.rangeLabel' | translate }}</span>
                <select
                  class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
                  [(ngModel)]="rangePreset"
                  (ngModelChange)="onRangePresetChange()"
                >
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="7">
                    {{ 'adminUi.dashboard.lastDays' | translate: { days: 7 } }}
                  </option>
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="30">
                    {{ 'adminUi.dashboard.lastDays' | translate: { days: 30 } }}
                  </option>
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="90">
                    {{ 'adminUi.dashboard.lastDays' | translate: { days: 90 } }}
                  </option>
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="custom">
                    {{ 'adminUi.dashboard.customRange' | translate }}
                  </option>
                </select>
              </label>

              <label *ngIf="rangePreset === 'custom'" class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'adminUi.dashboard.rangeFrom' | translate }}</span>
                <input
                  type="date"
                  class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
                  [(ngModel)]="rangeFrom"
                />
              </label>
              <label *ngIf="rangePreset === 'custom'" class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'adminUi.dashboard.rangeTo' | translate }}</span>
                <input
                  type="date"
                  class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
                  [(ngModel)]="rangeTo"
                />
              </label>

              <app-button size="sm" [label]="'adminUi.actions.apply' | translate" (action)="applyRange()"></app-button>
            </div>

            <p *ngIf="summary()" class="text-xs text-slate-500 dark:text-slate-400">
              {{ summary()?.range_from | date: 'mediumDate' }} → {{ summary()?.range_to | date: 'mediumDate' }}
            </p>
          </div>

          <div *ngIf="rangeError" class="text-sm text-rose-700 dark:text-rose-300">
            {{ rangeError }}
          </div>

          <div class="grid md:grid-cols-3 gap-4">
            <app-card [title]="'adminUi.cards.ordersToday' | translate">
              <div class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ summary()?.today_orders || 0 }}</div>
              <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                {{ 'adminUi.cards.vsYesterday' | translate }}: {{ summary()?.yesterday_orders || 0 }} · {{ deltaLabel(summary()?.orders_delta_pct) }}
              </div>
            </app-card>
            <app-card [title]="'adminUi.cards.salesToday' | translate">
              <div class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ (summary()?.today_sales || 0) | localizedCurrency : 'RON' }}</div>
              <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                {{ 'adminUi.cards.vsYesterday' | translate }}: {{ (summary()?.yesterday_sales || 0) | localizedCurrency : 'RON' }} ·
                {{ deltaLabel(summary()?.sales_delta_pct) }}
              </div>
            </app-card>
            <app-card [title]="'adminUi.cards.refundsToday' | translate">
              <div class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ summary()?.today_refunds || 0 }}</div>
              <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                {{ 'adminUi.cards.vsYesterday' | translate }}: {{ summary()?.yesterday_refunds || 0 }} · {{ deltaLabel(summary()?.refunds_delta_pct) }}
              </div>
            </app-card>
          </div>

          <div class="grid md:grid-cols-3 gap-4">
            <app-card
              [title]="'adminUi.cards.products' | translate"
              [subtitle]="'adminUi.cards.countTotal' | translate: { count: summary()?.products || 0 }"
            ></app-card>
            <app-card
              [title]="'adminUi.cards.orders' | translate"
              [subtitle]="'adminUi.cards.countTotal' | translate: { count: summary()?.orders || 0 }"
            ></app-card>
            <app-card
              [title]="'adminUi.cards.users' | translate"
              [subtitle]="'adminUi.cards.countTotal' | translate: { count: summary()?.users || 0 }"
            ></app-card>
          </div>

          <div class="grid md:grid-cols-3 gap-4">
            <app-card
              [title]="'adminUi.cards.lowStock' | translate"
              [subtitle]="'adminUi.cards.countItems' | translate: { count: summary()?.low_stock || 0 }"
            ></app-card>
            <app-card
              [title]="'adminUi.cards.salesRange' | translate: { days: summary()?.range_days || 30 }"
              [subtitle]="(summary()?.sales_range || 0) | localizedCurrency : 'RON'"
            ></app-card>
            <app-card
              [title]="'adminUi.cards.ordersRange' | translate: { days: summary()?.range_days || 30 }"
              [subtitle]="'adminUi.cards.countOrders' | translate: { count: summary()?.orders_range || 0 }"
            ></app-card>
          </div>
        </section>

        <section class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.audit.title' | translate }}</h2>
            <div class="flex items-center gap-2">
              <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.exportLimitNote' | translate }}</span>
              <app-button size="sm" [label]="'adminUi.audit.export' | translate" (action)="downloadAuditCsv()"></app-button>
            </div>
          </div>

          <div class="grid gap-3 md:grid-cols-[220px_1fr_1fr_auto] items-end">
            <label class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
              <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'adminUi.audit.filters.entity' | translate }}</span>
              <select
                class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
                [(ngModel)]="auditEntity"
                [attr.aria-label]="'adminUi.audit.filters.entity' | translate"
              >
                <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="all">
                  {{ 'adminUi.audit.entityAll' | translate }}
                </option>
                <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="product">
                  {{ 'adminUi.audit.products' | translate }}
                </option>
                <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="content">
                  {{ 'adminUi.audit.content' | translate }}
                </option>
                <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="security">
                  {{ 'adminUi.audit.security' | translate }}
                </option>
              </select>
            </label>

            <app-input
              [label]="'adminUi.audit.filters.action' | translate"
              [(value)]="auditAction"
              [placeholder]="'adminUi.audit.filters.actionPlaceholder' | translate"
              [ariaLabel]="'adminUi.audit.filters.action' | translate"
            ></app-input>

            <app-input
              [label]="'adminUi.audit.filters.user' | translate"
              [(value)]="auditUser"
              [placeholder]="'adminUi.audit.filters.userPlaceholder' | translate"
              [ariaLabel]="'adminUi.audit.filters.user' | translate"
            ></app-input>

            <app-button size="sm" [label]="'adminUi.audit.filters.apply' | translate" (action)="applyAuditFilters()"></app-button>
          </div>

          <div *ngIf="auditError()" class="text-sm text-rose-700 dark:text-rose-300">
            {{ auditError() }}
          </div>

          <div *ngIf="auditLoading(); else auditTpl">
            <app-skeleton [rows]="6"></app-skeleton>
          </div>

          <ng-template #auditTpl>
            <div *ngIf="auditEntries()?.items?.length; else auditEmptyTpl" class="grid gap-2">
              <div class="overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table class="min-w-[900px] w-full text-sm">
                  <thead class="bg-slate-50 text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
                    <tr>
                      <th class="text-left px-3 py-2 font-semibold">{{ 'adminUi.audit.at' | translate }}</th>
                      <th class="text-left px-3 py-2 font-semibold">{{ 'adminUi.audit.filters.entity' | translate }}</th>
                      <th class="text-left px-3 py-2 font-semibold">{{ 'adminUi.audit.filters.action' | translate }}</th>
                      <th class="text-left px-3 py-2 font-semibold">{{ 'adminUi.audit.actor' | translate }}</th>
                      <th class="text-left px-3 py-2 font-semibold">{{ 'adminUi.audit.subject' | translate }}</th>
                      <th class="text-left px-3 py-2 font-semibold">{{ 'adminUi.audit.reference' | translate }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
                    <tr *ngFor="let entry of auditEntries()?.items" class="text-slate-800 dark:text-slate-200">
                      <td class="px-3 py-2 whitespace-nowrap">{{ entry.created_at | date: 'short' }}</td>
                      <td class="px-3 py-2 whitespace-nowrap">
                        <span class="inline-flex rounded-full px-2 py-0.5 text-xs border border-slate-200 dark:border-slate-700">
                          {{ auditEntityLabel(entry.entity) }}
                        </span>
                      </td>
                      <td class="px-3 py-2">
                        <span *ngIf="entry.entity === 'security'; else rawActionTpl">
                          {{ ('adminUi.audit.securityActions.' + entry.action) | translate }}
                        </span>
                        <ng-template #rawActionTpl>{{ entry.action }}</ng-template>
                      </td>
                      <td class="px-3 py-2 whitespace-nowrap">{{ entry.actor_email || entry.actor_user_id || '—' }}</td>
                      <td class="px-3 py-2 whitespace-nowrap">{{ entry.subject_email || entry.subject_user_id || '—' }}</td>
                      <td class="px-3 py-2">
                        <span class="font-mono text-xs text-slate-600 dark:text-slate-400">
                          {{ entry.ref_key || entry.ref_id || '—' }}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="flex items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
                <span>
                  {{
                    'adminUi.audit.pagination' | translate: { page: auditEntries()?.meta?.page || 1, total: auditEntries()?.meta?.total_pages || 1 }
                  }}
                </span>
                <div class="flex items-center gap-2">
                  <app-button size="sm" [disabled]="!auditHasPrev()" [label]="'adminUi.audit.prev' | translate" (action)="auditPrev()"></app-button>
                  <app-button size="sm" [disabled]="!auditHasNext()" [label]="'adminUi.audit.next' | translate" (action)="auditNext()"></app-button>
                </div>
              </div>
            </div>

            <ng-template #auditEmptyTpl>
              <div class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.audit.empty' | translate }}</div>
            </ng-template>
          </ng-template>
        </section>

        <section
          *ngIf="isOwner()"
          class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.ownerTransfer.title' | translate }}</h2>
          </div>
          <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.ownerTransfer.description' | translate }}</p>

          <div class="grid gap-3 md:grid-cols-3 items-end text-sm">
            <app-input
              [label]="'adminUi.ownerTransfer.identifier' | translate"
              [(value)]="ownerTransferIdentifier"
              [placeholder]="'adminUi.ownerTransfer.identifierPlaceholder' | translate"
              [ariaLabel]="'adminUi.ownerTransfer.identifier' | translate"
            ></app-input>
            <app-input
              [label]="'adminUi.ownerTransfer.confirmLabel' | translate"
              [(value)]="ownerTransferConfirm"
              [placeholder]="'adminUi.ownerTransfer.confirmPlaceholder' | translate"
              [hint]="'adminUi.ownerTransfer.confirmHint' | translate"
              [ariaLabel]="'adminUi.ownerTransfer.confirmLabel' | translate"
            ></app-input>
            <app-input
              [label]="'auth.currentPassword' | translate"
              type="password"
              autocomplete="current-password"
              [(value)]="ownerTransferPassword"
              [ariaLabel]="'auth.currentPassword' | translate"
            ></app-input>
          </div>

          <div *ngIf="ownerTransferError" class="text-sm text-rose-700 dark:text-rose-300">
            {{ ownerTransferError }}
          </div>

          <div class="flex justify-end">
            <app-button
              size="sm"
              [disabled]="ownerTransferLoading"
              [label]="'adminUi.ownerTransfer.action' | translate"
              (action)="submitOwnerTransfer()"
            ></app-button>
          </div>
        </section>
      </ng-template>
    </div>
  `
})
export class AdminDashboardComponent implements OnInit {
  readonly crumbs: Crumb[] = [
    { label: 'adminUi.nav.dashboard', url: '/admin/dashboard' }
  ];

  loading = signal(true);
  error = signal('');
  summary = signal<AdminSummary | null>(null);

  rangePreset: '7' | '30' | '90' | 'custom' = '30';
  rangeFrom = '';
  rangeTo = '';
  rangeError = '';

  auditLoading = signal(false);
  auditError = signal('');
  auditEntries = signal<AdminAuditEntriesResponse | null>(null);
  auditEntity: AdminAuditEntity = 'all';
  auditAction = '';
  auditUser = '';

  ownerTransferIdentifier = '';
  ownerTransferConfirm = '';
  ownerTransferPassword = '';
  ownerTransferLoading = false;
  ownerTransferError = '';

  constructor(
    private admin: AdminService,
    private auth: AuthService,
    private toast: ToastService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.loadSummary();
    this.loadAudit(1);
  }

  isOwner(): boolean {
    return this.auth.role() === 'owner';
  }

  private loadSummary(): void {
    this.loading.set(true);
    this.error.set('');
    this.rangeError = '';
    this.admin.summary(this.buildSummaryParams()).subscribe({
      next: (data) => {
        this.summary.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.translate.instant('adminUi.errors.generic'));
        this.loading.set(false);
      }
    });
  }

  onRangePresetChange(): void {
    if (this.rangePreset === 'custom') return;
    this.loadSummary();
  }

  applyRange(): void {
    if (this.rangePreset !== 'custom') {
      this.loadSummary();
      return;
    }
    const from = (this.rangeFrom || '').trim();
    const to = (this.rangeTo || '').trim();
    if (!from || !to) {
      this.rangeError = this.translate.instant('adminUi.dashboard.rangeErrors.missing');
      return;
    }
    if (to < from) {
      this.rangeError = this.translate.instant('adminUi.dashboard.rangeErrors.order');
      return;
    }
    this.loadSummary();
  }

  private buildSummaryParams(): { range_days?: number; range_from?: string; range_to?: string } | undefined {
    if (this.rangePreset === 'custom') {
      const from = (this.rangeFrom || '').trim();
      const to = (this.rangeTo || '').trim();
      if (!from || !to) return undefined;
      return { range_from: from, range_to: to };
    }
    const days = Number(this.rangePreset);
    if (!Number.isFinite(days) || days <= 0) return undefined;
    return { range_days: days };
  }

  deltaLabel(deltaPct: number | null | undefined): string {
    if (deltaPct === null || deltaPct === undefined) return '—';
    const rounded = Math.round(deltaPct * 10) / 10;
    const sign = rounded > 0 ? '+' : '';
    return `${sign}${rounded}%`;
  }

  private loadAudit(page: number): void {
    this.auditLoading.set(true);
    this.auditError.set('');
    this.admin
      .auditEntries({
        entity: this.auditEntity,
        action: (this.auditAction || '').trim() || undefined,
        user: (this.auditUser || '').trim() || undefined,
        page,
        limit: 20
      })
      .subscribe({
        next: (resp) => {
          this.auditEntries.set(resp);
          this.auditLoading.set(false);
        },
        error: () => {
          this.auditEntries.set({ items: [], meta: { page: 1, limit: 20, total_items: 0, total_pages: 1 } });
          this.auditError.set(this.translate.instant('adminUi.audit.errors.loadCopy'));
          this.auditLoading.set(false);
        }
      });
  }

  applyAuditFilters(): void {
    this.loadAudit(1);
  }

  auditHasPrev(): boolean {
    const current = this.auditEntries()?.meta?.page || 1;
    return current > 1;
  }

  auditHasNext(): boolean {
    const meta = this.auditEntries()?.meta;
    if (!meta) return false;
    return meta.page < meta.total_pages;
  }

  auditPrev(): void {
    const meta = this.auditEntries()?.meta;
    if (!meta || meta.page <= 1) return;
    this.loadAudit(meta.page - 1);
  }

  auditNext(): void {
    const meta = this.auditEntries()?.meta;
    if (!meta || meta.page >= meta.total_pages) return;
    this.loadAudit(meta.page + 1);
  }

  auditEntityLabel(entity: AdminAuditEntity): string {
    if (entity === 'product') return this.translate.instant('adminUi.audit.products');
    if (entity === 'content') return this.translate.instant('adminUi.audit.content');
    if (entity === 'security') return this.translate.instant('adminUi.audit.security');
    return this.translate.instant('adminUi.audit.entityAll');
  }

  downloadAuditCsv(): void {
    this.admin
      .exportAuditCsv({
        entity: this.auditEntity,
        action: (this.auditAction || '').trim() || undefined,
        user: (this.auditUser || '').trim() || undefined,
      })
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `audit-${this.auditEntity || 'all'}.csv`;
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
        error: () => {
          this.toast.error(this.translate.instant('adminUi.audit.errors.loadTitle'), this.translate.instant('adminUi.audit.errors.loadCopy'));
        }
      });
  }

  submitOwnerTransfer(): void {
    const identifier = (this.ownerTransferIdentifier || '').trim();
    if (!identifier) {
      this.ownerTransferError = this.translate.instant('adminUi.ownerTransfer.errors.identifier');
      return;
    }
    this.ownerTransferError = '';
    this.ownerTransferLoading = true;
    this.admin
      .transferOwner({ identifier, confirm: this.ownerTransferConfirm, password: this.ownerTransferPassword })
      .subscribe({
        next: () => {
          this.ownerTransferLoading = false;
          this.ownerTransferIdentifier = '';
          this.ownerTransferConfirm = '';
          this.ownerTransferPassword = '';
          this.toast.success(
            this.translate.instant('adminUi.ownerTransfer.successTitle'),
            this.translate.instant('adminUi.ownerTransfer.successCopy')
          );
        },
        error: () => {
          this.ownerTransferLoading = false;
          this.ownerTransferError = this.translate.instant('adminUi.ownerTransfer.errors.generic');
        }
      });
  }
}
