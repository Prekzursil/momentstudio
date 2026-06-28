import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import {
  AdminContactSubmissionListItem,
  AdminContactSubmissionRead,
  AdminSupportService,
  SupportAgentRef,
  SupportCannedResponseRead,
} from '../../../core/admin-support.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../core/toast.service';
import { AdminSupportComponent } from './admin-support.component';

function makeAgent(overrides: Partial<SupportAgentRef> = {}): SupportAgentRef {
  return {
    id: 'agent-1',
    username: 'alice',
    name: 'Alice',
    name_tag: 42,
    role: 'support',
    ...overrides,
  };
}

function makeItem(
  overrides: Partial<AdminContactSubmissionListItem> = {},
): AdminContactSubmissionListItem {
  return {
    id: 'ticket-1',
    topic: 'support',
    status: 'new',
    name: 'Bob',
    email: 'bob@example.com',
    order_reference: 'ORD-1',
    assignee: makeAgent(),
    created_at: '2026-02-01T00:00:00Z',
    ...overrides,
  };
}

function makeDetail(
  overrides: Partial<AdminContactSubmissionRead> = {},
): AdminContactSubmissionRead {
  return {
    id: 'ticket-1',
    topic: 'support',
    status: 'new',
    name: 'Bob',
    email: 'bob@example.com',
    message: 'Hello',
    order_reference: 'ORD-1',
    admin_note: 'note',
    assignee: makeAgent(),
    messages: [{ id: 'm1', from_admin: true, message: 'hi', created_at: '2026-02-01T01:00:00Z' }],
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    ...overrides,
  };
}

function makeCanned(
  overrides: Partial<SupportCannedResponseRead> = {},
): SupportCannedResponseRead {
  return {
    id: 'canned-1',
    title: 'Greeting',
    body_en: 'Hello {{customer_name}}',
    body_ro: 'Salut {{customer_name}}',
    is_active: true,
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    ...overrides,
  };
}

describe('AdminSupportComponent', () => {
  let api: jasmine.SpyObj<AdminSupportService>;
  let auth: jasmine.SpyObj<AuthService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: jasmine.SpyObj<Router>;
  let translate: TranslateService;
  let queryParams: Record<string, string | null>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<AdminSupportService>('AdminSupportService', [
      'list',
      'listAssignees',
      'getOne',
      'update',
      'addMessage',
      'listCannedResponses',
      'createCannedResponse',
      'updateCannedResponse',
      'deleteCannedResponse',
      'getSlaSettings',
      'updateSlaSettings',
    ]);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['role']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    queryParams = {};

    // Sensible defaults so ngOnInit's eager loads all succeed.
    api.list.and.returnValue(
      of({
        items: [makeItem()],
        meta: { page: 1, total_pages: 2, total_items: 5, limit: 25 },
      }),
    );
    api.listAssignees.and.returnValue(of([makeAgent()]));
    api.getOne.and.returnValue(of(makeDetail()));
    api.update.and.returnValue(of(makeDetail()));
    api.addMessage.and.returnValue(of(makeDetail()));
    api.listCannedResponses.and.returnValue(of([makeCanned()]));
    api.createCannedResponse.and.returnValue(of(makeCanned()));
    api.updateCannedResponse.and.returnValue(of(makeCanned()));
    api.deleteCannedResponse.and.returnValue(of({}));
    api.getSlaSettings.and.returnValue(of({ first_reply_hours: 24, resolution_hours: 72 }));
    api.updateSlaSettings.and.returnValue(of({ first_reply_hours: 30, resolution_hours: 90 }));
    auth.role.and.returnValue('admin');
    router.navigate.and.returnValue(Promise.resolve(true));

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminSupportComponent],
      providers: [
        { provide: AdminSupportService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: (k: string) => queryParams[k] ?? null } } },
        },
      ],
    }).compileComponents();

    translate = TestBed.inject(TranslateService);
  });

  function create(detectChanges = true): AdminSupportComponent {
    const fixture = TestBed.createComponent(AdminSupportComponent);
    if (detectChanges) fixture.detectChanges();
    return fixture.componentInstance;
  }

  describe('ngOnInit', () => {
    it('initializes with default English lang and renders the list', () => {
      const cmp = create();
      expect(cmp.cannedLang).toBe('en');
      expect(api.list).toHaveBeenCalled();
      expect(api.listAssignees).toHaveBeenCalled();
      expect(api.getSlaSettings).toHaveBeenCalled();
      expect(api.listCannedResponses).toHaveBeenCalled();
      expect(cmp.items().length).toBe(1);
      expect(cmp.loading()).toBeFalse();
    });

    it('uses Romanian canned lang when the active language is ro', () => {
      spyOnProperty(translate, 'currentLang', 'get').and.returnValue('ro');
      const cmp = create();
      expect(cmp.cannedLang).toBe('ro');
    });

    it('opens the ticket given in the query params', () => {
      queryParams['ticket'] = 'ticket-99';
      const cmp = create();
      expect(api.getOne).toHaveBeenCalledWith('ticket-99');
      expect(cmp.selectedId()).toBe('ticket-99');
    });
  });

  describe('list loading', () => {
    it('applyFilters resets to page 1 and reloads', () => {
      const cmp = create();
      cmp.meta.set({ ...cmp.meta(), page: 3 });
      api.list.calls.reset();
      cmp.applyFilters();
      expect(cmp.meta().page).toBe(1);
      expect(api.list).toHaveBeenCalled();
    });

    it('passes trimmed/optional filter params to the api', () => {
      const cmp = create();
      cmp.q = '  query  ';
      cmp.channel = 'refund';
      cmp.status = 'triaged';
      cmp.customerFilter = ' cust ';
      cmp.assigneeFilter = 'agent-1';
      api.list.calls.reset();
      cmp.applyFilters();
      const args = api.list.calls.mostRecent().args[0];
      expect(args.q).toBe('query');
      expect(args.channel_filter).toBe('refund');
      expect(args.status_filter).toBe('triaged');
      expect(args.customer_filter).toBe('cust');
      expect(args.assignee_filter).toBe('agent-1');
    });

    it('omits empty filters', () => {
      const cmp = create();
      api.list.calls.reset();
      cmp.applyFilters();
      const args = api.list.calls.mostRecent().args[0];
      expect(args.q).toBeUndefined();
      expect(args.channel_filter).toBeUndefined();
      expect(args.status_filter).toBeUndefined();
      expect(args.customer_filter).toBeUndefined();
      expect(args.assignee_filter).toBeUndefined();
    });

    it('handles a list load error by setting an error message and request id', () => {
      api.list.and.returnValue(throwError(() => ({ error: { request_id: 'req-7' } })));
      const cmp = create();
      expect(cmp.items().length).toBe(0);
      expect(cmp.error()).toBeTruthy();
      expect(cmp.loading()).toBeFalse();
    });

    it('retryLoad triggers another load', () => {
      const cmp = create();
      api.list.calls.reset();
      cmp.retryLoad();
      expect(api.list).toHaveBeenCalled();
    });
  });

  describe('assignees loading', () => {
    it('falls back to an empty list when assignees response is null', () => {
      api.listAssignees.and.returnValue(of(null as any));
      const cmp = create();
      expect(cmp.assignees()).toEqual([]);
      expect(cmp.assigneesLoading()).toBeFalse();
    });

    it('shows a toast on assignee load error', () => {
      api.listAssignees.and.returnValue(throwError(() => new Error('boom')));
      create();
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('SLA settings', () => {
    it('loads finite SLA values', () => {
      api.getSlaSettings.and.returnValue(of({ first_reply_hours: 10, resolution_hours: 50 }));
      const cmp = create();
      expect(cmp.slaFirstReplyHours).toBe(10);
      expect(cmp.slaResolutionHours).toBe(50);
      expect(cmp.slaFirstReplyHoursDraft).toBe(10);
    });

    it('falls back to defaults when SLA values are not finite', () => {
      api.getSlaSettings.and.returnValue(
        of({ first_reply_hours: NaN as any, resolution_hours: 'x' as any }),
      );
      const cmp = create();
      expect(cmp.slaFirstReplyHours).toBe(24);
      expect(cmp.slaResolutionHours).toBe(72);
    });

    it('keeps defaults when SLA load errors', () => {
      api.getSlaSettings.and.returnValue(throwError(() => new Error('nope')));
      const cmp = create();
      expect(cmp.slaFirstReplyHours).toBe(24);
      expect(cmp.slaResolutionHours).toBe(72);
    });

    it('canEditSlaSettings is true for owner/admin and false otherwise', () => {
      const cmp = create();
      auth.role.and.returnValue('owner');
      expect(cmp.canEditSlaSettings()).toBeTrue();
      auth.role.and.returnValue('admin');
      expect(cmp.canEditSlaSettings()).toBeTrue();
      auth.role.and.returnValue('support');
      expect(cmp.canEditSlaSettings()).toBeFalse();
    });

    it('saveSlaSettings rejects out-of-range values', () => {
      const cmp = create();
      cmp.slaFirstReplyHoursDraft = 0;
      cmp.slaResolutionHoursDraft = 50;
      cmp.saveSlaSettings();
      expect(cmp.slaSettingsError).toBeTruthy();
      expect(api.updateSlaSettings).not.toHaveBeenCalled();
    });

    it('saveSlaSettings rejects non-finite drafts (coerced to 0)', () => {
      const cmp = create();
      cmp.slaFirstReplyHoursDraft = 'abc';
      cmp.slaResolutionHoursDraft = 'def';
      cmp.saveSlaSettings();
      expect(cmp.slaSettingsError).toBeTruthy();
      expect(api.updateSlaSettings).not.toHaveBeenCalled();
    });

    it('saveSlaSettings persists valid values and reflects the response', () => {
      const cmp = create();
      cmp.slaFirstReplyHoursDraft = 30;
      cmp.slaResolutionHoursDraft = 90;
      cmp.saveSlaSettings();
      expect(api.updateSlaSettings).toHaveBeenCalledWith({
        first_reply_hours: 30,
        resolution_hours: 90,
      });
      expect(cmp.slaFirstReplyHours).toBe(30);
      expect(cmp.slaResolutionHours).toBe(90);
      expect(cmp.slaSettingsMessage).toBeTruthy();
      expect(cmp.slaSettingsSaving).toBeFalse();
    });

    it('saveSlaSettings falls back to submitted values when response is non-finite', () => {
      api.updateSlaSettings.and.returnValue(
        of({ first_reply_hours: NaN as any, resolution_hours: NaN as any }),
      );
      const cmp = create();
      cmp.slaFirstReplyHoursDraft = 12;
      cmp.slaResolutionHoursDraft = 36;
      cmp.saveSlaSettings();
      expect(cmp.slaFirstReplyHours).toBe(12);
      expect(cmp.slaResolutionHours).toBe(36);
    });

    it('saveSlaSettings surfaces a save error', () => {
      api.updateSlaSettings.and.returnValue(throwError(() => new Error('save failed')));
      const cmp = create();
      cmp.slaFirstReplyHoursDraft = 12;
      cmp.slaResolutionHoursDraft = 36;
      cmp.saveSlaSettings();
      expect(cmp.slaSettingsError).toBeTruthy();
      expect(cmp.slaSettingsSaving).toBeFalse();
    });

    it('saveSlaSettings is a no-op while already saving', () => {
      const cmp = create();
      cmp.slaSettingsSaving = true;
      cmp.saveSlaSettings();
      expect(api.updateSlaSettings).not.toHaveBeenCalled();
    });
  });

  describe('formatDuration', () => {
    it('renders just minutes for a sub-hour duration', () => {
      const cmp = create();
      expect((cmp as any).formatDuration(0)).toBe('0m');
    });

    it('renders days and a zero-hours segment when the duration lands on a whole day', () => {
      const cmp = create();
      const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
      expect((cmp as any).formatDuration(twoDaysMs)).toBe('2d 0h 0m');
    });

    it('renders hours and minutes without a days segment', () => {
      const cmp = create();
      const twoHoursThirtyMs = (2 * 60 + 30) * 60 * 1000;
      expect((cmp as any).formatDuration(twoHoursThirtyMs)).toBe('2h 30m');
    });
  });

  describe('slaInfo', () => {
    it('returns null for an invalid created_at date', () => {
      const cmp = create();
      expect(cmp.slaInfo(makeItem({ created_at: 'not-a-date' }))).toBeNull();
    });

    it('returns null for resolved tickets', () => {
      const cmp = create();
      expect(cmp.slaInfo(makeItem({ status: 'resolved' }))).toBeNull();
    });

    it('marks overdue first-reply (new) tickets in rose', () => {
      const cmp = create();
      const info = cmp.slaInfo(makeItem({ status: 'new', created_at: '2000-01-01T00:00:00Z' }));
      expect(info).not.toBeNull();
      expect(info!.class).toContain('rose');
    });

    it('marks resolution (triaged) tickets due soon in amber', () => {
      const cmp = create();
      cmp.slaResolutionHours = 1; // due within an hour from now -> dueSoon window
      const info = cmp.slaInfo(makeItem({ status: 'triaged', created_at: new Date().toISOString() }));
      expect(info).not.toBeNull();
      expect(info!.class).toContain('amber');
    });

    it('marks far-out tickets in slate', () => {
      const cmp = create();
      cmp.slaResolutionHours = 720;
      const info = cmp.slaInfo(makeItem({ status: 'triaged', created_at: new Date().toISOString() }));
      expect(info).not.toBeNull();
      expect(info!.class).toContain('slate');
    });
  });

  describe('formatAgent', () => {
    it('formats username with name and tag', () => {
      const cmp = create();
      expect(cmp.formatAgent(makeAgent({ username: 'alice', name: 'Alice', name_tag: 7 }))).toBe(
        'alice (Alice#7)',
      );
    });

    it('uses 0 tag when name_tag is not finite', () => {
      const cmp = create();
      expect(cmp.formatAgent(makeAgent({ name: 'Alice', name_tag: null }))).toBe('alice (Alice#0)');
    });

    it('returns username alone when there is no name', () => {
      const cmp = create();
      expect(cmp.formatAgent(makeAgent({ username: 'alice', name: '' }))).toBe('alice');
    });

    it('returns an em dash when there is neither username nor name', () => {
      const cmp = create();
      expect(cmp.formatAgent(makeAgent({ username: '', name: '' }))).toBe('—');
    });
  });

  describe('canned responses', () => {
    it('activeCannedResponses filters out inactive and falsy entries', () => {
      const cmp = create();
      cmp.cannedResponses.set([
        makeCanned({ id: 'a', is_active: true }),
        makeCanned({ id: 'b', is_active: false }),
        null as any,
      ]);
      const active = cmp.activeCannedResponses();
      expect(active.length).toBe(1);
      expect(active[0].id).toBe('a');
    });

    it('toggleTemplates flips visibility', () => {
      const cmp = create();
      expect(cmp.showTemplates()).toBeFalse();
      cmp.toggleTemplates();
      expect(cmp.showTemplates()).toBeTrue();
    });

    it('loadCanned is a no-op while already loading', () => {
      const cmp = create();
      cmp.cannedLoading.set(true);
      api.listCannedResponses.calls.reset();
      cmp.loadCanned();
      expect(api.listCannedResponses).not.toHaveBeenCalled();
    });

    it('loadCanned falls back to an empty list when response is null', () => {
      api.listCannedResponses.and.returnValue(of(null as any));
      const cmp = create();
      expect(cmp.cannedResponses()).toEqual([]);
      expect(cmp.cannedLoading()).toBeFalse();
    });

    it('loadCanned shows a toast on error', () => {
      api.listCannedResponses.and.returnValue(throwError(() => new Error('boom')));
      const cmp = create();
      expect(toast.error).toHaveBeenCalled();
      expect(cmp.cannedLoading()).toBeFalse();
    });
  });

  describe('template form', () => {
    it('startNewTemplate resets the form and opens it', () => {
      const cmp = create();
      cmp.templateEditingId = 'x';
      cmp.templateTitle = 'old';
      cmp.startNewTemplate();
      expect(cmp.templateEditingId).toBeNull();
      expect(cmp.templateTitle).toBe('');
      expect(cmp.templateActive).toBeTrue();
      expect(cmp.templateFormOpen()).toBeTrue();
    });

    it('editTemplate loads the selected template into the form', () => {
      const cmp = create();
      cmp.editTemplate(makeCanned({ id: 'z', title: 'T', body_en: 'E', body_ro: 'R', is_active: false }));
      expect(cmp.templateEditingId).toBe('z');
      expect(cmp.templateTitle).toBe('T');
      expect(cmp.templateBodyEn).toBe('E');
      expect(cmp.templateActive).toBeFalse();
      expect(cmp.templateFormOpen()).toBeTrue();
    });

    it('editTemplate handles missing optional fields', () => {
      const cmp = create();
      cmp.editTemplate({ id: 'z', title: '', body_en: '', body_ro: '', is_active: true } as any);
      expect(cmp.templateTitle).toBe('');
      expect(cmp.templateBodyEn).toBe('');
      expect(cmp.templateBodyRo).toBe('');
    });

    it('cancelTemplateEdit closes the form', () => {
      const cmp = create();
      cmp.templateFormOpen.set(true);
      cmp.templateEditingId = 'z';
      cmp.cancelTemplateEdit();
      expect(cmp.templateFormOpen()).toBeFalse();
      expect(cmp.templateEditingId).toBeNull();
    });

    it('saveTemplate rejects a missing title', () => {
      const cmp = create();
      cmp.templateTitle = '';
      cmp.templateBodyEn = 'en';
      cmp.templateBodyRo = 'ro';
      cmp.saveTemplate();
      expect(toast.error).toHaveBeenCalled();
      expect(api.createCannedResponse).not.toHaveBeenCalled();
    });

    it('saveTemplate rejects empty bodies (defaulting falsy fields to empty strings)', () => {
      const cmp = create();
      cmp.templateTitle = 'T';
      cmp.templateBodyEn = '';
      cmp.templateBodyRo = '';
      cmp.saveTemplate();
      expect(toast.error).toHaveBeenCalled();
      expect(api.createCannedResponse).not.toHaveBeenCalled();
    });

    it('saveTemplate is a no-op while already saving', () => {
      const cmp = create();
      cmp.templateTitle = 'T';
      cmp.templateBodyEn = 'E';
      cmp.templateBodyRo = 'R';
      cmp.templateSaving.set(true);
      cmp.saveTemplate();
      expect(api.createCannedResponse).not.toHaveBeenCalled();
    });

    it('saveTemplate creates a new template', () => {
      const cmp = create();
      cmp.templateEditingId = null;
      cmp.templateTitle = '  T  ';
      cmp.templateBodyEn = ' E ';
      cmp.templateBodyRo = ' R ';
      cmp.templateActive = true;
      cmp.saveTemplate();
      expect(api.createCannedResponse).toHaveBeenCalledWith({
        title: 'T',
        body_en: 'E',
        body_ro: 'R',
        is_active: true,
      });
      expect(cmp.templateFormOpen()).toBeFalse();
      expect(toast.success).toHaveBeenCalled();
    });

    it('saveTemplate updates an existing template', () => {
      const cmp = create();
      cmp.templateEditingId = 'edit-1';
      cmp.templateTitle = 'T';
      cmp.templateBodyEn = 'E';
      cmp.templateBodyRo = 'R';
      cmp.templateActive = false;
      cmp.saveTemplate();
      expect(api.updateCannedResponse).toHaveBeenCalledWith('edit-1', {
        title: 'T',
        body_en: 'E',
        body_ro: 'R',
        is_active: false,
      });
      expect(cmp.templateEditingId).toBeNull();
    });

    it('saveTemplate surfaces an error from the update path', () => {
      api.updateCannedResponse.and.returnValue(
        throwError(() => ({ error: { detail: 'update blew up' } })),
      );
      const cmp = create();
      cmp.templateEditingId = 'edit-1';
      cmp.templateTitle = 'T';
      cmp.templateBodyEn = 'E';
      cmp.templateBodyRo = 'R';
      cmp.saveTemplate();
      expect(toast.error).toHaveBeenCalledWith('update blew up');
      expect(cmp.templateSaving()).toBeFalse();
    });

    it('saveTemplate surfaces a backend detail on error', () => {
      api.createCannedResponse.and.returnValue(
        throwError(() => ({ error: { detail: 'specific failure' } })),
      );
      const cmp = create();
      cmp.templateTitle = 'T';
      cmp.templateBodyEn = 'E';
      cmp.templateBodyRo = 'R';
      cmp.saveTemplate();
      expect(toast.error).toHaveBeenCalledWith('specific failure');
      expect(cmp.templateSaving()).toBeFalse();
    });

    it('saveTemplate uses a generic message when no detail is present', () => {
      api.createCannedResponse.and.returnValue(throwError(() => ({})));
      const cmp = create();
      cmp.templateTitle = 'T';
      cmp.templateBodyEn = 'E';
      cmp.templateBodyRo = 'R';
      cmp.saveTemplate();
      expect(toast.error).toHaveBeenCalled();
      expect(cmp.templateSaving()).toBeFalse();
    });
  });

  describe('toggleTemplateActive', () => {
    it('replaces the matching row on success', () => {
      const cmp = create();
      cmp.cannedResponses.set([makeCanned({ id: 'canned-1', is_active: false })]);
      api.updateCannedResponse.and.returnValue(of(makeCanned({ id: 'canned-1', is_active: true })));
      cmp.toggleTemplateActive(makeCanned({ id: 'canned-1', is_active: false }));
      expect(api.updateCannedResponse).toHaveBeenCalledWith('canned-1', { is_active: true });
      expect(cmp.cannedResponses()[0].is_active).toBeTrue();
    });

    it('leaves non-matching rows unchanged on success', () => {
      const cmp = create();
      cmp.cannedResponses.set([makeCanned({ id: 'other', is_active: true })]);
      api.updateCannedResponse.and.returnValue(of(makeCanned({ id: 'canned-1', is_active: false })));
      cmp.toggleTemplateActive(makeCanned({ id: 'canned-1', is_active: true }));
      expect(cmp.cannedResponses()[0].id).toBe('other');
    });

    it('shows a toast on error', () => {
      api.updateCannedResponse.and.returnValue(throwError(() => new Error('boom')));
      const cmp = create();
      cmp.toggleTemplateActive(makeCanned());
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('deleteTemplate', () => {
    it('does nothing when the confirm dialog is cancelled', () => {
      spyOn(window, 'confirm').and.returnValue(false);
      const cmp = create();
      cmp.deleteTemplate(makeCanned());
      expect(api.deleteCannedResponse).not.toHaveBeenCalled();
    });

    it('deletes and removes the row, closing an open edit for the same id', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      const cmp = create();
      cmp.cannedResponses.set([makeCanned({ id: 'canned-1' }), makeCanned({ id: 'keep' })]);
      cmp.templateEditingId = 'canned-1';
      cmp.templateFormOpen.set(true);
      cmp.deleteTemplate(makeCanned({ id: 'canned-1' }));
      expect(api.deleteCannedResponse).toHaveBeenCalledWith('canned-1');
      expect(cmp.cannedResponses().map((r) => r.id)).toEqual(['keep']);
      expect(cmp.templateFormOpen()).toBeFalse();
      expect(toast.success).toHaveBeenCalled();
    });

    it('keeps an unrelated open edit form when deleting another template', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      const cmp = create();
      cmp.cannedResponses.set([makeCanned({ id: 'canned-1' })]);
      cmp.templateEditingId = 'different';
      cmp.templateFormOpen.set(true);
      cmp.deleteTemplate(makeCanned({ id: 'canned-1' }));
      expect(cmp.templateFormOpen()).toBeTrue();
    });

    it('shows a toast on error', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      api.deleteCannedResponse.and.returnValue(throwError(() => new Error('boom')));
      const cmp = create();
      cmp.deleteTemplate(makeCanned());
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('insertCanned', () => {
    it('does nothing when no ticket is selected', () => {
      const cmp = create();
      cmp.selected.set(null);
      cmp.insertCanned();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('does nothing when the selected canned id is unknown', () => {
      const cmp = create();
      cmp.selected.set(makeDetail());
      cmp.cannedResponses.set([makeCanned({ id: 'canned-1' })]);
      cmp.cannedSelectedId = 'missing';
      cmp.insertCanned();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('inserts the English body into an empty reply', () => {
      const cmp = create();
      cmp.selected.set(makeDetail({ name: 'Bob' }));
      cmp.cannedResponses.set([makeCanned({ id: 'canned-1', body_en: 'Hi there' })]);
      cmp.cannedSelectedId = 'canned-1';
      cmp.cannedLang = 'en';
      cmp.replyMessage = '';
      cmp.insertCanned();
      expect(cmp.replyMessage).toBe('Hi there');
      expect(toast.success).toHaveBeenCalled();
    });

    it('appends the Romanian body to an existing reply', () => {
      const cmp = create();
      cmp.selected.set(makeDetail());
      cmp.cannedResponses.set([makeCanned({ id: 'canned-1', body_ro: 'Salut' })]);
      cmp.cannedSelectedId = 'canned-1';
      cmp.cannedLang = 'ro';
      cmp.replyMessage = 'Existing';
      cmp.insertCanned();
      expect(cmp.replyMessage).toBe('Existing\n\nSalut');
    });

    it('does nothing when the rendered body is empty', () => {
      const cmp = create();
      cmp.selected.set(makeDetail({ name: '', email: '', order_reference: null, id: '' }));
      cmp.cannedResponses.set([makeCanned({ id: 'canned-1', body_en: '' })]);
      cmp.cannedSelectedId = 'canned-1';
      cmp.cannedLang = 'en';
      cmp.insertCanned();
      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  describe('openTicket / select', () => {
    it('select opens the ticket and pushes the url', () => {
      const cmp = create();
      cmp.select(makeItem({ id: 'ticket-5' }));
      expect(cmp.selectedId()).toBe('ticket-5');
      expect(router.navigate).toHaveBeenCalled();
      expect(cmp.selected()).not.toBeNull();
      expect(cmp.detailLoading()).toBeFalse();
    });

    it('ignores an empty id', () => {
      const cmp = create();
      api.getOne.calls.reset();
      cmp.select(makeItem({ id: '' }));
      expect(api.getOne).not.toHaveBeenCalled();
    });

    it('ignores re-selecting the already-selected ticket', () => {
      const cmp = create();
      cmp.select(makeItem({ id: 'ticket-5' }));
      api.getOne.calls.reset();
      cmp.select(makeItem({ id: 'ticket-5' }));
      expect(api.getOne).not.toHaveBeenCalled();
    });

    it('populates edit fields, defaulting note and assignee when absent', () => {
      api.getOne.and.returnValue(
        of(makeDetail({ id: 'ticket-7', admin_note: null, assignee: null, status: 'triaged' })),
      );
      const cmp = create();
      cmp.select(makeItem({ id: 'ticket-7' }));
      expect(cmp.editStatus).toBe('triaged');
      expect(cmp.editNote).toBe('');
      expect(cmp.editAssigneeId).toBe('');
    });

    it('resets selection and toasts on detail load error', () => {
      api.getOne.and.returnValue(throwError(() => new Error('boom')));
      const cmp = create();
      cmp.select(makeItem({ id: 'ticket-9' }));
      expect(toast.error).toHaveBeenCalled();
      expect(cmp.selectedId()).toBe('');
      expect(cmp.selected()).toBeNull();
      expect(cmp.detailLoading()).toBeFalse();
    });
  });

  describe('save', () => {
    it('does nothing without a selected ticket', () => {
      const cmp = create();
      cmp.selected.set(null);
      cmp.save();
      expect(api.update).not.toHaveBeenCalled();
    });

    it('is a no-op while already saving', () => {
      const cmp = create();
      cmp.selected.set(makeDetail());
      cmp.saving.set(true);
      cmp.save();
      expect(api.update).not.toHaveBeenCalled();
    });

    it('persists changes and updates the matching list row', () => {
      const cmp = create();
      cmp.items.set([makeItem({ id: 'ticket-1', status: 'new' }), makeItem({ id: 'other' })]);
      cmp.selected.set(makeDetail({ id: 'ticket-1' }));
      cmp.editStatus = 'resolved';
      cmp.editNote = ' done ';
      cmp.editAssigneeId = 'agent-1';
      api.update.and.returnValue(of(makeDetail({ id: 'ticket-1', status: 'resolved', admin_note: null, assignee: null })));
      cmp.save();
      expect(api.update).toHaveBeenCalledWith('ticket-1', {
        status: 'resolved',
        admin_note: 'done',
        assignee_id: 'agent-1',
      });
      const updatedRow = cmp.items().find((it) => it.id === 'ticket-1');
      expect(updatedRow!.status).toBe('resolved');
      expect(cmp.editNote).toBe('');
      expect(cmp.editAssigneeId).toBe('');
      expect(toast.success).toHaveBeenCalled();
      expect(cmp.saving()).toBeFalse();
    });

    it('sends null note and assignee when they are blank', () => {
      const cmp = create();
      cmp.selected.set(makeDetail({ id: 'ticket-1' }));
      cmp.editNote = '   ';
      cmp.editAssigneeId = '';
      cmp.save();
      expect(api.update).toHaveBeenCalledWith('ticket-1', {
        status: 'new',
        admin_note: null,
        assignee_id: null,
      });
    });

    it('surfaces a backend detail message on error', () => {
      api.update.and.returnValue(throwError(() => ({ error: { detail: 'cannot save' } })));
      const cmp = create();
      cmp.selected.set(makeDetail());
      cmp.save();
      expect(toast.error).toHaveBeenCalledWith('cannot save');
      expect(cmp.saving()).toBeFalse();
    });

    it('uses a generic message when no detail is present on error', () => {
      api.update.and.returnValue(throwError(() => ({})));
      const cmp = create();
      cmp.selected.set(makeDetail());
      cmp.save();
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('sendReply', () => {
    it('does nothing without a selected ticket', () => {
      const cmp = create();
      cmp.selected.set(null);
      cmp.sendReply();
      expect(api.addMessage).not.toHaveBeenCalled();
    });

    it('rejects an empty reply', () => {
      const cmp = create();
      cmp.selected.set(makeDetail());
      cmp.replyMessage = '';
      cmp.sendReply();
      expect(toast.error).toHaveBeenCalled();
      expect(api.addMessage).not.toHaveBeenCalled();
    });

    it('is a no-op while already replying', () => {
      const cmp = create();
      cmp.selected.set(makeDetail());
      cmp.replyMessage = 'hi';
      cmp.replying.set(true);
      cmp.sendReply();
      expect(api.addMessage).not.toHaveBeenCalled();
    });

    it('sends a reply and updates the matching list row', () => {
      const cmp = create();
      cmp.items.set([makeItem({ id: 'ticket-1', status: 'new' }), makeItem({ id: 'other' })]);
      cmp.selected.set(makeDetail({ id: 'ticket-1' }));
      cmp.replyMessage = '  hello  ';
      api.addMessage.and.returnValue(of(makeDetail({ id: 'ticket-1', status: 'triaged' })));
      cmp.sendReply();
      expect(api.addMessage).toHaveBeenCalledWith('ticket-1', 'hello');
      expect(cmp.replyMessage).toBe('');
      expect(cmp.items().find((it) => it.id === 'ticket-1')!.status).toBe('triaged');
      expect(toast.success).toHaveBeenCalled();
      expect(cmp.replying()).toBeFalse();
    });

    it('surfaces a backend detail message on error', () => {
      api.addMessage.and.returnValue(throwError(() => ({ error: { detail: 'reply failed' } })));
      const cmp = create();
      cmp.selected.set(makeDetail());
      cmp.replyMessage = 'hi';
      cmp.sendReply();
      expect(toast.error).toHaveBeenCalledWith('reply failed');
      expect(cmp.replying()).toBeFalse();
    });

    it('uses a generic message when no detail is present on error', () => {
      api.addMessage.and.returnValue(throwError(() => ({})));
      const cmp = create();
      cmp.selected.set(makeDetail());
      cmp.replyMessage = 'hi';
      cmp.sendReply();
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('pagination', () => {
    it('hasPrev/hasNext reflect the current page', () => {
      const cmp = create();
      cmp.meta.set({ page: 1, total_pages: 3, total_items: 10, limit: 25 });
      expect(cmp.hasPrev()).toBeFalse();
      expect(cmp.hasNext()).toBeTrue();
      cmp.meta.set({ page: 3, total_pages: 3, total_items: 10, limit: 25 });
      expect(cmp.hasPrev()).toBeTrue();
      expect(cmp.hasNext()).toBeFalse();
    });

    it('prev decrements the page and reloads', () => {
      const cmp = create();
      cmp.meta.set({ page: 2, total_pages: 3, total_items: 10, limit: 25 });
      api.list.calls.reset();
      cmp.prev();
      expect(api.list.calls.mostRecent().args[0].page).toBe(1);
      expect(api.list).toHaveBeenCalled();
    });

    it('prev is a no-op on the first page', () => {
      const cmp = create();
      cmp.meta.set({ page: 1, total_pages: 3, total_items: 10, limit: 25 });
      api.list.calls.reset();
      cmp.prev();
      expect(api.list).not.toHaveBeenCalled();
    });

    it('next increments the page and reloads', () => {
      const cmp = create();
      cmp.meta.set({ page: 1, total_pages: 3, total_items: 10, limit: 25 });
      // Keep the response meta consistent so the post-load page reflects the request.
      api.list.and.returnValue(
        of({ items: [], meta: { page: 2, total_pages: 3, total_items: 10, limit: 25 } }),
      );
      api.list.calls.reset();
      cmp.next();
      expect(api.list.calls.mostRecent().args[0].page).toBe(2);
      expect(cmp.meta().page).toBe(2);
    });

    it('next is a no-op on the last page', () => {
      const cmp = create();
      cmp.meta.set({ page: 3, total_pages: 3, total_items: 10, limit: 25 });
      api.list.calls.reset();
      cmp.next();
      expect(api.list).not.toHaveBeenCalled();
    });
  });
});
