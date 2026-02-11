import { Injectable } from '@angular/core';
import { MissingTranslationHandler, MissingTranslationHandlerParams } from '@ngx-translate/core';

const CRITICAL_FALLBACK_LABELS: Record<string, string> = {
  'app.name': 'momentstudio',
  'nav.home': 'Home',
  'nav.blog': 'Blog',
  'nav.shop': 'Shop',
  'nav.about': 'Our story',
  'nav.contact': 'Contact',
  'nav.terms': 'Terms & Conditions',
  'nav.signIn': 'Sign in',
  'shop.searchPlaceholder': 'Search products',
  'shop.search': 'Search',
  'shop.sort': 'Sort',
  'checkout.title': 'Checkout',
  'checkout.retry': 'Retry',
  'checkout.backToCheckout': 'Back to checkout',
  'cart.title': 'Your cart',
  'auth.loginTitle': 'Sign in'
};

@Injectable()
export class AppMissingTranslationHandler implements MissingTranslationHandler {
  handle(params: MissingTranslationHandlerParams): string {
    const key = `${params?.key ?? ''}`.trim();
    if (!key) return '';

    const explicitFallback = CRITICAL_FALLBACK_LABELS[key];
    if (explicitFallback) return explicitFallback;

    const leaf = key.split('.').at(-1) || key;
    const normalized = leaf
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return key;
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
}
