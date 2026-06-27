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

function listItem(over: Partial<AdminContactSubmissionListItem> = {}): AdminContactSubmissionListItem {
  return {
    id: 'row-1',
    topic: 'support',
    status: 'new',
    name: 'Alice',
    email: 'alice@example.com',
    order_reference: 'ORD-1',
    assignee: null,
    created_at: '2026-02-01T00:00:00Z',
    ...over,
  };
}

function detail(over: Partial<AdminContactSubmissionRead> = {}): AdminContactSubmissionRead {
  return {
    id: 'row-1',
    topic: 'support',
    status: 'new',
    name: 'Alice',
    email: 'alice@example.com',
    message: 'Hello',
    order_reference: 'ORD-1',
    admin_note: 'note',
    assignee: { id: 'agent-1', username: 'agent', name: 'Agent', name_tag: 1, role: 'support' },
    messages: [],
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    ...over,
  };
}

function canned(over: Partial<SupportCannedResponseRead> = {}): SupportCannedResponseRead {
  return {
    id: 'tpl-1',
    title: 'Greeting',
    body_en: 'Hello {{ customer_name }}',
    body_ro: 'Salut {{ customer_name }}',
    is_active: true,
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    ...over,
  };
}

describe('AdminSupportComponent', () => {
  let api: jasmine.SpyObj<AdminSupportService>;
  let auth: jasmine.SpyObj<AuthService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: jasmine.SpyObj<Router>;
  let routeTicket: string | null;

  beforeEach(async () => {
    routeTicket = null;
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

    api.list.and.returnValue(
      of({ items: [], meta: { page: 1, total_pages: 1, total_items: 0, limit: 25 } }),
    );
    api.listAssignees.and.returnValue(of([]));
    api.getSlaSettings.and.returnValue(of({ first_reply_hours: 24, resolution_hours: 72 }));
    api.listCannedResponses.and.returnValue(of([]));
    api.getOne.and.returnValue(of(detail()));
    api.update.and.returnValue(of(detail()));
    api.addMessage.and.returnValue(of(detail()));
    api.createCannedResponse.and.returnValue(of(canned()));
    api.updateCannedResponse.and.returnValue(of(canned()));
    api.deleteCannedResponse.and.returnValue(of({}));
    api.updateSlaSettings.and.returnValue(of({ first_reply_hours: 24, resolution_hours: 72 }));
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
          useValue: {
            snapshot: { queryParamMap: { get: (_k: string) => routeTicket } },
            // openTicket(pushUrl) uses relativeTo: this.route
          },
        },
      ],
    }).compileComponents();
  });

  function make(): AdminSupportComponent {
    return TestBed.createComponent(AdminSupportComponent).componentInstance;
  }

  it('renders the template and runs ngOnInit (en lang, no ticket param)', () => {
    const fixture = TestBed.createComponent(AdminSupportComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    expect(api.list).toHaveBeenCalled();
    expect(api.listAssignees).toHaveBeenCalled();
    expect(api.getSlaSettings).toHaveBeenCalled();
    expect(api.listCannedResponses).toHaveBeenCalled();
    expect(cmp.cannedLang).toBe('en');
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('adminUi.support.title');
  });

  it('defaults canned language to ro when current language is ro and opens ticket from query param', () => {
    const translate = TestBed.inject(TranslateService);
    spyOnProperty(translate, 'currentLang', 'get').and.returnValue('ro');
    routeTicket = 'row-1';
    const cmp = make();
    cmp.ngOnInit();
    expect(cmp.cannedLang).toBe('ro');
    expect(api.getOne).toHaveBeenCalledWith('row-1');
    // pushUrl false path -> router.navigate NOT called from openTicket
    expect(router.navigate).not.toHaveBeenCalled();
    expect(cmp.selected()).toBeTruthy();
  });

  it('applyFilters resets to page 1 and reloads', () => {
    const cmp = make();
    cmp.meta.set({ page: 5, total_pages: 9, total_items: 100, limit: 25 });
    cmp.applyFilters();
    expect(cmp.meta().page).toBe(1);
    expect(api.list).toHaveBeenCalled();
  });

  it('retryLoad triggers a reload', () => {
    const cmp = make();
    api.list.calls.reset();
    cmp.retryLoad();
    expect(api.list).toHaveBeenCalled();
  });

  it('canEditSlaSettings reflects owner, admin, and other roles', () => {
    const cmp = make();
    auth.role.and.returnValue('owner');
    expect(cmp.canEditSlaSettings()).toBeTrue();
    auth.role.and.returnValue('admin');
    expect(cmp.canEditSlaSettings()).toBeTrue();
    auth.role.and.returnValue('support');
    expect(cmp.canEditSlaSettings()).toBeFalse();
  });

  it('loadSlaSettings applies finite values and truncates', () => {
    api.getSlaSettings.and.returnValue(of({ first_reply_hours: 12.9, resolution_hours: 48.7 }));
    const cmp = make();
    cmp.loadSlaSettings();
    expect(cmp.slaFirstReplyHours).toBe(12);
    expect(cmp.slaResolutionHours).toBe(48);
    expect(cmp.slaFirstReplyHoursDraft).toBe(12);
    expect(cmp.slaResolutionHoursDraft).toBe(48);
  });

  it('loadSlaSettings falls back to defaults for non-finite values', () => {
    api.getSlaSettings.and.returnValue(
      of({ first_reply_hours: NaN as any, resolution_hours: NaN as any }),
    );
    const cmp = make();
    cmp.slaFirstReplyHours = 1;
    cmp.slaResolutionHours = 1;
    cmp.loadSlaSettings();
    expect(cmp.slaFirstReplyHours).toBe(24);
    expect(cmp.slaResolutionHours).toBe(72);
  });

  it('loadSlaSettings keeps defaults on error', () => {
    api.getSlaSettings.and.returnValue(throwError(() => new Error('boom')));
    const cmp = make();
    cmp.slaFirstReplyHours = 30;
    cmp.loadSlaSettings();
    expect(cmp.slaFirstReplyHours).toBe(30);
  });

  it('saveSlaSettings returns early when already saving', () => {
    const cmp = make();
    cmp.slaSettingsSaving = true;
    cmp.saveSlaSettings();
    expect(api.updateSlaSettings).not.toHaveBeenCalled();
  });

  it('saveSlaSettings rejects out-of-range and non-finite drafts', () => {
    const cmp = make();
    cmp.slaFirstReplyHoursDraft = 0;
    cmp.slaResolutionHoursDraft = 72;
    cmp.saveSlaSettings();
    expect(cmp.slaSettingsError).toBeTruthy();
    expect(api.updateSlaSettings).not.toHaveBeenCalled();

    cmp.slaFirstReplyHoursDraft = 'abc';
    cmp.slaResolutionHoursDraft = 'xyz';
    cmp.saveSlaSettings();
    expect(api.updateSlaSettings).not.toHaveBeenCalled();
  });

  it('saveSlaSettings persists valid drafts with finite response values', () => {
    api.updateSlaSettings.and.returnValue(of({ first_reply_hours: 10.6, resolution_hours: 50.2 }));
    const cmp = make();
    cmp.slaFirstReplyHoursDraft = 10;
    cmp.slaResolutionHoursDraft = 50;
    cmp.saveSlaSettings();
    expect(cmp.slaSettingsSaving).toBeFalse();
    expect(cmp.slaFirstReplyHours).toBe(10);
    expect(cmp.slaResolutionHours).toBe(50);
    expect(cmp.slaSettingsMessage).toBeTruthy();
    expect(cmp.slaSettingsError).toBeNull();
  });

  it('saveSlaSettings falls back to submitted values when response is non-finite', () => {
    api.updateSlaSettings.and.returnValue(
      of({ first_reply_hours: NaN as any, resolution_hours: NaN as any }),
    );
    const cmp = make();
    cmp.slaFirstReplyHoursDraft = 20;
    cmp.slaResolutionHoursDraft = 60;
    cmp.saveSlaSettings();
    expect(cmp.slaFirstReplyHours).toBe(20);
    expect(cmp.slaResolutionHours).toBe(60);
  });

  it('saveSlaSettings sets an error message on failure', () => {
    api.updateSlaSettings.and.returnValue(throwError(() => new Error('nope')));
    const cmp = make();
    cmp.slaFirstReplyHoursDraft = 20;
    cmp.slaResolutionHoursDraft = 60;
    cmp.saveSlaSettings();
    expect(cmp.slaSettingsSaving).toBeFalse();
    expect(cmp.slaSettingsError).toBeTruthy();
    expect(cmp.slaSettingsMessage).toBeNull();
  });

  it('slaInfo returns null for invalid date and resolved rows', () => {
    const cmp = make();
    expect(cmp.slaInfo(listItem({ created_at: 'not-a-date' }))).toBeNull();
    expect(cmp.slaInfo(listItem({ status: 'resolved' }))).toBeNull();
  });

  it('slaInfo marks overdue replies (rose) with day+hour duration', () => {
    const cmp = make();
    cmp.slaFirstReplyHours = 24;
    const created = new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString();
    const info = cmp.slaInfo(listItem({ status: 'new', created_at: created }));
    expect(info).toBeTruthy();
    expect(info!.class).toContain('rose');
    expect(info!.label).toContain('adminUi.support.sla.overdue');
  });

  it('slaInfo marks overdue replies with hour-only duration', () => {
    const cmp = make();
    cmp.slaFirstReplyHours = 24;
    const created = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const info = cmp.slaInfo(listItem({ status: 'new', created_at: created }));
    expect(info!.class).toContain('rose');
  });

  it('slaInfo marks due-soon replies (amber) with minute-only duration', () => {
    const cmp = make();
    cmp.slaFirstReplyHours = 24;
    const created = new Date(Date.now() - 23.5 * 60 * 60 * 1000).toISOString();
    const info = cmp.slaInfo(listItem({ status: 'new', created_at: created }));
    expect(info!.class).toContain('amber');
    expect(info!.label).toContain('adminUi.support.sla.due');
  });

  it('slaInfo marks resolution due far out (slate) for triaged rows', () => {
    const cmp = make();
    cmp.slaResolutionHours = 72;
    const created = new Date(Date.now()).toISOString();
    const info = cmp.slaInfo(listItem({ status: 'triaged', created_at: created }));
    expect(info!.class).toContain('slate');
    expect(info!.label).toContain('adminUi.support.sla.resolve');
  });

  it('formatAgent renders username with name/tag, bare username, dash, and handles null', () => {
    const cmp = make();
    expect(
      cmp.formatAgent({ id: 'a', username: 'jdoe', name: 'John', name_tag: 7, role: 'support' }),
    ).toBe('jdoe (John#7)');
    expect(
      cmp.formatAgent({ id: 'b', username: 'jane', name: '', name_tag: null, role: 'support' }),
    ).toBe('jane');
    expect(
      cmp.formatAgent({ id: 'c', username: '', name: '', name_tag: 3, role: 'support' }),
    ).toBe('—');
    expect(cmp.formatAgent(null as unknown as SupportAgentRef)).toBe('—');
  });

  it('activeCannedResponses filters out falsy and inactive entries', () => {
    const cmp = make();
    cmp.cannedResponses.set([
      null as unknown as SupportCannedResponseRead,
      canned({ id: 'a', is_active: true }),
      canned({ id: 'b', is_active: false }),
    ]);
    const active = cmp.activeCannedResponses();
    expect(active.length).toBe(1);
    expect(active[0].id).toBe('a');
  });

  it('toggleTemplates flips the showTemplates signal', () => {
    const cmp = make();
    expect(cmp.showTemplates()).toBeFalse();
    cmp.toggleTemplates();
    expect(cmp.showTemplates()).toBeTrue();
  });

  it('loadCanned sets responses, handles null rows, error, and early return when loading', () => {
    const cmp = make();
    api.listCannedResponses.and.returnValue(of([canned()]));
    cmp.loadCanned();
    expect(cmp.cannedResponses().length).toBe(1);
    expect(cmp.cannedLoading()).toBeFalse();

    api.listCannedResponses.and.returnValue(of(null as unknown as SupportCannedResponseRead[]));
    cmp.loadCanned();
    expect(cmp.cannedResponses().length).toBe(0);

    api.listCannedResponses.and.returnValue(throwError(() => new Error('x')));
    cmp.loadCanned();
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.cannedLoading()).toBeFalse();

    api.listCannedResponses.calls.reset();
    cmp.cannedLoading.set(true);
    cmp.loadCanned();
    expect(api.listCannedResponses).not.toHaveBeenCalled();
  });

  it('startNewTemplate resets the form for creation', () => {
    const cmp = make();
    cmp.templateEditingId = 'old';
    cmp.startNewTemplate();
    expect(cmp.templateEditingId).toBeNull();
    expect(cmp.templateTitle).toBe('');
    expect(cmp.templateActive).toBeTrue();
    expect(cmp.templateFormOpen()).toBeTrue();
  });

  it('editTemplate loads values, including empty fallbacks', () => {
    const cmp = make();
    cmp.editTemplate(canned({ id: 'e1', title: 'T', body_en: 'E', body_ro: 'R', is_active: true }));
    expect(cmp.templateEditingId).toBe('e1');
    expect(cmp.templateTitle).toBe('T');
    expect(cmp.templateActive).toBeTrue();

    cmp.editTemplate({
      id: 'e2',
      title: null as unknown as string,
      body_en: null as unknown as string,
      body_ro: null as unknown as string,
      is_active: false,
    } as SupportCannedResponseRead);
    expect(cmp.templateTitle).toBe('');
    expect(cmp.templateBodyEn).toBe('');
    expect(cmp.templateActive).toBeFalse();
  });

  it('cancelTemplateEdit closes the form', () => {
    const cmp = make();
    cmp.templateFormOpen.set(true);
    cmp.templateEditingId = 'x';
    cmp.cancelTemplateEdit();
    expect(cmp.templateFormOpen()).toBeFalse();
    expect(cmp.templateEditingId).toBeNull();
  });

  it('saveTemplate validates required fields (missing title, body_en, body_ro)', () => {
    const cmp = make();
    cmp.templateTitle = '';
    cmp.templateBodyEn = 'en';
    cmp.templateBodyRo = 'ro';
    cmp.saveTemplate();
    expect(toast.error).toHaveBeenCalled();
    expect(api.createCannedResponse).not.toHaveBeenCalled();

    cmp.templateTitle = 'T';
    cmp.templateBodyEn = '';
    cmp.templateBodyRo = 'ro';
    cmp.saveTemplate();
    expect(api.createCannedResponse).not.toHaveBeenCalled();

    cmp.templateTitle = 'T';
    cmp.templateBodyEn = 'en';
    cmp.templateBodyRo = '';
    cmp.saveTemplate();
    expect(api.createCannedResponse).not.toHaveBeenCalled();
  });

  it('saveTemplate returns early when already saving', () => {
    const cmp = make();
    cmp.templateTitle = 'T';
    cmp.templateBodyEn = 'E';
    cmp.templateBodyRo = 'R';
    cmp.templateSaving.set(true);
    cmp.saveTemplate();
    expect(api.createCannedResponse).not.toHaveBeenCalled();
  });

  it('saveTemplate creates a new template on success', () => {
    const cmp = make();
    cmp.templateEditingId = null;
    cmp.templateTitle = 'T';
    cmp.templateBodyEn = 'E';
    cmp.templateBodyRo = 'R';
    cmp.templateActive = true;
    cmp.saveTemplate();
    expect(api.createCannedResponse).toHaveBeenCalled();
    expect(cmp.templateSaving()).toBeFalse();
    expect(cmp.templateFormOpen()).toBeFalse();
    expect(toast.success).toHaveBeenCalled();
  });

  it('saveTemplate updates an existing template on success', () => {
    const cmp = make();
    cmp.templateEditingId = 'tpl-1';
    cmp.templateTitle = 'T';
    cmp.templateBodyEn = 'E';
    cmp.templateBodyRo = 'R';
    cmp.saveTemplate();
    expect(api.updateCannedResponse).toHaveBeenCalledWith('tpl-1', jasmine.any(Object));
    expect(toast.success).toHaveBeenCalled();
  });

  it('saveTemplate surfaces backend detail on create failure', () => {
    api.createCannedResponse.and.returnValue(
      throwError(() => ({ error: { detail: 'boom-detail' } })),
    );
    const cmp = make();
    cmp.templateEditingId = null;
    cmp.templateTitle = 'T';
    cmp.templateBodyEn = 'E';
    cmp.templateBodyRo = 'R';
    cmp.saveTemplate();
    expect(toast.error).toHaveBeenCalledWith('boom-detail');
    expect(cmp.templateSaving()).toBeFalse();
  });

  it('saveTemplate falls back to a generic message on update failure', () => {
    api.updateCannedResponse.and.returnValue(throwError(() => ({})));
    const cmp = make();
    cmp.templateEditingId = 'tpl-1';
    cmp.templateTitle = 'T';
    cmp.templateBodyEn = 'E';
    cmp.templateBodyRo = 'R';
    cmp.saveTemplate();
    expect(toast.error).toHaveBeenCalled();
  });

  it('toggleTemplateActive updates the matching row on success', () => {
    const cmp = make();
    cmp.cannedResponses.set([canned({ id: 'tpl-1', is_active: true }), canned({ id: 'tpl-2' })]);
    api.updateCannedResponse.and.returnValue(of(canned({ id: 'tpl-1', is_active: false })));
    cmp.toggleTemplateActive(canned({ id: 'tpl-1', is_active: true }));
    expect(api.updateCannedResponse).toHaveBeenCalledWith('tpl-1', { is_active: false });
    expect(cmp.cannedResponses().find((r) => r.id === 'tpl-1')!.is_active).toBeFalse();
  });

  it('toggleTemplateActive shows a toast on error', () => {
    api.updateCannedResponse.and.returnValue(throwError(() => new Error('x')));
    const cmp = make();
    cmp.toggleTemplateActive(canned({ id: 'tpl-1', is_active: true }));
    expect(toast.error).toHaveBeenCalled();
  });

  it('deleteTemplate aborts when not confirmed', () => {
    spyOn(window, 'confirm').and.returnValue(false);
    const cmp = make();
    cmp.deleteTemplate(canned());
    expect(api.deleteCannedResponse).not.toHaveBeenCalled();
  });

  it('deleteTemplate removes the row and cancels edit when editing it', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    const cmp = make();
    cmp.cannedResponses.set([canned({ id: 'tpl-1' }), canned({ id: 'tpl-2' })]);
    cmp.templateEditingId = 'tpl-1';
    cmp.templateFormOpen.set(true);
    cmp.deleteTemplate(canned({ id: 'tpl-1' }));
    expect(cmp.cannedResponses().some((r) => r.id === 'tpl-1')).toBeFalse();
    expect(cmp.templateFormOpen()).toBeFalse();
    expect(toast.success).toHaveBeenCalled();
  });

  it('deleteTemplate removes the row without touching an unrelated edit', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    const cmp = make();
    cmp.cannedResponses.set([canned({ id: 'tpl-1' }), canned({ id: 'tpl-2' })]);
    cmp.templateEditingId = 'tpl-2';
    cmp.deleteTemplate(canned({ id: 'tpl-1' }));
    expect(cmp.templateEditingId).toBe('tpl-2');
  });

  it('deleteTemplate shows a toast on error', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    api.deleteCannedResponse.and.returnValue(throwError(() => new Error('x')));
    const cmp = make();
    cmp.deleteTemplate(canned());
    expect(toast.error).toHaveBeenCalled();
  });

  it('insertCanned returns when nothing is selected', () => {
    const cmp = make();
    cmp.selected.set(null);
    cmp.insertCanned();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('insertCanned returns when no template matches the selection', () => {
    const cmp = make();
    cmp.selected.set(detail());
    cmp.cannedResponses.set([canned({ id: 'tpl-1' })]);
    cmp.cannedSelectedId = 'missing';
    cmp.insertCanned();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('insertCanned returns when the rendered body is empty', () => {
    const cmp = make();
    cmp.selected.set(detail());
    cmp.cannedResponses.set([canned({ id: 'tpl-1', body_en: '' })]);
    cmp.cannedSelectedId = 'tpl-1';
    cmp.cannedLang = 'en';
    cmp.insertCanned();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('insertCanned appends rendered ro body to existing reply text', () => {
    const cmp = make();
    cmp.selected.set(detail({ name: 'Bob', email: 'bob@x.com', order_reference: 'O9', id: 'T7' }));
    cmp.cannedResponses.set([canned({ id: 'tpl-1', body_ro: 'Salut Bob' })]);
    cmp.cannedSelectedId = 'tpl-1';
    cmp.cannedLang = 'ro';
    cmp.replyMessage = 'Existing';
    cmp.insertCanned();
    expect(cmp.replyMessage).toContain('Existing');
    expect(cmp.replyMessage).toContain('Salut Bob');
    expect(toast.success).toHaveBeenCalled();
  });

  it('insertCanned sets the reply when there is no existing text and ticket fields are null', () => {
    const cmp = make();
    cmp.selected.set(
      detail({ name: null as unknown as string, email: null as unknown as string, order_reference: null, id: null as unknown as string }),
    );
    cmp.cannedResponses.set([canned({ id: 'tpl-1', body_en: 'Plain body' })]);
    cmp.cannedSelectedId = 'tpl-1';
    cmp.cannedLang = 'en';
    cmp.replyMessage = '';
    cmp.insertCanned();
    expect(cmp.replyMessage).toBe('Plain body');
  });

  it('loadAssignees populates the list and handles null and error', () => {
    api.listAssignees.and.returnValue(
      of([{ id: 'a', username: 'u', name: 'n', name_tag: 1, role: 'support' }]),
    );
    const cmp = make();
    cmp.ngOnInit();
    expect(cmp.assignees().length).toBe(1);
    expect(cmp.assigneesLoading()).toBeFalse();

    api.listAssignees.and.returnValue(of(null as unknown as SupportAgentRef[]));
    cmp.ngOnInit();
    expect(cmp.assignees().length).toBe(0);

    api.listAssignees.and.returnValue(throwError(() => new Error('x')));
    cmp.ngOnInit();
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.assigneesLoading()).toBeFalse();
  });

  it('load passes trimmed filters and handles success', () => {
    const cmp = make();
    cmp.q = '  hi  ';
    cmp.channel = 'refund';
    cmp.status = 'triaged';
    cmp.customerFilter = '  cust  ';
    cmp.assigneeFilter = 'agent-1';
    api.list.and.returnValue(
      of({
        items: [listItem()],
        meta: { page: 2, total_pages: 3, total_items: 50, limit: 25 },
      }),
    );
    cmp.applyFilters();
    expect(api.list).toHaveBeenCalledWith(
      jasmine.objectContaining({
        q: 'hi',
        channel_filter: 'refund',
        status_filter: 'triaged',
        customer_filter: 'cust',
        assignee_filter: 'agent-1',
      }),
    );
    expect(cmp.items().length).toBe(1);
    expect(cmp.loading()).toBeFalse();
  });

  it('load surfaces an error state on failure', () => {
    api.list.and.returnValue(throwError(() => ({ message: 'down' })));
    const cmp = make();
    cmp.retryLoad();
    expect(cmp.items().length).toBe(0);
    expect(cmp.error()).toBeTruthy();
    expect(cmp.loading()).toBeFalse();
  });

  it('select opens a ticket, pushes the URL, and loads detail', () => {
    const cmp = make();
    api.getOne.and.returnValue(of(detail({ id: 'row-9', admin_note: 'n', assignee: { id: 'ag', username: 'u', name: 'N', name_tag: 2, role: 'support' } })));
    cmp.select(listItem({ id: 'row-9' }));
    expect(api.getOne).toHaveBeenCalledWith('row-9');
    expect(router.navigate).toHaveBeenCalled();
    expect(cmp.selected()!.id).toBe('row-9');
    expect(cmp.editAssigneeId).toBe('ag');
    expect(cmp.detailLoading()).toBeFalse();
  });

  it('openTicket ignores empty ids and duplicate selections', () => {
    const cmp = make();
    cmp.select(listItem({ id: '' }));
    expect(api.getOne).not.toHaveBeenCalled();
    cmp.selectedId.set('row-5');
    cmp.select(listItem({ id: 'row-5' }));
    expect(api.getOne).not.toHaveBeenCalled();
  });

  it('openTicket clears null admin_note and assignee on success', () => {
    const cmp = make();
    api.getOne.and.returnValue(of(detail({ id: 'row-3', admin_note: null, assignee: null })));
    cmp.select(listItem({ id: 'row-3' }));
    expect(cmp.editNote).toBe('');
    expect(cmp.editAssigneeId).toBe('');
  });

  it('openTicket resets state and toasts on detail error', () => {
    api.getOne.and.returnValue(throwError(() => new Error('x')));
    const cmp = make();
    cmp.select(listItem({ id: 'row-4' }));
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.selectedId()).toBe('');
    expect(cmp.selected()).toBeNull();
    expect(cmp.detailLoading()).toBeFalse();
  });

  it('save returns when nothing is selected or already saving', () => {
    const cmp = make();
    cmp.selected.set(null);
    cmp.save();
    expect(api.update).not.toHaveBeenCalled();

    cmp.selected.set(detail());
    cmp.saving.set(true);
    cmp.save();
    expect(api.update).not.toHaveBeenCalled();
  });

  it('save persists changes and updates the matching list row', () => {
    const cmp = make();
    cmp.items.set([listItem({ id: 'row-1' }), listItem({ id: 'row-2' })]);
    cmp.selected.set(detail({ id: 'row-1' }));
    cmp.editNote = '  a note ';
    cmp.editAssigneeId = 'agent-1';
    api.update.and.returnValue(
      of(detail({ id: 'row-1', status: 'triaged', admin_note: 'a note', assignee: { id: 'agent-1', username: 'u', name: 'N', name_tag: 1, role: 'support' } })),
    );
    cmp.save();
    expect(api.update).toHaveBeenCalledWith(
      'row-1',
      jasmine.objectContaining({ admin_note: 'a note', assignee_id: 'agent-1' }),
    );
    expect(cmp.items().find((i) => i.id === 'row-1')!.status).toBe('triaged');
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.saving()).toBeFalse();
  });

  it('save sends nulls for empty note/assignee and clears them from the response', () => {
    const cmp = make();
    cmp.selected.set(detail({ id: 'row-1' }));
    cmp.editNote = '   ';
    cmp.editAssigneeId = '';
    api.update.and.returnValue(of(detail({ id: 'row-1', admin_note: null, assignee: null })));
    cmp.save();
    expect(api.update).toHaveBeenCalledWith(
      'row-1',
      jasmine.objectContaining({ admin_note: null, assignee_id: null }),
    );
    expect(cmp.editNote).toBe('');
    expect(cmp.editAssigneeId).toBe('');
  });

  it('save surfaces backend detail and generic errors', () => {
    const cmp = make();
    cmp.selected.set(detail({ id: 'row-1' }));
    api.update.and.returnValue(throwError(() => ({ error: { detail: 'save-detail' } })));
    cmp.save();
    expect(toast.error).toHaveBeenCalledWith('save-detail');
    expect(cmp.saving()).toBeFalse();

    cmp.saving.set(false);
    api.update.and.returnValue(throwError(() => ({})));
    cmp.save();
    expect(toast.error).toHaveBeenCalled();
  });

  it('sendReply returns when nothing selected', () => {
    const cmp = make();
    cmp.selected.set(null);
    cmp.sendReply();
    expect(api.addMessage).not.toHaveBeenCalled();
  });

  it('sendReply rejects an empty message (whitespace and falsy)', () => {
    const cmp = make();
    cmp.selected.set(detail());
    cmp.replyMessage = '   ';
    cmp.sendReply();
    expect(toast.error).toHaveBeenCalled();
    expect(api.addMessage).not.toHaveBeenCalled();

    cmp.replyMessage = '' as unknown as string;
    cmp.sendReply();
    expect(api.addMessage).not.toHaveBeenCalled();
  });

  it('sendReply returns early when already replying', () => {
    const cmp = make();
    cmp.selected.set(detail());
    cmp.replyMessage = 'hi';
    cmp.replying.set(true);
    cmp.sendReply();
    expect(api.addMessage).not.toHaveBeenCalled();
  });

  it('sendReply posts the message and updates the matching list row', () => {
    const cmp = make();
    cmp.items.set([listItem({ id: 'row-1' }), listItem({ id: 'row-2' })]);
    cmp.selected.set(detail({ id: 'row-1' }));
    cmp.replyMessage = ' hello ';
    api.addMessage.and.returnValue(of(detail({ id: 'row-1', status: 'triaged' })));
    cmp.sendReply();
    expect(api.addMessage).toHaveBeenCalledWith('row-1', 'hello');
    expect(cmp.replyMessage).toBe('');
    expect(cmp.items().find((i) => i.id === 'row-1')!.status).toBe('triaged');
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.replying()).toBeFalse();
  });

  it('sendReply surfaces backend detail and generic errors', () => {
    const cmp = make();
    cmp.selected.set(detail({ id: 'row-1' }));
    cmp.replyMessage = 'hello';
    api.addMessage.and.returnValue(throwError(() => ({ error: { detail: 'reply-detail' } })));
    cmp.sendReply();
    expect(toast.error).toHaveBeenCalledWith('reply-detail');
    expect(cmp.replying()).toBeFalse();

    cmp.replying.set(false);
    cmp.replyMessage = 'hello';
    api.addMessage.and.returnValue(throwError(() => ({})));
    cmp.sendReply();
    expect(toast.error).toHaveBeenCalled();
  });

  it('hasPrev/hasNext reflect the pagination meta', () => {
    const cmp = make();
    cmp.meta.set({ page: 1, total_pages: 3, total_items: 60, limit: 25 });
    expect(cmp.hasPrev()).toBeFalse();
    expect(cmp.hasNext()).toBeTrue();
    cmp.meta.set({ page: 3, total_pages: 3, total_items: 60, limit: 25 });
    expect(cmp.hasPrev()).toBeTrue();
    expect(cmp.hasNext()).toBeFalse();
  });

  it('prev decrements the page or no-ops at the first page', () => {
    const cmp = make();
    cmp.meta.set({ page: 1, total_pages: 3, total_items: 60, limit: 25 });
    api.list.calls.reset();
    cmp.prev();
    expect(api.list).not.toHaveBeenCalled();

    cmp.meta.set({ page: 2, total_pages: 3, total_items: 60, limit: 25 });
    cmp.prev();
    expect(api.list).toHaveBeenCalledWith(jasmine.objectContaining({ page: 1 }));
  });

  it('next increments the page or no-ops at the last page', () => {
    const cmp = make();
    cmp.meta.set({ page: 3, total_pages: 3, total_items: 60, limit: 25 });
    api.list.calls.reset();
    cmp.next();
    expect(api.list).not.toHaveBeenCalled();

    cmp.meta.set({ page: 1, total_pages: 3, total_items: 60, limit: 25 });
    cmp.next();
    expect(api.list).toHaveBeenCalledWith(jasmine.objectContaining({ page: 2 }));
  });
});
