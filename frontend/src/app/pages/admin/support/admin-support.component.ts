import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BreadcrumbComponent, Crumb } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { ToastService } from '../../../core/toast.service';
import {
  AdminContactSubmissionListItem,
  AdminContactSubmissionRead,
  AdminSupportService,
  SupportStatus,
  SupportTopic
} from '../../../core/admin-support.service';

@Component({
  selector: 'app-admin-support',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, BreadcrumbComponent, ButtonComponent, InputComponent, SkeletonComponent],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="grid gap-1">
          <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.support.title' | translate }}</h1>
          <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.support.subtitle' | translate }}</p>
        </div>
      </div>

      <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
        <div class="grid gap-3 md:grid-cols-[1fr_200px_220px_auto] items-end">
          <app-input
            [label]="'adminUi.support.filters.search' | translate"
            [(value)]="q"
            [placeholder]="'adminUi.support.filters.searchPlaceholder' | translate"
            [ariaLabel]="'adminUi.support.filters.search' | translate"
          ></app-input>

          <label class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'adminUi.support.filters.topic' | translate }}</span>
            <select
              class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
              [(ngModel)]="topic"
            >
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="">
                {{ 'adminUi.support.filters.topicAll' | translate }}
              </option>
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="contact">
                {{ 'adminUi.support.topics.contact' | translate }}
              </option>
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="support">
                {{ 'adminUi.support.topics.support' | translate }}
              </option>
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="refund">
                {{ 'adminUi.support.topics.refund' | translate }}
              </option>
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="dispute">
                {{ 'adminUi.support.topics.dispute' | translate }}
              </option>
            </select>
          </label>

          <label class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'adminUi.support.filters.status' | translate }}</span>
            <select
              class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
              [(ngModel)]="status"
            >
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="">
                {{ 'adminUi.support.filters.statusAll' | translate }}
              </option>
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="new">
                {{ 'adminUi.support.status.new' | translate }}
              </option>
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="triaged">
                {{ 'adminUi.support.status.triaged' | translate }}
              </option>
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="resolved">
                {{ 'adminUi.support.status.resolved' | translate }}
              </option>
            </select>
          </label>

          <app-button size="sm" [label]="'adminUi.support.filters.apply' | translate" (action)="applyFilters()"></app-button>
        </div>

        <div class="grid lg:grid-cols-[1fr_420px] gap-4 items-start">
          <div class="grid gap-3">
            <div *ngIf="loading()" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <app-skeleton [rows]="6"></app-skeleton>
            </div>

            <div *ngIf="!loading() && error()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
              {{ error() }}
            </div>

            <div *ngIf="!loading() && !items().length" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.support.empty' | translate }}
            </div>

            <div *ngIf="items().length" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table class="min-w-[680px] w-full text-sm">
                <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                  <tr>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.support.table.date' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.support.table.topic' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.support.table.status' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.support.table.from' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.support.table.order' | translate }}</th>
                  </tr>
	                </thead>
	                <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
	                  <tr
	                    *ngFor="let row of items()"
	                    class="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
	                    [ngClass]="row.id === selectedId() ? 'bg-slate-100 dark:bg-slate-800/70' : ''"
	                    (click)="select(row)"
	                  >
	                    <td class="px-3 py-2 whitespace-nowrap text-slate-700 dark:text-slate-200">
	                      {{ row.created_at | date: 'short' }}
	                    </td>
                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {{ ('adminUi.support.topics.' + row.topic) | translate }}
                    </td>
                    <td class="px-3 py-2">
                      <span class="inline-flex rounded-full px-2 py-0.5 text-xs border border-slate-200 dark:border-slate-700">
                        {{ ('adminUi.support.status.' + row.status) | translate }}
                      </span>
                    </td>
                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                      <div class="font-medium text-slate-900 dark:text-slate-50">{{ row.name }}</div>
                      <div class="text-xs text-slate-500 dark:text-slate-400">{{ row.email }}</div>
                    </td>
                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                      <span class="font-mono text-xs text-slate-600 dark:text-slate-400">{{ row.order_reference || '—' }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div *ngIf="items().length" class="flex items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
              <span>
                {{
                  'adminUi.support.pagination' | translate: { page: meta().page || 1, total: meta().total_pages || 1, count: meta().total_items || 0 }
                }}
              </span>
              <div class="flex items-center gap-2">
                <app-button size="sm" [disabled]="!hasPrev()" [label]="'adminUi.support.prev' | translate" (action)="prev()"></app-button>
                <app-button size="sm" [disabled]="!hasNext()" [label]="'adminUi.support.next' | translate" (action)="next()"></app-button>
              </div>
            </div>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-3 dark:border-slate-800 dark:bg-slate-900">
            <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.support.detail.title' | translate }}</div>

            <div *ngIf="detailLoading()" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <app-skeleton [rows]="5"></app-skeleton>
            </div>

            <div *ngIf="!detailLoading() && !selected()" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.support.detail.empty' | translate }}
            </div>

            <div *ngIf="selected()" class="grid gap-3 text-sm text-slate-700 dark:text-slate-200">
              <div class="grid gap-1">
                <div class="font-semibold text-slate-900 dark:text-slate-50">{{ selected()!.name }}</div>
                <a class="text-indigo-600 hover:underline dark:text-indigo-300" [href]="'mailto:' + selected()!.email">
                  {{ selected()!.email }}
                </a>
              </div>

              <div class="grid gap-1">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.support.detail.meta' | translate }}</div>
                <div class="flex flex-wrap gap-2">
                  <span class="inline-flex rounded-full px-2 py-0.5 text-xs border border-slate-200 dark:border-slate-700">
                    {{ ('adminUi.support.topics.' + selected()!.topic) | translate }}
                  </span>
                  <span class="inline-flex rounded-full px-2 py-0.5 text-xs border border-slate-200 dark:border-slate-700">
                    {{ ('adminUi.support.status.' + selected()!.status) | translate }}
                  </span>
                  <span class="text-xs text-slate-500 dark:text-slate-400">
                    {{ selected()!.created_at | date: 'medium' }}
                  </span>
                </div>
                <div *ngIf="selected()!.order_reference" class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.support.detail.order' | translate }}:
                  <span class="font-mono">{{ selected()!.order_reference }}</span>
                </div>
              </div>

              <div class="grid gap-1">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.support.detail.message' | translate }}</div>
                <div class="rounded-xl border border-slate-200 p-3 whitespace-pre-wrap leading-relaxed dark:border-slate-800">
                  {{ selected()!.message }}
                </div>
              </div>

              <div class="grid gap-2">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.support.detail.statusLabel' | translate }}
                  <select
                    class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
                    [(ngModel)]="editStatus"
                  >
                    <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="new">{{ 'adminUi.support.status.new' | translate }}</option>
                    <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="triaged">{{ 'adminUi.support.status.triaged' | translate }}</option>
                    <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="resolved">{{ 'adminUi.support.status.resolved' | translate }}</option>
                  </select>
                </label>

                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.support.detail.adminNote' | translate }}
                  <textarea
                    class="min-h-[120px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                    [(ngModel)]="editNote"
                    [placeholder]="'adminUi.support.detail.adminNotePlaceholder' | translate"
                  ></textarea>
                </label>

                <div class="flex justify-end">
                  <app-button size="sm" [disabled]="saving()" [label]="'adminUi.support.detail.save' | translate" (action)="save()"></app-button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `
})
export class AdminSupportComponent implements OnInit {
  readonly crumbs: Crumb[] = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin', url: '/admin' },
    { label: 'adminUi.nav.support' }
  ];

  q = '';
  topic: '' | SupportTopic = '';
  status: '' | SupportStatus = '';

  loading = signal<boolean>(true);
  detailLoading = signal<boolean>(false);
  saving = signal<boolean>(false);
  error = signal<string>('');

  items = signal<AdminContactSubmissionListItem[]>([]);
  meta = signal<{ page: number; total_pages: number; total_items: number; limit: number }>({
    page: 1,
    total_pages: 1,
    total_items: 0,
    limit: 25
  });

  selectedId = signal<string>('');
  selected = signal<AdminContactSubmissionRead | null>(null);

  editStatus: SupportStatus = 'new';
  editNote = '';

  constructor(private api: AdminSupportService, private toast: ToastService, private translate: TranslateService) {}

  ngOnInit(): void {
    this.load();
  }

  applyFilters(): void {
    this.meta.set({ ...this.meta(), page: 1 });
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.error.set('');
    const meta = this.meta();
    this.api
      .list({
        q: this.q.trim() || undefined,
        topic_filter: this.topic || undefined,
        status_filter: this.status || undefined,
        page: meta.page,
        limit: meta.limit
      })
      .subscribe({
        next: (resp) => {
          this.items.set(resp.items);
          this.meta.set(resp.meta);
        },
        error: () => {
          this.items.set([]);
          this.error.set(this.translate.instant('adminUi.support.errors.load'));
        },
        complete: () => this.loading.set(false)
      });
  }

  select(row: AdminContactSubmissionListItem): void {
    if (this.selectedId() === row.id) return;
    this.selectedId.set(row.id);
    this.selected.set(null);
    this.detailLoading.set(true);
    this.api.getOne(row.id).subscribe({
      next: (detail) => {
        this.selected.set(detail);
        this.editStatus = detail.status;
        this.editNote = detail.admin_note || '';
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.support.errors.loadDetail'));
        this.selectedId.set('');
        this.selected.set(null);
      },
      complete: () => this.detailLoading.set(false)
    });
  }

  save(): void {
    const selected = this.selected();
    if (!selected) return;
    if (this.saving()) return;
    this.saving.set(true);
    this.api
      .update(selected.id, { status: this.editStatus, admin_note: this.editNote.trim() || null })
      .subscribe({
        next: (updated) => {
          this.selected.set(updated);
          this.editStatus = updated.status;
          this.editNote = updated.admin_note || '';
          // Update row in list
          this.items.set(
            this.items().map((it) =>
              it.id === updated.id ? { ...it, status: updated.status, topic: updated.topic } : it
            )
          );
          this.toast.success(this.translate.instant('adminUi.support.success.saved'));
        },
        error: (err) => {
          const msg = err?.error?.detail || this.translate.instant('adminUi.support.errors.save');
          this.toast.error(msg);
        },
        complete: () => this.saving.set(false)
      });
  }

  hasPrev(): boolean {
    return this.meta().page > 1;
  }

  hasNext(): boolean {
    return this.meta().page < this.meta().total_pages;
  }

  prev(): void {
    if (!this.hasPrev()) return;
    this.meta.set({ ...this.meta(), page: this.meta().page - 1 });
    this.load();
  }

  next(): void {
    if (!this.hasNext()) return;
    this.meta.set({ ...this.meta(), page: this.meta().page + 1 });
    this.load();
  }
}
