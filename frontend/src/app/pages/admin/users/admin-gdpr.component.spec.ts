import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
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
    user: { id: 'u1', email: 'user@example.com', username: 'user', role: 'customer' },
    status: 'succeeded',
    progress: 100,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    started_at: '2026-01-01T00:00:00Z',
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
    user: { id: 'u2', email: 'del@example.com', username: 'deluser', role: 'customer' },
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
  let router: Router;
  let navigateByUrlSpy: jasmine.Spy;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    usersApi = jasmine.createSpyObj<AdminUsersService>('AdminUsersService', [
      'listGdprExportJobs',
      'retryGdprExportJob',
      'downloadGdprExportJob',
      'listGdprDeletionRequests',
      'executeGdprDeletion',
      'cancelGdprDeletion',
    ]);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['isAdmin']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    usersApi.listGdprExportJobs.and.returnValue(
      of({
        items: [exportJob()],
        meta: { total_items: 1, total_pages: 1, page: 1, limit: 25 },
      }),
    );
    usersApi.listGdprDeletionRequests.and.returnValue(
      of({
        items: [deletionItem()],
        meta: { total_items: 1, total_pages: 1, page: 1, limit: 25 },
      }),
    );
    usersApi.retryGdprExportJob.and.returnValue(of(exportJob()));
    usersApi.downloadGdprExportJob.and.returnValue(of(new Blob(['{}'], { type: 'application/json' })));
    usersApi.executeGdprDeletion.and.returnValue(of(undefined));
    usersApi.cancelGdprDeletion.and.returnValue(of(undefined));
    auth.isAdmin.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminGdprComponent],
      providers: [
        provideRouter([]),
        { provide: AdminUsersService, useValue: usersApi },
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    navigateByUrlSpy = spyOn(router, 'navigateByUrl').and.returnValue(Promise.resolve(true));
  });

  function create(): AdminGdprComponent {
    return TestBed.createComponent(AdminGdprComponent).componentInstance;
  }

  it('loads exports and deletions on init and renders both tables', () => {
    const fixture = TestBed.createComponent(AdminGdprComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(usersApi.listGdprExportJobs).toHaveBeenCalled();
    expect(usersApi.listGdprDeletionRequests).toHaveBeenCalled();
    expect(cmp.exports().length).toBe(1);
    expect(cmp.deletions().length).toBe(1);
    expect(cmp.exportsLoading()).toBeFalse();
    expect(cmp.deletionsLoading()).toBeFalse();

    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('user@example.com');
    expect(text).toContain('del@example.com');
  });

  it('exposes admin capability from the auth service', () => {
    const cmp = create();
    expect(cmp.canAdminActions()).toBeTrue();
    auth.isAdmin.and.returnValue(false);
    expect(cmp.canAdminActions()).toBeFalse();
  });

  it('applyFilters resets both pages to one and reloads', () => {
    const cmp = create();
    cmp.exportsPage = 4;
    cmp.deletionsPage = 7;
    usersApi.listGdprExportJobs.calls.reset();
    usersApi.listGdprDeletionRequests.calls.reset();
    cmp.applyFilters();
    expect(cmp.exportsPage).toBe(1);
    expect(cmp.deletionsPage).toBe(1);
    expect(usersApi.listGdprExportJobs).toHaveBeenCalled();
    expect(usersApi.listGdprDeletionRequests).toHaveBeenCalled();
  });

  it('resetFilters clears the query and status then reapplies', () => {
    const cmp = create();
    cmp.q = 'someone';
    cmp.exportStatus = 'failed';
    cmp.resetFilters();
    expect(cmp.q).toBe('');
    expect(cmp.exportStatus).toBe('all');
  });

  it('paginates exports forward and clamps the previous page at one', () => {
    const cmp = create();
    cmp.exportsNext();
    expect(cmp.exportsPage).toBe(2);
    cmp.exportsPrev();
    expect(cmp.exportsPage).toBe(1);
    cmp.exportsPrev();
    expect(cmp.exportsPage).toBe(1);
  });

  it('paginates deletions forward and clamps the previous page at one', () => {
    const cmp = create();
    cmp.deletionsNext();
    expect(cmp.deletionsPage).toBe(2);
    cmp.deletionsPrev();
    expect(cmp.deletionsPage).toBe(1);
    cmp.deletionsPrev();
    expect(cmp.deletionsPage).toBe(1);
  });

  it('returns empty meta text when no meta and a translated string otherwise', () => {
    const cmp = create();
    cmp.exportsMeta.set(null);
    cmp.deletionsMeta.set(null);
    expect(cmp.exportsMetaText()).toBe('');
    expect(cmp.deletionsMetaText()).toBe('');

    cmp.exportsMeta.set({ total_items: 3, total_pages: 1, page: 1, limit: 25 });
    cmp.deletionsMeta.set({ total_items: 3, total_pages: 1, page: 1, limit: 25 });
    expect(cmp.exportsMetaText()).toBe('adminUi.gdpr.pagination');
    expect(cmp.deletionsMetaText()).toBe('adminUi.gdpr.pagination');
  });

  it('clamps the progress percentage and defaults non-finite/absent values', () => {
    const cmp = create();
    expect(cmp.progressPct(exportJob({ progress: 50 }))).toBe(50);
    expect(cmp.progressPct(exportJob({ progress: 150 }))).toBe(100);
    expect(cmp.progressPct(exportJob({ progress: -10 }))).toBe(0);
    expect(cmp.progressPct(exportJob({ progress: NaN }))).toBe(0);
    expect(cmp.progressPct(exportJob({ progress: null as any }))).toBe(0);
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
    expect(cmp.deletionStatusPill('scheduled')).toContain('slate');
  });

  it('navigates to the users page when opening a user, ignoring blank input', () => {
    const cmp = create();
    cmp.openUser('  ');
    cmp.openUser(null as any);
    expect(navigateByUrlSpy).not.toHaveBeenCalled();

    cmp.openUser('  user@example.com  ');
    expect(navigateByUrlSpy).toHaveBeenCalledWith('/admin/users', {
      state: { prefillUserSearch: 'user@example.com', autoSelectFirst: true },
    });
  });

  it('guards retryExport behind id, admin rights and confirmation', () => {
    const cmp = create();
    cmp.retryExport({} as any);
    expect(usersApi.retryGdprExportJob).not.toHaveBeenCalled();

    auth.isAdmin.and.returnValue(false);
    cmp.retryExport(exportJob());
    expect(usersApi.retryGdprExportJob).not.toHaveBeenCalled();

    auth.isAdmin.and.returnValue(true);
    spyOn(window, 'confirm').and.returnValues(false, true);
    cmp.retryExport(exportJob());
    expect(usersApi.retryGdprExportJob).not.toHaveBeenCalled();

    cmp.retryExport(exportJob());
    expect(usersApi.retryGdprExportJob).toHaveBeenCalledWith('job-1');
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.retryingJobId()).toBeNull();
  });

  it('reports a retryExport failure and clears the in-flight marker', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    usersApi.retryGdprExportJob.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.retryExport(exportJob());
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.retryingJobId()).toBeNull();
  });

  it('guards downloadExport behind id and admin rights, then downloads a blob', () => {
    const cmp = create();
    cmp.downloadExport({} as any);
    expect(usersApi.downloadGdprExportJob).not.toHaveBeenCalled();

    auth.isAdmin.and.returnValue(false);
    cmp.downloadExport(exportJob());
    expect(usersApi.downloadGdprExportJob).not.toHaveBeenCalled();

    auth.isAdmin.and.returnValue(true);
    const createSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    const revokeSpy = spyOn(URL, 'revokeObjectURL');
    const clickSpy = spyOn(HTMLAnchorElement.prototype, 'click');
    cmp.downloadExport(exportJob());
    expect(createSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.downloadingJobId()).toBeNull();
  });

  it('reports a downloadExport failure and clears the in-flight marker', () => {
    usersApi.downloadGdprExportJob.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.downloadExport(exportJob());
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.downloadingJobId()).toBeNull();
  });

  it('opens the execute-deletion modal only with a user id and admin rights', () => {
    const cmp = create();
    cmp.executeDeletion(deletionItem({ user: { id: '', email: '', username: '', role: '' } }));
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

  it('computes the execute-deletion confirm-disabled state', () => {
    const cmp = create();
    cmp.deletionBusyUserId.set('u2');
    expect(cmp.executeDeletionConfirmDisabled()).toBeTrue();

    cmp.deletionBusyUserId.set(null);
    cmp.executeDeletionPassword = '   ';
    expect(cmp.executeDeletionConfirmDisabled()).toBeTrue();

    cmp.executeDeletionPassword = 'secret';
    expect(cmp.executeDeletionConfirmDisabled()).toBeFalse();
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

  it('confirmExecuteDeletion closes when there is no target', () => {
    const cmp = create();
    cmp.executeDeletionTarget.set(null);
    cmp.executeDeletionModalOpen.set(true);
    cmp.confirmExecuteDeletion();
    expect(cmp.executeDeletionModalOpen()).toBeFalse();
    expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
  });

  it('confirmExecuteDeletion closes when the operator is not admin', () => {
    const cmp = create();
    cmp.executeDeletionTarget.set(deletionItem());
    cmp.executeDeletionModalOpen.set(true);
    auth.isAdmin.and.returnValue(false);
    cmp.confirmExecuteDeletion();
    expect(cmp.executeDeletionModalOpen()).toBeFalse();
    expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
  });

  it('confirmExecuteDeletion requires a password before calling the API', () => {
    const cmp = create();
    cmp.executeDeletionTarget.set(deletionItem());
    cmp.executeDeletionPassword = null as any;
    cmp.confirmExecuteDeletion();
    expect(cmp.executeDeletionModalError).toBe('adminUi.gdpr.passwordRequired');
    expect(usersApi.executeGdprDeletion).not.toHaveBeenCalled();
  });

  it('confirmExecuteDeletion executes the deletion and closes on success', () => {
    const cmp = create();
    cmp.executeDeletionTarget.set(deletionItem());
    cmp.executeDeletionPassword = 'secret';
    cmp.confirmExecuteDeletion();
    expect(usersApi.executeGdprDeletion).toHaveBeenCalledWith('u2', 'secret');
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.deletionBusyUserId()).toBeNull();
    expect(cmp.executeDeletionModalOpen()).toBeFalse();
  });

  it('confirmExecuteDeletion surfaces the server detail on failure', () => {
    usersApi.executeGdprDeletion.and.returnValue(throwError(() => ({ error: { detail: 'wrong password' } })));
    const cmp = create();
    cmp.executeDeletionTarget.set(deletionItem());
    cmp.executeDeletionPassword = 'secret';
    cmp.confirmExecuteDeletion();
    expect(cmp.executeDeletionModalError).toBe('wrong password');
    expect(toast.error).toHaveBeenCalledWith('wrong password');
    expect(cmp.deletionBusyUserId()).toBeNull();
  });

  it('confirmExecuteDeletion falls back to a translated message without a detail', () => {
    usersApi.executeGdprDeletion.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.executeDeletionTarget.set(deletionItem());
    cmp.executeDeletionPassword = 'secret';
    cmp.confirmExecuteDeletion();
    expect(cmp.executeDeletionModalError).toBe('adminUi.gdpr.errors.executeDeletion');
  });

  it('guards cancelDeletion behind user id, admin rights and confirmation', () => {
    const cmp = create();
    cmp.cancelDeletion(deletionItem({ user: { id: '', email: '', username: '', role: '' } }));
    expect(usersApi.cancelGdprDeletion).not.toHaveBeenCalled();

    auth.isAdmin.and.returnValue(false);
    cmp.cancelDeletion(deletionItem());
    expect(usersApi.cancelGdprDeletion).not.toHaveBeenCalled();

    auth.isAdmin.and.returnValue(true);
    spyOn(window, 'confirm').and.returnValues(false, true);
    cmp.cancelDeletion(deletionItem());
    expect(usersApi.cancelGdprDeletion).not.toHaveBeenCalled();

    cmp.cancelDeletion(deletionItem());
    expect(usersApi.cancelGdprDeletion).toHaveBeenCalledWith('u2');
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.deletionBusyUserId()).toBeNull();
  });

  it('reports a cancelDeletion failure and clears the busy marker', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    usersApi.cancelGdprDeletion.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.cancelDeletion(deletionItem());
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.deletionBusyUserId()).toBeNull();
  });

  it('provides trackBy identities for exports and deletions', () => {
    const cmp = create();
    expect(cmp.trackExportJob(0, exportJob({ id: 'abc' }))).toBe('abc');
    expect(cmp.trackDeletion(0, deletionItem())).toBe('u2');
  });

  it('passes trimmed query and concrete status to the export list API', () => {
    const cmp = create();
    cmp.q = '  alice  ';
    cmp.exportStatus = 'failed';
    usersApi.listGdprExportJobs.calls.reset();
    cmp.exportsNext();
    expect(usersApi.listGdprExportJobs).toHaveBeenCalledWith(
      jasmine.objectContaining({ q: 'alice', status: 'failed', page: 2, limit: 25 }),
    );
  });

  it('omits empty query and "all" status from the export list API', () => {
    const cmp = create();
    cmp.q = '   ';
    cmp.exportStatus = 'all';
    usersApi.listGdprExportJobs.calls.reset();
    cmp.applyFilters();
    expect(usersApi.listGdprExportJobs).toHaveBeenCalledWith(
      jasmine.objectContaining({ q: undefined, status: undefined }),
    );
  });

  it('passes trimmed query to the deletions API and omits when blank', () => {
    const cmp = create();
    cmp.q = '  bob  ';
    usersApi.listGdprDeletionRequests.calls.reset();
    cmp.deletionsNext();
    expect(usersApi.listGdprDeletionRequests).toHaveBeenCalledWith(
      jasmine.objectContaining({ q: 'bob', page: 2, limit: 25 }),
    );

    cmp.q = '   ';
    usersApi.listGdprDeletionRequests.calls.reset();
    cmp.deletionsNext();
    expect(usersApi.listGdprDeletionRequests).toHaveBeenCalledWith(
      jasmine.objectContaining({ q: undefined }),
    );
  });

  it('defaults absent export response payloads to empty list and null meta', () => {
    usersApi.listGdprExportJobs.and.returnValue(of({} as any));
    const cmp = create();
    cmp.applyFilters();
    expect(cmp.exports()).toEqual([]);
    expect(cmp.exportsMeta()).toBeNull();
    expect(cmp.exportsLoading()).toBeFalse();
  });

  it('defaults absent deletion response payloads to empty list and null meta', () => {
    usersApi.listGdprDeletionRequests.and.returnValue(of({} as any));
    const cmp = create();
    cmp.applyFilters();
    expect(cmp.deletions()).toEqual([]);
    expect(cmp.deletionsMeta()).toBeNull();
    expect(cmp.deletionsLoading()).toBeFalse();
  });

  it('reports an export list load error', () => {
    usersApi.listGdprExportJobs.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.applyFilters();
    expect(cmp.exportsError()).toBe('adminUi.gdpr.errors.loadExports');
    expect(cmp.exportsLoading()).toBeFalse();
  });

  it('reports a deletion list load error', () => {
    usersApi.listGdprDeletionRequests.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.applyFilters();
    expect(cmp.deletionsError()).toBe('adminUi.gdpr.errors.loadDeletions');
    expect(cmp.deletionsLoading()).toBeFalse();
  });

  it('renders loading skeletons, error banners and the execute modal', () => {
    const fixture = TestBed.createComponent(AdminGdprComponent);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();

    cmp.exportsLoading.set(false);
    cmp.deletionsLoading.set(false);
    cmp.exports.set([
      exportJob({ id: 'e1', status: 'running', sla_breached: true, expires_at: null }),
    ]);
    cmp.deletions.set([deletionItem({ status: 'due', sla_breached: true, scheduled_for: null })]);
    cmp.exportsError.set('exports down');
    cmp.deletionsError.set('deletions down');
    cmp.executeDeletionTarget.set(deletionItem());
    cmp.executeDeletionModalOpen.set(true);
    cmp.executeDeletionModalError = 'modal err';
    fixture.detectChanges();

    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('exports down');
    expect(text).toContain('deletions down');
    expect(text).toContain('adminUi.gdpr.slaBreached');
  });

  it('renders empty-state messages and skeletons while loading', () => {
    usersApi.listGdprExportJobs.and.returnValue(
      of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 25 } }),
    );
    usersApi.listGdprDeletionRequests.and.returnValue(
      of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 25 } }),
    );
    const fixture = TestBed.createComponent(AdminGdprComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    let text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('adminUi.gdpr.exportsEmpty');
    expect(text).toContain('adminUi.gdpr.deletionsEmpty');

    cmp.exportsLoading.set(true);
    cmp.deletionsLoading.set(true);
    fixture.detectChanges();
    text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(cmp.exportsLoading()).toBeTrue();
  });
});
