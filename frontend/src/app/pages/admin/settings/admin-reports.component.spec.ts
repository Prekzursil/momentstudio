import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { AdminReportsComponent } from './admin-reports.component';
import { AdminService } from '../../../core/admin.service';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Behavioural spec for the extracted Settings > Reports (weekly/monthly email)
 * panel. Mirrors the scenarios that previously lived against AdminComponent so
 * behaviour and branch coverage move with the code.
 */

describe('AdminReportsComponent', () => {
  let fixture: ComponentFixture<AdminReportsComponent>;
  let c: AdminReportsComponent;
  let admin: jasmine.SpyObj<
    Pick<
      AdminService,
      'getContent' | 'updateContentBlock' | 'createContent' | 'sendScheduledReport'
    >
  >;
  let remember: jasmine.Spy;
  let withExpected: jasmine.Spy;
  let conflict: jasmine.Spy;
  let forget: jasmine.Spy;

  beforeEach(async () => {
    admin = jasmine.createSpyObj('AdminService', [
      'getContent',
      'updateContentBlock',
      'createContent',
      'sendScheduledReport',
    ]);
    admin.getContent.and.returnValue(of({ meta: {}, version: 1 } as any));
    admin.updateContentBlock.and.returnValue(of({ version: 1 } as any));
    admin.createContent.and.returnValue(of({ version: 1 } as any));
    admin.sendScheduledReport.and.returnValue(of({ skipped: false } as any));

    await TestBed.configureTestingModule({
      imports: [AdminReportsComponent, TranslateModule.forRoot()],
      providers: [{ provide: AdminService, useValue: admin }],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminReportsComponent);
    c = fixture.componentInstance;
    remember = jasmine.createSpy('rememberContentVersion');
    withExpected = jasmine.createSpy('withExpectedVersion').and.callFake((_k: string, p: any) => p);
    conflict = jasmine.createSpy('handleContentConflict').and.returnValue(false);
    forget = jasmine.createSpy('forgetContentVersion');
    c.rememberContentVersion = remember;
    c.withExpectedVersion = withExpected as any;
    c.handleContentConflict = conflict as any;
    c.forgetContentVersion = forget;
  });

  it('creates and loads reports settings on init', () => {
    fixture.detectChanges();
    expect(c).toBeTruthy();
    expect(admin.getContent).toHaveBeenCalledWith('site.reports');
    expect(remember).toHaveBeenCalledWith('site.reports', jasmine.anything());
  });

  it('loadReportsSettings maps meta with typed/string/array values and last-sent/error', () => {
    admin.getContent.and.returnValue(
      of({
        version: 2,
        meta: {
          reports_weekly_enabled: 'yes',
          reports_weekly_weekday: '9',
          reports_weekly_hour_utc: 30,
          reports_monthly_enabled: 1,
          reports_monthly_day: -3,
          reports_monthly_hour_utc: '5',
          reports_recipients: [' A@B.C ', '', 'a@b.c'],
          reports_weekly_last_sent_period_end: '2026-01-01',
          reports_weekly_last_error: 'boom-w',
          reports_monthly_last_sent_period_end: '2026-02-01',
          reports_monthly_last_error: 'boom-m',
        },
      } as any),
    );
    c.loadReportsSettings();
    expect(c.reportsSettingsForm.weekly_enabled).toBe(true);
    expect(c.reportsSettingsForm.weekly_weekday).toBe(6); // clamped to max 6
    expect(c.reportsSettingsForm.weekly_hour_utc).toBe(23); // clamped to max 23
    expect(c.reportsSettingsForm.monthly_enabled).toBe(true);
    expect(c.reportsSettingsForm.monthly_day).toBe('1'); // clamped to min 1, stringified
    expect(c.reportsSettingsForm.monthly_hour_utc).toBe(5);
    expect(c.reportsSettingsForm.recipients).toBe('A@B.C, a@b.c');
    expect(c.reportsWeeklyLastSent).toBe('2026-01-01');
    expect(c.reportsWeeklyLastError).toBe('boom-w');
    expect(c.reportsMonthlyLastSent).toBe('2026-02-01');
    expect(c.reportsMonthlyLastError).toBe('boom-m');
  });

  it('loadReportsSettings parses a string recipients list and boolean-string falses/defaults', () => {
    admin.getContent.and.returnValue(
      of({
        version: 3,
        meta: {
          reports_weekly_enabled: 'off',
          reports_monthly_enabled: 'nope', // not in false-set -> fallback false
          reports_weekly_weekday: 'x', // NaN -> fallback 0
          reports_recipients: 'x@y.z; ;a@b.c',
        },
      } as any),
    );
    c.loadReportsSettings();
    expect(c.reportsSettingsForm.weekly_enabled).toBe(false);
    expect(c.reportsSettingsForm.monthly_enabled).toBe(false);
    expect(c.reportsSettingsForm.weekly_weekday).toBe(0);
    expect(c.reportsSettingsForm.recipients).toBe('x@y.z, a@b.c');
    expect(c.reportsWeeklyLastSent).toBeNull();
    expect(c.reportsMonthlyLastError).toBeNull();
  });

  it('loadReportsSettings handles a missing block by forgetting version and resetting', () => {
    admin.getContent.and.returnValue(of({ version: 4 } as any)); // no meta
    c.loadReportsSettings();
    expect(c.reportsSettingsForm.weekly_hour_utc).toBe(8); // fallback default

    admin.getContent.and.returnValue(throwError(() => ({})));
    c.reportsSettingsForm.weekly_enabled = true;
    c.loadReportsSettings();
    expect(forget).toHaveBeenCalledWith('site.reports');
    expect(c.reportsSettingsForm.weekly_enabled).toBe(false);
    expect(c.reportsSettingsMeta).toEqual({});
  });

  it('saveReportsSettings persists valid recipients, defaults, and remembers version', () => {
    c.reportsSettingsForm = {
      weekly_enabled: true,
      weekly_weekday: 9, // clamped to 6
      weekly_hour_utc: 30, // clamped to 23
      monthly_enabled: true,
      monthly_day: '40', // clamped to 28
      monthly_hour_utc: 5,
      recipients: 'good@x.io, bad-email, GOOD@x.io',
    };
    admin.updateContentBlock.and.returnValue(of({ version: 5, meta: { a: 1 } } as any));
    c.saveReportsSettings();
    const payload = withExpected.calls.mostRecent().args[1];
    expect(payload.meta.reports_weekly_weekday).toBe(6);
    expect(payload.meta.reports_weekly_hour_utc).toBe(23);
    expect(payload.meta.reports_monthly_day).toBe(28);
    expect(payload.meta.reports_recipients).toEqual(['good@x.io']); // deduped, lowercased, valid only
    expect(payload.meta.reports_top_products_limit).toBe(5);
    expect(payload.meta.reports_low_stock_limit).toBe(20);
    expect(payload.meta.reports_retry_cooldown_minutes).toBe(60);
    expect(remember).toHaveBeenCalledWith('site.reports', jasmine.objectContaining({ version: 5 }));
    expect(c.reportsSettingsMeta).toEqual({ a: 1 });
    expect(c.reportsSettingsMessage).toBe('adminUi.reports.success.save');
  });

  it('saveReportsSettings drops recipients when none valid and keeps preset limits', () => {
    c.reportsSettingsMeta = {
      reports_top_products_limit: 9,
      reports_low_stock_limit: 9,
      reports_retry_cooldown_minutes: 9,
    };
    c.reportsSettingsForm = {
      weekly_enabled: false,
      weekly_weekday: 0,
      weekly_hour_utc: 8,
      monthly_enabled: false,
      monthly_day: 'not-a-number', // NaN -> 1
      monthly_hour_utc: 8,
      recipients: 'bad, also-bad',
    };
    admin.updateContentBlock.and.returnValue(of({ version: 6 } as any));
    c.saveReportsSettings();
    const payload = withExpected.calls.mostRecent().args[1];
    expect('reports_recipients' in payload.meta).toBe(false);
    expect(payload.meta.reports_monthly_day).toBe(1);
    expect(payload.meta.reports_top_products_limit).toBe(9); // preset preserved
    // onSuccess with no block.meta falls back to the built meta
    expect(c.reportsSettingsMeta['reports_weekly_enabled']).toBe(false);
  });

  it('saveReportsSettings surfaces a conflict without falling back to create', () => {
    conflict.and.returnValue(true);
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    c.saveReportsSettings();
    expect(conflict).toHaveBeenCalled();
    expect(admin.createContent).not.toHaveBeenCalled();
    expect(c.reportsSettingsError).toBe('adminUi.reports.errors.save');
    expect(c.reportsSettingsMessage).toBeNull();
  });

  it('saveReportsSettings falls back to create on non-conflict error, success then failure', () => {
    conflict.and.returnValue(false);
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 404 })));
    admin.createContent.and.returnValue(of({ version: 7 } as any));
    c.saveReportsSettings();
    expect(admin.createContent).toHaveBeenCalledWith('site.reports', jasmine.anything());
    expect(c.reportsSettingsMessage).toBe('adminUi.reports.success.save');

    admin.createContent.and.returnValue(throwError(() => ({})));
    c.saveReportsSettings();
    expect(c.reportsSettingsError).toBe('adminUi.reports.errors.save');
    expect(c.reportsSettingsMessage).toBeNull();
  });

  it('sendReportNow sends, skips, guards re-entry, and reports errors', () => {
    // a successful send reloads settings, which would clear the success message
    spyOn(c, 'loadReportsSettings').and.stub();
    admin.sendScheduledReport.and.returnValue(of({ skipped: false } as any));
    c.sendReportNow('weekly');
    expect(admin.sendScheduledReport).toHaveBeenCalledWith({ kind: 'weekly', force: false });
    expect(c.reportsSettingsMessage).toBe('adminUi.reports.success.sent');
    expect(c.reportsSending).toBe(false);

    admin.sendScheduledReport.and.returnValue(of({ skipped: true } as any));
    c.sendReportNow('monthly');
    expect(c.reportsSettingsMessage).toBe('adminUi.reports.success.skipped');

    // guard: while sending, a second call is ignored
    admin.sendScheduledReport.calls.reset();
    c.reportsSending = true;
    c.sendReportNow('weekly');
    expect(admin.sendScheduledReport).not.toHaveBeenCalled();
    c.reportsSending = false;

    admin.sendScheduledReport.and.returnValue(throwError(() => ({})));
    c.sendReportNow('weekly', true);
    expect(admin.sendScheduledReport).toHaveBeenCalledWith({ kind: 'weekly', force: true });
    expect(c.reportsSettingsError).toBe('adminUi.reports.errors.send');
    expect(c.reportsSending).toBe(false);
  });
});
