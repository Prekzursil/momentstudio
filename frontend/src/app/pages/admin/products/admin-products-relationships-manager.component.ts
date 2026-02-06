import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import type { AdminProductListItem } from '../../../core/admin-products.service';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';

@Component({
  selector: 'app-admin-products-relationships-manager',
  standalone: true,
  imports: [CommonModule, TranslateModule, ButtonComponent, InputComponent],
  template: `
    <details
      data-ignore-dirty
      class="group rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/20"
    >
      <summary class="flex items-start justify-between gap-4 cursor-pointer select-none [&::-webkit-details-marker]:hidden">
        <div class="min-w-0 grid gap-1">
          <h3 class="text-sm font-semibold tracking-wide uppercase text-slate-700 dark:text-slate-200">
            {{ 'adminUi.products.relationships.title' | translate }}
          </h3>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ 'adminUi.products.relationships.hint' | translate }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <span
            *ngIf="relationshipsRelated.length + relationshipsUpsells.length"
            class="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            {{ relationshipsRelated.length + relationshipsUpsells.length }}
          </span>
          <span class="text-slate-500 transition-transform group-open:rotate-90 dark:text-slate-400">▸</span>
        </div>
      </summary>

      <div class="mt-3 grid gap-3">
        <div
          *ngIf="!hasEditingSlug"
          class="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100"
        >
          {{ 'adminUi.products.relationships.saveFirst' | translate }}
        </div>

        <div
          *ngIf="relationshipsError"
          class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
        >
          {{ relationshipsError }}
        </div>

        <div
          *ngIf="relationshipsMessage"
          class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
        >
          {{ relationshipsMessage }}
        </div>

        <div class="grid gap-2">
          <app-input
            [label]="'adminUi.products.relationships.searchLabel' | translate"
            [value]="relationshipSearch"
            (valueChange)="relationshipSearchChanged.emit($event)"
            [disabled]="relationshipSearchLoading || relationshipsLoading"
          ></app-input>

          <div *ngIf="relationshipSearchLoading" class="text-xs text-slate-500 dark:text-slate-400">
            {{ 'adminUi.products.relationships.searchLoading' | translate }}
          </div>

          <div
            *ngIf="relationshipSearchResults.length"
            class="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900"
          >
            <div
              *ngFor="let p of relationshipSearchResults"
              class="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <div class="min-w-0">
                <p class="font-semibold text-slate-900 dark:text-slate-50 truncate">{{ p.name }}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ p.slug }} · {{ p.sku }}</p>
              </div>
              <div class="flex items-center gap-1">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.products.relationships.addRelated' | translate"
                  (action)="addRequested.emit({ item: p, kind: 'related' })"
                  [disabled]="!hasEditingSlug"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.products.relationships.addUpsell' | translate"
                  (action)="addRequested.emit({ item: p, kind: 'upsell' })"
                  [disabled]="!hasEditingSlug"
                ></app-button>
              </div>
            </div>
          </div>

          <div class="grid gap-4 lg:grid-cols-2">
            <div class="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                {{ 'adminUi.products.relationships.related' | translate }}
              </p>
              <div *ngIf="relationshipsRelated.length === 0" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'adminUi.products.relationships.empty' | translate }}
              </div>
              <div *ngFor="let p of relationshipsRelated; let idx = index" class="flex items-center justify-between gap-2">
                <div class="min-w-0">
                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">{{ p.name }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ p.slug }}</p>
                </div>
                <div class="flex items-center gap-1">
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.actions.up' | translate"
                    (action)="moveRequested.emit({ kind: 'related', index: idx, direction: -1 })"
                    [disabled]="idx === 0 || relationshipsSaving"
                  ></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.actions.down' | translate"
                    (action)="moveRequested.emit({ kind: 'related', index: idx, direction: 1 })"
                    [disabled]="idx >= relationshipsRelated.length - 1 || relationshipsSaving"
                  ></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.actions.remove' | translate"
                    (action)="removeRequested.emit({ id: String(p.id), kind: 'related' })"
                    [disabled]="relationshipsSaving"
                  ></app-button>
                </div>
              </div>
            </div>

            <div class="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                {{ 'adminUi.products.relationships.upsells' | translate }}
              </p>
              <div *ngIf="relationshipsUpsells.length === 0" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'adminUi.products.relationships.empty' | translate }}
              </div>
              <div *ngFor="let p of relationshipsUpsells; let idx = index" class="flex items-center justify-between gap-2">
                <div class="min-w-0">
                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">{{ p.name }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ p.slug }}</p>
                </div>
                <div class="flex items-center gap-1">
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.actions.up' | translate"
                    (action)="moveRequested.emit({ kind: 'upsell', index: idx, direction: -1 })"
                    [disabled]="idx === 0 || relationshipsSaving"
                  ></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.actions.down' | translate"
                    (action)="moveRequested.emit({ kind: 'upsell', index: idx, direction: 1 })"
                    [disabled]="idx >= relationshipsUpsells.length - 1 || relationshipsSaving"
                  ></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.actions.remove' | translate"
                    (action)="removeRequested.emit({ id: String(p.id), kind: 'upsell' })"
                    [disabled]="relationshipsSaving"
                  ></app-button>
                </div>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-end">
            <app-button
              size="sm"
              [label]="'adminUi.products.relationships.save' | translate"
              (action)="saveRequested.emit()"
              [disabled]="relationshipsSaving || !hasEditingSlug"
            ></app-button>
          </div>
        </div>
      </div>
    </details>
  `
})
export class AdminProductsRelationshipsManagerComponent {
  @Input({ required: true }) hasEditingSlug = false;
  @Input({ required: true }) relationshipSearch = '';
  @Input({ required: true }) relationshipSearchLoading = false;
  @Input({ required: true }) relationshipSearchResults: AdminProductListItem[] = [];
  @Input({ required: true }) relationshipsRelated: AdminProductListItem[] = [];
  @Input({ required: true }) relationshipsUpsells: AdminProductListItem[] = [];
  @Input({ required: true }) relationshipsLoading = false;
  @Input({ required: true }) relationshipsSaving = false;
  @Input() relationshipsError: string | null = null;
  @Input() relationshipsMessage: string | null = null;

  @Output() relationshipSearchChanged = new EventEmitter<string | number>();
  @Output() addRequested = new EventEmitter<{ item: AdminProductListItem; kind: 'related' | 'upsell' }>();
  @Output() moveRequested = new EventEmitter<{ kind: 'related' | 'upsell'; index: number; direction: -1 | 1 }>();
  @Output() removeRequested = new EventEmitter<{ id: string; kind: 'related' | 'upsell' }>();
  @Output() saveRequested = new EventEmitter<void>();
}

