import { Route, Routes } from '@angular/router';
import { routes } from './app.routes';
import { adminGuard, adminSectionGuard, authGuard } from './core/auth.guard';
import { unsavedChangesGuard } from './core/unsaved-changes.guard';
import { shopCategoriesResolver } from './core/shop.resolver';
import { checkoutPricingSettingsResolver } from './core/checkout.resolver';

const NOINDEX_ROBOTS = 'noindex,nofollow';

/** Depth-first flatten of the route tree (parents before children). */
function flatten(input: Routes): Route[] {
  const out: Route[] = [];
  for (const route of input) {
    out.push(route);
    if (route.children) {
      out.push(...flatten(route.children));
    }
  }
  return out;
}

/** Find a top-level (or nested) route by its exact `path`. */
function findByPath(input: Routes, path: string): Route | undefined {
  return flatten(input).find((r) => r.path === path);
}

/** Find a child route within a parent identified by `parentPath`. */
function child(parentPath: string, childPath: string): Route | undefined {
  const parent = routes.find((r) => r.path === parentPath);
  return parent?.children?.find((c) => c.path === childPath);
}

describe('app routes', () => {
  it('exposes a non-empty route table', () => {
    expect(Array.isArray(routes)).toBeTrue();
    expect(routes.length).toBeGreaterThan(0);
  });

  describe('eager top-level pages', () => {
    it('serves HomeComponent at the empty path', () => {
      const home = findByPath(routes, '');
      expect(home).toBeDefined();
      expect(home?.component?.name).toBe('HomeComponent');
      expect(home?.title).toBe('meta.titles.home');
    });

    it('serves the shop landing with a full path match and category resolver', () => {
      const shop = routes.find((r) => r.path === 'shop');
      expect(shop?.component?.name).toBe('ShopComponent');
      expect(shop?.pathMatch).toBe('full');
      expect(shop?.resolve?.['categories']).toBe(shopCategoriesResolver);
    });

    it('serves the shop category page with the same resolver but no full match', () => {
      const shopCategory = findByPath(routes, 'shop/:category');
      expect(shopCategory?.component?.name).toBe('ShopComponent');
      expect(shopCategory?.pathMatch).toBeUndefined();
      expect(shopCategory?.resolve?.['categories']).toBe(shopCategoriesResolver);
    });

    it('serves about and contact pages', () => {
      expect(findByPath(routes, 'about')?.component?.name).toBe('AboutComponent');
      expect(findByPath(routes, 'contact')?.component?.name).toBe('ContactComponent');
    });

    it('serves the error page', () => {
      expect(findByPath(routes, 'error')?.component?.name).toBe('ErrorComponent');
      expect(findByPath(routes, 'error')?.data?.['robots']).toBe(NOINDEX_ROBOTS);
    });

    it('uses NotFoundComponent for the wildcard fallback', () => {
      const wildcard = routes.find((r) => r.path === '**');
      expect(wildcard?.component?.name).toBe('NotFoundComponent');
      expect(wildcard?.title).toBe('meta.titles.not_found');
      expect(wildcard?.data?.['robots']).toBe(NOINDEX_ROBOTS);
    });

    it('places the wildcard route last so all other paths win first', () => {
      expect(routes[routes.length - 1].path).toBe('**');
    });
  });

  describe('mock checkout routes (non-production build)', () => {
    // Karma runs with the default `development` appEnv, so the non-production
    // branch of `mockCheckoutRoutes` is the one evaluated here.
    it('registers the PayPal and Stripe sandbox routes', () => {
      const paypal = findByPath(routes, 'checkout/mock/paypal');
      const stripe = findByPath(routes, 'checkout/mock/stripe');
      expect(paypal).toBeDefined();
      expect(stripe).toBeDefined();
      expect(paypal?.title).toBe('meta.titles.checkout_paypal_mock');
      expect(stripe?.title).toBe('meta.titles.checkout_stripe_mock');
      expect(paypal?.data?.['robots']).toBe(NOINDEX_ROBOTS);
      expect(stripe?.data?.['robots']).toBe(NOINDEX_ROBOTS);
    });
  });

  describe('checkout flow routes', () => {
    it('attaches the pricing settings resolver to the checkout entry', () => {
      const checkout = findByPath(routes, 'checkout');
      expect(checkout?.resolve?.['checkoutPricingSettings']).toBe(checkoutPricingSettingsResolver);
      expect(checkout?.data?.['robots']).toBe(NOINDEX_ROBOTS);
    });

    it('declares provider return and cancel routes for every gateway', () => {
      for (const path of [
        'checkout/paypal/return',
        'checkout/stripe/return',
        'checkout/netopia/return',
        'checkout/paypal/cancel',
        'checkout/stripe/cancel',
        'checkout/netopia/cancel',
        'checkout/success',
      ]) {
        const route = findByPath(routes, path);
        expect(route).withContext(path).toBeDefined();
        expect(route?.data?.['robots']).withContext(path).toBe(NOINDEX_ROBOTS);
        expect(typeof route?.loadComponent)
          .withContext(path)
          .toBe('function');
      }
    });
  });

  describe('auth and account guarding', () => {
    it('guards /account and /tickets and /admin with the correct guards', () => {
      expect(routes.find((r) => r.path === 'account')?.canActivate).toEqual([authGuard]);
      expect(routes.find((r) => r.path === 'tickets')?.canActivate).toEqual([authGuard]);
      expect(routes.find((r) => r.path === 'admin')?.canActivate).toEqual([adminGuard]);
    });

    it('marks guarded sections noindex', () => {
      expect(routes.find((r) => r.path === 'account')?.data?.['robots']).toBe(NOINDEX_ROBOTS);
      expect(routes.find((r) => r.path === 'admin')?.data?.['robots']).toBe(NOINDEX_ROBOTS);
      expect(routes.find((r) => r.path === 'tickets')?.data?.['robots']).toBe(NOINDEX_ROBOTS);
    });

    it('applies the unsaved-changes guard to editable account pages only', () => {
      expect(child('account', 'profile')?.canDeactivate).toEqual([unsavedChangesGuard]);
      expect(child('account', 'addresses')?.canDeactivate).toEqual([unsavedChangesGuard]);
      expect(child('account', 'notifications/settings')?.canDeactivate).toEqual([
        unsavedChangesGuard,
      ]);
      // Read-only account pages do not block navigation.
      expect(child('account', 'orders')?.canDeactivate).toBeUndefined();
      expect(child('account', 'wishlist')?.canDeactivate).toBeUndefined();
    });

    it('defaults the empty account path to the overview component', () => {
      const overview = child('account', '');
      expect(typeof overview?.loadComponent).toBe('function');
    });
  });

  describe('admin section routing', () => {
    it('redirects the empty admin path to the dashboard', () => {
      const redirect = child('admin', '');
      expect(redirect?.pathMatch).toBe('full');
      expect(redirect?.redirectTo).toBe('dashboard');
    });

    it('protects each admin section with a section-scoped guard', () => {
      const dashboard = child('admin', 'dashboard');
      expect(Array.isArray(dashboard?.canActivate)).toBeTrue();
      expect(dashboard?.canActivate?.length).toBe(1);
      // adminSectionGuard is a factory: distinct sections yield distinct guards.
      const ordersGuard = child('admin', 'orders')?.canActivate?.[0];
      const productsGuard = child('admin', 'products')?.canActivate?.[0];
      expect(ordersGuard).not.toBe(productsGuard);
      expect(typeof adminSectionGuard).toBe('function');
    });

    it('nests the admin content sub-tree with its own redirect and guards', () => {
      const content = child('admin', 'content');
      expect(content?.canActivate?.length).toBe(1);
      const home = content?.children?.find((c) => c.path === 'home');
      expect(home?.data?.['section']).toBe('home');
      expect(home?.canDeactivate).toEqual([unsavedChangesGuard]);
      const contentRedirect = content?.children?.find((c) => c.path === '');
      expect(contentRedirect?.redirectTo).toBe('home');
    });

    it('nests the admin users sub-tree', () => {
      const users = child('admin', 'users');
      expect(users?.canActivate?.length).toBe(1);
      const gdpr = users?.children?.find((c) => c.path === 'gdpr');
      expect(typeof gdpr?.loadComponent).toBe('function');
    });
  });

  describe('lazy loaded components', () => {
    it('resolves every loadComponent factory to a defined component class', async () => {
      const lazy = flatten(routes).filter(
        (r): r is Route & { loadComponent: NonNullable<Route['loadComponent']> } =>
          typeof r.loadComponent === 'function',
      );
      // Guard against a silent regression where the table loses its lazy pages.
      expect(lazy.length).toBeGreaterThan(20);

      const resolved = await Promise.all(lazy.map((r) => Promise.resolve(r.loadComponent())));
      for (let i = 0; i < resolved.length; i++) {
        expect(resolved[i]).withContext(String(lazy[i].path)).toEqual(jasmine.any(Function));
      }
    });
  });
});
