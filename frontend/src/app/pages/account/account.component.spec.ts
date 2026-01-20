import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { AccountComponent } from './account.component';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { AccountService, Address, Order } from '../../core/account.service';
import { BlogService } from '../../core/blog.service';
import { ApiService } from '../../core/api.service';
import { WishlistService } from '../../core/wishlist.service';
import { ThemeService } from '../../core/theme.service';
import { LanguageService } from '../../core/language.service';
import { CartStore } from '../../core/cart.store';
import { CouponsService } from '../../core/coupons.service';
import { NotificationsService } from '../../core/notifications.service';

describe('AccountComponent', () => {
  let toast: jasmine.SpyObj<ToastService>;
  let auth: jasmine.SpyObj<AuthService>;
  let account: jasmine.SpyObj<AccountService>;
  let blog: jasmine.SpyObj<BlogService>;
  let api: jasmine.SpyObj<ApiService>;
  let wishlist: any;
  let coupons: jasmine.SpyObj<CouponsService>;
  let notifications: any;
  let theme: any;
  let lang: any;
  let cart: jasmine.SpyObj<CartStore>;

  const profile = {
    id: 'u1',
    email: 'user@example.com',
    role: 'customer',
    name: 'User',
    phone: '+40723204204',
    avatar_url: null,
    email_verified: true,
    preferred_language: 'en',
    notify_blog_comments: false,
    notify_blog_comment_replies: true,
    notify_marketing: false,
    google_sub: null,
    google_email: null,
    google_picture_url: null,
    created_at: '2000-01-01T00:00:00+00:00',
    updated_at: '2000-01-02T00:00:00+00:00'
  };

  const addresses: Address[] = [
    {
      id: 'a1',
      label: 'Home',
      line1: '123 Main',
      line2: null,
      city: 'Bucharest',
      region: 'IF',
      postal_code: '010203',
      country: 'RO',
      is_default_shipping: true,
      is_default_billing: false
    }
  ];

  const orders: Order[] = [
    {
      id: 'o1',
      reference_code: 'REF123',
      status: 'shipped',
      total_amount: 20,
      currency: 'RON',
      tracking_number: 'TRACK1',
      created_at: '2000-01-03T00:00:00+00:00',
      updated_at: '2000-01-03T00:00:00+00:00',
      items: [
        {
          id: 'i1',
          product_id: 'p1',
          product: { id: 'p1', slug: 'prod', name: 'Prod' },
          quantity: 1,
          unit_price: 20,
          subtotal: 20
        }
      ]
    }
  ];

  beforeEach(() => {
    localStorage.removeItem('account.lastSection');
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);
    auth = jasmine.createSpyObj<AuthService>('AuthService', [
      'isAuthenticated',
      'updateNotificationPreferences',
      'logout',
      'role',
      'isAdmin',
      'getAliases',
      'listEmails'
    ]);
    auth.isAuthenticated.and.returnValue(true);
    auth.role.and.returnValue('customer');
    auth.isAdmin.and.returnValue(false);
    auth.updateNotificationPreferences.and.returnValue(of({ ...profile, notify_marketing: true } as any));
    auth.logout.and.returnValue(of(void 0));
    auth.getAliases.and.returnValue(of({ usernames: [], display_names: [] } as any));
    auth.listEmails.and.returnValue(of({ primary_email: profile.email, primary_verified: true, secondary_emails: [] } as any));

    account = jasmine.createSpyObj<AccountService>('AccountService', [
      'getProfile',
      'getAddresses',
      'getOrders',
      'getDeletionStatus',
      'requestAccountDeletion',
      'cancelAccountDeletion',
      'reorderOrder',
      'downloadReceipt',
      'createAddress',
      'updateAddress',
      'deleteAddress'
    ]);
    account.getProfile.and.returnValue(of(profile as any));
    account.getAddresses.and.returnValue(of(addresses));
    account.getOrders.and.returnValue(of(orders));
    account.getDeletionStatus.and.returnValue(of({ requested_at: null, scheduled_for: null, deleted_at: null, cooldown_hours: 24 }));
    account.reorderOrder.and.returnValue(of({}));
    account.downloadReceipt.and.returnValue(of(new Blob(['pdf'], { type: 'application/pdf' })));

    blog = jasmine.createSpyObj<BlogService>('BlogService', ['listMyComments']);
    blog.listMyComments.and.returnValue(of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 10 } }));

    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post', 'delete']);
    api.get.and.returnValue(of([]));

    const wishlistItems = [
      { id: 'p1', slug: 'p1', name: 'P1', base_price: 10, currency: 'RON', stock_quantity: 5, images: [] },
      { id: 'p2', slug: 'p2', name: 'P2', base_price: 12, currency: 'RON', stock_quantity: 1, images: [] }
    ];
    wishlist = {
      items: () => wishlistItems,
      isLoaded: jasmine.createSpy('isLoaded').and.returnValue(true),
      ensureLoaded: jasmine.createSpy('ensureLoaded'),
      isWishlisted: jasmine.createSpy('isWishlisted').and.returnValue(true),
      add: jasmine.createSpy('add').and.returnValue(of(wishlistItems[0])),
      remove: jasmine.createSpy('remove').and.returnValue(of(void 0)),
      addLocal: jasmine.createSpy('addLocal'),
      removeLocal: jasmine.createSpy('removeLocal'),
      refresh: jasmine.createSpy('refresh'),
      clear: jasmine.createSpy('clear')
    };

    coupons = jasmine.createSpyObj<CouponsService>('CouponsService', ['myCoupons', 'eligibility', 'validate']);
    coupons.myCoupons.and.returnValue(of([] as any));

    notifications = {
      unreadCount: () => 0,
      refreshUnreadCount: jasmine.createSpy('refreshUnreadCount')
    };

    const modeSig = signal<'light' | 'dark'>('light');
    const prefSig = signal<'light' | 'dark' | 'system'>('system');
    theme = {
      mode: () => modeSig.asReadonly(),
      preference: () => prefSig.asReadonly(),
      setPreference: (pref: 'light' | 'dark' | 'system') => prefSig.set(pref)
    };

    lang = {
      language: () => 'en',
      setLanguage: jasmine.createSpy('setLanguage')
    };

    cart = jasmine.createSpyObj<CartStore>('CartStore', ['loadFromBackend']);

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), AccountComponent],
      providers: [
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: auth },
        { provide: AccountService, useValue: account },
        { provide: BlogService, useValue: blog },
        { provide: ApiService, useValue: api },
        { provide: WishlistService, useValue: wishlist },
        { provide: CouponsService, useValue: coupons },
        { provide: NotificationsService, useValue: notifications },
        { provide: ThemeService, useValue: theme },
        { provide: LanguageService, useValue: lang },
        { provide: CartStore, useValue: cart }
      ]
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        account: {
          overview: {
            lastOrderLabel: '#{{ref}} · {{status}}',
            wishlistCountOne: '1 saved item',
            wishlistCountMany: '{{count}} saved items'
          }
        }
      },
      true
    );
    translate.setDefaultLang('en');
    void translate.use('en');
  });

  it('computes overview summaries from last order and default shipping address', () => {
    const fixture = TestBed.createComponent(AccountComponent);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();
    fixture.detectChanges();

    expect(account.getProfile).toHaveBeenCalled();
    expect(wishlist.ensureLoaded).toHaveBeenCalled();

    expect(cmp.lastOrderLabel()).toContain('#REF123');
    expect(cmp.lastOrderLabel()).toContain('shipped');
    expect(cmp.defaultAddressLabel()).toContain('Home');
    expect(cmp.wishlistCountLabel()).toContain('2 saved items');
  });

  it('saves notification preferences via AuthService', () => {
    const fixture = TestBed.createComponent(AccountComponent);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();
    fixture.detectChanges();

    cmp.notifyBlogComments = true;
    cmp.notifyBlogCommentReplies = false;
    cmp.notifyMarketing = true;

    cmp.saveNotifications();

    expect(auth.updateNotificationPreferences).toHaveBeenCalledWith({
      notify_blog_comments: true,
      notify_blog_comment_replies: false,
      notify_marketing: true
    });
    expect(cmp.notificationsMessage).toBe('account.notifications.saved');
  });

  it('reorders an order and routes to cart', () => {
    const fixture = TestBed.createComponent(AccountComponent);
    const cmp = fixture.componentInstance;
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigateByUrl');
    fixture.detectChanges();
    fixture.detectChanges();

    cmp.reorder(orders[0]);

    expect(account.reorderOrder).toHaveBeenCalledWith('o1');
    expect(cart.loadFromBackend).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
    expect(navSpy).toHaveBeenCalledWith('/cart');
    expect(cmp.reorderingOrderId).toBeNull();
  });
});
