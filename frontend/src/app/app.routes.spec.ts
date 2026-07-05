import type { Route } from '@angular/router';

import { AdminThemeComponent } from './pages/admin/theme/admin-theme.component';
import { routes } from './app.routes';

describe('app.routes admin theme route (WU10)', () => {
  const adminRoute = routes.find((route) => route.path === 'admin');
  const themeRoute: Route | undefined = adminRoute?.children?.find(
    (route) => route.path === 'theme',
  );

  it('nests the theme route under /admin with its section guards and title', () => {
    expect(adminRoute).toBeTruthy();
    expect(themeRoute).toBeTruthy();
    expect(themeRoute?.title).toBe('meta.titles.admin_theme');
    // adminSectionGuard('theme') + unsavedChangesGuard are wired one apiece.
    expect(themeRoute?.canActivate?.length).toBe(1);
    expect(themeRoute?.canDeactivate?.length).toBe(1);
    expect(themeRoute?.loadComponent).toEqual(jasmine.any(Function));
  });

  it('lazy-loads the AdminThemeComponent for the theme route', async () => {
    const loaded = await (themeRoute?.loadComponent as () => Promise<unknown>)();
    expect(loaded).toBe(AdminThemeComponent);
  });
});
