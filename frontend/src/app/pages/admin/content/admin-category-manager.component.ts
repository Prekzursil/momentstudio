import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AdminCategory, AdminService } from '../../../core/admin.service';
import { TaxGroupRead } from '../../../core/taxes-admin.service';
import { ToastService } from '../../../core/toast.service';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';
import { HelpPanelComponent } from '../../../shared/help-panel.component';
import { ModalComponent } from '../../../shared/modal.component';

/**
 * Category management panel, extracted (behaviour-preserving) from the monolithic
 * AdminComponent. Owns the category CRUD (create/update/delete), the drag + arrow
 * reorder, the per-category parent / low-stock-threshold / tax-group editors, the
 * RO/EN translation editor, and the two-step "add category" wizard, plus all of the
 * category-management-only local state.
 *
 * The `categories` list itself is a SHARED collection: the parent AdminComponent
 * still loads it (for both the "pages" and "settings" sections) and reads it from
 * the product form + the page/home content builders, so it is threaded in as a
 * two-way binding (`[(categories)]`). Whenever this panel mutates the list (add /
 * delete / reorder) it emits the new array back through `categoriesChange` so the
 * parent's cross-feature readers stay in sync. `taxGroups` is threaded in read-only
 * (owned by the Settings > Taxes panel that stays on the parent) to populate the
 * per-category tax-group select. The host is `display: contents` so the panel's rows
 * keep participating in the parent settings-card grid exactly as before.
 */
@Component({
  selector: 'app-admin-category-manager',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    ButtonComponent,
    InputComponent,
    HelpPanelComponent,
    ModalComponent,
  ],
  styles: [':host { display: contents; }'],
  template: `
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {{ 'adminUi.categories.title' | translate }}
            </h2>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'adminUi.categories.wizard.start' | translate"
              (action)="startCategoryWizard()"
            ></app-button>
          </div>

          <app-help-panel
            [titleKey]="'adminUi.help.title'"
            [subtitleKey]="'adminUi.categories.help.subtitle'"
            [mediaSrc]="'assets/help/admin-categories-help.svg'"
            [mediaAltKey]="'adminUi.categories.help.mediaAlt'"
          >
            <ul class="list-disc pl-5 text-xs text-slate-600 dark:text-slate-300">
              <li>{{ 'adminUi.categories.help.points.slug' | translate }}</li>
              <li>{{ 'adminUi.categories.help.points.parent' | translate }}</li>
              <li>{{ 'adminUi.categories.help.points.translations' | translate }}</li>
            </ul>
          </app-help-panel>

          <app-modal
            [open]="categoryDeleteConfirmOpen()"
            [title]="
              'adminUi.categories.confirmDelete.title'
                | translate: { name: categoryDeleteConfirmTarget()?.name || '' }
            "
            [subtitle]="'adminUi.categories.confirmDelete.subtitle' | translate"
            [closeLabel]="'adminUi.actions.cancel' | translate"
            [cancelLabel]="'adminUi.actions.cancel' | translate"
            [confirmLabel]="
              categoryDeleteConfirmBusy()
                ? ('adminUi.actions.loading' | translate)
                : ('adminUi.actions.delete' | translate)
            "
            [confirmDisabled]="categoryDeleteConfirmBusy()"
            (closed)="closeCategoryDeleteConfirm()"
            (confirm)="confirmDeleteCategory()"
          >
            <div class="grid gap-3">
              <div
                *ngIf="categoryDeleteConfirmTarget() as cat"
                class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20"
              >
                <p class="font-semibold text-slate-900 dark:text-slate-50">{{ cat.name }}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400">Slug: {{ cat.slug }}</p>
              </div>

              <ul class="list-disc pl-5 text-sm text-slate-700 dark:text-slate-200">
                <li>{{ 'adminUi.categories.confirmDelete.points.permanent' | translate }}</li>
                <li>{{ 'adminUi.categories.confirmDelete.points.inUse' | translate }}</li>
                <li>{{ 'adminUi.categories.confirmDelete.points.urls' | translate }}</li>
              </ul>
            </div>
          </app-modal>

          <div
            *ngIf="categoryWizardOpen()"
            class="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="grid gap-1">
                <p class="font-semibold">{{ 'adminUi.categories.wizard.title' | translate }}</p>
                <p class="text-xs text-indigo-800 dark:text-indigo-200">
                  {{ categoryWizardDescriptionKey() | translate }}
                </p>
              </div>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.exit' | translate"
                (action)="exitCategoryWizard()"
              ></app-button>
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-2">
              <button
                *ngFor="let step of categoryWizardSteps; let idx = index"
                type="button"
                class="rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-semibold text-indigo-900 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/10 dark:text-indigo-100 dark:hover:bg-indigo-900/30"
                [class.bg-indigo-600]="idx === categoryWizardStep()"
                [class.text-white]="idx === categoryWizardStep()"
                [class.border-indigo-600]="idx === categoryWizardStep()"
                [class.hover:bg-indigo-700]="idx === categoryWizardStep()"
                [class.dark:bg-indigo-500/30]="idx === categoryWizardStep()"
                [class.dark:hover:bg-indigo-500/40]="idx === categoryWizardStep()"
                (click)="goToCategoryWizardStep(idx)"
              >
                {{ step.labelKey | translate }}
              </button>
            </div>

            <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.back' | translate"
                (action)="categoryWizardPrev()"
                [disabled]="categoryWizardStep() === 0"
              ></app-button>

              <div class="flex flex-wrap items-center gap-2">
                <app-button
                  *ngIf="categoryWizardStep() === 0"
                  size="sm"
                  [label]="'adminUi.categories.add' | translate"
                  (action)="addCategory()"
                  [disabled]="!categoryName.trim()"
                ></app-button>
                <app-button
                  *ngIf="categoryWizardStep() === 1 && categoryWizardSlug()"
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.categories.translations.button' | translate"
                  (action)="openCategoryWizardTranslations()"
                ></app-button>
                <app-button
                  size="sm"
                  [label]="categoryWizardNextLabelKey() | translate"
                  (action)="categoryWizardNext()"
                  [disabled]="!categoryWizardCanNext()"
                ></app-button>
              </div>
            </div>
          </div>

          <div class="grid md:grid-cols-[1fr_260px_auto] gap-2 items-end text-sm">
            <app-input
              [label]="'adminUi.products.table.name' | translate"
              [(value)]="categoryName"
            ></app-input>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'adminUi.categories.parent' | translate }}
              <select
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="categoryParentId"
              >
                <option value="">{{ 'adminUi.categories.parentNone' | translate }}</option>
                <option *ngFor="let cat of categories" [value]="cat.id">{{ cat.name }}</option>
              </select>
            </label>
            <app-button
              size="sm"
              [label]="'adminUi.categories.add' | translate"
              (action)="addCategory()"
            ></app-button>
          </div>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ 'adminUi.categories.slugAutoHint' | translate }}
          </p>
          <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
            <div
              *ngFor="let cat of categories"
              class="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
              (dragover)="onCategoryDragOver($event)"
              (drop)="onCategoryDrop(cat.slug)"
            >
              <div
                class="flex items-center justify-between gap-3"
                draggable="true"
                (dragstart)="onCategoryDragStart(cat.slug)"
              >
                <div>
                  <p class="font-semibold text-slate-900 dark:text-slate-50">{{ cat.name }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    Slug: {{ cat.slug }} · Order: {{ cat.sort_order }} · Parent:
                    {{ categoryParentLabel(cat) }}
                  </p>
                </div>
                <div class="flex flex-wrap justify-end gap-2">
                  <app-button
                    size="sm"
                    variant="ghost"
                    label="↑"
                    (action)="moveCategory(cat, -1)"
                  ></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    label="↓"
                    (action)="moveCategory(cat, 1)"
                  ></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.categories.translations.button' | translate"
                    (action)="toggleCategoryTranslations(cat.slug)"
                  ></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.actions.delete' | translate"
                    (action)="openCategoryDeleteConfirm(cat)"
                  ></app-button>
                </div>
              </div>
              <label
                class="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"
              >
                <span class="font-semibold">{{ 'adminUi.categories.parent' | translate }}:</span>
                <select
                  class="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [ngModel]="cat.parent_id || ''"
                  (ngModelChange)="updateCategoryParent(cat, $event)"
                >
                  <option value="">{{ 'adminUi.categories.parentNone' | translate }}</option>
                  <option *ngFor="let parent of categoryParentOptions(cat)" [value]="parent.id">
                    {{ parent.name }}
                  </option>
                </select>
              </label>

              <label
                class="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"
              >
                <span class="font-semibold"
                  >{{ 'adminUi.lowStock.thresholdLabel' | translate }}:</span
                >
                <input
                  type="number"
                  min="0"
                  class="h-8 w-28 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [ngModel]="cat.low_stock_threshold ?? ''"
                  (ngModelChange)="updateCategoryLowStockThreshold(cat, $event)"
                />
                <span class="text-xs text-slate-500 dark:text-slate-400">{{
                  'adminUi.lowStock.thresholdHint' | translate
                }}</span>
              </label>

              <label
                class="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"
              >
                <span class="font-semibold"
                  >{{ 'adminUi.taxes.categoryGroupLabel' | translate }}:</span
                >
                <select
                  class="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [ngModel]="cat.tax_group_id || ''"
                  (ngModelChange)="updateCategoryTaxGroup(cat, $event)"
                >
                  <option value="">{{ 'adminUi.taxes.categoryGroupDefault' | translate }}</option>
                  <option *ngFor="let tg of taxGroups" [value]="tg.id">
                    {{ tg.name }} ({{ tg.code }})
                  </option>
                </select>
              </label>

              <div
                *ngIf="categoryTranslationsSlug === cat.slug"
                class="mt-3 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/30"
              >
                <div class="flex items-center justify-between gap-3">
                  <p
                    class="text-xs font-semibold tracking-wide uppercase text-slate-600 dark:text-slate-300"
                  >
                    {{ 'adminUi.categories.translations.title' | translate }}
                  </p>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.actions.cancel' | translate"
                    (action)="closeCategoryTranslations()"
                  ></app-button>
                </div>
                <p class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.categories.translations.hint' | translate }}
                </p>

                <div
                  *ngIf="categoryTranslationsError()"
                  class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
                >
                  {{ categoryTranslationsError() }}
                </div>

                <div class="grid gap-4 lg:grid-cols-2">
                  <div
                    class="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">RO</p>
                      <div class="flex items-center gap-2">
                        <app-button
                          size="sm"
                          [label]="'adminUi.actions.save' | translate"
                          (action)="saveCategoryTranslation('ro')"
                        ></app-button>
                        <app-button
                          *ngIf="categoryTranslationExists.ro"
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.actions.delete' | translate"
                          (action)="deleteCategoryTranslation('ro')"
                        ></app-button>
                      </div>
                    </div>
                    <app-input
                      [label]="'adminUi.products.table.name' | translate"
                      [(value)]="categoryTranslations.ro.name"
                    ></app-input>
                    <label
                      class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200"
                    >
                      {{ 'adminUi.categories.description' | translate }}
                      <textarea
                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        rows="2"
                        [(ngModel)]="categoryTranslations.ro.description"
                      ></textarea>
                    </label>
                  </div>

                  <div
                    class="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">EN</p>
                      <div class="flex items-center gap-2">
                        <app-button
                          size="sm"
                          [label]="'adminUi.actions.save' | translate"
                          (action)="saveCategoryTranslation('en')"
                        ></app-button>
                        <app-button
                          *ngIf="categoryTranslationExists.en"
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.actions.delete' | translate"
                          (action)="deleteCategoryTranslation('en')"
                        ></app-button>
                      </div>
                    </div>
                    <app-input
                      [label]="'adminUi.products.table.name' | translate"
                      [(value)]="categoryTranslations.en.name"
                    ></app-input>
                    <label
                      class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200"
                    >
                      {{ 'adminUi.categories.description' | translate }}
                      <textarea
                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        rows="2"
                        [(ngModel)]="categoryTranslations.en.description"
                      ></textarea>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
  `,
})
export class AdminCategoryManagerComponent {
  /**
   * Shared category list, owned/loaded by the parent AdminComponent (it is also read
   * by the product form and the page/home content builders). Two-way bound so this
   * panel's mutations propagate back to those cross-feature readers.
   */
  @Input() categories: AdminCategory[] = [];
  @Output() categoriesChange = new EventEmitter<AdminCategory[]>();

  /** Tax groups owned by the parent Settings > Taxes panel; read-only here. */
  @Input() taxGroups: TaxGroupRead[] = [];

  categoryName = '';
  categoryParentId = '';
  categoryWizardOpen = signal(false);
  categoryWizardStep = signal(0);
  categoryWizardSlug = signal<string | null>(null);
  readonly categoryWizardSteps = [
    {
      id: 'basics',
      labelKey: 'adminUi.categories.wizard.steps.basics',
      descriptionKey: 'adminUi.categories.wizard.desc.basics',
    },
    {
      id: 'translations',
      labelKey: 'adminUi.categories.wizard.steps.translations',
      descriptionKey: 'adminUi.categories.wizard.desc.translations',
    },
  ];
  categoryTranslationsSlug: string | null = null;
  categoryTranslationsError = signal<string | null>(null);
  categoryTranslationExists: Record<'en' | 'ro', boolean> = { en: false, ro: false };
  categoryTranslations: Record<'en' | 'ro', { name: string; description: string }> = {
    en: this.blankCategoryTranslation(),
    ro: this.blankCategoryTranslation(),
  };
  categoryDeleteConfirmOpen = signal(false);
  categoryDeleteConfirmBusy = signal(false);
  categoryDeleteConfirmTarget = signal<AdminCategory | null>(null);
  draggingSlug: string | null = null;

  constructor(
    private readonly admin: AdminService,
    private readonly toast: ToastService,
    private readonly translate: TranslateService,
  ) {}

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }

  /**
   * Replace the shared list and notify the parent so its cross-feature readers (the
   * product form + page/home builders) see the mutation. In-place edits of individual
   * category objects (parent/threshold/tax-group) do not go through here because the
   * parent shares the same object references.
   */
  private setCategories(next: AdminCategory[]): void {
    this.categories = next;
    this.categoriesChange.emit(next);
  }

  startCategoryWizard(): void {
    this.categoryWizardOpen.set(true);
    this.categoryWizardStep.set(0);
    this.categoryWizardSlug.set(null);
  }

  exitCategoryWizard(): void {
    this.categoryWizardOpen.set(false);
    this.categoryWizardStep.set(0);
    this.categoryWizardSlug.set(null);
  }

  categoryWizardDescriptionKey(): string {
    return (
      this.categoryWizardSteps[this.categoryWizardStep()]?.descriptionKey ??
      'adminUi.categories.wizard.desc.basics'
    );
  }

  categoryWizardNextLabelKey(): string {
    return this.categoryWizardStep() >= this.categoryWizardSteps.length - 1
      ? 'adminUi.actions.done'
      : 'adminUi.actions.next';
  }

  categoryWizardCanNext(): boolean {
    if (!this.categoryWizardOpen()) return false;
    if (this.categoryWizardStep() >= this.categoryWizardSteps.length - 1) return true;
    return Boolean(this.categoryWizardSlug());
  }

  categoryWizardPrev(): void {
    const next = this.categoryWizardStep() - 1;
    if (next < 0) return;
    this.categoryWizardStep.set(next);
  }

  categoryWizardNext(): void {
    if (!this.categoryWizardOpen()) return;
    if (this.categoryWizardStep() >= this.categoryWizardSteps.length - 1) {
      this.exitCategoryWizard();
      return;
    }
    if (!this.categoryWizardCanNext()) {
      this.toast.error(this.t('adminUi.categories.wizard.addFirst'));
      return;
    }
    this.categoryWizardStep.set(this.categoryWizardStep() + 1);
    if (this.categoryWizardStep() === 1) {
      this.openCategoryWizardTranslations();
    }
  }

  goToCategoryWizardStep(index: number): void {
    if (!this.categoryWizardOpen()) return;
    if (index < 0 || index >= this.categoryWizardSteps.length) return;
    if (index > 0 && !this.categoryWizardSlug()) {
      this.toast.error(this.t('adminUi.categories.wizard.addFirst'));
      this.categoryWizardStep.set(0);
      return;
    }
    this.categoryWizardStep.set(index);
    if (index === 1) {
      this.openCategoryWizardTranslations();
    }
  }

  openCategoryWizardTranslations(): void {
    const slug = this.categoryWizardSlug();
    if (!slug) return;
    if (this.categoryTranslationsSlug !== slug) {
      this.categoryTranslationsSlug = slug;
      this.loadCategoryTranslations(slug);
    }
  }

  addCategory(): void {
    if (!this.categoryName) {
      this.toast.error(this.t('adminUi.categories.errors.required'));
      return;
    }
    const parent_id = (this.categoryParentId || '').trim() || null;
    this.admin.createCategory({ name: this.categoryName, parent_id }).subscribe({
      next: (cat) => {
        this.setCategories([cat, ...this.categories]);
        this.categoryName = '';
        this.categoryParentId = '';
        this.toast.success(this.t('adminUi.categories.success.add'));
        if (this.categoryWizardOpen() && this.categoryWizardStep() === 0) {
          const slug = typeof cat?.slug === 'string' ? cat.slug : '';
          if (slug) {
            this.categoryWizardSlug.set(slug);
            this.categoryWizardStep.set(1);
            this.openCategoryWizardTranslations();
          }
        }
      },
      error: () => this.toast.error(this.t('adminUi.categories.errors.add')),
    });
  }

  categoryParentLabel(cat: AdminCategory): string {
    const parentId = (cat.parent_id ?? '').trim();
    if (!parentId) return this.t('adminUi.categories.parentNone');
    return (
      this.categories.find((c) => c.id === parentId)?.name ??
      this.t('adminUi.categories.parentNone')
    );
  }

  categoryParentOptions(cat: AdminCategory): AdminCategory[] {
    const currentId = cat.id;
    const excluded = this.categoryDescendantIds(currentId);
    excluded.add(currentId);
    return this.categories
      .filter((candidate) => !excluded.has(candidate.id))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }

  private categoryDescendantIds(rootId: string): Set<string> {
    const childrenByParent = new Map<string, string[]>();
    for (const cat of this.categories) {
      const parentId = (cat.parent_id ?? '').trim();
      if (!parentId) continue;
      const bucket = childrenByParent.get(parentId);
      if (bucket) {
        bucket.push(cat.id);
      } else {
        childrenByParent.set(parentId, [cat.id]);
      }
    }
    const resolved = new Set<string>();
    const stack = [...(childrenByParent.get(rootId) ?? [])];
    while (stack.length) {
      const next = stack.pop()!;
      if (resolved.has(next)) continue;
      resolved.add(next);
      const kids = childrenByParent.get(next);
      if (kids?.length) stack.push(...kids);
    }
    return resolved;
  }

  updateCategoryParent(cat: AdminCategory, raw: string): void {
    const nextParentId = (raw ?? '').trim() || null;
    const prevParentId = (cat.parent_id ?? '').trim() || null;
    if (nextParentId === prevParentId) return;
    cat.parent_id = nextParentId;
    this.admin.updateCategory(cat.slug, { parent_id: nextParentId }).subscribe({
      next: (updated) => {
        cat.parent_id = updated.parent_id ?? null;
        this.toast.success(this.t('adminUi.categories.success.updateParent'));
      },
      error: () => {
        cat.parent_id = prevParentId;
        this.toast.error(this.t('adminUi.categories.errors.updateParent'));
      },
    });
  }

  updateCategoryLowStockThreshold(cat: AdminCategory, raw: string | number): void {
    const prevThreshold = cat.low_stock_threshold ?? null;
    const trimmed = String(raw ?? '').trim();
    const nextThreshold = trimmed ? Number(trimmed) : null;
    if (nextThreshold !== null && (!Number.isFinite(nextThreshold) || nextThreshold < 0)) {
      cat.low_stock_threshold = prevThreshold;
      this.toast.error(this.t('adminUi.categories.errors.updateLowStockThreshold'));
      return;
    }
    if (nextThreshold === prevThreshold) return;
    cat.low_stock_threshold = nextThreshold;
    this.admin.updateCategory(cat.slug, { low_stock_threshold: nextThreshold }).subscribe({
      next: (updated) => {
        cat.low_stock_threshold = updated.low_stock_threshold ?? null;
        this.toast.success(this.t('adminUi.categories.success.updateLowStockThreshold'));
      },
      error: () => {
        cat.low_stock_threshold = prevThreshold;
        this.toast.error(this.t('adminUi.categories.errors.updateLowStockThreshold'));
      },
    });
  }

  updateCategoryTaxGroup(cat: AdminCategory, raw: string): void {
    const nextGroupId = (raw ?? '').trim() || null;
    const prevGroupId = (cat.tax_group_id ?? '').trim() || null;
    if (nextGroupId === prevGroupId) return;
    cat.tax_group_id = nextGroupId;
    this.admin.updateCategory(cat.slug, { tax_group_id: nextGroupId }).subscribe({
      next: (updated) => {
        cat.tax_group_id = updated.tax_group_id ?? null;
        this.toast.success(this.t('adminUi.taxes.success.categoryAssign'));
      },
      error: () => {
        cat.tax_group_id = prevGroupId;
        this.toast.error(this.t('adminUi.taxes.errors.categoryAssign'));
      },
    });
  }

  openCategoryDeleteConfirm(cat: AdminCategory): void {
    this.categoryDeleteConfirmTarget.set(cat);
    this.categoryDeleteConfirmBusy.set(false);
    this.categoryDeleteConfirmOpen.set(true);
  }

  closeCategoryDeleteConfirm(): void {
    this.categoryDeleteConfirmOpen.set(false);
    this.categoryDeleteConfirmBusy.set(false);
    this.categoryDeleteConfirmTarget.set(null);
  }

  confirmDeleteCategory(): void {
    const target = this.categoryDeleteConfirmTarget();
    if (!target) return;
    if (this.categoryDeleteConfirmBusy()) return;
    this.categoryDeleteConfirmBusy.set(true);
    this.deleteCategory(target.slug, {
      done: (ok) => {
        this.categoryDeleteConfirmBusy.set(false);
        if (ok) this.closeCategoryDeleteConfirm();
      },
    });
  }

  deleteCategory(slug: string, opts?: { done?: (ok: boolean) => void }): void {
    this.admin.deleteCategory(slug).subscribe({
      next: () => {
        this.setCategories(this.categories.filter((c) => c.slug !== slug));
        if (this.categoryTranslationsSlug === slug) this.closeCategoryTranslations();
        this.toast.success(this.t('adminUi.categories.success.delete'));
        opts?.done?.(true);
      },
      error: () => {
        this.toast.error(this.t('adminUi.categories.errors.delete'));
        opts?.done?.(false);
      },
    });
  }

  toggleCategoryTranslations(slug: string): void {
    if (this.categoryTranslationsSlug === slug) {
      this.closeCategoryTranslations();
      return;
    }
    this.categoryTranslationsSlug = slug;
    this.loadCategoryTranslations(slug);
  }

  closeCategoryTranslations(): void {
    this.categoryTranslationsSlug = null;
    this.categoryTranslationsError.set(null);
    this.categoryTranslationExists = { en: false, ro: false };
    this.categoryTranslations = {
      en: this.blankCategoryTranslation(),
      ro: this.blankCategoryTranslation(),
    };
  }

  saveCategoryTranslation(lang: 'en' | 'ro'): void {
    const slug = this.categoryTranslationsSlug;
    if (!slug) return;
    this.categoryTranslationsError.set(null);

    const name = this.categoryTranslations[lang].name.trim();
    if (!name) {
      this.toast.error(this.t('adminUi.categories.translations.errors.nameRequired'));
      return;
    }

    const payload = {
      name,
      description: this.categoryTranslations[lang].description.trim()
        ? this.categoryTranslations[lang].description.trim()
        : null,
    };
    this.admin.upsertCategoryTranslation(slug, lang, payload).subscribe({
      next: (updated) => {
        this.categoryTranslationExists[lang] = true;
        this.categoryTranslations[lang] = {
          name: (updated.name || name).toString(),
          description: (updated.description || '').toString(),
        };
        this.toast.success(this.t('adminUi.categories.translations.success.save'));
      },
      error: () =>
        this.categoryTranslationsError.set(this.t('adminUi.categories.translations.errors.save')),
    });
  }

  deleteCategoryTranslation(lang: 'en' | 'ro'): void {
    const slug = this.categoryTranslationsSlug;
    if (!slug) return;
    this.categoryTranslationsError.set(null);
    this.admin.deleteCategoryTranslation(slug, lang).subscribe({
      next: () => {
        this.categoryTranslationExists[lang] = false;
        this.categoryTranslations[lang] = this.blankCategoryTranslation();
        this.toast.success(this.t('adminUi.categories.translations.success.delete'));
      },
      error: () =>
        this.categoryTranslationsError.set(this.t('adminUi.categories.translations.errors.delete')),
    });
  }

  private blankCategoryTranslation(): { name: string; description: string } {
    return { name: '', description: '' };
  }

  private loadCategoryTranslations(slug: string): void {
    this.categoryTranslationsError.set(null);
    this.admin.getCategoryTranslations(slug).subscribe({
      next: (items) => {
        const mapped: Record<'en' | 'ro', { name: string; description: string }> = {
          en: this.blankCategoryTranslation(),
          ro: this.blankCategoryTranslation(),
        };
        const exists: Record<'en' | 'ro', boolean> = { en: false, ro: false };
        for (const t of items || []) {
          if (t.lang !== 'en' && t.lang !== 'ro') continue;
          exists[t.lang] = true;
          mapped[t.lang] = {
            name: (t.name || '').toString(),
            description: (t.description || '').toString(),
          };
        }
        this.categoryTranslationExists = exists;
        this.categoryTranslations = mapped;
      },
      error: () =>
        this.categoryTranslationsError.set(this.t('adminUi.categories.translations.errors.load')),
    });
  }

  moveCategory(cat: AdminCategory, delta: number): void {
    const sorted = [...this.categories].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const index = sorted.findIndex((c) => c.slug === cat.slug);
    const swapIndex = index + delta;
    if (index < 0 || swapIndex < 0 || swapIndex >= sorted.length) return;
    const tmp = sorted[index].sort_order ?? 0;
    sorted[index].sort_order = sorted[swapIndex].sort_order ?? 0;
    sorted[swapIndex].sort_order = tmp;
    this.admin
      .reorderCategories(sorted.map((c) => ({ slug: c.slug, sort_order: c.sort_order ?? 0 })))
      .subscribe({
        next: (cats) => {
          this.setCategories(
            cats
              .map((c) => ({ ...c, sort_order: c.sort_order ?? 0 }))
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
          );
          this.toast.success(this.t('adminUi.categories.success.reorder'));
        },
        error: () => this.toast.error(this.t('adminUi.categories.errors.reorder')),
      });
  }

  onCategoryDragStart(slug: string): void {
    this.draggingSlug = slug;
  }

  onCategoryDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onCategoryDrop(targetSlug: string): void {
    if (!this.draggingSlug || this.draggingSlug === targetSlug) {
      this.draggingSlug = null;
      return;
    }
    const sorted = [...this.categories].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const fromIdx = sorted.findIndex((c) => c.slug === this.draggingSlug);
    const toIdx = sorted.findIndex((c) => c.slug === targetSlug);
    if (fromIdx === -1 || toIdx === -1) {
      this.draggingSlug = null;
      return;
    }
    const [moved] = sorted.splice(fromIdx, 1);
    sorted.splice(toIdx, 0, moved);
    sorted.forEach((c, idx) => (c.sort_order = idx));
    this.admin
      .reorderCategories(sorted.map((c) => ({ slug: c.slug, sort_order: c.sort_order ?? 0 })))
      .subscribe({
        next: (cats) => {
          this.setCategories(
            cats
              .map((c) => ({ ...c, sort_order: c.sort_order ?? 0 }))
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
          );
          this.toast.success(this.t('adminUi.categories.success.reorder'));
        },
        error: () => this.toast.error(this.t('adminUi.categories.errors.reorder')),
        complete: () => (this.draggingSlug = null),
      });
  }
}
