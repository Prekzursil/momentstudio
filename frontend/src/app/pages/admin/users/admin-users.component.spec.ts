import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AdminService } from '../../../core/admin.service';
import { AdminCouponsV2Service } from '../../../core/admin-coupons-v2.service';
import { AdminUsersService } from '../../../core/admin-users.service';
import { AuthService } from '../../../core/auth.service';
import { AdminRecentService } from '../../../core/admin-recent.service';
import { AdminFavoritesService } from '../../../core/admin-favorites.service';
import { ToastService } from '../../../core/toast.service';
import { AdminOrdersService } from '../../../core/admin-orders.service';
import { AdminSupportService } from '../../../core/admin-support.service';
import { OpsService } from '../../../core/ops.service';
import { signal } from '@angular/core';

import { AdminUsersComponent } from './admin-users.component';

const baseUser = () => ({
  id: 'u1',
  email: 'alice@example.com',
  username: 'alice',
  name: 'Alice',
  name_tag: 1,
  role: 'customer',
  email_verified: false,
  created_at: '2026-01-01T00:00:00Z',
});

const meta = () => ({ total_items: 1, total_pages: 1, page: 1, limit: 25 });

const profileResponse = () =>
  ({
    user: {
      ...baseUser(),
      vip: true,
      admin_note: 'note',
      locked_until: null,
      locked_reason: 'reason',
      password_reset_required: true,
    },
    addresses: [],
    orders: [],
    tickets: [],
    security_events: [],
  }) as any;

const aliasesResponse = () =>
  ({
    user: { id: 'u1', email: 'alice@example.com', username: 'alice', role: 'customer' },
    usernames: [],
    display_names: [],
  }) as any;

const sessionItem = () =>
  ({
    id: 's1',
    created_at: '2026-01-01T00:00:00Z',
    expires_at: '2026-02-01T00:00:00Z',
    persistent: true,
    is_current: false,
    user_agent: 'Mozilla/5.0',
    ip_address: '1.2.3.4',
    country_code: 'RO',
  }) as any;

const promotion = () =>
  ({ id: 'p1', name: 'Promo', discount_type: 'percentage', is_active: true }) as any;

describe('AdminUsersComponent', () => {
  let usersApi: jasmine.SpyObj<AdminUsersService>;
  let couponsApi: jasmine.SpyObj<AdminCouponsV2Service>;
  let admin: jasmine.SpyObj<AdminService>;
  let auth: jasmine.SpyObj<AuthService>;
  let recent: jasmine.SpyObj<AdminRecentService>;
  let toast: jasmine.SpyObj<ToastService>;
  let favItems: ReturnType<typeof signal<any[]>>;
  let favLoading: ReturnType<typeof signal<boolean>>;
  let favorites: jasmine.SpyObj<AdminFavoritesService>;
  let role: string;

  beforeEach(async () => {
    role = 'admin';
    favItems = signal<any[]>([]);
    favLoading = signal<boolean>(false);

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
      'updateUserRole',
      'revokeSessions',
      'revokeSession',
      'userAliases',
      'listUserSessions',
    ]);
    auth = jasmine.createSpyObj<AuthService>('AuthService', [
      'user',
      'role',
      'isAdmin',
      'canAccessAdminSection',
    ]);
    recent = jasmine.createSpyObj<AdminRecentService>('AdminRecentService', ['add']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    favorites = jasmine.createSpyObj<AdminFavoritesService>(
      'AdminFavoritesService',
      ['init', 'isFavorite', 'add', 'remove'],
      { items: favItems, loading: favLoading },
    );

    // Default happy-path returns.
    usersApi.search.and.returnValue(of({ items: [baseUser()], meta: meta() }) as any);
    usersApi.getProfile.and.returnValue(of(profileResponse()));
    usersApi.updateInternal.and.returnValue(of({ vip: true, admin_note: 'note' } as any));
    usersApi.impersonate.and.returnValue(of({ access_token: 'tok' } as any));
    usersApi.updateSecurity.and.returnValue(
      of({ locked_reason: 'r', password_reset_required: true } as any),
    );
    usersApi.getEmailVerificationHistory.and.returnValue(of({ tokens: [] } as any));
    usersApi.resendEmailVerification.and.returnValue(of({ detail: 'ok' } as any));
    usersApi.resendPasswordReset.and.returnValue(of({ detail: 'ok' } as any));
    usersApi.overrideEmailVerification.and.returnValue(of({ email_verified: true } as any));
    usersApi.executeGdprDeletion.and.returnValue(of(undefined as any));

    couponsApi.listPromotions.and.returnValue(of([promotion()]));
    couponsApi.issueCouponToUser.and.returnValue(of({ code: 'CODE123' } as any));

    admin.updateUserRole.and.returnValue(of({ role: 'support' } as any));
    admin.revokeSessions.and.returnValue(of(undefined as any));
    admin.revokeSession.and.returnValue(of(undefined as any));
    admin.userAliases.and.returnValue(of(aliasesResponse()));
    admin.listUserSessions.and.returnValue(of([sessionItem()]));

    auth.user.and.returnValue({ id: 'admin-1', role: 'admin' } as any);
    auth.role.and.callFake(() => role);
    auth.isAdmin.and.returnValue(true);
    auth.canAccessAdminSection.and.returnValue(true);

    // Timeline child dependencies (rendered when a user is selected).
    const orders = jasmine.createSpyObj<AdminOrdersService>('AdminOrdersService', ['search']);
    orders.search.and.returnValue(of({ items: [], meta: meta() }) as any);
    const support = jasmine.createSpyObj<AdminSupportService>('AdminSupportService', ['list']);
    support.list.and.returnValue(of({ items: [], meta: meta() }) as any);
    const ops = jasmine.createSpyObj<OpsService>('OpsService', ['listEmailEvents']);
    ops.listEmailEvents.and.returnValue(of([]) as any);

    await TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), AdminUsersComponent],
      providers: [
        { provide: AdminUsersService, useValue: usersApi },
        { provide: AdminCouponsV2Service, useValue: couponsApi },
        { provide: AdminService, useValue: admin },
        { provide: AuthService, useValue: auth },
        { provide: AdminRecentService, useValue: recent },
        { provide: ToastService, useValue: toast },
        { provide: AdminFavoritesService, useValue: favorites },
        { provide: AdminOrdersService, useValue: orders },
        { provide: AdminSupportService, useValue: support },
        { provide: OpsService, useValue: ops },
      ],
    }).compileComponents();
  });

  function build(): { fixture: ComponentFixture<AdminUsersComponent>; cmp: AdminUsersComponent } {
    const fixture = TestBed.createComponent(AdminUsersComponent);
    const cmp = fixture.componentInstance;
    return { fixture, cmp };
  }

  function created(): AdminUsersComponent {
    const { fixture, cmp } = build();
    fixture.detectChanges();
    return cmp;
  }

  it('initializes, loads users and renders the table', () => {
    const { fixture, cmp } = build();
    fixture.detectChanges();
    expect(favorites.init).toHaveBeenCalled();
    expect(usersApi.search).toHaveBeenCalled();
    expect(cmp.users().length).toBe(1);
    expect(cmp.loading()).toBeFalse();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('adminUi.users.title');
  });

  it('applies prefill search + auto-select matching by email from history state', () => {
    spyOnProperty(history, 'state', 'get').and.returnValue({
      prefillUserSearch: '  alice@example.com  ',
      autoSelectFirst: true,
    });
    const cmp = created();
    expect(cmp.q).toBe('alice@example.com');
    expect(cmp.selectedUser()?.id).toBe('u1');
  });

  it('auto-selects by id, then username, then falls back to first item', () => {
    const cmp = created();

    (cmp as any).autoSelectAfterLoad = true;
    (cmp as any).pendingPrefillSearch = 'u1';
    cmp.retryLoad();
    expect(cmp.selectedUser()?.id).toBe('u1');

    cmp.selectedUser.set(null);
    (cmp as any).autoSelectAfterLoad = true;
    (cmp as any).pendingPrefillSearch = 'alice';
    cmp.retryLoad();
    expect(cmp.selectedUser()?.username).toBe('alice');

    cmp.selectedUser.set(null);
    (cmp as any).autoSelectAfterLoad = true;
    (cmp as any).pendingPrefillSearch = 'nomatch';
    cmp.retryLoad();
    expect(cmp.selectedUser()?.id).toBe('u1');
  });

  it('refreshes the currently-selected user after a reload', () => {
    const cmp = created();
    cmp.selectedUser.set(baseUser() as any);
    usersApi.search.and.returnValue(
      of({ items: [{ ...baseUser(), role: 'support' }], meta: meta() }) as any,
    );
    cmp.retryLoad();
    expect(cmp.selectedUser()?.role).toBe('support');
  });

  it('handles empty meta and ignores auto-select with no items', () => {
    usersApi.search.and.returnValue(of({ items: [], meta: null } as any));
    const cmp = created();
    expect(cmp.meta()).toBeNull();
    expect(cmp.users().length).toBe(0);
  });

  it('retries without PII on a 403 and surfaces a generic load error otherwise', () => {
    const cmp = created();

    cmp.piiReveal.set(true);
    let first = true;
    usersApi.search.and.callFake(() => {
      if (first) {
        first = false;
        return throwError(() => ({ status: 403 })) as any;
      }
      return of({ items: [baseUser()], meta: meta() }) as any;
    });
    cmp.retryLoad();
    expect(cmp.piiReveal()).toBeFalse();
    expect(toast.error).toHaveBeenCalled();

    usersApi.search.and.returnValue(throwError(() => ({ status: 500 })) as any);
    cmp.retryLoad();
    expect(cmp.error()).toBeTruthy();
    expect(cmp.loading()).toBeFalse();
  });

  it('toggles layout modal, density and applies a table layout', () => {
    const cmp = created();
    cmp.openLayoutModal();
    expect(cmp.layoutModalOpen()).toBeTrue();
    cmp.closeLayoutModal();
    expect(cmp.layoutModalOpen()).toBeFalse();

    const before = cmp.tableLayout().density;
    cmp.toggleDensity();
    expect(cmp.tableLayout().density).not.toBe(before);
    expect(cmp.densityToggleLabelKey()).toContain('densityToggle');
    cmp.toggleDensity();
    expect(cmp.densityToggleLabelKey()).toContain('densityToggle');

    expect(cmp.visibleColumnIds().length).toBeGreaterThan(0);
    expect(cmp.trackColumnId(0, 'identity')).toBe('identity');
    expect(cmp.cellPaddingClass()).toBeTruthy();
  });

  it('uses an anonymous storage key when the auth user has no id', () => {
    auth.user.and.returnValue(null as any);
    const cmp = created();
    cmp.applyTableLayout(cmp.tableLayout());
    expect(cmp.tableLayout()).toBeTruthy();
  });

  it('applies and resets filters', () => {
    const cmp = created();
    cmp.q = 'x';
    cmp.role = 'admin';
    cmp.selectedSavedViewKey = 'k';
    cmp.applyFilters();
    expect(cmp.page).toBe(1);
    expect(cmp.selectedSavedViewKey).toBe('');

    cmp.q = 'y';
    cmp.role = 'support';
    cmp.resetFilters();
    expect(cmp.q).toBe('');
    expect(cmp.role).toBe('all');
  });

  it('lists saved views scoped to users and applies one (with and without limit)', () => {
    const cmp = created();
    favItems.set([
      {
        key: 'v1',
        type: 'filter',
        label: 'View 1',
        state: {
          adminFilterScope: 'users',
          adminFilters: { q: 'bob', role: 'support', limit: 50 },
        },
      },
      { key: 'other', type: 'filter', state: { adminFilterScope: 'orders' } },
    ] as any);

    expect(cmp.savedViews().length).toBe(1);

    cmp.applySavedView('');
    expect(cmp.selectedSavedViewKey).toBe('');

    cmp.applySavedView('v1');
    expect(cmp.q).toBe('bob');
    expect(cmp.role).toBe('support');
    expect(cmp.limit).toBe(50);

    // View with non-numeric limit keeps existing limit.
    favItems.set([
      {
        key: 'v2',
        type: 'filter',
        label: 'View 2',
        state: { adminFilterScope: 'users', adminFilters: { q: 'c', limit: 'bad' } },
      },
    ] as any);
    cmp.limit = 25;
    cmp.applySavedView('v2');
    expect(cmp.limit).toBe(25);
    expect(cmp.role).toBe('all');
  });

  it('ignores saved views that are missing or have invalid filters', () => {
    const cmp = created();
    cmp.applySavedView('missing');
    expect(cmp.selectedSavedViewKey).toBe('missing');

    favItems.set([
      { key: 'bad', type: 'filter', label: 'Bad', state: { adminFilterScope: 'users' } },
    ] as any);
    cmp.q = 'keep';
    cmp.applySavedView('bad');
    expect(cmp.q).toBe('keep');
  });

  it('pins and unpins the current view', () => {
    const cmp = created();

    // Unpin path: already a favorite, and it is the selected key.
    favorites.isFavorite.and.returnValue(true);
    cmp.selectedSavedViewKey = (cmp as any).currentViewFavoriteKey();
    cmp.toggleCurrentViewPin();
    expect(favorites.remove).toHaveBeenCalled();
    expect(cmp.selectedSavedViewKey).toBe('');

    // Pin path with a name.
    favorites.isFavorite.and.returnValue(false);
    spyOn(window, 'prompt').and.returnValue('My View');
    cmp.toggleCurrentViewPin();
    expect(favorites.add).toHaveBeenCalled();
    expect(cmp.isCurrentViewPinned()).toBeFalse();
  });

  it('shows an error when pinning without a name', () => {
    const cmp = created();
    favorites.isFavorite.and.returnValue(false);
    spyOn(window, 'prompt').and.returnValue('   ');
    cmp.toggleCurrentViewPin();
    expect(toast.error).toHaveBeenCalled();
    expect(favorites.add).not.toHaveBeenCalled();
  });

  it('applies filters from navigation state with a valid scope', () => {
    spyOnProperty(history, 'state', 'get').and.returnValue({
      adminFilterScope: 'users',
      adminFilters: { q: 'fromstate', role: 'admin', limit: 10 },
    });
    const cmp = created();
    expect(cmp.q).toBe('fromstate');
    expect(cmp.role).toBe('admin');
    expect(cmp.limit).toBe(10);
  });

  it('paginates and tracks rows', () => {
    const cmp = created();
    cmp.goToPage(3);
    expect(cmp.page).toBe(3);
    expect(cmp.trackUserId(0, baseUser() as any)).toBe('u1');
  });

  it('selects a user (with and without email) and records recents', () => {
    const cmp = created();
    cmp.select(baseUser() as any);
    expect(cmp.selectedUser()?.id).toBe('u1');
    expect(recent.add).toHaveBeenCalled();
    expect(admin.userAliases).toHaveBeenCalled();
    expect(usersApi.getProfile).toHaveBeenCalled();
    expect(admin.listUserSessions).toHaveBeenCalled();

    recent.add.calls.reset();
    cmp.select({ ...baseUser(), email: '' } as any);
    const arg = recent.add.calls.mostRecent().args[0] as any;
    expect(arg.state).toBeNull();
  });

  it('opens the role-change modal only when valid', () => {
    const cmp = created();
    cmp.updateRole();
    expect(cmp.roleChangeOpen()).toBeFalse();

    cmp.selectedUser.set({ ...baseUser(), role: 'owner' } as any);
    cmp.updateRole();
    expect(cmp.roleChangeOpen()).toBeFalse();

    cmp.selectedUser.set(baseUser() as any);
    cmp.selectedRole = 'customer';
    cmp.updateRole();
    expect(cmp.roleChangeOpen()).toBeFalse();

    cmp.selectedRole = 'support';
    cmp.updateRole();
    expect(cmp.roleChangeOpen()).toBeTrue();
    cmp.closeRoleChange();
    expect(cmp.roleChangeOpen()).toBeFalse();
  });

  it('confirms a role change, requires a password, and handles success/failure', () => {
    const cmp = created();
    cmp.confirmRoleChange();

    cmp.selectedUser.set({ ...baseUser(), role: 'owner' } as any);
    cmp.confirmRoleChange();

    // role unchanged -> closes
    cmp.selectedUser.set(baseUser() as any);
    cmp.selectedRole = 'customer';
    cmp.roleChangeOpen.set(true);
    cmp.confirmRoleChange();
    expect(cmp.roleChangeOpen()).toBeFalse();

    // missing password
    cmp.selectedRole = 'support';
    cmp.roleChangePassword = '  ';
    cmp.confirmRoleChange();
    expect(cmp.roleChangeError()).toBeTruthy();

    // success path updates lists + profile
    cmp.users.set([baseUser() as any]);
    cmp.profile.set(profileResponse());
    cmp.roleChangePassword = 'pw';
    cmp.confirmRoleChange();
    expect(admin.updateUserRole).toHaveBeenCalled();
    expect(cmp.selectedUser()?.role).toBe('support');
    expect(toast.success).toHaveBeenCalled();

    // success path without profile
    cmp.profile.set(null);
    cmp.selectedUser.set(baseUser() as any);
    cmp.selectedRole = 'support';
    cmp.roleChangePassword = 'pw';
    cmp.confirmRoleChange();

    // error path
    admin.updateUserRole.and.returnValue(throwError(() => ({ error: { detail: 'boom' } })) as any);
    cmp.selectedUser.set(baseUser() as any);
    cmp.selectedRole = 'admin';
    cmp.roleChangePassword = 'pw';
    cmp.confirmRoleChange();
    expect(cmp.roleChangeError()).toBe('boom');
    expect(cmp.roleChangeBusy()).toBeFalse();

    // error path with fallback message
    admin.updateUserRole.and.returnValue(throwError(() => ({})) as any);
    cmp.selectedUser.set(baseUser() as any);
    cmp.selectedRole = 'admin';
    cmp.roleChangePassword = 'pw';
    cmp.confirmRoleChange();
    expect(cmp.roleChangeError()).toBeTruthy();
  });

  it('opens/closes the delete-user modal only when valid', () => {
    const cmp = created();
    cmp.openDeleteUser();
    expect(cmp.deleteUserOpen()).toBeFalse();

    cmp.selectedUser.set({ ...baseUser(), role: 'owner' } as any);
    cmp.openDeleteUser();
    expect(cmp.deleteUserOpen()).toBeFalse();

    cmp.selectedUser.set(baseUser() as any);
    cmp.openDeleteUser();
    expect(cmp.deleteUserOpen()).toBeTrue();
    cmp.closeDeleteUser();
    expect(cmp.deleteUserOpen()).toBeFalse();
  });

  it('confirms user deletion with validation and success/error handling', () => {
    const cmp = created();
    cmp.confirmDeleteUser();

    cmp.selectedUser.set({ ...baseUser(), role: 'owner' } as any);
    cmp.confirmDeleteUser();

    // wrong confirm word
    cmp.selectedUser.set(baseUser() as any);
    cmp.deleteUserConfirm = 'nope';
    cmp.confirmDeleteUser();
    expect(cmp.deleteUserError()).toBeTruthy();

    // missing password
    cmp.deleteUserConfirm = 'delete';
    cmp.deleteUserPassword = '   ';
    cmp.confirmDeleteUser();
    expect(cmp.deleteUserError()).toBeTruthy();

    // success
    cmp.deleteUserPassword = 'pw';
    cmp.confirmDeleteUser();
    expect(usersApi.executeGdprDeletion).toHaveBeenCalled();
    expect(cmp.selectedUser()).toBeNull();

    // error with detail
    usersApi.executeGdprDeletion.and.returnValue(
      throwError(() => ({ error: { detail: 'cannot' } })) as any,
    );
    cmp.selectedUser.set(baseUser() as any);
    cmp.deleteUserConfirm = 'DELETE';
    cmp.deleteUserPassword = 'pw';
    cmp.confirmDeleteUser();
    expect(cmp.deleteUserError()).toBe('cannot');

    // error fallback
    usersApi.executeGdprDeletion.and.returnValue(throwError(() => ({})) as any);
    cmp.selectedUser.set(baseUser() as any);
    cmp.deleteUserConfirm = 'DELETE';
    cmp.deleteUserPassword = 'pw';
    cmp.confirmDeleteUser();
    expect(cmp.deleteUserBusy()).toBeFalse();
  });

  it('force logs out all sessions (success and error)', () => {
    const cmp = created();
    cmp.forceLogout();

    cmp.selectedUser.set(baseUser() as any);
    cmp.forceLogout();
    expect(cmp.sessions()).toEqual([]);

    admin.revokeSessions.and.returnValue(throwError(() => new Error('x')) as any);
    cmp.forceLogout();
    expect(toast.error).toHaveBeenCalled();
  });

  it('refreshes sessions only when a user is selected', () => {
    const cmp = created();
    admin.listUserSessions.calls.reset();
    cmp.refreshSessions();
    expect(admin.listUserSessions).not.toHaveBeenCalled();

    cmp.selectedUser.set(baseUser() as any);
    cmp.refreshSessions();
    expect(admin.listUserSessions).toHaveBeenCalledWith('u1');
  });

  it('revokes a single session (success with/without list, and error)', () => {
    const cmp = created();
    cmp.revokeOneSession('s1');

    cmp.selectedUser.set(baseUser() as any);
    cmp.sessions.set([sessionItem(), { ...sessionItem(), id: 's2' }]);
    cmp.revokeOneSession('s1');
    expect(cmp.sessions()?.length).toBe(1);
    expect(cmp.revokingSessionId()).toBeNull();

    cmp.sessions.set(null);
    cmp.revokeOneSession('s2');
    expect(cmp.sessions()).toBeNull();

    admin.revokeSession.and.returnValue(throwError(() => new Error('x')) as any);
    cmp.revokeOneSession('s3');
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.revokingSessionId()).toBeNull();
  });

  it('saves internal fields (success with/without profile, and error)', () => {
    const cmp = created();
    cmp.saveInternal();

    cmp.selectedUser.set(baseUser() as any);
    cmp.profile.set(profileResponse());
    cmp.vip = false;
    cmp.adminNote = ' x ';
    cmp.saveInternal();
    expect(usersApi.updateInternal).toHaveBeenCalled();
    expect(cmp.vip).toBeTrue();

    cmp.profile.set(null);
    cmp.adminNote = '';
    cmp.saveInternal();

    usersApi.updateInternal.and.returnValue(throwError(() => new Error('x')) as any);
    cmp.saveInternal();
    expect(cmp.internalBusy()).toBeFalse();
  });

  it('reports lock state from the loaded profile', () => {
    const cmp = created();
    expect(cmp.isLocked()).toBeFalse();

    cmp.profile.set({
      ...profileResponse(),
      user: { ...profileResponse().user, locked_until: '2999-01-01T00:00:00Z' },
    });
    expect(cmp.isLocked()).toBeTrue();

    cmp.profile.set({
      ...profileResponse(),
      user: { ...profileResponse().user, locked_until: '2000-01-01T00:00:00Z' },
    });
    expect(cmp.isLocked()).toBeFalse();
  });

  it('exposes role-based capability flags', () => {
    const cmp = created();
    expect(cmp.canManageRoles()).toBeTrue();
    expect(cmp.canIssueCoupons()).toBeTrue();

    role = 'owner';
    expect(cmp.isOwner()).toBeTrue();
    role = 'support';
    expect(cmp.isOwner()).toBeFalse();
    auth.role.and.returnValue(null as any);
    expect(cmp.isOwner()).toBeFalse();
  });

  it('ensures coupon promotions with guards and selection defaulting', () => {
    const cmp = created();

    auth.canAccessAdminSection.and.returnValue(false);
    couponsApi.listPromotions.calls.reset();
    cmp.ensureCouponPromotions();
    expect(couponsApi.listPromotions).not.toHaveBeenCalled();

    auth.canAccessAdminSection.and.returnValue(true);
    cmp.couponPromotions.set(null);
    cmp.couponPromotionId = '';
    cmp.ensureCouponPromotions();
    expect(cmp.couponPromotionId).toBe('p1');

    // cached -> no refetch unless forced
    couponsApi.listPromotions.calls.reset();
    cmp.ensureCouponPromotions();
    expect(couponsApi.listPromotions).not.toHaveBeenCalled();

    // empty list keeps id empty
    couponsApi.listPromotions.and.returnValue(of([]));
    cmp.couponPromotionId = '';
    cmp.ensureCouponPromotions(true);
    expect(cmp.couponPromotionId).toBe('');

    // error path
    couponsApi.listPromotions.and.returnValue(throwError(() => new Error('x')));
    cmp.ensureCouponPromotions(true);
    expect(cmp.couponPromotionsError()).toBeTruthy();
    expect(cmp.couponPromotions()).toEqual([]);
  });

  it('issues a coupon with validity parsing and error handling', () => {
    const cmp = created();
    cmp.issueCoupon();

    cmp.selectedUser.set(baseUser() as any);
    auth.canAccessAdminSection.and.returnValue(false);
    cmp.issueCoupon();
    expect(couponsApi.issueCouponToUser).not.toHaveBeenCalled();

    auth.canAccessAdminSection.and.returnValue(true);
    cmp.couponPromotionId = '   ';
    cmp.issueCoupon();
    expect(couponsApi.issueCouponToUser).not.toHaveBeenCalled();

    // success with string validity + prefix
    cmp.couponPromotionId = 'p1';
    cmp.couponPrefix = ' VIP ';
    cmp.couponValidityDays = '15';
    cmp.issueCoupon();
    expect(cmp.couponIssuedCode()).toBe('CODE123');

    // numeric invalid validity -> null, no prefix
    cmp.couponPrefix = '';
    cmp.couponValidityDays = 0;
    cmp.issueCoupon();
    const payload = couponsApi.issueCouponToUser.calls.mostRecent().args[0] as any;
    expect(payload.validity_days).toBeNull();
    expect(payload.prefix).toBeNull();

    // error
    couponsApi.issueCouponToUser.and.returnValue(throwError(() => new Error('x')) as any);
    cmp.couponValidityDays = 5;
    cmp.issueCoupon();
    expect(cmp.couponIssueError()).toBeTruthy();
    expect(cmp.couponIssueBusy()).toBeFalse();
  });

  it('copies an issued coupon code only when present', () => {
    const cmp = created();
    cmp.copyIssuedCoupon();
    expect(toast.success).not.toHaveBeenCalled();

    if (navigator.clipboard) {
      spyOn(navigator.clipboard, 'writeText').and.returnValue(Promise.resolve());
    }
    cmp.couponIssuedCode.set('CODE123');
    cmp.copyIssuedCoupon();
    expect(toast.success).toHaveBeenCalled();
  });

  it('locks an account for a duration (success with/without profile and reason; error)', () => {
    const cmp = created();
    cmp.lockForMinutes(60);

    cmp.selectedUser.set(baseUser() as any);
    cmp.profile.set(profileResponse());
    cmp.lockedReason = ' bad actor ';
    cmp.lockForMinutes(60);
    expect(usersApi.updateSecurity).toHaveBeenCalled();
    expect(cmp.securityBusy()).toBeFalse();

    cmp.profile.set(null);
    cmp.lockedReason = '';
    cmp.lockForMinutes(0);

    usersApi.updateSecurity.and.returnValue(throwError(() => new Error('x')) as any);
    cmp.lockForMinutes(60);
    expect(toast.error).toHaveBeenCalled();
  });

  it('unlocks an account (success with/without profile and error)', () => {
    const cmp = created();
    cmp.unlock();

    cmp.selectedUser.set(baseUser() as any);
    cmp.profile.set(profileResponse());
    cmp.unlock();
    expect(cmp.lockedReason).toBe('');

    cmp.profile.set(null);
    cmp.unlock();

    usersApi.updateSecurity.and.returnValue(throwError(() => new Error('x')) as any);
    cmp.unlock();
    expect(cmp.securityBusy()).toBeFalse();
  });

  it('saves security settings (success with/without profile and reason; error)', () => {
    const cmp = created();
    cmp.saveSecurity();

    cmp.selectedUser.set(baseUser() as any);
    cmp.profile.set(profileResponse());
    cmp.lockedReason = ' reason ';
    cmp.passwordResetRequired = true;
    cmp.saveSecurity();
    expect(usersApi.updateSecurity).toHaveBeenCalled();

    cmp.profile.set(null);
    cmp.lockedReason = '';
    cmp.saveSecurity();

    usersApi.updateSecurity.and.returnValue(throwError(() => new Error('x')) as any);
    cmp.saveSecurity();
    expect(cmp.securityBusy()).toBeFalse();
  });

  it('sends a password-reset email with a confirm gate (success and error)', () => {
    const cmp = created();
    cmp.sendPasswordResetEmail();

    cmp.selectedUser.set(baseUser() as any);
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    cmp.sendPasswordResetEmail();
    expect(usersApi.resendPasswordReset).not.toHaveBeenCalled();

    confirmSpy.and.returnValue(true);
    cmp.sendPasswordResetEmail();
    expect(usersApi.resendPasswordReset).toHaveBeenCalled();
    expect(cmp.passwordResetEmailBusy()).toBeFalse();

    usersApi.resendPasswordReset.and.returnValue(throwError(() => new Error('x')) as any);
    cmp.sendPasswordResetEmail();
    expect(toast.error).toHaveBeenCalled();
  });

  it('loads email verification history (success and error)', () => {
    const cmp = created();
    cmp.loadEmailHistory();

    cmp.selectedUser.set(baseUser() as any);
    cmp.loadEmailHistory();
    expect(cmp.emailHistory()).toBeTruthy();
    expect(cmp.emailHistoryLoading()).toBeFalse();

    usersApi.getEmailVerificationHistory.and.returnValue(throwError(() => new Error('x')) as any);
    cmp.loadEmailHistory();
    expect(cmp.emailHistoryError()).toBeTruthy();
  });

  it('resends verification (success then loads history; error)', () => {
    const cmp = created();
    cmp.resendVerification();

    cmp.selectedUser.set(baseUser() as any);
    usersApi.getEmailVerificationHistory.calls.reset();
    cmp.resendVerification();
    expect(usersApi.resendEmailVerification).toHaveBeenCalled();
    expect(usersApi.getEmailVerificationHistory).toHaveBeenCalled();

    usersApi.resendEmailVerification.and.returnValue(throwError(() => new Error('x')) as any);
    cmp.resendVerification();
    expect(cmp.emailVerificationBusy()).toBeFalse();
  });

  it('opens the override-verification modal only for unverified users', () => {
    const cmp = created();
    cmp.overrideVerification();
    expect(cmp.overrideVerificationOpen()).toBeFalse();

    cmp.selectedUser.set({ ...baseUser(), email_verified: true } as any);
    cmp.overrideVerification();
    expect(cmp.overrideVerificationOpen()).toBeFalse();

    cmp.selectedUser.set(baseUser() as any);
    cmp.overrideVerification();
    expect(cmp.overrideVerificationOpen()).toBeTrue();
    cmp.closeOverrideVerification();
    expect(cmp.overrideVerificationOpen()).toBeFalse();
  });

  it('confirms override verification with validation and success/error handling', () => {
    const cmp = created();
    cmp.confirmOverrideVerification();

    // already verified -> closes
    cmp.selectedUser.set({ ...baseUser(), email_verified: true } as any);
    cmp.overrideVerificationOpen.set(true);
    cmp.confirmOverrideVerification();
    expect(cmp.overrideVerificationOpen()).toBeFalse();

    // missing password
    cmp.selectedUser.set(baseUser() as any);
    cmp.overrideVerificationPassword = '   ';
    cmp.confirmOverrideVerification();
    expect(cmp.overrideVerificationError()).toBeTruthy();

    // success (with profile + list update)
    cmp.users.set([baseUser() as any]);
    cmp.profile.set(profileResponse());
    cmp.overrideVerificationPassword = 'pw';
    cmp.confirmOverrideVerification();
    expect(cmp.selectedUser()?.email_verified).toBeTrue();
    expect(toast.success).toHaveBeenCalled();

    // success without profile
    cmp.profile.set(null);
    cmp.selectedUser.set(baseUser() as any);
    cmp.overrideVerificationPassword = 'pw';
    cmp.confirmOverrideVerification();

    // error with detail
    usersApi.overrideEmailVerification.and.returnValue(
      throwError(() => ({ error: { detail: 'no' } })) as any,
    );
    cmp.selectedUser.set(baseUser() as any);
    cmp.overrideVerificationPassword = 'pw';
    cmp.confirmOverrideVerification();
    expect(cmp.overrideVerificationError()).toBe('no');

    // error fallback
    usersApi.overrideEmailVerification.and.returnValue(throwError(() => ({})) as any);
    cmp.selectedUser.set(baseUser() as any);
    cmp.overrideVerificationPassword = 'pw';
    cmp.confirmOverrideVerification();
    expect(cmp.emailVerificationBusy()).toBeFalse();
  });

  it('impersonates a customer (success token, empty token, error)', () => {
    const cmp = created();
    cmp.impersonate();

    const openSpy = spyOn(window, 'open');
    cmp.selectedUser.set(baseUser() as any);
    cmp.impersonate();
    expect(openSpy).toHaveBeenCalled();
    expect(cmp.impersonateBusy()).toBeFalse();

    usersApi.impersonate.and.returnValue(of({ access_token: '' } as any));
    cmp.impersonate();
    expect(toast.error).toHaveBeenCalled();

    usersApi.impersonate.and.returnValue(throwError(() => new Error('x')) as any);
    cmp.impersonate();
    expect(cmp.impersonateBusy()).toBeFalse();
  });

  it('formats identity labels and session device labels', () => {
    const cmp = created();
    expect(cmp.identityLabel(baseUser() as any)).toContain('Alice');

    expect(cmp.sessionDeviceLabel({ user_agent: '' } as any)).toContain('unknownDevice');
    expect(cmp.sessionDeviceLabel({ user_agent: 'short' } as any)).toBe('short');
    const long = 'x'.repeat(200);
    expect(cmp.sessionDeviceLabel({ user_agent: long } as any).endsWith('…')).toBeTrue();
  });

  it('controls PII reveal capability and toggling', () => {
    const cmp = created();

    for (const r of ['owner', 'admin', 'support', 'fulfillment']) {
      role = r;
      expect(cmp.canRevealPii()).toBeTrue();
    }
    role = 'content';
    expect(cmp.canRevealPii()).toBeFalse();
    auth.role.and.returnValue(null as any);
    expect(cmp.canRevealPii()).toBeFalse();

    // togglePiiReveal blocked when not allowed
    cmp.togglePiiReveal();
    role = 'admin';
    auth.role.and.callFake(() => role);
    const before = cmp.piiReveal();
    cmp.selectedUser.set(baseUser() as any);
    cmp.togglePiiReveal();
    expect(cmp.piiReveal()).toBe(!before);
    expect(admin.userAliases).toHaveBeenCalled();

    // toggle again with no selected user
    cmp.selectedUser.set(null);
    cmp.togglePiiReveal();
  });

  it('maps role pill classes for every role', () => {
    const cmp = created();
    expect(cmp.rolePillClass('owner')).toContain('indigo');
    expect(cmp.rolePillClass('admin')).toContain('emerald');
    expect(cmp.rolePillClass('support')).toContain('sky');
    expect(cmp.rolePillClass('fulfillment')).toContain('amber');
    expect(cmp.rolePillClass('content')).toContain('fuchsia');
    expect(cmp.rolePillClass('customer')).toContain('slate');
  });

  it('loads aliases and profile errors', () => {
    const cmp = created();
    admin.userAliases.and.returnValue(throwError(() => new Error('x')) as any);
    usersApi.getProfile.and.returnValue(throwError(() => new Error('x')) as any);
    admin.listUserSessions.and.returnValue(throwError(() => new Error('x')) as any);
    cmp.select(baseUser() as any);
    expect(cmp.aliasesError()).toBeTruthy();
    expect(cmp.profileError()).toBeTruthy();
    expect(cmp.sessionsError()).toBeTruthy();
  });

  it('loads profile and populates editable fields on success', () => {
    const cmp = created();
    cmp.select(baseUser() as any);
    expect(cmp.profile()).toBeTruthy();
    expect(cmp.vip).toBeTrue();
    expect(cmp.adminNote).toBe('note');
    expect(cmp.lockedReason).toBe('reason');
    expect(cmp.passwordResetRequired).toBeTrue();
    expect(cmp.sessions()?.length).toBe(1);
  });

  it('falls back to defaults for a saved view missing a query', () => {
    const cmp = created();
    favItems.set([
      {
        key: 'v3',
        type: 'filter',
        label: 'V3',
        state: { adminFilterScope: 'users', adminFilters: { role: 'support' } },
      },
    ] as any);
    cmp.applySavedView('v3');
    expect(cmp.q).toBe('');
    expect(cmp.role).toBe('support');
  });

  it('shows an error when pinning is cancelled (prompt returns null)', () => {
    const cmp = created();
    favorites.isFavorite.and.returnValue(false);
    spyOn(window, 'prompt').and.returnValue(null);
    cmp.toggleCurrentViewPin();
    expect(toast.error).toHaveBeenCalled();
    expect(favorites.add).not.toHaveBeenCalled();
  });

  it('ignores navigation state with a users scope but falsy filters', () => {
    spyOnProperty(history, 'state', 'get').and.returnValue({
      adminFilterScope: 'users',
      adminFilters: null,
    });
    const cmp = created();
    expect(cmp.q).toBe('');
  });

  it('applies navigation state defaults for an empty users filter object', () => {
    spyOnProperty(history, 'state', 'get').and.returnValue({
      adminFilterScope: 'users',
      adminFilters: {},
    });
    const cmp = created();
    expect(cmp.q).toBe('');
    expect(cmp.role).toBe('all');
    expect(cmp.limit).toBe(25);
  });

  it('confirms a role change with a blank password and updates non-matching rows', () => {
    const cmp = created();
    cmp.selectedUser.set(baseUser() as any);
    cmp.selectedRole = 'support';
    cmp.roleChangePassword = '';
    cmp.confirmRoleChange();
    expect(cmp.roleChangeError()).toBeTruthy();

    cmp.users.set([{ ...baseUser(), id: 'other' } as any, baseUser() as any]);
    cmp.profile.set(null);
    cmp.roleChangePassword = 'pw';
    cmp.confirmRoleChange();
    expect(cmp.users().find((u) => u.id === 'other')?.role).toBe('customer');
  });

  it('rejects deletion with a blank confirmation word and blank password', () => {
    const cmp = created();
    cmp.selectedUser.set(baseUser() as any);
    cmp.deleteUserConfirm = '';
    cmp.confirmDeleteUser();
    expect(cmp.deleteUserError()).toBeTruthy();

    cmp.deleteUserConfirm = 'DELETE';
    cmp.deleteUserPassword = '';
    cmp.confirmDeleteUser();
    expect(cmp.deleteUserError()).toBeTruthy();
    expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
  });

  it('clears the admin note when the saved internal response omits it', () => {
    const cmp = created();
    usersApi.updateInternal.and.returnValue(of({ vip: true } as any));
    cmp.selectedUser.set(baseUser() as any);
    cmp.profile.set(null);
    cmp.saveInternal();
    expect(cmp.adminNote).toBe('');
  });

  it('keeps a preselected coupon promotion when refetching', () => {
    const cmp = created();
    cmp.couponPromotions.set(null);
    cmp.couponPromotionId = 'preset';
    couponsApi.listPromotions.and.returnValue(of([promotion()]));
    cmp.ensureCouponPromotions();
    expect(cmp.couponPromotionId).toBe('preset');
  });

  it('defaults to an empty promotion list when the response is null', () => {
    const cmp = created();
    cmp.couponPromotions.set(null);
    cmp.couponPromotionId = '';
    couponsApi.listPromotions.and.returnValue(of(null as any));
    cmp.ensureCouponPromotions();
    expect(cmp.couponPromotions()).toEqual([]);
    expect(cmp.couponPromotionId).toBe('');
  });

  it('skips issuing a coupon when the promotion id is blank', () => {
    const cmp = created();
    cmp.selectedUser.set(baseUser() as any);
    auth.canAccessAdminSection.and.returnValue(true);
    cmp.couponPromotionId = '';
    cmp.issueCoupon();
    expect(couponsApi.issueCouponToUser).not.toHaveBeenCalled();
  });

  it('clears the lock reason when lock/save responses omit it', () => {
    const cmp = created();
    cmp.selectedUser.set(baseUser() as any);
    cmp.profile.set(null);

    usersApi.updateSecurity.and.returnValue(of({ password_reset_required: true } as any));
    cmp.lockForMinutes(60);
    expect(cmp.lockedReason).toBe('');

    usersApi.updateSecurity.and.returnValue(of({ password_reset_required: false } as any));
    cmp.lockedReason = 'stale';
    cmp.saveSecurity();
    expect(cmp.lockedReason).toBe('');
  });

  it('confirms override verification with a blank password and updates non-matching rows', () => {
    const cmp = created();
    cmp.selectedUser.set(baseUser() as any);
    cmp.overrideVerificationPassword = '';
    cmp.confirmOverrideVerification();
    expect(cmp.overrideVerificationError()).toBeTruthy();

    cmp.users.set([{ ...baseUser(), id: 'other' } as any, baseUser() as any]);
    cmp.profile.set(null);
    cmp.overrideVerificationPassword = 'pw';
    cmp.confirmOverrideVerification();
    expect(cmp.users().find((u) => u.id === 'other')?.email_verified).toBeFalse();
  });

  it('defaults an empty user list when the search response omits items', () => {
    const cmp = created();
    usersApi.search.and.returnValue(of({ meta: null } as any));
    cmp.retryLoad();
    expect(cmp.users()).toEqual([]);
  });

  it('auto-selects the first item when the prefill needle is empty', () => {
    const cmp = created();
    usersApi.search.and.returnValue(of({ items: [baseUser()], meta: meta() }) as any);
    (cmp as any).autoSelectAfterLoad = true;
    (cmp as any).pendingPrefillSearch = null;
    cmp.retryLoad();
    expect(cmp.selectedUser()?.id).toBe('u1');
  });

  it('auto-selects the first item when candidate rows have blank identifiers', () => {
    const cmp = created();
    usersApi.search.and.returnValue(
      of({
        items: [
          {
            id: '',
            username: '',
            email: '',
            role: 'customer',
            email_verified: false,
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
        meta: meta(),
      }) as any,
    );
    (cmp as any).autoSelectAfterLoad = true;
    (cmp as any).pendingPrefillSearch = 'zzz';
    cmp.retryLoad();
    expect(cmp.selectedUser()).toBeTruthy();
  });

  it('clears editable profile fields when the profile omits note and lock reason', () => {
    const cmp = created();
    usersApi.getProfile.and.returnValue(
      of({
        user: { ...baseUser(), vip: false },
        addresses: [],
        orders: [],
        tickets: [],
        security_events: [],
      } as any),
    );
    cmp.select(baseUser() as any);
    expect(cmp.adminNote).toBe('');
    expect(cmp.lockedReason).toBe('');
  });

  it('defaults sessions to an empty list when the response is null', () => {
    const cmp = created();
    admin.listUserSessions.and.returnValue(of(null as any));
    cmp.select(baseUser() as any);
    expect(cmp.sessions()).toEqual([]);
  });
});
