import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AdminService, ContentImageAssetRead, ContentImageEditRequest } from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { extractRequestId } from '../../../shared/http-error';

@Component({
  selector: 'app-asset-library',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, ErrorStateComponent],
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

      <div class="grid gap-2 md:grid-cols-4">
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
          {{ 'adminUi.site.assets.library.search' | translate }}
          <input
            class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            [(ngModel)]="q"
            [placeholder]="'adminUi.site.assets.library.searchPlaceholder' | translate"
            (keyup.enter)="reload(true)"
          />
        </label>
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'adminUi.site.assets.library.scope' | translate }}
          <select
            class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            [(ngModel)]="key"
            (ngModelChange)="reload(true)"
          >
            <option [ngValue]="''">{{ 'adminUi.site.assets.library.scopeAll' | translate }}</option>
            <option *ngFor="let opt of scopedKeys" [ngValue]="opt">{{ opt }}</option>
          </select>
        </label>
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'adminUi.site.assets.library.tagFilter' | translate }}
          <input
            class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            [(ngModel)]="tag"
            [placeholder]="'adminUi.site.assets.library.tagFilterPlaceholder' | translate"
            (keyup.enter)="reload(true)"
          />
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

      <app-error-state
        *ngIf="error()"
        [message]="error()!"
        [requestId]="errorRequestId()"
        [showRetry]="true"
        (retry)="reload()"
      ></app-error-state>

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
		              <button type="button" class="text-xs text-slate-700 hover:underline dark:text-slate-200" (click)="openImageEditor(img)">
		                {{ 'adminUi.site.assets.library.imageEdit' | translate }}
		              </button>
		              <button type="button" class="text-xs text-slate-700 hover:underline dark:text-slate-200" (click)="openUsage(img)">
		                {{ 'adminUi.site.assets.library.whereUsed' | translate }}
		              </button>
		              <button type="button" class="text-xs text-slate-700 hover:underline dark:text-slate-200" (click)="editTags(img)">
		                {{ 'adminUi.site.assets.library.tagsEdit' | translate }}
		              </button>
		              <button type="button" class="text-xs text-slate-700 hover:underline dark:text-slate-200" (click)="openFocalEditor(img)">
		                {{ 'adminUi.site.assets.library.focalEdit' | translate }}
		              </button>
		              <button
		                *ngIf="allowSelect"
	                type="button"
	                class="text-xs text-emerald-700 hover:underline dark:text-emerald-300"
	                (click)="useAsset(img)"
	              >
	                {{ 'adminUi.actions.use' | translate }}
	              </button>
	            </div>
	          </div>
          <p class="mt-2 text-xs text-slate-600 dark:text-slate-300 truncate">{{ img.url }}</p>
	          <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
	            {{ img.content_key }} · {{ img.created_at | date: 'short' }}
	          </p>
	          <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
	            {{ 'adminUi.site.assets.library.focalLabel' | translate: { x: img.focal_x, y: img.focal_y } }}
	          </p>
	          <div *ngIf="img.tags?.length" class="mt-2 flex flex-wrap gap-1">
            <button
              *ngFor="let t of img.tags"
              type="button"
              class="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:bg-slate-800"
              (click)="applyTagFilter(t)"
            >
              {{ t }}
            </button>
          </div>
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

	      <div *ngIf="usageImage" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
	        <div class="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-950">
	          <div class="flex items-start justify-between gap-3">
	            <div class="grid gap-1">
	              <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
	                {{ 'adminUi.site.assets.library.usageTitle' | translate }}
	              </p>
	              <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ usageImage?.url }}</p>
	            </div>
	            <button type="button" class="text-xs font-semibold text-slate-700 hover:underline dark:text-slate-200" (click)="closeUsage()">
	              {{ 'adminUi.common.close' | translate }}
	            </button>
	          </div>

	          <div class="mt-3 grid gap-2">
	            <app-error-state
	              *ngIf="usageError()"
	              [message]="usageError()!"
	              [requestId]="usageRequestId()"
	              [showRetry]="true"
	              (retry)="loadUsage()"
	            ></app-error-state>

	            <div *ngIf="usageLoading()" class="text-sm text-slate-600 dark:text-slate-300">
	              {{ 'adminUi.site.assets.library.usageLoading' | translate }}
	            </div>

	            <div *ngIf="!usageLoading() && !usageError() && usageKeys().length === 0" class="text-sm text-slate-500 dark:text-slate-400">
	              {{ 'adminUi.site.assets.library.usageEmpty' | translate }}
	            </div>

	            <div *ngIf="!usageLoading() && !usageError() && usageKeys().length" class="grid gap-2">
	              <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.site.assets.library.usageHint' | translate }}</p>
	              <button
	                *ngFor="let usageKey of usageKeys()"
	                type="button"
	                class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
	                (click)="jumpToKey(usageKey)"
	              >
	                {{ usageKey }}
	              </button>
	            </div>
	          </div>
	        </div>
	      </div>

	      <div *ngIf="focalImage" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
	        <div class="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-950">
	          <div class="flex items-start justify-between gap-3">
	            <div class="grid gap-1">
	              <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
	                {{ 'adminUi.site.assets.library.focalTitle' | translate }}
	              </p>
	              <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.site.assets.library.focalPreviewHint' | translate }}</p>
	            </div>
	            <button
	              type="button"
	              class="text-xs font-semibold text-slate-700 hover:underline dark:text-slate-200"
	              [disabled]="focalSaving()"
	              (click)="closeFocalEditor()"
	            >
	              {{ 'adminUi.common.close' | translate }}
	            </button>
	          </div>

	          <div class="mt-3 grid gap-3">
	            <div
	              class="relative w-full aspect-[16/9] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 cursor-crosshair dark:border-slate-800 dark:bg-slate-900"
	              (click)="pickFocal($event)"
	            >
	              <img
	                [src]="focalImage?.url"
	                [alt]="focalImage?.alt_text || 'asset'"
	                class="h-full w-full object-cover"
	                [style.object-position]="focalObjectPosition()"
	              />
	              <div class="pointer-events-none absolute left-0 top-0 h-full w-full">
	                <div
	                  class="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-indigo-500 bg-indigo-500/10"
	                  [style.left.%]="focalDraftX"
	                  [style.top.%]="focalDraftY"
	                ></div>
	              </div>
	            </div>

	            <p class="text-xs text-slate-500 dark:text-slate-400">
	              {{ 'adminUi.site.assets.library.focalLabel' | translate: { x: focalDraftX, y: focalDraftY } }}
	            </p>

	            <div class="grid gap-2 sm:grid-cols-3">
	              <div class="grid gap-1">
	                <p class="text-xs font-semibold text-slate-700 dark:text-slate-200">{{ 'adminUi.site.assets.library.cropHero' | translate }}</p>
	                <div class="relative w-full aspect-[16/7] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
	                  <img
	                    [src]="focalImage?.url"
	                    [alt]="focalImage?.alt_text || 'asset'"
	                    class="h-full w-full object-cover"
	                    [style.object-position]="focalObjectPosition()"
	                  />
	                </div>
	              </div>
	              <div class="grid gap-1">
	                <p class="text-xs font-semibold text-slate-700 dark:text-slate-200">{{ 'adminUi.site.assets.library.cropCard' | translate }}</p>
	                <div class="relative w-full aspect-[4/3] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
	                  <img
	                    [src]="focalImage?.url"
	                    [alt]="focalImage?.alt_text || 'asset'"
	                    class="h-full w-full object-cover"
	                    [style.object-position]="focalObjectPosition()"
	                  />
	                </div>
	              </div>
	              <div class="grid gap-1">
	                <p class="text-xs font-semibold text-slate-700 dark:text-slate-200">{{ 'adminUi.site.assets.library.cropMobile' | translate }}</p>
	                <div class="relative w-full aspect-[9/16] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
	                  <img
	                    [src]="focalImage?.url"
	                    [alt]="focalImage?.alt_text || 'asset'"
	                    class="h-full w-full object-cover"
	                    [style.object-position]="focalObjectPosition()"
	                  />
	                </div>
	              </div>
	            </div>

	            <div class="flex flex-wrap items-center justify-end gap-2">
	              <button
	                type="button"
	                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
	                [disabled]="focalSaving()"
	                (click)="closeFocalEditor()"
	              >
	                {{ 'adminUi.actions.cancel' | translate }}
	              </button>
	              <button
	                type="button"
	                class="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
	                [disabled]="focalSaving()"
	                (click)="saveFocalEditor()"
	              >
	                {{ 'adminUi.actions.save' | translate }}
	              </button>
	            </div>
	          </div>
	        </div>
	      </div>

	      <div *ngIf="editImage" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
	        <div class="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-950">
	          <div class="flex items-start justify-between gap-3">
	            <div class="grid gap-1">
	              <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
	                {{ 'adminUi.site.assets.library.editorTitle' | translate }}
	              </p>
	              <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.site.assets.library.editorHint' | translate }}</p>
	            </div>
	            <button type="button" class="text-xs font-semibold text-slate-700 hover:underline dark:text-slate-200" (click)="closeImageEditor()">
	              {{ 'adminUi.common.close' | translate }}
	            </button>
	          </div>

	          <div class="mt-3 grid gap-4 lg:grid-cols-2">
	            <div class="grid gap-3">
	              <div class="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
	                <div class="flex items-center gap-3">
	                  <img
	                    [src]="editImage?.url"
	                    [alt]="editImage?.alt_text || 'asset'"
	                    class="h-12 w-12 rounded-lg border border-slate-200 object-cover dark:border-slate-800"
	                    loading="lazy"
	                  />
	                  <div class="min-w-0 grid gap-1">
	                    <p class="text-xs font-semibold text-slate-900 dark:text-slate-50 truncate">{{ editImage?.content_key }}</p>
	                    <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate">{{ editImage?.url }}</p>
	                  </div>
	                </div>

	                <div class="grid gap-2 sm:grid-cols-2">
	                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                    {{ 'adminUi.site.assets.library.rotateLabel' | translate }}
	                    <select
	                      class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                      [(ngModel)]="editRotateCw"
	                    >
	                      <option [ngValue]="0">{{ 'adminUi.site.assets.library.rotateNone' | translate }}</option>
	                      <option [ngValue]="90">{{ 'adminUi.site.assets.library.rotate90' | translate }}</option>
	                      <option [ngValue]="180">{{ 'adminUi.site.assets.library.rotate180' | translate }}</option>
	                      <option [ngValue]="270">{{ 'adminUi.site.assets.library.rotate270' | translate }}</option>
	                    </select>
	                  </label>
	                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                    {{ 'adminUi.site.assets.library.cropLabel' | translate }}
	                    <select
	                      class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                      [(ngModel)]="editCropPreset"
	                    >
	                      <option [ngValue]="'none'">{{ 'adminUi.site.assets.library.cropNone' | translate }}</option>
	                      <option [ngValue]="'square'">{{ 'adminUi.site.assets.library.cropSquare' | translate }}</option>
	                      <option [ngValue]="'hero'">{{ 'adminUi.site.assets.library.cropHero' | translate }}</option>
	                      <option [ngValue]="'card'">{{ 'adminUi.site.assets.library.cropCard' | translate }}</option>
	                      <option [ngValue]="'mobile'">{{ 'adminUi.site.assets.library.cropMobile' | translate }}</option>
	                    </select>
	                  </label>
	                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                    {{ 'adminUi.site.assets.library.resizeMaxWidth' | translate }}
	                    <input
	                      type="number"
	                      class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                      [(ngModel)]="editMaxWidth"
	                      placeholder="e.g. 1600"
	                    />
	                  </label>
	                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                    {{ 'adminUi.site.assets.library.resizeMaxHeight' | translate }}
	                    <input
	                      type="number"
	                      class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                      [(ngModel)]="editMaxHeight"
	                      placeholder="e.g. 1200"
	                    />
	                  </label>
	                </div>
	              </div>

	              <div class="flex flex-wrap items-center justify-end gap-2">
	                <button
	                  type="button"
	                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
	                  [disabled]="editSaving()"
	                  (click)="closeImageEditor()"
	                >
	                  {{ 'adminUi.actions.cancel' | translate }}
	                </button>
	                <button
	                  type="button"
	                  class="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
	                  [disabled]="editSaving()"
	                  (click)="createEditedCopy()"
	                >
	                  {{ 'adminUi.site.assets.library.editorCreate' | translate }}
	                </button>
	              </div>
	            </div>

	            <div class="grid gap-2">
	              <p class="text-xs font-semibold text-slate-700 dark:text-slate-200">{{ 'adminUi.site.assets.library.editorPreview' | translate }}</p>
	              <div
	                class="relative w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900"
	                [ngClass]="editPreviewAspectClass()"
	              >
	                <img
	                  [src]="editImage?.url"
	                  [alt]="editImage?.alt_text || 'asset'"
	                  class="h-full w-full"
	                  [ngClass]="{ 'object-cover': editCropPreset !== 'none', 'object-contain': editCropPreset === 'none' }"
	                  [style.object-position]="(editImage?.focal_x ?? 50) + '% ' + (editImage?.focal_y ?? 50) + '%'"
	                />
	              </div>
	              <p *ngIf="editRotateCw !== 0" class="text-[11px] text-slate-500 dark:text-slate-400">
	                {{ 'adminUi.site.assets.library.editorRotationNote' | translate }}
	              </p>
	            </div>
	          </div>
	        </div>
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
  @Output() selectAsset = new EventEmitter<ContentImageAssetRead>();

  q = '';
  key = '';
  tag = '';
  page = 1;
  limit = 24;

  loading = signal(false);
  error = signal<string | null>(null);
  errorRequestId = signal<string | null>(null);
  images = signal<ContentImageAssetRead[]>([]);
  private totalPages = signal(1);

  usageImage: ContentImageAssetRead | null = null;
  usageLoading = signal(false);
  usageError = signal<string | null>(null);
  usageRequestId = signal<string | null>(null);
  usageKeys = signal<string[]>([]);

  focalImage: ContentImageAssetRead | null = null;
  focalDraftX = 50;
  focalDraftY = 50;
  focalSaving = signal(false);

  editImage: ContentImageAssetRead | null = null;
  editRotateCw: 0 | 90 | 180 | 270 = 0;
  editCropPreset: 'none' | 'square' | 'hero' | 'card' | 'mobile' = 'none';
  editMaxWidth: number | null = null;
  editMaxHeight: number | null = null;
  editSaving = signal(false);

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

  reload(reset: boolean = false): void {
    if (reset) this.page = 1;
    this.loading.set(true);
    this.error.set(null);
    this.errorRequestId.set(null);
    this.admin
      .listContentImages({ q: this.q || undefined, key: this.key || undefined, tag: this.tag || undefined, page: this.page, limit: this.limit })
      .subscribe({
      next: (resp) => {
        this.images.set(resp.items || []);
        this.totalPages.set(resp.meta?.total_pages || 1);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(this.t('adminUi.site.assets.library.errors.load'));
        this.errorRequestId.set(extractRequestId(err));
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

  applyTagFilter(tag: string): void {
    const value = (tag || '').trim();
    if (!value) return;
    this.tag = value;
    this.reload(true);
  }

  editTags(img: ContentImageAssetRead): void {
    const id = (img?.id || '').trim();
    if (!id) return;
    const current = (img.tags || []).join(', ');
    const entered = window.prompt(this.t('adminUi.site.assets.library.tagsPrompt'), current);
    if (entered === null) return;
    const tags = entered
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    this.admin.updateContentImageTags(id, tags).subscribe({
      next: (updated) => {
        const updatedTags = updated?.tags || [];
        this.images.set(this.images().map((item) => (item.id === id ? { ...item, tags: updatedTags } : item)));
        this.toast.success(this.t('adminUi.site.assets.library.tagsSaved'));
      },
      error: () => this.toast.error(this.t('adminUi.site.assets.library.tagsErrorsSave'))
    });
  }

  openUsage(img: ContentImageAssetRead): void {
    const id = (img?.id || '').trim();
    if (!id) return;
    this.usageImage = img;
    this.focalImage = null;
    this.editImage = null;
    this.loadUsage();
  }

  loadUsage(): void {
    const img = this.usageImage;
    const id = (img?.id || '').trim();
    if (!id) return;
    this.usageLoading.set(true);
    this.usageError.set(null);
    this.usageRequestId.set(null);
    this.usageKeys.set([]);
    this.admin.getContentImageUsage(id).subscribe({
      next: (resp) => {
        this.usageKeys.set((resp?.keys || []).filter(Boolean));
        this.usageLoading.set(false);
      },
      error: (err) => {
        this.usageError.set(this.t('adminUi.site.assets.library.errors.usage'));
        this.usageRequestId.set(extractRequestId(err));
        this.usageLoading.set(false);
      }
    });
  }

  closeUsage(): void {
    this.usageImage = null;
    this.usageLoading.set(false);
    this.usageError.set(null);
    this.usageRequestId.set(null);
    this.usageKeys.set([]);
  }

  jumpToKey(key: string): void {
    const value = (key || '').trim();
    if (!value) return;
    this.key = value;
    this.closeUsage();
    this.reload(true);
  }

  openFocalEditor(img: ContentImageAssetRead): void {
    const id = (img?.id || '').trim();
    if (!id) return;
    this.focalImage = img;
    this.usageImage = null;
    this.editImage = null;
    const currentX = Number.isFinite(img.focal_x as any) ? Number(img.focal_x) : 50;
    const currentY = Number.isFinite(img.focal_y as any) ? Number(img.focal_y) : 50;
    this.focalDraftX = Math.max(0, Math.min(100, Math.round(currentX)));
    this.focalDraftY = Math.max(0, Math.min(100, Math.round(currentY)));
  }

  closeFocalEditor(): void {
    if (this.focalSaving()) return;
    this.focalImage = null;
  }

  pickFocal(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const rawX = ((event.clientX - rect.left) / rect.width) * 100;
    const rawY = ((event.clientY - rect.top) / rect.height) * 100;
    this.focalDraftX = Math.max(0, Math.min(100, Math.round(rawX)));
    this.focalDraftY = Math.max(0, Math.min(100, Math.round(rawY)));
  }

  focalObjectPosition(): string {
    return `${this.focalDraftX}% ${this.focalDraftY}%`;
  }

  saveFocalEditor(): void {
    const img = this.focalImage;
    const id = (img?.id || '').trim();
    if (!id) return;
    const focalX = Math.max(0, Math.min(100, Math.round(this.focalDraftX)));
    const focalY = Math.max(0, Math.min(100, Math.round(this.focalDraftY)));
    this.focalSaving.set(true);
    this.admin.updateContentImageFocalPoint(id, focalX, focalY).subscribe({
      next: (updated) => {
        this.images.set(
          this.images().map((item) => (item.id === id ? { ...item, focal_x: updated.focal_x, focal_y: updated.focal_y } : item))
        );
        this.toast.success(this.t('adminUi.site.assets.library.focalSaved'));
        this.focalSaving.set(false);
        this.focalImage = null;
      },
      error: () => {
        this.toast.error(this.t('adminUi.site.assets.library.focalErrorsSave'));
        this.focalSaving.set(false);
      }
    });
  }

  openImageEditor(img: ContentImageAssetRead): void {
    const id = (img?.id || '').trim();
    if (!id) return;
    this.editImage = img;
    this.usageImage = null;
    this.focalImage = null;
    this.editRotateCw = 0;
    this.editCropPreset = 'none';
    this.editMaxWidth = null;
    this.editMaxHeight = null;
  }

  closeImageEditor(): void {
    if (this.editSaving()) return;
    this.editImage = null;
  }

  editPreviewAspectClass(): string {
    switch (this.editCropPreset) {
      case 'square':
        return 'aspect-[1/1]';
      case 'hero':
        return 'aspect-[16/7]';
      case 'card':
        return 'aspect-[4/3]';
      case 'mobile':
        return 'aspect-[9/16]';
      default:
        return 'aspect-[16/9]';
    }
  }

  createEditedCopy(): void {
    const img = this.editImage;
    const id = (img?.id || '').trim();
    if (!id) return;

    const hasRotate = this.editRotateCw !== 0;
    const hasCrop = this.editCropPreset !== 'none';
    const hasResize = Boolean(this.editMaxWidth) || Boolean(this.editMaxHeight);

    if (!hasRotate && !hasCrop && !hasResize) {
      this.toast.error(this.t('adminUi.site.assets.library.editorErrorsNoop'));
      return;
    }

    const payload: ContentImageEditRequest = {};
    if (hasRotate) payload.rotate_cw = this.editRotateCw;
    if (hasCrop) {
      const aspectMap: Record<string, { w: number; h: number }> = {
        square: { w: 1, h: 1 },
        hero: { w: 16, h: 7 },
        card: { w: 4, h: 3 },
        mobile: { w: 9, h: 16 }
      };
      const aspect = aspectMap[this.editCropPreset];
      if (aspect) {
        payload.crop_aspect_w = aspect.w;
        payload.crop_aspect_h = aspect.h;
      }
    }
    if (this.editMaxWidth) payload.resize_max_width = this.editMaxWidth;
    if (this.editMaxHeight) payload.resize_max_height = this.editMaxHeight;

    this.editSaving.set(true);
    this.admin.editContentImage(id, payload).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.site.assets.library.success.edited'));
        this.editSaving.set(false);
        this.editImage = null;
        this.page = 1;
        this.reload();
      },
      error: () => {
        this.toast.error(this.t('adminUi.site.assets.library.errors.edit'));
        this.editSaving.set(false);
      }
    });
  }

  useAsset(img: ContentImageAssetRead): void {
    const url = (img?.url || '').trim();
    if (!url) return;
    this.select.emit(url);
    this.selectAsset.emit(img);
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }
}
