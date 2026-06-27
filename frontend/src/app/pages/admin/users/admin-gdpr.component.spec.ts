import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AdminPaginationMeta } from '../../../core/admin-orders.service';
import {
  AdminGdprDeletionRequestItem,
  AdminGdprExportJobItem,
  AdminUsersService,
} from '../../../core/admin-users.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../core/toast.service';
import { AdminGdprComponent } from './admin-gdpr.component';

function makeMeta(overrides: Partial<AdminPaginationMeta> = {}): AdminPaginationMeta {
  return { total_items: 3, total_pages: 2, page: 1, limit: 25, ...overrides };
}

function makeJob(overrides: Partial<AdminGdprExportJobItem> = {}): AdminGdprExportJobItem {
  return {
    id: 'job-1',
    user: { id: 'u1', email: 'alice@example.com', username: 'alice', role: 'user' },
    status: 'succeeded',
    progress: 50,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    expires_at: '2026-02-01T00:00:00Z',
    has_file: true,
    sla_due_at: '2026-01-10T00:00:00Z',
    sla_breached: false,
    ...overrides,
  };
}

function makeDeletion(
  overrides: Partial<AdminGdprDeletionRequestItem> = {},
): AdminGdprDeletionRequestItem {
  return {
    user: { id: 'u1', email: 'alice@example.com', username: 'alice', role: 'user' },
    requested_at: '2026-01-01T00:00:00Z',
    scheduled_for: '2026-02-01T00:00:00Z',
    status: 'cooldown',
    sla_due_at: '2026-01-10T00:00:00Z',
    sla_breached: false,
    ...overrides,
  };
}

describe('AdminGdprComponent', () => {
  let usersApi: jasmine.SpyObj<AdminUsersService>;
  let auth: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<Router>;
  let toast: jasmine.SpyObj<ToastService>;

  function build(): AdminGdprComponent {
    const fixture = TestBed.createComponent(AdminGdprComponent);
    return fixture.componentInstance;
  }

  beforeEach(() => {
    usersApi = jasmine.createSpyObj<AdminUsersService>('AdminUsersService', [
      'listGdprExportJobs',
      'retryGdprExportJob',
      'downloadGdprExportJob',
      'listGdprDeletionRequests',
      'executeGdprDeletion',
      'cancelGdprDeletion',
    ]);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['isAdmin']);
    router = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    auth.isAdmin.and.returnValue(true);
    router.navigateByUrl.and.returnValue(Promise.resolve(true));
    usersApi.listGdprExportJobs.and.returnValue(of({ items: [makeJob()], meta: makeMeta() }));
    usersApi.listGdprDeletionRequests.and.returnValue(
      of({ items: [makeDeletion()], meta: makeMeta() }),
    );
    usersApi.retryGdprExportJob.and.returnValue(of(makeJob()));
    usersApi.downloadGdprExportJob.and.returnValue(of(new Blob(['{}'])));
    usersApi.executeGdprDeletion.and.returnValue(of(undefined));
    usersApi.cancelGdprDeletion.and.returnValue(of(undefined));

    TestBed.configureTestingModule({
      imports: [AdminGdprComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AdminUsersService, useValue: usersApi },
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
        { provide: ToastService, useValue: toast },
      ],
    });
  });

  it('loads exports and deletions on init', () => {
    const c = build();
    c.ngOnInit();
    expect(usersApi.listGdprExportJobs).toHaveBeenCalled();
    expect(usersApi.listGdprDeletionRequests).toHaveBeenCalled();
    expect(c.exports().length).toBe(1);
    expect(c.deletions().length).toBe(1);
    expect(c.exportsLoading()).toBeFalse();
    expect(c.deletionsLoading()).toBeFalse();
    expect(c.exportsMeta()).toEqual(makeMeta());
  });

  it('coerces falsy items/meta from the API to defaults', () => {
    usersApi.listGdprExportJobs.and.returnValue(of({ items: null, meta: null } as any));
    usersApi.listGdprDeletionRequests.and.returnValue(of({ items: null, meta: null } as any));
    const c = build();
    c.ngOnInit();
    expect(c.exports()).toEqual([]);
    expect(c.exportsMeta()).toBeNull();
    expect(c.deletions()).toEqual([]);
    expect(c.deletionsMeta()).toBeNull();
  });

  it('sets error state when loading exports fails', () => {
    usersApi.listGdprExportJobs.and.returnValue(throwError(() => new Error('boom')));
    const c = build();
    c.ngOnInit();
    expect(c.exportsError()).toBe('adminUi.gdpr.errors.loadExports');
    expect(c.exportsLoading()).toBeFalse();
  });

  it('sets error state when loading deletions fails', () => {
    usersApi.listGdprDeletionRequests.and.returnValue(throwError(() => new Error('boom')));
    const c = build();
    c.ngOnInit();
    expect(c.deletionsError()).toBe('adminUi.gdpr.errors.loadDeletions');
    expect(c.deletionsLoading()).toBeFalse();
  });

  it('passes trimmed query and status filter to the exports API', () => {
    const c = build();
    c.q = '  bob  ';
    c.exportStatus = 'failed';
    c.applyFilters();
    expect(usersApi.listGdprExportJobs).toHaveBeenCalledWith({
      q: 'bob',
      status: 'failed',
      page: 1,
      limit: 25,
    });
    expect(usersApi.listGdprDeletionRequests).toHaveBeenCalledWith({
      q: 'bob',
      page: 1,
      limit: 25,
    });
  });

  it('omits query and status when blank/all', () => {
    const c = build();
    c.q = '   ';
    c.exportStatus = 'all';
    c.applyFilters();
    expect(usersApi.listGdprExportJobs).toHaveBeenCalledWith({
      q: undefined,
      status: undefined,
      page: 1,
      limit: 25,
    });
    expect(usersApi.listGdprDeletionRequests).toHaveBeenCalledWith({
      q: undefined,
      page: 1,
      limit: 25,
    });
  });

  it('resets filters back to defaults and reloads', () => {
    const c = build();
    c.q = 'x';
    c.exportStatus = 'running';
    c.exportsPage = 4;
    c.deletionsPage = 4;
    c.resetFilters();
    expect(c.q).toBe('');
    expect(c.exportStatus).toBe('all');
    expect(c.exportsPage).toBe(1);
    expect(c.deletionsPage).toBe(1);
  });

  it('canAdminActions delegates to auth.isAdmin', () => {
    const c = build();
    auth.isAdmin.and.returnValue(false);
    expect(c.canAdminActions()).toBeFalse();
    auth.isAdmin.and.returnValue(true);
    expect(c.canAdminActions()).toBeTrue();
  });

  it('paginates exports forward and backward with a floor of 1', () => {
    const c = build();
    c.exportsPage = 1;
    c.exportsPrev();
    expect(c.exportsPage).toBe(1);
    c.exportsNext();
    expect(c.exportsPage).toBe(2);
    c.exportsPrev();
    expect(c.exportsPage).toBe(1);
  });

  it('paginates deletions forward and backward with a floor of 1', () => {
    const c = build();
    c.deletionsPage = 1;
    c.deletionsPrev();
    expect(c.deletionsPage).toBe(1);
    c.deletionsNext();
    expect(c.deletionsPage).toBe(2);
    c.deletionsPrev();
    expect(c.deletionsPage).toBe(1);
  });

  it('renders meta text only when meta is present', () => {
    const c = build();
    c.exportsMeta.set(null);
    c.deletionsMeta.set(null);
    expect(c.exportsMetaText()).toBe('');
    expect(c.deletionsMetaText()).toBe('');
    c.exportsMeta.set(makeMeta());
    c.deletionsMeta.set(makeMeta());
    expect(c.exportsMetaText()).toBe('adminUi.gdpr.pagination');
    expect(c.deletionsMetaText()).toBe('adminUi.gdpr.pagination');
  });

  it('clamps progress percentage and handles missing/non-finite values', () => {
    const c = build();
    expect(c.progressPct(makeJob({ progress: 42 }))).toBe(42);
    expect(c.progressPct(makeJob({ progress: 150 }))).toBe(100);
    expect(c.progressPct(makeJob({ progress: -10 }))).toBe(0);
    expect(c.progressPct(makeJob({ progress: null as any }))).toBe(0);
    expect(c.progressPct(makeJob({ progress: NaN as any }))).toBe(0);
  });

  it('maps export status to pill classes', () => {
    const c = build();
    expect(c.statusPill('succeeded')).toContain('emerald');
    expect(c.statusPill('failed')).toContain('rose');
    expect(c.statusPill('running')).toContain('indigo');
    expect(c.statusPill('pending')).toContain('slate');
  });

  it('maps deletion status to pill classes', () => {
    const c = build();
    expect(c.deletionStatusPill('due')).toContain('rose');
    expect(c.deletionStatusPill('cooldown')).toContain('amber');
    expect(c.deletionStatusPill('other')).toContain('slate');
  });

  it('navigates to users with prefill, ignoring empty/whitespace input', () => {
    const c = build();
    c.openUser('');
    c.openUser('   ');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    c.openUser('  alice@example.com  ');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/users', {
      state: { prefillUserSearch: 'alice@example.com', autoSelectFirst: true },
    });
  });

  describe('retryExport', () => {
    it('returns early when job has no id', () => {
      const c = build();
      c.retryExport(makeJob({ id: '' }));
      expect(usersApi.retryGdprExportJob).not.toHaveBeenCalled();
    });

    it('returns early when not admin', () => {
      const c = build();
      auth.isAdmin.and.returnValue(false);
      c.retryExport(makeJob());
      expect(usersApi.retryGdprExportJob).not.toHaveBeenCalled();
    });

    it('returns early when the confirm dialog is cancelled', () => {
      const c = build();
      spyOn(window, 'confirm').and.returnValue(false);
      c.retryExport(makeJob());
      expect(usersApi.retryGdprExportJob).not.toHaveBeenCalled();
    });

    it('retries and reloads on success', () => {
      const c = build();
      spyOn(window, 'confirm').and.returnValue(true);
      usersApi.listGdprExportJobs.calls.reset();
      c.retryExport(makeJob({ id: 'job-9' }));
      expect(usersApi.retryGdprExportJob).toHaveBeenCalledWith('job-9');
      expect(toast.success).toHaveBeenCalledWith('adminUi.gdpr.success.retryExport');
      expect(usersApi.listGdprExportJobs).toHaveBeenCalled();
      expect(c.retryingJobId()).toBeNull();
    });

    it('toasts an error and clears the busy flag on failure', () => {
      const c = build();
      spyOn(window, 'confirm').and.returnValue(true);
      usersApi.retryGdprExportJob.and.returnValue(throwError(() => new Error('nope')));
      c.retryExport(makeJob({ id: 'job-9' }));
      expect(toast.error).toHaveBeenCalledWith('adminUi.gdpr.errors.retryExport');
      expect(c.retryingJobId()).toBeNull();
    });
  });

  describe('downloadExport', () => {
    it('returns early when job has no id', () => {
      const c = build();
      c.downloadExport(makeJob({ id: '' }));
      expect(usersApi.downloadGdprExportJob).not.toHaveBeenCalled();
    });

    it('returns early when not admin', () => {
      const c = build();
      auth.isAdmin.and.returnValue(false);
      c.downloadExport(makeJob());
      expect(usersApi.downloadGdprExportJob).not.toHaveBeenCalled();
    });

    it('downloads the blob through an anchor on success', () => {
      const c = build();
      const anchor = document.createElement('a');
      const clickSpy = spyOn(anchor, 'click');
      spyOn(document, 'createElement').and.returnValue(anchor);
      spyOn(window.URL, 'createObjectURL').and.returnValue('blob:fake');
      const revokeSpy = spyOn(window.URL, 'revokeObjectURL');
      c.downloadExport(makeJob({ id: 'job-7' }));
      expect(usersApi.downloadGdprExportJob).toHaveBeenCalledWith('job-7');
      expect(clickSpy).toHaveBeenCalled();
      expect(anchor.download).toMatch(/^moment-studio-export-\d{4}-\d{2}-\d{2}\.json$/);
      expect(revokeSpy).toHaveBeenCalledWith('blob:fake');
      expect(toast.success).toHaveBeenCalledWith('adminUi.gdpr.success.download');
      expect(c.downloadingJobId()).toBeNull();
    });

    it('toasts an error on download failure', () => {
      const c = build();
      usersApi.downloadGdprExportJob.and.returnValue(throwError(() => new Error('x')));
      c.downloadExport(makeJob({ id: 'job-7' }));
      expect(toast.error).toHaveBeenCalledWith('adminUi.gdpr.errors.download');
      expect(c.downloadingJobId()).toBeNull();
    });
  });

  describe('executeDeletion (modal open)', () => {
    it('returns early when user id is missing', () => {
      const c = build();
      c.executeDeletion(makeDeletion({ user: { id: '', email: '', username: '', role: '' } }));
      expect(c.executeDeletionModalOpen()).toBeFalse();
    });

    it('returns early when not admin', () => {
      const c = build();
      auth.isAdmin.and.returnValue(false);
      c.executeDeletion(makeDeletion());
      expect(c.executeDeletionModalOpen()).toBeFalse();
    });

    it('opens the modal and resets password/error', () => {
      const c = build();
      c.executeDeletionPassword = 'stale';
      c.executeDeletionModalError = 'stale';
      const item = makeDeletion();
      c.executeDeletion(item);
      expect(c.executeDeletionModalOpen()).toBeTrue();
      expect(c.executeDeletionTarget()).toBe(item);
      expect(c.executeDeletionPassword).toBe('');
      expect(c.executeDeletionModalError).toBe('');
    });
  });

  describe('executeDeletionConfirmDisabled', () => {
    it('is disabled while a deletion is busy', () => {
      const c = build();
      c.deletionBusyUserId.set('u1');
      c.executeDeletionPassword = 'pw';
      expect(c.executeDeletionConfirmDisabled()).toBeTrue();
    });

    it('is disabled when the password is blank', () => {
      const c = build();
      c.executeDeletionPassword = '   ';
      expect(c.executeDeletionConfirmDisabled()).toBeTrue();
    });

    it('is disabled when the password is empty', () => {
      const c = build();
      c.executeDeletionPassword = '';
      expect(c.executeDeletionConfirmDisabled()).toBeTrue();
    });

    it('is enabled with a non-blank password and no busy state', () => {
      const c = build();
      c.executeDeletionPassword = 'pw';
      expect(c.executeDeletionConfirmDisabled()).toBeFalse();
    });
  });

  it('closeExecuteDeletionModal clears modal state', () => {
    const c = build();
    c.executeDeletionModalOpen.set(true);
    c.executeDeletionTarget.set(makeDeletion());
    c.executeDeletionPassword = 'pw';
    c.executeDeletionModalError = 'err';
    c.closeExecuteDeletionModal();
    expect(c.executeDeletionModalOpen()).toBeFalse();
    expect(c.executeDeletionTarget()).toBeNull();
    expect(c.executeDeletionPassword).toBe('');
    expect(c.executeDeletionModalError).toBe('');
  });

  describe('confirmExecuteDeletion', () => {
    it('closes the modal when there is no target user id', () => {
      const c = build();
      c.executeDeletionTarget.set(null);
      c.executeDeletionModalOpen.set(true);
      c.confirmExecuteDeletion();
      expect(c.executeDeletionModalOpen()).toBeFalse();
      expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
    });

    it('closes the modal when not admin', () => {
      const c = build();
      c.executeDeletionTarget.set(makeDeletion());
      c.executeDeletionModalOpen.set(true);
      auth.isAdmin.and.returnValue(false);
      c.confirmExecuteDeletion();
      expect(c.executeDeletionModalOpen()).toBeFalse();
      expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
    });

    it('shows a validation error when the password is empty', () => {
      const c = build();
      c.executeDeletionTarget.set(makeDeletion());
      c.executeDeletionPassword = '';
      c.confirmExecuteDeletion();
      expect(c.executeDeletionModalError).toBe('adminUi.gdpr.passwordRequired');
      expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
    });

    it('shows a validation error when the password is only whitespace', () => {
      const c = build();
      c.executeDeletionTarget.set(makeDeletion());
      c.executeDeletionPassword = '   ';
      c.confirmExecuteDeletion();
      expect(c.executeDeletionModalError).toBe('adminUi.gdpr.passwordRequired');
      expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
    });

    it('executes the deletion and closes on success', () => {
      const c = build();
      c.executeDeletionTarget.set(makeDeletion());
      c.executeDeletionPassword = 'secret';
      usersApi.listGdprDeletionRequests.calls.reset();
      c.confirmExecuteDeletion();
      expect(usersApi.executeGdprDeletion).toHaveBeenCalledWith('u1', 'secret');
      expect(toast.success).toHaveBeenCalledWith('adminUi.gdpr.success.executeDeletion');
      expect(usersApi.listGdprDeletionRequests).toHaveBeenCalled();
      expect(c.deletionBusyUserId()).toBeNull();
      expect(c.executeDeletionModalOpen()).toBeFalse();
    });

    it('surfaces a server-provided detail message on failure', () => {
      const c = build();
      c.executeDeletionTarget.set(makeDeletion());
      c.executeDeletionPassword = 'secret';
      usersApi.executeGdprDeletion.and.returnValue(
        throwError(() => ({ error: { detail: 'Wrong password' } })),
      );
      c.confirmExecuteDeletion();
      expect(c.executeDeletionModalError).toBe('Wrong password');
      expect(toast.error).toHaveBeenCalledWith('Wrong password');
      expect(c.deletionBusyUserId()).toBeNull();
    });

    it('falls back to a generic error when no detail is provided', () => {
      const c = build();
      c.executeDeletionTarget.set(makeDeletion());
      c.executeDeletionPassword = 'secret';
      usersApi.executeGdprDeletion.and.returnValue(throwError(() => ({ error: {} })));
      c.confirmExecuteDeletion();
      expect(c.executeDeletionModalError).toBe('adminUi.gdpr.errors.executeDeletion');
      expect(toast.error).toHaveBeenCalledWith('adminUi.gdpr.errors.executeDeletion');
    });
  });

  describe('cancelDeletion', () => {
    it('returns early when user id is missing', () => {
      const c = build();
      c.cancelDeletion(makeDeletion({ user: { id: '', email: '', username: '', role: '' } }));
      expect(usersApi.cancelGdprDeletion).not.toHaveBeenCalled();
    });

    it('returns early when not admin', () => {
      const c = build();
      auth.isAdmin.and.returnValue(false);
      c.cancelDeletion(makeDeletion());
      expect(usersApi.cancelGdprDeletion).not.toHaveBeenCalled();
    });

    it('returns early when the confirm dialog is cancelled', () => {
      const c = build();
      spyOn(window, 'confirm').and.returnValue(false);
      c.cancelDeletion(makeDeletion());
      expect(usersApi.cancelGdprDeletion).not.toHaveBeenCalled();
    });

    it('cancels and reloads on success', () => {
      const c = build();
      spyOn(window, 'confirm').and.returnValue(true);
      usersApi.listGdprDeletionRequests.calls.reset();
      c.cancelDeletion(makeDeletion());
      expect(usersApi.cancelGdprDeletion).toHaveBeenCalledWith('u1');
      expect(toast.success).toHaveBeenCalledWith('adminUi.gdpr.success.cancelDeletion');
      expect(usersApi.listGdprDeletionRequests).toHaveBeenCalled();
      expect(c.deletionBusyUserId()).toBeNull();
    });

    it('toasts an error on failure', () => {
      const c = build();
      spyOn(window, 'confirm').and.returnValue(true);
      usersApi.cancelGdprDeletion.and.returnValue(throwError(() => new Error('x')));
      c.cancelDeletion(makeDeletion());
      expect(toast.error).toHaveBeenCalledWith('adminUi.gdpr.errors.cancelDeletion');
      expect(c.deletionBusyUserId()).toBeNull();
    });
  });

  it('trackBy functions return stable identifiers', () => {
    const c = build();
    expect(c.trackExportJob(0, makeJob({ id: 'job-x' }))).toBe('job-x');
    expect(c.trackDeletion(0, makeDeletion())).toBe('u1');
  });
});
