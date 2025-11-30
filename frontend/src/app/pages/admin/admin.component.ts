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
                <app-button
                  size="sm"
                  variant="ghost"
                  label="Activate"
                  [disabled]="!selectedIds.size"
                  (action)="bulkUpdateStatus('active')"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  label="Archive"
                  [disabled]="!selectedIds.size"
                  (action)="bulkUpdateStatus('archived')"
                ></app-button>
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
                    <th></th>
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
              <h2 class="text-lg font-semibold text-slate-900">Product images</h2>
              <app-button size="sm" variant="ghost" label="Add image" (action)="addImage()"></app-button>
            </div>
            <div class="grid gap-2 text-sm text-slate-700">
              <div *ngFor="let img of productImages()" class="flex items-center gap-3 rounded-lg border border-slate-200 p-2">
                <img [src]="img.url" [alt]="img.alt" class="h-12 w-12 rounded object-cover" />
                <div class="flex-1">
                  <p class="font-semibold text-slate-900">{{ img.alt }}</p>
                  <p class="text-xs text-slate-500">Order: {{ img.order }}</p>
                </div>
                <div class="flex gap-2">
                  <app-button size="sm" variant="ghost" label="↑" (action)="moveImage(img.id, -1)"></app-button>
                  <app-button size="sm" variant="ghost" label="↓" (action)="moveImage(img.id, 1)"></app-button>
                  <app-button size="sm" variant="ghost" label="Delete" (action)="deleteImage(img.id)"></app-button>
                </div>
              </div>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Categories</h2>
              <app-button size="sm" variant="ghost" label="Add category" (action)="addCategory()"></app-button>
            </div>
            <div class="grid gap-2 text-sm text-slate-700">
              <div *ngFor="let cat of categories()" class="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <p class="font-semibold text-slate-900">{{ cat.name }}</p>
                  <p class="text-xs text-slate-500">Slug: {{ cat.slug }} · Order: {{ cat.order }}</p>
                </div>
                <div class="flex gap-2">
                  <app-button size="sm" variant="ghost" label="↑" (action)="moveCategory(cat.slug, -1)"></app-button>
                  <app-button size="sm" variant="ghost" label="↓" (action)="moveCategory(cat.slug, 1)"></app-button>
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
                  <option value="processing">Processing</option>
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
                  <p>{{ order.customer }} — {{ order.total | localizedCurrency : 'USD' }}</p>
                </div>
              </div>
              <div class="rounded-lg border border-slate-200 p-4 text-sm text-slate-700" *ngIf="activeOrder">
                <div class="flex items-center justify-between">
                  <h3 class="font-semibold text-slate-900">Order #{{ activeOrder.id }}</h3>
                  <select class="rounded-lg border border-slate-200 px-2 py-1 text-sm" [(ngModel)]="activeOrder.status">
                    <option value="processing">Processing</option>
                    <option value="shipped">Shipped</option>
                    <option value="refunded">Refunded</option>
                  </select>
                </div>
                <p class="text-xs text-slate-500">Customer: {{ activeOrder.customer }}</p>
                <p class="text-xs text-slate-500">Placed: {{ activeOrder.date }}</p>
                <p class="font-semibold text-slate-900 mt-2">{{ activeOrder.total | localizedCurrency : 'USD' }}</p>
                <div class="grid gap-1 mt-3">
                  <p class="text-xs uppercase tracking-[0.2em] text-slate-500">Timeline</p>
                  <ol class="grid gap-2">
                    <li *ngFor="let step of activeOrder.timeline" class="flex items-center gap-2">
                      <span
                        class="h-2 w-2 rounded-full"
                        [ngClass]="step.done ? 'bg-emerald-500' : 'bg-slate-300'"
                      ></span>
                      <span class="text-xs text-slate-700">{{ step.label }}</span>
                      <span class="text-[11px] text-slate-500" *ngIf="step.when">({{ step.when }})</span>
                    </li>
                  </ol>
                </div>
                <div class="flex gap-2 mt-3">
                  <app-button size="sm" label="Update status" (action)="updateOrderStatus()"></app-button>
                  <app-button size="sm" variant="ghost" label="Refund" (action)="refundOrder()"></app-button>
                </div>
              </div>
            </div>
          </section>

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Content editor</h2>
              <app-button size="sm" variant="ghost" label="Save" (action)="saveContent()"></app-button>
            </div>
            <label class="grid gap-1 text-sm font-medium text-slate-700">
              Homepage hero headline
              <input class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="homeHero.headline" />
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700">
              Hero subtext
              <textarea rows="2" class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="homeHero.subtext"></textarea>
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700">
              Hero image URL
              <input class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="homeHero.image" />
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700">
              Static page content
              <textarea rows="3" class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="aboutContent"></textarea>
            </label>
            <div class="rounded-lg border border-dashed border-slate-200 p-3 bg-slate-50">
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500">Preview</p>
              <h3 class="text-lg font-semibold text-slate-900">{{ homeHero.headline }}</h3>
              <p class="text-sm text-slate-700">{{ homeHero.subtext }}</p>
              <p class="text-xs text-slate-500">Image: {{ homeHero.image || 'not set' }}</p>
            </div>
            <p *ngIf="contentMessage" class="text-sm text-emerald-700">{{ contentMessage }}</p>
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

          <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Coupons</h2>
              <app-button size="sm" variant="ghost" label="Add coupon" (action)="addCoupon()"></app-button>
            </div>
            <div class="grid gap-2 text-sm text-slate-700">
              <div *ngFor="let coupon of coupons()" class="rounded-lg border border-slate-200 p-3 flex items-center justify-between">
                <div>
                  <p class="font-semibold text-slate-900">{{ coupon.code }} ({{ coupon.discount }}% off)</p>
                  <p class="text-xs text-slate-500">Active: {{ coupon.active ? 'Yes' : 'No' }}</p>
                </div>
                <div class="flex gap-2">
                  <app-button size="sm" variant="ghost" label="Toggle" (action)="toggleCoupon(coupon.code)"></app-button>
                  <app-button size="sm" variant="ghost" label="Delete" (action)="deleteCoupon(coupon.code)"></app-button>
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
    { id: '1001', customer: 'Jane', total: 120, status: 'processing', date: '2025-11-01' },
    { id: '1000', customer: 'Alex', total: 85, status: 'shipped', date: '2025-10-15' }
  ]);
  activeOrder: any = null;

  homeHero = { headline: 'Welcome to AdrianaArt!', subtext: 'Handmade collections updated weekly.', image: '' };
  aboutContent = 'Handmade ceramics for your home.';

  users = [
    { email: 'admin@adrianaart.com', role: 'admin' },
    { email: 'staff@adrianaart.com', role: 'staff' }
  ];
  coupons = signal([
    { code: 'SAVE10', discount: 10, active: true },
    { code: 'VIP20', discount: 20, active: false }
  ]);
  newCouponCode = '';
  newCouponDiscount = 5;

  productImages = signal([
    { id: 'img1', url: 'https://picsum.photos/seed/img1/120', alt: 'Front', order: 1 },
    { id: 'img2', url: 'https://picsum.photos/seed/img2/120', alt: 'Side', order: 2 }
  ]);

  categories = signal([
    { slug: 'cups', name: 'Cups', order: 1 },
    { slug: 'mugs', name: 'Mugs', order: 2 },
    { slug: 'bowls', name: 'Bowls', order: 3 }
  ]);

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
  contentMessage = '';
  selectedIds = new Set<string>();
  allSelected = false;

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

  selectOrder(order: any): void {
    this.activeOrder = { ...order };
  }

  updateOrderStatus(): void {
    if (!this.activeOrder) return;
    this.orders.update((orders) =>
      orders.map((o) => (o.id === this.activeOrder.id ? { ...o, status: this.activeOrder.status } : o))
    );
    this.formMessage = `Order #${this.activeOrder.id} status updated (mock).`;
  }

  refundOrder(): void {
    if (!this.activeOrder) return;
    this.activeOrder.status = 'refunded';
    this.updateOrderStatus();
    this.formMessage = `Order #${this.activeOrder.id} refunded (mock).`;
  }

  moveImage(id: string, delta: number): void {
    const imgs = [...this.productImages()];
    const idx = imgs.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const swapIdx = idx + delta;
    if (swapIdx < 0 || swapIdx >= imgs.length) return;
    [imgs[idx], imgs[swapIdx]] = [imgs[swapIdx], imgs[idx]];
    imgs.forEach((img, i) => (img.order = i + 1));
    this.productImages.set(imgs);
  }

  deleteImage(id: string): void {
    this.productImages.update((imgs) => imgs.filter((i) => i.id !== id));
  }

  addImage(): void {
    const next = {
      id: crypto.randomUUID(),
      url: `https://picsum.photos/seed/${Date.now()}/120`,
      alt: 'New image',
      order: this.productImages().length + 1
    };
    this.productImages.update((imgs) => [...imgs, next]);
  }

  moveCategory(slug: string, delta: number): void {
    const cats = [...this.categories()];
    const idx = cats.findIndex((c) => c.slug === slug);
    if (idx === -1) return;
    const swapIdx = idx + delta;
    if (swapIdx < 0 || swapIdx >= cats.length) return;
    [cats[idx], cats[swapIdx]] = [cats[swapIdx], cats[idx]];
    cats.forEach((c, i) => (c.order = i + 1));
    this.categories.set(cats);
  }

  addCategory(): void {
    const slug = `cat-${Date.now()}`;
    const next = { slug, name: 'New category', order: this.categories().length + 1 };
    this.categories.update((cats) => [...cats, next]);
  }

  deleteCategory(slug: string): void {
    this.categories.update((cats) => cats.filter((c) => c.slug !== slug));
  }

  addCoupon(): void {
    if (!this.newCouponCode.trim()) return;
    this.coupons.update((cs) => [...cs, { code: this.newCouponCode.toUpperCase(), discount: this.newCouponDiscount, active: true }]);
    this.newCouponCode = '';
    this.newCouponDiscount = 5;
  }

  toggleCoupon(code: string): void {
    this.coupons.update((cs) => cs.map((c) => (c.code === code ? { ...c, active: !c.active } : c)));
  }

  deleteCoupon(code: string): void {
    this.coupons.update((cs) => cs.filter((c) => c.code !== code));
  }

  toggleSelect(slug: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) this.selectedIds.add(slug);
    else this.selectedIds.delete(slug);
    this.allSelected = this.selectedIds.size === this.products().length;
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.allSelected = checked;
    this.selectedIds = checked ? new Set(this.products().map((p) => p.slug)) : new Set<string>();
  }

  bulkUpdateStatus(status: string): void {
    this.products.update((items) =>
      items.map((p) => (this.selectedIds.has(p.slug) ? { ...p, status } : p))
    );
    this.selectedIds.clear();
    this.allSelected = false;
    this.formMessage = `Updated ${status} for selected products (mock).`;
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

  saveContent(): void {
    this.contentMessage = 'Content saved (mock).';
  }
}
