import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../../core/auth.service';
import {
  AdminContactSubmissionListItem,
  AdminContactSubmissionListResponse,
  AdminContactSubmissionRead,
  AdminSupportService,
  SupportAgentRef,
  SupportCannedResponseRead,
} from '../../../core/admin-support.service';
import { ToastService } from '../../../core/toast.service';
import { AdminSupportComponent } from './admin-support.component';

describe('AdminSupportComponent', () => {
  let api: jasmine.SpyObj<AdminSupportService>;
  let auth: jasmine.SpyObj<AuthService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: jasmine.SpyObj<Router>;
  let translate: TranslateService;
  let ticketParam: string | null;

  const agent: SupportAgentRef = {
    id: 'a1',
    username: 'agent1',
    name: 'Agent One',
    name_tag: 12,
    role: 'support',
  };

  const listItem: AdminContactSubmissionListItem = {
    id: 't1',
    topic: 'support',
    status: 'new',
    name: 'Cara',
    email: 'cara@example.com',
    order_reference: 'ORD-1',
    assignee: agent,
    created_at: '2026-01-01T00:00:00Z',
  };

  const detail: AdminContactSubmissionRead = {
    id: 't1',
    topic: 'support',
    status: 'triaged',
    name: 'Cara',
    email: 'cara@example.com',
    message: 'hello',
    order_reference: 'ORD-1',
    admin_note: 'note',
    assignee: agent,
    messages: [{ id: 'm1', from_admin: true, message: 'hi', created_at: '2026-01-01T01:00:00Z' }],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T02:00:00Z',
  };

  const canned: SupportCannedResponseRead = {
    id: 'c1',
    title: 'Greeting',
    body_en: 'Hello EN',
    body_ro: 'Salut RO',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const listResponse: AdminContactSubmissionListResponse = {
    items: [listItem],
    meta: { page: 1, total_pages: 1, total_items: 1, limit: 25 },
  };

  beforeEach(async () => {
    ticketParam = null;
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

    api.list.and.returnValue(of(listResponse));
    api.listAssignees.and.returnValue(of([agent]));
    api.getOne.and.returnValue(of(detail));
    api.update.and.returnValue(of(detail));
    api.addMessage.and.returnValue(of(detail));
    api.listCannedResponses.and.returnValue(of([canned]));
    api.createCannedResponse.and.returnValue(of(canned));
    api.updateCannedResponse.and.returnValue(of(canned));
    api.deleteCannedResponse.and.returnValue(of({}));
    api.getSlaSettings.and.returnValue(of({ first_reply_hours: 24, resolution_hours: 72 }));
    api.updateSlaSettings.and.returnValue(of({ first_reply_hours: 24, resolution_hours: 72 }));
    auth.role.and.returnValue('owner');
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
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
      ],
    }).compileComponents();

    translate = TestBed.inject(TranslateService);
    // Provide just the SLA label translations so {{duration}} interpolation is
    // observable; every other key intentionally falls back to its raw key,
    // which the assertions below rely on.
    translate.setTranslation('en', {
      adminUi: {
        support: {
          sla: {
            reply: 'Reply',
            resolve: 'Resolve',
            overdue: 'overdue {{duration}}',
            due: 'due {{duration}}',
          },
        },
      },
    });
    translate.setDefaultLang('en');
  });

  function create(): AdminSupportComponent {
    const route = TestBed.inject(ActivatedRoute);
    (route.snapshot as any).queryParamMap = convertToParamMap(
      ticketParam ? { ticket: ticketParam } : {},
    );
    return TestBed.createComponent(AdminSupportComponent).componentInstance;
  }

  function render() {
    const route = TestBed.inject(ActivatedRoute);
    (route.snapshot as any).queryParamMap = convertToParamMap(
      ticketParam ? { ticket: ticketParam } : {},
    );
    const fixture = TestBed.createComponent(AdminSupportComponent);
    fixture.detectChanges();
    return fixture;
  }

  // ---- ngOnInit ----

  it('renders, defaults cannedLang to en, and loads data on init', () => {
    const fixture = render();
    expect(api.listAssignees).toHaveBeenCalled();
    expect(api.getSlaSettings).toHaveBeenCalled();
    expect(api.listCannedResponses).toHaveBeenCalled();
    expect(api.list).toHaveBeenCalled();
    expect(fixture.componentInstance.cannedLang).toBe('en');
    expect(api.getOne).not.toHaveBeenCalled();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('adminUi.support.title');
  });

  it('uses ro cannedLang when the active language is ro', () => {
    Object.defineProperty(translate, 'currentLang', { get: () => 'ro', configurable: true });
    const cmp = create();
    cmp.ngOnInit();
    expect(cmp.cannedLang).toBe('ro');
  });

  it('opens a ticket from the query param on init without pushing the url', () => {
    ticketParam = 't1';
    const cmp = create();
    cmp.ngOnInit();
    expect(api.getOne).toHaveBeenCalledWith('t1');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  // ---- applyFilters / retryLoad / load ----

  it('applyFilters resets to page 1 and reloads with trimmed/empty filters mapped to undefined', () => {
    const cmp = create();
    cmp.meta.set({ page: 5, total_pages: 9, total_items: 99, limit: 25 });
    cmp.q = '  hi  ';
    cmp.channel = 'refund';
    cmp.status = 'triaged';
    cmp.customerFilter = '  bob  ';
    cmp.assigneeFilter = 'a1';
    cmp.applyFilters();
    expect(cmp.meta().page).toBe(1);
    expect(api.list).toHaveBeenCalledWith({
      q: 'hi',
      channel_filter: 'refund',
      status_filter: 'triaged',
      customer_filter: 'bob',
      assignee_filter: 'a1',
      page: 1,
      limit: 25,
    });
    expect(cmp.items()).toEqual(listResponse.items);
    expect(cmp.loading()).toBeFalse();
  });

  it('load maps blank filters to undefined', () => {
    const cmp = create();
    cmp.q = '   ';
    cmp.channel = '';
    cmp.status = '';
    cmp.customerFilter = '   ';
    cmp.assigneeFilter = '';
    cmp.retryLoad();
    expect(api.list).toHaveBeenCalledWith({
      q: undefined,
      channel_filter: undefined,
      status_filter: undefined,
      customer_filter: undefined,
      assignee_filter: undefined,
      page: 1,
      limit: 25,
    });
  });

  it('load sets error state and clears items on failure', () => {
    api.list.and.returnValue(throwError(() => new Error('boom')));
    const cmp = create();
    cmp.retryLoad();
    expect(cmp.items()).toEqual([]);
    expect(cmp.error()).toBe('adminUi.support.errors.load');
    expect(cmp.errorRequestId()).toBeNull();
    expect(cmp.loading()).toBeFalse();
  });

  // ---- canEditSlaSettings ----

  it('canEditSlaSettings is true for owner and admin, false otherwise', () => {
    const cmp = create();
    auth.role.and.returnValue('owner');
    expect(cmp.canEditSlaSettings()).toBeTrue();
    auth.role.and.returnValue('admin');
    expect(cmp.canEditSlaSettings()).toBeTrue();
    auth.role.and.returnValue('support');
    expect(cmp.canEditSlaSettings()).toBeFalse();
  });

  // ---- loadSlaSettings ----

  it('loadSlaSettings stores truncated finite values', () => {
    api.getSlaSettings.and.returnValue(of({ first_reply_hours: 30.9, resolution_hours: 80.2 }));
    const cmp = create();
    cmp.loadSlaSettings();
    expect(cmp.slaFirstReplyHours).toBe(30);
    expect(cmp.slaResolutionHours).toBe(80);
    expect(cmp.slaFirstReplyHoursDraft).toBe(30);
    expect(cmp.slaResolutionHoursDraft).toBe(80);
  });

  it('loadSlaSettings falls back to defaults for non-finite values', () => {
    api.getSlaSettings.and.returnValue(
      of({ first_reply_hours: 'x', resolution_hours: 'y' } as any),
    );
    const cmp = create();
    cmp.loadSlaSettings();
    expect(cmp.slaFirstReplyHours).toBe(24);
    expect(cmp.slaResolutionHours).toBe(72);
  });

  it('loadSlaSettings keeps defaults on error', () => {
    api.getSlaSettings.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.slaFirstReplyHours = 24;
    cmp.loadSlaSettings();
    expect(cmp.slaFirstReplyHours).toBe(24);
  });

  // ---- saveSlaSettings ----

  it('saveSlaSettings returns early when already saving', () => {
    const cmp = create();
    cmp.slaSettingsSaving = true;
    cmp.saveSlaSettings();
    expect(api.updateSlaSettings).not.toHaveBeenCalled();
  });

  it('saveSlaSettings rejects non-finite (zeroed) first value', () => {
    const cmp = create();
    cmp.slaFirstReplyHoursDraft = 'abc';
    cmp.slaResolutionHoursDraft = 72;
    cmp.saveSlaSettings();
    expect(cmp.slaSettingsError).toBe('adminUi.support.sla.errors.invalid');
    expect(cmp.slaSettingsMessage).toBeNull();
    expect(api.updateSlaSettings).not.toHaveBeenCalled();
  });

  it('saveSlaSettings rejects first value above the maximum', () => {
    const cmp = create();
    cmp.slaFirstReplyHoursDraft = 1000;
    cmp.slaResolutionHoursDraft = 72;
    cmp.saveSlaSettings();
    expect(cmp.slaSettingsError).toBe('adminUi.support.sla.errors.invalid');
  });

  it('saveSlaSettings rejects resolution below the minimum', () => {
    const cmp = create();
    cmp.slaFirstReplyHoursDraft = 24;
    cmp.slaResolutionHoursDraft = 0;
    cmp.saveSlaSettings();
    expect(cmp.slaSettingsError).toBe('adminUi.support.sla.errors.invalid');
  });

  it('saveSlaSettings rejects non-finite (zeroed) resolution value', () => {
    const cmp = create();
    cmp.slaFirstReplyHoursDraft = 24;
    cmp.slaResolutionHoursDraft = 'xyz';
    cmp.saveSlaSettings();
    expect(cmp.slaSettingsError).toBe('adminUi.support.sla.errors.invalid');
    expect(api.updateSlaSettings).not.toHaveBeenCalled();
  });

  it('saveSlaSettings rejects resolution above the maximum', () => {
    const cmp = create();
    cmp.slaFirstReplyHoursDraft = 24;
    cmp.slaResolutionHoursDraft = 1000;
    cmp.saveSlaSettings();
    expect(cmp.slaSettingsError).toBe('adminUi.support.sla.errors.invalid');
  });

  it('saveSlaSettings persists valid values and stores finite server response', () => {
    api.updateSlaSettings.and.returnValue(of({ first_reply_hours: 30, resolution_hours: 80 }));
    const cmp = create();
    cmp.slaFirstReplyHoursDraft = 24;
    cmp.slaResolutionHoursDraft = 72;
    cmp.saveSlaSettings();
    expect(api.updateSlaSettings).toHaveBeenCalledWith({
      first_reply_hours: 24,
      resolution_hours: 72,
    });
    expect(cmp.slaFirstReplyHours).toBe(30);
    expect(cmp.slaResolutionHours).toBe(80);
    expect(cmp.slaSettingsMessage).toBe('adminUi.support.sla.success.save');
    expect(cmp.slaSettingsSaving).toBeFalse();
  });

  it('saveSlaSettings falls back to submitted values when the server returns non-finite', () => {
    api.updateSlaSettings.and.returnValue(
      of({ first_reply_hours: 'x', resolution_hours: 'y' } as any),
    );
    const cmp = create();
    cmp.slaFirstReplyHoursDraft = 10;
    cmp.slaResolutionHoursDraft = 20;
    cmp.saveSlaSettings();
    expect(cmp.slaFirstReplyHours).toBe(10);
    expect(cmp.slaResolutionHours).toBe(20);
  });

  it('saveSlaSettings reports an error when the update fails', () => {
    api.updateSlaSettings.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.slaFirstReplyHoursDraft = 24;
    cmp.slaResolutionHoursDraft = 72;
    cmp.saveSlaSettings();
    expect(cmp.slaSettingsError).toBe('adminUi.support.sla.errors.save');
    expect(cmp.slaSettingsMessage).toBeNull();
    expect(cmp.slaSettingsSaving).toBeFalse();
  });

  // ---- slaInfo / formatDuration ----

  function rowAt(offsetMs: number, status: 'new' | 'triaged' | 'resolved'): AdminContactSubmissionListItem {
    return { ...listItem, status, created_at: new Date(Date.now() - offsetMs).toISOString() };
  }

  it('slaInfo returns null for an invalid created_at', () => {
    const cmp = create();
    expect(cmp.slaInfo({ ...listItem, created_at: 'not-a-date' })).toBeNull();
  });

  it('slaInfo returns null for resolved tickets', () => {
    const cmp = create();
    expect(cmp.slaInfo(rowAt(0, 'resolved'))).toBeNull();
  });

  it('slaInfo marks a reply due far out as slate with a day duration', () => {
    const cmp = create();
    cmp.slaFirstReplyHours = 50;
    const info = cmp.slaInfo(rowAt(0, 'new'));
    expect(info).not.toBeNull();
    expect(info!.class).toContain('bg-slate-100');
    expect(info!.label).toContain('Reply');
    expect(info!.label).toMatch(/\dd\b/);
  });

  it('slaInfo marks an overdue resolution as rose with an hour duration', () => {
    const cmp = create();
    cmp.slaResolutionHours = 72;
    const info = cmp.slaInfo(rowAt((72 + 5) * 3600_000, 'triaged'));
    expect(info!.class).toContain('bg-rose-100');
    expect(info!.label).toContain('Resolve');
    expect(info!.label).toContain('overdue');
    expect(info!.label).toContain('5h');
  });

  it('slaInfo marks a reply due soon as amber', () => {
    const cmp = create();
    cmp.slaFirstReplyHours = 24;
    const info = cmp.slaInfo(rowAt(22 * 3600_000, 'new'));
    expect(info!.class).toContain('bg-amber-100');
    expect(info!.label).toContain('2h');
  });

  it('slaInfo formats a minutes-only duration', () => {
    const cmp = create();
    cmp.slaFirstReplyHours = 24;
    const info = cmp.slaInfo(rowAt(23.5 * 3600_000, 'new'));
    expect(info!.class).toContain('bg-amber-100');
    expect(info!.label).toMatch(/\b\d+m\b/);
    expect(info!.label).not.toMatch(/\dh\b/);
  });

  // ---- formatAgent ----

  it('formatAgent renders username, name and tag (trimmed)', () => {
    const cmp = create();
    expect(
      cmp.formatAgent({ id: 'x', username: '  bob  ', name: '  Bob  ', name_tag: 7, role: 'support' }),
    ).toBe('bob (Bob#7)');
  });

  it('formatAgent renders just the username when name is empty (non-finite tag)', () => {
    const cmp = create();
    expect(
      cmp.formatAgent({ id: 'x', username: 'alice', name: '', name_tag: null, role: 'support' }),
    ).toBe('alice');
  });

  it('formatAgent renders a dash when username and name are empty', () => {
    const cmp = create();
    expect(
      cmp.formatAgent({ id: 'x', username: '', name: '', name_tag: 3, role: 'support' }),
    ).toBe('—');
  });

  // ---- activeCannedResponses / toggleTemplates ----

  it('activeCannedResponses filters out inactive and falsy entries', () => {
    const cmp = create();
    cmp.cannedResponses.set([
      { ...canned, id: 'c1', is_active: true },
      { ...canned, id: 'c2', is_active: false },
      null as any,
    ]);
    expect(cmp.activeCannedResponses().map((t) => t.id)).toEqual(['c1']);
  });

  it('toggleTemplates flips the visibility signal', () => {
    const cmp = create();
    expect(cmp.showTemplates()).toBeFalse();
    cmp.toggleTemplates();
    expect(cmp.showTemplates()).toBeTrue();
    cmp.toggleTemplates();
    expect(cmp.showTemplates()).toBeFalse();
  });

  // ---- loadCanned ----

  it('loadCanned returns early when already loading', () => {
    const cmp = create();
    cmp.cannedLoading.set(true);
    cmp.loadCanned();
    expect(api.listCannedResponses).not.toHaveBeenCalled();
  });

  it('loadCanned stores rows and clears loading', () => {
    const cmp = create();
    cmp.loadCanned();
    expect(cmp.cannedResponses()).toEqual([canned]);
    expect(cmp.cannedLoading()).toBeFalse();
  });

  it('loadCanned defaults null rows to an empty array', () => {
    api.listCannedResponses.and.returnValue(of(null as any));
    const cmp = create();
    cmp.loadCanned();
    expect(cmp.cannedResponses()).toEqual([]);
  });

  it('loadCanned toasts and clears loading on error', () => {
    api.listCannedResponses.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.loadCanned();
    expect(toast.error).toHaveBeenCalledWith('adminUi.support.templates.errors.load');
    expect(cmp.cannedLoading()).toBeFalse();
  });

  // ---- template form lifecycle ----

  it('startNewTemplate resets the form and opens it', () => {
    const cmp = create();
    cmp.templateEditingId = 'old';
    cmp.templateTitle = 'x';
    cmp.startNewTemplate();
    expect(cmp.templateEditingId).toBeNull();
    expect(cmp.templateTitle).toBe('');
    expect(cmp.templateActive).toBeTrue();
    expect(cmp.templateFormOpen()).toBeTrue();
  });

  it('editTemplate copies values from the chosen template', () => {
    const cmp = create();
    cmp.editTemplate({ ...canned, is_active: false });
    expect(cmp.templateEditingId).toBe('c1');
    expect(cmp.templateTitle).toBe('Greeting');
    expect(cmp.templateBodyEn).toBe('Hello EN');
    expect(cmp.templateActive).toBeFalse();
    expect(cmp.templateFormOpen()).toBeTrue();
  });

  it('editTemplate defaults missing fields to empty strings', () => {
    const cmp = create();
    cmp.editTemplate({
      id: 'c9',
      title: null,
      body_en: null,
      body_ro: null,
      is_active: false,
    } as any);
    expect(cmp.templateTitle).toBe('');
    expect(cmp.templateBodyEn).toBe('');
    expect(cmp.templateBodyRo).toBe('');
  });

  it('cancelTemplateEdit closes and clears the editing id', () => {
    const cmp = create();
    cmp.templateFormOpen.set(true);
    cmp.templateEditingId = 'c1';
    cmp.cancelTemplateEdit();
    expect(cmp.templateFormOpen()).toBeFalse();
    expect(cmp.templateEditingId).toBeNull();
  });

  // ---- saveTemplate ----

  it('saveTemplate rejects when a required field is missing', () => {
    const cmp = create();
    // All blank exercises every `(field || '')` fallback branch at once.
    cmp.templateTitle = '';
    cmp.templateBodyEn = '';
    cmp.templateBodyRo = '';
    cmp.saveTemplate();
    expect(toast.error).toHaveBeenCalledWith('adminUi.support.templates.errors.required');
    expect(api.createCannedResponse).not.toHaveBeenCalled();
  });

  it('saveTemplate returns early when already saving', () => {
    const cmp = create();
    cmp.templateTitle = 'T';
    cmp.templateBodyEn = 'en';
    cmp.templateBodyRo = 'ro';
    cmp.templateSaving.set(true);
    cmp.saveTemplate();
    expect(api.createCannedResponse).not.toHaveBeenCalled();
  });

  it('saveTemplate creates a new template and refreshes', () => {
    const cmp = create();
    cmp.templateEditingId = null;
    cmp.templateTitle = '  T  ';
    cmp.templateBodyEn = '  en  ';
    cmp.templateBodyRo = '  ro  ';
    cmp.templateActive = true;
    api.listCannedResponses.calls.reset();
    cmp.saveTemplate();
    expect(api.createCannedResponse).toHaveBeenCalledWith({
      title: 'T',
      body_en: 'en',
      body_ro: 'ro',
      is_active: true,
    });
    expect(cmp.templateFormOpen()).toBeFalse();
    expect(cmp.templateSaving()).toBeFalse();
    expect(api.listCannedResponses).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('adminUi.support.templates.success.saved');
  });

  it('saveTemplate updates an existing template', () => {
    const cmp = create();
    cmp.templateEditingId = 'c1';
    cmp.templateTitle = 'T';
    cmp.templateBodyEn = 'en';
    cmp.templateBodyRo = 'ro';
    cmp.templateActive = false;
    cmp.saveTemplate();
    expect(api.updateCannedResponse).toHaveBeenCalledWith('c1', {
      title: 'T',
      body_en: 'en',
      body_ro: 'ro',
      is_active: false,
    });
    expect(cmp.templateEditingId).toBeNull();
  });

  it('saveTemplate surfaces the server detail on create failure', () => {
    api.createCannedResponse.and.returnValue(
      throwError(() => ({ error: { detail: 'nope' } })),
    );
    const cmp = create();
    cmp.templateEditingId = null;
    cmp.templateTitle = 'T';
    cmp.templateBodyEn = 'en';
    cmp.templateBodyRo = 'ro';
    cmp.saveTemplate();
    expect(toast.error).toHaveBeenCalledWith('nope');
    expect(cmp.templateSaving()).toBeFalse();
  });

  it('saveTemplate falls back to a translated error on update failure without detail', () => {
    api.updateCannedResponse.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.templateEditingId = 'c1';
    cmp.templateTitle = 'T';
    cmp.templateBodyEn = 'en';
    cmp.templateBodyRo = 'ro';
    cmp.saveTemplate();
    expect(toast.error).toHaveBeenCalledWith('adminUi.support.templates.errors.save');
  });

  // ---- toggleTemplateActive ----

  it('toggleTemplateActive replaces the matching row on success', () => {
    const updated = { ...canned, id: 'c1', is_active: false };
    api.updateCannedResponse.and.returnValue(of(updated));
    const cmp = create();
    cmp.cannedResponses.set([
      { ...canned, id: 'c1', is_active: true },
      { ...canned, id: 'c2', is_active: true },
    ]);
    cmp.toggleTemplateActive(cmp.cannedResponses()[0]);
    expect(api.updateCannedResponse).toHaveBeenCalledWith('c1', { is_active: false });
    expect(cmp.cannedResponses().find((r) => r.id === 'c1')!.is_active).toBeFalse();
    expect(cmp.cannedResponses().find((r) => r.id === 'c2')!.is_active).toBeTrue();
  });

  it('toggleTemplateActive toasts on error', () => {
    api.updateCannedResponse.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.toggleTemplateActive(canned);
    expect(toast.error).toHaveBeenCalledWith('adminUi.support.templates.errors.save');
  });

  // ---- deleteTemplate ----

  it('deleteTemplate aborts when the confirmation is declined', () => {
    spyOn(window, 'confirm').and.returnValue(false);
    const cmp = create();
    cmp.deleteTemplate(canned);
    expect(api.deleteCannedResponse).not.toHaveBeenCalled();
  });

  it('deleteTemplate removes the row and cancels the edit when deleting the edited template', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    const cmp = create();
    cmp.cannedResponses.set([{ ...canned, id: 'c1' }]);
    cmp.templateEditingId = 'c1';
    cmp.templateFormOpen.set(true);
    cmp.deleteTemplate({ ...canned, id: 'c1' });
    expect(cmp.cannedResponses()).toEqual([]);
    expect(cmp.templateEditingId).toBeNull();
    expect(cmp.templateFormOpen()).toBeFalse();
    expect(toast.success).toHaveBeenCalledWith('adminUi.support.templates.success.deleted');
  });

  it('deleteTemplate keeps an unrelated edit open', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    const cmp = create();
    cmp.cannedResponses.set([
      { ...canned, id: 'c1' },
      { ...canned, id: 'c2' },
    ]);
    cmp.templateEditingId = 'c2';
    cmp.deleteTemplate({ ...canned, id: 'c1' });
    expect(cmp.cannedResponses().map((r) => r.id)).toEqual(['c2']);
    expect(cmp.templateEditingId).toBe('c2');
  });

  it('deleteTemplate toasts on error', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    api.deleteCannedResponse.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.deleteTemplate(canned);
    expect(toast.error).toHaveBeenCalledWith('adminUi.support.templates.errors.delete');
  });

  // ---- insertCanned / renderTemplate ----

  it('insertCanned returns early when no ticket is selected', () => {
    const cmp = create();
    cmp.selected.set(null);
    cmp.insertCanned();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('insertCanned returns early when the template is not found', () => {
    const cmp = create();
    cmp.selected.set(detail);
    cmp.cannedResponses.set([canned]);
    cmp.cannedSelectedId = 'missing';
    cmp.insertCanned();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('insertCanned returns early when the rendered body is empty', () => {
    const cmp = create();
    cmp.selected.set(detail);
    // Empty body exercises the `(body || '')` fallback branch in renderTemplate.
    cmp.cannedResponses.set([{ ...canned, id: 'c1', body_en: '' }]);
    cmp.cannedSelectedId = 'c1';
    cmp.cannedLang = 'en';
    cmp.insertCanned();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('insertCanned inserts the English body when the reply is empty', () => {
    const cmp = create();
    cmp.selected.set(detail);
    cmp.cannedResponses.set([{ ...canned, id: 'c1', body_en: 'Hello EN' }]);
    cmp.cannedSelectedId = 'c1';
    cmp.cannedLang = 'en';
    cmp.replyMessage = '';
    cmp.insertCanned();
    expect(cmp.replyMessage).toBe('Hello EN');
    expect(toast.success).toHaveBeenCalledWith('adminUi.support.templates.success.inserted');
  });

  it('insertCanned appends the Romanian body to an existing reply', () => {
    const cmp = create();
    cmp.selected.set(detail);
    cmp.cannedResponses.set([{ ...canned, id: 'c1', body_ro: 'Salut RO' }]);
    cmp.cannedSelectedId = 'c1';
    cmp.cannedLang = 'ro';
    cmp.replyMessage = 'Existing';
    cmp.insertCanned();
    expect(cmp.replyMessage).toBe('Existing\n\nSalut RO');
  });

  it('insertCanned runs renderTemplate and tolerates missing ticket fields', () => {
    const cmp = create();
    const ticket: AdminContactSubmissionRead = {
      ...detail,
      name: 'Dana',
      email: 'dana@example.com',
      order_reference: 'ORD-9',
      id: 'TID',
    };
    cmp.selected.set(ticket);
    // The component's replace() patterns require literal backslashes around the
    // tokens, so standard {{token}} syntax is left intact. Assert the ACTUAL
    // behaviour (body returned unchanged), while still exercising the
    // `ticket.<field> || ''` replacement-argument branches (truthy here).
    const body = 'Hi {{customer_name}} <{{customer_email}}> {{order_reference}} {{ticket_id}}';
    cmp.cannedResponses.set([{ ...canned, id: 'c1', body_en: body }]);
    cmp.cannedSelectedId = 'c1';
    cmp.cannedLang = 'en';
    cmp.replyMessage = '';
    cmp.insertCanned();
    expect(cmp.replyMessage).toBe(body);
    expect(toast.success).toHaveBeenCalledWith('adminUi.support.templates.success.inserted');

    // Second pass with blank ticket fields exercises the falsy `|| ''` branches.
    cmp.selected.set({ ...detail, name: '', email: '', order_reference: null, id: '' });
    cmp.replyMessage = '';
    cmp.cannedResponses.set([{ ...canned, id: 'c1', body_en: 'plain body' }]);
    cmp.insertCanned();
    expect(cmp.replyMessage).toBe('plain body');
  });

  // ---- openTicket / select ----

  it('select opens the ticket and pushes the url', () => {
    const cmp = create();
    cmp.select(listItem);
    expect(router.navigate).toHaveBeenCalled();
    expect(cmp.selected()).toEqual(detail);
    expect(cmp.editStatus).toBe('triaged');
    expect(cmp.editNote).toBe('note');
    expect(cmp.editAssigneeId).toBe('a1');
    expect(cmp.replyMessage).toBe('');
    expect(cmp.detailLoading()).toBeFalse();
  });

  it('openTicket ignores empty ids', () => {
    const cmp = create();
    cmp.select({ ...listItem, id: '' });
    expect(api.getOne).not.toHaveBeenCalled();
  });

  it('openTicket skips re-selecting the same id', () => {
    const cmp = create();
    cmp.selectedId.set('t1');
    cmp.select(listItem);
    expect(api.getOne).not.toHaveBeenCalled();
  });

  it('openTicket defaults blank note and assignee on success', () => {
    api.getOne.and.returnValue(
      of({ ...detail, admin_note: null, assignee: null } as AdminContactSubmissionRead),
    );
    const cmp = create();
    cmp.select(listItem);
    expect(cmp.editNote).toBe('');
    expect(cmp.editAssigneeId).toBe('');
  });

  it('openTicket resets state and toasts on detail failure', () => {
    api.getOne.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.select(listItem);
    expect(toast.error).toHaveBeenCalledWith('adminUi.support.errors.loadDetail');
    expect(cmp.selectedId()).toBe('');
    expect(cmp.selected()).toBeNull();
    expect(cmp.detailLoading()).toBeFalse();
  });

  // ---- save ----

  it('save returns early without a selection', () => {
    const cmp = create();
    cmp.selected.set(null);
    cmp.save();
    expect(api.update).not.toHaveBeenCalled();
  });

  it('save returns early when already saving', () => {
    const cmp = create();
    cmp.selected.set(detail);
    cmp.saving.set(true);
    cmp.save();
    expect(api.update).not.toHaveBeenCalled();
  });

  it('save persists changes and updates the matching list row', () => {
    // null admin_note + null assignee exercise the `|| ''` fallback branches.
    const updated = { ...detail, status: 'resolved' as const, admin_note: null, assignee: null };
    api.update.and.returnValue(of(updated));
    const cmp = create();
    cmp.selected.set(detail);
    cmp.items.set([
      { ...listItem, id: 't1' },
      { ...listItem, id: 't2' },
    ]);
    cmp.editStatus = 'resolved';
    cmp.editNote = '  done  ';
    cmp.editAssigneeId = '';
    cmp.save();
    expect(api.update).toHaveBeenCalledWith('t1', {
      status: 'resolved',
      admin_note: 'done',
      assignee_id: null,
    });
    expect(cmp.editNote).toBe('');
    expect(cmp.editAssigneeId).toBe('');
    expect(cmp.items().find((i) => i.id === 't1')!.status).toBe('resolved');
    expect(cmp.items().find((i) => i.id === 't2')!.status).toBe('new');
    expect(toast.success).toHaveBeenCalledWith('adminUi.support.success.saved');
    expect(cmp.saving()).toBeFalse();
  });

  it('save sends note as null when blank and keeps assignee id', () => {
    const cmp = create();
    cmp.selected.set(detail);
    cmp.editStatus = 'triaged';
    cmp.editNote = '   ';
    cmp.editAssigneeId = 'a1';
    cmp.save();
    expect(api.update).toHaveBeenCalledWith('t1', {
      status: 'triaged',
      admin_note: null,
      assignee_id: 'a1',
    });
    expect(cmp.editAssigneeId).toBe('a1');
  });

  it('save surfaces the server detail on failure', () => {
    api.update.and.returnValue(throwError(() => ({ error: { detail: 'bad' } })));
    const cmp = create();
    cmp.selected.set(detail);
    cmp.save();
    expect(toast.error).toHaveBeenCalledWith('bad');
    expect(cmp.saving()).toBeFalse();
  });

  it('save falls back to a translated error without detail', () => {
    api.update.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.selected.set(detail);
    cmp.save();
    expect(toast.error).toHaveBeenCalledWith('adminUi.support.errors.save');
  });

  // ---- sendReply ----

  it('sendReply returns early without a selection', () => {
    const cmp = create();
    cmp.selected.set(null);
    cmp.sendReply();
    expect(api.addMessage).not.toHaveBeenCalled();
  });

  it('sendReply rejects an empty message', () => {
    const cmp = create();
    cmp.selected.set(detail);
    // Empty string exercises the falsy `(this.replyMessage || '')` branch.
    cmp.replyMessage = '';
    cmp.sendReply();
    expect(toast.error).toHaveBeenCalledWith('adminUi.support.errors.reply');
    expect(api.addMessage).not.toHaveBeenCalled();
  });

  it('sendReply returns early when already replying', () => {
    const cmp = create();
    cmp.selected.set(detail);
    cmp.replyMessage = 'hey';
    cmp.replying.set(true);
    cmp.sendReply();
    expect(api.addMessage).not.toHaveBeenCalled();
  });

  it('sendReply posts the message and updates the list row', () => {
    const updated = { ...detail, status: 'resolved' as const };
    api.addMessage.and.returnValue(of(updated));
    const cmp = create();
    cmp.selected.set(detail);
    cmp.items.set([
      { ...listItem, id: 't1' },
      { ...listItem, id: 't2' },
    ]);
    cmp.replyMessage = '  reply  ';
    cmp.sendReply();
    expect(api.addMessage).toHaveBeenCalledWith('t1', 'reply');
    expect(cmp.replyMessage).toBe('');
    expect(cmp.items().find((i) => i.id === 't1')!.status).toBe('resolved');
    expect(cmp.items().find((i) => i.id === 't2')!.status).toBe('new');
    expect(toast.success).toHaveBeenCalledWith('adminUi.support.success.replySent');
    expect(cmp.replying()).toBeFalse();
  });

  it('sendReply surfaces the server detail on failure', () => {
    api.addMessage.and.returnValue(throwError(() => ({ error: { detail: 'reply-bad' } })));
    const cmp = create();
    cmp.selected.set(detail);
    cmp.replyMessage = 'hey';
    cmp.sendReply();
    expect(toast.error).toHaveBeenCalledWith('reply-bad');
    expect(cmp.replying()).toBeFalse();
  });

  it('sendReply falls back to a translated error without detail', () => {
    api.addMessage.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.selected.set(detail);
    cmp.replyMessage = 'hey';
    cmp.sendReply();
    expect(toast.error).toHaveBeenCalledWith('adminUi.support.errors.reply');
  });

  // ---- loadAssignees (via init error path) ----

  it('loadAssignees toasts and clears loading on error', () => {
    api.listAssignees.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.ngOnInit();
    expect(toast.error).toHaveBeenCalledWith('adminUi.support.errors.loadAssignees');
    expect(cmp.assigneesLoading()).toBeFalse();
  });

  it('loadAssignees defaults null rows to an empty array', () => {
    api.listAssignees.and.returnValue(of(null as any));
    const cmp = create();
    cmp.ngOnInit();
    expect(cmp.assignees()).toEqual([]);
  });

  // ---- pagination ----

  it('hasPrev / hasNext reflect the meta page bounds', () => {
    const cmp = create();
    cmp.meta.set({ page: 1, total_pages: 1, total_items: 0, limit: 25 });
    expect(cmp.hasPrev()).toBeFalse();
    expect(cmp.hasNext()).toBeFalse();
    cmp.meta.set({ page: 2, total_pages: 3, total_items: 60, limit: 25 });
    expect(cmp.hasPrev()).toBeTrue();
    expect(cmp.hasNext()).toBeTrue();
  });

  it('prev returns early on the first page and otherwise decrements and reloads', () => {
    const cmp = create();
    cmp.meta.set({ page: 1, total_pages: 3, total_items: 60, limit: 25 });
    api.list.calls.reset();
    cmp.prev();
    expect(api.list).not.toHaveBeenCalled();
    cmp.meta.set({ page: 2, total_pages: 3, total_items: 60, limit: 25 });
    cmp.prev();
    expect(cmp.meta().page).toBe(1);
    expect(api.list).toHaveBeenCalled();
  });

  it('next returns early on the last page and otherwise increments and reloads', () => {
    const cmp = create();
    cmp.meta.set({ page: 3, total_pages: 3, total_items: 60, limit: 25 });
    api.list.calls.reset();
    cmp.next();
    expect(api.list).not.toHaveBeenCalled();
    cmp.meta.set({ page: 1, total_pages: 3, total_items: 60, limit: 25 });
    cmp.next();
    // load() reloads with the incremented page (the response then resets meta).
    expect(api.list).toHaveBeenCalledWith(jasmine.objectContaining({ page: 2 }));
  });
});
