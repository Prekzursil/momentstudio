import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { ToastService } from '../../core/toast.service';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ContainerComponent,
    BreadcrumbComponent,
    ButtonComponent,
    LocalizedCurrencyPipe
  ],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div class="grid gap-6">
        <div
          *ngIf="!emailVerified()"
          class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm flex items-start justify-between gap-3"
        >
          <span>Verify your email to secure your account and receive updates.</span>
          <app-button size="sm" variant="ghost" label="Resend link" (action)="resendVerification()"></app-button>
        </div>
        <header class="flex items-center justify-between">
          <div>
            <p class="text-sm text-slate-500">Signed in as</p>
            <h1 class="text-2xl font-semibold text-slate-900">customer&#64;example.com</h1>
          </div>
          <app-button routerLink="/account/password" variant="ghost" label="Change password"></app-button>
        </header>

        <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900">Profile</h2>
            <app-button size="sm" variant="ghost" label="Save"></app-button>
          </div>
          <div class="flex items-center gap-4">
            <img [src]="avatar || placeholderAvatar" alt="avatar" class="h-16 w-16 rounded-full object-cover border" />
            <label class="text-sm text-indigo-600 font-medium cursor-pointer">
              Upload avatar
              <input type="file" class="hidden" accept="image/*" (change)="onAvatarChange($event)" />
            </label>
          </div>
          <p class="text-sm text-slate-700">Name: Jane Doe</p>
          <p class="text-sm text-slate-700">Email: customer&#64;example.com</p>
          <p class="text-sm text-slate-600">Session timeout: 30m. <a class="text-indigo-600" (click)="signOut()">Sign out</a></p>
        </section>

        <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900">Addresses</h2>
            <app-button size="sm" variant="ghost" label="Add address" (action)="addAddress()"></app-button>
          </div>
          <div *ngIf="addresses().length === 0" class="text-sm text-slate-700">No addresses yet.</div>
          <div *ngFor="let addr of addresses()" class="rounded-lg border border-slate-200 p-3 grid gap-1 text-sm text-slate-700">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-slate-900">{{ addr.name }}</span>
              <div class="flex gap-2">
                <app-button size="sm" variant="ghost" label="Edit" (action)="editAddress(addr.id)"></app-button>
                <app-button size="sm" variant="ghost" label="Remove" (action)="removeAddress(addr.id)"></app-button>
              </div>
            </div>
            <span>{{ addr.line1 }}</span>
            <span>{{ addr.city }}, {{ addr.postal }}</span>
            <span>{{ addr.country }}</span>
          </div>
        </section>

        <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900">Orders</h2>
            <a routerLink="/shop" class="text-sm text-indigo-600 font-medium">Shop new items</a>
          </div>
          <div class="flex items-center gap-3 text-sm">
            <label class="flex items-center gap-1">
              Status
              <select class="rounded-lg border border-slate-200 px-2 py-1" [(ngModel)]="orderFilter" (change)="filterOrders()">
                <option value="">All</option>
                <option value="processing">Processing</option>
                <option value="shipped">Shipped</option>
              </select>
            </label>
          </div>
          <div *ngIf="pagedOrders().length === 0" class="border border-dashed border-slate-200 rounded-xl p-4 text-sm text-slate-600">
            No orders yet.
          </div>
          <div *ngFor="let order of pagedOrders()" class="rounded-lg border border-slate-200 p-3 grid gap-1 text-sm text-slate-700">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-slate-900">Order #{{ order.id }}</span>
              <span class="text-xs rounded-full bg-slate-100 px-2 py-1">{{ order.status }}</span>
            </div>
            <span>{{ order.date }}</span>
            <span class="font-semibold text-slate-900">{{ order.total | localizedCurrency : 'USD' }}</span>
          </div>
          <div class="flex items-center justify-between text-sm" *ngIf="pagedOrders().length">
            <span>Page {{ page }} / {{ totalPages }}</span>
            <div class="flex gap-2">
              <app-button size="sm" variant="ghost" label="Prev" [disabled]="page === 1" (action)="prevPage()"></app-button>
              <app-button
                size="sm"
                variant="ghost"
                label="Next"
                [disabled]="page === totalPages"
                (action)="nextPage()"
              ></app-button>
            </div>
          </div>
        </section>

        <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900">Payment methods</h2>
            <app-button size="sm" variant="ghost" label="Add card" (action)="addCard()"></app-button>
          </div>
          <p class="text-sm text-slate-700">No cards saved. Add a placeholder card to store for faster checkout.</p>
        </section>

        <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 class="text-lg font-semibold text-slate-900">Session</h2>
          <p class="text-sm text-slate-700">
            You will be logged out after inactivity to keep your account safe. <a class="text-indigo-600" (click)="signOut()">Logout now</a>.
          </p>
          <div class="flex gap-2">
            <app-button size="sm" variant="ghost" label="Refresh session" (action)="refreshSession()"></app-button>
          </div>
        </section>
      </div>
    </app-container>
  `
})
export class AccountComponent {
  crumbs = [
    { label: 'Home', url: '/' },
    { label: 'Account' }
  ];

  emailVerified = signal<boolean>(false);
  addresses = signal([
    { id: '1', name: 'Home', line1: '123 Artisan Way', city: 'Cluj', postal: '400000', country: 'RO' }
  ]);
  avatar: string | null = null;
  placeholderAvatar = 'https://via.placeholder.com/120?text=Avatar';

  orders = signal([
    { id: '1001', status: 'processing', total: 120, date: '2025-11-01' },
    { id: '1000', status: 'shipped', total: 85, date: '2025-10-15' }
  ]);
  orderFilter = '';
  page = 1;
  pageSize = 5;
  totalPages = 1;

  constructor(private toast: ToastService, private api: ApiService) {
    this.computeTotalPages();
  }

  private filteredOrders() {
    const f = this.orderFilter;
    return this.orders().filter((o) => (f ? o.status === f : true));
  }

  pagedOrders = () => {
    const filtered = this.filteredOrders();
    this.computeTotalPages(filtered.length);
    const start = (this.page - 1) * this.pageSize;
    return filtered.slice(start, start + this.pageSize);
  };

  filterOrders(): void {
    this.page = 1;
  }

  nextPage(): void {
    if (this.page < this.totalPages) this.page += 1;
  }

  prevPage(): void {
    if (this.page > 1) this.page -= 1;
  }

  addAddress(): void {
    const next = [
      ...this.addresses(),
      { id: crypto.randomUUID(), name: 'New address', line1: 'Street 1', city: 'City', postal: '000000', country: 'RO' }
    ];
    this.addresses.set(next);
    this.toast.success('Address added (mock)');
  }

  editAddress(id: string): void {
    this.toast.success('Edit address (mock)', id);
  }

  removeAddress(id: string): void {
    this.addresses.update((addrs) => addrs.filter((a) => a.id !== id));
    this.toast.success('Address removed (mock)');
  }

  addCard(): void {
    this.toast.success('Card saved (placeholder)');
  }

  resendVerification(): void {
    this.toast.success('Verification email sent');
  }

  onAvatarChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    this.api.post<{ avatar_url?: string }>('/auth/me/avatar', formData).subscribe({
      next: (res) => {
        this.avatar = res.avatar_url || null;
        this.toast.success('Avatar updated');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not upload avatar.';
        this.toast.error(message);
      }
    });
  }

  refreshSession(): void {
    this.toast.success('Session refreshed');
  }

  signOut(): void {
    this.toast.success('Signed out (mock)');
  }

  private computeTotalPages(total?: number): void {
    const count = total ?? this.filteredOrders().length;
    this.totalPages = Math.max(1, Math.ceil(count / this.pageSize));
  }
}
