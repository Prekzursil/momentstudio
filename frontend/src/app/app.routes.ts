import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { NotFoundComponent } from './pages/not-found/not-found.component';
import { ErrorComponent } from './pages/error/error.component';
import { ShopComponent } from './pages/shop/shop.component';
import { AdminComponent } from './pages/admin/admin.component';
import { authGuard, adminGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', component: HomeComponent, title: 'AdrianaArt' },
  { path: 'shop', component: ShopComponent, title: 'Shop' },
  { path: 'admin', component: AdminComponent, canActivate: [adminGuard], title: 'Admin' },
  { path: 'account', canActivate: [authGuard], component: HomeComponent, title: 'Account' },
  { path: 'error', component: ErrorComponent, title: 'Something went wrong' },
  { path: '**', component: NotFoundComponent, title: 'Not Found' }
];
