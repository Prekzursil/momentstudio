import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { NotFoundComponent } from './pages/not-found/not-found.component';
import { ErrorComponent } from './pages/error/error.component';
import { ShopComponent } from './pages/shop/shop.component';
import { AboutComponent } from './pages/about/about.component';
import { BlogListComponent } from './pages/blog/blog-list.component';
import { BlogPostComponent } from './pages/blog/blog-post.component';
import { ContactComponent } from './pages/contact/contact.component';
import { ProductComponent } from './pages/product/product.component';
import { adminGuard, authGuard, profileCompletionGuard } from './core/auth.guard';
import { CartComponent } from './pages/cart/cart.component';
import { CheckoutComponent } from './pages/checkout/checkout.component';
import { SuccessComponent } from './pages/checkout/success.component';
import { LoginComponent } from './pages/auth/login.component';
import { RegisterComponent } from './pages/auth/register.component';
import { GoogleCallbackComponent } from './pages/auth/google-callback.component';
import { PasswordResetRequestComponent } from './pages/auth/password-reset-request.component';
import { PasswordResetComponent } from './pages/auth/password-reset.component';
import { AccountComponent } from './pages/account/account.component';
import { ChangePasswordComponent } from './pages/account/change-password.component';
import { shopCategoriesResolver } from './core/shop.resolver';

export const routes: Routes = [
  { path: '', canActivate: [profileCompletionGuard], component: HomeComponent, title: 'momentstudio' },
  {
    path: 'shop',
    canActivate: [profileCompletionGuard],
    component: ShopComponent,
    title: 'Shop | momentstudio',
    resolve: { categories: shopCategoriesResolver }
  },
  { path: 'about', canActivate: [profileCompletionGuard], component: AboutComponent, title: 'About | momentstudio' },
  { path: 'contact', canActivate: [profileCompletionGuard], component: ContactComponent, title: 'Contact | momentstudio' },
  { path: 'blog', canActivate: [profileCompletionGuard], component: BlogListComponent, title: 'Blog | momentstudio' },
  { path: 'blog/:slug', canActivate: [profileCompletionGuard], component: BlogPostComponent, title: 'Blog | momentstudio' },
  { path: 'products/:slug', canActivate: [profileCompletionGuard], component: ProductComponent, title: 'Product | momentstudio' },
  { path: 'cart', canActivate: [profileCompletionGuard], component: CartComponent, title: 'Cart | momentstudio' },
  { path: 'checkout', canActivate: [profileCompletionGuard], component: CheckoutComponent, title: 'Checkout | momentstudio' },
  {
    path: 'checkout/success',
    canActivate: [profileCompletionGuard],
    component: SuccessComponent,
    title: 'Order placed | momentstudio'
  },
  { path: 'login', canActivate: [profileCompletionGuard], component: LoginComponent, title: 'Login | momentstudio' },
  { path: 'register', canActivate: [profileCompletionGuard], component: RegisterComponent, title: 'Register | momentstudio' },
  {
    path: 'auth/google/callback',
    canActivate: [profileCompletionGuard],
    component: GoogleCallbackComponent,
    title: 'Google sign-in | momentstudio'
  },
  {
    path: 'password-reset',
    canActivate: [profileCompletionGuard],
    component: PasswordResetRequestComponent,
    title: 'Password reset | momentstudio'
  },
  {
    path: 'password-reset/confirm',
    canActivate: [profileCompletionGuard],
    component: PasswordResetComponent,
    title: 'Set new password | momentstudio'
  },
  { path: 'account', canActivate: [authGuard, profileCompletionGuard], component: AccountComponent, title: 'Account | momentstudio' },
  {
    path: 'account/password',
    canActivate: [authGuard, profileCompletionGuard],
    component: ChangePasswordComponent,
    title: 'Change password | momentstudio'
  },
  {
    path: 'admin',
    canActivate: [profileCompletionGuard, adminGuard],
    loadComponent: () => import('./pages/admin/admin.component').then((m) => m.AdminComponent),
    title: 'Admin'
  },
  { path: 'error', canActivate: [profileCompletionGuard], component: ErrorComponent, title: 'Something went wrong' },
  { path: '**', canActivate: [profileCompletionGuard], component: NotFoundComponent, title: 'Not Found' }
];
