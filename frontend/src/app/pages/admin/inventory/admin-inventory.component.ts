import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BreadcrumbComponent, Crumb } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { AdminService, RestockListItem, RestockListResponse, RestockNoteUpsert } from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';

type RestockRow = RestockListItem & {
  draftSupplier: string;
  draftDesiredQuantity: string;
  draftNote: string;
  isDirty: boolean;
  isSaving: boolean;
};

@Component({
  selector: 'app-admin-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, BreadcrumbComponent, ButtonComponent, SkeletonComponent],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div class="flex items-start justify-between gap-4">
        <div class="grid gap-1">
          <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.inventory.title' | translate }}</h1>
          <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.inventory.hint' | translate }}</p>
        </div>
        <app-button
          size="sm"
          [label]="'adminUi.inventory.export' | translate"
          (action)="exportCsv()"
          [disabled]="loading() || exporting"
        ></app-button>
      </div>

      <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
        <div class="grid gap-3 lg:grid-cols-[auto_auto_1fr] items-end">
          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            <span>{{ 'adminUi.inventory.filters.includeVariants' | translate }}</span>
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/40 dark:border-slate-600"
              [(ngModel)]="includeVariants"
            />
          </label>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            <span>{{ 'adminUi.inventory.filters.defaultThreshold' | translate }}</span>
            <input
              type="number"
              min="1"
              max="1000"
              class="h-10 w-40 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="defaultThreshold"
            />
          </label>

          <div class="flex items-center justify-end gap-2">
            <app-button
              size="sm"
              [label]="'adminUi.actions.refresh' | translate"
              (action)="applyFilters()"
              [disabled]="loading()"
            ></app-button>
          </div>
        </div>

        <div *ngIf="error()" class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
          {{ error() }}
        </div>

        <ng-container *ngIf="loading(); else tableTpl">
          <div class="grid gap-2">
            <app-skeleton height="2.5rem"></app-skeleton>
            <app-skeleton height="2.5rem"></app-skeleton>
            <app-skeleton height="2.5rem"></app-skeleton>
            <app-skeleton height="2.5rem"></app-skeleton>
          </div>
        </ng-container>

        <ng-template #tableTpl>
          <div *ngIf="!rows().length" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'adminUi.inventory.empty' | translate }}
          </div>

          <div *ngIf="rows().length" class="overflow-x-auto">
            <table class="min-w-[1400px] w-full text-sm">
              <thead class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <tr>
                  <th class="text-left py-2 pr-4">{{ 'adminUi.inventory.table.item' | translate }}</th>
                  <th class="text-right py-2 pr-4">{{ 'adminUi.inventory.table.stock' | translate }}</th>
                  <th class="text-right py-2 pr-4">{{ 'adminUi.inventory.table.reservedCarts' | translate }}</th>
                  <th class="text-right py-2 pr-4">{{ 'adminUi.inventory.table.reservedOrders' | translate }}</th>
                  <th class="text-right py-2 pr-4">{{ 'adminUi.inventory.table.available' | translate }}</th>
                  <th class="text-right py-2 pr-4">{{ 'adminUi.inventory.table.threshold' | translate }}</th>
                  <th class="text-left py-2 pr-4">{{ 'adminUi.inventory.table.supplier' | translate }}</th>
                  <th class="text-right py-2 pr-4">{{ 'adminUi.inventory.table.desiredQty' | translate }}</th>
                  <th class="text-left py-2 pr-4">{{ 'adminUi.inventory.table.note' | translate }}</th>
                  <th class="text-left py-2 pr-4">{{ 'adminUi.inventory.table.updated' | translate }}</th>
                  <th class="text-right py-2">{{ 'adminUi.inventory.table.actions' | translate }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200 dark:divide-slate-800/70">
                <tr *ngFor="let row of rows(); trackBy: trackByKey" [class.bg-rose-50]="row.is_critical" class="align-top">
                  <td class="py-3 pr-4">
                    <div class="font-semibold text-slate-900 dark:text-slate-50">
                      {{ row.product_name }}
                      <span *ngIf="row.variant_name" class="font-normal text-slate-600 dark:text-slate-300">— {{ row.variant_name }}</span>
                    </div>
                    <div class="text-xs text-slate-500 dark:text-slate-400">
                      <span class="font-mono">{{ row.sku }}</span>
                      <span class="px-2">·</span>
                      <span class="font-mono">{{ row.product_slug }}</span>
                      <span *ngIf="row.kind === 'variant'" class="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {{ row.kind }}
                      </span>
                    </div>
                  </td>
                  <td class="py-3 pr-4 text-right font-semibold text-slate-900 dark:text-slate-50">{{ row.stock_quantity }}</td>
                  <td class="py-3 pr-4 text-right text-slate-700 dark:text-slate-200">{{ row.reserved_in_carts }}</td>
                  <td class="py-3 pr-4 text-right text-slate-700 dark:text-slate-200">{{ row.reserved_in_orders }}</td>
                  <td
                    class="py-3 pr-4 text-right font-semibold"
                    [class.text-rose-700]="row.is_critical || row.available_quantity <= 0"
                    [class.text-slate-900]="!row.is_critical && row.available_quantity > 0"
                    [class.dark:text-rose-200]="row.is_critical || row.available_quantity <= 0"
                    [class.dark:text-slate-50]="!row.is_critical && row.available_quantity > 0"
                  >
                    {{ row.available_quantity }}
                  </td>
                  <td class="py-3 pr-4 text-right text-slate-700 dark:text-slate-200">{{ row.threshold }}</td>
                  <td class="py-3 pr-4">
                    <input
                      class="h-9 w-44 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="row.draftSupplier"
                      (ngModelChange)="row.isDirty = true"
                      placeholder="—"
                    />
                  </td>
                  <td class="py-3 pr-4 text-right">
                    <input
                      class="h-9 w-24 rounded-lg border border-slate-200 bg-white px-3 text-sm text-right text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="row.draftDesiredQuantity"
                      (ngModelChange)="row.isDirty = true"
                      inputmode="numeric"
                      placeholder="—"
                    />
                  </td>
                  <td class="py-3 pr-4">
                    <textarea
                      class="min-h-[2.25rem] w-80 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="row.draftNote"
                      (ngModelChange)="row.isDirty = true"
                      rows="2"
                      placeholder="—"
                    ></textarea>
                  </td>
                  <td class="py-3 pr-4 text-xs text-slate-500 dark:text-slate-400">
                    {{ row.note_updated_at ? (row.note_updated_at | date: 'short') : '—' }}
                  </td>
                  <td class="py-3 text-right">
                    <div class="flex flex-col items-end gap-2">
                      <app-button
                        size="sm"
                        variant="ghost"
                        [label]="'adminUi.actions.open' | translate"
                        (action)="openProduct(row)"
                      ></app-button>
                      <app-button
                        size="sm"
                        [label]="row.isSaving ? ('adminUi.inventory.actions.saving' | translate) : ('adminUi.actions.save' | translate)"
                        (action)="saveNote(row)"
                        [disabled]="row.isSaving || !row.isDirty"
                      ></app-button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div *ngIf="meta()" class="flex items-center justify-between gap-4 pt-3 text-sm">
            <div class="text-slate-600 dark:text-slate-300">
              {{ meta()!.page }} / {{ meta()!.total_pages }} · {{ meta()!.total_items }}
            </div>
            <div class="flex items-center gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.prev' | translate"
                (action)="goToPage(page - 1)"
                [disabled]="loading() || page <= 1"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.next' | translate"
                (action)="goToPage(page + 1)"
                [disabled]="loading() || page >= meta()!.total_pages"
              ></app-button>
            </div>
          </div>
        </ng-template>
      </section>
    </div>
  `
})
export class AdminInventoryComponent implements OnInit {
  readonly crumbs: Crumb[] = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin', url: '/admin/dashboard' },
    { label: 'adminUi.inventory.title' }
  ];

  loading = signal(true);
  error = signal<string | null>(null);
  rows = signal<RestockRow[]>([]);
  meta = signal<RestockListResponse['meta'] | null>(null);

  includeVariants = true;
  defaultThreshold = 5;
  page = 1;
  limit = 50;
  exporting = false;

  constructor(
    private admin: AdminService,
    private toast: ToastService,
    private translate: TranslateService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.load();
  }

  trackByKey = (_: number, row: RestockRow) => `${row.kind}:${row.variant_id || row.product_id}`;

  applyFilters(): void {
    this.page = 1;
    this.load();
  }

  goToPage(page: number): void {
    this.page = Math.max(1, page);
    this.load();
  }

  openProduct(row: RestockRow): void {
    void this.router.navigate(['/admin/products'], { state: { editProductSlug: row.product_slug } });
  }

  exportCsv(): void {
    if (this.exporting) return;
    this.exporting = true;
    this.admin
      .exportRestockListCsv({
        include_variants: this.includeVariants,
        default_threshold: this.defaultThreshold
      })
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'restock-list.csv';
          a.click();
          URL.revokeObjectURL(url);
          this.toast.success(this.translate.instant('adminUi.inventory.exportReady'));
          this.exporting = false;
        },
        error: () => {
          this.toast.error(this.translate.instant('adminUi.inventory.errors.export'));
          this.exporting = false;
        }
      });
  }

  saveNote(row: RestockRow): void {
    if (row.isSaving || !row.isDirty) return;
    row.isSaving = true;

    const supplier = row.draftSupplier.trim();
    const note = row.draftNote.trim();
    const desiredQty = row.draftDesiredQuantity.trim();
    const desiredQuantity = desiredQty ? Number.parseInt(desiredQty, 10) : NaN;

    const payload: RestockNoteUpsert = {
      product_id: row.product_id,
      variant_id: row.variant_id || null,
      supplier: supplier ? supplier : null,
      desired_quantity: Number.isFinite(desiredQuantity) ? Math.max(0, desiredQuantity) : null,
      note: note ? note : null
    };

    this.admin.upsertRestockNote(payload).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.inventory.success.noteSaved'));
        row.isSaving = false;
        row.isDirty = false;
        this.load();
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.inventory.errors.noteSave'));
        row.isSaving = false;
      }
    });
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.admin
      .restockList({
        page: this.page,
        limit: this.limit,
        include_variants: this.includeVariants,
        default_threshold: this.defaultThreshold
      })
      .subscribe({
        next: (resp) => {
          const mapped = (resp.items || []).map((item) => ({
            ...item,
            draftSupplier: item.supplier || '',
            draftDesiredQuantity: item.desired_quantity !== null && item.desired_quantity !== undefined ? String(item.desired_quantity) : '',
            draftNote: item.note || '',
            isDirty: false,
            isSaving: false
          }));
          this.rows.set(mapped);
          this.meta.set(resp.meta || null);
          this.page = resp.meta?.page ?? this.page;
          this.loading.set(false);
        },
        error: () => {
          this.error.set(this.translate.instant('adminUi.errors.generic'));
          this.rows.set([]);
          this.meta.set(null);
          this.loading.set(false);
        }
      });
  }
}

