import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ToastService } from './toast.service';

const isAuthenticated = (): boolean => {
  if (typeof localStorage === 'undefined') return false;
  return Boolean(localStorage.getItem('auth_token'));
};

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const toast = inject(ToastService);
  if (isAuthenticated()) return true;
  toast.error('Please sign in to continue.');
  router.navigateByUrl('/');
  return false;
};

export const adminGuard: CanActivateFn = () => {
  const router = inject(Router);
  const toast = inject(ToastService);
  if (isAuthenticated() && localStorage.getItem('role') === 'admin') return true;
  toast.error('Admin access required.');
  router.navigateByUrl('/');
  return false;
};
