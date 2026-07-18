import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import {
  AdminGdprDeletionRequestItem,
  AdminGdprExportJobItem,
  AdminUsersService,
} from '../../../core/admin-users.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../core/toast.service';
import { AdminGdprComponent } from './admin-gdpr.component';

function exportJob(overrides: Partial<AdminGdprExportJobItem> = {}): AdminGdprExportJobItem {
  return {
    id: 'job-1',
    user: { id: 'u1', email: 'user@x.com', username: 'user', role: 'user' },
    status: 'succeeded',
    progress: 50,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    started_at: '2026-01-01T00:05:00Z',
    finished_at: '2026-01-01T01:00:00Z',
    expires_at: '2026-02-01T00:00:00Z',
    has_file: true,
    sla_due_at: '2026-01-05T00:00:00Z',
    sla_breached: false,
    ...overrides,
  };
}

function deletionItem(
  overrides: Partial<AdminGdprDeletionRequestItem> = {},
): AdminGdprDeletionRequestItem {
  return {
    user: { id: 'u9', email: 'del@x.com', username: 'deluser', role: 'user' },
    requested_at: '2026-01-01T00:00:00Z',
    scheduled_for: '2026-01-10T00:00:00Z',
    status: 'cooldown',
    sla_due_at: '2026-01-15T00:00:00Z',
    sla_breached: false,
    ...overrides,
  };
}

describe('AdminGdprComponent', () => {
  let usersApi: jasmine.SpyObj<AdminUsersService>;
  let auth: jasmine.SpyObj<AuthService>;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    usersApi = jasmine.createSpyObj<AdminUsersService>('AdminUsersService', [
      'listGdprExportJobs',
      'listGdprDeletionRequests',
      'retryGdprExportJob',
      'downloadGdprExportJob',
      'executeGdprDeletion',
      'cancelGdprDeletion',
    ]);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['isAdmin']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    auth.isAdmin.and.returnValue(true);
    usersApi.listGdprExportJobs.and.returnValue(
      of({ items: [exportJob()], meta: { page: 1, limit: 25, total: 1, total_pages: 1 } as any }),
    );
    usersApi.listGdprDeletionRequests.and.returnValue(
      of({
        items: [deletionItem()],
        meta: { page: 1, limit: 25, total: 1, total_pages: 1 } as any,
      }),
    );
    usersApi.retryGdprExportJob.and.returnValue(of(exportJob()));
    usersApi.downloadGdprExportJob.and.returnValue(
      of(new Blob(['{}'], { type: 'application/json' })),
    );
    usersApi.executeGdprDeletion.and.returnValue(of(void 0));
    usersApi.cancelGdprDeletion.and.returnValue(of(void 0));

    await TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), AdminGdprComponent],
      providers: [
        { provide: AdminUsersService, useValue: usersApi },
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();
  });

  // Bare instance (ngOnInit NOT triggered) — for direct method/branch unit tests.
  function create(): AdminGdprComponent {
    return TestBed.createComponent(AdminGdprComponent).componentInstance;
  }

  // Initialized instance — runs ngOnInit (loadExports + loadDeletions) via change detection.
  function createInit(): AdminGdprComponent {
    const fixture = TestBed.createComponent(AdminGdprComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('loads exports and deletions on init and renders both tables', () => {
    const fixture = TestBed.createComponent(AdminGdprComponent);
    fixture.detectChanges();
    expect(usersApi.listGdprExportJobs).toHaveBeenCalled();
    expect(usersApi.listGdprDeletionRequests).toHaveBeenCalled();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('user@x.com');
    expect(text).toContain('del@x.com');
    const cmp = fixture.componentInstance;
    expect(cmp.exports().length).toBe(1);
    expect(cmp.deletions().length).toBe(1);
    expect(cmp.exportsLoading()).toBeFalse();
    expect(cmp.deletionsLoading()).toBeFalse();
  });

  it('reports admin permission from the auth service', () => {
    const cmp = create();
    expect(cmp.canAdminActions()).toBeTrue();
    auth.isAdmin.and.returnValue(false);
    expect(cmp.canAdminActions()).toBeFalse();
  });

  it('resets paging to the first page when applying filters', () => {
    const cmp = create();
    cmp.exportsPage = 4;
    cmp.deletionsPage = 7;
    cmp.applyFilters();
    expect(cmp.exportsPage).toBe(1);
    expect(cmp.deletionsPage).toBe(1);
  });

  it('clears the search and status filter when resetting', () => {
    const cmp = create();
    cmp.q = 'someone';
    cmp.exportStatus = 'failed';
    cmp.resetFilters();
    expect(cmp.q).toBe('');
    expect(cmp.exportStatus).toBe('all');
    expect(cmp.exportsPage).toBe(1);
  });

  it('paginates exports forward and clamps backward at page one', () => {
    const cmp = create();
    cmp.exportsNext();
    expect(cmp.exportsPage).toBe(2);
    cmp.exportsPrev();
    expect(cmp.exportsPage).toBe(1);
    cmp.exportsPrev();
    expect(cmp.exportsPage).toBe(1);
  });

  it('paginates deletions forward and clamps backward at page one', () => {
    const cmp = create();
    cmp.deletionsNext();
    expect(cmp.deletionsPage).toBe(2);
    cmp.deletionsPrev();
    expect(cmp.deletionsPage).toBe(1);
    cmp.deletionsPrev();
    expect(cmp.deletionsPage).toBe(1);
  });

  it('renders pagination meta text only when meta is present', () => {
    const cmp = create();
    cmp.exportsMeta.set(null);
    cmp.deletionsMeta.set(null);
    expect(cmp.exportsMetaText()).toBe('');
    expect(cmp.deletionsMetaText()).toBe('');

    cmp.exportsMeta.set({ page: 1, limit: 25, total: 3, total_pages: 1 } as any);
    cmp.deletionsMeta.set({ page: 1, limit: 25, total: 3, total_pages: 1 } as any);
    expect(cmp.exportsMetaText()).toBe('adminUi.gdpr.pagination');
    expect(cmp.deletionsMetaText()).toBe('adminUi.gdpr.pagination');
  });

  it('clamps and sanitizes the export progress percentage', () => {
    const cmp = create();
    expect(cmp.progressPct(exportJob({ progress: 50 }))).toBe(50);
    expect(cmp.progressPct(exportJob({ progress: null as any }))).toBe(0);
    expect(cmp.progressPct(exportJob({ progress: 'oops' as any }))).toBe(0);
    expect(cmp.progressPct(exportJob({ progress: -10 }))).toBe(0);
    expect(cmp.progressPct(exportJob({ progress: 250 }))).toBe(100);
  });

  it('maps export statuses to pill classes', () => {
    const cmp = create();
    expect(cmp.statusPill('succeeded')).toContain('emerald');
    expect(cmp.statusPill('failed')).toContain('rose');
    expect(cmp.statusPill('running')).toContain('indigo');
    expect(cmp.statusPill('pending')).toContain('slate');
  });

  it('maps deletion statuses to pill classes', () => {
    const cmp = create();
    expect(cmp.deletionStatusPill('due')).toContain('rose');
    expect(cmp.deletionStatusPill('cooldown')).toContain('amber');
    expect(cmp.deletionStatusPill('other')).toContain('slate');
  });

  it('navigates to the users page with prefill, ignoring blank and empty needles', () => {
    const cmp = create();
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    cmp.openUser('  ');
    cmp.openUser('');
    expect(navSpy).not.toHaveBeenCalled();
    cmp.openUser('user@x.com');
    expect(navSpy).toHaveBeenCalledWith('/admin/users', {
      state: { prefillUserSearch: 'user@x.com', autoSelectFirst: true },
    });
  });

  it('guards retryExport against missing id, non-admin and declined confirmation', () => {
    const cmp = create();
    cmp.retryExport({ id: '' } as any);
    expect(usersApi.retryGdprExportJob).not.toHaveBeenCalled();

    auth.isAdmin.and.returnValue(false);
    cmp.retryExport(exportJob());
    expect(usersApi.retryGdprExportJob).not.toHaveBeenCalled();

    auth.isAdmin.and.returnValue(true);
    spyOn(window, 'confirm').and.returnValue(false);
    cmp.retryExport(exportJob());
    expect(usersApi.retryGdprExportJob).not.toHaveBeenCalled();
  });

  it('retries an export and toasts on success', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    const cmp = create();
    cmp.retryExport(exportJob({ id: 'job-7' }));
    expect(usersApi.retryGdprExportJob).toHaveBeenCalledWith('job-7');
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.retryingJobId()).toBeNull();
  });

  it('toasts and clears the spinner when an export retry fails', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    usersApi.retryGdprExportJob.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.retryExport(exportJob({ id: 'job-7' }));
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.retryingJobId()).toBeNull();
  });

  it('guards downloadExport against missing id and non-admin callers', () => {
    const cmp = create();
    cmp.downloadExport({ id: '' } as any);
    expect(usersApi.downloadGdprExportJob).not.toHaveBeenCalled();

    auth.isAdmin.and.returnValue(false);
    cmp.downloadExport(exportJob());
    expect(usersApi.downloadGdprExportJob).not.toHaveBeenCalled();
  });

  it('downloads an export blob, triggers a save and toasts on success', () => {
    const createSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    const revokeSpy = spyOn(URL, 'revokeObjectURL');
    const clickSpy = spyOn(HTMLAnchorElement.prototype, 'click');
    const cmp = create();
    cmp.downloadExport(exportJob({ id: 'job-9' }));
    expect(usersApi.downloadGdprExportJob).toHaveBeenCalledWith('job-9');
    expect(createSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.downloadingJobId()).toBeNull();
  });

  it('toasts and clears the spinner when an export download fails', () => {
    usersApi.downloadGdprExportJob.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.downloadExport(exportJob({ id: 'job-9' }));
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.downloadingJobId()).toBeNull();
  });

  it('opens the execute-deletion modal, guarding missing id and non-admin callers', () => {
    const cmp = create();
    cmp.executeDeletion({ user: { id: '' } } as any);
    expect(cmp.executeDeletionModalOpen()).toBeFalse();

    auth.isAdmin.and.returnValue(false);
    cmp.executeDeletion(deletionItem());
    expect(cmp.executeDeletionModalOpen()).toBeFalse();

    auth.isAdmin.and.returnValue(true);
    cmp.executeDeletionPassword = 'stale';
    cmp.executeDeletionModalError = 'stale';
    cmp.executeDeletion(deletionItem());
    expect(cmp.executeDeletionModalOpen()).toBeTrue();
    expect(cmp.executeDeletionTarget()).toBeTruthy();
    expect(cmp.executeDeletionPassword).toBe('');
    expect(cmp.executeDeletionModalError).toBe('');
  });

  it('disables the execute-deletion confirm while busy or password is blank', () => {
    const cmp = create();
    cmp.executeDeletionPassword = '';
    expect(cmp.executeDeletionConfirmDisabled()).toBeTrue();
    cmp.executeDeletionPassword = 'pw';
    expect(cmp.executeDeletionConfirmDisabled()).toBeFalse();
    cmp.deletionBusyUserId.set('u9');
    expect(cmp.executeDeletionConfirmDisabled()).toBeTrue();
  });

  it('closes the execute-deletion modal and resets its state', () => {
    const cmp = create();
    cmp.executeDeletionModalOpen.set(true);
    cmp.executeDeletionTarget.set(deletionItem());
    cmp.executeDeletionPassword = 'pw';
    cmp.executeDeletionModalError = 'err';
    cmp.closeExecuteDeletionModal();
    expect(cmp.executeDeletionModalOpen()).toBeFalse();
    expect(cmp.executeDeletionTarget()).toBeNull();
    expect(cmp.executeDeletionPassword).toBe('');
    expect(cmp.executeDeletionModalError).toBe('');
  });

  it('closes the modal when confirming without a target user', () => {
    const cmp = create();
    cmp.executeDeletionTarget.set({ user: { id: '' } } as any);
    cmp.executeDeletionModalOpen.set(true);
    cmp.confirmExecuteDeletion();
    expect(cmp.executeDeletionModalOpen()).toBeFalse();
    expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
  });

  it('closes the modal when confirming as a non-admin', () => {
    const cmp = create();
    cmp.executeDeletionTarget.set(deletionItem());
    cmp.executeDeletionModalOpen.set(true);
    auth.isAdmin.and.returnValue(false);
    cmp.confirmExecuteDeletion();
    expect(cmp.executeDeletionModalOpen()).toBeFalse();
    expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
  });

  it('requires a password before executing the deletion (empty and whitespace-only)', () => {
    const cmp = create();
    cmp.executeDeletionTarget.set(deletionItem());

    cmp.executeDeletionPassword = '';
    cmp.confirmExecuteDeletion();
    expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
    expect(cmp.executeDeletionModalError).toBe('adminUi.gdpr.passwordRequired');

    cmp.executeDeletionModalError = '';
    cmp.executeDeletionPassword = '   ';
    cmp.confirmExecuteDeletion();
    expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
    expect(cmp.executeDeletionModalError).toBe('adminUi.gdpr.passwordRequired');
  });

  it('executes the deletion, toasts and closes the modal on success', () => {
    const cmp = create();
    cmp.executeDeletionTarget.set(
      deletionItem({ user: { id: 'u42', email: 'a@b.c', username: 'a', role: 'user' } }),
    );
    cmp.executeDeletionModalOpen.set(true);
    cmp.executeDeletionPassword = 'secret';
    cmp.confirmExecuteDeletion();
    expect(usersApi.executeGdprDeletion).toHaveBeenCalledWith('u42', 'secret');
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.deletionBusyUserId()).toBeNull();
    expect(cmp.executeDeletionModalOpen()).toBeFalse();
  });

  it('surfaces a server detail string when executing the deletion fails', () => {
    usersApi.executeGdprDeletion.and.returnValue(
      throwError(() => ({ error: { detail: 'wrong password' } })),
    );
    const cmp = create();
    cmp.executeDeletionTarget.set(deletionItem());
    cmp.executeDeletionPassword = 'secret';
    cmp.confirmExecuteDeletion();
    expect(cmp.executeDeletionModalError).toBe('wrong password');
    expect(toast.error).toHaveBeenCalledWith('wrong password');
    expect(cmp.deletionBusyUserId()).toBeNull();
  });

  it('falls back to a translated message when the deletion error has no detail', () => {
    usersApi.executeGdprDeletion.and.returnValue(throwError(() => ({ error: {} })));
    const cmp = create();
    cmp.executeDeletionTarget.set(deletionItem());
    cmp.executeDeletionPassword = 'secret';
    cmp.confirmExecuteDeletion();
    expect(cmp.executeDeletionModalError).toBe('adminUi.gdpr.errors.executeDeletion');
    expect(toast.error).toHaveBeenCalledWith('adminUi.gdpr.errors.executeDeletion');
  });

  it('guards cancelDeletion against missing id, non-admin and declined confirmation', () => {
    const cmp = create();
    cmp.cancelDeletion({ user: { id: '' } } as any);
    expect(usersApi.cancelGdprDeletion).not.toHaveBeenCalled();

    auth.isAdmin.and.returnValue(false);
    cmp.cancelDeletion(deletionItem());
    expect(usersApi.cancelGdprDeletion).not.toHaveBeenCalled();

    auth.isAdmin.and.returnValue(true);
    spyOn(window, 'confirm').and.returnValue(false);
    cmp.cancelDeletion(deletionItem());
    expect(usersApi.cancelGdprDeletion).not.toHaveBeenCalled();
  });

  it('cancels a deletion and toasts on success', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    const cmp = create();
    cmp.cancelDeletion(
      deletionItem({ user: { id: 'u55', email: 'c@d.e', username: 'c', role: 'user' } }),
    );
    expect(usersApi.cancelGdprDeletion).toHaveBeenCalledWith('u55');
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.deletionBusyUserId()).toBeNull();
  });

  it('toasts and clears the busy flag when cancelling a deletion fails', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    usersApi.cancelGdprDeletion.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.cancelDeletion(
      deletionItem({ user: { id: 'u55', email: 'c@d.e', username: 'c', role: 'user' } }),
    );
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.deletionBusyUserId()).toBeNull();
  });

  it('exposes stable trackBy identities for both tables', () => {
    const cmp = create();
    expect(cmp.trackExportJob(0, exportJob({ id: 'jx' }))).toBe('jx');
    expect(
      cmp.trackDeletion(
        0,
        deletionItem({ user: { id: 'ux', email: 'e', username: 'u', role: 'user' } }),
      ),
    ).toBe('ux');
  });

  it('sends trimmed search and concrete status filters when loading exports', () => {
    const cmp = create();
    usersApi.listGdprExportJobs.calls.reset();
    cmp.q = '  alice  ';
    cmp.exportStatus = 'failed';
    cmp.exportsPage = 3;
    (cmp as any).loadExports();
    expect(usersApi.listGdprExportJobs).toHaveBeenCalledWith({
      q: 'alice',
      status: 'failed',
      page: 3,
      limit: 25,
    });
  });

  it('omits the search and status filters when blank or set to all', () => {
    const cmp = create();
    usersApi.listGdprExportJobs.calls.reset();
    cmp.q = '   ';
    cmp.exportStatus = 'all';
    (cmp as any).loadExports();
    expect(usersApi.listGdprExportJobs).toHaveBeenCalledWith({
      q: undefined,
      status: undefined,
      page: 1,
      limit: 25,
    });
  });

  it('defaults missing export payload fields to empty list and null meta', () => {
    usersApi.listGdprExportJobs.and.returnValue(of({ items: null, meta: null } as any));
    const cmp = createInit();
    expect(cmp.exports()).toEqual([]);
    expect(cmp.exportsMeta()).toBeNull();
  });

  it('reports an export load failure', () => {
    usersApi.listGdprExportJobs.and.returnValue(throwError(() => new Error('x')));
    const cmp = createInit();
    expect(cmp.exportsError()).toBe('adminUi.gdpr.errors.loadExports');
    expect(cmp.exportsLoading()).toBeFalse();
  });

  it('sends trimmed search when loading deletions', () => {
    const cmp = create();
    usersApi.listGdprDeletionRequests.calls.reset();
    cmp.q = '  bob  ';
    cmp.deletionsPage = 2;
    (cmp as any).loadDeletions();
    expect(usersApi.listGdprDeletionRequests).toHaveBeenCalledWith({
      q: 'bob',
      page: 2,
      limit: 25,
    });
  });

  it('omits the search filter for deletions when blank', () => {
    const cmp = create();
    usersApi.listGdprDeletionRequests.calls.reset();
    cmp.q = '   ';
    (cmp as any).loadDeletions();
    expect(usersApi.listGdprDeletionRequests).toHaveBeenCalledWith({
      q: undefined,
      page: 1,
      limit: 25,
    });
  });

  it('defaults missing deletion payload fields to empty list and null meta', () => {
    usersApi.listGdprDeletionRequests.and.returnValue(of({ items: null, meta: null } as any));
    const cmp = createInit();
    expect(cmp.deletions()).toEqual([]);
    expect(cmp.deletionsMeta()).toBeNull();
  });

  it('reports a deletion load failure', () => {
    usersApi.listGdprDeletionRequests.and.returnValue(throwError(() => new Error('x')));
    const cmp = createInit();
    expect(cmp.deletionsError()).toBe('adminUi.gdpr.errors.loadDeletions');
    expect(cmp.deletionsLoading()).toBeFalse();
  });

  it('renders loading skeletons, errors and empty states across both panels', () => {
    usersApi.listGdprExportJobs.and.returnValue(throwError(() => new Error('x')));
    usersApi.listGdprDeletionRequests.and.returnValue(throwError(() => new Error('x')));
    const fixture = TestBed.createComponent(AdminGdprComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.exportsLoading.set(true);
    cmp.deletionsLoading.set(true);
    fixture.detectChanges();
    let text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('adminUi.gdpr.errors.loadExports');

    cmp.exportsLoading.set(false);
    cmp.deletionsLoading.set(false);
    cmp.exports.set([]);
    cmp.deletions.set([]);
    fixture.detectChanges();
    text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('adminUi.gdpr.exportsEmpty');
    expect(text).toContain('adminUi.gdpr.deletionsEmpty');
  });

  it('renders breached, failed and minimal rows including the open execute-deletion modal', () => {
    usersApi.listGdprExportJobs.and.returnValue(
      of({
        items: [
          exportJob({
            id: 'b1',
            status: 'failed',
            sla_breached: true,
            expires_at: null,
            has_file: false,
          }),
        ],
        meta: { page: 2, limit: 25, total: 30, total_pages: 2 } as any,
      }),
    );
    usersApi.listGdprDeletionRequests.and.returnValue(
      of({
        items: [deletionItem({ status: 'due', sla_breached: true, scheduled_for: null })],
        meta: { page: 2, limit: 25, total: 30, total_pages: 2 } as any,
      }),
    );
    const fixture = TestBed.createComponent(AdminGdprComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.executeDeletion(deletionItem());
    fixture.detectChanges();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('adminUi.gdpr.slaBreached');
    expect(text).toContain('del@x.com');
    expect(cmp.executeDeletionModalOpen()).toBeTrue();
  });
});
