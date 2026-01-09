import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ToastService } from './toast.service';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const toast = inject(ToastService);
  const auth = inject(AuthService);
  if (auth.isAuthenticated()) return true;
  toast.error('Please sign in to continue.');
  void router.navigateByUrl('/login');
  return false;
};

export const adminGuard: CanActivateFn = () => {
  const router = inject(Router);
  const toast = inject(ToastService);
  const auth = inject(AuthService);
  if (auth.isAuthenticated() && auth.role() === 'admin') return true;
  toast.error('Admin access required.');
  void router.navigateByUrl('/');
  return false;
};
