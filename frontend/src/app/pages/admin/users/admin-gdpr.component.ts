import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AdminPaginationMeta } from '../../../core/admin-orders.service';
import { AdminGdprDeletionRequestItem, AdminGdprExportJobItem, AdminUsersService } from '../../../core/admin-users.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../core/toast.service';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';
import { ModalComponent } from '../../../shared/modal.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';

type ExportStatusFilter = 'all' | 'pending' | 'running' | 'succeeded' | 'failed';

@Component({
  selector: 'app-admin-gdpr',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    BreadcrumbComponent,
    ButtonComponent,
    InputComponent,
    ModalComponent,
    SkeletonComponent
  ],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div class="grid gap-1">
        <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.gdpr.title' | translate }}</h1>
        <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.gdpr.hint' | translate }}</p>
      </div>

      <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
        <div class="grid gap-3 lg:grid-cols-[1fr_240px_auto] items-end">
          <app-input [label]="'adminUi.gdpr.search' | translate" [(value)]="q"></app-input>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.gdpr.exportStatus' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="exportStatus"
            >
              <option value="all">{{ 'adminUi.gdpr.statusAll' | translate }}</option>
              <option value="pending">{{ 'adminUi.gdpr.status.pending' | translate }}</option>
              <option value="running">{{ 'adminUi.gdpr.status.running' | translate }}</option>
              <option value="succeeded">{{ 'adminUi.gdpr.status.succeeded' | translate }}</option>
              <option value="failed">{{ 'adminUi.gdpr.status.failed' | translate }}</option>
            </select>
          </label>

          <div class="flex items-center gap-2">
            <app-button size="sm" [label]="'adminUi.actions.refresh' | translate" (action)="applyFilters()"></app-button>
            <app-button size="sm" variant="ghost" [label]="'adminUi.actions.reset' | translate" (action)="resetFilters()"></app-button>
          </div>
        </div>
      </section>

      <section class="grid gap-4 lg:grid-cols-2 items-start">
        <div class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between gap-3">
            <div class="grid gap-1">
              <h2 class="text-base font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.gdpr.exportsTitle' | translate }}</h2>
              <p class="text-xs text-slate-600 dark:text-slate-300">{{ exportsMetaText() }}</p>
            </div>
            <div class="flex items-center gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.prev' | translate"
                [disabled]="exportsLoading() || exportsMeta()?.page === 1"
                (action)="exportsPrev()"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.next' | translate"
                [disabled]="exportsLoading() || exportsMeta()?.page === exportsMeta()?.total_pages"
                (action)="exportsNext()"
              ></app-button>
            </div>
          </div>

          <div *ngIf="exportsError()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
            {{ exportsError() }}
          </div>

          <div *ngIf="exportsLoading(); else exportsTpl">
            <app-skeleton [rows]="8"></app-skeleton>
          </div>
          <ng-template #exportsTpl>
            <div *ngIf="exports().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.gdpr.exportsEmpty' | translate }}
            </div>

            <div *ngIf="exports().length > 0" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table class="min-w-[860px] w-full text-sm">
                <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                  <tr>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.gdpr.table.user' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.gdpr.table.status' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.gdpr.table.requested' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.gdpr.table.slaDue' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.gdpr.table.expires' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.gdpr.table.actions' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let job of exports(); trackBy: trackExportJob" class="border-t border-slate-200 dark:border-slate-800">
                    <td class="px-3 py-2">
                      <div class="grid gap-0.5">
                        <button class="text-left font-medium text-indigo-700 hover:underline dark:text-indigo-200" (click)="openUser(job.user.email)">
                          {{ job.user.email }}
                        </button>
                        <div class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ job.user.username }}</div>
                      </div>
                    </td>
                    <td class="px-3 py-2">
                      <div class="flex items-center gap-2">
                        <span class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold" [ngClass]="statusPill(job.status)">
                          {{ ('adminUi.gdpr.status.' + job.status) | translate }}
                        </span>
                        <span *ngIf="job.sla_breached" class="inline-flex items-center rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-900 dark:bg-rose-900/30 dark:text-rose-100">
                          {{ 'adminUi.gdpr.slaBreached' | translate }}
                        </span>
                      </div>
                      <div class="mt-1 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800">
                        <div class="h-1.5 rounded-full bg-indigo-500" [style.width.%]="progressPct(job)"></div>
                      </div>
                    </td>
                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ job.created_at | date: 'short' }}</td>
                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ job.sla_due_at | date: 'shortDate' }}</td>
                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ job.expires_at ? (job.expires_at | date: 'shortDate') : '—' }}</td>
                    <td class="px-3 py-2">
                      <div class="flex justify-end gap-2">
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.gdpr.download' | translate"
                          [disabled]="!canAdminActions() || !job.has_file || job.status !== 'succeeded' || downloadingJobId() === job.id"
                          (action)="downloadExport(job)"
                        ></app-button>
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.gdpr.retry' | translate"
                          [disabled]="!canAdminActions() || job.status === 'running' || retryingJobId() === job.id"
                          (action)="retryExport(job)"
                        ></app-button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </ng-template>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between gap-3">
            <div class="grid gap-1">
              <h2 class="text-base font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.gdpr.deletionsTitle' | translate }}</h2>
              <p class="text-xs text-slate-600 dark:text-slate-300">{{ deletionsMetaText() }}</p>
            </div>
            <div class="flex items-center gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.prev' | translate"
                [disabled]="deletionsLoading() || deletionsMeta()?.page === 1"
                (action)="deletionsPrev()"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.next' | translate"
                [disabled]="deletionsLoading() || deletionsMeta()?.page === deletionsMeta()?.total_pages"
                (action)="deletionsNext()"
              ></app-button>
            </div>
          </div>

          <div *ngIf="deletionsError()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
            {{ deletionsError() }}
          </div>

          <div *ngIf="deletionsLoading(); else deletionsTpl">
            <app-skeleton [rows]="8"></app-skeleton>
          </div>
          <ng-template #deletionsTpl>
            <div *ngIf="deletions().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.gdpr.deletionsEmpty' | translate }}
            </div>

            <div *ngIf="deletions().length > 0" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table class="min-w-[860px] w-full text-sm">
                <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                  <tr>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.gdpr.table.user' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.gdpr.table.status' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.gdpr.table.requested' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.gdpr.table.scheduledFor' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.gdpr.table.slaDue' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.gdpr.table.actions' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let item of deletions(); trackBy: trackDeletion" class="border-t border-slate-200 dark:border-slate-800">
                    <td class="px-3 py-2">
                      <div class="grid gap-0.5">
                        <button class="text-left font-medium text-indigo-700 hover:underline dark:text-indigo-200" (click)="openUser(item.user.email)">
                          {{ item.user.email }}
                        </button>
                        <div class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ item.user.username }}</div>
                      </div>
                    </td>
                    <td class="px-3 py-2">
                      <div class="flex items-center gap-2">
                        <span class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold" [ngClass]="deletionStatusPill(item.status)">
                          {{ ('adminUi.gdpr.deletionStatus.' + item.status) | translate }}
                        </span>
                        <span *ngIf="item.sla_breached" class="inline-flex items-center rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-900 dark:bg-rose-900/30 dark:text-rose-100">
                          {{ 'adminUi.gdpr.slaBreached' | translate }}
                        </span>
                      </div>
                    </td>
                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ item.requested_at | date: 'short' }}</td>
                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ item.scheduled_for ? (item.scheduled_for | date: 'short' ) : '—' }}</td>
                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ item.sla_due_at | date: 'shortDate' }}</td>
                    <td class="px-3 py-2">
                      <div class="flex justify-end gap-2">
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.gdpr.executeNow' | translate"
                          [disabled]="!canAdminActions() || deletionBusyUserId() === item.user.id"
                          (action)="executeDeletion(item)"
                        ></app-button>
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.gdpr.cancelRequest' | translate"
                          [disabled]="!canAdminActions() || deletionBusyUserId() === item.user.id"
                          (action)="cancelDeletion(item)"
                        ></app-button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </ng-template>
        </div>
      </section>

      <app-modal
        [open]="executeDeletionModalOpen()"
        [title]="'adminUi.gdpr.executeNow' | translate"
        [subtitle]="'adminUi.gdpr.confirms.executeDeletion' | translate"
        [confirmLabel]="'adminUi.gdpr.executeNow' | translate"
        [cancelLabel]="'adminUi.common.cancel' | translate"
        [closeLabel]="'adminUi.common.close' | translate"
        [confirmDisabled]="executeDeletionConfirmDisabled()"
        (confirm)="confirmExecuteDeletion()"
        (closed)="closeExecuteDeletionModal()"
      >
        <div class="grid gap-3">
          <div *ngIf="executeDeletionTarget() as target" class="text-sm text-slate-700 dark:text-slate-200">
            {{ target.user.email }}
          </div>

          <app-input
            type="password"
            [label]="'adminUi.gdpr.passwordLabel' | translate"
            [(value)]="executeDeletionPassword"
            [placeholder]="'adminUi.gdpr.passwordPlaceholder' | translate"
            [ariaLabel]="'adminUi.gdpr.passwordLabel' | translate"
          ></app-input>

          <div *ngIf="executeDeletionModalError" class="text-sm text-rose-700 dark:text-rose-300">
            {{ executeDeletionModalError }}
          </div>
        </div>
      </app-modal>
    </div>
  `
})
export class AdminGdprComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin', url: '/admin/dashboard' },
    { label: 'adminUi.users.title', url: '/admin/users' },
    { label: 'adminUi.gdpr.title' }
  ];

  q = '';
  exportStatus: ExportStatusFilter = 'all';

  exports = signal<AdminGdprExportJobItem[]>([]);
  exportsMeta = signal<AdminPaginationMeta | null>(null);
  exportsLoading = signal(true);
  exportsError = signal<string | null>(null);
  exportsPage = 1;
  exportsLimit = 25;

  deletions = signal<AdminGdprDeletionRequestItem[]>([]);
  deletionsMeta = signal<AdminPaginationMeta | null>(null);
  deletionsLoading = signal(true);
  deletionsError = signal<string | null>(null);
  deletionsPage = 1;
  deletionsLimit = 25;

  retryingJobId = signal<string | null>(null);
  downloadingJobId = signal<string | null>(null);
  deletionBusyUserId = signal<string | null>(null);
  executeDeletionModalOpen = signal(false);
  executeDeletionTarget = signal<AdminGdprDeletionRequestItem | null>(null);
  executeDeletionPassword = '';
  executeDeletionModalError = '';

  constructor(
    private usersApi: AdminUsersService,
    private auth: AuthService,
    private router: Router,
    private toast: ToastService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.loadAll();
  }

  canAdminActions(): boolean {
    return this.auth.isAdmin();
  }

  applyFilters(): void {
    this.exportsPage = 1;
    this.deletionsPage = 1;
    this.loadAll();
  }

  resetFilters(): void {
    this.q = '';
    this.exportStatus = 'all';
    this.applyFilters();
  }

  exportsPrev(): void {
    this.exportsPage = Math.max(1, this.exportsPage - 1);
    this.loadExports();
  }

  exportsNext(): void {
    this.exportsPage = this.exportsPage + 1;
    this.loadExports();
  }

  deletionsPrev(): void {
    this.deletionsPage = Math.max(1, this.deletionsPage - 1);
    this.loadDeletions();
  }

  deletionsNext(): void {
    this.deletionsPage = this.deletionsPage + 1;
    this.loadDeletions();
  }

  exportsMetaText(): string {
    const meta = this.exportsMeta();
    if (!meta) return '';
    return this.translate.instant('adminUi.gdpr.pagination', meta as any) as string;
  }

  deletionsMetaText(): string {
    const meta = this.deletionsMeta();
    if (!meta) return '';
    return this.translate.instant('adminUi.gdpr.pagination', meta as any) as string;
  }

  progressPct(job: AdminGdprExportJobItem): number {
    const pct = Number(job.progress ?? 0);
    if (!Number.isFinite(pct)) return 0;
    return Math.max(0, Math.min(100, pct));
  }

  statusPill(status: string): string {
    if (status === 'succeeded') return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100';
    if (status === 'failed') return 'bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-100';
    if (status === 'running') return 'bg-indigo-100 text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-100';
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
  }

  deletionStatusPill(status: string): string {
    if (status === 'due') return 'bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-100';
    if (status === 'cooldown') return 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100';
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
  }

  openUser(prefill: string): void {
    const needle = (prefill || '').trim();
    if (!needle) return;
    void this.router.navigateByUrl('/admin/users', { state: { prefillUserSearch: needle, autoSelectFirst: true } });
  }

  retryExport(job: AdminGdprExportJobItem): void {
    if (!job?.id) return;
    if (!this.canAdminActions()) return;
    if (!window.confirm(this.t('adminUi.gdpr.confirms.retryExport'))) return;
    this.retryingJobId.set(job.id);
    this.usersApi.retryGdprExportJob(job.id).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.gdpr.success.retryExport'));
        this.loadExports();
        this.retryingJobId.set(null);
      },
      error: () => {
        this.toast.error(this.t('adminUi.gdpr.errors.retryExport'));
        this.retryingJobId.set(null);
      }
    });
  }

  downloadExport(job: AdminGdprExportJobItem): void {
    if (!job?.id) return;
    if (!this.canAdminActions()) return;
    this.downloadingJobId.set(job.id);
    this.usersApi.downloadGdprExportJob(job.id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `moment-studio-export-${stamp}.json`;
        a.click();
        window.URL.revokeObjectURL(url);
        this.toast.success(this.t('adminUi.gdpr.success.download'));
        this.downloadingJobId.set(null);
      },
      error: () => {
        this.toast.error(this.t('adminUi.gdpr.errors.download'));
        this.downloadingJobId.set(null);
      }
    });
  }

  executeDeletion(item: AdminGdprDeletionRequestItem): void {
    const userId = item?.user?.id;
    if (!userId) return;
    if (!this.canAdminActions()) return;
    this.executeDeletionTarget.set(item);
    this.executeDeletionPassword = '';
    this.executeDeletionModalError = '';
    this.executeDeletionModalOpen.set(true);
  }

  executeDeletionConfirmDisabled(): boolean {
    if (this.deletionBusyUserId()) return true;
    return !(this.executeDeletionPassword || '').trim();
  }

  closeExecuteDeletionModal(): void {
    this.executeDeletionModalOpen.set(false);
    this.executeDeletionTarget.set(null);
    this.executeDeletionPassword = '';
    this.executeDeletionModalError = '';
  }

  confirmExecuteDeletion(): void {
    const item = this.executeDeletionTarget();
    const userId = item?.user?.id;
    if (!userId) {
      this.closeExecuteDeletionModal();
      return;
    }
    if (!this.canAdminActions()) {
      this.closeExecuteDeletionModal();
      return;
    }

    const password = (this.executeDeletionPassword || '').trim();
    if (!password) {
      this.executeDeletionModalError = this.t('adminUi.gdpr.passwordRequired');
      return;
    }

    this.deletionBusyUserId.set(userId);
    this.usersApi.executeGdprDeletion(userId, password).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.gdpr.success.executeDeletion'));
        this.loadDeletions();
        this.deletionBusyUserId.set(null);
        this.closeExecuteDeletionModal();
      },
      error: (err) => {
        const detail = err?.error?.detail;
        this.executeDeletionModalError =
          typeof detail === 'string' && detail ? detail : this.t('adminUi.gdpr.errors.executeDeletion');
        this.toast.error(this.executeDeletionModalError);
        this.deletionBusyUserId.set(null);
      }
    });
  }

  cancelDeletion(item: AdminGdprDeletionRequestItem): void {
    const userId = item?.user?.id;
    if (!userId) return;
    if (!this.canAdminActions()) return;
    if (!window.confirm(this.t('adminUi.gdpr.confirms.cancelDeletion'))) return;
    this.deletionBusyUserId.set(userId);
    this.usersApi.cancelGdprDeletion(userId).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.gdpr.success.cancelDeletion'));
        this.loadDeletions();
        this.deletionBusyUserId.set(null);
      },
      error: () => {
        this.toast.error(this.t('adminUi.gdpr.errors.cancelDeletion'));
        this.deletionBusyUserId.set(null);
      }
    });
  }

  trackExportJob = (_: number, job: AdminGdprExportJobItem) => job.id;
  trackDeletion = (_: number, item: AdminGdprDeletionRequestItem) => item.user.id;

  private loadAll(): void {
    this.loadExports();
    this.loadDeletions();
  }

  private loadExports(): void {
    this.exportsLoading.set(true);
    this.exportsError.set(null);
    this.usersApi
      .listGdprExportJobs({
        q: this.q.trim() ? this.q.trim() : undefined,
        status: this.exportStatus === 'all' ? undefined : this.exportStatus,
        page: this.exportsPage,
        limit: this.exportsLimit
      })
      .subscribe({
        next: (res) => {
          this.exports.set(res.items || []);
          this.exportsMeta.set(res.meta || null);
          this.exportsLoading.set(false);
        },
        error: () => {
          this.exportsError.set(this.t('adminUi.gdpr.errors.loadExports'));
          this.exportsLoading.set(false);
        }
      });
  }

  private loadDeletions(): void {
    this.deletionsLoading.set(true);
    this.deletionsError.set(null);
    this.usersApi
      .listGdprDeletionRequests({
        q: this.q.trim() ? this.q.trim() : undefined,
        page: this.deletionsPage,
        limit: this.deletionsLimit
      })
      .subscribe({
        next: (res) => {
          this.deletions.set(res.items || []);
          this.deletionsMeta.set(res.meta || null);
          this.deletionsLoading.set(false);
        },
        error: () => {
          this.deletionsError.set(this.t('adminUi.gdpr.errors.loadDeletions'));
          this.deletionsLoading.set(false);
        }
      });
  }

  private t(key: string): string {
    return this.translate.instant(key) as string;
  }
}
