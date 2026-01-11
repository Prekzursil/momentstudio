import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { AdminProductListItem, AdminProductListResponse, AdminProductsService } from '../../../core/admin-products.service';
import { CatalogService, Category } from '../../../core/catalog.service';
import { LocalizedCurrencyPipe } from '../../../shared/localized-currency.pipe';
import { AdminService } from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';

type ProductStatusFilter = 'all' | 'draft' | 'published' | 'archived';

type ProductForm = {
  name: string;
  slug: string;
  category_id: string;
  base_price: number;
  stock_quantity: number;
  status: 'draft' | 'published' | 'archived';
  is_active: boolean;
  is_featured: boolean;
  sku: string;
  short_description: string;
  long_description: string;
  publish_at: string;
  is_bestseller: boolean;
  is_highlight: boolean;
};

@Component({
  selector: 'app-admin-products',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    BreadcrumbComponent,
    ButtonComponent,
    InputComponent,
    SkeletonComponent,
    LocalizedCurrencyPipe
  ],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div class="flex items-start justify-between gap-4">
        <div class="grid gap-1">
          <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.products.title' | translate }}</h1>
          <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.products.hint' | translate }}</p>
        </div>
        <app-button size="sm" [label]="'adminUi.products.new' | translate" (action)="startNew()"></app-button>
      </div>

      <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
        <div class="grid gap-3 lg:grid-cols-[1fr_240px_240px_auto] items-end">
          <app-input [label]="'adminUi.products.search' | translate" [(value)]="q"></app-input>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.products.table.status' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="status"
            >
              <option value="all">{{ 'adminUi.products.all' | translate }}</option>
              <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
              <option value="published">{{ 'adminUi.status.published' | translate }}</option>
              <option value="archived">{{ 'adminUi.status.archived' | translate }}</option>
            </select>
          </label>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.products.table.category' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="categorySlug"
            >
              <option value="">{{ 'adminUi.products.allCategories' | translate }}</option>
              <option *ngFor="let cat of categories()" [value]="cat.slug">{{ cat.name }}</option>
            </select>
          </label>

          <div class="flex items-center gap-2">
            <app-button size="sm" [label]="'adminUi.actions.refresh' | translate" (action)="applyFilters()"></app-button>
            <app-button size="sm" variant="ghost" [label]="'adminUi.actions.reset' | translate" (action)="resetFilters()"></app-button>
          </div>
        </div>

        <div *ngIf="error()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
          {{ error() }}
        </div>

        <div *ngIf="loading(); else tableTpl">
          <app-skeleton [rows]="8"></app-skeleton>
        </div>
        <ng-template #tableTpl>
          <div *ngIf="products().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'adminUi.products.empty' | translate }}
          </div>

          <div *ngIf="products().length > 0" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table class="min-w-[980px] w-full text-sm">
              <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                <tr>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.products.table.name' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.products.table.price' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.products.table.status' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.products.table.category' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.products.table.stock' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.products.table.active' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.products.table.updated' | translate }}</th>
                  <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.products.table.actions' | translate }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  *ngFor="let product of products()"
                  class="border-t border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                >
                  <td class="px-3 py-2 font-medium text-slate-900 dark:text-slate-50">
                    <div class="grid">
                      <span class="truncate">{{ product.name }}</span>
                      <span class="text-xs text-slate-500 dark:text-slate-400">{{ product.slug }} · {{ product.sku }}</span>
                    </div>
                  </td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                    {{ product.base_price | localizedCurrency : product.currency }}
                  </td>
                  <td class="px-3 py-2">
                    <span class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold" [ngClass]="statusPillClass(product.status)">
                      {{ ('adminUi.status.' + product.status) | translate }}
                    </span>
                  </td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                    {{ product.category_name }}
                  </td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                    {{ product.stock_quantity }}
                  </td>
                  <td class="px-3 py-2">
                    <span
                      class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold"
                      [ngClass]="product.is_active ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'"
                    >
                      {{ product.is_active ? ('adminUi.products.active' | translate) : ('adminUi.products.inactive' | translate) }}
                    </span>
                  </td>
                  <td class="px-3 py-2 text-slate-600 dark:text-slate-300">
                    {{ product.updated_at | date: 'short' }}
                  </td>
                  <td class="px-3 py-2 text-right">
                    <app-button size="sm" variant="ghost" [label]="'adminUi.products.edit' | translate" (action)="edit(product.slug)"></app-button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div *ngIf="meta()" class="flex items-center justify-between gap-3 pt-2 text-sm text-slate-700 dark:text-slate-200">
            <div>
              {{ 'adminUi.products.pagination' | translate: { page: meta()!.page, total_pages: meta()!.total_pages, total_items: meta()!.total_items } }}
            </div>
            <div class="flex items-center gap-2">
              <app-button size="sm" variant="ghost" [label]="'adminUi.products.prev' | translate" [disabled]="meta()!.page <= 1" (action)="goToPage(meta()!.page - 1)"></app-button>
              <app-button size="sm" variant="ghost" [label]="'adminUi.products.next' | translate" [disabled]="meta()!.page >= meta()!.total_pages" (action)="goToPage(meta()!.page + 1)"></app-button>
            </div>
          </div>
        </ng-template>
      </section>

      <section *ngIf="editorOpen()" class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
            {{ editingSlug() ? ('adminUi.products.edit' | translate) : ('adminUi.products.create' | translate) }}
          </h2>
          <app-button size="sm" variant="ghost" [label]="'adminUi.products.actions.cancel' | translate" (action)="closeEditor()"></app-button>
        </div>

        <div *ngIf="editorError()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
          {{ editorError() }}
        </div>

        <div class="grid gap-3 md:grid-cols-2">
          <app-input [label]="'adminUi.products.table.name' | translate" [(value)]="form.name"></app-input>
          <app-input [label]="'adminUi.products.form.slug' | translate" [(value)]="form.slug"></app-input>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.products.table.category' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="form.category_id"
            >
              <option value="" disabled>{{ 'adminUi.products.selectCategory' | translate }}</option>
              <option *ngFor="let cat of adminCategories()" [value]="cat.id">{{ cat.name }}</option>
            </select>
          </label>

          <app-input [label]="'adminUi.products.table.price' | translate" type="number" [(value)]="form.base_price"></app-input>
          <app-input [label]="'adminUi.products.table.stock' | translate" type="number" [(value)]="form.stock_quantity"></app-input>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.products.table.status' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="form.status"
            >
              <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
              <option value="published">{{ 'adminUi.status.published' | translate }}</option>
              <option value="archived">{{ 'adminUi.status.archived' | translate }}</option>
            </select>
          </label>

          <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 pt-6">
            <input type="checkbox" [(ngModel)]="form.is_active" />
            {{ 'adminUi.products.form.active' | translate }}
          </label>

          <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 pt-6">
            <input type="checkbox" [(ngModel)]="form.is_featured" />
            {{ 'adminUi.products.form.featured' | translate }}
          </label>

          <app-input [label]="'adminUi.products.form.sku' | translate" [(value)]="form.sku"></app-input>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.products.form.publishAt' | translate }}
            <input
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              type="datetime-local"
              [(ngModel)]="form.publish_at"
            />
          </label>

          <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" [(ngModel)]="form.is_bestseller" />
            {{ 'adminUi.products.form.bestseller' | translate }}
          </label>

          <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" [(ngModel)]="form.is_highlight" />
            {{ 'adminUi.products.form.highlight' | translate }}
          </label>
        </div>

        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'adminUi.products.form.shortDescription' | translate }}
          <textarea
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            rows="2"
            maxlength="280"
            [(ngModel)]="form.short_description"
          ></textarea>
          <span class="text-xs font-normal text-slate-500 dark:text-slate-400">
            {{ 'adminUi.products.form.shortDescriptionHint' | translate }}
          </span>
        </label>

        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'adminUi.products.form.description' | translate }}
          <textarea
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            rows="4"
            [(ngModel)]="form.long_description"
          ></textarea>
        </label>

        <div class="flex items-center gap-2">
          <app-button [label]="'adminUi.products.form.save' | translate" (action)="save()"></app-button>
          <span *ngIf="editorMessage()" class="text-sm text-emerald-700 dark:text-emerald-300">{{ editorMessage() }}</span>
        </div>

        <div class="grid gap-3">
          <div class="flex items-center justify-between">
            <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{{ 'adminUi.products.form.images' | translate }}</p>
            <label class="text-sm text-slate-700 dark:text-slate-200">
              {{ 'adminUi.products.form.upload' | translate }}
              <input type="file" accept="image/*" class="block mt-1" (change)="onUpload($event)" />
            </label>
          </div>

          <div *ngIf="images().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'adminUi.products.form.noImages' | translate }}
          </div>

          <div *ngIf="images().length > 0" class="grid gap-2">
            <div *ngFor="let img of images()" class="flex items-center gap-3 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              <img [src]="img.url" [alt]="img.alt_text || 'image'" class="h-12 w-12 rounded object-cover" />
              <div class="flex-1 min-w-0">
                <p class="font-semibold text-slate-900 dark:text-slate-50 truncate">{{ img.alt_text || ('adminUi.products.form.image' | translate) }}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ img.url }}</p>
              </div>
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.delete' | translate" (action)="deleteImage(img.id)"></app-button>
            </div>
          </div>
        </div>
      </section>
    </div>
  `
})
export class AdminProductsComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin', url: '/admin/dashboard' },
    { label: 'adminUi.products.title' }
  ];

  loading = signal(true);
  error = signal<string | null>(null);
  products = signal<AdminProductListItem[]>([]);
  meta = signal<AdminProductListResponse['meta'] | null>(null);
  categories = signal<Category[]>([]);

  q = '';
  status: ProductStatusFilter = 'all';
  categorySlug = '';
  page = 1;
  limit = 25;

  editorOpen = signal(false);
  editingSlug = signal<string | null>(null);
  editorError = signal<string | null>(null);
  editorMessage = signal<string | null>(null);
  images = signal<Array<{ id: string; url: string; alt_text?: string | null }>>([]);
  adminCategories = signal<Array<{ id: string; name: string }>>([]);

  form: ProductForm = this.blankForm();

  constructor(
    private productsApi: AdminProductsService,
    private catalog: CatalogService,
    private admin: AdminService,
    private toast: ToastService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.loadCategories();
    this.loadAdminCategories();
    this.load();
  }

  applyFilters(): void {
    this.page = 1;
    this.load();
  }

  resetFilters(): void {
    this.q = '';
    this.status = 'all';
    this.categorySlug = '';
    this.page = 1;
    this.load();
  }

  goToPage(page: number): void {
    this.page = page;
    this.load();
  }

  startNew(): void {
    this.editorOpen.set(true);
    this.editingSlug.set(null);
    this.editorError.set(null);
    this.editorMessage.set(null);
    this.images.set([]);
    this.form = this.blankForm();
    const first = this.adminCategories()[0];
    if (first) this.form.category_id = first.id;
  }

  closeEditor(): void {
    this.editorOpen.set(false);
    this.editingSlug.set(null);
    this.editorError.set(null);
    this.editorMessage.set(null);
    this.images.set([]);
  }

  edit(slug: string): void {
    this.editorOpen.set(true);
    this.editorError.set(null);
    this.editorMessage.set(null);
    this.editingSlug.set(slug);
    this.admin.getProduct(slug).subscribe({
      next: (prod: any) => {
        const basePrice = typeof prod.base_price === 'number' ? prod.base_price : Number(prod.base_price || 0);
        this.form = {
          name: prod.name || '',
          slug: prod.slug || slug,
          category_id: prod.category_id || '',
          base_price: Number.isFinite(basePrice) ? basePrice : 0,
          stock_quantity: Number(prod.stock_quantity || 0),
          status: (prod.status as any) || 'draft',
          is_active: prod.is_active !== false,
          is_featured: !!prod.is_featured,
          sku: (prod.sku || '').toString(),
          short_description: (prod.short_description || '').toString(),
          long_description: (prod.long_description || '').toString(),
          publish_at: prod.publish_at ? this.toLocalDateTime(prod.publish_at) : '',
          is_bestseller: Array.isArray(prod.tags) ? prod.tags.includes('bestseller') : false,
          is_highlight: Array.isArray(prod.tags) ? prod.tags.includes('highlight') : false
        };
        this.images.set(Array.isArray(prod.images) ? prod.images : []);
      },
      error: () => this.editorError.set(this.t('adminUi.products.errors.load'))
    });
  }

  save(): void {
    const payload: any = {
      name: this.form.name,
      slug: this.form.slug,
      category_id: this.form.category_id,
      base_price: Number(this.form.base_price),
      stock_quantity: Number(this.form.stock_quantity),
      status: this.form.status,
      is_active: this.form.is_active,
      is_featured: this.form.is_featured,
      sku: this.form.sku || null,
      long_description: this.form.long_description || null,
      short_description: this.form.short_description.trim() ? this.form.short_description.trim().slice(0, 280) : null,
      publish_at: this.form.publish_at ? new Date(this.form.publish_at).toISOString() : null,
      tags: this.buildTags()
    };

    const slug = this.editingSlug();
    const op = slug ? this.admin.updateProduct(slug, payload) : this.admin.createProduct(payload);
    op.subscribe({
      next: (prod: any) => {
        this.toast.success(this.t('adminUi.products.success.save'));
        this.editorMessage.set(this.t('adminUi.products.success.save'));
        const newSlug = (prod?.slug as string | undefined) || this.form.slug || slug || null;
        this.editingSlug.set(newSlug);
        this.images.set(Array.isArray(prod?.images) ? prod.images : this.images());
        this.load();
      },
      error: () => this.editorError.set(this.t('adminUi.products.errors.save'))
    });
  }

  onUpload(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const file = target?.files?.[0];
    if (!file) return;
    const slug = this.editingSlug();
    if (!slug) {
      this.toast.error(this.t('adminUi.products.errors.saveFirst'));
      return;
    }
    this.admin.uploadProductImage(slug, file).subscribe({
      next: (prod: any) => {
        this.toast.success(this.t('adminUi.products.success.imageUpload'));
        this.images.set(Array.isArray(prod.images) ? prod.images : []);
        if (target) target.value = '';
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.image'))
    });
  }

  deleteImage(imageId: string): void {
    const slug = this.editingSlug();
    if (!slug) return;
    this.admin.deleteProductImage(slug, imageId).subscribe({
      next: (prod: any) => {
        this.toast.success(this.t('adminUi.products.success.imageDelete'));
        this.images.set(Array.isArray(prod.images) ? prod.images : []);
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.deleteImage'))
    });
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.productsApi
      .search({
        q: this.q.trim() ? this.q.trim() : undefined,
        status: this.status === 'all' ? undefined : this.status,
        category_slug: this.categorySlug || undefined,
        page: this.page,
        limit: this.limit
      })
      .subscribe({
        next: (res) => {
          this.products.set(res.items || []);
          this.meta.set(res.meta || null);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(this.t('adminUi.products.errors.loadList'));
          this.loading.set(false);
        }
      });
  }

  private loadCategories(): void {
    this.catalog.listCategories().subscribe({
      next: (cats) => this.categories.set(cats || []),
      error: () => this.categories.set([])
    });
  }

  private loadAdminCategories(): void {
    this.admin.getCategories().subscribe({
      next: (cats: any[]) => {
        const mapped = (cats || []).map((c) => ({ id: c.id, name: c.name }));
        this.adminCategories.set(mapped);
      },
      error: () => this.adminCategories.set([])
    });
  }

  statusPillClass(status: string): string {
    if (status === 'published') return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100';
    if (status === 'archived') return 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100';
    return 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100';
  }

  private blankForm(): ProductForm {
    return {
      name: '',
      slug: '',
      category_id: '',
      base_price: 0,
      stock_quantity: 0,
      status: 'draft',
      is_active: true,
      is_featured: false,
      sku: '',
      short_description: '',
      long_description: '',
      publish_at: '',
      is_bestseller: false,
      is_highlight: false
    };
  }

  private buildTags(): string[] {
    const tags: string[] = [];
    if (this.form.is_bestseller) tags.push('bestseller');
    if (this.form.is_highlight) tags.push('highlight');
    return tags;
  }

  private toLocalDateTime(value: string): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private t(key: string): string {
    return this.translate.instant(key) as string;
  }
}
