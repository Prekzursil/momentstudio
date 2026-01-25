import { CommonModule, DatePipe } from '@angular/common';
import { Component, Input, OnChanges, OnDestroy, SimpleChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { AdminService, ContentBlockVersionListItem, ContentBlockVersionRead } from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';
import { diffLines, Change } from 'diff';

@Component({
  selector: 'app-content-revisions',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, DatePipe],
  template: `
    <div class="grid gap-3">
      <div class="flex items-center justify-between gap-3">
        <div class="grid gap-0.5">
          <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
            {{ titleKey ? (titleKey | translate) : ('adminUi.content.revisions.title' | translate) }}
          </p>
          <p class="text-xs text-slate-500 dark:text-slate-400">{{ contentKey }}</p>
        </div>
        <button
          type="button"
          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          (click)="reload()"
        >
          {{ 'adminUi.actions.refresh' | translate }}
        </button>
      </div>

      <div *ngIf="error()" class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
        {{ error() }}
      </div>

      <div *ngIf="loading()" class="text-sm text-slate-600 dark:text-slate-300">
        {{ 'adminUi.content.revisions.loading' | translate }}
      </div>

      <div *ngIf="!loading() && !error() && versions().length === 0" class="text-sm text-slate-500 dark:text-slate-400">
        {{ 'adminUi.content.revisions.empty' | translate }}
      </div>

      <div *ngIf="!loading() && versions().length" class="grid gap-3">
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'adminUi.content.revisions.select' | translate }}
          <select
            class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            [(ngModel)]="selectedVersion"
            (ngModelChange)="loadSelectedVersion()"
          >
            <option *ngFor="let v of versions()" [ngValue]="v.version">
              v{{ v.version }} · {{ v.created_at | date: 'short' }} · {{ v.status }}
            </option>
          </select>
        </label>

        <div *ngIf="selectedRead() && currentRead()" class="grid gap-2">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              {{ 'adminUi.content.revisions.diffVsCurrent' | translate: { from: selectedRead()!.version, to: currentRead()!.version } }}
            </p>
            <button
              type="button"
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              (click)="rollbackSelected()"
            >
              {{ 'adminUi.content.revisions.rollback' | translate }} v{{ selectedRead()!.version }}
            </button>
          </div>

          <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs whitespace-pre-wrap text-slate-900 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-100">
            <ng-container *ngFor="let part of diffParts">
              <span
                [ngClass]="part.added ? 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100' : part.removed ? 'bg-rose-200 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100' : ''"
                >{{ part.value }}</span
              >
            </ng-container>
          </div>
        </div>
      </div>
    </div>
  `
})
export class ContentRevisionsComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) contentKey!: string;
  @Input() titleKey?: string;

  loading = signal(false);
  error = signal<string | null>(null);
  versions = signal<ContentBlockVersionListItem[]>([]);
  selectedRead = signal<ContentBlockVersionRead | null>(null);
  currentRead = signal<ContentBlockVersionRead | null>(null);

  selectedVersion: number | null = null;
  diffParts: Change[] = [];

  private readonly subs = new Subscription();
  private lastLoadedKey: string | null = null;

  constructor(
    private admin: AdminService,
    private toast: ToastService,
    private translate: TranslateService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['contentKey']) {
      const nextKey = (this.contentKey || '').trim();
      if (!nextKey) return;
      if (nextKey !== this.lastLoadedKey) {
        this.lastLoadedKey = nextKey;
        this.reload();
      }
    }
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  reload(): void {
    const key = (this.contentKey || '').trim();
    if (!key) return;
    this.loading.set(true);
    this.error.set(null);
    this.versions.set([]);
    this.selectedRead.set(null);
    this.currentRead.set(null);
    this.diffParts = [];
    this.selectedVersion = null;

    let pendingVersions = true;
    let pendingCurrent = true;
    const finish = (): void => {
      if (!pendingVersions && !pendingCurrent) {
        this.loading.set(false);
      }
    };

    const maybeInitSelection = (): void => {
      if (pendingCurrent) return;
      if (this.selectedVersion) return;
      const items = this.versions();
      if (!items?.length) return;
      const current = this.currentRead();
      const latest = items[0]?.version;
      if (!latest) return;
      let nextVersion = latest;
      if (current?.status === 'draft') {
        const published = items.find((v) => v.status === 'published');
        if (published?.version) nextVersion = published.version;
      }
      this.selectedVersion = nextVersion;
      this.loadSelectedVersion();
    };

    this.subs.add(
      this.admin.listContentVersions(key).subscribe({
        next: (items) => {
          this.versions.set(items || []);
          maybeInitSelection();
          pendingVersions = false;
          finish();
        },
        error: (err: any) => {
          if (err?.status === 404) {
            this.versions.set([]);
          } else {
            this.error.set(this.t('adminUi.content.revisions.errors.load'));
          }
          pendingVersions = false;
          finish();
        }
      })
    );

    this.subs.add(
        this.admin.getContent(key).subscribe({
          next: (block) => {
            const version = block?.version;
            if (!version) {
              pendingCurrent = false;
              maybeInitSelection();
              finish();
              return;
            }
            this.subs.add(
              this.admin.getContentVersion(key, version).subscribe({
                next: (read) => {
                  this.currentRead.set(read);
                  this.recomputeDiff();
                  pendingCurrent = false;
                  maybeInitSelection();
                  finish();
                },
                error: () => {
                  this.error.set(this.t('adminUi.content.revisions.errors.loadVersion'));
                  pendingCurrent = false;
                  maybeInitSelection();
                  finish();
                }
              })
            );
          },
          error: () => {
            // Missing content blocks simply have no history yet.
            this.currentRead.set(null);
            pendingCurrent = false;
            maybeInitSelection();
            finish();
          }
        })
      );
  }

  loadSelectedVersion(): void {
    const key = (this.contentKey || '').trim();
    const v = this.selectedVersion;
    if (!key || !v) return;
    this.subs.add(
      this.admin.getContentVersion(key, v).subscribe({
        next: (read) => {
          this.selectedRead.set(read);
          this.recomputeDiff();
        },
        error: () => {
          this.toast.error(this.t('adminUi.content.revisions.errors.loadVersion'));
        }
      })
    );
  }

  rollbackSelected(): void {
    const key = (this.contentKey || '').trim();
    const selected = this.selectedRead();
    if (!key || !selected) return;
    const ok = confirm(this.t('adminUi.content.revisions.confirms.rollback', { version: selected.version }));
    if (!ok) return;
    this.subs.add(
      this.admin.rollbackContentVersion(key, selected.version).subscribe({
        next: () => {
          this.toast.success(this.t('adminUi.content.revisions.success.rolledBack'));
          this.reload();
        },
        error: () => this.toast.error(this.t('adminUi.content.revisions.errors.rollback'))
      })
    );
  }

  private recomputeDiff(): void {
    const current = this.currentRead();
    const selected = this.selectedRead();
    if (!current || !selected) {
      this.diffParts = [];
      return;
    }
    const from = this.snapshotText(selected);
    const to = this.snapshotText(current);
    this.diffParts = diffLines(from, to);
  }

  private snapshotText(read: ContentBlockVersionRead): string {
    const meta = read.meta ? JSON.stringify(read.meta, null, 2) : 'null';
    const translations = (read.translations || []).map((t) => {
      const title = (t.title || '').trim();
      const body = t.body_markdown || '';
      return `- ${t.lang}\n  title: ${title}\n  body_markdown:\n${body}`.trimEnd();
    });

    return [
      `title: ${(read.title || '').trim()}`,
      `status: ${read.status}`,
      `lang: ${read.lang ?? 'null'}`,
      `published_at: ${read.published_at ?? 'null'}`,
      `published_until: ${read.published_until ?? 'null'}`,
      `meta:\n${meta}`,
      `body_markdown:\n${read.body_markdown || ''}`,
      `translations:\n${translations.length ? translations.join('\n\n') : '[]'}`
    ].join('\n\n');
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }
}
