import type { Route, Routes } from '@angular/router';
import { buildMockCheckoutRoutes, routes } from './app.routes';

type LoadComponentFn = NonNullable<Route['loadComponent']>;

function collectRoutes(input: Routes): Route[] {
  const flat: Route[] = [];
  const walk = (list: Routes): void => {
    for (const route of list) {
      flat.push(route);
      if (route.children) {
        walk(route.children);
      }
    }
  };
  walk(input);
  return flat;
}

describe('app.routes', () => {
  const allRoutes = collectRoutes(routes);

  it('exposes the public top-level pages with their meta titles', () => {
    const byPath = new Map(routes.map((route) => [route.path, route]));

    expect(byPath.get('')?.title).toBe('meta.titles.home');
    expect(byPath.get('shop')?.title).toBe('meta.titles.shop');
    expect(byPath.get('shop')?.pathMatch).toBe('full');
    expect(byPath.get('shop')?.resolve).toEqual(
      jasmine.objectContaining({ categories: jasmine.any(Function) }),
    );
    expect(byPath.get('shop/:category')?.pathMatch).toBeUndefined();
    expect(byPath.get('about')?.title).toBe('meta.titles.about');
    expect(byPath.get('contact')?.title).toBe('meta.titles.contact');
  });

  it('marks the catch-all wildcard route last with the not-found component', () => {
    const last = routes[routes.length - 1];
    expect(last.path).toBe('**');
    expect(last.title).toBe('meta.titles.not_found');
    expect(last.data?.['robots']).toBe('noindex,nofollow');
  });

  it('includes the non-production mock checkout routes (dev/test build)', () => {
    const paths = routes.map((route) => route.path);
    expect(paths).toContain('checkout/mock/paypal');
    expect(paths).toContain('checkout/mock/stripe');

    const paypalMock = routes.find((route) => route.path === 'checkout/mock/paypal');
    expect(paypalMock?.title).toBe('meta.titles.checkout_paypal_mock');
    expect(paypalMock?.data?.['robots']).toBe('noindex,nofollow');
  });

  it('protects the account and admin areas with the expected guards', () => {
    const account = routes.find((route) => route.path === 'account');
    expect(account?.canActivate).toEqual([jasmine.any(Function)]);
    expect(account?.data?.['robots']).toBe('noindex,nofollow');

    const admin = routes.find((route) => route.path === 'admin');
    expect(admin?.canActivate).toEqual([jasmine.any(Function)]);

    const adminChildren = admin?.children ?? [];
    const dashboard = adminChildren.find((route) => route.path === 'dashboard');
    expect(dashboard?.canActivate).toEqual([jasmine.any(Function)]);

    const indexRedirect = adminChildren.find((route) => route.path === '');
    expect(indexRedirect?.redirectTo).toBe('dashboard');
    expect(indexRedirect?.pathMatch).toBe('full');
  });

  it('attaches the unsaved-changes deactivation guard to editable account pages', () => {
    const account = routes.find((route) => route.path === 'account');
    const profile = (account?.children ?? []).find((route) => route.path === 'profile');
    expect(profile?.canDeactivate).toEqual([jasmine.any(Function)]);
  });

  it('lazily resolves every component referenced by a loadComponent route', async () => {
    const lazyRoutes = allRoutes.filter(
      (route): route is Route & { loadComponent: LoadComponentFn } =>
        typeof route.loadComponent === 'function',
    );
    expect(lazyRoutes.length).toBeGreaterThan(0);

    const results = await Promise.allSettled(
      lazyRoutes.map(async (route) => route.loadComponent()),
    );
    const rejected = results
      .map((result, index) => ({ result, route: lazyRoutes[index] }))
      .filter(({ result }) => result.status === 'rejected');
    expect(rejected.map(({ route }) => route.path)).toEqual([]);
    for (const result of results) {
      expect(result.status).toBe('fulfilled');
      if (result.status === 'fulfilled') {
        expect(result.value).toEqual(jasmine.any(Function));
      }
    }
  }, 120000);
});

describe('buildMockCheckoutRoutes', () => {
  it('omits the mock checkout routes in production builds', () => {
    expect(buildMockCheckoutRoutes('production')).toEqual([]);
  });

  it('exposes the paypal and stripe mock routes outside production', async () => {
    const devRoutes = buildMockCheckoutRoutes('development');
    expect(devRoutes.map((route) => route.path)).toEqual([
      'checkout/mock/paypal',
      'checkout/mock/stripe',
    ]);

    for (const route of devRoutes) {
      expect(route.data?.['robots']).toBe('noindex,nofollow');
      const load = route.loadComponent as LoadComponentFn;
      expect(await load()).toEqual(jasmine.any(Function));
    }
  }, 30000);

  it('treats any non-production environment as a mock-enabled build', () => {
    expect(buildMockCheckoutRoutes('staging').map((route) => route.path)).toEqual([
      'checkout/mock/paypal',
      'checkout/mock/stripe',
    ]);
  });
});
