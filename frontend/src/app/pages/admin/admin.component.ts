import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { CardComponent } from '../../shared/card.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { InputComponent } from '../../shared/input.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';

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
      <div class="grid lg:grid-cols-[260px_1fr] gap-6">
        <aside class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-2 text-sm text-slate-700">
          <a class="font-semibold text-slate-900">Dashboard</a>
          <a class="hover:text-slate-900 text-slate-700">Products</a>
          <a class="hover:text-slate-900 text-slate-700">Orders</a>
          <a class="hover:text-slate-900 text-slate-700">Users</a>
          <a class="hover:text-slate-900 text-slate-700">Content</a>
        </aside>

        <div class="grid gap-6">
          <section class="grid gap-3">
            <h1 class="text-2xl font-semibold text-slate-900">Admin dashboard</h1>
            <p class="text-sm text-slate-600">Protected route guarded by adminGuard.</p>
            <div class="grid md:grid-cols-3 gap-4">
              <app-card title="Products" subtitle="128 live"></app-card>
              <app-card title="Orders" subtitle="5 processing"></app-card>
              <app-card title="Users" subtitle="248 customers"></app-card>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Products</h2>
              <div class="flex gap-2">
                <app-button size="sm" variant="ghost" label="New product" (action)="startNewProduct()"></app-button>
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
                    <th class="py-2">Name</th>
                    <th>Price</th>
                    <th>Status</th>
                    <th>Category</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let product of filteredProducts()" class="border-b border-slate-100">
                    <td class="py-2 font-semibold text-slate-900">{{ product.name }}</td>
                    <td>{{ product.price | localizedCurrency : 'USD' }}</td>
                    <td><span class="text-xs rounded-full bg-slate-100 px-2 py-1">{{ product.status }}</span></td>
                    <td>{{ product.category }}</td>
                    <td class="flex gap-2 py-2">
                      <app-button size="sm" variant="ghost" label="Edit" (action)="editProduct(product)"></app-button>
                      <app-button size="sm" variant="ghost" label="Delete"></app-button>
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
              <app-input label="Category" [(value)]="form.category"></app-input>
              <app-input label="Price" type="number" [(value)]="form.price"></app-input>
              <app-input label="Stock" type="number" [(value)]="form.stock"></app-input>
              <label class="grid gap-1 text-sm font-medium text-slate-700">
                Status
                <select class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="form.status">
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
              <app-input label="Image URL" [(value)]="form.image"></app-input>
              <app-input label="Variants (comma separated)" [(value)]="form.variants"></app-input>
            </div>
            <label class="grid gap-1 text-sm font-medium text-slate-700">
              Description
              <textarea rows="3" class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="form.description"></textarea>
            </label>
            <div class="flex gap-3">
              <app-button label="Save product" (action)="saveProduct()"></app-button>
              <app-button variant="ghost" label="Preview" (action)="previewProduct()"></app-button>
            </div>
            <p *ngIf="formMessage" class="text-sm text-emerald-700">{{ formMessage }}</p>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Orders</h2>
              <label class="text-sm text-slate-700">
                Status
                <select class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="orderFilter">
                  <option value="">All</option>
                  <option value="processing">Processing</option>
                  <option value="shipped">Shipped</option>
                </select>
              </label>
            </div>
            <div class="grid gap-2 text-sm text-slate-700">
              <div *ngFor="let order of filteredOrders()" class="rounded-lg border border-slate-200 p-3">
                <div class="flex items-center justify-between">
                  <span class="font-semibold text-slate-900">Order #{{ order.id }}</span>
                  <span class="text-xs rounded-full bg-slate-100 px-2 py-1">{{ order.status }}</span>
                </div>
                <p>{{ order.customer }} — {{ order.total | localizedCurrency : 'USD' }}</p>
                <app-button size="sm" variant="ghost" label="View detail"></app-button>
              </div>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Content editor</h2>
              <app-button size="sm" variant="ghost" label="Save"></app-button>
            </div>
            <label class="grid gap-1 text-sm font-medium text-slate-700">
              Homepage hero
              <textarea rows="3" class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="homeHero"></textarea>
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700">
              About page
              <textarea rows="3" class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="aboutContent"></textarea>
            </label>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Users</h2>
              <app-button size="sm" variant="ghost" label="Add admin"></app-button>
            </div>
            <div class="grid gap-2 text-sm text-slate-700">
              <div *ngFor="let user of users" class="rounded-lg border border-slate-200 p-3 flex items-center justify-between">
                <div>
                  <p class="font-semibold text-slate-900">{{ user.email }}</p>
                  <p class="text-xs text-slate-500">{{ user.role }}</p>
                </div>
                <div class="flex gap-2">
                  <app-button size="sm" variant="ghost" label="Promote"></app-button>
                  <app-button size="sm" variant="ghost" label="Demote"></app-button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </app-container>
  `
})
export class AdminComponent {
  crumbs = [
    { label: 'Home', url: '/' },
    { label: 'Admin' }
  ];

  productSearch = '';
  productSort: 'name' | 'price' = 'name';
  products = signal([
    { name: 'Ocean glaze cup', price: 28, status: 'active', category: 'Cups', slug: 'ocean-glaze-cup', stock: 5, description: 'Handmade cup', variants: ['Ivory'] },
    { name: 'Speckled mug', price: 24, status: 'draft', category: 'Mugs', slug: 'speckled-mug', stock: 3, description: 'Speckled mug', variants: ['Blue'] },
    { name: 'Matte bowl', price: 32, status: 'active', category: 'Bowls', slug: 'matte-bowl', stock: 8, description: 'Matte bowl', variants: ['Large'] }
  ]);

  orderFilter = '';
  orders = signal([
    { id: '1001', customer: 'Jane', total: 120, status: 'processing' },
    { id: '1000', customer: 'Alex', total: 85, status: 'shipped' }
  ]);

  homeHero = 'Welcome to AdrianaArt!';
  aboutContent = 'Handmade ceramics for your home.';

  users = [
    { email: 'admin@adrianaart.com', role: 'admin' },
    { email: 'staff@adrianaart.com', role: 'staff' }
  ];

  editingId: string | null = null;
  form = {
    name: '',
    slug: '',
    category: '',
    price: 0,
    stock: 0,
    status: 'draft',
    image: '',
    variants: '',
    description: ''
  };
  formMessage = '';

  filteredProducts() {
    const term = this.productSearch.toLowerCase();
    return this.products()
      .filter((p) => (term ? p.name.toLowerCase().includes(term) : true))
      .sort((a, b) => (this.productSort === 'name' ? a.name.localeCompare(b.name) : a.price - b.price));
  }

  filteredOrders() {
    const f = this.orderFilter;
    return this.orders().filter((o) => (f ? o.status === f : true));
  }

  startNewProduct(): void {
    this.editingId = null;
    this.form = {
      name: '',
      slug: '',
      category: '',
      price: 0,
      stock: 0,
      status: 'draft',
      image: '',
      variants: '',
      description: ''
    };
    this.formMessage = '';
  }

  editProduct(product: any): void {
    this.editingId = product.slug;
    this.form = {
      name: product.name,
      slug: product.slug,
      category: product.category ?? '',
      price: product.price,
      stock: product.stock ?? 0,
      status: product.status,
      image: product.image ?? '',
      variants: product.variants?.join(',') ?? '',
      description: product.description ?? ''
    };
    this.formMessage = `Editing ${product.name}`;
  }

  saveProduct(): void {
    if (!this.form.name || !this.form.slug || !this.form.category) {
      this.formMessage = 'Name, slug, and category are required.';
      return;
    }
    const variants = this.form.variants
      ? this.form.variants.split(',').map((v) => v.trim()).filter(Boolean)
      : [];
    if (this.editingId) {
      this.products.update((items) =>
        items.map((p) =>
          p.slug === this.editingId
            ? { ...p, ...this.form, variants, price: Number(this.form.price), stock: Number(this.form.stock) }
            : p
        )
      );
      this.formMessage = 'Product updated (mock).';
    } else {
      this.products.update((items) => [
        ...items,
        {
          ...this.form,
          price: Number(this.form.price),
          stock: Number(this.form.stock),
          variants
        }
      ]);
      this.formMessage = 'Product created (mock).';
    }
    this.editingId = this.form.slug;
  }

  previewProduct(): void {
    this.formMessage = 'Preview not implemented (placeholder).';
  }
}
