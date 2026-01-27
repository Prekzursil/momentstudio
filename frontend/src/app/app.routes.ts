import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { NotFoundComponent } from './pages/not-found/not-found.component';
import { ErrorComponent } from './pages/error/error.component';
import { ShopComponent } from './pages/shop/shop.component';
import { AboutComponent } from './pages/about/about.component';
import { BlogListComponent } from './pages/blog/blog-list.component';
import { BlogPostComponent } from './pages/blog/blog-post.component';
import { ContactComponent } from './pages/contact/contact.component';
import { adminGuard, adminSectionGuard, authGuard } from './core/auth.guard';
import { unsavedChangesGuard } from './core/unsaved-changes.guard';
import { shopCategoriesResolver } from './core/shop.resolver';
import { checkoutPricingSettingsResolver, checkoutShippingMethodsResolver } from './core/checkout.resolver';

export const routes: Routes = [
  { path: '', component: HomeComponent, title: 'momentstudio' },
  {
    path: 'shop',
    component: ShopComponent,
    title: 'Shop | momentstudio',
    resolve: { categories: shopCategoriesResolver },
    pathMatch: 'full'
  },
  {
    path: 'shop/:category',
    component: ShopComponent,
    title: 'Shop | momentstudio',
    resolve: { categories: shopCategoriesResolver }
  },
  { path: 'about', component: AboutComponent, title: 'About | momentstudio' },
  { path: 'contact', component: ContactComponent, title: 'Contact | momentstudio' },
  { path: 'blog', component: BlogListComponent, title: 'Blog | momentstudio' },
  { path: 'blog/tag/:tag', component: BlogListComponent, title: 'Blog | momentstudio' },
  { path: 'blog/:slug', component: BlogPostComponent, title: 'Blog | momentstudio' },
  {
    path: 'pages/:slug',
    loadComponent: () => import('./pages/page/page.component').then((m) => m.CmsPageComponent),
    title: 'Page | momentstudio'
  },
  {
    path: 'products/:slug',
    loadComponent: () => import('./pages/product/product.component').then((m) => m.ProductComponent),
    title: 'Product | momentstudio'
  },
  { path: 'cart', loadComponent: () => import('./pages/cart/cart.component').then((m) => m.CartComponent), title: 'Cart | momentstudio' },
  {
    path: 'checkout',
    loadComponent: () => import('./pages/checkout/checkout.component').then((m) => m.CheckoutComponent),
    title: 'Checkout | momentstudio',
    resolve: {
      shippingMethods: checkoutShippingMethodsResolver,
      checkoutPricingSettings: checkoutPricingSettingsResolver
    }
  },
  {
    path: 'checkout/mock/paypal',
    loadComponent: () => import('./pages/checkout/paypal-mock.component').then((m) => m.PayPalMockComponent),
    title: 'PayPal (Mock) | momentstudio'
  },
  {
    path: 'checkout/mock/stripe',
    loadComponent: () => import('./pages/checkout/stripe-mock.component').then((m) => m.StripeMockComponent),
    title: 'Stripe (Mock) | momentstudio'
  },
  {
    path: 'checkout/paypal/return',
    loadComponent: () => import('./pages/checkout/paypal-return.component').then((m) => m.PayPalReturnComponent),
    title: 'PayPal | momentstudio'
  },
  {
    path: 'checkout/stripe/return',
    loadComponent: () => import('./pages/checkout/stripe-return.component').then((m) => m.StripeReturnComponent),
    title: 'Stripe | momentstudio'
  },
  {
    path: 'checkout/paypal/cancel',
    loadComponent: () => import('./pages/checkout/paypal-cancel.component').then((m) => m.PayPalCancelComponent),
    title: 'Checkout | momentstudio'
  },
  {
    path: 'checkout/stripe/cancel',
    loadComponent: () => import('./pages/checkout/stripe-cancel.component').then((m) => m.StripeCancelComponent),
    title: 'Checkout | momentstudio'
  },
  {
    path: 'checkout/success',
    loadComponent: () => import('./pages/checkout/success.component').then((m) => m.SuccessComponent),
    title: 'Order placed | momentstudio'
  },
  {
    path: 'receipt/:token',
    loadComponent: () => import('./pages/receipt/receipt.component').then((m) => m.ReceiptComponent),
    title: 'Receipt | momentstudio'
  },
  { path: 'login', loadComponent: () => import('./pages/auth/login.component').then((m) => m.LoginComponent), title: 'Login | momentstudio' },
  {
    path: 'login/2fa',
    loadComponent: () => import('./pages/auth/two-factor.component').then((m) => m.TwoFactorComponent),
    title: 'Two-factor | momentstudio'
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/auth/register.component').then((m) => m.RegisterComponent),
    title: 'Register | momentstudio'
  },
  {
    path: 'auth/google/callback',
    loadComponent: () => import('./pages/auth/google-callback.component').then((m) => m.GoogleCallbackComponent),
    title: 'Google sign-in | momentstudio'
  },
  {
    path: 'password-reset',
    loadComponent: () => import('./pages/auth/password-reset-request.component').then((m) => m.PasswordResetRequestComponent),
    title: 'Password reset | momentstudio'
  },
  {
    path: 'password-reset/confirm',
    loadComponent: () => import('./pages/auth/password-reset.component').then((m) => m.PasswordResetComponent),
    title: 'Set new password | momentstudio'
  },
  {
    path: 'account',
    canActivate: [authGuard],
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
        title: 'Change password | momentstudio'
      }
    ],
    title: 'Account | momentstudio'
  },
  {
    path: 'tickets',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/tickets/tickets.component').then((m) => m.TicketsComponent),
    title: 'Help center | momentstudio'
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/admin/admin-layout.component').then((m) => m.AdminLayoutComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'ip-bypass',
        loadComponent: () => import('./pages/admin/ip-bypass/admin-ip-bypass.component').then((m) => m.AdminIpBypassComponent),
        title: 'Admin access | momentstudio'
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./pages/admin/dashboard/admin-dashboard.component').then((m) => m.AdminDashboardComponent),
        canActivate: [adminSectionGuard('dashboard')],
        title: 'Admin | momentstudio'
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
            title: 'Content · Home | Admin | momentstudio'
          },
          {
            path: 'pages',
            loadComponent: () => import('./pages/admin/admin.component').then((m) => m.AdminComponent),
            data: { section: 'pages' },
            title: 'Content · Pages | Admin | momentstudio'
          },
          {
            path: 'blog',
            loadComponent: () => import('./pages/admin/admin.component').then((m) => m.AdminComponent),
            data: { section: 'blog' },
            title: 'Content · Blog | Admin | momentstudio'
          },
          {
            path: 'settings',
            loadComponent: () => import('./pages/admin/admin.component').then((m) => m.AdminComponent),
            data: { section: 'settings' },
            title: 'Content · Settings | Admin | momentstudio'
          }
        ]
      },
      {
        path: 'orders',
        loadComponent: () => import('./pages/admin/orders/admin-orders.component').then((m) => m.AdminOrdersComponent),
        canActivate: [adminSectionGuard('orders')],
        title: 'Orders | Admin | momentstudio'
      },
      {
        path: 'orders/:orderId',
        loadComponent: () =>
          import('./pages/admin/orders/admin-order-detail.component').then((m) => m.AdminOrderDetailComponent),
        canActivate: [adminSectionGuard('orders')],
        title: 'Order | Admin | momentstudio'
      },
      {
        path: 'returns',
        loadComponent: () => import('./pages/admin/returns/admin-returns.component').then((m) => m.AdminReturnsComponent),
        canActivate: [adminSectionGuard('returns')],
        title: 'Returns | Admin | momentstudio'
      },
      {
        path: 'coupons',
        loadComponent: () => import('./pages/admin/coupons/admin-coupons.component').then((m) => m.AdminCouponsComponent),
        canActivate: [adminSectionGuard('coupons')],
        title: 'Coupons | Admin | momentstudio'
      },
      {
        path: 'products',
        loadComponent: () => import('./pages/admin/products/admin-products.component').then((m) => m.AdminProductsComponent),
        canActivate: [adminSectionGuard('products')],
        title: 'Products | Admin | momentstudio'
      },
      {
        path: 'inventory',
        loadComponent: () => import('./pages/admin/inventory/admin-inventory.component').then((m) => m.AdminInventoryComponent),
        canActivate: [adminSectionGuard('inventory')],
        title: 'Inventory | Admin | momentstudio'
      },
      {
        path: 'users',
        canActivate: [adminSectionGuard('users')],
        children: [
          {
            path: '',
            loadComponent: () => import('./pages/admin/users/admin-users.component').then((m) => m.AdminUsersComponent),
            title: 'Users | Admin | momentstudio'
          },
          {
            path: 'gdpr',
            loadComponent: () => import('./pages/admin/users/admin-gdpr.component').then((m) => m.AdminGdprComponent),
            title: 'GDPR | Admin | momentstudio'
          },
          {
            path: 'segments',
            loadComponent: () => import('./pages/admin/users/admin-segments.component').then((m) => m.AdminSegmentsComponent),
            title: 'Segments | Admin | momentstudio'
          }
        ]
      },
      {
        path: 'support',
        loadComponent: () => import('./pages/admin/support/admin-support.component').then((m) => m.AdminSupportComponent),
        canActivate: [adminSectionGuard('support')],
        title: 'Support | Admin | momentstudio'
      },
      {
        path: 'ops',
        loadComponent: () => import('./pages/admin/ops/admin-ops.component').then((m) => m.AdminOpsComponent),
        canActivate: [adminSectionGuard('ops')],
        title: 'Ops | Admin | momentstudio'
      }
    ]
  },
  { path: 'error', component: ErrorComponent, title: 'Something went wrong' },
  { path: '**', component: NotFoundComponent, title: 'Not Found' }
];
