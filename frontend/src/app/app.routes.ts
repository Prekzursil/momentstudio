import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { NotFoundComponent } from './pages/not-found/not-found.component';
import { ErrorComponent } from './pages/error/error.component';
import { ShopComponent } from './pages/shop/shop.component';
import { AboutComponent } from './pages/about/about.component';
import { ContactComponent } from './pages/contact/contact.component';
import { adminGuard, adminSectionGuard, authGuard } from './core/auth.guard';
import { unsavedChangesGuard } from './core/unsaved-changes.guard';
import { shopCategoriesResolver } from './core/shop.resolver';
import { checkoutPricingSettingsResolver } from './core/checkout.resolver';
import { appConfig } from './core/app-config';

const NOINDEX_ROBOTS = 'noindex,nofollow';

const mockCheckoutRoutes: Routes =
  appConfig.appEnv === 'production'
    ? []
    : [
        {
          path: 'checkout/mock/paypal',
          loadComponent: () => import('./pages/checkout/paypal-mock.component').then((m) => m.PayPalMockComponent),
          title: 'meta.titles.checkout_paypal_mock',
          data: { robots: NOINDEX_ROBOTS }
        },
        {
          path: 'checkout/mock/stripe',
          loadComponent: () => import('./pages/checkout/stripe-mock.component').then((m) => m.StripeMockComponent),
          title: 'meta.titles.checkout_stripe_mock',
          data: { robots: NOINDEX_ROBOTS }
        }
      ];

export const routes: Routes = [
  { path: '', component: HomeComponent, title: 'meta.titles.home' },
  {
    path: 'shop',
    component: ShopComponent,
    title: 'meta.titles.shop',
    resolve: { categories: shopCategoriesResolver },
    pathMatch: 'full'
  },
  {
    path: 'shop/:category',
    component: ShopComponent,
    title: 'meta.titles.shop',
    resolve: { categories: shopCategoriesResolver }
  },
  { path: 'about', component: AboutComponent, title: 'meta.titles.about' },
  { path: 'contact', component: ContactComponent, title: 'meta.titles.contact' },
  {
    path: 'blog',
    loadComponent: () => import('./pages/blog/blog-list.component').then((m) => m.BlogListComponent),
    title: 'meta.titles.blog'
  },
  {
    path: 'blog/tag/:tag',
    loadComponent: () => import('./pages/blog/blog-list.component').then((m) => m.BlogListComponent),
    title: 'meta.titles.blog'
  },
  {
    path: 'blog/series/:series',
    loadComponent: () => import('./pages/blog/blog-list.component').then((m) => m.BlogListComponent),
    title: 'meta.titles.blog'
  },
  {
    path: 'blog/:slug',
    loadComponent: () => import('./pages/blog/blog-post.component').then((m) => m.BlogPostComponent),
    title: 'meta.titles.blog'
  },
  {
    path: 'pages/:slug',
    loadComponent: () => import('./pages/page/page.component').then((m) => m.CmsPageComponent),
    title: 'meta.titles.page'
  },
  {
    path: 'products/:slug',
    loadComponent: () => import('./pages/product/product.component').then((m) => m.ProductComponent),
    title: 'meta.titles.product'
  },
  { path: 'cart', loadComponent: () => import('./pages/cart/cart.component').then((m) => m.CartComponent), title: 'meta.titles.cart' },
  {
    path: 'checkout',
    loadComponent: () => import('./pages/checkout/checkout.component').then((m) => m.CheckoutComponent),
    title: 'meta.titles.checkout',
    data: { robots: NOINDEX_ROBOTS },
    resolve: {
      checkoutPricingSettings: checkoutPricingSettingsResolver
    }
  },
  ...mockCheckoutRoutes,
  {
    path: 'checkout/paypal/return',
    loadComponent: () => import('./pages/checkout/paypal-return.component').then((m) => m.PayPalReturnComponent),
    title: 'meta.titles.checkout_paypal',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'checkout/stripe/return',
    loadComponent: () => import('./pages/checkout/stripe-return.component').then((m) => m.StripeReturnComponent),
    title: 'meta.titles.checkout_stripe',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'checkout/netopia/return',
    loadComponent: () => import('./pages/checkout/netopia-return.component').then((m) => m.NetopiaReturnComponent),
    title: 'meta.titles.checkout_netopia',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'checkout/paypal/cancel',
    loadComponent: () => import('./pages/checkout/paypal-cancel.component').then((m) => m.PayPalCancelComponent),
    title: 'meta.titles.checkout',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'checkout/stripe/cancel',
    loadComponent: () => import('./pages/checkout/stripe-cancel.component').then((m) => m.StripeCancelComponent),
    title: 'meta.titles.checkout',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'checkout/netopia/cancel',
    loadComponent: () => import('./pages/checkout/netopia-cancel.component').then((m) => m.NetopiaCancelComponent),
    title: 'meta.titles.checkout',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'checkout/success',
    loadComponent: () => import('./pages/checkout/success.component').then((m) => m.SuccessComponent),
    title: 'meta.titles.checkout_success',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'receipt/:token',
    loadComponent: () => import('./pages/receipt/receipt.component').then((m) => m.ReceiptComponent),
    title: 'meta.titles.receipt',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/auth/login.component').then((m) => m.LoginComponent),
    title: 'meta.titles.login',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'login/2fa',
    loadComponent: () => import('./pages/auth/two-factor.component').then((m) => m.TwoFactorComponent),
    title: 'meta.titles.two_factor',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/auth/register.component').then((m) => m.RegisterComponent),
    title: 'meta.titles.register',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'auth/google/callback',
    loadComponent: () => import('./pages/auth/google-callback.component').then((m) => m.GoogleCallbackComponent),
    title: 'meta.titles.google_signin',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'password-reset',
    loadComponent: () => import('./pages/auth/password-reset-request.component').then((m) => m.PasswordResetRequestComponent),
    title: 'meta.titles.password_reset',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'password-reset/confirm',
    loadComponent: () => import('./pages/auth/password-reset.component').then((m) => m.PasswordResetComponent),
    title: 'meta.titles.password_reset_confirm',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'verify-email',
    loadComponent: () => import('./pages/auth/verify-email.component').then((m) => m.VerifyEmailComponent),
    title: 'meta.titles.verify_email',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'newsletter/confirm',
    loadComponent: () => import('./pages/newsletter/newsletter-confirm.component').then((m) => m.NewsletterConfirmComponent),
    title: 'meta.titles.newsletter',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'newsletter/unsubscribe',
    loadComponent: () => import('./pages/newsletter/newsletter-unsubscribe.component').then((m) => m.NewsletterUnsubscribeComponent),
    title: 'meta.titles.unsubscribe',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'account',
    canActivate: [authGuard],
    data: { robots: NOINDEX_ROBOTS },
    loadComponent: () => import('./pages/account/account.component').then((m) => m.AccountComponent),
    children: [
      { path: '', loadComponent: () => import('./pages/account/account-overview.component').then((m) => m.AccountOverviewComponent) },
      {
        path: 'overview',
        loadComponent: () => import('./pages/account/account-overview.component').then((m) => m.AccountOverviewComponent)
      },
      {
        path: 'profile',
        loadComponent: () => import('./pages/account/account-profile.component').then((m) => m.AccountProfileComponent),
        canDeactivate: [unsavedChangesGuard]
      },
      { path: 'orders', loadComponent: () => import('./pages/account/account-orders.component').then((m) => m.AccountOrdersComponent) },
      {
        path: 'addresses',
        loadComponent: () => import('./pages/account/account-addresses.component').then((m) => m.AccountAddressesComponent),
        canDeactivate: [unsavedChangesGuard]
      },
      { path: 'wishlist', loadComponent: () => import('./pages/account/account-wishlist.component').then((m) => m.AccountWishlistComponent) },
      { path: 'coupons', loadComponent: () => import('./pages/account/account-coupons.component').then((m) => m.AccountCouponsComponent) },
      {
        path: 'notifications',
        loadComponent: () =>
          import('./pages/account/account-notifications-inbox.component').then((m) => m.AccountNotificationsInboxComponent)
      },
      {
        path: 'notifications/settings',
        loadComponent: () => import('./pages/account/account-notifications.component').then((m) => m.AccountNotificationsComponent),
        canDeactivate: [unsavedChangesGuard]
      },
      { path: 'security', loadComponent: () => import('./pages/account/account-security.component').then((m) => m.AccountSecurityComponent) },
      { path: 'comments', loadComponent: () => import('./pages/account/account-comments.component').then((m) => m.AccountCommentsComponent) },
      { path: 'privacy', loadComponent: () => import('./pages/account/account-privacy.component').then((m) => m.AccountPrivacyComponent) },
      {
        path: 'password',
        loadComponent: () => import('./pages/account/change-password.component').then((m) => m.ChangePasswordComponent),
        title: 'meta.titles.change_password'
      }
    ],
    title: 'meta.titles.account'
  },
  {
    path: 'tickets',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/tickets/tickets.component').then((m) => m.TicketsComponent),
    title: 'meta.titles.help_center',
    data: { robots: NOINDEX_ROBOTS }
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    data: { robots: NOINDEX_ROBOTS },
    loadComponent: () => import('./pages/admin/admin-layout.component').then((m) => m.AdminLayoutComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'ip-bypass',
        loadComponent: () => import('./pages/admin/ip-bypass/admin-ip-bypass.component').then((m) => m.AdminIpBypassComponent),
        title: 'meta.titles.admin_access'
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./pages/admin/dashboard/admin-dashboard.component').then((m) => m.AdminDashboardComponent),
        canActivate: [adminSectionGuard('dashboard')],
        title: 'meta.titles.admin'
      },
      {
        path: 'content',
        canActivate: [adminSectionGuard('content')],
        loadComponent: () =>
          import('./pages/admin/content/admin-content-layout.component').then((m) => m.AdminContentLayoutComponent),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'home' },
          {
            path: 'home',
            loadComponent: () => import('./pages/admin/admin.component').then((m) => m.AdminComponent),
            data: { section: 'home' },
            canDeactivate: [unsavedChangesGuard],
            title: 'meta.titles.admin_content_home'
          },
          {
            path: 'pages',
            loadComponent: () => import('./pages/admin/admin.component').then((m) => m.AdminComponent),
            data: { section: 'pages' },
            canDeactivate: [unsavedChangesGuard],
            title: 'meta.titles.admin_content_pages'
          },
          {
            path: 'blog',
            loadComponent: () => import('./pages/admin/admin.component').then((m) => m.AdminComponent),
            data: { section: 'blog' },
            canDeactivate: [unsavedChangesGuard],
            title: 'meta.titles.admin_content_blog'
          },
          {
            path: 'settings',
            loadComponent: () => import('./pages/admin/admin.component').then((m) => m.AdminComponent),
            data: { section: 'settings' },
            canDeactivate: [unsavedChangesGuard],
            title: 'meta.titles.admin_content_settings'
          },
          {
            path: 'scheduling',
            loadComponent: () =>
              import('./pages/admin/content/admin-content-scheduling.component').then((m) => m.AdminContentSchedulingComponent),
            title: 'meta.titles.admin_content_scheduling'
          }
        ]
      },
      {
        path: 'orders',
        loadComponent: () => import('./pages/admin/orders/admin-orders.component').then((m) => m.AdminOrdersComponent),
        canActivate: [adminSectionGuard('orders')],
        title: 'meta.titles.admin_orders'
      },
      {
        path: 'orders/exports',
        loadComponent: () =>
          import('./pages/admin/orders/admin-order-exports.component').then((m) => m.AdminOrderExportsComponent),
        canActivate: [adminSectionGuard('orders')],
        title: 'meta.titles.admin_order_exports'
      },
      {
        path: 'orders/:orderId',
        loadComponent: () =>
          import('./pages/admin/orders/admin-order-detail.component').then((m) => m.AdminOrderDetailComponent),
        canActivate: [adminSectionGuard('orders')],
        title: 'meta.titles.admin_order'
      },
      {
        path: 'returns',
        loadComponent: () => import('./pages/admin/returns/admin-returns.component').then((m) => m.AdminReturnsComponent),
        canActivate: [adminSectionGuard('returns')],
        title: 'meta.titles.admin_returns'
      },
      {
        path: 'coupons',
        loadComponent: () => import('./pages/admin/coupons/admin-coupons.component').then((m) => m.AdminCouponsComponent),
        canActivate: [adminSectionGuard('coupons')],
        title: 'meta.titles.admin_coupons'
      },
      {
        path: 'products',
        loadComponent: () => import('./pages/admin/products/admin-products.component').then((m) => m.AdminProductsComponent),
        canActivate: [adminSectionGuard('products')],
        canDeactivate: [unsavedChangesGuard],
        title: 'meta.titles.admin_products'
      },
      {
        path: 'inventory',
        loadComponent: () => import('./pages/admin/inventory/admin-inventory.component').then((m) => m.AdminInventoryComponent),
        canActivate: [adminSectionGuard('inventory')],
        title: 'meta.titles.admin_inventory'
      },
      {
        path: 'users',
        canActivate: [adminSectionGuard('users')],
        children: [
          {
            path: '',
            loadComponent: () => import('./pages/admin/users/admin-users.component').then((m) => m.AdminUsersComponent),
            title: 'meta.titles.admin_users'
          },
          {
            path: 'gdpr',
            loadComponent: () => import('./pages/admin/users/admin-gdpr.component').then((m) => m.AdminGdprComponent),
            title: 'meta.titles.admin_gdpr'
          },
          {
            path: 'segments',
            loadComponent: () => import('./pages/admin/users/admin-segments.component').then((m) => m.AdminSegmentsComponent),
            title: 'meta.titles.admin_segments'
          }
        ]
      },
      {
        path: 'support',
        loadComponent: () => import('./pages/admin/support/admin-support.component').then((m) => m.AdminSupportComponent),
        canActivate: [adminSectionGuard('support')],
        title: 'meta.titles.admin_support'
      },
      {
        path: 'ops',
        loadComponent: () => import('./pages/admin/ops/admin-ops.component').then((m) => m.AdminOpsComponent),
        canActivate: [adminSectionGuard('ops')],
        title: 'meta.titles.admin_ops'
      }
    ]
  },
  {
    path: 'offline',
    loadComponent: () => import('./pages/offline/offline.component').then((m) => m.OfflineComponent),
    title: 'meta.titles.offline',
    data: { robots: NOINDEX_ROBOTS }
  },
  { path: 'error', component: ErrorComponent, title: 'meta.titles.error', data: { robots: NOINDEX_ROBOTS } },
  { path: '**', component: NotFoundComponent, title: 'meta.titles.not_found', data: { robots: NOINDEX_ROBOTS } }
];
