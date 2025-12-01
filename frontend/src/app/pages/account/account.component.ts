import { CommonModule } from '@angular/common';
import { Component, OnInit, AfterViewInit, OnDestroy, signal, ViewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { AddressFormComponent } from '../../shared/address-form.component';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { AccountService, Address, Order, AddressCreateRequest } from '../../core/account.service';
import { forkJoin } from 'rxjs';
import { loadStripe, Stripe, StripeElements, StripeCardElement, StripeCardElementChangeEvent } from '@stripe/stripe-js';
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
    LocalizedCurrencyPipe,
    AddressFormComponent
  ],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <ng-container *ngIf="!loading(); else loadingTpl">
        <div *ngIf="error()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm">
          {{ error() }}
        </div>
        <div class="grid gap-6" *ngIf="!error()">
        <div *ngIf="!emailVerified()" class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm grid gap-3">
          <div class="flex items-start justify-between gap-3">
            <span>Verify your email to secure your account and receive updates.</span>
            <app-button size="sm" variant="ghost" label="Resend link" (action)="resendVerification()"></app-button>
          </div>
          <form class="flex gap-2 items-center" (ngSubmit)="submitVerification()">
            <input
              [(ngModel)]="verificationToken"
              name="verificationToken"
              type="text"
              placeholder="Enter verification token"
              class="border border-amber-300 rounded-lg px-3 py-2 text-sm flex-1"
              required
            />
            <app-button size="sm" label="Confirm" type="submit"></app-button>
          </form>
          <p *ngIf="verificationStatus" class="text-xs text-amber-800">{{ verificationStatus }}</p>
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
            <app-button size="sm" variant="ghost" label="Add address" (action)="openAddressForm()"></app-button>
          </div>
          <div *ngIf="showAddressForm" class="rounded-lg border border-slate-200 p-3">
            <app-address-form
              [model]="addressModel"
              (save)="saveAddress($event)"
              (cancel)="closeAddressForm()"
            ></app-address-form>
          </div>
          <div *ngIf="addresses().length === 0 && !showAddressForm" class="text-sm text-slate-700">No addresses yet.</div>
          <div *ngFor="let addr of addresses()" class="rounded-lg border border-slate-200 p-3 grid gap-1 text-sm text-slate-700">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-slate-900">{{ addr.label || 'Address' }}</span>
              <div class="flex items-center gap-2 text-xs">
                <span *ngIf="addr.is_default_shipping" class="rounded-full bg-slate-100 px-2 py-0.5">Default shipping</span>
                <span *ngIf="addr.is_default_billing" class="rounded-full bg-slate-100 px-2 py-0.5">Default billing</span>
              </div>
              <div class="flex gap-2">
                <app-button size="sm" variant="ghost" label="Edit" (action)="editAddress(addr)"></app-button>
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
            <div class="flex gap-2 items-center">
              <app-button size="sm" variant="ghost" label="Add card" (action)="startAddCard()"></app-button>
              <app-button size="sm" label="Save card" (action)="confirmCard()" [disabled]="!cardReady || savingCard"></app-button>
            </div>
          </div>
          <div *ngIf="paymentMethods.length === 0" class="text-sm text-slate-700">No cards saved yet.</div>
          <div class="border border-dashed border-slate-200 rounded-lg p-3 text-sm" *ngIf="cardElementVisible">
            <p class="text-slate-600 mb-2">Enter card details:</p>
            <div #cardHost id="card-element" class="min-h-[48px]"></div>
            <p *ngIf="cardError" class="text-rose-700 text-xs mt-2">{{ cardError }}</p>
          </div>
          <div *ngFor="let pm of paymentMethods" class="flex items-center justify-between text-sm border border-slate-200 rounded-lg p-3">
            <div class="flex items-center gap-2">
              <span class="font-semibold">{{ pm.brand || 'Card' }}</span>
              <span *ngIf=\"pm.last4\">•••• {{ pm.last4 }}</span>
              <span *ngIf=\"pm.exp_month && pm.exp_year\">(exp {{ pm.exp_month }}/{{ pm.exp_year }})</span>
            </div>
            <app-button size=\"sm\" variant=\"ghost\" label=\"Remove\" (action)=\"removePaymentMethod(pm.id)\"></app-button>
          </div>
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
export class AccountComponent implements OnInit, AfterViewInit, OnDestroy {
  crumbs = [
    { label: 'Home', url: '/' },
    { label: 'Account' }
  ];

  emailVerified = signal<boolean>(false);
  addresses = signal<Address[]>([]);
  avatar: string | null = null;
  placeholderAvatar = 'https://via.placeholder.com/120?text=Avatar';
  verificationToken = '';
  verificationStatus: string | null = null;

  profile = signal<{ email: string; name?: string | null } | null>(null);
  orders = signal<Order[]>([]);
  orderFilter = '';
  page = 1;
  pageSize = 5;
  totalPages = 1;
  loading = signal<boolean>(true);
  error = signal<string | null>(null);

  paymentMethods: any[] = [];
  cardElementVisible = false;
  savingCard = false;
  cardReady = false;
  cardError: string | null = null;
  private stripe: Stripe | null = null;
  private elements?: StripeElements;
  private card?: StripeCardElement;
  private clientSecret: string | null = null;
  @ViewChild('cardHost') cardElementRef?: ElementRef<HTMLDivElement>;
  showAddressForm = false;
  editingAddressId: string | null = null;
  addressModel: AddressCreateRequest = {
    line1: '',
    city: '',
    postal_code: '',
    country: 'US'
  };
  private idleTimer?: any;
  idleWarning = signal<string | null>(null);

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
    this.loadPaymentMethods();
    this.resetIdleTimer();
    window.addEventListener('mousemove', this.resetIdleTimer.bind(this));
    window.addEventListener('keydown', this.resetIdleTimer.bind(this));
  }

  async ngAfterViewInit(): Promise<void> {
    await this.setupStripe();
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
        this.emailVerified.set(Boolean(profile?.email_verified));
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

  openAddressForm(existing?: Address): void {
    this.showAddressForm = true;
    this.editingAddressId = existing?.id ?? null;
    this.addressModel = {
      line1: existing?.line1 || '',
      line2: existing?.line2 || '',
      city: existing?.city || '',
      region: existing?.region || '',
      postal_code: existing?.postal_code || '',
      country: existing?.country || 'US',
      label: existing?.label || 'Home',
      is_default_shipping: existing?.is_default_shipping,
      is_default_billing: existing?.is_default_billing
    };
  }

  closeAddressForm(): void {
    this.showAddressForm = false;
    this.editingAddressId = null;
  }

  saveAddress(payload: AddressCreateRequest): void {
    if (this.editingAddressId) {
      this.account.updateAddress(this.editingAddressId, payload).subscribe({
        next: (addr) => {
          this.toast.success('Address updated');
          this.addresses.set(this.addresses().map((a) => (a.id === this.editingAddressId ? addr : a)));
          this.closeAddressForm();
        },
        error: (err) => this.toast.error(err?.error?.detail || 'Could not update address.')
      });
    } else {
      this.account.createAddress(payload).subscribe({
        next: (addr) => {
          this.toast.success('Address added');
          this.addresses.set([...this.addresses(), addr]);
          this.closeAddressForm();
        },
        error: (err) => this.toast.error(err?.error?.detail || 'Could not add address.')
      });
    }
  }

  editAddress(addr: Address): void {
    this.openAddressForm(addr);
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
    this.cardError = null;
    this.savingCard = false;
    this.cardElementVisible = true;
    this.createSetupIntent();
    setTimeout(() => this.mountCardElement(), 0);
  }

  resendVerification(): void {
    this.auth.requestEmailVerification().subscribe({
      next: () => {
        this.verificationStatus = 'Verification email sent. Enter the token you received.';
        this.toast.success('Verification email sent');
      },
      error: () => this.toast.error('Could not send verification email')
    });
  }

  submitVerification(): void {
    if (!this.verificationToken) {
      this.verificationStatus = 'Enter a verification token.';
      return;
    }
    this.auth.confirmEmailVerification(this.verificationToken).subscribe({
      next: (res) => {
        this.emailVerified.set(res.email_verified);
        this.verificationStatus = 'Email verified';
        this.toast.success('Email verified');
        this.verificationToken = '';
      },
      error: () => {
        this.verificationStatus = 'Invalid or expired token';
        this.toast.error('Invalid or expired token');
      }
    });
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
          this.resetIdleTimer();
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

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleWarning.set(null);
    this.idleTimer = setTimeout(() => {
      this.idleWarning.set('You have been logged out due to inactivity.');
      this.signOut();
    }, 30 * 60 * 1000); // 30 minutes
  }

  ngOnDestroy(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    if (this.card) {
      this.card.destroy();
    }
    window.removeEventListener('mousemove', this.resetIdleTimer.bind(this));
    window.removeEventListener('keydown', this.resetIdleTimer.bind(this));
  }

  private async setupStripe(): Promise<void> {
    if (this.stripe) return;
    const publishableKey = this.getStripePublishableKey();
    if (!publishableKey) {
      this.cardError = 'Stripe publishable key is not configured';
      return;
    }
    this.stripe = await loadStripe(publishableKey);
    if (!this.stripe) {
      this.cardError = 'Could not initialize Stripe.';
      return;
    }
    this.elements = this.stripe.elements();
    this.card = this.elements.create('card');
    this.mountCardElement();
  }

  private getStripePublishableKey(): string | null {
    const meta = document.querySelector('meta[name=\"stripe-publishable-key\"]');
    return meta?.getAttribute('content') || null;
  }

  private createSetupIntent(): void {
    this.api.post<{ client_secret: string; customer_id: string }>('/payment-methods/setup-intent', {}).subscribe({
      next: (res) => {
        this.clientSecret = res.client_secret;
      },
      error: () => {
        this.cardError = 'Could not start card setup';
        this.toast.error('Could not start card setup');
      }
    });
  }

  private mountCardElement(): void {
    if (!this.card || !this.cardElementRef) return;
    this.card.mount(this.cardElementRef.nativeElement);
    this.cardReady = true;
    this.card.on('change', (event: StripeCardElementChangeEvent) => {
      this.cardError = event.error ? event.error.message ?? 'Card error' : null;
    });
  }

  async confirmCard(): Promise<void> {
    if (!this.stripe || !this.card || !this.clientSecret) {
      this.cardError = 'Card form is not ready.';
      return;
    }
    this.savingCard = true;
    const result = await this.stripe.confirmCardSetup(this.clientSecret, {
      payment_method: { card: this.card }
    });
    if (result.error) {
      this.cardError = result.error.message ?? 'Could not save card';
      this.savingCard = false;
      return;
    }
    const pmId = result.setupIntent?.payment_method;
    if (!pmId) {
      this.cardError = 'Payment method missing from setup intent.';
      this.savingCard = false;
      return;
    }
    this.api.post('/payment-methods/attach', { payment_method_id: pmId }).subscribe({
      next: () => {
        this.toast.success('Card saved');
        this.loadPaymentMethods();
        this.cardError = null;
        this.clientSecret = null;
        this.savingCard = false;
      },
      error: () => {
        this.cardError = 'Could not attach payment method';
        this.savingCard = false;
      }
    });
  }

  private loadPaymentMethods(): void {
    this.api.get<any[]>('/payment-methods').subscribe({
      next: (methods) => (this.paymentMethods = methods),
      error: () => (this.paymentMethods = [])
    });
  }

  removePaymentMethod(id: string): void {
    if (!confirm('Remove this payment method?')) return;
    this.api.delete(`/payment-methods/${id}`).subscribe({
      next: () => {
        this.toast.success('Payment method removed');
        this.paymentMethods = this.paymentMethods.filter((pm) => pm.id !== id);
      },
      error: () => this.toast.error('Could not remove payment method')
    });
  }
}
