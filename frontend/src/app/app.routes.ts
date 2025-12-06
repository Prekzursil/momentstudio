import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { NotFoundComponent } from './pages/not-found/not-found.component';
import { ErrorComponent } from './pages/error/error.component';
import { ShopComponent } from './pages/shop/shop.component';
import { ProductComponent } from './pages/product/product.component';
import { AdminComponent } from './pages/admin/admin.component';
import { authGuard, adminGuard } from './core/auth.guard';
import { CartComponent } from './pages/cart/cart.component';
import { CheckoutComponent } from './pages/checkout/checkout.component';
import { SuccessComponent } from './pages/checkout/success.component';
import { LoginComponent } from './pages/auth/login.component';
import { RegisterComponent } from './pages/auth/register.component';
import { PasswordResetRequestComponent } from './pages/auth/password-reset-request.component';
import { PasswordResetComponent } from './pages/auth/password-reset.component';
import { AccountComponent } from './pages/account/account.component';
import { ChangePasswordComponent } from './pages/account/change-password.component';
import { shopCategoriesResolver } from './core/shop.resolver';

export const routes: Routes = [
  { path: '', component: HomeComponent, title: 'AdrianaArt' },
  { path: 'shop', component: ShopComponent, title: 'Shop | AdrianaArt', resolve: { categories: shopCategoriesResolver } },
  { path: 'products/:slug', component: ProductComponent, title: 'Product | AdrianaArt' },
  { path: 'cart', component: CartComponent, title: 'Cart | AdrianaArt' },
  { path: 'checkout', component: CheckoutComponent, title: 'Checkout | AdrianaArt' },
  { path: 'checkout/success', component: SuccessComponent, title: 'Order placed | AdrianaArt' },
  { path: 'login', component: LoginComponent, title: 'Login | AdrianaArt' },
  { path: 'register', component: RegisterComponent, title: 'Register | AdrianaArt' },
  { path: 'password-reset', component: PasswordResetRequestComponent, title: 'Password reset | AdrianaArt' },
  { path: 'password-reset/confirm', component: PasswordResetComponent, title: 'Set new password | AdrianaArt' },
  { path: 'account', canActivate: [authGuard], component: AccountComponent, title: 'Account | AdrianaArt' },
  { path: 'account/password', canActivate: [authGuard], component: ChangePasswordComponent, title: 'Change password | AdrianaArt' },
  { path: 'admin', component: AdminComponent, canActivate: [adminGuard], title: 'Admin' },
  { path: 'error', component: ErrorComponent, title: 'Something went wrong' },
  { path: '**', component: NotFoundComponent, title: 'Not Found' }
];
