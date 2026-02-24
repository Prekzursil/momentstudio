// Shared state + actions for the Account area.
//
// This was extracted from the previous monolithic Account component so that the
// new routed subpages can share behavior without bundling the legacy template.

import { Directive, effect, EffectRef, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { filter, map, of, Subscription, switchMap } from 'rxjs';

import { ApiService } from '../../core/api.service';
import {
  AuthService,
  AuthUser,
  type CooldownInfo,
  PasskeyInfo,
  RefreshSessionInfo,
  SecondaryEmail,
  TwoFactorEnableResponse,
  TwoFactorSetupResponse,
  TwoFactorStatusResponse,
  UserCooldownsResponse,
  UserAliasesResponse,
  UserSecurityEventInfo
} from '../../core/auth.service';
import {
  AccountDeletionStatus,
  AccountService,
  Address,
  AddressCreateRequest,
  Order,
  OrderPaginationMeta,
  ReceiptShareToken,
  UserDataExportJob
} from '../../core/account.service';
import { BlogMyComment, BlogService, PaginationMeta } from '../../core/blog.service';
import { CartStore } from '../../core/cart.store';
import { LanguageService } from '../../core/language.service';
import { NotificationsService } from '../../core/notifications.service';
import { ThemePreference, ThemeService } from '../../core/theme.service';
import { ToastService } from '../../core/toast.service';
import { TicketListItem, TicketsService } from '../../core/tickets.service';
import { WishlistService } from '../../core/wishlist.service';
import { CouponsService, type CouponRead } from '../../core/coupons.service';
import { GoogleLinkPendingService, PendingGoogleLink } from '../../core/google-link-pending.service';
import { orderStatusChipClass } from '../../shared/order-status';
import { missingRequiredProfileFields as computeMissingRequiredProfileFields, type RequiredProfileField } from '../../shared/profile-requirements';
  import {
    buildE164,
    formatInternationalPreview,
    formatNationalAsYouType,
    listPhoneCountries,
    splitE164,
    type PhoneCountryOption
  } from '../../shared/phone';
import { formatIdentity } from '../../shared/user-identity';
import { isWebAuthnSupported, serializePublicKeyCredential, toPublicKeyCredentialCreationOptions } from '../../shared/webauthn';

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

const GOOGLE_FLOW_KEY = 'google_flow';

@Directive()
export class AccountState implements OnInit, OnDestroy {
  private readonly now = signal<number>(Date.now());
  private nowInterval?: ReturnType<typeof setInterval>;

  emailVerified = signal<boolean>(false);
  couponsCount = signal<number>(0);
  couponsCountLoaded = signal<boolean>(false);
  couponsCountLoading = signal<boolean>(false);
  addresses = signal<Address[]>([]);
  addressesLoaded = signal<boolean>(false);
  addressesLoading = signal<boolean>(false);
  addressesError = signal<string | null>(null);
  tickets = signal<TicketListItem[]>([]);
  ticketsLoaded = signal<boolean>(false);
  ticketsLoading = signal<boolean>(false);
  ticketsError = signal<string | null>(null);
  avatar: string | null = null;
  avatarBusy = false;
  placeholderAvatar = 'assets/placeholder/avatar-placeholder.svg';
  verificationStatus: string | null = null;
  primaryVerificationResendUntil = signal<number | null>(null);

  profile = signal<AuthUser | null>(null);
  googleEmail = signal<string | null>(null);
  googlePicture = signal<string | null>(null);
  orders = signal<Order[]>([]);
  ordersMeta = signal<OrderPaginationMeta | null>(null);
  latestOrder = signal<Order | null>(null);
  ordersLoaded = signal<boolean>(false);
  ordersLoading = signal<boolean>(false);
  ordersError = signal<string | null>(null);
  orderFilter = '';
  ordersQuery = '';
  ordersFrom = '';
  ordersTo = '';
  page = 1;
  pageSize = 5;
  totalPages = 1;
  loading = signal<boolean>(false);
  error = signal<string | null>(null);

  private readonly phoneCountriesEffect?: EffectRef;
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
  reorderingOrderItemId: string | null = null;
  downloadingReceiptId: string | null = null;
  returnOrderId: string | null = null;
  returnReason = '';
  returnCustomerMessage = '';
  returnQty: Record<string, number> = {};
  creatingReturn = false;
  returnCreateError: string | null = null;
  private readonly returnRequestedOrderIds = new Set<string>();
  cancelOrderId: string | null = null;
  cancelReason = '';
  requestingCancel = false;
  cancelRequestError: string | null = null;
  private readonly cancelRequestedOrderIds = new Set<string>();

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
  googleLinkPending = false;

  secondaryEmails = signal<SecondaryEmail[]>([]);
  secondaryEmailsLoaded = signal<boolean>(false);
  secondaryEmailsLoading = signal<boolean>(false);
  secondaryEmailsError = signal<string | null>(null);
  secondaryEmailToAdd = '';
  addingSecondaryEmail = false;
  secondaryEmailMessage: string | null = null;
  secondaryEmailResendUntilById = signal<Record<string, number>>({});
  secondaryVerificationEmailId: string | null = null;
  secondaryVerificationToken = '';
  secondaryVerificationStatus: string | null = null;
  verifyingSecondaryEmail = false;
  makePrimarySecondaryEmailId: string | null = null;
  makePrimaryPassword = '';
  makingPrimaryEmail = false;
  makePrimaryError: string | null = null;
  removeSecondaryEmailId: string | null = null;
  removeSecondaryEmailPassword = '';
  removingSecondaryEmail = false;

  sessions = signal<RefreshSessionInfo[]>([]);
  sessionsLoaded = signal<boolean>(false);
  sessionsLoading = signal<boolean>(false);
  sessionsError = signal<string | null>(null);
  revokingOtherSessions = false;
  revokeOtherSessionsConfirming = false;
  revokeOtherSessionsPassword = '';

  securityEvents = signal<UserSecurityEventInfo[]>([]);
  securityEventsLoaded = signal<boolean>(false);
  securityEventsLoading = signal<boolean>(false);
  securityEventsError = signal<string | null>(null);

  twoFactorStatus = signal<TwoFactorStatusResponse | null>(null);
  twoFactorLoaded = signal<boolean>(false);
  twoFactorLoading = signal<boolean>(false);
  twoFactorError = signal<string | null>(null);
  twoFactorSetupPassword = '';
  twoFactorSetupSecret: string | null = null;
  twoFactorSetupUrl: string | null = null;
  twoFactorSetupQrDataUrl: string | null = null;
  twoFactorEnableCode = '';
  twoFactorRecoveryCodes: string[] | null = null;
  twoFactorManagePassword = '';
  twoFactorManageCode = '';
  startingTwoFactor = false;
  enablingTwoFactor = false;
  disablingTwoFactor = false;
  regeneratingTwoFactorCodes = false;
  private twoFactorQrRequestId = 0;

  passkeys = signal<PasskeyInfo[]>([]);
  passkeysLoaded = signal<boolean>(false);
  passkeysLoading = signal<boolean>(false);
  passkeysError = signal<string | null>(null);
  passkeyRegisterPassword = '';
  passkeyRegisterName = '';
  registeringPasskey = false;
  removePasskeyConfirmId: string | null = null;
  removePasskeyPassword = '';
  removingPasskeyId: string | null = null;

  exportingData = false;
  exportError: string | null = null;
  exportJob = signal<UserDataExportJob | null>(null);
  exportJobLoading = signal<boolean>(false);
  private exportJobPoll?: number;
  private exportJobPollInFlight = false;
  private exportReadyToastShownForJobId: string | null = null;

  deletionStatus = signal<AccountDeletionStatus | null>(null);
  deletionLoading = signal<boolean>(false);
  deletionError = signal<string | null>(null);
  deletionConfirmText = '';
  deletionPassword = '';
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

  cooldowns = signal<UserCooldownsResponse | null>(null);
  cooldownsLoaded = signal<boolean>(false);
  cooldownsLoading = signal<boolean>(false);
  cooldownsError = signal<string | null>(null);

  constructor(
    private readonly toast: ToastService,
    private readonly auth: AuthService,
    private readonly account: AccountService,
    private readonly blog: BlogService,
    private readonly cart: CartStore,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly api: ApiService,
    public wishlist: WishlistService,
    private readonly notificationsService: NotificationsService,
    private readonly ticketsService: TicketsService,
    private readonly couponsService: CouponsService,
    private readonly theme: ThemeService,
    private readonly lang: LanguageService,
    private readonly translate: TranslateService,
    private readonly googleLinkPendingService: GoogleLinkPendingService
  ) {
    this.phoneCountriesEffect = effect(() => {
      this.phoneCountries = listPhoneCountries(this.lang.language());
    });
  }

  ngOnInit(): void {
    this.nowInterval = setInterval(() => this.now.set(Date.now()), 1_000);
    this.forceProfileCompletion = this.route.snapshot.queryParamMap.get('complete') === '1';
    this.googleLinkPending = Boolean(this.readPendingGoogleLinkContext());
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

  navigationSection(): AccountSection {
    const section = this.activeSectionFromUrl(this.router.url);
    return section === 'password' ? 'security' : section;
  }

  navigateToSection(raw: string): void {
    const section = (raw || '').trim() as AccountSection;
    if (!section || section === 'password') return;
    void this.router.navigate([section === 'overview' ? 'overview' : section], { relativeTo: this.route });
  }

  private ensureLoadedForSection(section: AccountSection): void {
    if (section !== 'privacy') {
      this.stopExportJobPolling();
    }
    switch (section) {
      case 'profile':
        this.loadCooldowns();
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
        this.loadCooldowns();
        this.loadSecondaryEmails();
        this.loadSessions();
        this.loadSecurityEvents();
        this.loadTwoFactorStatus();
        this.loadPasskeys();
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
        this.loadLatestExportJob();
        return;
      case 'overview':
      default:
        this.loadOrders();
        this.loadAddresses();
        this.loadTickets();
        this.wishlist.ensureLoaded();
        return;
    }
  }

  unreadNotificationsCount(): number {
    return this.notificationsService.unreadCount();
  }

  pendingOrdersCount(): number {
    return this.ordersMeta()?.pending_count ?? 0;
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

    const q = this.ordersQuery.trim() || undefined;
    const status = (this.orderFilter || '').trim() || undefined;
    const from = (this.ordersFrom || '').trim() || undefined;
    const to = (this.ordersTo || '').trim() || undefined;
    const requestPage = this.page;
    const isDefaultQuery = requestPage === 1 && !q && !status && !from && !to;

    this.ordersLoading.set(true);
    this.ordersError.set(null);
    this.account
      .getOrdersPage({
        q,
        status,
        from,
        to,
        page: requestPage,
        limit: this.pageSize
      })
      .subscribe({
        next: (resp) => {
          this.orders.set(resp.items);
          this.ordersMeta.set(resp.meta);
          this.ordersLoaded.set(true);
          this.totalPages = Math.max(1, resp.meta.total_pages || 1);
          this.page = Math.max(1, Math.min(requestPage, this.totalPages));
          if (isDefaultQuery) {
            this.latestOrder.set(resp.items[0] ?? null);
          }
        },
        error: (err) => {
          const detail = (err?.error?.detail || '').toString();
          this.ordersError.set(detail === 'Invalid date range' ? 'account.orders.invalidDateRange' : 'account.orders.loadError');
          this.ordersLoading.set(false);
        },
        complete: () => this.ordersLoading.set(false)
      });
  }

  ordersFiltersActive(): boolean {
    return Boolean(
      (this.orderFilter || '').trim() ||
        this.ordersQuery.trim() ||
        (this.ordersFrom || '').trim() ||
        (this.ordersTo || '').trim()
    );
  }

  clearOrderFilters(): void {
    this.orderFilter = '';
    this.ordersQuery = '';
    this.ordersFrom = '';
    this.ordersTo = '';
    this.applyOrderFilters();
  }

  filterOrders(): void {
    this.applyOrderFilters();
  }

  applyOrderFilters(): void {
    const from = (this.ordersFrom || '').trim();
    const to = (this.ordersTo || '').trim();
    if (from && to && from > to) {
      this.ordersError.set('account.orders.invalidDateRange');
      return;
    }
    this.page = 1;
    this.loadOrders(true);
  }

  pagedOrders = () => {
    return this.orders();
  };

  nextPage(): void {
    if (this.page < this.totalPages) {
      this.page += 1;
      this.loadOrders(true);
    }
  }

  prevPage(): void {
    if (this.page > 1) {
      this.page -= 1;
      this.loadOrders(true);
    }
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

  loadTickets(force: boolean = false): void {
    if (!this.auth.isAuthenticated()) return;
    if (this.ticketsLoading() && !force) return;
    if (this.ticketsLoaded() && !force) return;

    this.ticketsLoading.set(true);
    this.ticketsError.set(null);
    this.ticketsService.listMine().subscribe({
      next: (items) => {
        const list = Array.isArray(items) ? items : [];
        list.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
        this.tickets.set(list);
        this.ticketsLoaded.set(true);
      },
      error: () => {
        this.tickets.set([]);
        this.ticketsLoaded.set(true);
        this.ticketsError.set('account.overview.support.loadError');
        this.ticketsLoading.set(false);
      },
      complete: () => this.ticketsLoading.set(false)
    });
  }

  orderStatusChipClass(status: string): string {
    return orderStatusChipClass(status);
  }

  trackingUrl(trackingNumber: string): string {
    const trimmed = (trackingNumber || '').trim();
    if (!trimmed) return '';
    return `https://t.17track.net/en#nums=${encodeURIComponent(trimmed)}`;
  }

  trackingStatusLabel(order: Order): string | null {
    if (!(order.tracking_number || '').trim()) return null;
    const status = (order.status || '').trim().toLowerCase();
    if (status === 'delivered') return this.t('account.orders.trackingStatus.delivered');
    if (status === 'shipped') return this.t('account.orders.trackingStatus.inTransit');
    return null;
  }

  paymentMethodLabel(order: Order): string {
    const method = (order.payment_method ?? '').trim().toLowerCase();
    const key =
      method === 'stripe'
        ? 'adminUi.orders.paymentStripe'
        : method === 'paypal'
          ? 'adminUi.orders.paymentPaypal'
          : method === 'cod'
            ? 'adminUi.orders.paymentCod'
            : method === 'netopia'
              ? 'adminUi.orders.paymentNetopia'
              : '';
    if (key) {
      const translated = this.translate.instant(key);
      if (translated !== key) return translated;
    }
    return method ? method.toUpperCase() : '—';
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

  private updateOrderInList(updated: Order): void {
    this.orders.set(this.orders().map((o) => (o.id === updated.id ? updated : o)));
    const latest = this.latestOrder();
    if (latest?.id === updated.id) {
      this.latestOrder.set(updated);
    }
  }

  manualRefundRequired(order: Order): boolean {
    const status = (order.status || '').trim().toLowerCase();
    if (status !== 'cancelled') return false;
    const method = (order.payment_method || '').trim().toLowerCase();
    if (!['stripe', 'paypal'].includes(method)) return false;

    const events = Array.isArray(order.events) ? order.events : [];
    const captured = events.some((evt) => (evt?.event || '').trim().toLowerCase() === 'payment_captured');
    if (!captured) return false;

    const refunded = events.some((evt) => (evt?.event || '').trim().toLowerCase() === 'payment_refunded');
    return !refunded;
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

  reorderItem(order: Order, item: Order['items'][number]): void {
    if (this.reorderingOrderItemId) return;
    this.reorderingOrderItemId = item.id;
    this.api
      .post('/cart/items', {
        product_id: item.product_id,
        variant_id: item.variant_id,
        quantity: 1
      })
      .subscribe({
        next: () => {
          this.cart.loadFromBackend();
          this.toast.success(this.t('account.orders.reorderSuccess'));
        },
        error: (err) => {
          const message = err?.error?.detail || this.t('account.orders.reorderError');
          this.toast.error(message);
        },
        complete: () => (this.reorderingOrderItemId = null)
      });
  }

  hasReturnRequested(order: Order): boolean {
    return this.returnRequestedOrderIds.has(order.id);
  }

  canRequestReturn(order: Order): boolean {
    return (order.status || '').trim().toLowerCase() === 'delivered' && !this.hasReturnRequested(order);
  }

  hasCancelRequested(order: Order): boolean {
    if (this.cancelRequestedOrderIds.has(order.id)) return true;
    const events = Array.isArray(order.events) ? order.events : [];
    return events.some((evt) => (evt?.event || '').trim().toLowerCase() === 'cancel_requested');
  }

  canRequestCancel(order: Order): boolean {
    const status = (order.status || '').trim().toLowerCase();
    if (!['pending_payment', 'pending_acceptance', 'paid'].includes(status)) return false;
    return !this.hasCancelRequested(order);
  }

  openCancelRequest(order: Order): void {
    if (!this.canRequestCancel(order)) {
      this.toast.error(this.t('account.orders.cancel.errors.notEligible'));
      return;
    }
    if (this.cancelOrderId === order.id) {
      this.closeCancelRequest();
      return;
    }
    this.closeReturnRequest();
    this.cancelOrderId = order.id;
    this.cancelReason = '';
    this.cancelRequestError = null;
  }

  closeCancelRequest(): void {
    this.cancelOrderId = null;
    this.cancelReason = '';
    this.cancelRequestError = null;
  }

  submitCancelRequest(order: Order): void {
    if (this.requestingCancel) return;
    if (!this.cancelOrderId || this.cancelOrderId !== order.id) return;
    if (!this.canRequestCancel(order)) {
      this.cancelRequestError = this.t('account.orders.cancel.errors.notEligible');
      return;
    }

    const reason = this.cancelReason.trim();
    if (!reason) {
      this.cancelRequestError = this.t('account.orders.cancel.errors.reasonRequired');
      return;
    }

    const ref = order.reference_code || order.id;
    if (!confirm(this.t('account.orders.cancel.confirm', { ref }))) return;

    this.requestingCancel = true;
    this.cancelRequestError = null;
    this.account.requestOrderCancellation(order.id, reason).subscribe({
      next: (updated) => {
        this.cancelRequestedOrderIds.add(order.id);
        this.updateOrderInList(updated);
        this.toast.success(this.t('account.orders.cancel.success'));
        this.closeCancelRequest();
      },
      error: (err) => {
        const detail = (err?.error?.detail || '').toString();
        const key =
          detail === 'Cancel request already exists'
            ? 'account.orders.cancel.errors.alreadyRequested'
            : detail === 'Cancel request not eligible'
              ? 'account.orders.cancel.errors.notEligible'
              : detail === 'Cancel reason is required'
                ? 'account.orders.cancel.errors.reasonRequired'
                : 'account.orders.cancel.errors.create';
        this.cancelRequestError = this.t(key);
        this.toast.error(this.cancelRequestError);
      },
      complete: () => (this.requestingCancel = false)
    });
  }

  openReturnRequest(order: Order): void {
    if ((order.status || '').trim().toLowerCase() !== 'delivered') {
      this.toast.error(this.t('account.orders.return.errors.notEligible'));
      return;
    }
    if (this.returnOrderId === order.id) {
      this.closeReturnRequest();
      return;
    }
    this.returnOrderId = order.id;
    this.returnReason = '';
    this.returnCustomerMessage = '';
    this.returnQty = Object.fromEntries((order.items ?? []).map((it) => [it.id, 0]));
    this.returnCreateError = null;
  }

  closeReturnRequest(): void {
    this.returnOrderId = null;
    this.returnReason = '';
    this.returnCustomerMessage = '';
    this.returnQty = {};
    this.returnCreateError = null;
  }

  submitReturnRequest(order: Order): void {
    if (this.creatingReturn) return;
    if (!this.returnOrderId || this.returnOrderId !== order.id) return;
    if ((order.status || '').trim().toLowerCase() !== 'delivered') {
      this.returnCreateError = this.t('account.orders.return.errors.notEligible');
      return;
    }

    const reason = this.returnReason.trim();
    if (!reason) {
      this.returnCreateError = this.t('account.orders.return.errors.reasonRequired');
      return;
    }

    const items: Array<{ order_item_id: string; quantity: number }> = [];
    for (const it of order.items ?? []) {
      const raw = Number(this.returnQty[it.id] ?? 0);
      if (!Number.isFinite(raw) || raw <= 0) continue;
      if (raw > it.quantity) {
        this.returnCreateError = this.t('account.orders.return.errors.invalidQuantity');
        return;
      }
      items.push({ order_item_id: it.id, quantity: Math.floor(raw) });
    }
    if (!items.length) {
      this.returnCreateError = this.t('account.orders.return.errors.itemsRequired');
      return;
    }

    this.creatingReturn = true;
    this.returnCreateError = null;
    this.account
      .createReturnRequest({
        order_id: order.id,
        reason,
        customer_message: this.returnCustomerMessage.trim() || null,
        items
      })
      .subscribe({
        next: () => {
          this.returnRequestedOrderIds.add(order.id);
          this.toast.success(this.t('account.orders.return.success'));
          this.closeReturnRequest();
        },
        error: (err) => {
          const detail = (err?.error?.detail || '').toString();
          const key =
            detail === 'Return request already exists'
              ? 'account.orders.return.errors.alreadyExists'
              : detail === 'Return request not eligible'
                ? 'account.orders.return.errors.notEligible'
                : 'account.orders.return.errors.create';
          this.returnCreateError = this.t(key);
          this.toast.error(this.returnCreateError);
        },
        complete: () => (this.creatingReturn = false)
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
  receiptCopiedId = signal<string | null>(null);
  sharingReceiptId: string | null = null;
  revokingReceiptId: string | null = null;
  private receiptCopiedTimer: number | null = null;

  copyReceiptLink(order: Order): void {
    if (typeof navigator === 'undefined') return;
    const existing = this.receiptShares()[order.id];
    const expiresAt = existing?.expires_at ? new Date(existing.expires_at) : null;

    if (!existing?.receipt_url) {
      this.toast.error(this.t('account.orders.receiptGenerateError'));
      return;
    }

    if (!expiresAt || expiresAt.getTime() <= Date.now() + 30_000) {
      this.shareReceipt(order);
      return;
    }

    void this.copyReceiptUrl(order.id, existing.receipt_url, 'account.orders.receiptReady');
  }

  shareReceipt(order: Order): void {
    if (typeof navigator === 'undefined') return;
    if (this.sharingReceiptId) return;

    const existing = this.receiptShares()[order.id];
    const expiresAt = existing?.expires_at ? new Date(existing.expires_at) : null;
    if (existing?.receipt_url && expiresAt && expiresAt.getTime() > Date.now() + 30_000) {
      void this.copyReceiptUrl(order.id, existing.receipt_url, 'account.orders.receiptReady');
      return;
    }

    this.sharingReceiptId = order.id;
    this.account.shareReceipt(order.id).subscribe({
      next: (token) => {
        this.receiptShares.set({ ...this.receiptShares(), [order.id]: token });
        void this.copyReceiptUrl(order.id, token.receipt_url, 'account.orders.receiptGenerated');
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

  private async copyReceiptUrl(orderId: string, url: string, readyKey: string): Promise<void> {
    const ok = await this.copyToClipboard(url);
    if (ok) {
      this.toast.success(this.t('account.orders.receiptCopied'));
      this.receiptCopiedId.set(orderId);
      if (typeof window !== 'undefined') {
        if (this.receiptCopiedTimer) window.clearTimeout(this.receiptCopiedTimer);
        this.receiptCopiedTimer = window.setTimeout(() => {
          if (this.receiptCopiedId() === orderId) this.receiptCopiedId.set(null);
        }, 2200);
      }
    } else {
      this.toast.success(this.t(readyKey));
    }
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
    const label = existing ? this.normalizeAddressLabel(existing.label) : 'home';
    this.addressModel = {
      line1: existing?.line1 || '',
      line2: existing?.line2 || '',
      city: existing?.city || '',
      region: existing?.region || '',
      postal_code: existing?.postal_code || '',
      country: existing?.country || 'US',
      phone: existing?.phone || null,
      label,
      is_default_shipping: existing?.is_default_shipping,
      is_default_billing: existing?.is_default_billing
    };
    this.addressFormBaseline = { ...this.addressModel };
  }

  duplicateAddress(existing: Address): void {
    this.showAddressForm = true;
    this.editingAddressId = null;
    const label = this.normalizeAddressLabel(existing?.label);
    this.addressModel = {
      line1: existing?.line1 || '',
      line2: existing?.line2 || '',
      city: existing?.city || '',
      region: existing?.region || '',
      postal_code: existing?.postal_code || '',
      country: existing?.country || 'US',
      phone: existing?.phone || null,
      label,
      is_default_shipping: false,
      is_default_billing: false
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

  private normalizeAddressLabel(label: string | null | undefined): string {
    const raw = String(label ?? '').trim();
    if (!raw) return 'home';
    const normalized = raw.toLowerCase();
    if (['home', 'work', 'other'].includes(normalized)) return normalized;

    const homeKeys = new Set(['home', 'acasa', 'acasă', this.t('account.addresses.labels.home').toLowerCase()]);
    const workKeys = new Set(['work', 'serviciu', this.t('account.addresses.labels.work').toLowerCase()]);
    const otherKeys = new Set(['other', 'altul', 'altele', this.t('account.addresses.labels.other').toLowerCase()]);

    if (homeKeys.has(normalized)) return 'home';
    if (workKeys.has(normalized)) return 'work';
    if (otherKeys.has(normalized)) return 'other';
    return raw;
  }

  primaryVerificationResendRemainingSeconds(): number {
    const until = this.primaryVerificationResendUntil();
    if (!until) return 0;
    return Math.max(0, Math.ceil((until - this.now()) / 1_000));
  }

  resendVerification(): void {
    if (this.primaryVerificationResendRemainingSeconds() > 0) return;
    this.auth.requestEmailVerification('/account').subscribe({
      next: () => {
        this.verificationStatus = this.t('account.verification.sentStatus');
        this.primaryVerificationResendUntil.set(Date.now() + 60_000);
        this.toast.success(this.t('account.verification.sentToast'));
      },
      error: () => this.toast.error(this.t('account.verification.sendError'))
    });
  }

  onAvatarChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.uploadAvatar(file);
  }

  uploadAvatar(file: File): void {
    if (this.avatarBusy) return;
    this.avatarBusy = true;
    this.auth.uploadAvatar(file).subscribe({
      next: (user) => {
        this.profile.set(user);
        this.avatar = user.avatar_url ?? null;
        this.toast.success(this.t('account.profile.avatar.updated'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.profile.avatar.uploadError');
        this.toast.error(message);
        this.avatarBusy = false;
      },
      complete: () => {
        this.avatarBusy = false;
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

  phoneNationalPreview(): string {
    return formatNationalAsYouType(this.profilePhoneCountry, this.profilePhoneNational);
  }

  phoneE164Preview(): string | null {
    return formatInternationalPreview(this.profilePhoneCountry, this.profilePhoneNational);
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
          this.loadCooldowns(true);

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

  loadCooldowns(force: boolean = false): void {
    if (!this.auth.isAuthenticated()) return;
    if (this.cooldownsLoading() && !force) return;
    if (this.cooldownsLoaded() && !force) return;

    this.cooldownsLoading.set(true);
    this.cooldownsError.set(null);
    this.auth.getCooldowns().subscribe({
      next: (resp) => {
        this.cooldowns.set(resp);
        this.cooldownsLoaded.set(true);
      },
      error: () => {
        this.cooldownsError.set(this.t('account.cooldowns.loadError'));
        this.cooldownsLoading.set(false);
      },
      complete: () => this.cooldownsLoading.set(false)
    });
  }

  usernameCooldownSeconds(): number {
    return this.cooldownRemainingSeconds(this.cooldowns()?.username);
  }

  displayNameCooldownSeconds(): number {
    return this.cooldownRemainingSeconds(this.cooldowns()?.display_name);
  }

  emailCooldownSeconds(): number {
    return this.cooldownRemainingSeconds(this.cooldowns()?.email);
  }

  formatCooldown(seconds: number): string {
    const remaining = Math.max(0, Math.floor(seconds));
    if (!remaining) return '';

    const days = Math.floor(remaining / 86_400);
    const hours = Math.floor((remaining % 86_400) / 3_600);
    const minutes = Math.floor((remaining % 3_600) / 60);
    const secs = remaining % 60;

    const parts: string[] = [];
    if (days) parts.push(`${days}d`);
    if (hours && parts.length < 2) parts.push(`${hours}h`);
    if (!days && minutes && parts.length < 2) parts.push(`${minutes}m`);
    if (!days && !hours && parts.length < 2) parts.push(`${secs}s`);
    return parts.join(' ');
  }

  private cooldownRemainingSeconds(info: CooldownInfo | null | undefined): number {
    const nextAllowedAt = info?.next_allowed_at ?? null;
    if (!nextAllowedAt) return 0;
    const nextMs = Date.parse(nextAllowedAt);
    if (!Number.isFinite(nextMs)) return 0;
    return Math.max(0, Math.ceil((nextMs - this.now()) / 1_000));
  }

  publicIdentityLabel(user?: AuthUser | null): string {
    const u = user ?? this.profile();
    return formatIdentity(u, '');
  }

  publicIdentityPreviewLabel(): string {
    const u = this.profile();
    return formatIdentity(
      {
        name: this.profileName.trim() || u?.name,
        username: this.profileUsername.trim() || u?.username,
        name_tag: u?.name_tag,
        email: u?.email,
        id: u?.id
      },
      '...'
    );
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

  supportTicketsLabel(): string {
    if (this.ticketsLoading() && !this.ticketsLoaded()) return this.t('notifications.loading');
    if (!this.ticketsLoaded()) return '...';
    const errorKey = this.ticketsError();
    if (errorKey) return this.t(errorKey);
    const list = this.tickets();
    if (!list.length) return this.t('account.overview.support.none');
    const open = list.filter((t) => (t.status || '').toLowerCase() !== 'resolved').length;
    if (open === 0) return this.t('account.overview.support.allResolved');
    if (open === 1) return this.t('account.overview.support.openOne');
    return this.t('account.overview.support.openMany', { count: open });
  }

  supportTicketsSubcopy(): string {
    if (this.ticketsLoading() && !this.ticketsLoaded()) return this.t('notifications.loading');
    if (!this.ticketsLoaded()) return '';
    if (this.ticketsError()) return this.t('account.overview.support.loadErrorCopy');
    const list = this.tickets();
    if (!list.length) return this.t('account.overview.support.noneCopy');
    return this.t('account.overview.support.hint');
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

  private loadLatestExportJob(): void {
    if (!this.auth.isAuthenticated()) return;
    if (this.exportJobLoading()) return;
    this.exportJobLoading.set(true);
    this.exportError = null;
    this.account.getLatestExportJob().subscribe({
      next: (job) => {
        this.exportJob.set(job);
        if (job?.id && (job.status === 'pending' || job.status === 'running')) {
          this.startExportJobPolling(job.id);
        }
      },
      error: (err) => {
        if (Number(err?.status) === 404) {
          this.exportJob.set(null);
          this.exportJobLoading.set(false);
          return;
        }
        const message = err?.error?.detail || this.t('account.privacy.export.loadError');
        this.exportError = message;
        this.toast.error(message);
        this.exportJobLoading.set(false);
      },
      complete: () => this.exportJobLoading.set(false)
    });
  }

  private startExportJobPolling(jobId: string): void {
    if (!jobId) return;
    if (this.exportJobPoll && this.exportJob()?.id === jobId) return;
    this.stopExportJobPolling();
    this.exportJobPoll = window.setInterval(() => {
      if (!this.auth.isAuthenticated() || this.exportJobPollInFlight) return;
      this.exportJobPollInFlight = true;
      this.account.getExportJob(jobId).subscribe({
        next: (job) => {
          const prev = this.exportJob();
          this.exportJob.set(job);
          if (job.status === 'succeeded' || job.status === 'failed') {
            this.stopExportJobPolling();
            if (job.status === 'succeeded' && job.id && this.exportReadyToastShownForJobId !== job.id) {
              this.exportReadyToastShownForJobId = job.id;
              this.toast.success(this.t('account.privacy.export.readyToast'));
              this.notificationsService.refreshUnreadCount();
            }
          } else if (prev?.status !== job.status) {
            // Keep polling as status transitions between pending/running.
          }
        },
        error: () => {
          // Keep polling; a transient API error should not stop the UI.
        },
        complete: () => {
          this.exportJobPollInFlight = false;
        }
      });
    }, 2_000);
  }

  private stopExportJobPolling(): void {
    if (!this.exportJobPoll) return;
    window.clearInterval(this.exportJobPoll);
    this.exportJobPoll = undefined;
    this.exportJobPollInFlight = false;
  }

  requestDataExport(): void {
    if (!this.auth.isAuthenticated()) return;
    if (this.exportJobLoading() || this.exportingData) return;
    this.exportJobLoading.set(true);
    this.exportError = null;
    this.account.startExportJob().subscribe({
      next: (job) => {
        this.exportJob.set(job);
        if (job.status === 'pending' || job.status === 'running') {
          this.toast.success(this.t('account.privacy.export.startedToast'));
          this.startExportJobPolling(job.id);
        }
        if (job.status === 'succeeded') {
          this.exportReadyToastShownForJobId = job.id;
        }
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.privacy.export.startError');
        this.exportError = message;
        this.toast.error(message);
        this.exportJobLoading.set(false);
      },
      complete: () => this.exportJobLoading.set(false)
    });
  }

  downloadExportJob(): void {
    const job = this.exportJob();
    if (this.exportingData || !this.auth.isAuthenticated() || !job?.id || job.status !== 'succeeded') return;
    this.exportingData = true;
    this.exportError = null;
    this.account.downloadExportJob(job.id).subscribe({
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

  downloadMyData(): void {
    const job = this.exportJob();
    if (job?.status === 'succeeded') {
      this.downloadExportJob();
      return;
    }
    this.requestDataExport();
  }

  exportActionLabelKey(): string {
    const job = this.exportJob();
    if (this.exportJobLoading()) return 'account.privacy.export.actionWorking';
    if (!job) return 'account.privacy.export.actionGenerate';
    if (job.status === 'succeeded') return this.exportingData ? 'account.privacy.export.actionDownloading' : 'account.privacy.export.actionDownload';
    if (job.status === 'failed') return 'account.privacy.export.actionRetry';
    return 'account.privacy.export.actionGenerating';
  }

  exportActionDisabled(): boolean {
    const job = this.exportJob();
    if (this.exportingData || this.exportJobLoading()) return true;
    return job?.status === 'pending' || job?.status === 'running';
  }

  requestDeletion(): void {
    if (this.requestingDeletion || !this.auth.isAuthenticated()) return;
    const password = this.deletionPassword.trim();
    if (!password) {
      const message = this.t('auth.currentPasswordRequired');
      this.deletionError.set(message);
      this.toast.error(message);
      return;
    }
    this.requestingDeletion = true;
    this.deletionError.set(null);
    this.account.requestAccountDeletion(this.deletionConfirmText, password).subscribe({
      next: (status) => {
        this.deletionStatus.set(status);
        this.deletionConfirmText = '';
        this.deletionPassword = '';
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

  deletionCooldownRemainingMs(): number | null {
    const status = this.deletionStatus();
    const scheduled = this.parseTimestampMs(status?.scheduled_for);
    if (!scheduled) return null;
    const remaining = scheduled - this.now();
    return remaining > 0 ? remaining : 0;
  }

  deletionCooldownProgressPercent(): number {
    const status = this.deletionStatus();
    const start = this.parseTimestampMs(status?.requested_at);
    const end = this.parseTimestampMs(status?.scheduled_for);
    if (!start || !end || end <= start) return 0;
    const pct = ((this.now() - start) / (end - start)) * 100;
    if (!Number.isFinite(pct)) return 0;
    return Math.min(100, Math.max(0, pct));
  }

  formatDurationShort(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  private parseTimestampMs(value: string | null | undefined): number | null {
    if (!value) return null;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
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
    if (this.nowInterval) {
      clearInterval(this.nowInterval);
    }
    this.stopExportJobPolling();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.routerEventsSub?.unsubscribe();
    this.phoneCountriesEffect?.destroy();
    window.removeEventListener('mousemove', this.handleUserActivity);
    window.removeEventListener('keydown', this.handleUserActivity);
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
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

  private loadSessions(force: boolean = false): void {
    if (!this.auth.isAuthenticated()) return;
    if (this.sessionsLoading() && !force) return;
    if (this.sessionsLoaded() && !force) return;
    this.sessionsLoading.set(true);
    this.sessionsError.set(null);
    this.auth.listSessions().subscribe({
      next: (sessions) => {
        this.sessions.set(sessions ?? []);
        this.sessionsLoaded.set(true);
      },
      error: () => {
        this.sessions.set([]);
        this.sessionsError.set(this.t('account.security.devices.loadError'));
        this.sessionsLoading.set(false);
      },
      complete: () => this.sessionsLoading.set(false)
    });
  }

  private loadSecurityEvents(force: boolean = false): void {
    if (!this.auth.isAuthenticated()) return;
    if (this.securityEventsLoading() && !force) return;
    if (this.securityEventsLoaded() && !force) return;
    this.securityEventsLoading.set(true);
    this.securityEventsError.set(null);
    this.auth.listSecurityEvents(30).subscribe({
      next: (events) => {
        this.securityEvents.set(events ?? []);
        this.securityEventsLoaded.set(true);
      },
      error: () => {
        this.securityEvents.set([]);
        this.securityEventsError.set(this.t('account.security.activity.loadError'));
        this.securityEventsLoading.set(false);
      },
      complete: () => this.securityEventsLoading.set(false)
    });
  }

  private loadTwoFactorStatus(force: boolean = false): void {
    if (!this.auth.isAuthenticated()) return;
    if (this.twoFactorLoading() && !force) return;
    if (this.twoFactorLoaded() && !force) return;
    this.twoFactorLoading.set(true);
    this.twoFactorError.set(null);
    this.auth.getTwoFactorStatus().subscribe({
      next: (status) => {
        this.twoFactorStatus.set(status);
        this.twoFactorLoaded.set(true);
      },
      error: () => {
        this.twoFactorStatus.set(null);
        this.twoFactorLoaded.set(true);
        this.twoFactorError.set(this.t('account.security.twoFactor.loadError'));
        this.twoFactorLoading.set(false);
      },
      complete: () => this.twoFactorLoading.set(false)
    });
  }

  passkeysSupported(): boolean {
    return isWebAuthnSupported();
  }

  private loadPasskeys(force: boolean = false): void {
    if (!this.auth.isAuthenticated()) return;
    if (!this.passkeysSupported()) {
      this.passkeys.set([]);
      this.passkeysLoaded.set(true);
      return;
    }
    if (this.passkeysLoading() && !force) return;
    if (this.passkeysLoaded() && !force) return;
    this.passkeysLoading.set(true);
    this.passkeysError.set(null);
    this.auth.listPasskeys().subscribe({
      next: (passkeys) => {
        this.passkeys.set(passkeys ?? []);
        this.passkeysLoaded.set(true);
      },
      error: () => {
        this.passkeys.set([]);
        this.passkeysLoaded.set(true);
        this.passkeysError.set(this.t('account.security.passkeys.loadError'));
        this.passkeysLoading.set(false);
      },
      complete: () => this.passkeysLoading.set(false)
    });
  }

  registerPasskey(): void {
    if (!this.auth.isAuthenticated() || this.registeringPasskey) return;
    if (!this.passkeysSupported()) {
      this.toast.error(this.t('account.security.passkeys.notSupported'));
      return;
    }
    const password = this.passkeyRegisterPassword.trim();
    if (!password) {
      this.toast.error(this.t('auth.completeForm'));
      return;
    }

    this.registeringPasskey = true;
    this.passkeysError.set(null);

    this.auth.startPasskeyRegistration(password).subscribe({
      next: async (res) => {
        try {
          const publicKey = toPublicKeyCredentialCreationOptions(res.options);
          const credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
          if (!credential) {
            this.registeringPasskey = false;
            return;
          }
          const payload = serializePublicKeyCredential(credential);
          const name = this.passkeyRegisterName.trim() || null;
          this.auth.completePasskeyRegistration(res.registration_token, payload, name).subscribe({
            next: () => {
              this.toast.success(this.t('account.security.passkeys.added'));
              this.passkeyRegisterPassword = '';
              this.passkeyRegisterName = '';
              this.loadPasskeys(true);
              this.refreshSecurityEvents();
            },
            error: (err) => {
              const message = err?.error?.detail || this.t('account.security.passkeys.addError');
              this.passkeysError.set(message);
              this.toast.error(message);
            },
            complete: () => {
              this.registeringPasskey = false;
            }
          });
        } catch (err: any) {
          const name = err?.name || '';
          if (name === 'NotAllowedError') {
            this.toast.info(this.t('account.security.passkeys.cancelled'));
          } else {
            const message = err?.message || this.t('account.security.passkeys.addError');
            this.toast.error(message);
          }
          this.registeringPasskey = false;
        }
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.security.passkeys.addError');
        this.passkeysError.set(message);
        this.toast.error(message);
        this.registeringPasskey = false;
      }
    });
  }

  startRemovePasskey(passkeyId: string): void {
    if (!this.auth.isAuthenticated() || this.removingPasskeyId) return;
    this.removePasskeyConfirmId = passkeyId;
    this.removePasskeyPassword = '';
    this.passkeysError.set(null);
  }

  cancelRemovePasskey(): void {
    if (this.removingPasskeyId) return;
    this.removePasskeyConfirmId = null;
    this.removePasskeyPassword = '';
  }

  confirmRemovePasskey(): void {
    if (!this.auth.isAuthenticated() || this.removingPasskeyId) return;
    const passkeyId = this.removePasskeyConfirmId;
    if (!passkeyId) return;
    if (!confirm(this.t('account.security.passkeys.removeConfirm'))) return;
    const password = this.removePasskeyPassword.trim();
    if (!password) {
      const message = this.t('auth.currentPasswordRequired');
      this.passkeysError.set(message);
      this.toast.error(message);
      return;
    }
    this.removingPasskeyId = passkeyId;
    this.passkeysError.set(null);
    this.auth.deletePasskey(passkeyId, password).subscribe({
      next: () => {
        this.toast.success(this.t('account.security.passkeys.removed'));
        this.passkeys.set(this.passkeys().filter((p) => p.id !== passkeyId));
        this.removePasskeyConfirmId = null;
        this.removePasskeyPassword = '';
        this.refreshSecurityEvents();
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.security.passkeys.removeError');
        this.passkeysError.set(message);
        this.toast.error(message);
      },
      complete: () => {
        this.removingPasskeyId = null;
      }
    });
  }

  startTwoFactorSetup(): void {
    if (!this.auth.isAuthenticated() || this.startingTwoFactor) return;
    const password = this.twoFactorSetupPassword.trim();
    if (!password) {
      this.toast.error(this.t('auth.completeForm'));
      return;
    }
    this.startingTwoFactor = true;
    this.twoFactorError.set(null);
    this.twoFactorRecoveryCodes = null;
    this.auth.startTwoFactorSetup(password).subscribe({
      next: (res: TwoFactorSetupResponse) => {
        this.twoFactorSetupSecret = res.secret;
        this.twoFactorSetupUrl = res.otpauth_url;
        void this.updateTwoFactorSetupQr();
        this.twoFactorSetupPassword = '';
        this.twoFactorEnableCode = '';
        this.toast.info(this.t('account.security.activity.two_factor_setup_started'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.security.twoFactor.startError');
        this.twoFactorError.set(message);
        this.toast.error(message);
      },
      complete: () => {
        this.startingTwoFactor = false;
      }
    });
  }

  enableTwoFactor(): void {
    if (!this.auth.isAuthenticated() || this.enablingTwoFactor) return;
    const code = this.twoFactorEnableCode.trim();
    if (!code) {
      this.toast.error(this.t('auth.completeForm'));
      return;
    }
    this.enablingTwoFactor = true;
    this.twoFactorError.set(null);
    this.auth.enableTwoFactor(code).subscribe({
      next: (res: TwoFactorEnableResponse) => {
        this.twoFactorRecoveryCodes = res.recovery_codes ?? [];
        this.twoFactorSetupSecret = null;
        this.twoFactorSetupUrl = null;
        this.twoFactorSetupQrDataUrl = null;
        this.twoFactorEnableCode = '';
        this.toast.success(this.t('account.security.activity.two_factor_enabled'));
        this.loadTwoFactorStatus(true);
        this.auth.loadCurrentUser().subscribe({ error: () => void 0 });
        this.refreshSecurityEvents();
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.security.twoFactor.enableError');
        this.twoFactorError.set(message);
        this.toast.error(message);
      },
      complete: () => {
        this.enablingTwoFactor = false;
      }
    });
  }

  async copyTwoFactorSecret(): Promise<void> {
    if (!this.twoFactorSetupSecret) return;
    const ok = await this.copyToClipboard(this.twoFactorSetupSecret);
    this.toast.success(ok ? this.t('account.security.twoFactor.copied') : this.t('account.security.twoFactor.copySecret'));
  }

  async copyTwoFactorSetupUrl(): Promise<void> {
    if (!this.twoFactorSetupUrl) return;
    const ok = await this.copyToClipboard(this.twoFactorSetupUrl);
    this.toast.success(ok ? this.t('account.security.twoFactor.copied') : this.t('account.security.twoFactor.copyUrl'));
  }

  private async updateTwoFactorSetupQr(): Promise<void> {
    const requestId = ++this.twoFactorQrRequestId;
    this.twoFactorSetupQrDataUrl = null;
    const url = (this.twoFactorSetupUrl || '').trim();
    if (!url) return;
    try {
      const { Byte, Encoder } = await import('@nuintun/qrcode');
      const encoder = new Encoder({ level: 'M' });
      const qr = encoder.encode(new Byte(url));
      const margin = 1;
      const desiredSizePx = 196;
      const moduleSize = Math.max(2, Math.floor(desiredSizePx / (qr.size + margin * 2)));
      const dataUrl = qr.toDataURL(moduleSize, { margin });
      if (requestId !== this.twoFactorQrRequestId) return;
      this.twoFactorSetupQrDataUrl = dataUrl;
    } catch {
      // ignore
    }
  }

  async copyTwoFactorRecoveryCodes(): Promise<void> {
    if (!this.twoFactorRecoveryCodes?.length) return;
    const ok = await this.copyToClipboard(this.twoFactorRecoveryCodes.join('\n'));
    this.toast.success(ok ? this.t('account.security.twoFactor.copied') : this.t('account.security.twoFactor.copyCodes'));
  }

  regenerateTwoFactorRecoveryCodes(): void {
    if (!this.auth.isAuthenticated() || this.regeneratingTwoFactorCodes) return;
    if (!confirm(this.t('account.security.twoFactor.regenerateConfirm'))) return;
    const password = this.twoFactorManagePassword.trim();
    const code = this.twoFactorManageCode.trim();
    if (!password || !code) {
      this.toast.error(this.t('auth.completeForm'));
      return;
    }
    this.regeneratingTwoFactorCodes = true;
    this.twoFactorError.set(null);
    this.auth.regenerateTwoFactorRecoveryCodes(password, code).subscribe({
      next: (res: TwoFactorEnableResponse) => {
        this.twoFactorRecoveryCodes = res.recovery_codes ?? [];
        this.twoFactorManageCode = '';
        this.toast.success(this.t('account.security.activity.two_factor_recovery_regenerated'));
        this.loadTwoFactorStatus(true);
        this.refreshSecurityEvents();
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.security.twoFactor.regenerateError');
        this.twoFactorError.set(message);
        this.toast.error(message);
      },
      complete: () => {
        this.regeneratingTwoFactorCodes = false;
      }
    });
  }

  disableTwoFactor(): void {
    if (!this.auth.isAuthenticated() || this.disablingTwoFactor) return;
    if (!confirm(this.t('account.security.twoFactor.disableConfirm'))) return;
    const password = this.twoFactorManagePassword.trim();
    const code = this.twoFactorManageCode.trim();
    if (!password || !code) {
      this.toast.error(this.t('auth.completeForm'));
      return;
    }
    this.disablingTwoFactor = true;
    this.twoFactorError.set(null);
    this.auth.disableTwoFactor(password, code).subscribe({
      next: (status) => {
        this.twoFactorStatus.set(status);
        this.twoFactorLoaded.set(true);
        this.twoFactorRecoveryCodes = null;
        this.twoFactorManageCode = '';
        this.twoFactorManagePassword = '';
        this.toast.success(this.t('account.security.activity.two_factor_disabled'));
        this.auth.loadCurrentUser().subscribe({ error: () => void 0 });
        this.refreshSecurityEvents();
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.security.twoFactor.disableError');
        this.twoFactorError.set(message);
        this.toast.error(message);
      },
      complete: () => {
        this.disablingTwoFactor = false;
      }
    });
  }

  refreshSecurityEvents(): void {
    this.loadSecurityEvents(true);
  }

  otherSessionsCount(): number {
    return (this.sessions() ?? []).filter((s) => !s.is_current).length;
  }

  startRevokeOtherSessions(): void {
    if (this.revokingOtherSessions || !this.auth.isAuthenticated()) return;
    this.revokeOtherSessionsPassword = '';
    this.revokeOtherSessionsConfirming = true;
    this.sessionsError.set(null);
  }

  cancelRevokeOtherSessions(): void {
    if (this.revokingOtherSessions) return;
    this.revokeOtherSessionsPassword = '';
    this.revokeOtherSessionsConfirming = false;
  }

  confirmRevokeOtherSessions(): void {
    if (this.revokingOtherSessions || !this.auth.isAuthenticated()) return;
    if (!this.revokeOtherSessionsConfirming) return;
    if (!confirm(this.t('account.security.devices.revokeConfirm'))) return;
    const password = this.revokeOtherSessionsPassword.trim();
    if (!password) {
      const message = this.t('auth.currentPasswordRequired');
      this.sessionsError.set(message);
      this.toast.error(message);
      return;
    }
    this.revokingOtherSessions = true;
    this.sessionsError.set(null);
    this.auth.revokeOtherSessions(password).subscribe({
      next: (res) => {
        const revoked = res?.revoked ?? 0;
        if (revoked > 0) {
          this.toast.success(this.t('account.security.devices.revoked', { count: revoked }));
        } else {
          this.toast.success(this.t('account.security.devices.noneRevoked'));
        }
        this.loadSessions(true);
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.security.devices.revokeError');
        this.sessionsError.set(message);
        this.toast.error(message);
      },
      complete: () => {
        this.revokingOtherSessions = false;
        this.revokeOtherSessionsConfirming = false;
        this.revokeOtherSessionsPassword = '';
      }
    });
  }

  secondaryEmailResendRemainingSeconds(secondaryEmailId: string): number {
    const until = this.secondaryEmailResendUntilById()[secondaryEmailId];
    if (!until) return 0;
    return Math.max(0, Math.ceil((until - this.now()) / 1_000));
  }

  startSecondaryEmailVerification(secondaryEmailId: string): void {
    this.cancelMakePrimary();
    this.cancelDeleteSecondaryEmail();
    this.secondaryVerificationEmailId = secondaryEmailId;
    this.secondaryVerificationToken = '';
    this.secondaryVerificationStatus = null;
  }

  cancelSecondaryEmailVerification(): void {
    this.secondaryVerificationEmailId = null;
    this.secondaryVerificationToken = '';
    this.secondaryVerificationStatus = null;
  }

  private bumpSecondaryEmailResendCooldown(secondaryEmailId: string): void {
    const current = this.secondaryEmailResendUntilById();
    this.secondaryEmailResendUntilById.set({ ...current, [secondaryEmailId]: Date.now() + 60_000 });
  }

  private clearSecondaryEmailResendCooldown(secondaryEmailId: string): void {
    const current = { ...this.secondaryEmailResendUntilById() };
    if (!(secondaryEmailId in current)) return;
    delete current[secondaryEmailId];
    this.secondaryEmailResendUntilById.set(current);
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
        this.bumpSecondaryEmailResendCooldown(created.id);
        this.startSecondaryEmailVerification(created.id);
        this.toast.success(this.t('account.security.emails.added'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.security.emails.addError');
        this.secondaryEmailMessage = message;
        this.toast.error(message);
        this.addingSecondaryEmail = false;
      },
      complete: () => {
        this.addingSecondaryEmail = false;
      }
    });
  }

  resendSecondaryEmailVerification(secondaryEmailId: string): void {
    if (this.secondaryEmailResendRemainingSeconds(secondaryEmailId) > 0) return;
    this.secondaryEmailMessage = null;
    this.secondaryVerificationStatus = null;
    this.auth.requestSecondaryEmailVerification(secondaryEmailId, '/account').subscribe({
      next: () => {
        this.secondaryEmailMessage = this.t('account.security.emails.verificationResent');
        this.bumpSecondaryEmailResendCooldown(secondaryEmailId);
        this.startSecondaryEmailVerification(secondaryEmailId);
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
    if (!this.secondaryVerificationEmailId) return;
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
        this.secondaryVerificationEmailId = null;
        this.secondaryEmailMessage = this.t('account.security.emails.verified');
        this.clearSecondaryEmailResendCooldown(verified.id);
        this.toast.success(this.t('account.verification.verifiedToast'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.security.emails.verifyError');
        this.secondaryVerificationStatus = message;
        this.toast.error(message);
        this.verifyingSecondaryEmail = false;
      },
      complete: () => {
        this.verifyingSecondaryEmail = false;
      }
    });
  }

  startDeleteSecondaryEmail(secondaryEmailId: string): void {
    if (this.removingSecondaryEmail) return;
    this.cancelMakePrimary();
    this.cancelSecondaryEmailVerification();
    this.removeSecondaryEmailId = secondaryEmailId;
    this.removeSecondaryEmailPassword = '';
    this.secondaryEmailMessage = null;
    this.secondaryVerificationStatus = null;
  }

  cancelDeleteSecondaryEmail(): void {
    if (this.removingSecondaryEmail) return;
    this.removeSecondaryEmailId = null;
    this.removeSecondaryEmailPassword = '';
  }

  confirmDeleteSecondaryEmail(): void {
    if (this.removingSecondaryEmail) return;
    const secondaryEmailId = this.removeSecondaryEmailId;
    if (!secondaryEmailId) return;
    if (!confirm(this.t('account.security.emails.removeConfirm'))) return;
    const password = this.removeSecondaryEmailPassword.trim();
    if (!password) {
      const message = this.t('auth.currentPasswordRequired');
      this.toast.error(message);
      return;
    }
    this.removingSecondaryEmail = true;
    this.secondaryEmailMessage = null;
    this.secondaryVerificationStatus = null;
    this.auth.deleteSecondaryEmail(secondaryEmailId, password).subscribe({
      next: () => {
        this.secondaryEmails.set(this.secondaryEmails().filter((e) => e.id !== secondaryEmailId));
        if (this.secondaryVerificationEmailId === secondaryEmailId) {
          this.cancelSecondaryEmailVerification();
        }
        this.clearSecondaryEmailResendCooldown(secondaryEmailId);
        this.removeSecondaryEmailId = null;
        this.removeSecondaryEmailPassword = '';
        this.toast.success(this.t('account.security.emails.removed'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.t('account.security.emails.removeError');
        this.secondaryEmailMessage = message;
        this.toast.error(message);
        this.removingSecondaryEmail = false;
      },
      complete: () => {
        this.removingSecondaryEmail = false;
      }
    });
  }

  startMakePrimary(secondaryEmailId: string): void {
    this.cancelSecondaryEmailVerification();
    this.cancelDeleteSecondaryEmail();
    this.makePrimarySecondaryEmailId = secondaryEmailId;
    this.makePrimaryPassword = '';
    this.makePrimaryError = null;
  }

  cancelMakePrimary(): void {
    this.makePrimarySecondaryEmailId = null;
    this.makePrimaryPassword = '';
    this.makePrimaryError = null;
  }

  private readPendingGoogleLinkContext(): PendingGoogleLink | null {
    return this.googleLinkPendingService.getPending();
  }

  private clearPendingGoogleLinkContext(): void {
    this.googleLinkPendingService.clear();
    this.googleLinkPending = false;
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
        this.loadCooldowns(true);
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
    this.googleError = null;
    const pendingContext = this.readPendingGoogleLinkContext();
    if (pendingContext) {
      const password = this.googlePassword.trim();
      if (!password) {
        this.googleError = this.t('account.security.google.passwordRequiredLink');
        return;
      }
      this.googleBusy = true;
      this.auth.completeGoogleLink(pendingContext.code, pendingContext.state, password).subscribe({
        next: (user) => {
          this.googleEmail.set(user.google_email ?? null);
          this.googlePicture.set(user.google_picture_url ?? null);
          this.profile.set(user);
          this.googlePassword = '';
          this.clearPendingGoogleLinkContext();
          if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(GOOGLE_FLOW_KEY);
          }
          this.toast.success(this.t('auth.googleLinkSuccess'), user.email);
        },
        error: (err) => {
          const message = err?.error?.detail || this.t('auth.googleError');
          this.googleError = message;
          this.toast.error(message);
        },
        complete: () => {
          this.googleBusy = false;
        }
      });
      return;
    }

    this.googleBusy = true;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GOOGLE_FLOW_KEY, 'link');
    }
    this.auth.startGoogleLink().subscribe({
      next: (url) => {
        window.location.href = url;
      },
      error: (err) => {
        this.clearPendingGoogleLinkContext();
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(GOOGLE_FLOW_KEY);
        }
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
    const cached = this.latestOrder();
    if (cached) return cached;
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
    const phoneRaw = typeof model.phone === 'string' ? model.phone.trim() : '';
    return {
      label: (model.label ?? '').trim(),
      line1: (model.line1 ?? '').trim(),
      line2: (model.line2 ?? '').trim(),
      city: (model.city ?? '').trim(),
      region: (model.region ?? '').trim(),
      postal_code: (model.postal_code ?? '').trim(),
      country: (model.country ?? '').trim(),
      phone: phoneRaw || null,
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
      (an.phone || '') === (bn.phone || '') &&
      Boolean(an.is_default_shipping) === Boolean(bn.is_default_shipping) &&
      Boolean(an.is_default_billing) === Boolean(bn.is_default_billing)
    );
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }
}

