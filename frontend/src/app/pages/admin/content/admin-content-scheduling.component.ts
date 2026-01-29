import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AdminContent, AdminService } from '../../../core/admin.service';
import { ButtonComponent } from '../../../shared/button.component';
import { isCmsGlobalSectionKey } from '../../../shared/cms-global-sections';

type SchedulingKind = 'page' | 'blog' | 'global';

type ScheduleRow = {
  key: string;
  title: string;
  kind: SchedulingKind;
  publishAt: Date | null;
  unpublishAt: Date | null;
  leftPct: number;
  widthPct: number;
  publishPct: number | null;
  unpublishPct: number | null;
  editorLink: { path: string; queryParams: Record<string, string> };
};

const DAY_MS = 86_400_000;

@Component({
  selector: 'app-admin-content-scheduling',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslateModule, ButtonComponent],
  template: `
    <section class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div class="grid gap-1">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
            {{ 'adminUi.content.scheduling.title' | translate }}
          </h2>
          <p class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'adminUi.content.scheduling.hint' | translate }}
          </p>
        </div>

        <div class="flex flex-wrap items-end gap-2">
          <label class="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
            {{ 'adminUi.content.scheduling.window' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [ngModel]="windowDays()"
              (ngModelChange)="setWindowDays($event)"
            >
              <option [ngValue]="30">{{ 'adminUi.content.scheduling.window30' | translate }}</option>
              <option [ngValue]="90">{{ 'adminUi.content.scheduling.window90' | translate }}</option>
              <option [ngValue]="180">{{ 'adminUi.content.scheduling.window180' | translate }}</option>
            </select>
          </label>
          <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="load()"></app-button>
        </div>
      </div>

      <div class="text-xs text-slate-500 dark:text-slate-400">
        <span class="font-semibold">{{ calendarStartDate() | date: 'yyyy-MM-dd' }}</span>
        <span class="px-1">→</span>
        <span class="font-semibold">{{ calendarEndDate() | date: 'yyyy-MM-dd' }}</span>
      </div>

      <div *ngIf="loading()" class="text-sm text-slate-600 dark:text-slate-300">
        {{ 'notifications.loading' | translate }}
      </div>

      <div
        *ngIf="error()"
        class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
      >
        {{ error() }}
      </div>

      <div *ngIf="!loading() && !error() && scheduleRows().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
        {{ 'adminUi.content.scheduling.empty' | translate }}
      </div>

      <div *ngIf="!loading() && !error() && scheduleRows().length" class="grid gap-3">
        <div *ngFor="let row of scheduleRows(); trackBy: trackRow" class="grid gap-2 lg:grid-cols-[360px_1fr] items-center">
          <a
            class="rounded-lg px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/60"
            [routerLink]="row.editorLink.path"
            [queryParams]="row.editorLink.queryParams"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold text-slate-900 dark:text-slate-50 truncate">{{ row.title }}</span>
              <span
                class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                [ngClass]="kindBadgeClass(row.kind)"
              >
                {{ ('adminUi.content.scheduling.kind.' + row.kind) | translate }}
              </span>
            </div>
            <div class="text-xs text-slate-500 dark:text-slate-400 truncate">
              {{ row.key }}
              <span *ngIf="row.publishAt" class="px-1">·</span>
              <span *ngIf="row.publishAt">
                {{ 'adminUi.content.scheduling.publish' | translate }}: {{ row.publishAt | date: 'yyyy-MM-dd HH:mm' }}
              </span>
              <span *ngIf="row.unpublishAt" class="px-1">·</span>
              <span *ngIf="row.unpublishAt">
                {{ 'adminUi.content.scheduling.unpublish' | translate }}: {{ row.unpublishAt | date: 'yyyy-MM-dd HH:mm' }}
              </span>
            </div>
          </a>

          <div class="relative h-10 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div class="absolute inset-y-2 left-0 right-0 border border-dashed border-slate-200 dark:border-slate-700 rounded-md"></div>
            <div
              *ngIf="row.widthPct > 0"
              class="absolute inset-y-2 rounded-md bg-indigo-600"
              [style.left.%]="row.leftPct"
              [style.width.%]="row.widthPct"
            ></div>
            <div
              *ngIf="row.publishPct !== null"
              class="absolute inset-y-1 w-px bg-emerald-600"
              [style.left.%]="row.publishPct"
              [title]="'adminUi.content.scheduling.publish' | translate"
            ></div>
            <div
              *ngIf="row.unpublishPct !== null"
              class="absolute inset-y-1 w-px bg-rose-600"
              [style.left.%]="row.unpublishPct"
              [title]="'adminUi.content.scheduling.unpublish' | translate"
            ></div>
          </div>
        </div>
      </div>
    </section>
  `
})
export class AdminContentSchedulingComponent implements OnInit {
  loading = signal<boolean>(false);
  error = signal<string | null>(null);
  blocks = signal<AdminContent[]>([]);
  windowDays = signal<number>(90);

  constructor(
    private admin: AdminService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  private t(key: string): string {
    return this.translate.instant(key);
  }

  setWindowDays(days: number): void {
    const next = typeof days === 'number' ? days : Number(days);
    this.windowDays.set(next === 30 || next === 90 || next === 180 ? next : 90);
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.admin.content().subscribe({
      next: (blocks) => this.blocks.set(blocks || []),
      error: () => {
        this.error.set(this.t('adminUi.content.scheduling.errors.load'));
        this.loading.set(false);
      },
      complete: () => this.loading.set(false),
    });
  }

  calendarStartDate(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  calendarEndDate(): Date {
    const start = this.calendarStartDate();
    return new Date(start.getTime() + this.windowDays() * DAY_MS);
  }

  scheduleRows(): ScheduleRow[] {
    const blocks = this.blocks();
    if (!blocks.length) return [];

    const startDate = this.calendarStartDate();
    const windowStart = startDate.getTime();
    const windowEnd = windowStart + this.windowDays() * DAY_MS;
    const duration = windowEnd - windowStart || 1;
    const nowMs = Date.now();

    const parseTs = (value: string | null | undefined): number | null => {
      if (!value) return null;
      const ms = Date.parse(value);
      return Number.isNaN(ms) ? null : ms;
    };

    const isRelevantKey = (key: string): boolean => {
      const value = (key || '').trim();
      return value.startsWith('page.') || value.startsWith('blog.') || isCmsGlobalSectionKey(value);
    };

    const kindForKey = (key: string): SchedulingKind => {
      const value = (key || '').trim();
      if (value.startsWith('blog.')) return 'blog';
      if (isCmsGlobalSectionKey(value)) return 'global';
      return 'page';
    };

    const editorLinkForKey = (key: string): { path: string; queryParams: Record<string, string> } => {
      const value = (key || '').trim();
      if (value.startsWith('blog.')) {
        const slug = value.split('.', 2)[1] || value.slice('blog.'.length);
        return { path: '/admin/content/blog', queryParams: { edit: slug } };
      }
      return { path: '/admin/content/pages', queryParams: { edit: value } };
    };

    const out: ScheduleRow[] = [];

    for (const block of blocks) {
      const key = (block.key || '').trim();
      if (!isRelevantKey(key)) continue;
      if ((block.status || '').trim() !== 'published') continue;

      const publishMs = parseTs(block.published_at ?? null);
      const unpublishMs = parseTs(block.published_until ?? null);

      const publishUpcoming = publishMs !== null && publishMs >= nowMs && publishMs < windowEnd;
      const unpublishUpcoming = unpublishMs !== null && unpublishMs >= nowMs && unpublishMs < windowEnd;
      if (!publishUpcoming && !unpublishUpcoming) continue;

      const barStartMs = Math.max(publishMs ?? windowStart, windowStart);
      const barEndMs = Math.min(unpublishMs ?? windowEnd, windowEnd);
      const leftPct = ((barStartMs - windowStart) / duration) * 100;
      const widthPct = Math.max(0, ((barEndMs - barStartMs) / duration) * 100);

      const publishPct = publishUpcoming && publishMs !== null ? ((publishMs - windowStart) / duration) * 100 : null;
      const unpublishPct = unpublishUpcoming && unpublishMs !== null ? ((unpublishMs - windowStart) / duration) * 100 : null;

      out.push({
        key,
        title: (block.title || '').trim() || key,
        kind: kindForKey(key),
        publishAt: publishMs !== null ? new Date(publishMs) : null,
        unpublishAt: unpublishMs !== null ? new Date(unpublishMs) : null,
        leftPct: Math.max(0, Math.min(100, leftPct)),
        widthPct: Math.max(0, Math.min(100, widthPct)),
        publishPct: publishPct === null ? null : Math.max(0, Math.min(100, publishPct)),
        unpublishPct: unpublishPct === null ? null : Math.max(0, Math.min(100, unpublishPct)),
        editorLink: editorLinkForKey(key)
      });
    }

    const sortTs = (row: ScheduleRow): number => {
      const publishMs = row.publishAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const unpublishMs = row.unpublishAt?.getTime() ?? Number.POSITIVE_INFINITY;
      return Math.min(publishMs, unpublishMs);
    };

    return out.sort((a, b) => sortTs(a) - sortTs(b));
  }

  kindBadgeClass(kind: SchedulingKind): string {
    if (kind === 'blog') {
      return 'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100';
    }
    if (kind === 'global') {
      return 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100';
    }
    return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';
  }

  trackRow(_: number, row: ScheduleRow): string {
    return row.key;
  }
}
