import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AdminService, ContentImageAssetRead } from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';

@Component({
  selector: 'app-asset-library',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  template: `
    <div class="grid gap-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="grid gap-1">
          <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ titleKey | translate }}</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ 'adminUi.site.assets.library.hint' | translate }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            (click)="reload()"
          >
            {{ 'adminUi.actions.refresh' | translate }}
          </button>
        </div>
      </div>

      <div class="grid gap-2 md:grid-cols-3">
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
          {{ 'adminUi.site.assets.library.search' | translate }}
          <input
            class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            [(ngModel)]="q"
            [placeholder]="'adminUi.site.assets.library.searchPlaceholder' | translate"
            (keyup.enter)="reload()"
          />
        </label>
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'adminUi.site.assets.library.scope' | translate }}
          <select
            class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            [(ngModel)]="key"
            (ngModelChange)="reload()"
          >
            <option [ngValue]="''">{{ 'adminUi.site.assets.library.scopeAll' | translate }}</option>
            <option *ngFor="let opt of scopedKeys" [ngValue]="opt">{{ opt }}</option>
          </select>
        </label>
      </div>

      <div *ngIf="allowUpload" class="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
        <div class="flex items-center justify-between gap-3">
          <p class="font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.site.assets.library.upload' | translate }}</p>
          <input type="file" accept="image/*" (change)="upload($event)" />
        </div>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ 'adminUi.site.assets.library.uploadHint' | translate: { key: uploadKey } }}
        </p>
      </div>

      <div *ngIf="error()" class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
        {{ error() }}
      </div>

      <div *ngIf="loading()" class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.site.assets.library.loading' | translate }}</div>

      <div *ngIf="!loading() && !error() && images().length === 0" class="text-sm text-slate-500 dark:text-slate-400">
        {{ 'adminUi.site.assets.library.empty' | translate }}
      </div>

      <div *ngIf="!loading() && images().length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div *ngFor="let img of images()" class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between gap-3">
            <img
              [src]="img.url"
              [alt]="img.alt_text || 'asset'"
              class="h-16 w-16 rounded-lg border border-slate-200 object-cover dark:border-slate-800"
              loading="lazy"
            />
            <div class="flex items-center gap-2">
              <button type="button" class="text-xs text-indigo-600 hover:underline dark:text-indigo-300" (click)="copy(img.url)">
                {{ 'adminUi.actions.copy' | translate }}
              </button>
              <button
                *ngIf="allowSelect"
                type="button"
                class="text-xs text-emerald-700 hover:underline dark:text-emerald-300"
                (click)="select.emit(img.url)"
              >
                {{ 'adminUi.actions.use' | translate }}
              </button>
            </div>
          </div>
          <p class="mt-2 text-xs text-slate-600 dark:text-slate-300 truncate">{{ img.url }}</p>
          <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {{ img.content_key }} · {{ img.created_at | date: 'short' }}
          </p>
        </div>
      </div>

      <div *ngIf="metaTotalPages() > 1" class="flex items-center justify-between gap-2 text-sm">
        <button
          type="button"
          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          [disabled]="page <= 1"
          (click)="prev()"
        >
          {{ 'adminUi.actions.prev' | translate }}
        </button>
        <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.site.assets.library.pagination' | translate: { page: page, total: metaTotalPages() } }}</span>
        <button
          type="button"
          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          [disabled]="page >= metaTotalPages()"
          (click)="next()"
        >
          {{ 'adminUi.actions.next' | translate }}
        </button>
      </div>
    </div>
  `
})
export class AssetLibraryComponent implements OnInit, OnChanges {
  @Input() titleKey = 'adminUi.site.assets.library.title';
  @Input() allowUpload = true;
  @Input() allowSelect = false;
  @Input() uploadKey = 'site.assets';
  @Input() scopedKeys: string[] = ['site.assets', 'home.hero', 'home.story', 'page.about', 'page.contact'];
  @Input() initialKey = '';

  @Output() select = new EventEmitter<string>();

  q = '';
  key = '';
  page = 1;
  limit = 24;

  loading = signal(false);
  error = signal<string | null>(null);
  images = signal<ContentImageAssetRead[]>([]);
  private totalPages = signal(1);

  constructor(
    private admin: AdminService,
    private toast: ToastService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.key = (this.initialKey || '').trim();
    this.reload();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialKey']) {
      this.key = (this.initialKey || '').trim();
      this.page = 1;
      this.reload();
    }
  }

  metaTotalPages(): number {
    return this.totalPages();
  }

  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.admin.listContentImages({ q: this.q || undefined, key: this.key || undefined, page: this.page, limit: this.limit }).subscribe({
      next: (resp) => {
        this.images.set(resp.items || []);
        this.totalPages.set(resp.meta?.total_pages || 1);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.t('adminUi.site.assets.library.errors.load'));
        this.loading.set(false);
      }
    });
  }

  prev(): void {
    if (this.page <= 1) return;
    this.page -= 1;
    this.reload();
  }

  next(): void {
    const total = this.totalPages();
    if (this.page >= total) return;
    this.page += 1;
    this.reload();
  }

  upload(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;
    this.admin.uploadContentImage(this.uploadKey, file).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.site.assets.library.success.uploaded'));
        this.page = 1;
        this.reload();
      },
      error: () => this.toast.error(this.t('adminUi.site.assets.library.errors.upload'))
    });
    if (input) input.value = '';
  }

  copy(url: string): void {
    const value = (url || '').trim();
    if (!value) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      this.toast.error(this.t('adminUi.site.assets.library.errors.copy'));
      return;
    }
    navigator.clipboard
      .writeText(value)
      .then(() => this.toast.success(this.t('adminUi.site.assets.library.success.copied')))
      .catch(() => this.toast.error(this.t('adminUi.site.assets.library.errors.copy')));
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }
}
