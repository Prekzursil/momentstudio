// Shared state + actions for the Account area.
//
// This was extracted from the previous monolithic Account component so that the
// new routed subpages can share behavior without bundling the legacy template.

import { AfterViewInit, Directive, ElementRef, effect, EffectRef, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import type { Stripe, StripeCardElement, StripeCardElementChangeEvent, StripeElements } from '@stripe/stripe-js';
import { filter, map, of, Subscription, switchMap } from 'rxjs';

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
import { NotificationsService } from '../../core/notifications.service';
import { ThemeMode, ThemePreference, ThemeService } from '../../core/theme.service';
import { ToastService } from '../../core/toast.service';
import { WishlistService } from '../../core/wishlist.service';
import { CouponsService, type CouponRead } from '../../core/coupons.service';
import { orderStatusChipClass } from '../../shared/order-status';
import { missingRequiredProfileFields as computeMissingRequiredProfileFields, type RequiredProfileField } from '../../shared/profile-requirements';
import { buildE164, listPhoneCountries, splitE164, type PhoneCountryOption } from '../../shared/phone';
import { formatIdentity } from '../../shared/user-identity';

import { type CountryCode } from 'libphonenumber-js';

type AccountSection =
  | 'overview'
  | 'profile'
  | 'orders'
  | 'addresses'
  | 'wishlist'
  | 'coupons'
  | 'notifications'
  | 'security'
  | 'comments'
  | 'privacy'
  | 'password';

type ProfileFormSnapshot = {
  name: string;
  username: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  phoneCountry: CountryCode;
  phoneNational: string;
  preferredLanguage: 'en' | 'ro';
  themePreference: ThemePreference;
};

type NotificationPrefsSnapshot = {
  notifyBlogComments: boolean;
  notifyBlogCommentReplies: boolean;
  notifyMarketing: boolean;
};

@Directive()
export class AccountState implements OnInit, AfterViewInit, OnDestroy {
  emailVerified = signal<boolean>(false);
  couponsCount = signal<number>(0);
  couponsCountLoaded = signal<boolean>(false);
  couponsCountLoading = signal<boolean>(false);
  addresses = signal<Address[]>([]);
  addressesLoaded = signal<boolean>(false);
  addressesLoading = signal<boolean>(false);
  addressesError = signal<string | null>(null);
  avatar: string | null = null;
  avatarBusy = false;
  placeholderAvatar = 'assets/placeholder/avatar-placeholder.svg';
  verificationToken = '';
  verificationStatus: string | null = null;

  profile = signal<AuthUser | null>(null);
  googleEmail = signal<string | null>(null);
  googlePicture = signal<string | null>(null);
  orders = signal<Order[]>([]);
  ordersLoaded = signal<boolean>(false);
  ordersLoading = signal<boolean>(false);
  ordersError = signal<string | null>(null);
  orderFilter = '';
  page = 1;
  pageSize = 5;
  totalPages = 1;
  loading = signal<boolean>(false);
  error = signal<string | null>(null);

  paymentMethods: any[] = [];
  paymentMethodsLoaded = signal<boolean>(false);
  paymentMethodsLoading = signal<boolean>(false);
  paymentMethodsError = signal<string | null>(null);
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
  private profileLoaded = false;
  private routerEventsSub?: Subscription;
  private profileBaseline: ProfileFormSnapshot | null = null;
  private notificationsBaseline: NotificationPrefsSnapshot | null = null;
  private addressFormBaseline: AddressCreateRequest | null = null;
  private readonly lastSectionStorageKey = 'account.lastSection';
  private readonly handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!this.hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  };

  googlePassword = '';
  googleBusy = false;
  googleError: string | null = null;

  secondaryEmails = signal<SecondaryEmail[]>([]);
  secondaryEmailsLoaded = signal<boolean>(false);
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
    private notificationsService: NotificationsService,
    private couponsService: CouponsService,
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
    this.loadProfile();
    this.routerEventsSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        const section = this.activeSectionFromUrl(e.urlAfterRedirects);
        this.rememberLastVisitedSection(section);
        this.ensureLoadedForSection(section);
      });
    this.notificationsService.refreshUnreadCount();
    this.loadCouponsCount();

    const initialUrl = this.router.url;
    if (this.isAccountRootUrl(initialUrl)) {
      const remembered = this.forceProfileCompletion ? 'profile' : this.lastVisitedSection();
      const target = remembered === 'password' ? 'overview' : remembered;
      void this.router.navigate([target === 'overview' ? 'overview' : target], {
        relativeTo: this.route,
        queryParamsHandling: 'preserve',
        replaceUrl: true
      });
    } else {
      const initialSection = this.activeSectionFromUrl(initialUrl);
      this.rememberLastVisitedSection(initialSection);
      this.ensureLoadedForSection(initialSection);
    }

    this.resetIdleTimer();
    window.addEventListener('mousemove', this.handleUserActivity);
    window.addEventListener('keydown', this.handleUserActivity);
    window.addEventListener('beforeunload', this.handleBeforeUnload);
  }

  ngAfterViewInit(): void {
    // Stripe Elements is initialized only when needed (e.g. when adding a payment method).
  }

  setCardHost(cardHost: ElementRef<HTMLDivElement> | undefined): void {
    this.cardElementRef = cardHost;

    if (!cardHost) {
      this.unmountCardElement();
      return;
    }

    this.mountCardElement();
  }

  retryAccountLoad(): void {
    this.profileLoaded = false;
    this.loadProfile();
    this.ensureLoadedForSection(this.activeSectionFromUrl(this.router.url));
  }

  private activeSectionFromUrl(url: string): AccountSection {
    const path = (url || '').split('?')[0].split('#')[0];
    const segments = path.split('/').filter(Boolean);
    const accountIndex = segments.indexOf('account');
    if (accountIndex < 0) return 'overview';
    const section = (segments[accountIndex + 1] ?? '').trim();
    return (section || 'overview') as AccountSection;
  }

  private isAccountRootUrl(url: string): boolean {
    const path = (url || '').split('?')[0].split('#')[0];
    const segments = path.split('/').filter(Boolean);
    const accountIndex = segments.indexOf('account');
    if (accountIndex < 0) return false;
    return accountIndex === segments.length - 1;
  }

  private lastVisitedSection(): AccountSection {
    try {
      const value = (localStorage.getItem(this.lastSectionStorageKey) ?? '').trim();
      const normalized = value as AccountSection;
      const allowed: AccountSection[] = [
        'overview',
        'profile',
        'orders',
        'addresses',
        'wishlist',
        'coupons',
        'notifications',
        'security',
        'comments',
        'privacy'
      ];
      if (allowed.includes(normalized)) return normalized;
    } catch {
      // Ignore storage issues.
    }
    return 'overview';
  }

  private rememberLastVisitedSection(section: AccountSection): void {
    if (section === 'password') return;
    try {
      localStorage.setItem(this.lastSectionStorageKey, section);
    } catch {
      // Ignore storage issues.
    }
  }

  private ensureLoadedForSection(section: AccountSection): void {
    switch (section) {
      case 'profile':
        this.loadAliases();
        return;
      case 'orders':
        this.loadOrders();
        return;
      case 'addresses':
        this.loadAddresses();
        return;
      case 'wishlist':
        this.wishlist.ensureLoaded();
        return;
      case 'coupons':
      case 'notifications':
      case 'password':
        return;
      case 'security':
        this.loadSecondaryEmails();
        this.loadPaymentMethods();
        return;
      case 'comments':
        if (!this.myCommentsMeta()) {
          this.loadMyComments();
        }
        return;
      case 'privacy':
        if (!this.deletionStatus()) {
          this.loadDeletionStatus();
        }
        return;
      case 'overview':
      default:
        this.loadOrders();
        this.loadAddresses();
        this.wishlist.ensureLoaded();
        return;
    }
  }

  unreadNotificationsCount(): number {
    return this.notificationsService.unreadCount();
  }

  pendingOrdersCount(): number {
    if (!this.ordersLoaded()) return 0;
    return this.orders().filter((o) => o.status === 'pending_payment' || o.status === 'pending_acceptance').length;
  }

  loadCouponsCount(force: boolean = false): void {
    if (!this.auth.isAuthenticated()) return;
    if (this.couponsCountLoading() && !force) return;
    if (this.couponsCountLoaded() && !force) return;

    this.couponsCountLoading.set(true);
    this.couponsService.myCoupons().subscribe({
      next: (coupons) => {
        this.couponsCount.set(this.countAvailableCoupons(coupons ?? []));
        this.couponsCountLoaded.set(true);
      },
      error: () => {
        this.couponsCount.set(0);
        this.couponsCountLoaded.set(true);
        this.couponsCountLoading.set(false);
      },
      complete: () => this.couponsCountLoading.set(false)
    });
  }

  private countAvailableCoupons(coupons: CouponRead[]): number {
    const now = Date.now();
    return (coupons ?? []).filter((coupon) => {
      if (!coupon?.is_active) return false;
      const promoActive = coupon.promotion ? coupon.promotion.is_active !== false : true;
      if (!promoActive) return false;

      const startsAt = coupon.starts_at ? Date.parse(coupon.starts_at) : NaN;
      if (Number.isFinite(startsAt) && startsAt > now) return false;
      const endsAt = coupon.ends_at ? Date.parse(coupon.ends_at) : NaN;
      if (Number.isFinite(endsAt) && endsAt < now) return false;
      return true;
    }).length;
  }

  private loadProfile(force: boolean = false): void {
    if (!this.auth.isAuthenticated()) return;
    if (this.loading() && !force) return;
    if (this.profileLoaded && !force) return;

    this.loading.set(true);
    this.error.set(null);
    this.account.getProfile().subscribe({
      next: (profile) => {
        this.profile.set(profile);
        this.googleEmail.set(profile.google_email ?? null);
        this.googlePicture.set(profile.google_picture_url ?? null);
        this.emailVerified.set(Boolean(profile?.email_verified));
        this.notifyBlogComments = Boolean(profile?.notify_blog_comments);
        this.notifyBlogCommentReplies = Boolean(profile?.notify_blog_comment_replies);
        this.notifyMarketing = Boolean(profile?.notify_marketing);
        this.notificationLastUpdated = profile.updated_at ?? null;
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
        this.profileUsernamePassword = '';
        this.profileBaseline = this.captureProfileSnapshot();
        this.notificationsBaseline = this.captureNotificationSnapshot();
        this.profileLoaded = true;
      },
      error: () => {
        this.error.set('account.loadError');
        this.loading.set(false);
      },
      complete: () => this.loading.set(false)
    });
  }

  loadOrders(force: boolean = false): void {
    if (!this.auth.isAuthenticated()) return;
    if (this.ordersLoading() && !force) return;
    if (this.ordersLoaded() && !force) return;

    this.ordersLoading.set(true);
    this.ordersError.set(null);
    this.account.getOrders().subscribe({
      next: (orders) => {
        this.orders.set(orders);
        this.ordersLoaded.set(true);
        this.computeTotalPages();
        this.page = Math.min(this.page, this.totalPages);
      },
      error: () => {
        this.ordersError.set('account.orders.loadError');
        this.ordersLoading.set(false);
      },
      complete: () => this.ordersLoading.set(false)
    });
  }

  loadAddresses(force: boolean = false): void {
    if (!this.auth.isAuthenticated()) return;
    if (this.addressesLoading() && !force) return;
    if (this.addressesLoaded() && !force) return;

    this.addressesLoading.set(true);
    this.addressesError.set(null);
    this.account.getAddresses().subscribe({
      next: (addresses) => {
        this.addresses.set(addresses);
        this.addressesLoaded.set(true);
      },
      error: () => {
        this.addressesError.set('account.addresses.loadError');
        this.addressesLoading.set(false);
      },
      complete: () => this.addressesLoading.set(false)
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
    const deliveryType =
      typeRaw === 'home'
        ? this.t('account.orders.delivery.home')
        : typeRaw === 'locker'
          ? this.t('account.orders.delivery.locker')
          : (order.delivery_type ?? '').trim();
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
        this.toast.success(this.t('account.orders.reorderSuccess'));
        void this.router.navigateByUrl('/cart');
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.orders.reorderError');
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
        const message = err?.error?.detail || this.t('account.orders.receiptDownloadError');
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
        this.toast.success(ok ? this.t('account.orders.receiptCopied') : this.t('account.orders.receiptReady'));
      });
      return;
    }

    this.sharingReceiptId = order.id;
    this.account.shareReceipt(order.id).subscribe({
      next: (token) => {
        this.receiptShares.set({ ...this.receiptShares(), [order.id]: token });
        void this.copyToClipboard(token.receipt_url).then((ok) => {
          this.toast.success(ok ? this.t('account.orders.receiptCopied') : this.t('account.orders.receiptGenerated'));
        });
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.orders.receiptGenerateError');
        this.toast.error(message);
      },
      complete: () => (this.sharingReceiptId = null)
    });
  }

  revokeReceiptShare(order: Order): void {
    if (!confirm(this.t('account.orders.receiptRevokeConfirm'))) return;
    if (this.revokingReceiptId) return;
    this.revokingReceiptId = order.id;
    this.account.revokeReceiptShare(order.id).subscribe({
      next: () => {
        const nextShares = { ...this.receiptShares() };
        delete nextShares[order.id];
        this.receiptShares.set(nextShares);
        this.toast.success(this.t('account.orders.receiptRevoked'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.orders.receiptRevokeError');
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
      label: existing?.label || this.t('account.addresses.labels.home'),
      is_default_shipping: existing?.is_default_shipping,
      is_default_billing: existing?.is_default_billing
    };
    this.addressFormBaseline = { ...this.addressModel };
  }

  closeAddressForm(): void {
    this.showAddressForm = false;
    this.editingAddressId = null;
    this.addressFormBaseline = null;
  }

  saveAddress(payload: AddressCreateRequest): void {
    if (this.editingAddressId) {
      this.account.updateAddress(this.editingAddressId, payload).subscribe({
        next: (addr) => {
          this.toast.success(this.t('account.addresses.messages.updated'));
          this.upsertAddress(addr);
          this.closeAddressForm();
        },
        error: (err) => this.toast.error(err?.error?.detail || this.t('account.addresses.errors.update'))
      });
    } else {
      this.account.createAddress(payload).subscribe({
        next: (addr) => {
          this.toast.success(this.t('account.addresses.messages.added'));
          this.upsertAddress(addr);
          this.closeAddressForm();
        },
        error: (err) => this.toast.error(err?.error?.detail || this.t('account.addresses.errors.add'))
      });
    }
  }

  editAddress(addr: Address): void {
    this.openAddressForm(addr);
  }

  removeAddress(id: string): void {
    if (!confirm(this.t('account.addresses.confirm.remove'))) return;
    this.account.deleteAddress(id).subscribe({
      next: () => {
        this.toast.success(this.t('account.addresses.messages.removed'));
        this.addresses.set(this.addresses().filter((a) => a.id !== id));
        this.addressesLoaded.set(true);
      },
      error: () => this.toast.error(this.t('account.addresses.errors.remove'))
    });
  }

  setDefaultShipping(addr: Address): void {
    this.account.updateAddress(addr.id, { is_default_shipping: true }).subscribe({
      next: (updated) => {
        this.upsertAddress(updated);
        this.toast.success(this.t('account.addresses.messages.defaultShippingUpdated'));
      },
      error: (err) => this.toast.error(err?.error?.detail || this.t('account.addresses.errors.defaultShipping'))
    });
  }

  setDefaultBilling(addr: Address): void {
    this.account.updateAddress(addr.id, { is_default_billing: true }).subscribe({
      next: (updated) => {
        this.upsertAddress(updated);
        this.toast.success(this.t('account.addresses.messages.defaultBillingUpdated'));
      },
      error: (err) => this.toast.error(err?.error?.detail || this.t('account.addresses.errors.defaultBilling'))
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
    this.addressesLoaded.set(true);
  }

  addCard(): void {
    this.cardError = null;
    this.savingCard = false;
    this.cardElementVisible = true;
    void this.setupStripe().then(() => {
      if (!this.stripe) return;
      this.createSetupIntent();
    });
  }

  resendVerification(): void {
    this.auth.requestEmailVerification().subscribe({
      next: () => {
        this.verificationStatus = this.t('account.verification.sentStatus');
        this.toast.success(this.t('account.verification.sentToast'));
      },
      error: () => this.toast.error(this.t('account.verification.sendError'))
    });
  }

  submitVerification(): void {
    if (!this.verificationToken) {
      this.verificationStatus = this.t('account.verification.tokenRequired');
      return;
    }
    this.auth.confirmEmailVerification(this.verificationToken).subscribe({
      next: (res) => {
        this.emailVerified.set(res.email_verified);
        this.verificationStatus = this.t('account.verification.verifiedStatus');
        this.toast.success(this.t('account.verification.verifiedToast'));
        this.verificationToken = '';
        this.auth.loadCurrentUser().subscribe({
          next: (user) => {
            this.profile.set(user);
            this.emailVerified.set(Boolean(user.email_verified));
          }
        });
      },
      error: () => {
        this.verificationStatus = this.t('account.verification.invalidTokenStatus');
        this.toast.error(this.t('account.verification.invalidTokenToast'));
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
        this.toast.success(this.t('account.profile.avatar.updated'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.profile.avatar.uploadError');
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
        this.toast.success(this.t('account.profile.avatar.updated'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.profile.avatar.googleError');
        this.toast.error(message);
      },
      complete: () => {
        this.avatarBusy = false;
      }
    });
  }

  removeAvatar(): void {
    if (this.avatarBusy) return;
    if (!confirm(this.t('account.profile.avatar.removeConfirm'))) return;
    this.avatarBusy = true;
    this.auth.removeAvatar().subscribe({
      next: (user) => {
        this.profile.set(user);
        this.avatar = user.avatar_url ?? null;
        this.toast.success(this.t('account.profile.avatar.removed'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.profile.avatar.removeError');
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
          this.toast.success(this.t('account.security.session.refreshed'));
          this.resetIdleTimer();
        } else {
          this.toast.error(this.t('account.security.session.expired'));
        }
      },
      error: () => this.toast.error(this.t('account.security.session.refreshError'))
    });
  }

  signOut(): void {
    this.auth.logout().subscribe(() => {
      this.wishlist.clear();
      this.toast.success(this.t('account.signedOut'));
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
        this.profileError = this.t('account.profile.errors.displayNameRequired');
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
      if (!username || !usernameOk) {
        this.profileError = this.t('validation.usernameInvalid');
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
      if (!firstName) {
        this.profileError = this.t('account.profile.errors.firstNameRequired');
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
      if (!lastName) {
        this.profileError = this.t('account.profile.errors.lastNameRequired');
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
      if (!dob) {
        this.profileError = this.t('account.profile.errors.dobRequired');
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
      if (!phoneNational || !phone) {
        this.profileError = this.t('validation.phoneInvalid');
        this.toast.error(this.profileError);
        this.savingProfile = false;
        return;
      }
    }

    if (phoneNational && !phone) {
      this.profileError = this.t('validation.phoneInvalid');
      this.toast.error(this.profileError);
      this.savingProfile = false;
      return;
    }
    if (dob) {
      const parsed = new Date(`${dob}T00:00:00Z`);
      if (!Number.isNaN(parsed.valueOf()) && parsed.getTime() > Date.now()) {
        this.profileError = this.t('account.profile.errors.dobFuture');
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
          this.profileBaseline = this.captureProfileSnapshot();
          this.profileSaved = true;
          this.toast.success(this.t('account.profile.savedToast'));
          this.loadAliases(true);

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
          const message = err?.error?.detail || this.t('account.profile.errors.saveError');
          this.profileError = message;
          this.toast.error(message);
        },
        complete: () => (this.savingProfile = false)
      });
  }

  loadAliases(force: boolean = false): void {
    if (!this.auth.isAuthenticated()) return;
    if (this.aliasesLoading() && !force) return;
    if (this.aliases() && !force) return;
    this.aliasesLoading.set(true);
    this.aliasesError.set(null);
    this.auth.getAliases().subscribe({
      next: (resp) => this.aliases.set(resp),
      error: () => {
        this.aliasesError.set(this.t('account.profile.aliases.loadError'));
        this.aliasesLoading.set(false);
      },
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
    if (this.ordersLoading() && !this.ordersLoaded()) return this.t('notifications.loading');
    if (!this.ordersLoaded()) return '...';
    const order = this.lastOrder();
    if (!order) return this.t('account.overview.noOrders');
    const statusKey = `adminUi.orders.${order.status}`;
    const statusTranslated = this.translate.instant(statusKey);
    const status = statusTranslated !== statusKey ? statusTranslated : order.status;
    return this.t('account.overview.lastOrderLabel', { ref: order.reference_code || order.id, status });
  }

  lastOrderSubcopy(): string {
    if (this.ordersLoading() && !this.ordersLoaded()) return this.t('notifications.loading');
    if (!this.ordersLoaded()) return '';
    const order = this.lastOrder();
    if (!order) return this.t('account.overview.noOrdersCopy');
    const when = order.created_at ? new Date(order.created_at).toLocaleDateString() : '';
    return `${this.formatMoney(order.total_amount, order.currency)}${when ? ` · ${when}` : ''}`;
  }

  defaultAddressLabel(): string {
    if (this.addressesLoading() && !this.addressesLoaded()) return this.t('notifications.loading');
    if (!this.addressesLoaded()) return '...';
    const addr = this.defaultShippingAddress();
    if (!addr) return this.t('account.overview.noAddresses');
    return addr.label || this.t('account.addresses.defaultShipping');
  }

  defaultAddressSubcopy(): string {
    if (this.addressesLoading() && !this.addressesLoaded()) return this.t('notifications.loading');
    if (!this.addressesLoaded()) return '';
    const addr = this.defaultShippingAddress();
    if (!addr) return this.t('account.overview.noAddressesCopy');
    const line = [addr.line1, addr.city].filter(Boolean).join(', ');
    return line || this.t('account.overview.savedAddressFallback');
  }

  wishlistCountLabel(): string {
    if (!this.wishlist.isLoaded()) return this.t('notifications.loading');
    const count = this.wishlist.items().length;
    if (count === 1) return this.t('account.overview.wishlistCountOne');
    return this.t('account.overview.wishlistCountMany', { count });
  }

  notificationsLabel(): string {
    if (!this.profile()) return this.t('notifications.loading');
    const enabled = [this.notifyBlogCommentReplies, this.notifyBlogComments, this.notifyMarketing].filter(Boolean).length;
    if (!enabled) return this.t('account.overview.notificationsAllOff');
    return this.t('account.overview.notificationsEnabled', { count: enabled });
  }

  securityLabel(): string {
    if (!this.profile()) return this.t('notifications.loading');
    const verified = this.emailVerified() ? this.t('account.overview.security.emailVerified') : this.t('account.overview.security.emailUnverified');
    const google = this.googleEmail() ? this.t('account.overview.security.googleLinked') : this.t('account.overview.security.googleUnlinked');
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
          this.notificationsBaseline = this.captureNotificationSnapshot();
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
        this.deletionError.set(this.t('account.privacy.deletion.loadError'));
        this.deletionLoading.set(false);
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
        this.toast.success(this.t('account.privacy.export.downloaded'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.privacy.export.downloadError');
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
        this.toast.success(this.t('account.privacy.deletion.scheduled'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.privacy.deletion.requestError');
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
        this.toast.success(this.t('account.privacy.deletion.canceled'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.privacy.deletion.cancelError');
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
        this.myCommentsError.set(this.t('account.comments.loadError'));
        this.myCommentsLoading.set(false);
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
      this.idleWarning.set(this.t('account.security.session.idleLogout'));
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
    this.routerEventsSub?.unsubscribe();
    this.stripeThemeEffect?.destroy();
    this.phoneCountriesEffect?.destroy();
    window.removeEventListener('mousemove', this.handleUserActivity);
    window.removeEventListener('keydown', this.handleUserActivity);
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
  }

  private async setupStripe(): Promise<void> {
    if (this.stripe) return;
    const publishableKey = this.getStripePublishableKey();
    if (!publishableKey) {
      this.cardError = this.t('account.security.payment.stripeKeyMissing');
      return;
    }
    const { loadStripe } = await import('@stripe/stripe-js');
    this.stripe = await loadStripe(publishableKey);
    if (!this.stripe) {
      this.cardError = this.t('account.security.payment.stripeInitError');
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
        const msg = this.t('account.security.payment.setupIntentError');
        this.cardError = msg;
        this.toast.error(msg);
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
        this.cardError = event.error ? event.error.message ?? this.t('account.security.payment.cardErrorFallback') : null;
      });
      this.cardChangeListenerAttached = true;
    }
  }

  async confirmCard(): Promise<void> {
    if (!this.stripe || !this.card || !this.clientSecret) {
      this.cardError = this.t('account.security.payment.formNotReady');
      return;
    }
    this.savingCard = true;
    const result = await this.stripe.confirmCardSetup(this.clientSecret, {
      payment_method: { card: this.card }
    });
    if (result.error) {
      this.cardError = result.error.message ?? this.t('account.security.payment.saveCardError');
      this.savingCard = false;
      return;
    }
    const pmId = result.setupIntent?.payment_method;
    if (!pmId) {
      this.cardError = this.t('account.security.payment.missingPaymentMethod');
      this.savingCard = false;
      return;
    }
    this.api.post('/payment-methods/attach', { payment_method_id: pmId }).subscribe({
      next: () => {
        this.toast.success(this.t('account.security.payment.saved'));
        this.loadPaymentMethods(true);
        this.cardError = null;
        this.clientSecret = null;
        this.savingCard = false;
      },
      error: () => {
        this.cardError = this.t('account.security.payment.attachError');
        this.savingCard = false;
      }
    });
  }

  private loadPaymentMethods(force: boolean = false): void {
    if (!this.auth.isAuthenticated()) return;
    if (this.paymentMethodsLoading() && !force) return;
    if (this.paymentMethodsLoaded() && !force) return;
    this.paymentMethodsLoading.set(true);
    this.paymentMethodsError.set(null);
    this.api.get<any[]>('/payment-methods').subscribe({
      next: (methods) => {
        this.paymentMethods = methods;
        this.paymentMethodsLoaded.set(true);
      },
      error: () => {
        this.paymentMethods = [];
        this.paymentMethodsError.set('account.security.payment.loadError');
        this.paymentMethodsLoading.set(false);
      },
      complete: () => this.paymentMethodsLoading.set(false)
    });
  }

  removePaymentMethod(id: string): void {
    if (!confirm(this.t('account.security.payment.removeConfirm'))) return;
    this.api.delete(`/payment-methods/${id}`).subscribe({
      next: () => {
        this.toast.success(this.t('account.security.payment.removed'));
        this.paymentMethods = this.paymentMethods.filter((pm) => pm.id !== id);
      },
      error: () => this.toast.error(this.t('account.security.payment.removeError'))
    });
  }

  private loadSecondaryEmails(force: boolean = false): void {
    if (!this.auth.isAuthenticated()) return;
    if (this.secondaryEmailsLoading() && !force) return;
    if (this.secondaryEmailsLoaded() && !force) return;
    this.secondaryEmailsLoading.set(true);
    this.secondaryEmailsError.set(null);
    this.auth.listEmails().subscribe({
      next: (res) => {
        this.secondaryEmails.set(res.secondary_emails ?? []);
        this.secondaryEmailsLoaded.set(true);
      },
      error: () => {
        this.secondaryEmailsError.set(this.t('account.security.emails.loadError'));
        this.secondaryEmailsLoading.set(false);
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
      this.secondaryEmailMessage = this.t('account.security.emails.enterEmail');
      this.toast.error(this.secondaryEmailMessage);
      return;
    }
    this.addingSecondaryEmail = true;
    this.auth.addSecondaryEmail(email).subscribe({
      next: (created) => {
        const existing = this.secondaryEmails();
        this.secondaryEmails.set([created, ...existing.filter((e) => e.id !== created.id)]);
        this.secondaryEmailToAdd = '';
        this.secondaryEmailMessage = this.t('account.security.emails.verificationSent');
        this.toast.success(this.t('account.security.emails.added'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.security.emails.addError');
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
        this.secondaryEmailMessage = this.t('account.security.emails.verificationResent');
        this.toast.success(this.t('account.security.emails.verificationEmailSent'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.security.emails.resendError');
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
      this.secondaryVerificationStatus = this.t('account.security.emails.enterVerificationCode');
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
        this.secondaryVerificationStatus = this.t('account.security.emails.verified');
        this.toast.success(this.t('account.verification.verifiedToast'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.security.emails.verifyError');
        this.secondaryVerificationStatus = message;
        this.toast.error(message);
      },
      complete: () => {
        this.verifyingSecondaryEmail = false;
      }
    });
  }

  deleteSecondaryEmail(secondaryEmailId: string): void {
    if (!confirm(this.t('account.security.emails.removeConfirm'))) return;
    this.secondaryEmailMessage = null;
    this.secondaryVerificationStatus = null;
    this.auth.deleteSecondaryEmail(secondaryEmailId).subscribe({
      next: () => {
        this.secondaryEmails.set(this.secondaryEmails().filter((e) => e.id !== secondaryEmailId));
        if (this.makePrimarySecondaryEmailId === secondaryEmailId) {
          this.cancelMakePrimary();
        }
        this.toast.success(this.t('account.security.emails.removed'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.security.emails.removeError');
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
      this.makePrimaryError = this.t('account.security.emails.makePrimaryPasswordRequired');
      this.toast.error(this.makePrimaryError);
      return;
    }
    this.makingPrimaryEmail = true;
    this.auth.makeSecondaryEmailPrimary(id, password).subscribe({
      next: (user) => {
        this.profile.set(user);
        this.emailVerified.set(Boolean(user.email_verified));
        this.cancelMakePrimary();
        this.loadSecondaryEmails(true);
        this.toast.success(this.t('account.security.emails.primaryUpdated'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.security.emails.primaryUpdateError');
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
      this.googleError = this.t('account.security.google.passwordRequiredLink');
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
        const message = err?.error?.detail || this.t('account.security.google.startLinkError');
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
      this.googleError = this.t('account.security.google.passwordRequiredUnlink');
      return;
    }
    this.googleBusy = true;
    this.auth.unlinkGoogle(password).subscribe({
      next: (user) => {
        this.googleEmail.set(user.google_email ?? null);
        this.googlePicture.set(user.google_picture_url ?? null);
        this.profile.set(user);
        this.googlePassword = '';
        this.toast.success(this.t('account.security.google.unlinked'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.security.google.unlinkError');
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

  discardProfileChanges(): void {
    const baseline = this.profileBaseline;
    if (!baseline) return;
    this.profileName = baseline.name;
    this.profileUsername = baseline.username;
    this.profileFirstName = baseline.firstName;
    this.profileMiddleName = baseline.middleName;
    this.profileLastName = baseline.lastName;
    this.profileDateOfBirth = baseline.dateOfBirth;
    this.profilePhoneCountry = baseline.phoneCountry;
    this.profilePhoneNational = baseline.phoneNational;
    this.profileLanguage = baseline.preferredLanguage;
    this.profileThemePreference = baseline.themePreference;
    this.profileUsernamePassword = '';
    this.profileError = null;
    this.profileSaved = false;
  }

  discardNotificationChanges(): void {
    const baseline = this.notificationsBaseline;
    if (!baseline) return;
    this.notifyBlogComments = baseline.notifyBlogComments;
    this.notifyBlogCommentReplies = baseline.notifyBlogCommentReplies;
    this.notifyMarketing = baseline.notifyMarketing;
    this.notificationsMessage = null;
    this.notificationsError = null;
  }

  discardAddressChanges(): void {
    if (!this.showAddressForm) return;
    this.closeAddressForm();
  }

  profileHasUnsavedChanges(): boolean {
    if (!this.profileBaseline) return false;
    if (this.profileUsernamePassword.trim()) return true;
    const current = this.captureProfileSnapshot();
    return !this.sameProfileSnapshot(this.profileBaseline, current);
  }

  notificationsHasUnsavedChanges(): boolean {
    if (!this.notificationsBaseline) return false;
    const current = this.captureNotificationSnapshot();
    return !this.sameNotificationSnapshot(this.notificationsBaseline, current);
  }

  addressesHasUnsavedChanges(): boolean {
    if (!this.showAddressForm) return false;
    const baseline = this.addressFormBaseline;
    if (!baseline) return true;
    return !this.sameAddressSnapshot(baseline, this.addressModel);
  }

  private hasUnsavedChanges(): boolean {
    return this.profileHasUnsavedChanges() || this.addressesHasUnsavedChanges() || this.notificationsHasUnsavedChanges();
  }

  private captureProfileSnapshot(): ProfileFormSnapshot {
    return {
      name: this.profileName.trim(),
      username: this.profileUsername.trim(),
      firstName: this.profileFirstName.trim(),
      middleName: this.profileMiddleName.trim(),
      lastName: this.profileLastName.trim(),
      dateOfBirth: this.profileDateOfBirth.trim(),
      phoneCountry: this.profilePhoneCountry,
      phoneNational: this.profilePhoneNational.trim(),
      preferredLanguage: this.profileLanguage,
      themePreference: this.profileThemePreference
    };
  }

  private sameProfileSnapshot(a: ProfileFormSnapshot, b: ProfileFormSnapshot): boolean {
    return (
      a.name === b.name &&
      a.username === b.username &&
      a.firstName === b.firstName &&
      a.middleName === b.middleName &&
      a.lastName === b.lastName &&
      a.dateOfBirth === b.dateOfBirth &&
      a.phoneCountry === b.phoneCountry &&
      a.phoneNational === b.phoneNational &&
      a.preferredLanguage === b.preferredLanguage &&
      a.themePreference === b.themePreference
    );
  }

  private captureNotificationSnapshot(): NotificationPrefsSnapshot {
    return {
      notifyBlogComments: Boolean(this.notifyBlogComments),
      notifyBlogCommentReplies: Boolean(this.notifyBlogCommentReplies),
      notifyMarketing: Boolean(this.notifyMarketing)
    };
  }

  private sameNotificationSnapshot(a: NotificationPrefsSnapshot, b: NotificationPrefsSnapshot): boolean {
    return (
      a.notifyBlogComments === b.notifyBlogComments &&
      a.notifyBlogCommentReplies === b.notifyBlogCommentReplies &&
      a.notifyMarketing === b.notifyMarketing
    );
  }

  private normalizeAddressSnapshot(model: AddressCreateRequest): AddressCreateRequest {
    return {
      label: (model.label ?? '').trim(),
      line1: (model.line1 ?? '').trim(),
      line2: (model.line2 ?? '').trim(),
      city: (model.city ?? '').trim(),
      region: (model.region ?? '').trim(),
      postal_code: (model.postal_code ?? '').trim(),
      country: (model.country ?? '').trim(),
      is_default_shipping: Boolean(model.is_default_shipping),
      is_default_billing: Boolean(model.is_default_billing)
    };
  }

  private sameAddressSnapshot(a: AddressCreateRequest, b: AddressCreateRequest): boolean {
    const an = this.normalizeAddressSnapshot(a);
    const bn = this.normalizeAddressSnapshot(b);
    return (
      an.label === bn.label &&
      an.line1 === bn.line1 &&
      an.line2 === bn.line2 &&
      an.city === bn.city &&
      an.region === bn.region &&
      an.postal_code === bn.postal_code &&
      an.country === bn.country &&
      Boolean(an.is_default_shipping) === Boolean(bn.is_default_shipping) &&
      Boolean(an.is_default_billing) === Boolean(bn.is_default_billing)
    );
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }
}
