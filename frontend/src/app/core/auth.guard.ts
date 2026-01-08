import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ToastService } from './toast.service';
import { AuthService } from './auth.service';
import { missingRequiredProfileFields } from '../shared/profile-requirements';

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

export const profileCompletionGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const auth = inject(AuthService);
  const user = auth.user();

  if (!auth.isAuthenticated() || !user?.google_sub) return true;

  const missing = missingRequiredProfileFields(user);
  if (!missing.length) return true;

  const url = state.url || '';
  if (url.startsWith('/account')) return true;

  void router.navigate(['/account'], { queryParams: { complete: 1 }, fragment: 'profile' });
  return false;
};
