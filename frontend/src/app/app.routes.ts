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
import { authGuard, adminGuard } from './core/auth.guard';
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
  { path: '', component: HomeComponent, title: 'Moment Studio' },
  { path: 'shop', component: ShopComponent, title: 'Shop | Moment Studio', resolve: { categories: shopCategoriesResolver } },
  { path: 'about', component: AboutComponent, title: 'About | Moment Studio' },
  { path: 'contact', component: ContactComponent, title: 'Contact | Moment Studio' },
  { path: 'blog', component: BlogListComponent, title: 'Blog | Moment Studio' },
  { path: 'blog/:slug', component: BlogPostComponent, title: 'Blog | Moment Studio' },
  { path: 'products/:slug', component: ProductComponent, title: 'Product | Moment Studio' },
  { path: 'cart', component: CartComponent, title: 'Cart | Moment Studio' },
  { path: 'checkout', component: CheckoutComponent, title: 'Checkout | Moment Studio' },
  { path: 'checkout/success', component: SuccessComponent, title: 'Order placed | Moment Studio' },
  { path: 'login', component: LoginComponent, title: 'Login | Moment Studio' },
  { path: 'register', component: RegisterComponent, title: 'Register | Moment Studio' },
  { path: 'auth/google/callback', component: GoogleCallbackComponent, title: 'Google sign-in | Moment Studio' },
  { path: 'password-reset', component: PasswordResetRequestComponent, title: 'Password reset | Moment Studio' },
  { path: 'password-reset/confirm', component: PasswordResetComponent, title: 'Set new password | Moment Studio' },
  { path: 'account', canActivate: [authGuard], component: AccountComponent, title: 'Account | Moment Studio' },
  { path: 'account/password', canActivate: [authGuard], component: ChangePasswordComponent, title: 'Change password | Moment Studio' },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/admin/admin.component').then((m) => m.AdminComponent),
    title: 'Admin'
  },
  { path: 'error', component: ErrorComponent, title: 'Something went wrong' },
  { path: '**', component: NotFoundComponent, title: 'Not Found' }
];
