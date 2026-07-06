import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';

import { AdminFavoritesService } from '../../core/admin-favorites.service';
import { AdminRecentService } from '../../core/admin-recent.service';
import { AdminSupportService } from '../../core/admin-support.service';
import { AdminUiPrefsService } from '../../core/admin-ui-prefs.service';
import { AdminService } from '../../core/admin.service';
import { AuthService } from '../../core/auth.service';
import { OpsService } from '../../core/ops.service';
import { ToastService } from '../../core/toast.service';
import { AdminLayoutComponent } from './admin-layout.component';

/** Reach the WU10 nav config (private class fields) for white-box assertions. */
type NavInternals = {
  ownerBasicSections: Set<string>;
  sectionGroupMap: Record<string, string>;
  recomputeNavViews(): void;
};

function mount(): AdminLayoutComponent {
  TestBed.configureTestingModule({
    imports: [TranslateModule.forRoot(), AdminLayoutComponent],
    providers: [
      {
        provide: AuthService,
        useValue: { canAccessAdminSection: () => true, role: () => 'owner', user: () => null },
      },
      {
        provide: Router,
        useValue: {
          url: '/admin',
          events: of(),
          navigate: () => void 0,
          navigateByUrl: () => void 0,
        },
      },
      {
        provide: TranslateService,
        useValue: { instant: (key: string) => key, onLangChange: new Subject() },
      },
      {
        provide: AdminFavoritesService,
        useValue: { init: () => void 0, items: () => [], toggle: () => void 0 },
      },
      {
        provide: AdminUiPrefsService,
        useValue: {
          preset: () => 'owner_basic',
          mode: () => 'simple',
          sidebarCompact: () => false,
        },
      },
      { provide: AdminRecentService, useValue: { add: () => void 0 } },
      { provide: AdminService, useValue: { summary: () => of({}) } },
      {
        provide: OpsService,
        useValue: { getWebhookFailureStats: () => of({}), getEmailFailureStats: () => of({}) },
      },
      { provide: AdminSupportService, useValue: { submitFeedback: () => of({}) } },
      { provide: ToastService, useValue: { success: () => void 0, error: () => void 0 } },
    ],
  });
  return TestBed.createComponent(AdminLayoutComponent).componentInstance;
}

describe('AdminLayoutComponent theme navigation (WU10)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('exposes the /admin/theme nav entry mapped to the content group', () => {
    const cmp = mount();

    const themeNav = cmp.navItems.find((item) => item.path === '/admin/theme');
    expect(themeNav).toEqual(
      jasmine.objectContaining({ labelKey: 'adminUi.nav.theme', section: 'theme' }),
    );

    const internal = cmp as unknown as NavInternals;
    // theme is part of the owner-basic surface and grouped under content.
    expect(internal.ownerBasicSections.has('theme')).toBeTrue();
    expect(internal.sectionGroupMap['theme']).toBe('content');
  });

  it('surfaces theme in the content group for the owner-basic preset', () => {
    const cmp = mount();

    (cmp as unknown as NavInternals).recomputeNavViews();
    const contentGroup = cmp.groupedFilteredNavItemsView.find((group) => group.key === 'content');
    expect(contentGroup).toBeTruthy();
    expect(contentGroup?.items.some((item) => item.section === 'theme')).toBeTrue();
  });
});
