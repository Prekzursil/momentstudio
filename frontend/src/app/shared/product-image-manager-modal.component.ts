import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import { AdminService } from '../core/admin.service';
import { ToastService } from '../core/toast.service';
import { ButtonComponent } from './button.component';
import { InputComponent } from './input.component';
import { ModalComponent } from './modal.component';

type StorefrontProductImage = {
  id?: string;
  url: string;
  alt_text?: string | null;
  caption?: string | null;
  sort_order?: number | null;
};

type ImageMetaByLang = {
  ro: { alt_text: string; caption: string };
  en: { alt_text: string; caption: string };
};

@Component({
  selector: 'app-product-image-manager-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, ModalComponent, ButtonComponent, InputComponent],
  template: `
    <app-modal
      [open]="open"
      [title]="'adminUi.storefront.products.images.manageTitle' | translate"
      [closeLabel]="'legal.modal.close' | translate"
      [showActions]="false"
      (closed)="handleClosed()"
    >
      <div class="grid gap-4">
        <p class="text-xs text-slate-600 dark:text-slate-300">
          {{ 'adminUi.storefront.products.images.reorderHint' | translate }}
        </p>

        <div *ngIf="draftImages.length === 0" class="text-sm text-slate-600 dark:text-slate-300">
          {{ 'adminUi.storefront.products.images.empty' | translate }}
        </div>

        <div *ngIf="draftImages.length" class="grid gap-2">
          <div
            *ngFor="let img of draftImages; let idx = index"
            class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
            [ngClass]="{
              'cursor-move': canReorder(),
              'ring-2 ring-indigo-400': dragOverImageId === (img.id || '')
            }"
            [attr.draggable]="canReorder() ? 'true' : null"
            (dragstart)="onDragStart($event, img.id)"
            (dragover)="onDragOver($event, img.id)"
            (drop)="onDrop($event, img.id)"
            (dragend)="onDragEnd()"
          >
            <div class="flex items-start gap-3">
              <img
                [src]="img.url"
                [alt]="img.alt_text || ('adminUi.products.form.image' | translate)"
                class="h-14 w-14 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
              />
              <div class="grid gap-1 flex-1 min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {{ 'adminUi.storefront.products.images.imageLabel' | translate : { index: idx + 1 } }}
                  </p>
                  <span
                    *ngIf="idx === 0"
                    class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
                  >
                    {{ 'adminUi.storefront.products.images.primaryBadge' | translate }}
                  </span>
                </div>
                <p class="text-xs text-slate-600 dark:text-slate-300 truncate">
                  {{ img.alt_text || productNameFallback }}
                </p>
              </div>
              <app-button
                *ngIf="canReorder() && idx > 0"
                size="sm"
                variant="ghost"
                [label]="'adminUi.storefront.products.images.makePrimary' | translate"
                [disabled]="metaBusy || orderSaving"
                (action)="makePrimary(img.id)"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="editingImageId === img.id ? ('adminUi.common.cancel' | translate) : ('adminUi.common.edit' | translate)"
                [disabled]="metaBusy || orderSaving"
                (action)="toggleMeta(img.id)"
              ></app-button>
            </div>

            <div
              *ngIf="editingImageId === img.id"
              class="mt-3 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/40"
            >
              <div *ngIf="metaBusy" class="text-xs text-slate-600 dark:text-slate-300">
                {{ 'adminUi.common.loading' | translate }}
              </div>

              <div *ngIf="!metaBusy" class="grid gap-3">
                <p *ngIf="metaError" class="text-xs text-rose-700 dark:text-rose-300">{{ metaError }}</p>
                <div class="grid gap-4 sm:grid-cols-2">
                  <div class="grid gap-2">
                    <p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">RO</p>
                    <app-input
                      [label]="'adminUi.products.form.imageAltText' | translate"
                      [value]="imageMeta.ro.alt_text"
                      [disabled]="metaSaving"
                      (valueChange)="imageMeta.ro.alt_text = String($event ?? '')"
                    ></app-input>
                    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                      <span>{{ 'adminUi.products.form.imageCaption' | translate }}</span>
                      <textarea
                        class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        rows="3"
                        [(ngModel)]="imageMeta.ro.caption"
                        [disabled]="metaSaving"
                      ></textarea>
                    </label>
                  </div>

                  <div class="grid gap-2">
                    <p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">EN</p>
                    <app-input
                      [label]="'adminUi.products.form.imageAltText' | translate"
                      [value]="imageMeta.en.alt_text"
                      [disabled]="metaSaving"
                      (valueChange)="imageMeta.en.alt_text = String($event ?? '')"
                    ></app-input>
                    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                      <span>{{ 'adminUi.products.form.imageCaption' | translate }}</span>
                      <textarea
                        class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        rows="3"
                        [(ngModel)]="imageMeta.en.caption"
                        [disabled]="metaSaving"
                      ></textarea>
                    </label>
                  </div>
                </div>

                <div class="flex items-center justify-between gap-3">
                  <span class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.storefront.products.images.metaHint' | translate }}
                  </span>
                  <app-button
                    size="sm"
                    [label]="metaSaving ? ('adminUi.common.saving' | translate) : ('adminUi.common.save' | translate)"
                    [disabled]="metaSaving"
                    (action)="saveMeta()"
                  ></app-button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p *ngIf="orderError" class="text-xs text-rose-700 dark:text-rose-300">{{ orderError }}</p>
      </div>
    </app-modal>
  `
})
export class ProductImageManagerModalComponent implements OnChanges {
  @Input() open = false;
  @Input() slug = '';
  @Input() productNameFallback = '';
  @Input() currentLang: 'en' | 'ro' = 'en';
  @Input() images: StorefrontProductImage[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() imagesChange = new EventEmitter<StorefrontProductImage[]>();

  draftImages: StorefrontProductImage[] = [];
  orderSaving = false;
  orderError = '';
  draggingImageId: string | null = null;
  dragOverImageId: string | null = null;

  editingImageId: string | null = null;
  metaBusy = false;
  metaSaving = false;
  metaError = '';
  imageMeta: ImageMetaByLang = this.blankImageMeta();
  metaExists: Record<'en' | 'ro', boolean> = { en: false, ro: false };

  constructor(private readonly admin: AdminService, private toast: ToastService, private translate: TranslateService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!('open' in changes) && !('images' in changes)) return;
    if (!this.open) {
      this.reset();
      return;
    }
    this.seedDraftImages();
  }

  canReorder(): boolean {
    if (this.orderSaving) return false;
    if (!this.slug.trim()) return false;
    const withIds = this.draftImages.filter((img) => Boolean((img.id || '').trim()));
    return withIds.length === this.draftImages.length && this.draftImages.length > 1;
  }

  onDragStart(event: DragEvent, imageId?: string): void {
    if (!this.canReorder()) return;
    const desired = String(imageId || '').trim();
    if (!desired) return;
    this.draggingImageId = desired;
    this.dragOverImageId = null;
    try {
      event.dataTransfer?.setData('text/plain', desired);
      event.dataTransfer!.effectAllowed = 'move';
    } catch {
      // ignore
    }
  }

  onDragOver(event: DragEvent, imageId?: string): void {
    if (!this.canReorder()) return;
    if (!this.draggingImageId) return;
    const over = String(imageId || '').trim();
    if (!over || over === this.draggingImageId) return;
    event.preventDefault();
    this.dragOverImageId = over;
    try {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    } catch {
      // ignore
    }
  }

  onDrop(event: DragEvent, imageId?: string): void {
    if (!this.canReorder()) return;
    const from = this.draggingImageId;
    if (!from) return;
    const to = String(imageId || '').trim();
    if (!to || to === from) return;
    event.preventDefault();

    const previous = this.draftImages.map((img) => String(img.id || ''));
    const moved = this.reorderDraftImages(from, to);
    if (!moved) return;
    this.persistOrder(previous);
  }

  onDragEnd(): void {
    this.draggingImageId = null;
    this.dragOverImageId = null;
  }

  toggleMeta(imageId?: string): void {
    const desired = String(imageId || '').trim();
    if (!desired) return;
    if (this.editingImageId === desired) {
      this.clearMeta();
      return;
    }
    this.editingImageId = desired;
    this.loadMeta(desired);
  }

  makePrimary(imageId?: string): void {
    if (!this.canReorder()) return;
    const desired = String(imageId || '').trim();
    if (!desired) return;
    const currentFirst = String(this.draftImages[0]?.id || '').trim();
    if (!currentFirst || desired === currentFirst) return;

    const previous = this.draftImages.map((img) => String(img.id || ''));
    const list = [...this.draftImages];
    const index = list.findIndex((img) => String(img.id || '').trim() === desired);
    if (index < 0) return;
    const [moved] = list.splice(index, 1);
    list.unshift(moved);
    this.draftImages = list;
    this.persistOrder(previous);
  }

  saveMeta(): void {
    const slug = (this.slug || '').trim();
    const imageId = (this.editingImageId || '').trim();
    if (!slug || !imageId) return;
    if (this.metaSaving) return;

    const ops = (['ro', 'en'] as const)
      .map((lang) => {
        const alt = (this.imageMeta[lang].alt_text || '').trim();
        const caption = (this.imageMeta[lang].caption || '').trim();
        if (!alt && !caption) {
          if (this.metaExists[lang]) {
            return this.admin.deleteProductImageTranslation(slug, imageId, lang, { source: 'storefront' });
          }
          return null;
        }
        return this.admin.upsertProductImageTranslation(slug, imageId, lang, {
          alt_text: alt || null,
          caption: caption || null
        }, { source: 'storefront' });
      })
      .filter(Boolean);

    if (!ops.length) return;

    this.metaSaving = true;
    this.metaError = '';
    forkJoin(ops).subscribe({
      next: () => {
        this.metaSaving = false;
        this.toast.success(this.translate.instant('adminUi.products.form.imageMetaSaved'));
        this.applyLocalMetaToDraftImage(imageId);
      },
      error: () => {
        this.metaSaving = false;
        this.metaError = this.translate.instant('adminUi.products.form.imageMetaSaveError');
      }
    });
  }

  handleClosed(): void {
    this.reset();
    this.closed.emit();
  }

  private seedDraftImages(): void {
    const incoming = Array.isArray(this.images) ? this.images : [];
    const normalized = incoming.map((img) => this.normalizeDraftImage(img)).filter((img) => Boolean(img.url));
    normalized.sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
    this.draftImages = normalized;
  }

  private reorderDraftImages(fromId: string, toId: string): boolean {
    const list = [...this.draftImages];
    const from = list.findIndex((img) => String(img.id || '') === fromId);
    const to = list.findIndex((img) => String(img.id || '') === toId);
    if (from < 0 || to < 0) return false;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    this.draftImages = list;
    return true;
  }

  private restoreDraftOrder(ids: string[]): void {
    const order = new Map<string, number>();
    ids.forEach((id, idx) => order.set(id, idx));
    const sorted = [...this.draftImages].sort((a, b) => {
      const aIdx = order.get(String(a.id || '')) ?? 0;
      const bIdx = order.get(String(b.id || '')) ?? 0;
      return aIdx - bIdx;
    });
    this.draftImages = sorted;
  }

  private normalizeDraftImage(img: StorefrontProductImage): StorefrontProductImage {
    return {
      id: typeof img?.id === 'string' ? img.id : undefined,
      url: String(img?.url || '').trim(),
      alt_text: typeof img?.alt_text === 'string' ? img.alt_text : img?.alt_text ?? null,
      caption: typeof img?.caption === 'string' ? img.caption : img?.caption ?? null,
      sort_order: typeof img?.sort_order === 'number' && Number.isFinite(img.sort_order) ? img.sort_order : 0
    };
  }

  private persistOrder(previousIds: string[]): void {
    const slug = (this.slug || '').trim();
    if (!slug) return;
    if (this.orderSaving) return;
    const withIds = this.draftImages.map((img) => String(img.id || '').trim()).filter(Boolean);
    if (withIds.length !== this.draftImages.length) return;

    const updates = this.draftImages.map((img, idx) => ({
      id: String(img.id || '').trim(),
      sort_order: idx + 1
    }));
    this.orderSaving = true;
    this.orderError = '';
    this.draggingImageId = null;
    this.dragOverImageId = null;
    forkJoin(updates.map((row) => this.admin.reorderProductImage(slug, row.id, row.sort_order, { source: 'storefront' }))).subscribe({
      next: () => {
        this.orderSaving = false;
        for (const row of updates) {
          const match = this.draftImages.find((img) => String(img.id || '').trim() === row.id);
          if (match) match.sort_order = row.sort_order;
        }
        this.imagesChange.emit([...this.draftImages]);
        const currentIds = this.draftImages.map((img) => String(img.id || '').trim()).filter(Boolean);
        this.toast.action(
          this.translate.instant('adminUi.storefront.products.images.reorderSuccess'),
          this.translate.instant('adminUi.common.undo'),
          () => this.undoImageOrder(previousIds, currentIds),
          { tone: 'success' }
        );
      },
      error: () => {
        this.orderSaving = false;
        this.orderError = this.translate.instant('adminUi.storefront.products.images.reorderError');
        this.restoreDraftOrder(previousIds);
      }
    });
  }

  private undoImageOrder(previousIds: string[], currentIds: string[]): void {
    const slug = (this.slug || '').trim();
    if (!slug) return;
    if (this.orderSaving) return;
    const ids = previousIds.map((id) => String(id || '').trim()).filter(Boolean);
    if (ids.length !== this.draftImages.length) return;

    this.restoreDraftOrder(previousIds);
    const updates = ids.map((id, idx) => ({ id, sort_order: idx + 1 }));
    this.orderSaving = true;
    this.orderError = '';
    forkJoin(updates.map((row) => this.admin.reorderProductImage(slug, row.id, row.sort_order, { source: 'storefront' }))).subscribe({
      next: () => {
        this.orderSaving = false;
        for (const row of updates) {
          const match = this.draftImages.find((img) => String(img.id || '').trim() === row.id);
          if (match) match.sort_order = row.sort_order;
        }
        this.imagesChange.emit([...this.draftImages]);
        this.toast.success(this.translate.instant('adminUi.storefront.undoApplied'));
      },
      error: () => {
        this.orderSaving = false;
        this.restoreDraftOrder(currentIds);
        this.toast.error(this.translate.instant('adminUi.storefront.undoFailed'));
      }
    });
  }

  private blankImageMeta(): ImageMetaByLang {
    return { ro: { alt_text: '', caption: '' }, en: { alt_text: '', caption: '' } };
  }

  private clearMeta(): void {
    this.editingImageId = null;
    this.metaBusy = false;
    this.metaSaving = false;
    this.metaError = '';
    this.metaExists = { en: false, ro: false };
    this.imageMeta = this.blankImageMeta();
  }

  private loadMeta(imageId: string): void {
    const slug = (this.slug || '').trim();
    if (!slug || !imageId) return;
    this.metaBusy = true;
    this.metaError = '';
    this.metaExists = { en: false, ro: false };
    this.imageMeta = this.blankImageMeta();
    this.admin.getProductImageTranslations(slug, imageId).subscribe({
      next: (translations) => {
        const mapped = this.blankImageMeta();
        const exists: Record<'en' | 'ro', boolean> = { en: false, ro: false };
        const rows = Array.isArray(translations) ? translations : [];
        for (const row of rows) {
          const lang = row?.lang === 'ro' ? 'ro' : row?.lang === 'en' ? 'en' : null;
          if (!lang) continue;
          exists[lang] = true;
          mapped[lang].alt_text = String(row?.alt_text || '');
          mapped[lang].caption = String(row?.caption || '');
        }
        this.metaExists = exists;
        this.imageMeta = mapped;
        this.metaBusy = false;
      },
      error: () => {
        this.metaBusy = false;
        this.metaError = this.translate.instant('adminUi.storefront.products.images.metaLoadError');
      }
    });
  }

  private applyLocalMetaToDraftImage(imageId: string): void {
    const lang = this.currentLang;
    const match = this.draftImages.find((img) => String(img.id || '').trim() === imageId);
    if (match) {
      const alt = (this.imageMeta[lang].alt_text || '').trim();
      const caption = (this.imageMeta[lang].caption || '').trim();
      match.alt_text = alt || null;
      match.caption = caption || null;
    }
    this.imagesChange.emit([...this.draftImages]);
  }

  private reset(): void {
    this.orderSaving = false;
    this.orderError = '';
    this.draggingImageId = null;
    this.dragOverImageId = null;
    this.draftImages = [];
    this.clearMeta();
  }
}
