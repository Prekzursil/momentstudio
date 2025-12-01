import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { AccountService, Address, Order, AddressCreateRequest } from '../../core/account.service';
import { forkJoin } from 'rxjs';
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
      <ng-container *ngIf="!loading(); else loadingTpl">
        <div *ngIf="error()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm">
          {{ error() }}
        </div>
        <div class="grid gap-6" *ngIf="!error()">
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
            <h1 class="text-2xl font-semibold text-slate-900">{{ profile()?.email || '...' }}</h1>
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
          <p class="text-sm text-slate-700">Name: {{ profile()?.name || 'Not set' }}</p>
          <p class="text-sm text-slate-700">Email: {{ profile()?.email || '...' }}</p>
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
              <span class="font-semibold text-slate-900">{{ addr.label || 'Address' }}</span>
              <div class="flex items-center gap-2 text-xs">
                <span *ngIf="addr.is_default_shipping" class="rounded-full bg-slate-100 px-2 py-0.5">Default shipping</span>
                <span *ngIf="addr.is_default_billing" class="rounded-full bg-slate-100 px-2 py-0.5">Default billing</span>
              </div>
              <div class="flex gap-2">
                <app-button size="sm" variant="ghost" label="Edit" (action)="editAddress(addr.id)"></app-button>
                <app-button size="sm" variant="ghost" label="Remove" (action)="removeAddress(addr.id)"></app-button>
              </div>
            </div>
            <span>{{ addr.line1 }}<ng-container *ngIf="addr.line2">, {{ addr.line2 }}</ng-container></span>
            <span>{{ addr.city }}<ng-container *ngIf="addr.region">, {{ addr.region }}</ng-container>, {{ addr.postal_code }}</span>
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
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="shipped">Shipped</option>
                <option value="cancelled">Cancelled</option>
                <option value="refunded">Refunded</option>
              </select>
            </label>
          </div>
          <div *ngIf="pagedOrders().length === 0" class="border border-dashed border-slate-200 rounded-xl p-4 text-sm text-slate-600">
            No orders yet.
          </div>
          <div *ngFor="let order of pagedOrders()" class="rounded-lg border border-slate-200 p-3 grid gap-1 text-sm text-slate-700">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-slate-900">Order #{{ order.reference_code || order.id }}</span>
              <span class="text-xs rounded-full bg-slate-100 px-2 py-1">{{ order.status }}</span>
            </div>
            <span>{{ order.created_at | date: 'mediumDate' }}</span>
            <span class="font-semibold text-slate-900">{{ order.total_amount | localizedCurrency : order.currency || 'USD' }}</span>
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
      </ng-container>
      <ng-template #loadingTpl>
        <div class="text-sm text-slate-600">Loading your account...</div>
      </ng-template>
    </app-container>
  `
})
export class AccountComponent implements OnInit {
  crumbs = [
    { label: 'Home', url: '/' },
    { label: 'Account' }
  ];

  emailVerified = signal<boolean>(false);
  addresses = signal<Address[]>([]);
  avatar: string | null = null;
  placeholderAvatar = 'https://via.placeholder.com/120?text=Avatar';

  profile = signal<{ email: string; name?: string | null } | null>(null);
  orders = signal<Order[]>([]);
  orderFilter = '';
  page = 1;
  pageSize = 5;
  totalPages = 1;
  loading = signal<boolean>(true);
  error = signal<string | null>(null);

  constructor(
    private toast: ToastService,
    private auth: AuthService,
    private account: AccountService,
    private router: Router,
    private api: ApiService
  ) {
    this.computeTotalPages();
  }

  ngOnInit(): void {
    this.loadData();
  }

  private loadData(): void {
    this.loading.set(true);
    forkJoin({
      profile: this.account.getProfile(),
      addresses: this.account.getAddresses(),
      orders: this.account.getOrders()
    }).subscribe({
      next: ({ profile, addresses, orders }) => {
        this.profile.set(profile);
        this.addresses.set(addresses);
        this.orders.set(orders);
        this.computeTotalPages();
      },
      error: () => {
        this.error.set('Unable to load account details right now.');
      },
      complete: () => this.loading.set(false)
    });
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
    const payload = this.promptAddress();
    if (!payload) return;
    this.account.createAddress(payload).subscribe({
      next: (addr) => {
        this.toast.success('Address added');
        this.addresses.set([...this.addresses(), addr]);
      },
      error: (err) => this.toast.error(err?.error?.detail || 'Could not add address.')
    });
  }

  editAddress(id: string): void {
    const current = this.addresses().find((a) => a.id === id);
    const payload = this.promptAddress(current);
    if (!payload) return;
    this.account.updateAddress(id, payload).subscribe({
      next: (addr) => {
        this.toast.success('Address updated');
        this.addresses.set(this.addresses().map((a) => (a.id === id ? addr : a)));
      },
      error: (err) => this.toast.error(err?.error?.detail || 'Could not update address.')
    });
  }

  removeAddress(id: string): void {
    if (!confirm('Remove this address?')) return;
    this.account.deleteAddress(id).subscribe({
      next: () => {
        this.toast.success('Address removed');
        this.addresses.set(this.addresses().filter((a) => a.id !== id));
      },
      error: () => this.toast.error('Could not remove address.')
    });
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
    this.auth.refresh().subscribe({
      next: (tokens) => {
        if (tokens) {
          this.toast.success('Session refreshed');
        } else {
          this.toast.error('No refresh token available');
        }
      },
      error: () => this.toast.error('Could not refresh session.')
    });
  }

  signOut(): void {
    this.auth.logout().subscribe(() => {
      this.toast.success('Signed out');
      this.router.navigateByUrl('/');
    });
  }

  private computeTotalPages(total?: number): void {
    const count = total ?? this.filteredOrders().length;
    this.totalPages = Math.max(1, Math.ceil(count / this.pageSize));
  }

  private promptAddress(existing?: Address): AddressCreateRequest | null {
    const line1 = prompt('Address line 1', existing?.line1 || '');
    if (!line1) return null;
    const city = prompt('City', existing?.city || '');
    if (!city) return null;
    const country = prompt('Country code (e.g., US, RO)', existing?.country || 'US');
    if (!country) return null;
    const label = prompt('Label', existing?.label || 'Home') || undefined;
    const postal = prompt('Postal code', existing?.postal_code || '');
    if (!postal) return null;
    const region = prompt('Region/State', existing?.region || '') || undefined;
    const line2 = prompt('Address line 2', existing?.line2 || '') || undefined;
    return {
      label,
      line1,
      line2,
      city,
      region,
      postal_code: postal,
      country,
      is_default_shipping: existing?.is_default_shipping,
      is_default_billing: existing?.is_default_billing
    };
  }
}
