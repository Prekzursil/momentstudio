// Shared state + actions for the Account area.
//
// This was extracted from the previous monolithic Account component so that the
// new routed subpages can share behavior without bundling the legacy template.

import { AfterViewInit, Directive, ElementRef, effect, EffectRef, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import type { Stripe, StripeCardElement, StripeCardElementChangeEvent, StripeElements } from '@stripe/stripe-js';
import { forkJoin, map, of, switchMap } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { appConfig } from '../../core/app-config';
import { AuthService, AuthUser, SecondaryEmail, UserAliasesResponse } from '../../core/auth.service';
import {
  AccountDeletionStatus,
  AccountService,
  Address,
  AddressCreateRequest,
  Order,
  ReceiptShareToken
} from '../../core/account.service';
import { BlogMyComment, BlogService, PaginationMeta } from '../../core/blog.service';
import { CartStore } from '../../core/cart.store';
import { LanguageService } from '../../core/language.service';
import { ThemeMode, ThemePreference, ThemeService } from '../../core/theme.service';
import { ToastService } from '../../core/toast.service';
import { WishlistService } from '../../core/wishlist.service';
import { orderStatusChipClass } from '../../shared/order-status';
import { missingRequiredProfileFields as computeMissingRequiredProfileFields, type RequiredProfileField } from '../../shared/profile-requirements';
import { buildE164, listPhoneCountries, splitE164, type PhoneCountryOption } from '../../shared/phone';
import { formatIdentity } from '../../shared/user-identity';

import { type CountryCode } from 'libphonenumber-js';

@Directive()
export class AccountState implements OnInit, AfterViewInit, OnDestroy {
  emailVerified = signal<boolean>(false);
  addresses = signal<Address[]>([]);
  avatar: string | null = null;
  avatarBusy = false;
  placeholderAvatar = 'assets/placeholder/avatar-placeholder.svg';
  verificationToken = '';
  verificationStatus: string | null = null;

  profile = signal<AuthUser | null>(null);
  googleEmail = signal<string | null>(null);
  googlePicture = signal<string | null>(null);
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
  private cardElementRef?: ElementRef<HTMLDivElement>;
  private stripeThemeEffect?: EffectRef;
  private phoneCountriesEffect?: EffectRef;
  showAddressForm = false;
  editingAddressId: string | null = null;
  addressModel: AddressCreateRequest = {
    line1: '',
    city: '',
    postal_code: '',
    country: 'US'
  };
  private idleTimer?: any;
  private readonly handleUserActivity = () => this.resetIdleTimer();
  idleWarning = signal<string | null>(null);
  notifyBlogComments = false;
  notifyBlogCommentReplies = false;
  savingNotifications = false;
  notificationsMessage: string | null = null;
  notificationsError: string | null = null;
  notifyMarketing = false;
  showNotificationPreview = false;
  notificationLastUpdated: string | null = null;
  savingProfile = false;
  profileSaved = false;
  profileError: string | null = null;
  profileName = '';
  profileUsername = '';
  profileUsernamePassword = '';
  profileFirstName = '';
  profileMiddleName = '';
  profileLastName = '';
  profileDateOfBirth = '';
  profilePhone = '';
  profilePhoneCountry: CountryCode = 'RO';
  profilePhoneNational = '';
  phoneCountries: PhoneCountryOption[] = [];
  profileLanguage: 'en' | 'ro' = 'en';
  profileThemePreference: ThemePreference = 'system';
  reorderingOrderId: string | null = null;
  downloadingReceiptId: string | null = null;

  private forceProfileCompletion = false;

  googlePassword = '';
  googleBusy = false;
  googleError: string | null = null;

  emailChanging = false;
  emailChangeEmail = '';
  emailChangePassword = '';
  emailChangeError: string | null = null;
  emailChangeSuccess: string | null = null;

  secondaryEmails = signal<SecondaryEmail[]>([]);
  secondaryEmailsLoading = signal<boolean>(false);
  secondaryEmailsError = signal<string | null>(null);
  secondaryEmailToAdd = '';
  addingSecondaryEmail = false;
  secondaryEmailMessage: string | null = null;
  secondaryVerificationToken = '';
  secondaryVerificationStatus: string | null = null;
  verifyingSecondaryEmail = false;
  makePrimarySecondaryEmailId: string | null = null;
  makePrimaryPassword = '';
  makingPrimaryEmail = false;
  makePrimaryError: string | null = null;

  exportingData = false;
  exportError: string | null = null;

  deletionStatus = signal<AccountDeletionStatus | null>(null);
  deletionLoading = signal<boolean>(false);
  deletionError = signal<string | null>(null);
  deletionConfirmText = '';
  requestingDeletion = false;
  cancellingDeletion = false;

  myComments = signal<BlogMyComment[]>([]);
  myCommentsMeta = signal<PaginationMeta | null>(null);
  myCommentsLoading = signal<boolean>(false);
  myCommentsError = signal<string | null>(null);
  myCommentsPage = 1;
  myCommentsLimit = 10;

  aliases = signal<UserAliasesResponse | null>(null);
  aliasesLoading = signal<boolean>(false);
  aliasesError = signal<string | null>(null);

  constructor(
    private toast: ToastService,
    private auth: AuthService,
    private account: AccountService,
    private blog: BlogService,
    private cart: CartStore,
    private router: Router,
    private route: ActivatedRoute,
    private api: ApiService,
    public wishlist: WishlistService,
    private theme: ThemeService,
    private lang: LanguageService,
    private translate: TranslateService
  ) {
    this.computeTotalPages();
    this.stripeThemeEffect = effect(() => {
      const mode = this.theme.mode()();
      if (this.card) {
        this.card.update({ style: this.buildStripeCardStyle(mode) });
      }
    });
    this.phoneCountriesEffect = effect(() => {
      this.phoneCountries = listPhoneCountries(this.lang.language());
    });
  }

  ngOnInit(): void {
    this.forceProfileCompletion = this.route.snapshot.queryParamMap.get('complete') === '1';
    this.wishlist.refresh();
    this.loadData();
    this.loadSecondaryEmails();
    this.loadAliases();
    this.loadDeletionStatus();
    this.loadMyComments();
    this.loadPaymentMethods();
    this.resetIdleTimer();
    window.addEventListener('mousemove', this.handleUserActivity);
    window.addEventListener('keydown', this.handleUserActivity);
  }

  ngAfterViewInit(): void {
    void this.setupStripe();
  }

  setCardHost(cardHost: ElementRef<HTMLDivElement> | undefined): void {
    this.cardElementRef = cardHost;

    if (!cardHost) {
      this.unmountCardElement();
      return;
    }

    this.mountCardElement();
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
        this.googleEmail.set(profile.google_email ?? null);
        this.googlePicture.set(profile.google_picture_url ?? null);
        this.emailVerified.set(Boolean(profile?.email_verified));
        this.notifyBlogComments = Boolean(profile?.notify_blog_comments);
        this.notifyBlogCommentReplies = Boolean(profile?.notify_blog_comment_replies);
        this.notifyMarketing = Boolean(profile?.notify_marketing);
        this.notificationLastUpdated = profile.updated_at ?? null;
        this.addresses.set(addresses);
        this.orders.set(orders);
        this.avatar = profile.avatar_url ?? null;
        this.profileName = profile.name ?? '';
        this.profileUsername = (profile.username ?? '').trim();
        this.profileFirstName = profile.first_name ?? '';
        this.profileMiddleName = profile.middle_name ?? '';
        this.profileLastName = profile.last_name ?? '';
        this.profileDateOfBirth = profile.date_of_birth ?? '';
        this.profilePhone = profile.phone ?? '';
        const phoneSplit = splitE164(this.profilePhone);
        this.profilePhoneCountry = phoneSplit.country ?? 'RO';
        this.profilePhoneNational = phoneSplit.nationalNumber || '';
        this.profileLanguage = (profile.preferred_language === 'ro' ? 'ro' : 'en') as 'en' | 'ro';
        this.profileThemePreference = (this.theme.preference()() ?? 'system') as ThemePreference;
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

  orderStatusChipClass(status: string): string {
    return orderStatusChipClass(status);
  }

  trackingUrl(trackingNumber: string): string {
    const trimmed = (trackingNumber || '').trim();
    if (!trimmed) return '';
    return `https://t.17track.net/en#nums=${encodeURIComponent(trimmed)}`;
  }

  deliveryLabel(order: Order): string {
    const courierRaw = (order.courier ?? '').trim().toLowerCase();
    const courier =
      courierRaw === 'sameday'
        ? 'Sameday'
        : courierRaw === 'fan_courier'
          ? 'Fan Courier'
          : (order.courier ?? '').trim();
    const typeRaw = (order.delivery_type ?? '').trim().toLowerCase();
    const deliveryType = typeRaw === 'home' ? 'Home delivery' : typeRaw === 'locker' ? 'Locker pickup' : (order.delivery_type ?? '').trim();
    const parts = [courier, deliveryType].filter((p) => (p || '').trim());
    return parts.length ? parts.join(' · ') : '—';
  }

  lockerLabel(order: Order): string | null {
    if ((order.delivery_type ?? '').trim().toLowerCase() !== 'locker') return null;
    const name = (order.locker_name ?? '').trim();
    const address = (order.locker_address ?? '').trim();
    const detail = [name, address].filter((p) => p).join(' — ');
    return detail || null;
  }

  reorder(order: Order): void {
    if (this.reorderingOrderId) return;
    this.reorderingOrderId = order.id;
    this.account.reorderOrder(order.id).subscribe({
      next: () => {
        this.cart.loadFromBackend();
        this.toast.success('Added items to cart');
        void this.router.navigateByUrl('/cart');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not reorder.';
        this.toast.error(message);
      },
      complete: () => (this.reorderingOrderId = null)
    });
  }

  downloadReceipt(order: Order): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (this.downloadingReceiptId) return;
    this.downloadingReceiptId = order.id;
    this.account.downloadReceipt(order.id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `receipt-${order.reference_code || order.id}.pdf`;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not download receipt.';
        this.toast.error(message);
      },
      complete: () => (this.downloadingReceiptId = null)
    });
  }

  receiptShares = signal<Record<string, ReceiptShareToken>>({});
  sharingReceiptId: string | null = null;
  revokingReceiptId: string | null = null;

  shareReceipt(order: Order): void {
    if (typeof navigator === 'undefined') return;
    if (this.sharingReceiptId) return;

    const existing = this.receiptShares()[order.id];
    const expiresAt = existing?.expires_at ? new Date(existing.expires_at) : null;
    if (existing?.receipt_url && expiresAt && expiresAt.getTime() > Date.now() + 30_000) {
      void this.copyToClipboard(existing.receipt_url).then((ok) => {
        this.toast.success(ok ? 'Receipt link copied' : 'Receipt link ready');
      });
      return;
    }

    this.sharingReceiptId = order.id;
    this.account.shareReceipt(order.id).subscribe({
      next: (token) => {
        this.receiptShares.set({ ...this.receiptShares(), [order.id]: token });
        void this.copyToClipboard(token.receipt_url).then((ok) => {
          this.toast.success(ok ? 'Receipt link copied' : 'Receipt link generated');
        });
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not generate receipt link.';
        this.toast.error(message);
      },
      complete: () => (this.sharingReceiptId = null)
    });
  }

  revokeReceiptShare(order: Order): void {
    if (!confirm('Revoke previously shared receipt links for this order?')) return;
    if (this.revokingReceiptId) return;
    this.revokingReceiptId = order.id;
    this.account.revokeReceiptShare(order.id).subscribe({
      next: () => {
        const nextShares = { ...this.receiptShares() };
        delete nextShares[order.id];
        this.receiptShares.set(nextShares);
        this.toast.success('Receipt links revoked');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not revoke receipt links.';
        this.toast.error(message);
      },
      complete: () => (this.revokingReceiptId = null)
    });
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    try {
      if (!navigator.clipboard?.writeText) return false;
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
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
          this.upsertAddress(addr);
          this.closeAddressForm();
        },
        error: (err) => this.toast.error(err?.error?.detail || 'Could not update address.')
      });
    } else {
      this.account.createAddress(payload).subscribe({
        next: (addr) => {
          this.toast.success('Address added');
          this.upsertAddress(addr);
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

  setDefaultShipping(addr: Address): void {
    this.account.updateAddress(addr.id, { is_default_shipping: true }).subscribe({
      next: (updated) => {
        this.upsertAddress(updated);
        this.toast.success('Default shipping updated');
      },
      error: (err) => this.toast.error(err?.error?.detail || 'Could not update default shipping.')
    });
  }

  setDefaultBilling(addr: Address): void {
    this.account.updateAddress(addr.id, { is_default_billing: true }).subscribe({
      next: (updated) => {
        this.upsertAddress(updated);
        this.toast.success('Default billing updated');
      },
      error: (err) => this.toast.error(err?.error?.detail || 'Could not update default billing.')
    });
  }

  private upsertAddress(next: Address): void {
    const current = this.addresses();
    const exists = current.some((a) => a.id === next.id);
    const merged = exists ? current.map((a) => (a.id === next.id ? next : a)) : [...current, next];

    const normalized = merged.map((a) => ({
      ...a,
      is_default_shipping: next.is_default_shipping ? a.id === next.id : a.is_default_shipping,
      is_default_billing: next.is_default_billing ? a.id === next.id : a.is_default_billing
    }));

    this.addresses.set(normalized);
  }

  addCard(): void {
    this.cardError = null;
    this.savingCard = false;
    this.cardElementVisible = true;
    this.createSetupIntent();
    this.mountCardElement();
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
        this.auth.loadCurrentUser().subscribe({
          next: (user) => {
            this.profile.set(user);
            this.emailVerified.set(Boolean(user.email_verified));
          }
        });
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
    this.auth.uploadAvatar(file).subscribe({
      next: (user) => {
        this.profile.set(user);
        this.avatar = user.avatar_url ?? null;
        this.toast.success('Avatar updated');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not upload avatar.';
        this.toast.error(message);
      }
    });
  }

  useGoogleAvatar(): void {
    if (this.avatarBusy) return;
    this.avatarBusy = true;
    this.auth.useGoogleAvatar().subscribe({
      next: (user) => {
        this.profile.set(user);
        this.avatar = user.avatar_url ?? null;
        this.toast.success('Avatar updated');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not use Google photo.';
        this.toast.error(message);
      },
      complete: () => {
        this.avatarBusy = false;
      }
    });
  }

  removeAvatar(): void {
    if (this.avatarBusy) return;
    if (!confirm('Remove your avatar?')) return;
    this.avatarBusy = true;
    this.auth.removeAvatar().subscribe({
      next: (user) => {
        this.profile.set(user);
        this.avatar = user.avatar_url ?? null;
        this.toast.success('Avatar removed');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not remove avatar.';
        this.toast.error(message);
      },
      complete: () => {
        this.avatarBusy = false;
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
          this.toast.error('Session expired. Please sign in again.');
        }
      },
      error: () => this.toast.error('Could not refresh session.')
    });
  }

  signOut(): void {
    this.auth.logout().subscribe(() => {
      this.wishlist.clear();
      this.toast.success('Signed out');
      void this.router.navigateByUrl('/');
    });
  }

  isAdmin(): boolean {
    return this.auth.isAdmin();
  }

  isAuthenticated(): boolean {
    return this.auth.isAuthenticated();
  }

  profileCompleteness(): { completed: number; total: number; percent: number } {
    const total = 8;
    let completed = 0;

    if (this.profileName.trim()) completed += 1;
    if (this.profileFirstName.trim()) completed += 1;
    if (this.profileLastName.trim()) completed += 1;
    if (this.profileDateOfBirth.trim()) completed += 1;
    if (buildE164(this.profilePhoneCountry, this.profilePhoneNational)) completed += 1;
    if (this.avatar || this.profile()?.avatar_url) completed += 1;
    if (this.profileLanguage === 'en' || this.profileLanguage === 'ro') completed += 1;
    if (this.emailVerified()) completed += 1;

    return {
      completed,
      total,
      percent: Math.round((completed / total) * 100)
    };
  }

  missingProfileFields(): RequiredProfileField[] {
    return computeMissingRequiredProfileFields(this.profile());
  }

  profileCompletionRequired(): boolean {
    const user = this.profile();
    if (!user) return false;
    const missing = computeMissingRequiredProfileFields(user);
    if (!missing.length) return false;
    return this.forceProfileCompletion || Boolean(user.google_sub);
  }

  usernameChanged(): boolean {
    const current = (this.profile()?.username ?? '').trim();
    const next = this.profileUsername.trim();
    return Boolean(next && next !== current);
  }

  requiredFieldLabelKey(field: RequiredProfileField): string {
    switch (field) {
      case 'name':
        return 'auth.displayName';
      case 'username':
        return 'auth.username';
      case 'first_name':
        return 'auth.firstName';
      case 'last_name':
        return 'auth.lastName';
      case 'date_of_birth':
        return 'auth.dateOfBirth';
      case 'phone':
        return 'auth.phone';
    }
  }

  saveProfile(): void {
    if (!this.auth.isAuthenticated()) return;
    this.savingProfile = true;
    this.profileSaved = false;
    this.profileError = null;

    const name = this.profileName.trim();
    const username = this.profileUsername.trim();
    const firstName = this.profileFirstName.trim();
    const middleName = this.profileMiddleName.trim();
    const lastName = this.profileLastName.trim();
    const dob = this.profileDateOfBirth.trim();
    const phoneNational = this.profilePhoneNational.trim();
    const phone = phoneNational ? buildE164(this.profilePhoneCountry, phoneNational) : null;

    const usernameOk = /^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$/.test(username);
    if (this.profileCompletionRequired()) {
      if (!name) {
        this.profileError = 'Display name is required.';
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
      if (!username || !usernameOk) {
        this.profileError = 'Enter a valid username.';
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
      if (!firstName) {
        this.profileError = 'First name is required.';
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
      if (!lastName) {
        this.profileError = 'Last name is required.';
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
      if (!dob) {
        this.profileError = 'Date of birth is required.';
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
      if (!phoneNational || !phone) {
        this.profileError = 'Enter a valid phone number.';
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
    }

    if (phoneNational && !phone) {
      this.profileError = 'Enter a valid phone number.';
      this.toast.error(this.profileError);
      this.savingProfile = false;
      return;
    }
    if (dob) {
      const parsed = new Date(`${dob}T00:00:00Z`);
      if (!Number.isNaN(parsed.valueOf()) && parsed.getTime() > Date.now()) {
        this.profileError = 'Date of birth cannot be in the future.';
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
    }

    const payload: {
      name?: string | null;
      phone?: string | null;
      first_name?: string | null;
      middle_name?: string | null;
      last_name?: string | null;
      date_of_birth?: string | null;
      preferred_language?: string | null;
    } = {
      name: name ? name : null,
      phone,
      first_name: firstName ? firstName : null,
      middle_name: middleName ? middleName : null,
      last_name: lastName ? lastName : null,
      date_of_birth: dob ? dob : null,
      preferred_language: this.profileLanguage
    };

    this.theme.setPreference(this.profileThemePreference);
    this.lang.setLanguage(this.profileLanguage, { syncBackend: false });

    const current = this.profile();
    const currentUsername = (current?.username ?? '').trim();

    const usernameNeedsUpdate = Boolean(username && username !== currentUsername);
    if (usernameNeedsUpdate && !this.profileUsernamePassword.trim()) {
      const msg = this.translate.instant('auth.currentPasswordRequired');
      this.profileError = msg;
      this.toast.error(msg);
      this.savingProfile = false;
      return;
    }

    const maybeUpdateUsername$ = usernameNeedsUpdate
      ? this.auth.updateUsername(username, this.profileUsernamePassword).pipe(map(() => null))
      : of(null);

    maybeUpdateUsername$
      .pipe(switchMap(() => this.auth.updateProfile(payload)))
      .subscribe({
        next: (user) => {
          this.profile.set(user);
          this.profileName = user.name ?? '';
          this.profileUsername = (user.username ?? '').trim();
          this.profileFirstName = user.first_name ?? '';
          this.profileMiddleName = user.middle_name ?? '';
          this.profileLastName = user.last_name ?? '';
          this.profileDateOfBirth = user.date_of_birth ?? '';
          this.profilePhone = user.phone ?? '';
          const phoneSplit = splitE164(this.profilePhone);
          this.profilePhoneCountry = phoneSplit.country ?? 'RO';
          this.profilePhoneNational = phoneSplit.nationalNumber || '';
          this.profileLanguage = (user.preferred_language === 'ro' ? 'ro' : 'en') as 'en' | 'ro';
          this.avatar = user.avatar_url ?? this.avatar;
          this.profileUsernamePassword = '';
          this.profileSaved = true;
          this.toast.success('Profile saved');
          this.loadAliases();

          if (this.forceProfileCompletion && computeMissingRequiredProfileFields(user).length === 0) {
            this.forceProfileCompletion = false;
            void this.router.navigate([], {
              relativeTo: this.route,
              queryParams: { complete: null },
              queryParamsHandling: 'merge',
              replaceUrl: true,
              fragment: 'profile'
            });
          }
        },
        error: (err) => {
          const message = err?.error?.detail || 'Could not save profile.';
          this.profileError = message;
          this.toast.error(message);
        },
        complete: () => (this.savingProfile = false)
      });
  }

  loadAliases(): void {
    if (!this.auth.isAuthenticated()) return;
    this.aliasesLoading.set(true);
    this.aliasesError.set(null);
    this.auth.getAliases().subscribe({
      next: (resp) => this.aliases.set(resp),
      error: () => this.aliasesError.set('Could not load your username/display name history.'),
      complete: () => this.aliasesLoading.set(false)
    });
  }

  publicIdentityLabel(user?: AuthUser | null): string {
    const u = user ?? this.profile();
    return formatIdentity(u, '');
  }

  accountHeaderLabel(user?: AuthUser | null): string {
    const u = user ?? this.profile();
    const username = (u?.username ?? '').trim();
    if (!username) return '...';
    const name = (u?.name ?? '').trim();
    const tag = u?.name_tag;
    if (name && typeof tag === 'number') return `${username} (${name}#${tag})`;
    if (name) return `${username} (${name})`;
    return username;
  }

  lastOrderLabel(): string {
    const order = this.lastOrder();
    if (!order) return 'No orders yet';
    return `#${order.reference_code || order.id} · ${order.status}`;
  }

  lastOrderSubcopy(): string {
    const order = this.lastOrder();
    if (!order) return 'Your recent orders will appear here.';
    const when = order.created_at ? new Date(order.created_at).toLocaleDateString() : '';
    return `${this.formatMoney(order.total_amount, order.currency)}${when ? ` · ${when}` : ''}`;
  }

  defaultAddressLabel(): string {
    const addr = this.defaultShippingAddress();
    if (!addr) return 'No addresses yet';
    return addr.label || 'Default shipping';
  }

  defaultAddressSubcopy(): string {
    const addr = this.defaultShippingAddress();
    if (!addr) return 'Add a shipping address for faster checkout.';
    const line = [addr.line1, addr.city].filter(Boolean).join(', ');
    return line || 'Saved address';
  }

  wishlistCountLabel(): string {
    const count = this.wishlist.items().length;
    return `${count} saved item${count === 1 ? '' : 's'}`;
  }

  notificationsLabel(): string {
    const enabled = [this.notifyBlogCommentReplies, this.notifyBlogComments, this.notifyMarketing].filter(Boolean).length;
    return enabled ? `${enabled} enabled` : 'All off';
  }

  securityLabel(): string {
    const verified = this.emailVerified() ? 'Email verified' : 'Email unverified';
    const google = this.googleEmail() ? 'Google linked' : 'Google unlinked';
    return `${verified} · ${google}`;
  }

  saveNotifications(): void {
    if (!this.auth.isAuthenticated()) return;
    this.savingNotifications = true;
    this.notificationsMessage = null;
    this.notificationsError = null;
    this.auth
      .updateNotificationPreferences({
        notify_blog_comments: this.notifyBlogComments,
        notify_blog_comment_replies: this.notifyBlogCommentReplies,
        notify_marketing: this.notifyMarketing
      })
      .subscribe({
        next: (user) => {
          this.profile.set(user);
          this.notifyBlogComments = Boolean(user?.notify_blog_comments);
          this.notifyBlogCommentReplies = Boolean(user?.notify_blog_comment_replies);
          this.notifyMarketing = Boolean(user?.notify_marketing);
          this.notificationLastUpdated = user.updated_at ?? null;
          this.notificationsMessage = 'account.notifications.saved';
        },
        error: () => {
          this.notificationsError = 'account.notifications.saveError';
          this.savingNotifications = false;
        },
        complete: () => (this.savingNotifications = false)
      });
  }

  toggleNotificationPreview(): void {
    this.showNotificationPreview = !this.showNotificationPreview;
  }

  private loadDeletionStatus(): void {
    if (!this.auth.isAuthenticated()) return;
    this.deletionLoading.set(true);
    this.deletionError.set(null);
    this.account.getDeletionStatus().subscribe({
      next: (status) => {
        this.deletionStatus.set(status);
      },
      error: () => {
        this.deletionError.set('Could not load deletion status.');
      },
      complete: () => this.deletionLoading.set(false)
    });
  }

  downloadMyData(): void {
    if (this.exportingData || !this.auth.isAuthenticated()) return;
    this.exportingData = true;
    this.exportError = null;
    this.account.downloadExport().subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        const date = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `moment-studio-export-${date}.json`;
        a.click();
        window.URL.revokeObjectURL(url);
        this.toast.success('Export downloaded');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not download export.';
        this.exportError = message;
        this.toast.error(message);
      },
      complete: () => {
        this.exportingData = false;
      }
    });
  }

  requestDeletion(): void {
    if (this.requestingDeletion || !this.auth.isAuthenticated()) return;
    this.requestingDeletion = true;
    this.deletionError.set(null);
    this.account.requestAccountDeletion(this.deletionConfirmText).subscribe({
      next: (status) => {
        this.deletionStatus.set(status);
        this.deletionConfirmText = '';
        this.toast.success('Deletion scheduled');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not request account deletion.';
        this.deletionError.set(message);
        this.toast.error(message);
      },
      complete: () => {
        this.requestingDeletion = false;
      }
    });
  }

  cancelDeletion(): void {
    if (this.cancellingDeletion || !this.auth.isAuthenticated()) return;
    this.cancellingDeletion = true;
    this.deletionError.set(null);
    this.account.cancelAccountDeletion().subscribe({
      next: (status) => {
        this.deletionStatus.set(status);
        this.toast.success('Deletion canceled');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not cancel account deletion.';
        this.deletionError.set(message);
        this.toast.error(message);
      },
      complete: () => {
        this.cancellingDeletion = false;
      }
    });
  }

  loadMyComments(page: number = 1): void {
    if (!this.auth.isAuthenticated()) return;
    this.myCommentsLoading.set(true);
    this.myCommentsError.set(null);
    const lang = this.lang.language();
    this.blog.listMyComments({ lang, page, limit: this.myCommentsLimit }).subscribe({
      next: (res) => {
        this.myComments.set(res.items);
        this.myCommentsMeta.set(res.meta);
        this.myCommentsPage = res.meta.page;
      },
      error: () => {
        this.myCommentsError.set('Could not load your comments.');
      },
      complete: () => this.myCommentsLoading.set(false)
    });
  }

  nextMyCommentsPage(): void {
    const meta = this.myCommentsMeta();
    if (!meta) return;
    if (meta.page < meta.total_pages) {
      this.loadMyComments(meta.page + 1);
    }
  }

  prevMyCommentsPage(): void {
    const meta = this.myCommentsMeta();
    if (!meta) return;
    if (meta.page > 1) {
      this.loadMyComments(meta.page - 1);
    }
  }

  commentStatusChipClass(status: string): string {
    switch (status) {
      case 'posted':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100';
      case 'hidden':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100';
      case 'deleted':
        return 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
      default:
        return 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
    }
  }

  formatTimestamp(value: string | null | undefined): string {
    if (!value) return '';
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
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
    this.stripeThemeEffect?.destroy();
    this.phoneCountriesEffect?.destroy();
    window.removeEventListener('mousemove', this.handleUserActivity);
    window.removeEventListener('keydown', this.handleUserActivity);
  }

  private async setupStripe(): Promise<void> {
    if (this.stripe) return;
    const publishableKey = this.getStripePublishableKey();
    if (!publishableKey) {
      this.cardError = 'Stripe publishable key is not configured';
      return;
    }
    const { loadStripe } = await import('@stripe/stripe-js');
    this.stripe = await loadStripe(publishableKey);
    if (!this.stripe) {
      this.cardError = 'Could not initialize Stripe.';
      return;
    }
    this.elements = this.stripe.elements();
    this.card = this.elements.create('card', { style: this.buildStripeCardStyle(this.theme.mode()()) });
    this.mountCardElement();
  }

  private buildStripeCardStyle(mode: ThemeMode) {
    const base =
      mode === 'dark'
        ? {
            color: '#f8fafc',
            iconColor: '#f8fafc',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '16px',
            '::placeholder': { color: '#94a3b8' }
          }
        : {
            color: '#0f172a',
            iconColor: '#0f172a',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '16px',
            '::placeholder': { color: '#64748b' }
          };
    return {
      base,
      invalid: {
        color: mode === 'dark' ? '#fca5a5' : '#b91c1c'
      }
    };
  }

  private getStripePublishableKey(): string | null {
    return appConfig.stripePublishableKey || null;
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

  private cardChangeListenerAttached = false;
  private cardMountedHost?: HTMLElement;

  private unmountCardElement(): void {
    if (!this.card || !this.cardReady) return;
    try {
      this.card.unmount();
    } catch {
      // ignore
    }
    this.cardReady = false;
    this.cardMountedHost = undefined;
  }

  private mountCardElement(): void {
    if (!this.card || !this.cardElementRef) return;

    const host = this.cardElementRef.nativeElement;
    if (this.cardReady && this.cardMountedHost === host) return;

    if (this.cardReady && this.cardMountedHost && this.cardMountedHost !== host) {
      this.unmountCardElement();
    }

    try {
      this.card.mount(host);
      this.cardMountedHost = host;
      this.cardReady = true;
    } catch {
      return;
    }

    if (!this.cardChangeListenerAttached) {
      this.card.on('change', (event: StripeCardElementChangeEvent) => {
        this.cardError = event.error ? event.error.message ?? 'Card error' : null;
      });
      this.cardChangeListenerAttached = true;
    }
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

  updateEmail(): void {
    if (this.emailChanging) return;
    if (this.googleEmail()) {
      this.emailChangeError = 'Unlink Google before changing your email.';
      this.toast.error(this.emailChangeError);
      return;
    }
    const email = this.emailChangeEmail.trim();
    const password = this.emailChangePassword;
    this.emailChangeError = null;
    this.emailChangeSuccess = null;
    if (!email) {
      this.emailChangeError = 'Enter a new email.';
      this.toast.error(this.emailChangeError);
      return;
    }
    if (!password) {
      this.emailChangeError = 'Confirm your password to change email.';
      this.toast.error(this.emailChangeError);
      return;
    }
    this.emailChanging = true;
    this.auth.updateEmail(email, password).subscribe({
      next: (user) => {
        this.profile.set(user);
        this.emailVerified.set(Boolean(user.email_verified));
        this.emailChangeEmail = '';
        this.emailChangePassword = '';
        this.emailChangeSuccess = 'Email updated. Please verify your new email.';
        this.toast.success('Email updated');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not change email.';
        this.emailChangeError = message;
        this.toast.error(message);
      },
      complete: () => {
        this.emailChanging = false;
      }
    });
  }

  private loadSecondaryEmails(): void {
    this.secondaryEmailsLoading.set(true);
    this.secondaryEmailsError.set(null);
    this.auth.listEmails().subscribe({
      next: (res) => {
        this.secondaryEmails.set(res.secondary_emails ?? []);
      },
      error: () => {
        this.secondaryEmailsError.set('Could not load secondary emails.');
      },
      complete: () => this.secondaryEmailsLoading.set(false)
    });
  }

  addSecondaryEmail(): void {
    if (this.addingSecondaryEmail) return;
    const email = this.secondaryEmailToAdd.trim();
    this.secondaryEmailMessage = null;
    this.secondaryVerificationStatus = null;
    if (!email) {
      this.secondaryEmailMessage = 'Enter an email address.';
      this.toast.error(this.secondaryEmailMessage);
      return;
    }
    this.addingSecondaryEmail = true;
    this.auth.addSecondaryEmail(email).subscribe({
      next: (created) => {
        const existing = this.secondaryEmails();
        this.secondaryEmails.set([created, ...existing.filter((e) => e.id !== created.id)]);
        this.secondaryEmailToAdd = '';
        this.secondaryEmailMessage = 'Verification code sent. Enter it below to verify.';
        this.toast.success('Secondary email added');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not add secondary email.';
        this.secondaryEmailMessage = message;
        this.toast.error(message);
      },
      complete: () => {
        this.addingSecondaryEmail = false;
      }
    });
  }

  resendSecondaryEmailVerification(secondaryEmailId: string): void {
    this.secondaryEmailMessage = null;
    this.secondaryVerificationStatus = null;
    this.auth.requestSecondaryEmailVerification(secondaryEmailId).subscribe({
      next: () => {
        this.secondaryEmailMessage = 'Verification code resent.';
        this.toast.success('Verification email sent');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not resend verification email.';
        this.secondaryEmailMessage = message;
        this.toast.error(message);
      }
    });
  }

  confirmSecondaryEmailVerification(): void {
    if (this.verifyingSecondaryEmail) return;
    const token = this.secondaryVerificationToken.trim();
    this.secondaryEmailMessage = null;
    this.secondaryVerificationStatus = null;
    if (!token) {
      this.secondaryVerificationStatus = 'Enter the verification code.';
      this.toast.error(this.secondaryVerificationStatus);
      return;
    }
    this.verifyingSecondaryEmail = true;
    this.auth.confirmSecondaryEmailVerification(token).subscribe({
      next: (verified) => {
        this.secondaryEmails.set(
          this.secondaryEmails().map((e) =>
            e.id === verified.id ? { ...e, verified: true, verified_at: verified.verified_at ?? new Date().toISOString() } : e
          )
        );
        this.secondaryVerificationToken = '';
        this.secondaryVerificationStatus = 'Secondary email verified.';
        this.toast.success('Email verified');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not verify secondary email.';
        this.secondaryVerificationStatus = message;
        this.toast.error(message);
      },
      complete: () => {
        this.verifyingSecondaryEmail = false;
      }
    });
  }

  deleteSecondaryEmail(secondaryEmailId: string): void {
    if (!confirm('Remove this secondary email?')) return;
    this.secondaryEmailMessage = null;
    this.secondaryVerificationStatus = null;
    this.auth.deleteSecondaryEmail(secondaryEmailId).subscribe({
      next: () => {
        this.secondaryEmails.set(this.secondaryEmails().filter((e) => e.id !== secondaryEmailId));
        if (this.makePrimarySecondaryEmailId === secondaryEmailId) {
          this.cancelMakePrimary();
        }
        this.toast.success('Secondary email removed');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not remove secondary email.';
        this.toast.error(message);
      }
    });
  }

  startMakePrimary(secondaryEmailId: string): void {
    this.makePrimarySecondaryEmailId = secondaryEmailId;
    this.makePrimaryPassword = '';
    this.makePrimaryError = null;
  }

  cancelMakePrimary(): void {
    this.makePrimarySecondaryEmailId = null;
    this.makePrimaryPassword = '';
    this.makePrimaryError = null;
  }

  confirmMakePrimary(): void {
    if (this.makingPrimaryEmail) return;
    const id = this.makePrimarySecondaryEmailId;
    if (!id) return;
    const password = this.makePrimaryPassword;
    this.makePrimaryError = null;
    if (!password) {
      this.makePrimaryError = 'Confirm your password to switch primary email.';
      this.toast.error(this.makePrimaryError);
      return;
    }
    this.makingPrimaryEmail = true;
    this.auth.makeSecondaryEmailPrimary(id, password).subscribe({
      next: (user) => {
        this.profile.set(user);
        this.emailVerified.set(Boolean(user.email_verified));
        this.cancelMakePrimary();
        this.loadSecondaryEmails();
        this.toast.success('Primary email updated');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not update primary email.';
        this.makePrimaryError = message;
        this.toast.error(message);
      },
      complete: () => {
        this.makingPrimaryEmail = false;
      }
    });
  }

  linkGoogle(): void {
    const password = this.googlePassword.trim();
    this.googleError = null;
    if (!password) {
      this.googleError = 'Enter your password to link Google.';
      return;
    }
    this.googleBusy = true;
    sessionStorage.setItem('google_link_password', password);
    localStorage.setItem('google_flow', 'link');
    this.auth.startGoogleLink().subscribe({
      next: (url) => {
        window.location.href = url;
      },
      error: (err) => {
        sessionStorage.removeItem('google_link_password');
        const message = err?.error?.detail || 'Could not start Google link flow.';
        this.googleError = message;
        this.toast.error(message);
        this.googleBusy = false;
      }
    });
  }

  unlinkGoogle(): void {
    const password = this.googlePassword.trim();
    this.googleError = null;
    if (!password) {
      this.googleError = 'Enter your password to unlink Google.';
      return;
    }
    this.googleBusy = true;
    this.auth.unlinkGoogle(password).subscribe({
      next: (user) => {
        this.googleEmail.set(user.google_email ?? null);
        this.googlePicture.set(user.google_picture_url ?? null);
        this.profile.set(user);
        this.googlePassword = '';
        this.toast.success('Google account disconnected');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not unlink Google account.';
        this.googleError = message;
        this.toast.error(message);
      },
      complete: () => {
        this.googleBusy = false;
      }
    });
  }

  private lastOrder(): Order | null {
    const orders = this.orders();
    if (!orders.length) return null;
    return [...orders].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  }

  private defaultShippingAddress(): Address | null {
    const addresses = this.addresses();
    if (!addresses.length) return null;
    return addresses.find((a) => a.is_default_shipping) ?? addresses[0] ?? null;
  }

  private formatMoney(amount: number, currency: string): string {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'RON' }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${currency || ''}`.trim();
    }
  }
}
