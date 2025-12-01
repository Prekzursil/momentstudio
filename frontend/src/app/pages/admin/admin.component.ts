import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ContainerComponent } from '../../layout/container.component';
import { CardComponent } from '../../shared/card.component';
import { ButtonComponent } from '../../shared/button.component';
import { InputComponent } from '../../shared/input.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { SkeletonComponent } from '../../shared/skeleton.component';
import {
  AdminService,
  AdminSummary,
  AdminProduct,
  AdminOrder,
  AdminUser,
  AdminContent,
  AdminCoupon,
  AdminAudit,
  LowStockItem,
  AdminCategory,
  AdminProductDetail
} from '../../core/admin.service';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ContainerComponent,
    BreadcrumbComponent,
    CardComponent,
    ButtonComponent,
    InputComponent,
    LocalizedCurrencyPipe,
    SkeletonComponent
  ],
  template: `
    <app-container classes="py-8 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div *ngIf="error()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm">
        {{ error() }}
      </div>
      <div class="grid lg:grid-cols-[260px_1fr] gap-6">
        <aside class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-2 text-sm text-slate-700">
          <a class="font-semibold text-slate-900">Dashboard</a>
          <a class="hover:text-slate-900 text-slate-700">Products</a>
          <a class="hover:text-slate-900 text-slate-700">Orders</a>
          <a class="hover:text-slate-900 text-slate-700">Users</a>
          <a class="hover:text-slate-900 text-slate-700">Content</a>
        </aside>

        <div class="grid gap-6" *ngIf="!loading(); else loadingTpl">
          <section class="grid gap-3">
            <h1 class="text-2xl font-semibold text-slate-900">Admin dashboard</h1>
            <div class="grid md:grid-cols-3 gap-4">
              <app-card title="Products" [subtitle]="summary()?.products + ' total'"></app-card>
              <app-card title="Orders" [subtitle]="summary()?.orders + ' total'"></app-card>
              <app-card title="Users" [subtitle]="summary()?.users + ' total'"></app-card>
            </div>
            <div class="grid md:grid-cols-3 gap-4">
              <app-card title="Low stock" [subtitle]="summary()?.low_stock + ' items'"></app-card>
              <app-card title="Sales (30d)" [subtitle]="(summary()?.sales_30d || 0) | localizedCurrency : 'USD'"></app-card>
              <app-card title="Orders (30d)" [subtitle]="summary()?.orders_30d + ' orders'"></app-card>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Products</h2>
              <div class="flex gap-2">
                <app-button size="sm" label="New" (action)="startNewProduct()"></app-button>
                <app-button size="sm" variant="ghost" label="Delete" [disabled]="!selectedIds.size" (action)="deleteSelected()"></app-button>
              </div>
            </div>
            <div class="overflow-auto">
              <table class="min-w-full text-sm text-left">
                <thead>
                  <tr class="border-b border-slate-200">
                    <th class="py-2">
                      <input type="checkbox" [checked]="allSelected" (change)="toggleAll($event)" />
                    </th>
                    <th class="py-2">Name</th>
                    <th>Price</th>
                    <th>Status</th>
                    <th>Category</th>
                    <th>Stock</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let product of products" class="border-b border-slate-100">
                    <td class="py-2">
                      <input
                        type="checkbox"
                        [checked]="selectedIds.has(product.id)"
                        (change)="toggleSelect(product.id, $event)"
                      />
                    </td>
                    <td class="py-2 font-semibold text-slate-900">{{ product.name }}</td>
                    <td>{{ product.price | localizedCurrency : product.currency || 'USD' }}</td>
                    <td><span class="text-xs rounded-full bg-slate-100 px-2 py-1">{{ product.status }}</span></td>
                    <td>{{ product.category }}</td>
                    <td>{{ product.stock_quantity }}</td>
                    <td class="flex gap-2 py-2">
                      <app-button size="sm" variant="ghost" label="Edit" (action)="loadProduct(product.slug)"></app-button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">{{ editingId ? 'Edit product' : 'Create product' }}</h2>
              <app-button size="sm" variant="ghost" label="Reset" (action)="startNewProduct()"></app-button>
            </div>
            <div class="grid md:grid-cols-2 gap-3 text-sm">
              <app-input label="Name" [(value)]="form.name"></app-input>
              <app-input label="Slug" [(value)]="form.slug"></app-input>
              <label class="grid text-sm font-medium text-slate-700">
                Category
                <select class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="form.category_id">
                  <option *ngFor="let c of categories" [value]="c.id">{{ c.name }}</option>
                </select>
              </label>
              <app-input label="Price" type="number" [(value)]="form.price"></app-input>
              <app-input label="Stock" type="number" [(value)]="form.stock"></app-input>
              <label class="grid text-sm font-medium text-slate-700">
                Status
                <select class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="form.status">
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
              <app-input label="SKU" [(value)]="form.sku"></app-input>
              <app-input label="Image URL" [(value)]="form.image"></app-input>
            </div>
            <label class="grid gap-1 text-sm font-medium text-slate-700">
              Description
              <textarea rows="3" class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="form.description"></textarea>
            </label>
            <div class="flex gap-3">
              <app-button label="Save product" (action)="saveProduct()"></app-button>
              <label class="text-sm text-indigo-600 font-medium cursor-pointer">
                Upload image
                <input type="file" class="hidden" accept="image/*" (change)="onImageUpload($event)" />
              </label>
            </div>
            <div class="grid gap-2" *ngIf="productImages().length">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500">Images</p>
              <div *ngFor="let img of productImages()" class="flex items-center gap-3 rounded-lg border border-slate-200 p-2">
                <img [src]="img.url" [alt]="img.alt_text || 'image'" class="h-12 w-12 rounded object-cover" />
                <div class="flex-1">
                  <p class="font-semibold text-slate-900">{{ img.alt_text || 'Image' }}</p>
                </div>
                <app-button size="sm" variant="ghost" label="Delete" (action)="deleteImage(img.id)"></app-button>
              </div>
            </div>
            <p *ngIf="formMessage" class="text-sm text-emerald-700">{{ formMessage }}</p>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Categories</h2>
            </div>
            <div class="grid md:grid-cols-3 gap-2 items-end text-sm">
              <app-input label="Name" [(value)]="categoryName"></app-input>
              <app-input label="Slug" [(value)]="categorySlug"></app-input>
              <app-button size="sm" label="Add category" (action)="addCategory()"></app-button>
            </div>
            <div class="grid gap-2 text-sm text-slate-700">
              <div
                *ngFor="let cat of categories"
                class="flex items-center justify-between rounded-lg border border-slate-200 p-3"
                draggable="true"
                (dragstart)="onCategoryDragStart(cat.slug)"
                (dragover)="onCategoryDragOver($event)"
                (drop)="onCategoryDrop(cat.slug)"
              >
                <div>
                  <p class="font-semibold text-slate-900">{{ cat.name }}</p>
                  <p class="text-xs text-slate-500">Slug: {{ cat.slug }} · Order: {{ cat.sort_order }}</p>
                </div>
                <div class="flex gap-2">
                  <app-button size="sm" variant="ghost" label="↑" (action)="moveCategory(cat, -1)"></app-button>
                  <app-button size="sm" variant="ghost" label="↓" (action)="moveCategory(cat, 1)"></app-button>
                  <app-button size="sm" variant="ghost" label="Delete" (action)="deleteCategory(cat.slug)"></app-button>
                </div>
              </div>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Orders</h2>
              <label class="text-sm text-slate-700">
                Status
                <select class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="orderFilter">
                  <option value="">All</option>
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                  <option value="shipped">Shipped</option>
                  <option value="refunded">Refunded</option>
                </select>
              </label>
            </div>
            <div class="grid md:grid-cols-[1.5fr_1fr] gap-4">
              <div class="grid gap-2 text-sm text-slate-700">
                <div *ngFor="let order of filteredOrders()" class="rounded-lg border border-slate-200 p-3 cursor-pointer" (click)="selectOrder(order)">
                  <div class="flex items-center justify-between">
                    <span class="font-semibold text-slate-900">Order #{{ order.id }}</span>
                    <span class="text-xs rounded-full bg-slate-100 px-2 py-1">{{ order.status }}</span>
                  </div>
                  <p>{{ order.customer }} — {{ order.total_amount | localizedCurrency : order.currency || 'USD' }}</p>
                </div>
              </div>
              <div class="rounded-lg border border-slate-200 p-4 text-sm text-slate-700" *ngIf="activeOrder">
                <div class="flex items-center justify-between">
                  <h3 class="font-semibold text-slate-900">Order #{{ activeOrder.id }}</h3>
                  <select class="rounded-lg border border-slate-200 px-2 py-1 text-sm" [ngModel]="activeOrder.status" (ngModelChange)="changeOrderStatus($event)">
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                    <option value="shipped">Shipped</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="refunded">Refunded</option>
                  </select>
                </div>
                <p class="text-xs text-slate-500">Customer: {{ activeOrder.customer }}</p>
                <p class="text-xs text-slate-500">Placed: {{ activeOrder.created_at | date: 'medium' }}</p>
                <p class="font-semibold text-slate-900 mt-2">{{ activeOrder.total_amount | localizedCurrency : activeOrder.currency || 'USD' }}</p>
              </div>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Users</h2>
              <div class="flex gap-2">
                <app-button size="sm" variant="ghost" label="Set role" [disabled]="!selectedUserId || !selectedUserRole" (action)="updateRole()"></app-button>
                <app-button size="sm" variant="ghost" label="Force logout selected" [disabled]="!selectedUserId" (action)="forceLogout()"></app-button>
              </div>
            </div>
            <div class="grid gap-2 text-sm text-slate-700">
              <div *ngFor="let user of users" class="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <p class="font-semibold text-slate-900">{{ user.name || user.email }}</p>
                  <p class="text-xs text-slate-500">{{ user.email }}</p>
                </div>
                <div class="flex items-center gap-2 text-xs">
                  <input type="radio" name="userSelect" [value]="user.id" [(ngModel)]="selectedUserId" />
                  <select class="rounded border border-slate-200 px-2 py-1" [ngModel]="user.role" (ngModelChange)="selectUser(user.id, $event)">
                    <option value="customer">Customer</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Content</h2>
            </div>
            <div class="grid gap-2 text-sm text-slate-700">
              <div *ngFor="let c of contentBlocks" class="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <p class="font-semibold text-slate-900">{{ c.title }}</p>
                  <p class="text-xs text-slate-500">{{ c.key }}</p>
                </div>
                <span class="text-xs text-slate-500">v{{ c.version }}</span>
                <app-button size="sm" variant="ghost" label="Edit" (action)="selectContent(c)"></app-button>
              </div>
            </div>
            <div *ngIf="selectedContent" class="grid gap-2 pt-3 border-t border-slate-200">
              <p class="text-sm font-semibold text-slate-900">Editing: {{ selectedContent.key }}</p>
              <app-input label="Title" [(value)]="contentForm.title"></app-input>
              <label class="grid text-sm font-medium text-slate-700">
                Status
                <select class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="contentForm.status">
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </label>
              <label class="grid gap-1 text-sm font-medium text-slate-700">
                Body
                <textarea rows="4" class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="contentForm.body_markdown"></textarea>
              </label>
              <div class="flex gap-2">
                <app-button size="sm" label="Save content" (action)="saveContent()"></app-button>
                <app-button size="sm" variant="ghost" label="Cancel" (action)="cancelContent()"></app-button>
              </div>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Coupons</h2>
            </div>
            <div class="grid gap-2 text-sm text-slate-700">
              <div class="grid md:grid-cols-3 gap-2 items-end">
                <app-input label="Code" [(value)]="newCoupon.code"></app-input>
                <app-input label="% off" type="number" [(value)]="newCoupon.percentage_off"></app-input>
                <app-button size="sm" label="Add coupon" (action)="createCoupon()"></app-button>
              </div>
              <div *ngFor="let coupon of coupons" class="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <p class="font-semibold text-slate-900">{{ coupon.code }}</p>
                  <p class="text-xs text-slate-500">
                    <ng-container *ngIf="coupon.percentage_off">-{{ coupon.percentage_off }}%</ng-container>
                    <ng-container *ngIf="coupon.amount_off">-{{ coupon.amount_off | localizedCurrency : coupon.currency || 'USD' }}</ng-container>
                    <ng-container *ngIf="!coupon.percentage_off && !coupon.amount_off">No discount set</ng-container>
                  </p>
                </div>
                <button
                  type="button"
                  class="text-xs rounded-full px-2 py-1 border"
                  [class.bg-emerald-100]="coupon.active"
                  [class.text-emerald-800]="coupon.active"
                  (click)="toggleCoupon(coupon)"
                >
                  {{ coupon.active ? 'Active' : 'Inactive' }}
                </button>
              </div>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Audit log</h2>
              <app-button size="sm" variant="ghost" label="Refresh" (action)="loadAudit()"></app-button>
            </div>
            <div class="grid md:grid-cols-2 gap-4 text-sm text-slate-700">
              <div class="grid gap-2">
                <p class="text-xs uppercase tracking-[0.2em] text-slate-500">Product changes</p>
                <div *ngFor="let log of productAudit" class="rounded-lg border border-slate-200 p-3">
                  <p class="font-semibold text-slate-900">{{ log.action }}</p>
                  <p class="text-xs text-slate-500">Product ID: {{ log.product_id }}</p>
                  <p class="text-xs text-slate-500">At: {{ log.created_at | date: 'short' }}</p>
                </div>
              </div>
              <div class="grid gap-2">
                <p class="text-xs uppercase tracking-[0.2em] text-slate-500">Content changes</p>
                <div *ngFor="let log of contentAudit" class="rounded-lg border border-slate-200 p-3">
                  <p class="font-semibold text-slate-900">{{ log.action }}</p>
                  <p class="text-xs text-slate-500">Block ID: {{ log.block_id }}</p>
                  <p class="text-xs text-slate-500">At: {{ log.created_at | date: 'short' }}</p>
                </div>
              </div>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Maintenance & feeds</h2>
              <app-button size="sm" label="Save" (action)="saveMaintenance()"></app-button>
            </div>
            <div class="flex items-center gap-3 text-sm">
              <label class="flex items-center gap-2">
                <input type="checkbox" [(ngModel)]="maintenanceEnabledValue" /> Maintenance mode
              </label>
              <a class="text-indigo-600" href="/api/v1/sitemap.xml" target="_blank" rel="noopener">Sitemap</a>
              <a class="text-indigo-600" href="/api/v1/robots.txt" target="_blank" rel="noopener">Robots.txt</a>
              <a class="text-indigo-600" href="/api/v1/feeds/products.json" target="_blank" rel="noopener">Product feed</a>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Low stock</h2>
              <span class="text-xs text-slate-500">Below 5 units</span>
            </div>
            <div class="grid gap-2 text-sm text-slate-700">
              <div *ngFor="let item of lowStock" class="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <p class="font-semibold text-slate-900">{{ item.name }}</p>
                  <p class="text-xs text-slate-500">{{ item.sku }} — {{ item.slug }}</p>
                </div>
                <span class="text-xs rounded-full bg-amber-100 px-2 py-1 text-amber-900">Stock: {{ item.stock_quantity }}</span>
              </div>
            </div>
          </section>
        </div>
        <ng-template #loadingTpl>
          <div class="rounded-2xl border border-slate-200 bg-white p-4">
            <app-skeleton [rows]="6"></app-skeleton>
          </div>
        </ng-template>
      </div>
    </app-container>
  `
})
export class AdminComponent implements OnInit {
  crumbs = [
    { label: 'Home', url: '/' },
    { label: 'Admin' }
  ];

  summary = signal<AdminSummary | null>(null);
  loading = signal<boolean>(true);
  error = signal<string | null>(null);

  products: AdminProduct[] = [];
  categories: AdminCategory[] = [];
  categoryName = '';
  categorySlug = '';
  maintenanceEnabledValue = false;
  maintenanceEnabled = signal<boolean>(false);
  draggingSlug: string | null = null;
  selectedIds = new Set<string>();
  allSelected = false;

  formMessage = '';
  editingId: string | null = null;
  productDetail: AdminProductDetail | null = null;
  productImages = signal<{ id: string; url: string; alt_text?: string | null }[]>([]);
  form = {
    name: '',
    slug: '',
    category_id: '',
    price: 0,
    stock: 0,
    status: 'draft',
    sku: '',
    image: '',
    description: ''
  };

  orders: AdminOrder[] = [];
  activeOrder: AdminOrder | null = null;
  orderFilter = '';

  users: AdminUser[] = [];
  selectedUserId: string | null = null;
  selectedUserRole: string | null = null;

  contentBlocks: AdminContent[] = [];
  selectedContent: AdminContent | null = null;
  contentForm = {
    title: '',
    body_markdown: '',
    status: 'draft'
  };
  coupons: AdminCoupon[] = [];
  newCoupon: Partial<AdminCoupon> = { code: '', percentage_off: 0, active: true, currency: 'USD' };

  productAudit: AdminAudit['products'] = [];
  contentAudit: AdminAudit['content'] = [];
  lowStock: LowStockItem[] = [];

  constructor(private admin: AdminService, private toast: ToastService) {}

  ngOnInit(): void {
    this.loadAll();
  }

  loadAll(): void {
    this.loading.set(true);
    this.error.set(null);
    this.admin.summary().subscribe({ next: (s) => this.summary.set(s) });
    this.admin.products().subscribe({ next: (p) => (this.products = p) });
    this.admin.orders().subscribe({
      next: (o) => {
        this.orders = o;
        this.activeOrder = o[0] || null;
      }
    });
    this.admin.users().subscribe({ next: (u) => (this.users = u) });
    this.admin.content().subscribe({ next: (c) => (this.contentBlocks = c) });
    this.admin.coupons().subscribe({ next: (c) => (this.coupons = c) });
    this.admin.lowStock().subscribe({ next: (items) => (this.lowStock = items) });
    this.admin.audit().subscribe({
      next: (logs) => {
        this.productAudit = logs.products;
        this.contentAudit = logs.content;
      }
    });
    this.admin.getCategories().subscribe({ next: (cats) => (this.categories = cats) });
    this.admin.getMaintenance().subscribe({ next: (m) => this.maintenanceEnabled.set(m.enabled) });
    this.loading.set(false);
  }

  startNewProduct(): void {
    this.editingId = null;
    this.productDetail = null;
    this.productImages.set([]);
    this.form = {
      name: '',
      slug: '',
      category_id: this.categories[0]?.id || '',
      price: 0,
      stock: 0,
      status: 'draft',
      sku: '',
      image: '',
      description: ''
    };
  }

  loadProduct(slug: string): void {
    this.admin.getProduct(slug).subscribe({
      next: (prod) => {
        this.productDetail = prod;
        this.editingId = prod.slug;
        this.form = {
          name: prod.name,
          slug: prod.slug,
          category_id: prod.category_id || '',
          price: prod.price,
          stock: prod.stock_quantity,
          status: prod.status,
          sku: (prod as any).sku || '',
          image: '',
          description: prod.long_description || ''
        };
        this.productImages.set((prod as any).images || []);
      },
      error: () => this.toast.error('Unable to load product')
    });
  }

  saveProduct(): void {
    const payload: Partial<AdminProductDetail> = {
      name: this.form.name,
      slug: this.form.slug,
      category_id: this.form.category_id,
      base_price: this.form.price,
      stock_quantity: this.form.stock,
      status: this.form.status as any,
      short_description: this.form.description,
      long_description: this.form.description,
      sku: this.form.sku
    } as any;
    const op = this.editingId
      ? this.admin.updateProduct(this.editingId, payload)
      : this.admin.createProduct(payload);
    op.subscribe({
      next: () => {
        this.toast.success('Product saved');
        this.loadAll();
        this.startNewProduct();
      },
      error: () => this.toast.error('Failed to save product')
    });
  }

  deleteSelected(): void {
    if (!this.selectedIds.size) return;
    const ids = Array.from(this.selectedIds);
    const target = this.products.find((p) => p.id === ids[0]);
    if (!target) return;
    this.admin.deleteProduct(target.slug).subscribe({
      next: () => {
        this.toast.success('Product deleted');
        this.products = this.products.filter((p) => !this.selectedIds.has(p.id));
        this.selectedIds.clear();
        this.computeAllSelected();
      },
      error: () => this.toast.error('Failed to delete product')
    });
  }

  addCategory(): void {
    if (!this.categoryName || !this.categorySlug) {
      this.toast.error('Category name and slug are required');
      return;
    }
    this.admin.createCategory({ name: this.categoryName, slug: this.categorySlug }).subscribe({
      next: (cat) => {
        this.categories = [cat, ...this.categories];
        this.categoryName = '';
        this.categorySlug = '';
        this.toast.success('Category added');
      },
      error: () => this.toast.error('Failed to add category')
    });
  }

  deleteCategory(slug: string): void {
    this.admin.deleteCategory(slug).subscribe({
      next: () => {
        this.categories = this.categories.filter((c) => c.slug !== slug);
        this.toast.success('Category deleted');
      },
      error: () => this.toast.error('Failed to delete category')
    });
  }

  onImageUpload(event: Event): void {
    if (!this.editingId) {
      this.toast.error('Save product before uploading images');
      return;
    }
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.admin.uploadProductImage(this.editingId, file).subscribe({
      next: (prod) => {
        this.productImages.set((prod as any).images || []);
        this.toast.success('Image uploaded');
      },
      error: () => this.toast.error('Image upload failed')
    });
  }

  deleteImage(id: string): void {
    if (!this.editingId) return;
    this.admin.deleteProductImage(this.editingId, id).subscribe({
      next: (prod) => {
        this.productImages.set((prod as any).images || []);
        this.toast.success('Image deleted');
      },
      error: () => this.toast.error('Failed to delete image')
    });
  }

  selectOrder(order: AdminOrder): void {
    this.activeOrder = { ...order };
  }

  filteredOrders(): AdminOrder[] {
    return this.orders.filter((o) => (this.orderFilter ? o.status === this.orderFilter : true));
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.allSelected = checked;
    if (checked) this.selectedIds = new Set(this.products.map((p) => p.id));
    else this.selectedIds.clear();
  }

  toggleSelect(id: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) this.selectedIds.add(id);
    else this.selectedIds.delete(id);
    this.computeAllSelected();
  }

  computeAllSelected(): void {
    this.allSelected = this.selectedIds.size > 0 && this.selectedIds.size === this.products.length;
  }

  changeOrderStatus(status: string): void {
    if (!this.activeOrder) return;
    this.admin.updateOrderStatus(this.activeOrder.id, status).subscribe({
      next: (order) => {
        this.toast.success('Order status updated');
        this.activeOrder = order;
        this.orders = this.orders.map((o) => (o.id === order.id ? order : o));
      },
      error: () => this.toast.error('Failed to update order status')
    });
  }

  forceLogout(): void {
    if (!this.selectedUserId) return;
    this.admin.revokeSessions(this.selectedUserId).subscribe({
      next: () => this.toast.success('Sessions revoked'),
      error: () => this.toast.error('Failed to revoke sessions')
    });
  }

  selectUser(userId: string, role: string): void {
    this.selectedUserId = userId;
    this.selectedUserRole = role;
  }

  updateRole(): void {
    if (!this.selectedUserId || !this.selectedUserRole) return;
    this.admin.updateUserRole(this.selectedUserId, this.selectedUserRole).subscribe({
      next: (updated) => {
        this.users = this.users.map((u) => (u.id === updated.id ? updated : u));
        this.toast.success('Role updated');
      },
      error: () => this.toast.error('Failed to update role')
    });
  }

  moveCategory(cat: AdminCategory, delta: number): void {
    const sorted = [...this.categories].sort((a, b) => a.sort_order - b.sort_order);
    const index = sorted.findIndex((c) => c.slug === cat.slug);
    const swapIndex = index + delta;
    if (index < 0 || swapIndex < 0 || swapIndex >= sorted.length) return;
    const tmp = sorted[index].sort_order;
    sorted[index].sort_order = sorted[swapIndex].sort_order;
    sorted[swapIndex].sort_order = tmp;
    this.admin
      .reorderCategories(sorted.map((c) => ({ slug: c.slug, sort_order: c.sort_order })))
      .subscribe({
        next: (cats) => {
          this.categories = cats.sort((a, b) => a.sort_order - b.sort_order);
          this.toast.success('Category order saved');
        },
        error: () => this.toast.error('Failed to reorder categories')
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
    const sorted = [...this.categories].sort((a, b) => a.sort_order - b.sort_order);
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
      .reorderCategories(sorted.map((c) => ({ slug: c.slug, sort_order: c.sort_order })))
      .subscribe({
        next: (cats) => {
          this.categories = cats.sort((a, b) => a.sort_order - b.sort_order);
          this.toast.success('Category order saved');
        },
        error: () => this.toast.error('Failed to reorder categories'),
        complete: () => (this.draggingSlug = null)
      });
  }

  createCoupon(): void {
    if (!this.newCoupon.code) {
      this.toast.error('Coupon code is required');
      return;
    }
    this.admin.createCoupon(this.newCoupon).subscribe({
      next: (c) => {
        this.coupons = [c, ...this.coupons];
        this.toast.success('Coupon created');
      },
      error: () => this.toast.error('Failed to create coupon')
    });
  }

  toggleCoupon(coupon: AdminCoupon): void {
    this.admin.updateCoupon(coupon.id, { active: !coupon.active }).subscribe({
      next: (c) => {
        this.coupons = this.coupons.map((x) => (x.id === c.id ? c : x));
        this.toast.success('Coupon updated');
      },
      error: () => this.toast.error('Failed to update coupon')
    });
  }

  selectContent(content: AdminContent): void {
    this.selectedContent = content;
    this.contentForm = {
      title: content.title,
      body_markdown: content.body_markdown || '',
      status: content.status || 'draft'
    };
  }

  saveContent(): void {
    if (!this.selectedContent) return;
    this.admin
      .updateContent(this.selectedContent.key, {
        title: this.contentForm.title,
        body_markdown: this.contentForm.body_markdown,
        status: this.contentForm.status as any
      })
      .subscribe({
        next: (updated) => {
          this.contentBlocks = this.contentBlocks.map((c) => (c.key === updated.key ? updated : c));
          this.toast.success('Content updated');
          this.selectedContent = null;
        },
        error: () => this.toast.error('Failed to update content')
      });
  }

  cancelContent(): void {
    this.selectedContent = null;
  }

  saveMaintenance(): void {
    this.admin.setMaintenance(this.maintenanceEnabledValue).subscribe({
      next: (res) => {
        this.maintenanceEnabled.set(res.enabled);
        this.maintenanceEnabledValue = res.enabled;
        this.toast.success('Maintenance mode updated');
      },
      error: () => this.toast.error('Failed to update maintenance mode')
    });
  }
}
