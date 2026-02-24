import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AdminPaginationMeta } from '../../../core/admin-orders.service';
import { AdminUserSegmentListItem, AdminUsersService } from '../../../core/admin-users.service';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { AdminPageHeaderComponent } from '../shared/admin-page-header.component';

@Component({
  selector: 'app-admin-user-segments',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    BreadcrumbComponent,
    ButtonComponent,
    InputComponent,
    SkeletonComponent,
    AdminPageHeaderComponent
  ],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <app-admin-page-header [titleKey]="'adminUi.segments.title'" [hintKey]="'adminUi.segments.hint'"></app-admin-page-header>

      <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
        <div class="grid gap-3 lg:grid-cols-[1fr_auto] items-end">
          <app-input [label]="'adminUi.segments.search' | translate" [(value)]="q"></app-input>
          <div class="flex items-center gap-2">
            <app-button size="sm" [label]="'adminUi.actions.refresh' | translate" (action)="applyFilters()"></app-button>
            <app-button size="sm" variant="ghost" [label]="'adminUi.actions.reset' | translate" (action)="resetFilters()"></app-button>
          </div>
        </div>
      </section>

      <section class="grid gap-4 lg:grid-cols-2 items-start">
        <div class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-start justify-between gap-3">
            <div class="grid gap-1">
              <h2 class="text-base font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.segments.repeatBuyers.title' | translate }}</h2>
              <p class="text-xs text-slate-600 dark:text-slate-300">{{ repeatMetaText() }}</p>
            </div>
            <div class="flex items-center gap-2">
              <label class="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                {{ 'adminUi.segments.repeatBuyers.minOrders' | translate }}
                <input
                  type="number"
                  min="1"
                  max="100"
                  class="h-10 w-28 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="repeatMinOrders"
                />
              </label>
            </div>
          </div>

          <div *ngIf="repeatError()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
            {{ repeatError() }}
          </div>

          <div *ngIf="repeatLoading(); else repeatTpl">
            <app-skeleton [rows]="8"></app-skeleton>
          </div>
          <ng-template #repeatTpl>
            <div *ngIf="repeatItems().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.segments.repeatBuyers.empty' | translate }}
            </div>

            <div *ngIf="repeatItems().length > 0" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table class="min-w-[820px] w-full text-sm">
                <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                  <tr>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.segments.table.user' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.segments.table.orders' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.segments.table.total' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.segments.table.aov' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let row of repeatItems(); trackBy: trackRow" class="border-t border-slate-200 dark:border-slate-800">
                    <td class="px-3 py-2">
                      <div class="grid gap-0.5">
                        <button class="text-left font-medium text-indigo-700 hover:underline dark:text-indigo-200" (click)="openUser(row.user.email)">
                          {{ row.user.email }}
                        </button>
                        <div class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ row.user.username }}</div>
                      </div>
                    </td>
                    <td class="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{{ row.orders_count }}</td>
                    <td class="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{{ formatMoney(row.total_spent) }}</td>
                    <td class="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{{ formatMoney(row.avg_order_value) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="flex justify-end gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.prev' | translate"
                [disabled]="repeatLoading() || repeatMeta()?.page === 1"
                (action)="repeatPrev()"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.next' | translate"
                [disabled]="repeatLoading() || repeatMeta()?.page === repeatMeta()?.total_pages"
                (action)="repeatNext()"
              ></app-button>
            </div>
          </ng-template>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-start justify-between gap-3">
            <div class="grid gap-1">
              <h2 class="text-base font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.segments.highAov.title' | translate }}</h2>
              <p class="text-xs text-slate-600 dark:text-slate-300">{{ aovMetaText() }}</p>
            </div>
            <div class="flex flex-wrap items-end gap-2 justify-end">
              <label class="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                {{ 'adminUi.segments.highAov.minOrders' | translate }}
                <input
                  type="number"
                  min="1"
                  max="100"
                  class="h-10 w-28 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="aovMinOrders"
                />
              </label>
              <label class="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                {{ 'adminUi.segments.highAov.minAov' | translate }}
                <input
                  type="number"
                  min="0"
                  step="1"
                  class="h-10 w-32 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="aovMinAov"
                />
              </label>
            </div>
          </div>

          <div *ngIf="aovError()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
            {{ aovError() }}
          </div>

          <div *ngIf="aovLoading(); else aovTpl">
            <app-skeleton [rows]="8"></app-skeleton>
          </div>
          <ng-template #aovTpl>
            <div *ngIf="aovItems().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.segments.highAov.empty' | translate }}
            </div>

            <div *ngIf="aovItems().length > 0" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table class="min-w-[820px] w-full text-sm">
                <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                  <tr>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.segments.table.user' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.segments.table.orders' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.segments.table.total' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.segments.table.aov' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let row of aovItems(); trackBy: trackRow" class="border-t border-slate-200 dark:border-slate-800">
                    <td class="px-3 py-2">
                      <div class="grid gap-0.5">
                        <button class="text-left font-medium text-indigo-700 hover:underline dark:text-indigo-200" (click)="openUser(row.user.email)">
                          {{ row.user.email }}
                        </button>
                        <div class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ row.user.username }}</div>
                      </div>
                    </td>
                    <td class="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{{ row.orders_count }}</td>
                    <td class="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{{ formatMoney(row.total_spent) }}</td>
                    <td class="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{{ formatMoney(row.avg_order_value) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="flex justify-end gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.prev' | translate"
                [disabled]="aovLoading() || aovMeta()?.page === 1"
                (action)="aovPrev()"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.next' | translate"
                [disabled]="aovLoading() || aovMeta()?.page === aovMeta()?.total_pages"
                (action)="aovNext()"
              ></app-button>
            </div>
          </ng-template>
        </div>
      </section>
    </div>
  `
})
export class AdminSegmentsComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin', url: '/admin/dashboard' },
    { label: 'adminUi.users.title', url: '/admin/users' },
    { label: 'adminUi.segments.title' }
  ];

  q = '';

  repeatMinOrders = 2;
  repeatPage = 1;
  repeatLimit = 25;
  repeatItems = signal<AdminUserSegmentListItem[]>([]);
  repeatMeta = signal<AdminPaginationMeta | null>(null);
  repeatLoading = signal(true);
  repeatError = signal<string | null>(null);

  aovMinOrders = 1;
  aovMinAov = 0;
  aovPage = 1;
  aovLimit = 25;
  aovItems = signal<AdminUserSegmentListItem[]>([]);
  aovMeta = signal<AdminPaginationMeta | null>(null);
  aovLoading = signal(true);
  aovError = signal<string | null>(null);

  constructor(private readonly usersApi: AdminUsersService, private router: Router, private translate: TranslateService) {}

  ngOnInit(): void {
    this.loadAll();
  }

  applyFilters(): void {
    this.repeatPage = 1;
    this.aovPage = 1;
    this.loadAll();
  }

  resetFilters(): void {
    this.q = '';
    this.repeatMinOrders = 2;
    this.aovMinOrders = 1;
    this.aovMinAov = 0;
    this.applyFilters();
  }

  repeatPrev(): void {
    this.repeatPage = Math.max(1, this.repeatPage - 1);
    this.loadRepeat();
  }

  repeatNext(): void {
    this.repeatPage = this.repeatPage + 1;
    this.loadRepeat();
  }

  aovPrev(): void {
    this.aovPage = Math.max(1, this.aovPage - 1);
    this.loadAov();
  }

  aovNext(): void {
    this.aovPage = this.aovPage + 1;
    this.loadAov();
  }

  repeatMetaText(): string {
    const meta = this.repeatMeta();
    if (!meta) return '';
    return this.translate.instant('adminUi.segments.pagination', meta as any) as string;
  }

  aovMetaText(): string {
    const meta = this.aovMeta();
    if (!meta) return '';
    return this.translate.instant('adminUi.segments.pagination', meta as any) as string;
  }

  formatMoney(value: unknown): string {
    const num = typeof value === 'number' ? value : Number(value);
    const clean = Number.isFinite(num) ? num : 0;
    return `${clean.toFixed(2)} RON`;
  }

  openUser(prefill: string): void {
    const needle = (prefill || '').trim();
    if (!needle) return;
    void this.router.navigateByUrl('/admin/users', { state: { prefillUserSearch: needle, autoSelectFirst: true } });
  }

  trackRow = (_: number, row: AdminUserSegmentListItem) => row.user.id;

  private loadAll(): void {
    this.loadRepeat();
    this.loadAov();
  }

  private loadRepeat(): void {
    this.repeatLoading.set(true);
    this.repeatError.set(null);
    this.usersApi
      .listRepeatBuyersSegment({
        q: this.q.trim() ? this.q.trim() : undefined,
        min_orders: this.repeatMinOrders,
        page: this.repeatPage,
        limit: this.repeatLimit
      })
      .subscribe({
        next: (res) => {
          this.repeatItems.set(res.items || []);
          this.repeatMeta.set(res.meta || null);
          this.repeatLoading.set(false);
        },
        error: () => {
          this.repeatError.set(this.translate.instant('adminUi.segments.errors.repeatLoad') as string);
          this.repeatLoading.set(false);
        }
      });
  }

  private loadAov(): void {
    this.aovLoading.set(true);
    this.aovError.set(null);
    this.usersApi
      .listHighAovSegment({
        q: this.q.trim() ? this.q.trim() : undefined,
        min_orders: this.aovMinOrders,
        min_aov: this.aovMinAov,
        page: this.aovPage,
        limit: this.aovLimit
      })
      .subscribe({
        next: (res) => {
          this.aovItems.set(res.items || []);
          this.aovMeta.set(res.meta || null);
          this.aovLoading.set(false);
        },
        error: () => {
          this.aovError.set(this.translate.instant('adminUi.segments.errors.aovLoad') as string);
          this.aovLoading.set(false);
        }
      });
  }
}

