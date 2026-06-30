import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import {
  AdminUserAliasesResponse,
  AdminUserSession,
  AdminService,
} from '../../../core/admin.service';
import { AdminCouponsV2Service } from '../../../core/admin-coupons-v2.service';
import {
  AdminUserListItem,
  AdminUserProfileResponse,
  AdminUsersService,
} from '../../../core/admin-users.service';
import { AuthService } from '../../../core/auth.service';
import { AdminRecentService } from '../../../core/admin-recent.service';
import { AdminFavoriteItem, AdminFavoritesService } from '../../../core/admin-favorites.service';
import { ToastService } from '../../../core/toast.service';
import { AdminUsersComponent } from './admin-users.component';

function makeUser(overrides: Partial<AdminUserListItem> = {}): AdminUserListItem {
  return {
    id: 'u1',
    email: 'user@example.com',
    username: 'user',
    name: 'User One',
    name_tag: 1,
    role: 'customer',
    email_verified: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeProfile(): AdminUserProfileResponse {
  return {
    user: {
      ...makeUser(),
      vip: false,
      admin_note: null,
      locked_until: null,
      locked_reason: null,
      password_reset_required: false,
    },
    addresses: [],
    orders: [],
    tickets: [],
    security_events: [],
  };
}

describe('AdminUsersComponent', () => {
  let usersApi: jasmine.SpyObj<AdminUsersService>;
  let couponsApi: jasmine.SpyObj<AdminCouponsV2Service>;
  let admin: jasmine.SpyObj<AdminService>;
  let auth: jasmine.SpyObj<AuthService>;
  let recent: jasmine.SpyObj<AdminRecentService>;
  let toast: jasmine.SpyObj<ToastService>;
  let translate: jasmine.SpyObj<TranslateService>;
  let favorites: jasmine.SpyObj<AdminFavoritesService>;
  let favItems: AdminFavoriteItem[];

  function build(): AdminUsersComponent {
    return TestBed.inject(AdminUsersComponent);
  }

  beforeEach(() => {
    usersApi = jasmine.createSpyObj<AdminUsersService>('AdminUsersService', [
      'search',
      'getProfile',
      'updateInternal',
      'impersonate',
      'updateSecurity',
      'getEmailVerificationHistory',
      'resendEmailVerification',
      'resendPasswordReset',
      'overrideEmailVerification',
      'executeGdprDeletion',
    ]);
    couponsApi = jasmine.createSpyObj<AdminCouponsV2Service>('AdminCouponsV2Service', [
      'listPromotions',
      'issueCouponToUser',
    ]);
    admin = jasmine.createSpyObj<AdminService>('AdminService', [
      'userAliases',
      'revokeSessions',
      'listUserSessions',
      'revokeSession',
      'updateUserRole',
    ]);
    auth = jasmine.createSpyObj<AuthService>('AuthService', [
      'user',
      'role',
      'isAdmin',
      'canAccessAdminSection',
    ]);
    recent = jasmine.createSpyObj<AdminRecentService>('AdminRecentService', ['add']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    translate = jasmine.createSpyObj<TranslateService>('TranslateService', ['instant']);
    favorites = jasmine.createSpyObj<AdminFavoritesService>('AdminFavoritesService', [
      'init',
      'items',
      'isFavorite',
      'add',
      'remove',
      'loading',
    ]);

    favItems = [];
    (favorites.items as unknown as jasmine.Spy).and.callFake(() => favItems);
    (favorites.loading as unknown as jasmine.Spy).and.returnValue(false);
    favorites.isFavorite.and.returnValue(false);

    translate.instant.and.callFake((key: string | string[]) => key as string);

    auth.user.and.returnValue({ id: 'admin-1' } as any);
    auth.role.and.returnValue('owner');
    auth.isAdmin.and.returnValue(true);
    auth.canAccessAdminSection.and.returnValue(true);

    // Sensible default responses so subscribe() chains resolve.
    usersApi.search.and.returnValue(of({ items: [], meta: null } as any));
    usersApi.getProfile.and.returnValue(of(makeProfile()));
    usersApi.updateInternal.and.returnValue(of({} as any));
    usersApi.impersonate.and.returnValue(of({ access_token: 'tok' } as any));
    usersApi.updateSecurity.and.returnValue(of({} as any));
    usersApi.getEmailVerificationHistory.and.returnValue(of({ items: [] } as any));
    usersApi.resendEmailVerification.and.returnValue(of({ detail: 'ok' }));
    usersApi.resendPasswordReset.and.returnValue(of({ detail: 'ok' }));
    usersApi.overrideEmailVerification.and.returnValue(of({} as any));
    usersApi.executeGdprDeletion.and.returnValue(of(undefined));

    couponsApi.listPromotions.and.returnValue(of([]));
    couponsApi.issueCouponToUser.and.returnValue(of({ code: 'CODE-1' } as any));

    admin.userAliases.and.returnValue(of({} as AdminUserAliasesResponse));
    admin.revokeSessions.and.returnValue(of(undefined));
    admin.listUserSessions.and.returnValue(of([] as AdminUserSession[]));
    admin.revokeSession.and.returnValue(of(undefined));
    admin.updateUserRole.and.returnValue(of({ role: 'admin' } as any));

    TestBed.configureTestingModule({
      providers: [
        AdminUsersComponent,
        { provide: AdminUsersService, useValue: usersApi },
        { provide: AdminCouponsV2Service, useValue: couponsApi },
        { provide: AdminService, useValue: admin },
        { provide: AuthService, useValue: auth },
        { provide: AdminRecentService, useValue: recent },
        { provide: ToastService, useValue: toast },
        { provide: TranslateService, useValue: translate },
        { provide: AdminFavoritesService, useValue: favorites },
      ],
    });
  });

  it('creates', () => {
    expect(build()).toBeTruthy();
  });

  describe('ngOnInit', () => {
    let originalState: any;
    beforeEach(() => {
      originalState = history.state;
    });
    afterEach(() => {
      history.replaceState(originalState, '');
    });

    it('initializes and loads with no special state', () => {
      history.replaceState({}, '');
      const c = build();
      c.ngOnInit();
      expect(favorites.init).toHaveBeenCalled();
      expect(usersApi.search).toHaveBeenCalled();
      expect(c.loading()).toBeFalse();
    });

    it('applies a prefill search from history state', () => {
      history.replaceState({ prefillUserSearch: '  alice  ', autoSelectFirst: true }, '');
      const c = build();
      c.ngOnInit();
      expect(c.q).toBe('alice');
      expect(c.page).toBe(1);
    });

    it('ignores blank prefill search', () => {
      history.replaceState({ prefillUserSearch: '   ', autoSelectFirst: false }, '');
      const c = build();
      c.ngOnInit();
      expect(c.q).toBe('');
    });

    it('handles non-string prefill search', () => {
      history.replaceState({ prefillUserSearch: 42 }, '');
      const c = build();
      c.ngOnInit();
      expect(c.q).toBe('');
    });

    it('applies saved-view filters from state and skips prefill', () => {
      history.replaceState(
        {
          adminFilterScope: 'users',
          adminFilters: { q: 'bob', role: 'admin', limit: 50 },
          prefillUserSearch: 'ignored',
        },
        '',
      );
      const c = build();
      c.ngOnInit();
      expect(c.q).toBe('bob');
      expect(c.role).toBe('admin');
      expect(c.limit).toBe(50);
    });
  });

  describe('maybeApplyFiltersFromState branches (via ngOnInit)', () => {
    let originalState: any;
    beforeEach(() => {
      originalState = history.state;
    });
    afterEach(() => {
      history.replaceState(originalState, '');
    });

    it('returns false when scope is not users', () => {
      history.replaceState({ adminFilterScope: 'orders', adminFilters: { q: 'x' } }, '');
      const c = build();
      c.ngOnInit();
      // prefill path ran (q stays '')
      expect(c.q).toBe('');
    });

    it('returns false when filters missing', () => {
      history.replaceState({ adminFilterScope: 'users' }, '');
      const c = build();
      c.ngOnInit();
      expect(c.q).toBe('');
    });

    it('uses defaults when filter fields absent and limit non-finite', () => {
      history.replaceState({ adminFilterScope: 'users', adminFilters: { limit: Infinity } }, '');
      const c = build();
      c.ngOnInit();
      expect(c.q).toBe('');
      expect(c.role).toBe('all');
      expect(c.limit).toBe(25);
    });
  });

  describe('table layout', () => {
    it('opens and closes the layout modal', () => {
      const c = build();
      c.openLayoutModal();
      expect(c.layoutModalOpen()).toBeTrue();
      c.closeLayoutModal();
      expect(c.layoutModalOpen()).toBeFalse();
    });

    it('applies a table layout and persists it', () => {
      const c = build();
      const layout = { ...c.tableLayout(), density: 'compact' as const };
      c.applyTableLayout(layout);
      expect(c.tableLayout().density).toBe('compact');
    });

    it('toggles density both ways and reports the label', () => {
      const c = build();
      c.applyTableLayout({ ...c.tableLayout(), density: 'comfortable' });
      c.toggleDensity();
      expect(c.tableLayout().density).toBe('compact');
      expect(c.densityToggleLabelKey()).toBe('adminUi.tableLayout.densityToggle.toComfortable');
      c.toggleDensity();
      expect(c.tableLayout().density).toBe('comfortable');
      expect(c.densityToggleLabelKey()).toBe('adminUi.tableLayout.densityToggle.toCompact');
    });

    it('exposes visible columns, padding class and column tracking', () => {
      const c = build();
      expect(Array.isArray(c.visibleColumnIds())).toBeTrue();
      expect(typeof c.cellPaddingClass()).toBe('string');
      expect(c.trackColumnId(0, 'email')).toBe('email');
    });

    it('falls back to anonymous storage key when no auth user id', () => {
      auth.user.and.returnValue(null);
      const c = build();
      c.openLayoutModal();
      c.applyTableLayout(c.tableLayout());
      expect(c.layoutModalOpen()).toBeTrue();
    });
  });

  describe('filters and saved views', () => {
    it('applyFilters resets page and clears saved view', () => {
      const c = build();
      c.page = 5;
      c.selectedSavedViewKey = 'k';
      c.applyFilters();
      expect(c.page).toBe(1);
      expect(c.selectedSavedViewKey).toBe('');
    });

    it('resetFilters clears all filters', () => {
      const c = build();
      c.q = 'x';
      c.role = 'admin';
      c.page = 3;
      c.resetFilters();
      expect(c.q).toBe('');
      expect(c.role).toBe('all');
      expect(c.page).toBe(1);
    });

    it('savedViews returns only user-scoped filter favorites', () => {
      favItems = [
        { key: 'a', type: 'filter', state: { adminFilterScope: 'users' } } as any,
        { key: 'b', type: 'filter', state: { adminFilterScope: 'orders' } } as any,
        { key: 'c', type: 'user' } as any,
        null as any,
      ];
      const c = build();
      const views = c.savedViews();
      expect(views.length).toBe(1);
      expect(views[0].key).toBe('a');
    });

    it('applySavedView ignores empty key', () => {
      const c = build();
      c.applySavedView('');
      expect(c.selectedSavedViewKey).toBe('');
    });

    it('applySavedView returns early when view not found', () => {
      favItems = [];
      const c = build();
      c.applySavedView('missing');
      expect(usersApi.search).not.toHaveBeenCalled();
    });

    it('applySavedView returns early when filters not an object', () => {
      favItems = [
        { key: 'k', type: 'filter', state: { adminFilterScope: 'users', adminFilters: 7 } } as any,
      ];
      const c = build();
      c.applySavedView('k');
      expect(usersApi.search).not.toHaveBeenCalled();
    });

    it('applySavedView applies stored filters and loads', () => {
      favItems = [
        {
          key: 'k',
          type: 'filter',
          state: {
            adminFilterScope: 'users',
            adminFilters: { q: 'zoe', role: 'support', limit: 10 },
          },
        } as any,
      ];
      const c = build();
      c.applySavedView('k');
      expect(c.q).toBe('zoe');
      expect(c.role).toBe('support');
      expect(c.limit).toBe(10);
      expect(usersApi.search).toHaveBeenCalled();
    });

    it('applySavedView uses defaults for missing/non-finite limit and absent role', () => {
      favItems = [
        {
          key: 'k',
          type: 'filter',
          state: { adminFilterScope: 'users', adminFilters: { limit: 'nope' } },
        } as any,
      ];
      const c = build();
      c.limit = 25;
      c.applySavedView('k');
      expect(c.q).toBe('');
      expect(c.role).toBe('all');
      expect(c.limit).toBe(25);
    });

    it('isCurrentViewPinned delegates to favorites', () => {
      favorites.isFavorite.and.returnValue(true);
      const c = build();
      expect(c.isCurrentViewPinned()).toBeTrue();
    });

    it('toggleCurrentViewPin unpins a pinned current view', () => {
      const c = build();
      favorites.isFavorite.and.returnValue(true);
      c.selectedSavedViewKey = c['currentViewFavoriteKey']();
      c.toggleCurrentViewPin();
      expect(favorites.remove).toHaveBeenCalled();
      expect(c.selectedSavedViewKey).toBe('');
    });

    it('toggleCurrentViewPin unpins without clearing a different selected key', () => {
      const c = build();
      favorites.isFavorite.and.returnValue(true);
      c.selectedSavedViewKey = 'other';
      c.toggleCurrentViewPin();
      expect(favorites.remove).toHaveBeenCalled();
      expect(c.selectedSavedViewKey).toBe('other');
    });

    it('toggleCurrentViewPin shows error when name prompt is empty', () => {
      spyOn(window, 'prompt').and.returnValue('   ');
      const c = build();
      c.toggleCurrentViewPin();
      expect(toast.error).toHaveBeenCalled();
      expect(favorites.add).not.toHaveBeenCalled();
    });

    it('toggleCurrentViewPin pins with a provided name (null prompt path)', () => {
      spyOn(window, 'prompt').and.returnValue(null);
      const c = build();
      c.toggleCurrentViewPin();
      // null -> '' -> trimmed empty -> error branch
      expect(toast.error).toHaveBeenCalled();
    });

    it('toggleCurrentViewPin adds a favorite with the given name', () => {
      spyOn(window, 'prompt').and.returnValue('My View');
      const c = build();
      c.toggleCurrentViewPin();
      expect(favorites.add).toHaveBeenCalled();
      expect(c.selectedSavedViewKey).toBeTruthy();
    });
  });

  describe('pagination and selection', () => {
    it('goToPage loads the requested page', () => {
      const c = build();
      c.goToPage(4);
      expect(c.page).toBe(4);
      expect(usersApi.search).toHaveBeenCalled();
    });

    it('trackUserId returns the user id', () => {
      const c = build();
      expect(c.trackUserId(0, makeUser({ id: 'x9' }))).toBe('x9');
    });

    it('select records recent, resets fields and loads detail (with email)', () => {
      const c = build();
      c.select(makeUser({ id: 'u2', email: 'a@b.com' }));
      expect(recent.add).toHaveBeenCalled();
      expect(c.selectedUser()?.id).toBe('u2');
      expect(admin.userAliases).toHaveBeenCalledWith('u2', jasmine.any(Object));
      expect(usersApi.getProfile).toHaveBeenCalled();
      expect(admin.listUserSessions).toHaveBeenCalled();
    });

    it('select with empty email passes null recent state', () => {
      const c = build();
      c.select(makeUser({ id: 'u3', email: '' }));
      const arg = recent.add.calls.mostRecent().args[0] as any;
      expect(arg.state).toBeNull();
    });
  });

  describe('role change', () => {
    it('updateRole no-ops with no selected user', () => {
      const c = build();
      c.updateRole();
      expect(c.roleChangeOpen()).toBeFalse();
    });

    it('updateRole no-ops for owner user', () => {
      const c = build();
      c.selectedUser.set(makeUser({ role: 'owner' }));
      c.updateRole();
      expect(c.roleChangeOpen()).toBeFalse();
    });

    it('updateRole no-ops when role unchanged', () => {
      const c = build();
      c.selectedUser.set(makeUser({ role: 'customer' }));
      c.selectedRole = 'customer';
      c.updateRole();
      expect(c.roleChangeOpen()).toBeFalse();
    });

    it('updateRole opens the modal when valid', () => {
      const c = build();
      c.selectedUser.set(makeUser({ role: 'customer' }));
      c.selectedRole = 'admin';
      c.updateRole();
      expect(c.roleChangeOpen()).toBeTrue();
    });

    it('closeRoleChange resets state', () => {
      const c = build();
      c.roleChangeOpen.set(true);
      c.roleChangePassword = 'x';
      c.closeRoleChange();
      expect(c.roleChangeOpen()).toBeFalse();
      expect(c.roleChangePassword).toBe('');
    });

    it('confirmRoleChange no-ops without user', () => {
      const c = build();
      c.confirmRoleChange();
      expect(admin.updateUserRole).not.toHaveBeenCalled();
    });

    it('confirmRoleChange no-ops for owner', () => {
      const c = build();
      c.selectedUser.set(makeUser({ role: 'owner' }));
      c.confirmRoleChange();
      expect(admin.updateUserRole).not.toHaveBeenCalled();
    });

    it('confirmRoleChange closes when role unchanged', () => {
      const c = build();
      c.selectedUser.set(makeUser({ role: 'customer' }));
      c.selectedRole = 'customer';
      c.roleChangeOpen.set(true);
      c.confirmRoleChange();
      expect(c.roleChangeOpen()).toBeFalse();
    });

    it('confirmRoleChange requires a password', () => {
      const c = build();
      c.selectedUser.set(makeUser({ role: 'customer' }));
      c.selectedRole = 'admin';
      c.roleChangePassword = '   ';
      c.confirmRoleChange();
      expect(c.roleChangeError()).toBeTruthy();
      expect(toast.error).toHaveBeenCalled();
    });

    it('confirmRoleChange succeeds and updates lists and profile', () => {
      const c = build();
      const user = makeUser({ id: 'u1', role: 'customer' });
      c.users.set([user]);
      c.profile.set(makeProfile());
      c.selectedUser.set(user);
      c.selectedRole = 'admin';
      c.roleChangePassword = 'pw';
      admin.updateUserRole.and.returnValue(of({ role: 'admin' } as any));
      c.confirmRoleChange();
      expect(toast.success).toHaveBeenCalled();
      expect(c.selectedUser()?.role).toBe('admin');
      expect(c.users()[0].role).toBe('admin');
      expect(c.profile()?.user.role).toBe('admin');
      expect(c.roleChangeOpen()).toBeFalse();
    });

    it('confirmRoleChange succeeds when no profile loaded', () => {
      const c = build();
      const user = makeUser({ id: 'u1', role: 'customer' });
      c.users.set([user]);
      c.profile.set(null);
      c.selectedUser.set(user);
      c.selectedRole = 'admin';
      c.roleChangePassword = 'pw';
      c.confirmRoleChange();
      expect(c.profile()).toBeNull();
      expect(toast.success).toHaveBeenCalled();
    });

    it('confirmRoleChange surfaces server error detail', () => {
      const c = build();
      c.selectedUser.set(makeUser({ role: 'customer' }));
      c.selectedRole = 'admin';
      c.roleChangePassword = 'pw';
      admin.updateUserRole.and.returnValue(throwError(() => ({ error: { detail: 'boom' } })));
      c.confirmRoleChange();
      expect(c.roleChangeError()).toBe('boom');
      expect(c.roleChangeBusy()).toBeFalse();
    });

    it('confirmRoleChange requires a password when field is empty (default branch)', () => {
      const c = build();
      c.selectedUser.set(makeUser({ role: 'customer' }));
      c.selectedRole = 'admin';
      c.roleChangePassword = '';
      c.confirmRoleChange();
      expect(c.roleChangeError()).toBeTruthy();
      expect(admin.updateUserRole).not.toHaveBeenCalled();
    });

    it('confirmRoleChange leaves non-matching users untouched in the list', () => {
      const c = build();
      const user = makeUser({ id: 'u1', role: 'customer' });
      const other = makeUser({ id: 'u2', role: 'customer' });
      c.users.set([user, other]);
      c.selectedUser.set(user);
      c.selectedRole = 'admin';
      c.roleChangePassword = 'pw';
      admin.updateUserRole.and.returnValue(of({ role: 'admin' } as any));
      c.confirmRoleChange();
      const roles = c.users().map((u) => `${u.id}:${u.role}`);
      expect(roles).toEqual(['u1:admin', 'u2:customer']);
    });

    it('confirmRoleChange falls back to generic error', () => {
      const c = build();
      c.selectedUser.set(makeUser({ role: 'customer' }));
      c.selectedRole = 'admin';
      c.roleChangePassword = 'pw';
      admin.updateUserRole.and.returnValue(throwError(() => ({})));
      c.confirmRoleChange();
      expect(c.roleChangeError()).toBe('adminUi.users.errors.role');
    });
  });

  describe('delete user', () => {
    it('openDeleteUser no-ops without user', () => {
      const c = build();
      c.openDeleteUser();
      expect(c.deleteUserOpen()).toBeFalse();
    });

    it('openDeleteUser no-ops for owner', () => {
      const c = build();
      c.selectedUser.set(makeUser({ role: 'owner' }));
      c.openDeleteUser();
      expect(c.deleteUserOpen()).toBeFalse();
    });

    it('openDeleteUser opens for normal user', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.openDeleteUser();
      expect(c.deleteUserOpen()).toBeTrue();
    });

    it('closeDeleteUser resets', () => {
      const c = build();
      c.deleteUserOpen.set(true);
      c.deleteUserPassword = 'p';
      c.closeDeleteUser();
      expect(c.deleteUserOpen()).toBeFalse();
      expect(c.deleteUserPassword).toBe('');
    });

    it('confirmDeleteUser no-ops without user', () => {
      const c = build();
      c.confirmDeleteUser();
      expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
    });

    it('confirmDeleteUser no-ops for owner', () => {
      const c = build();
      c.selectedUser.set(makeUser({ role: 'owner' }));
      c.confirmDeleteUser();
      expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
    });

    it('confirmDeleteUser requires DELETE confirmation', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.deleteUserConfirm = 'nope';
      c.confirmDeleteUser();
      expect(c.deleteUserError()).toBeTruthy();
      expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
    });

    it('confirmDeleteUser requires confirmation when field is empty (default branch)', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.deleteUserConfirm = '';
      c.confirmDeleteUser();
      expect(c.deleteUserError()).toBeTruthy();
      expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
    });

    it('confirmDeleteUser requires a password when field is empty (default branch)', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.deleteUserConfirm = 'DELETE';
      c.deleteUserPassword = '';
      c.confirmDeleteUser();
      expect(c.deleteUserError()).toBeTruthy();
      expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
    });

    it('confirmDeleteUser requires a password', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.deleteUserConfirm = 'delete';
      c.deleteUserPassword = '  ';
      c.confirmDeleteUser();
      expect(c.deleteUserError()).toBeTruthy();
      expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
    });

    it('confirmDeleteUser succeeds', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.profile.set(makeProfile());
      c.deleteUserConfirm = 'DELETE';
      c.deleteUserPassword = 'pw';
      c.confirmDeleteUser();
      expect(toast.success).toHaveBeenCalled();
      expect(c.selectedUser()).toBeNull();
      expect(c.profile()).toBeNull();
    });

    it('confirmDeleteUser surfaces server error detail', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.deleteUserConfirm = 'DELETE';
      c.deleteUserPassword = 'pw';
      usersApi.executeGdprDeletion.and.returnValue(
        throwError(() => ({ error: { detail: 'nope' } })),
      );
      c.confirmDeleteUser();
      expect(c.deleteUserError()).toBe('nope');
      expect(c.deleteUserBusy()).toBeFalse();
    });

    it('confirmDeleteUser falls back to generic error', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.deleteUserConfirm = 'DELETE';
      c.deleteUserPassword = 'pw';
      usersApi.executeGdprDeletion.and.returnValue(throwError(() => ({})));
      c.confirmDeleteUser();
      expect(c.deleteUserError()).toBe('adminUi.users.errors.delete');
    });
  });

  describe('sessions', () => {
    it('forceLogout no-ops without user', () => {
      const c = build();
      c.forceLogout();
      expect(admin.revokeSessions).not.toHaveBeenCalled();
    });

    it('forceLogout success clears sessions', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.forceLogout();
      expect(toast.success).toHaveBeenCalled();
      expect(c.sessions()).toEqual([]);
    });

    it('forceLogout error toasts', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      admin.revokeSessions.and.returnValue(throwError(() => ({})));
      c.forceLogout();
      expect(toast.error).toHaveBeenCalled();
    });

    it('refreshSessions no-ops without user', () => {
      const c = build();
      c.refreshSessions();
      expect(admin.listUserSessions).not.toHaveBeenCalled();
    });

    it('refreshSessions loads sessions', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.refreshSessions();
      expect(admin.listUserSessions).toHaveBeenCalled();
    });

    it('revokeOneSession no-ops without user', () => {
      const c = build();
      c.revokeOneSession('s1');
      expect(admin.revokeSession).not.toHaveBeenCalled();
    });

    it('revokeOneSession removes the session from the list', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.sessions.set([{ id: 's1' } as AdminUserSession, { id: 's2' } as AdminUserSession]);
      c.revokeOneSession('s1');
      expect(c.sessions()?.map((s) => s.id)).toEqual(['s2']);
      expect(c.revokingSessionId()).toBeNull();
    });

    it('revokeOneSession success when sessions list is null', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.sessions.set(null);
      c.revokeOneSession('s1');
      expect(c.sessions()).toBeNull();
      expect(toast.success).toHaveBeenCalled();
    });

    it('revokeOneSession error resets revoking id', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      admin.revokeSession.and.returnValue(throwError(() => ({})));
      c.revokeOneSession('s1');
      expect(toast.error).toHaveBeenCalled();
      expect(c.revokingSessionId()).toBeNull();
    });
  });

  describe('internal notes', () => {
    it('saveInternal no-ops without user', () => {
      const c = build();
      c.saveInternal();
      expect(usersApi.updateInternal).not.toHaveBeenCalled();
    });

    it('saveInternal success with profile and trimmed note', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.profile.set(makeProfile());
      c.vip = true;
      c.adminNote = '  note  ';
      usersApi.updateInternal.and.returnValue(of({ vip: true, admin_note: 'note' } as any));
      c.saveInternal();
      expect(usersApi.updateInternal).toHaveBeenCalledWith('u1', {
        vip: true,
        admin_note: 'note',
      });
      expect(c.vip).toBeTrue();
      expect(c.adminNote).toBe('note');
      expect(c.internalBusy()).toBeFalse();
    });

    it('saveInternal success without profile and empty note', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.profile.set(null);
      c.adminNote = '   ';
      usersApi.updateInternal.and.returnValue(of(null as any));
      c.saveInternal();
      expect(usersApi.updateInternal).toHaveBeenCalledWith('u1', {
        vip: false,
        admin_note: null,
      });
      expect(c.vip).toBeFalse();
      expect(c.adminNote).toBe('');
    });

    it('saveInternal error toasts', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      usersApi.updateInternal.and.returnValue(throwError(() => ({})));
      c.saveInternal();
      expect(toast.error).toHaveBeenCalled();
      expect(c.internalBusy()).toBeFalse();
    });
  });

  describe('lock helpers', () => {
    it('isLocked false when no locked_until', () => {
      const c = build();
      c.profile.set(makeProfile());
      expect(c.isLocked()).toBeFalse();
    });

    it('isLocked true when locked in the future', () => {
      const c = build();
      const p = makeProfile();
      p.user.locked_until = new Date(Date.now() + 60_000).toISOString();
      c.profile.set(p);
      expect(c.isLocked()).toBeTrue();
    });

    it('isLocked false when locked time is in the past', () => {
      const c = build();
      const p = makeProfile();
      p.user.locked_until = new Date(Date.now() - 60_000).toISOString();
      c.profile.set(p);
      expect(c.isLocked()).toBeFalse();
    });

    it('isLocked false when locked_until is unparseable', () => {
      const c = build();
      const p = makeProfile();
      p.user.locked_until = 'not-a-date';
      c.profile.set(p);
      expect(c.isLocked()).toBeFalse();
    });
  });

  describe('role/permission helpers', () => {
    it('isOwner true for owner role', () => {
      auth.role.and.returnValue('owner');
      expect(build().isOwner()).toBeTrue();
    });

    it('isOwner false otherwise and handles null role', () => {
      auth.role.and.returnValue(null);
      expect(build().isOwner()).toBeFalse();
    });

    it('canManageRoles delegates to auth.isAdmin', () => {
      auth.isAdmin.and.returnValue(false);
      expect(build().canManageRoles()).toBeFalse();
    });

    it('canIssueCoupons delegates to auth section access', () => {
      auth.canAccessAdminSection.and.returnValue(true);
      expect(build().canIssueCoupons()).toBeTrue();
    });

    it('canRevealPii true for privileged roles, false otherwise', () => {
      const c = build();
      auth.role.and.returnValue('owner');
      expect(c.canRevealPii()).toBeTrue();
      auth.role.and.returnValue('admin');
      expect(c.canRevealPii()).toBeTrue();
      auth.role.and.returnValue('support');
      expect(c.canRevealPii()).toBeTrue();
      auth.role.and.returnValue('fulfillment');
      expect(c.canRevealPii()).toBeTrue();
      auth.role.and.returnValue('customer');
      expect(c.canRevealPii()).toBeFalse();
      auth.role.and.returnValue(null);
      expect(c.canRevealPii()).toBeFalse();
    });
  });

  describe('coupon promotions', () => {
    it('ensureCouponPromotions skips when not allowed', () => {
      auth.canAccessAdminSection.and.returnValue(false);
      const c = build();
      c.ensureCouponPromotions();
      expect(couponsApi.listPromotions).not.toHaveBeenCalled();
    });

    it('ensureCouponPromotions skips when already loaded and not forced', () => {
      const c = build();
      c.couponPromotions.set([]);
      c.ensureCouponPromotions();
      expect(couponsApi.listPromotions).not.toHaveBeenCalled();
    });

    it('ensureCouponPromotions force reloads and selects first promotion', () => {
      const c = build();
      c.couponPromotions.set([]);
      couponsApi.listPromotions.and.returnValue(of([{ id: 'p1' }] as any));
      c.ensureCouponPromotions(true);
      expect(couponsApi.listPromotions).toHaveBeenCalled();
      expect(c.couponPromotionId).toBe('p1');
    });

    it('ensureCouponPromotions keeps existing id when promotions empty', () => {
      const c = build();
      c.couponPromotionId = 'keep';
      couponsApi.listPromotions.and.returnValue(of([] as any));
      c.ensureCouponPromotions();
      expect(c.couponPromotionId).toBe('keep');
    });

    it('ensureCouponPromotions handles null promotions response', () => {
      const c = build();
      couponsApi.listPromotions.and.returnValue(of(null as any));
      c.ensureCouponPromotions();
      expect(c.couponPromotions()).toEqual([]);
    });

    it('ensureCouponPromotions error sets error and empties', () => {
      const c = build();
      couponsApi.listPromotions.and.returnValue(throwError(() => ({})));
      c.ensureCouponPromotions();
      expect(c.couponPromotionsError()).toBeTruthy();
      expect(c.couponPromotions()).toEqual([]);
    });
  });

  describe('issue coupon', () => {
    it('no-ops without user', () => {
      const c = build();
      c.issueCoupon();
      expect(couponsApi.issueCouponToUser).not.toHaveBeenCalled();
    });

    it('no-ops when coupons not allowed', () => {
      auth.canAccessAdminSection.and.returnValue(false);
      const c = build();
      c.selectedUser.set(makeUser());
      c.issueCoupon();
      expect(couponsApi.issueCouponToUser).not.toHaveBeenCalled();
    });

    it('no-ops without a promotion id', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.couponPromotionId = '  ';
      c.issueCoupon();
      expect(couponsApi.issueCouponToUser).not.toHaveBeenCalled();
    });

    it('no-ops when promotion id is empty (default branch)', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.couponPromotionId = '';
      c.issueCoupon();
      expect(couponsApi.issueCouponToUser).not.toHaveBeenCalled();
    });

    it('issues with prefix and numeric string validity days', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.couponPromotionId = 'p1';
      c.couponPrefix = '  VIP ';
      c.couponValidityDays = '45';
      couponsApi.issueCouponToUser.and.returnValue(of({ code: 'X1' } as any));
      c.issueCoupon();
      expect(couponsApi.issueCouponToUser).toHaveBeenCalledWith(
        jasmine.objectContaining({ prefix: 'VIP', validity_days: 45 }),
      );
      expect(c.couponIssuedCode()).toBe('X1');
    });

    it('issues with no prefix and invalid validity days (null)', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.couponPromotionId = 'p1';
      c.couponPrefix = '   ';
      c.couponValidityDays = 0;
      c.issueCoupon();
      expect(couponsApi.issueCouponToUser).toHaveBeenCalledWith(
        jasmine.objectContaining({ prefix: null, validity_days: null }),
      );
    });

    it('issue coupon error sets error', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.couponPromotionId = 'p1';
      couponsApi.issueCouponToUser.and.returnValue(throwError(() => ({})));
      c.issueCoupon();
      expect(c.couponIssueError()).toBeTruthy();
      expect(c.couponIssueBusy()).toBeFalse();
    });

    it('copyIssuedCoupon no-ops without a code', () => {
      const c = build();
      c.copyIssuedCoupon();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('copyIssuedCoupon writes to clipboard when available', () => {
      const writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
      const original = (navigator as any).clipboard;
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });
      const c = build();
      c.couponIssuedCode.set('CODE');
      c.copyIssuedCoupon();
      expect(writeText).toHaveBeenCalledWith('CODE');
      expect(toast.success).toHaveBeenCalled();
      Object.defineProperty(navigator, 'clipboard', {
        value: original,
        configurable: true,
      });
    });

    it('copyIssuedCoupon tolerates missing clipboard', () => {
      const original = (navigator as any).clipboard;
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      const c = build();
      c.couponIssuedCode.set('CODE');
      c.copyIssuedCoupon();
      expect(toast.success).toHaveBeenCalled();
      Object.defineProperty(navigator, 'clipboard', {
        value: original,
        configurable: true,
      });
    });
  });

  describe('security lock/unlock', () => {
    it('lockForMinutes no-ops without user', () => {
      const c = build();
      c.lockForMinutes(5);
      expect(usersApi.updateSecurity).not.toHaveBeenCalled();
    });

    it('lockForMinutes success with profile and reason', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.profile.set(makeProfile());
      c.lockedReason = '  abuse ';
      usersApi.updateSecurity.and.returnValue(
        of({ locked_reason: 'abuse', password_reset_required: true } as any),
      );
      c.lockForMinutes(10);
      expect(usersApi.updateSecurity).toHaveBeenCalled();
      expect(c.lockedReason).toBe('abuse');
      expect(c.passwordResetRequired).toBeTrue();
      expect(c.securityBusy()).toBeFalse();
    });

    it('lockForMinutes clamps invalid minutes and works without profile/reason', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.profile.set(null);
      c.lockedReason = '   ';
      usersApi.updateSecurity.and.returnValue(of(null as any));
      c.lockForMinutes(NaN as any);
      const payload = usersApi.updateSecurity.calls.mostRecent().args[1] as any;
      expect(payload.locked_reason).toBeNull();
      expect(c.lockedReason).toBe('');
      expect(c.passwordResetRequired).toBeFalse();
    });

    it('lockForMinutes error toasts', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      usersApi.updateSecurity.and.returnValue(throwError(() => ({})));
      c.lockForMinutes(5);
      expect(toast.error).toHaveBeenCalled();
      expect(c.securityBusy()).toBeFalse();
    });

    it('unlock no-ops without user', () => {
      const c = build();
      c.unlock();
      expect(usersApi.updateSecurity).not.toHaveBeenCalled();
    });

    it('unlock success with profile', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.profile.set(makeProfile());
      usersApi.updateSecurity.and.returnValue(of({ password_reset_required: true } as any));
      c.unlock();
      expect(c.lockedReason).toBe('');
      expect(c.passwordResetRequired).toBeTrue();
    });

    it('unlock success without profile', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.profile.set(null);
      usersApi.updateSecurity.and.returnValue(of(null as any));
      c.unlock();
      expect(c.passwordResetRequired).toBeFalse();
    });

    it('unlock error toasts', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      usersApi.updateSecurity.and.returnValue(throwError(() => ({})));
      c.unlock();
      expect(toast.error).toHaveBeenCalled();
    });

    it('saveSecurity no-ops without user', () => {
      const c = build();
      c.saveSecurity();
      expect(usersApi.updateSecurity).not.toHaveBeenCalled();
    });

    it('saveSecurity success with profile and reason', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.profile.set(makeProfile());
      c.lockedReason = ' reason ';
      usersApi.updateSecurity.and.returnValue(
        of({ locked_reason: 'reason', password_reset_required: false } as any),
      );
      c.saveSecurity();
      expect(c.lockedReason).toBe('reason');
    });

    it('saveSecurity success without profile and empty reason', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.profile.set(null);
      c.lockedReason = '  ';
      usersApi.updateSecurity.and.returnValue(of(null as any));
      c.saveSecurity();
      const payload = usersApi.updateSecurity.calls.mostRecent().args[1] as any;
      expect(payload.locked_reason).toBeNull();
    });

    it('saveSecurity error toasts', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      usersApi.updateSecurity.and.returnValue(throwError(() => ({})));
      c.saveSecurity();
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('password reset email', () => {
    it('no-ops without user', () => {
      const c = build();
      c.sendPasswordResetEmail();
      expect(usersApi.resendPasswordReset).not.toHaveBeenCalled();
    });

    it('aborts when confirm declined', () => {
      spyOn(window, 'confirm').and.returnValue(false);
      const c = build();
      c.selectedUser.set(makeUser());
      c.sendPasswordResetEmail();
      expect(usersApi.resendPasswordReset).not.toHaveBeenCalled();
    });

    it('sends on confirm and toasts success', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      const c = build();
      c.selectedUser.set(makeUser());
      c.sendPasswordResetEmail();
      expect(usersApi.resendPasswordReset).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalled();
      expect(c.passwordResetEmailBusy()).toBeFalse();
    });

    it('error toasts and resets busy', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      const c = build();
      c.selectedUser.set(makeUser());
      usersApi.resendPasswordReset.and.returnValue(throwError(() => ({})));
      c.sendPasswordResetEmail();
      expect(toast.error).toHaveBeenCalled();
      expect(c.passwordResetEmailBusy()).toBeFalse();
    });
  });

  describe('email verification', () => {
    it('loadEmailHistory no-ops without user', () => {
      const c = build();
      c.loadEmailHistory();
      expect(usersApi.getEmailVerificationHistory).not.toHaveBeenCalled();
    });

    it('loadEmailHistory success', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      usersApi.getEmailVerificationHistory.and.returnValue(of({ items: [] } as any));
      c.loadEmailHistory();
      expect(c.emailHistory()).toBeTruthy();
      expect(c.emailHistoryLoading()).toBeFalse();
    });

    it('loadEmailHistory error', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      usersApi.getEmailVerificationHistory.and.returnValue(throwError(() => ({})));
      c.loadEmailHistory();
      expect(c.emailHistoryError()).toBeTruthy();
    });

    it('resendVerification no-ops without user', () => {
      const c = build();
      c.resendVerification();
      expect(usersApi.resendEmailVerification).not.toHaveBeenCalled();
    });

    it('resendVerification success reloads history', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      c.resendVerification();
      expect(toast.success).toHaveBeenCalled();
      expect(usersApi.getEmailVerificationHistory).toHaveBeenCalled();
      expect(c.emailVerificationBusy()).toBeFalse();
    });

    it('resendVerification error toasts', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      usersApi.resendEmailVerification.and.returnValue(throwError(() => ({})));
      c.resendVerification();
      expect(toast.error).toHaveBeenCalled();
      expect(c.emailVerificationBusy()).toBeFalse();
    });

    it('overrideVerification no-ops without user', () => {
      const c = build();
      c.overrideVerification();
      expect(c.overrideVerificationOpen()).toBeFalse();
    });

    it('overrideVerification no-ops for already-verified user', () => {
      const c = build();
      c.selectedUser.set(makeUser({ email_verified: true }));
      c.overrideVerification();
      expect(c.overrideVerificationOpen()).toBeFalse();
    });

    it('overrideVerification opens for unverified user', () => {
      const c = build();
      c.selectedUser.set(makeUser({ email_verified: false }));
      c.overrideVerification();
      expect(c.overrideVerificationOpen()).toBeTrue();
    });

    it('closeOverrideVerification resets', () => {
      const c = build();
      c.overrideVerificationOpen.set(true);
      c.overrideVerificationPassword = 'x';
      c.closeOverrideVerification();
      expect(c.overrideVerificationOpen()).toBeFalse();
      expect(c.overrideVerificationPassword).toBe('');
    });

    it('confirmOverrideVerification no-ops without user', () => {
      const c = build();
      c.confirmOverrideVerification();
      expect(usersApi.overrideEmailVerification).not.toHaveBeenCalled();
    });

    it('confirmOverrideVerification closes when already verified', () => {
      const c = build();
      c.selectedUser.set(makeUser({ email_verified: true }));
      c.overrideVerificationOpen.set(true);
      c.confirmOverrideVerification();
      expect(c.overrideVerificationOpen()).toBeFalse();
    });

    it('confirmOverrideVerification requires password', () => {
      const c = build();
      c.selectedUser.set(makeUser({ email_verified: false }));
      c.overrideVerificationPassword = '  ';
      c.confirmOverrideVerification();
      expect(c.overrideVerificationError()).toBeTruthy();
    });

    it('confirmOverrideVerification requires password when field empty (default branch)', () => {
      const c = build();
      c.selectedUser.set(makeUser({ email_verified: false }));
      c.overrideVerificationPassword = '';
      c.confirmOverrideVerification();
      expect(c.overrideVerificationError()).toBeTruthy();
      expect(usersApi.overrideEmailVerification).not.toHaveBeenCalled();
    });

    it('confirmOverrideVerification leaves non-matching users untouched', () => {
      const c = build();
      const user = makeUser({ id: 'u1', email_verified: false });
      const other = makeUser({ id: 'u2', email_verified: false });
      c.users.set([user, other]);
      c.selectedUser.set(user);
      c.overrideVerificationPassword = 'pw';
      usersApi.overrideEmailVerification.and.returnValue(of({ email_verified: true } as any));
      c.confirmOverrideVerification();
      const verified = c.users().map((u) => `${u.id}:${u.email_verified}`);
      expect(verified).toEqual(['u1:true', 'u2:false']);
    });

    it('confirmOverrideVerification success updates lists and profile', () => {
      const c = build();
      const user = makeUser({ id: 'u1', email_verified: false });
      c.users.set([user]);
      c.profile.set(makeProfile());
      c.selectedUser.set(user);
      c.overrideVerificationPassword = 'pw';
      usersApi.overrideEmailVerification.and.returnValue(of({ email_verified: true } as any));
      c.confirmOverrideVerification();
      expect(c.selectedUser()?.email_verified).toBeTrue();
      expect(c.users()[0].email_verified).toBeTrue();
      expect(c.overrideVerificationOpen()).toBeFalse();
    });

    it('confirmOverrideVerification success without profile', () => {
      const c = build();
      const user = makeUser({ id: 'u1', email_verified: false });
      c.users.set([user]);
      c.profile.set(null);
      c.selectedUser.set(user);
      c.overrideVerificationPassword = 'pw';
      usersApi.overrideEmailVerification.and.returnValue(of({ email_verified: true } as any));
      c.confirmOverrideVerification();
      expect(c.profile()).toBeNull();
      expect(c.selectedUser()?.email_verified).toBeTrue();
    });

    it('confirmOverrideVerification error detail', () => {
      const c = build();
      c.selectedUser.set(makeUser({ email_verified: false }));
      c.overrideVerificationPassword = 'pw';
      usersApi.overrideEmailVerification.and.returnValue(
        throwError(() => ({ error: { detail: 'bad' } })),
      );
      c.confirmOverrideVerification();
      expect(c.overrideVerificationError()).toBe('bad');
      expect(c.emailVerificationBusy()).toBeFalse();
    });

    it('confirmOverrideVerification generic error', () => {
      const c = build();
      c.selectedUser.set(makeUser({ email_verified: false }));
      c.overrideVerificationPassword = 'pw';
      usersApi.overrideEmailVerification.and.returnValue(throwError(() => ({})));
      c.confirmOverrideVerification();
      expect(c.overrideVerificationError()).toBe('adminUi.users.errors.verificationOverridden');
    });
  });

  describe('impersonate', () => {
    it('no-ops without user', () => {
      const c = build();
      c.impersonate();
      expect(usersApi.impersonate).not.toHaveBeenCalled();
    });

    it('opens a new window with the token', () => {
      const openSpy = spyOn(window, 'open').and.returnValue(null);
      const c = build();
      c.selectedUser.set(makeUser());
      usersApi.impersonate.and.returnValue(of({ access_token: 'tok' } as any));
      c.impersonate();
      expect(openSpy).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalled();
      expect(c.impersonateBusy()).toBeFalse();
    });

    it('errors when token missing', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      usersApi.impersonate.and.returnValue(of({ access_token: '' } as any));
      c.impersonate();
      expect(toast.error).toHaveBeenCalled();
      expect(c.impersonateBusy()).toBeFalse();
    });

    it('errors on request failure', () => {
      const c = build();
      c.selectedUser.set(makeUser());
      usersApi.impersonate.and.returnValue(throwError(() => ({})));
      c.impersonate();
      expect(toast.error).toHaveBeenCalled();
      expect(c.impersonateBusy()).toBeFalse();
    });
  });

  describe('presentation helpers', () => {
    it('identityLabel formats the user identity', () => {
      const c = build();
      expect(typeof c.identityLabel(makeUser())).toBe('string');
    });

    it('rolePillClass returns a class per role', () => {
      const c = build();
      expect(c.rolePillClass('owner')).toContain('indigo');
      expect(c.rolePillClass('admin')).toContain('emerald');
      expect(c.rolePillClass('support')).toContain('sky');
      expect(c.rolePillClass('fulfillment')).toContain('amber');
      expect(c.rolePillClass('content')).toContain('fuchsia');
      expect(c.rolePillClass('customer')).toContain('slate');
    });

    it('sessionDeviceLabel handles empty, short and long user agents', () => {
      const c = build();
      expect(c.sessionDeviceLabel({ user_agent: '' } as AdminUserSession)).toBe(
        'adminUi.users.unknownDevice',
      );
      expect(c.sessionDeviceLabel({ user_agent: 'Mozilla' } as AdminUserSession)).toBe('Mozilla');
      const long = 'x'.repeat(200);
      const out = c.sessionDeviceLabel({ user_agent: long } as AdminUserSession);
      expect(out.endsWith('…')).toBeTrue();
      expect(out.length).toBe(141);
    });
  });

  describe('pii reveal', () => {
    it('togglePiiReveal no-ops when not allowed', () => {
      auth.role.and.returnValue('customer');
      const c = build();
      const before = c.piiReveal();
      c.togglePiiReveal();
      expect(c.piiReveal()).toBe(before);
    });

    it('togglePiiReveal toggles and reloads with no selected user', () => {
      auth.role.and.returnValue('admin');
      const c = build();
      c.selectedUser.set(null);
      const before = c.piiReveal();
      c.togglePiiReveal();
      expect(c.piiReveal()).toBe(!before);
      expect(usersApi.search).toHaveBeenCalled();
    });

    it('togglePiiReveal reloads selected user detail', () => {
      auth.role.and.returnValue('admin');
      const c = build();
      c.selectedUser.set(makeUser());
      c.togglePiiReveal();
      expect(admin.userAliases).toHaveBeenCalled();
      expect(usersApi.getProfile).toHaveBeenCalled();
    });
  });

  describe('load (search) flows', () => {
    it('retryLoad triggers a search', () => {
      const c = build();
      c.retryLoad();
      expect(usersApi.search).toHaveBeenCalled();
    });

    it('load success keeps refreshed selected user', () => {
      const c = build();
      const sel = makeUser({ id: 'u1', role: 'customer' });
      c.selectedUser.set(sel);
      usersApi.search.and.returnValue(
        of({ items: [makeUser({ id: 'u1', role: 'admin' })], meta: { total: 1 } } as any),
      );
      c.retryLoad();
      expect(c.selectedUser()?.role).toBe('admin');
      expect(c.meta()).toEqual({ total: 1 } as any);
    });

    it('load success when selected user not in new items', () => {
      const c = build();
      c.selectedUser.set(makeUser({ id: 'gone' }));
      usersApi.search.and.returnValue(of({ items: [makeUser({ id: 'u1' })], meta: null } as any));
      c.retryLoad();
      expect(c.selectedUser()?.id).toBe('gone');
    });

    it('load handles undefined items/meta', () => {
      const c = build();
      usersApi.search.and.returnValue(of({} as any));
      c.retryLoad();
      expect(c.users()).toEqual([]);
      expect(c.meta()).toBeNull();
    });

    it('load auto-selects by id', () => {
      const c = build();
      c['autoSelectAfterLoad'] = true;
      c['pendingPrefillSearch'] = 'U1';
      usersApi.search.and.returnValue(
        of({
          items: [makeUser({ id: 'u1', username: 'name', email: 'e@x.com' })],
          meta: null,
        } as any),
      );
      c.retryLoad();
      expect(c.selectedUser()?.id).toBe('u1');
    });

    it('load auto-selects by username', () => {
      const c = build();
      c['autoSelectAfterLoad'] = true;
      c['pendingPrefillSearch'] = 'alice';
      usersApi.search.and.returnValue(
        of({
          items: [makeUser({ id: 'u1', username: 'alice', email: 'e@x.com' })],
          meta: null,
        } as any),
      );
      c.retryLoad();
      expect(c.selectedUser()?.username).toBe('alice');
    });

    it('load auto-selects by email', () => {
      const c = build();
      c['autoSelectAfterLoad'] = true;
      c['pendingPrefillSearch'] = 'find@x.com';
      usersApi.search.and.returnValue(
        of({
          items: [makeUser({ id: 'u1', username: 'name', email: 'find@x.com' })],
          meta: null,
        } as any),
      );
      c.retryLoad();
      expect(c.selectedUser()?.email).toBe('find@x.com');
    });

    it('load auto-selects first item when no match', () => {
      const c = build();
      c['autoSelectAfterLoad'] = true;
      c['pendingPrefillSearch'] = 'nomatch';
      usersApi.search.and.returnValue(
        of({ items: [makeUser({ id: 'first' })], meta: null } as any),
      );
      c.retryLoad();
      expect(c.selectedUser()?.id).toBe('first');
    });

    it('load auto-select tolerates items with empty id/username/email fields', () => {
      const c = build();
      c['autoSelectAfterLoad'] = true;
      c['pendingPrefillSearch'] = 'zzz';
      usersApi.search.and.returnValue(
        of({
          items: [makeUser({ id: '', username: '', email: '' })],
          meta: null,
        } as any),
      );
      c.retryLoad();
      expect(c.selectedUser()).toBeTruthy();
    });

    it('load auto-select with null pending needle still picks first', () => {
      const c = build();
      c['autoSelectAfterLoad'] = true;
      c['pendingPrefillSearch'] = null;
      usersApi.search.and.returnValue(of({ items: [makeUser({ id: 'only' })], meta: null } as any));
      c.retryLoad();
      expect(c.selectedUser()?.id).toBe('only');
    });

    it('load 403 with pii reveal disables pii and retries', () => {
      auth.role.and.returnValue('admin');
      const c = build();
      c.piiReveal.set(true);
      let call = 0;
      usersApi.search.and.callFake(() => {
        call += 1;
        if (call === 1) return throwError(() => ({ status: 403 }));
        return of({ items: [], meta: null } as any);
      });
      c.retryLoad();
      expect(c.piiReveal()).toBeFalse();
      expect(toast.error).toHaveBeenCalled();
      expect(call).toBe(2);
    });

    it('load generic error sets error message and request id', () => {
      const c = build();
      c.piiReveal.set(false);
      usersApi.search.and.returnValue(throwError(() => ({ status: 500 })));
      c.retryLoad();
      expect(c.error()).toBe('adminUi.users.errors.load');
      expect(c.loading()).toBeFalse();
    });

    it('load 403 without pii reveal is treated as generic error', () => {
      const c = build();
      c.piiReveal.set(false);
      usersApi.search.and.returnValue(throwError(() => ({ status: 403 })));
      c.retryLoad();
      expect(c.error()).toBe('adminUi.users.errors.load');
    });
  });

  describe('detail loaders (via select)', () => {
    it('loadAliases error path sets aliases error', () => {
      admin.userAliases.and.returnValue(throwError(() => ({})));
      const c = build();
      c.select(makeUser());
      expect(c.aliasesError()).toBeTruthy();
      expect(c.aliasesLoading()).toBeFalse();
    });

    it('loadProfile success populates fields', () => {
      const p = makeProfile();
      p.user.vip = true;
      p.user.admin_note = 'note';
      p.user.locked_reason = 'lr';
      p.user.password_reset_required = true;
      usersApi.getProfile.and.returnValue(of(p));
      const c = build();
      c.select(makeUser());
      expect(c.vip).toBeTrue();
      expect(c.adminNote).toBe('note');
      expect(c.lockedReason).toBe('lr');
      expect(c.passwordResetRequired).toBeTrue();
    });

    it('loadProfile handles null-ish profile fields', () => {
      usersApi.getProfile.and.returnValue(of(null as any));
      const c = build();
      c.select(makeUser());
      expect(c.vip).toBeFalse();
      expect(c.adminNote).toBe('');
      expect(c.profileLoading()).toBeFalse();
    });

    it('loadProfile error sets profile error', () => {
      usersApi.getProfile.and.returnValue(throwError(() => ({})));
      const c = build();
      c.select(makeUser());
      expect(c.profileError()).toBeTruthy();
    });

    it('loadSessions success stores sessions', () => {
      admin.listUserSessions.and.returnValue(of([{ id: 's1' }] as any));
      const c = build();
      c.select(makeUser());
      expect(c.sessions()?.length).toBe(1);
    });

    it('loadSessions handles null and error', () => {
      admin.listUserSessions.and.returnValue(of(null as any));
      const c = build();
      c.select(makeUser());
      expect(c.sessions()).toEqual([]);

      admin.listUserSessions.and.returnValue(throwError(() => ({})));
      c.select(makeUser());
      expect(c.sessionsError()).toBeTruthy();
    });
  });
});
