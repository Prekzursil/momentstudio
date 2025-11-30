import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { CardComponent } from '../../shared/card.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { InputComponent } from '../../shared/input.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import {
  AdminService,
  AdminSummary,
  AdminProduct,
  AdminOrder,
  AdminUser,
  AdminContent,
  AdminCoupon,
  AdminAudit,
  LowStockItem
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
    ButtonComponent,
    CardComponent,
    BreadcrumbComponent,
    SkeletonComponent,
    InputComponent,
    LocalizedCurrencyPipe
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
            <p class="text-sm text-slate-600">Protected route guarded by adminGuard.</p>
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
                <app-button size="sm" variant="ghost" label="Activate" [disabled]="!selectedIds.size" (action)="bulkUpdateStatus()"></app-button>
                <app-button size="sm" variant="ghost" label="Archive" [disabled]="!selectedIds.size" (action)="bulkUpdateStatus()"></app-button>
              </div>
            </div>
            <div class="flex flex-wrap gap-3 items-center text-sm">
              <app-input label="Search" [(value)]="productSearch"></app-input>
              <label class="grid text-sm font-medium text-slate-700">
                Sort
                <select class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="productSort">
                  <option value="name">Name</option>
                  <option value="price">Price</option>
                </select>
              </label>
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
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let product of filteredProducts()" class="border-b border-slate-100">
                    <td class="py-2">
                      <input
                        type="checkbox"
                        [checked]="selectedIds.has(product.slug)"
                        (change)="toggleSelect(product.slug, $event)"
                      />
                    </td>
                    <td class="py-2 font-semibold text-slate-900">{{ product.name }}</td>
                    <td>{{ product.price | localizedCurrency : product.currency || 'USD' }}</td>
                    <td><span class="text-xs rounded-full bg-slate-100 px-2 py-1">{{ product.status }}</span></td>
                    <td>{{ product.category }}</td>
                    <td>{{ product.stock_quantity }}</td>
                  </tr>
                </tbody>
              </table>
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
                  <span class="text-xs rounded-full bg-slate-100 px-2 py-1">{{ activeOrder.status }}</span>
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
              <app-button size="sm" variant="ghost" label="Force logout selected" [disabled]="!selectedUserId" (action)="forceLogout()"></app-button>
            </div>
            <div class="grid gap-2 text-sm text-slate-700">
              <div *ngFor="let user of users" class="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <p class="font-semibold text-slate-900">{{ user.name || user.email }}</p>
                  <p class="text-xs text-slate-500">{{ user.email }}</p>
                </div>
                <label class="flex items-center gap-2 text-xs">
                  <input type="radio" name="userSelect" [value]="user.id" [(ngModel)]="selectedUserId" /> Select
                </label>
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
              </div>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Coupons</h2>
            </div>
            <div class="grid gap-2 text-sm text-slate-700">
              <div *ngFor="let coupon of coupons" class="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <p class="font-semibold text-slate-900">{{ coupon.code }}</p>
                  <p class="text-xs text-slate-500">
                    <ng-container *ngIf="coupon.percentage_off">-{{ coupon.percentage_off }}%</ng-container>
                    <ng-container *ngIf="coupon.amount_off">-{{ coupon.amount_off | localizedCurrency : coupon.currency || 'USD' }}</ng-container>
                    <ng-container *ngIf="!coupon.percentage_off && !coupon.amount_off">No discount set</ng-container>
                  </p>
                </div>
                <span class="text-xs rounded-full px-2 py-1" [ngClass]="coupon.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'">
                  {{ coupon.active ? 'Active' : 'Inactive' }}
                </span>
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

  allSelected = false;
  productSearch = '';
  productSort = 'name';
  selectedIds = new Set<string>();
  products: AdminProduct[] = [];
  orders: AdminOrder[] = [];
  activeOrder: AdminOrder | null = null;
  orderFilter = '';
  users: AdminUser[] = [];
  selectedUserId: string | null = null;
  contentBlocks: AdminContent[] = [];
  coupons: AdminCoupon[] = [];
  productAudit: AdminAudit['products'] = [];
  contentAudit: AdminAudit['content'] = [];
  lowStock: LowStockItem[] = [];
  summary = signal<AdminSummary | null>(null);
  loading = signal<boolean>(true);
  error = signal<string | null>(null);

  constructor(private admin: AdminService, private toast: ToastService) {
    this.computeAllSelected();
  }

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
    this.loadAudit();
    this.admin.lowStock().subscribe({ next: (items) => (this.lowStock = items) });
    this.loading.set(false);
  }

  loadAudit(): void {
    this.admin.audit().subscribe({
      next: (logs) => {
        this.productAudit = logs.products;
        this.contentAudit = logs.content;
      },
      error: () => this.toast.error('Unable to load audit log right now.')
    });
  }

  filteredProducts(): AdminProduct[] {
    const q = this.productSearch.toLowerCase();
    let list = this.products;
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q));
    if (this.productSort === 'price') {
      list = [...list].sort((a, b) => a.price - b.price);
    } else {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }

  filteredOrders(): AdminOrder[] {
    return this.orders.filter((o) => (this.orderFilter ? o.status === this.orderFilter : true));
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.allSelected = checked;
    if (checked) this.selectedIds = new Set(this.products.map((p) => p.slug));
    else this.selectedIds.clear();
  }

  toggleSelect(slug: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) this.selectedIds.add(slug);
    else this.selectedIds.delete(slug);
    this.computeAllSelected();
  }

  computeAllSelected(): void {
    this.allSelected = this.selectedIds.size > 0 && this.selectedIds.size === this.products.length;
  }

  bulkUpdateStatus(): void {
    this.toast.info('Bulk update not wired to backend yet.');
  }

  selectOrder(order: AdminOrder): void {
    this.activeOrder = { ...order };
  }

  forceLogout(): void {
    if (!this.selectedUserId) return;
    this.admin.revokeSessions(this.selectedUserId).subscribe({
      next: () => this.toast.success('Sessions revoked'),
      error: () => this.toast.error('Failed to revoke sessions')
    });
  }
}
