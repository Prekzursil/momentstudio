import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, Signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';
import type { AdminDeletedProductImage, AdminProductImageOptimizationStats } from '../../../core/admin.service';

type ImageMetaByLang = Record<'en' | 'ro', { alt_text: string; caption: string }>;

@Component({
  selector: 'app-admin-products-image-manager',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, ButtonComponent, InputComponent],
  template: `
    <div id="product-wizard-images" data-ignore-dirty class="grid gap-3">
      <div class="flex items-center justify-between">
        <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          {{ 'adminUi.products.form.images' | translate }}
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <app-button
            size="sm"
            variant="ghost"
            [label]="
              deletedImagesOpen()
                ? ('adminUi.products.form.hideDeletedImages' | translate)
                : ('adminUi.products.form.showDeletedImages' | translate)
            "
            (action)="toggleDeletedImagesRequested.emit()"
            [disabled]="deletedImagesBusy() || !hasEditingSlug"
          ></app-button>
          <label class="text-sm text-slate-700 dark:text-slate-200">
            {{ 'adminUi.products.form.upload' | translate }}
            <input type="file" accept="image/*" class="block mt-1" (change)="uploadRequested.emit($event)" />
          </label>
        </div>
      </div>

      <div *ngIf="images().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
        {{ 'adminUi.products.form.noImages' | translate }}
      </div>

      <div *ngIf="images().length > 0" class="grid gap-2">
        <div *ngFor="let img of images(); let idx = index" class="rounded-lg border border-slate-200 dark:border-slate-700">
          <div class="flex items-center gap-3 p-2">
            <img [src]="img.url" [alt]="img.alt_text || 'image'" class="h-12 w-12 rounded object-cover" />
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <p class="font-semibold text-slate-900 dark:text-slate-50 truncate">
                  {{ img.alt_text || ('adminUi.products.form.image' | translate) }}
                </p>
                <span
                  *ngIf="idx === 0"
                  class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
                >
                  {{ 'adminUi.storefront.products.images.primaryBadge' | translate }}
                </span>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ img.url }}</p>
            </div>
            <div class="flex items-center gap-1">
              <app-button
                *ngIf="idx > 0"
                size="sm"
                variant="ghost"
                [label]="'adminUi.storefront.products.images.makePrimary' | translate"
                [disabled]="imageOrderBusy() || imageMetaBusy() || deleteImageConfirmBusy()"
                (action)="makePrimaryRequested.emit(img.id)"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.edit' | translate"
                (action)="toggleMetaRequested.emit(img.id)"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.delete' | translate"
                (action)="deleteRequested.emit(img.id)"
              ></app-button>
            </div>
          </div>

          <div *ngIf="editingImageId() === img.id" class="grid gap-4 border-t border-slate-200 p-3 dark:border-slate-700">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                {{ 'adminUi.products.form.imageMeta' | translate }}
              </p>
              <div class="flex flex-wrap items-center gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.products.form.imageReprocess' | translate"
                  (action)="reprocessRequested.emit()"
                  [disabled]="imageMetaBusy()"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.actions.save' | translate"
                  (action)="saveMetaRequested.emit()"
                  [disabled]="imageMetaBusy()"
                ></app-button>
              </div>

              <p *ngIf="imageOrderError()" class="text-sm text-rose-700 dark:text-rose-300">{{ imageOrderError() }}</p>
            </div>

            <p *ngIf="imageMetaError()" class="text-sm text-rose-700 dark:text-rose-300">{{ imageMetaError() }}</p>

            <div *ngIf="imageStats" class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
              <p>
                {{ 'adminUi.products.form.imageSize' | translate }}:
                <span class="font-semibold">{{ formatBytes(imageStats.original_bytes) }}</span>
                <span *ngIf="imageStats.width && imageStats.height" class="text-slate-500 dark:text-slate-400">
                  · {{ imageStats.width }}×{{ imageStats.height }}
                </span>
              </p>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                {{ 'adminUi.products.form.imageThumbs' | translate }}: sm {{ formatBytes(imageStats.thumb_sm_bytes) }}, md
                {{ formatBytes(imageStats.thumb_md_bytes) }}, lg {{ formatBytes(imageStats.thumb_lg_bytes) }}
              </p>
            </div>

            <div class="grid gap-3 lg:grid-cols-2">
              <div class="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">RO</p>
                <app-input [label]="'adminUi.products.form.imageAltText' | translate" [(value)]="imageMeta.ro.alt_text"></app-input>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.products.form.imageCaption' | translate }}
                  <textarea
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    rows="2"
                    [(ngModel)]="imageMeta.ro.caption"
                  ></textarea>
                </label>
              </div>

              <div class="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">EN</p>
                <app-input [label]="'adminUi.products.form.imageAltText' | translate" [(value)]="imageMeta.en.alt_text"></app-input>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.products.form.imageCaption' | translate }}
                  <textarea
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    rows="2"
                    [(ngModel)]="imageMeta.en.caption"
                  ></textarea>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        *ngIf="deletedImagesOpen()"
        class="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/20"
      >
        <div class="flex items-center justify-between gap-3">
          <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            {{ 'adminUi.products.form.deletedImages' | translate }}
          </p>
          <span class="text-xs text-slate-500 dark:text-slate-400">
            {{ deletedImages().length }}
          </span>
        </div>

        <div *ngIf="deletedImagesBusy()" class="text-sm text-slate-600 dark:text-slate-300">
          {{ 'adminUi.actions.loading' | translate }}
        </div>

        <div
          *ngIf="deletedImagesError()"
          class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
        >
          {{ deletedImagesError() }}
        </div>

        <div *ngIf="!deletedImagesBusy() && deletedImages().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
          {{ 'adminUi.products.form.noDeletedImages' | translate }}
        </div>

        <div *ngIf="!deletedImagesBusy() && deletedImages().length" class="grid gap-2">
          <div
            *ngFor="let img of deletedImages()"
            class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
          >
            <div class="min-w-0">
              <p class="font-semibold text-slate-900 dark:text-slate-50 truncate">{{ img.alt_text || ('adminUi.products.form.image' | translate) }}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ img.url }}</p>
              <p *ngIf="img.deleted_at" class="text-xs text-slate-500 dark:text-slate-400">
                {{ 'adminUi.products.form.deletedAt' | translate }}: {{ img.deleted_at | date: 'short' }}
              </p>
            </div>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'adminUi.actions.restore' | translate"
              (action)="restoreRequested.emit(img.id)"
              [disabled]="restoringDeletedImage() === img.id"
            ></app-button>
          </div>
        </div>
      </div>
    </div>
  `
})
export class AdminProductsImageManagerComponent {
  @Input({ required: true }) hasEditingSlug = false;

  @Input({ required: true }) images!: Signal<Array<{ id: string; url: string; alt_text?: string | null }>>;
  @Input({ required: true }) editingImageId!: Signal<string | null>;
  @Input({ required: true }) imageOrderBusy!: Signal<boolean>;
  @Input({ required: true }) imageOrderError!: Signal<string | null>;
  @Input({ required: true }) imageMetaBusy!: Signal<boolean>;
  @Input({ required: true }) imageMetaError!: Signal<string | null>;
  @Input({ required: true }) deleteImageConfirmBusy!: Signal<boolean>;

  @Input({ required: true }) deletedImagesOpen!: Signal<boolean>;
  @Input({ required: true }) deletedImagesBusy!: Signal<boolean>;
  @Input({ required: true }) deletedImagesError!: Signal<string | null>;
  @Input({ required: true }) deletedImages!: Signal<AdminDeletedProductImage[]>;
  @Input({ required: true }) restoringDeletedImage!: Signal<string | null>;

  @Input({ required: true }) imageMeta!: ImageMetaByLang;
  @Input() imageStats: AdminProductImageOptimizationStats | null = null;

  @Output() toggleDeletedImagesRequested = new EventEmitter<void>();
  @Output() uploadRequested = new EventEmitter<Event>();
  @Output() makePrimaryRequested = new EventEmitter<string>();
  @Output() toggleMetaRequested = new EventEmitter<string>();
  @Output() deleteRequested = new EventEmitter<string>();
  @Output() reprocessRequested = new EventEmitter<void>();
  @Output() saveMetaRequested = new EventEmitter<void>();
  @Output() restoreRequested = new EventEmitter<string>();

  formatBytes(value?: number | null): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = value;
    let idx = 0;
    while (size >= 1024 && idx < units.length - 1) {
      size /= 1024;
      idx += 1;
    }
    const rounded = idx === 0 ? Math.round(size) : Math.round(size * 10) / 10;
    return `${rounded} ${units[idx]}`;
  }
}
