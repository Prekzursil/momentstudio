import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';

import { AccountService, Address, Order } from '../../core/account.service';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { BlogService } from '../../core/blog.service';
import { CartStore } from '../../core/cart.store';
import { CouponsService } from '../../core/coupons.service';
import { LanguageService } from '../../core/language.service';
import { NotificationsService } from '../../core/notifications.service';
import { ThemeService } from '../../core/theme.service';
import { TicketsService } from '../../core/tickets.service';
import { ToastService } from '../../core/toast.service';
import { WishlistService } from '../../core/wishlist.service';
import { AccountComponent } from './account.component';
import { AccountProfileComponent } from './account-profile.component';

/**
 * Golden WU acct54 — N=3 NEW uncovered account/profile arms:
 * form dirty/save guards, avatar crop zoom normalize, section toggles.
 * Existing account.component.spec.ts only covers overview/notifications/reorder.
 */
describe('Account profile arms (golden WU acct54)', () => {
  describe('form dirty/save guards + section toggles', () => {
    let toast: jasmine.SpyObj<ToastService>;
    let auth: jasmine.SpyObj<AuthService>;
    let account: jasmine.SpyObj<AccountService>;
    let blog: jasmine.SpyObj<BlogService>;
    let api: jasmine.SpyObj<ApiService>;
    let wishlist: {
      items: () => unknown[];
      isLoaded: jasmine.Spy;
      ensureLoaded: jasmine.Spy;
    };
    let coupons: jasmine.SpyObj<CouponsService>;
    let notifications: { unreadCount: () => number; refreshUnreadCount: jasmine.Spy };
    let tickets: jasmine.SpyObj<TicketsService>;
    let theme: {
      mode: () => 'light' | 'dark';
      preference: () => () => 'light' | 'dark' | 'system';
      setPreference: jasmine.Spy;
    };
    let lang: { language: () => string; setLanguage: jasmine.Spy };
    let cart: jasmine.SpyObj<CartStore>;

    const profile = {
      id: 'u1',
      email: 'user@example.com',
      role: 'customer',
      name: 'User',
      username: 'userone',
      first_name: 'U',
      middle_name: '',
      last_name: 'Ser',
      date_of_birth: '1990-01-01',
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
      updated_at: '2000-01-02T00:00:00+00:00',
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
        is_default_billing: false,
      },
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
            subtotal: 20,
          },
        ],
      },
    ];

    beforeEach(() => {
      localStorage.removeItem('account.lastSection');
      toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);
      auth = jasmine.createSpyObj<AuthService>('AuthService', [
        'isAuthenticated',
        'updateNotificationPreferences',
        'updateProfile',
        'logout',
        'role',
        'isAdmin',
        'getAliases',
        'getCooldowns',
        'listEmails',
      ]);
      auth.isAuthenticated.and.returnValue(true);
      auth.role.and.returnValue('customer');
      auth.isAdmin.and.returnValue(false);
      auth.updateProfile.and.returnValue(of(profile as any));
      auth.getAliases.and.returnValue(of({ usernames: [], display_names: [] } as any));
      auth.getCooldowns.and.returnValue(of({} as any));
      auth.listEmails.and.returnValue(
        of({
          primary_email: profile.email,
          primary_verified: true,
          secondary_emails: [],
        } as any),
      );
      auth.logout.and.returnValue(of(void 0));

      account = jasmine.createSpyObj<AccountService>('AccountService', [
        'getProfile',
        'getAddresses',
        'getOrders',
        'getOrdersPage',
        'getDeletionStatus',
      ]);
      account.getProfile.and.returnValue(of(profile as any));
      account.getAddresses.and.returnValue(of(addresses));
      account.getOrders.and.returnValue(of(orders));
      account.getOrdersPage.and.returnValue(
        of({
          items: orders,
          meta: {
            total_items: orders.length,
            total_pages: 1,
            page: 1,
            size: 5,
            pending_count: 0,
          },
        } as any),
      );
      account.getDeletionStatus.and.returnValue(
        of({
          requested_at: null,
          scheduled_for: null,
          deleted_at: null,
          cooldown_hours: 24,
        }),
      );

      blog = jasmine.createSpyObj<BlogService>('BlogService', ['listMyComments']);
      blog.listMyComments.and.returnValue(
        of({
          items: [],
          meta: { total_items: 0, total_pages: 1, page: 1, limit: 10 },
        } as any),
      );

      api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post', 'delete']);
      api.get.and.returnValue(of([]));

      wishlist = {
        items: () => [],
        isLoaded: jasmine.createSpy('isLoaded').and.returnValue(true),
        ensureLoaded: jasmine.createSpy('ensureLoaded'),
      };

      coupons = jasmine.createSpyObj<CouponsService>('CouponsService', ['myCoupons']);
      coupons.myCoupons.and.returnValue(of([] as any));

      notifications = {
        unreadCount: () => 0,
        refreshUnreadCount: jasmine.createSpy('refreshUnreadCount'),
      };

      tickets = jasmine.createSpyObj<TicketsService>('TicketsService', ['listMine']);
      tickets.listMine.and.returnValue(of([]));

      const prefSig = signal<'light' | 'dark' | 'system'>('system');
      theme = {
        mode: () => 'light',
        preference: () => () => prefSig(),
        setPreference: jasmine.createSpy('setPreference'),
      };

      lang = {
        language: () => 'en',
        setLanguage: jasmine.createSpy('setLanguage'),
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
          { provide: TicketsService, useValue: tickets },
          { provide: ThemeService, useValue: theme },
          { provide: LanguageService, useValue: lang },
          { provide: CartStore, useValue: cart },
        ],
      });
    });

    it('marks profile dirty on edits, discards to baseline, and saveProfile no-ops when signed out', () => {
      const fixture = TestBed.createComponent(AccountComponent);
      const cmp = fixture.componentInstance;
      fixture.detectChanges();
      fixture.detectChanges();

      expect(cmp.profileHasUnsavedChanges()).toBeFalse();

      cmp.profileName = 'Changed Name';
      expect(cmp.profileHasUnsavedChanges()).toBeTrue();

      cmp.discardProfileChanges();
      expect(cmp.profileName).toBe('User');
      expect(cmp.profileHasUnsavedChanges()).toBeFalse();

      cmp.profileUsernamePassword = 'secret';
      expect(cmp.profileHasUnsavedChanges()).toBeTrue();
      cmp.discardProfileChanges();
      expect(cmp.profileUsernamePassword).toBe('');

      auth.isAuthenticated.and.returnValue(false);
      cmp.savingProfile = false;
      cmp.saveProfile();
      expect(cmp.savingProfile).toBeFalse();
      expect(auth.updateProfile).not.toHaveBeenCalled();
    });

    it('navigateToSection skips blank/password and navigationSection remaps password to security', () => {
      const fixture = TestBed.createComponent(AccountComponent);
      const cmp = fixture.componentInstance;
      const router = TestBed.inject(Router);
      const route = TestBed.inject(ActivatedRoute);
      const navSpy = spyOn(router, 'navigate').and.resolveTo(true);
      fixture.detectChanges();
      fixture.detectChanges();

      cmp.navigateToSection('');
      cmp.navigateToSection('   ');
      cmp.navigateToSection('password');
      expect(navSpy).not.toHaveBeenCalled();

      cmp.navigateToSection('profile');
      expect(navSpy).toHaveBeenCalledWith(['profile'], { relativeTo: route });

      cmp.navigateToSection('overview');
      expect(navSpy).toHaveBeenCalledWith(['overview'], { relativeTo: route });

      const urlSpy = spyOnProperty(router, 'url', 'get');
      urlSpy.and.returnValue('/en/account/password');
      expect(cmp.navigationSection()).toBe('security');

      urlSpy.and.returnValue('/account/orders');
      expect(cmp.navigationSection()).toBe('orders');
    });
  });

  describe('avatar crop zoom normalize', () => {
    beforeEach(() => {
      const accountStub = {
        profileHasUnsavedChanges: () => false,
        discardProfileChanges: () => undefined,
        avatarBusy: false,
        loading: () => false,
        profileCompleteness: () => ({ completed: 0, total: 1, percent: 0 }),
        profileCompletionRequired: () => false,
        missingProfileFields: () => [],
        profile: () => null,
        avatar: null,
        placeholderAvatar: 'assets/placeholder/avatar-placeholder.svg',
        googlePicture: () => null,
        aliasesLoading: () => false,
        aliases: () => null,
        aliasesError: () => null,
        isAuthenticated: () => false,
        savingProfile: false,
      } as unknown as AccountComponent;

      TestBed.configureTestingModule({
        imports: [TranslateModule.forRoot(), AccountProfileComponent],
        providers: [{ provide: AccountComponent, useValue: accountStub }],
      });
    });

    it('normalizes avatar crop zoom transform for finite, NaN, and out-of-range values', () => {
      const fixture = TestBed.createComponent(AccountProfileComponent);
      const cmp = fixture.componentInstance;

      cmp.avatarCropZoom = 2;
      expect(cmp.avatarCropTransform).toBe('translate(-50%, -50%) scale(2)');

      cmp.avatarCropZoom = 0.25;
      expect(cmp.avatarCropTransform).toBe('translate(-50%, -50%) scale(1)');

      cmp.avatarCropZoom = 9;
      expect(cmp.avatarCropTransform).toBe('translate(-50%, -50%) scale(3)');

      cmp.avatarCropZoom = Number.NaN;
      expect(cmp.avatarCropTransform).toBe('translate(-50%, -50%) scale(1)');
    });
  });
});
