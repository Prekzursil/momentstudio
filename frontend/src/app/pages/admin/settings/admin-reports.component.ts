import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AdminService } from '../../../core/admin.service';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';

/**
 * Settings > Reports (weekly/monthly scheduled email) panel, extracted
 * (behaviour-preserving) from the monolithic AdminComponent. Owns the reports
 * schedule form + last-sent/last-error status and the load/save (conflict-aware,
 * with a 404 create fallback) and send-now behaviour. The shared CMS
 * content-version bookkeeping stays on the parent AdminComponent and is threaded
 * in through the callback inputs so all CMS panels keep sharing one
 * `contentVersions` map; `forgetContentVersion` drops the cached version when the
 * `site.reports` block is missing.
 */
@Component({
  selector: 'app-admin-reports',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, TranslateModule, ButtonComponent, InputComponent],
  template: `
    <section
      class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
            {{ 'adminUi.reports.title' | translate }}
          </h2>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ 'adminUi.reports.hint' | translate }}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <app-button
            size="sm"
            variant="ghost"
            [label]="'adminUi.reports.weekly.sendNow' | translate"
            [disabled]="reportsSending"
            (action)="sendReportNow('weekly')"
          ></app-button>
          <app-button
            size="sm"
            variant="ghost"
            [label]="'adminUi.reports.monthly.sendNow' | translate"
            [disabled]="reportsSending"
            (action)="sendReportNow('monthly')"
          ></app-button>
          <app-button
            size="sm"
            [label]="'adminUi.actions.save' | translate"
            [disabled]="reportsSending"
            (action)="saveReportsSettings()"
          ></app-button>
        </div>
      </div>

      <div class="grid lg:grid-cols-2 gap-4">
        <div
          class="rounded-xl border border-slate-200 bg-slate-50 p-3 grid gap-3 dark:border-slate-800 dark:bg-slate-950/30"
        >
          <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
            {{ 'adminUi.reports.weekly.title' | translate }}
          </div>
          <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" [(ngModel)]="reportsSettingsForm.weekly_enabled" />
            <span>{{ 'adminUi.reports.weekly.enabled' | translate }}</span>
          </label>
          <div class="grid md:grid-cols-2 gap-3" *ngIf="reportsSettingsForm.weekly_enabled">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'adminUi.reports.weekly.weekday' | translate }}
              <select
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="reportsSettingsForm.weekly_weekday"
              >
                <option
                  *ngFor="let wd of reportsWeekdays"
                  class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"
                  [value]="wd.value"
                >
                  {{ wd.labelKey | translate }}
                </option>
              </select>
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'adminUi.reports.weekly.hourUtc' | translate }}
              <select
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="reportsSettingsForm.weekly_hour_utc"
              >
                <option
                  *ngFor="let h of reportsHours"
                  class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"
                  [value]="h"
                >
                  {{ (h < 10 ? '0' + h : h) + ':00' }}
                </option>
              </select>
            </label>
          </div>
          <div class="grid gap-1 text-xs text-slate-500 dark:text-slate-400">
            <div>
              {{ 'adminUi.reports.weekly.lastSent' | translate }}:
              <span *ngIf="reportsWeeklyLastSent; else weeklyNone">{{
                reportsWeeklyLastSent | date: 'medium'
              }}</span>
              <ng-template #weeklyNone>—</ng-template>
            </div>
            <div *ngIf="reportsWeeklyLastError" class="text-rose-700 dark:text-rose-300">
              {{ 'adminUi.reports.weekly.lastError' | translate }}: {{ reportsWeeklyLastError }}
            </div>
          </div>
        </div>

        <div
          class="rounded-xl border border-slate-200 bg-slate-50 p-3 grid gap-3 dark:border-slate-800 dark:bg-slate-950/30"
        >
          <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
            {{ 'adminUi.reports.monthly.title' | translate }}
          </div>
          <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" [(ngModel)]="reportsSettingsForm.monthly_enabled" />
            <span>{{ 'adminUi.reports.monthly.enabled' | translate }}</span>
          </label>
          <div class="grid md:grid-cols-2 gap-3" *ngIf="reportsSettingsForm.monthly_enabled">
            <app-input
              [label]="'adminUi.reports.monthly.day' | translate"
              type="number"
              [min]="1"
              [max]="28"
              [step]="1"
              placeholder="1"
              [(value)]="reportsSettingsForm.monthly_day"
            ></app-input>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'adminUi.reports.monthly.hourUtc' | translate }}
              <select
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="reportsSettingsForm.monthly_hour_utc"
              >
                <option
                  *ngFor="let h of reportsHours"
                  class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"
                  [value]="h"
                >
                  {{ (h < 10 ? '0' + h : h) + ':00' }}
                </option>
              </select>
            </label>
          </div>
          <div class="grid gap-1 text-xs text-slate-500 dark:text-slate-400">
            <div>
              {{ 'adminUi.reports.monthly.lastSent' | translate }}:
              <span *ngIf="reportsMonthlyLastSent; else monthlyNone">{{
                reportsMonthlyLastSent | date: 'medium'
              }}</span>
              <ng-template #monthlyNone>—</ng-template>
            </div>
            <div *ngIf="reportsMonthlyLastError" class="text-rose-700 dark:text-rose-300">
              {{ 'adminUi.reports.monthly.lastError' | translate }}:
              {{ reportsMonthlyLastError }}
            </div>
          </div>
        </div>
      </div>

      <div class="grid gap-2 text-sm">
        <app-input
          [label]="'adminUi.reports.recipients' | translate"
          [placeholder]="'adminUi.reports.recipientsPlaceholder' | translate"
          [(value)]="reportsSettingsForm.recipients"
        ></app-input>
        <div class="text-xs text-slate-500 dark:text-slate-400">
          {{ 'adminUi.reports.recipientsHint' | translate }}
        </div>
      </div>

      <div class="flex items-center gap-2 text-sm">
        <span
          class="text-xs text-emerald-700 dark:text-emerald-300"
          *ngIf="reportsSettingsMessage"
          >{{ reportsSettingsMessage }}</span
        >
        <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="reportsSettingsError">{{
          reportsSettingsError
        }}</span>
      </div>
    </section>
  `,
})
export class AdminReportsComponent implements OnInit {
  /** Shared CMS version bookkeeping, owned by the parent AdminComponent. */
  @Input({ required: true }) rememberContentVersion!: (
    key: string,
    block: { version?: number } | null | undefined,
  ) => void;
  @Input({ required: true }) withExpectedVersion!: <T extends Record<string, unknown>>(
    key: string,
    payload: T,
  ) => T & { expected_version?: number };
  @Input({ required: true }) handleContentConflict!: (
    err: any,
    key: string,
    reload: () => void,
  ) => boolean;
  @Input({ required: true }) forgetContentVersion!: (key: string) => void;

  reportsSettingsMeta: Record<string, any> = {};
  reportsSettingsForm: {
    weekly_enabled: boolean;
    weekly_weekday: number;
    weekly_hour_utc: number;
    monthly_enabled: boolean;
    monthly_day: number | string;
    monthly_hour_utc: number;
    recipients: string;
  } = {
    weekly_enabled: false,
    weekly_weekday: 0,
    weekly_hour_utc: 8,
    monthly_enabled: false,
    monthly_day: 1,
    monthly_hour_utc: 8,
    recipients: '',
  };
  reportsWeeklyLastSent: string | null = null;
  reportsWeeklyLastError: string | null = null;
  reportsMonthlyLastSent: string | null = null;
  reportsMonthlyLastError: string | null = null;
  reportsSettingsMessage: string | null = null;
  reportsSettingsError: string | null = null;
  reportsSending = false;
  readonly reportsWeekdays = [
    { value: 0, labelKey: 'adminUi.reports.weekdays.mon' },
    { value: 1, labelKey: 'adminUi.reports.weekdays.tue' },
    { value: 2, labelKey: 'adminUi.reports.weekdays.wed' },
    { value: 3, labelKey: 'adminUi.reports.weekdays.thu' },
    { value: 4, labelKey: 'adminUi.reports.weekdays.fri' },
    { value: 5, labelKey: 'adminUi.reports.weekdays.sat' },
    { value: 6, labelKey: 'adminUi.reports.weekdays.sun' },
  ];
  readonly reportsHours = Array.from({ length: 24 }, (_, hour) => hour);

  constructor(
    private readonly admin: AdminService,
    private readonly translate: TranslateService,
  ) {}

  ngOnInit(): void {
    this.loadReportsSettings();
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }

  loadReportsSettings(): void {
    this.reportsSettingsError = null;
    this.reportsSettingsMessage = null;
    this.reportsWeeklyLastSent = null;
    this.reportsWeeklyLastError = null;
    this.reportsMonthlyLastSent = null;
    this.reportsMonthlyLastError = null;
    this.admin.getContent('site.reports').subscribe({
      next: (block) => {
        this.rememberContentVersion('site.reports', block);
        const meta = (block.meta || {}) as Record<string, any>;
        this.reportsSettingsMeta = { ...meta };

        const parseBool = (value: any, fallback: boolean) => {
          if (typeof value === 'boolean') return value;
          if (typeof value === 'number') return Boolean(value);
          if (typeof value === 'string') {
            const v = value.trim().toLowerCase();
            if (['1', 'true', 'yes', 'on'].includes(v)) return true;
            if (['0', 'false', 'no', 'off'].includes(v)) return false;
          }
          return fallback;
        };

        const parseIntSafe = (value: any, fallback: number) => {
          const n = Number(value);
          return Number.isFinite(n) ? Math.trunc(n) : fallback;
        };

        this.reportsSettingsForm.weekly_enabled = parseBool(meta['reports_weekly_enabled'], false);
        this.reportsSettingsForm.weekly_weekday = Math.min(
          6,
          Math.max(0, parseIntSafe(meta['reports_weekly_weekday'], 0)),
        );
        this.reportsSettingsForm.weekly_hour_utc = Math.min(
          23,
          Math.max(0, parseIntSafe(meta['reports_weekly_hour_utc'], 8)),
        );
        this.reportsSettingsForm.monthly_enabled = parseBool(
          meta['reports_monthly_enabled'],
          false,
        );
        this.reportsSettingsForm.monthly_day = String(
          Math.min(28, Math.max(1, parseIntSafe(meta['reports_monthly_day'], 1))),
        );
        this.reportsSettingsForm.monthly_hour_utc = Math.min(
          23,
          Math.max(0, parseIntSafe(meta['reports_monthly_hour_utc'], 8)),
        );

        const rawRecipients = meta['reports_recipients'];
        let recipients: string[] = [];
        if (Array.isArray(rawRecipients)) {
          recipients = rawRecipients.map((v) => String(v || '').trim()).filter(Boolean);
        } else if (typeof rawRecipients === 'string') {
          recipients = rawRecipients
            .split(/[,;\n]+/)
            .map((v) => String(v || '').trim())
            .filter(Boolean);
        }
        this.reportsSettingsForm.recipients = recipients.join(', ');

        this.reportsWeeklyLastSent = meta['reports_weekly_last_sent_period_end']
          ? String(meta['reports_weekly_last_sent_period_end'])
          : null;
        this.reportsWeeklyLastError = meta['reports_weekly_last_error']
          ? String(meta['reports_weekly_last_error'])
          : null;
        this.reportsMonthlyLastSent = meta['reports_monthly_last_sent_period_end']
          ? String(meta['reports_monthly_last_sent_period_end'])
          : null;
        this.reportsMonthlyLastError = meta['reports_monthly_last_error']
          ? String(meta['reports_monthly_last_error'])
          : null;
      },
      error: () => {
        this.forgetContentVersion('site.reports');
        this.reportsSettingsMeta = {};
        this.reportsSettingsForm = {
          weekly_enabled: false,
          weekly_weekday: 0,
          weekly_hour_utc: 8,
          monthly_enabled: false,
          monthly_day: 1,
          monthly_hour_utc: 8,
          recipients: '',
        };
      },
    });
  }

  saveReportsSettings(): void {
    this.reportsSettingsMessage = null;
    this.reportsSettingsError = null;

    const meta: Record<string, any> = { ...this.reportsSettingsMeta };
    meta['reports_weekly_enabled'] = Boolean(this.reportsSettingsForm.weekly_enabled);
    meta['reports_weekly_weekday'] = Math.min(
      6,
      Math.max(0, Number(this.reportsSettingsForm.weekly_weekday || 0)),
    );
    meta['reports_weekly_hour_utc'] = Math.min(
      23,
      Math.max(0, Number(this.reportsSettingsForm.weekly_hour_utc || 0)),
    );
    meta['reports_monthly_enabled'] = Boolean(this.reportsSettingsForm.monthly_enabled);
    const monthlyDayRaw = Number(String(this.reportsSettingsForm.monthly_day || '').trim());
    meta['reports_monthly_day'] = Number.isFinite(monthlyDayRaw)
      ? Math.min(28, Math.max(1, Math.trunc(monthlyDayRaw)))
      : 1;
    meta['reports_monthly_hour_utc'] = Math.min(
      23,
      Math.max(0, Number(this.reportsSettingsForm.monthly_hour_utc || 0)),
    );

    const recipients = String(this.reportsSettingsForm.recipients || '')
      .split(/[,;\n]+/)
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
      .filter((email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
    const uniqueRecipients = Array.from(new Set(recipients));
    if (uniqueRecipients.length) meta['reports_recipients'] = uniqueRecipients;
    else delete meta['reports_recipients'];

    if (!('reports_top_products_limit' in meta)) meta['reports_top_products_limit'] = 5;
    if (!('reports_low_stock_limit' in meta)) meta['reports_low_stock_limit'] = 20;
    if (!('reports_retry_cooldown_minutes' in meta)) meta['reports_retry_cooldown_minutes'] = 60;

    const payload = {
      title: 'Reports settings',
      body_markdown: 'Admin scheduled email reports (weekly/monthly summaries).',
      status: 'published',
      meta,
    };

    const onSuccess = (block?: { version?: number; meta?: Record<string, any> | null } | null) => {
      this.rememberContentVersion('site.reports', block);
      this.reportsSettingsMeta = { ...(block?.meta || meta) };
      this.reportsSettingsMessage = this.t('adminUi.reports.success.save');
      this.reportsSettingsError = null;
    };

    this.admin
      .updateContentBlock('site.reports', this.withExpectedVersion('site.reports', payload))
      .subscribe({
        next: (block) => onSuccess(block),
        error: (err) => {
          if (this.handleContentConflict(err, 'site.reports', () => this.loadReportsSettings())) {
            this.reportsSettingsError = this.t('adminUi.reports.errors.save');
            this.reportsSettingsMessage = null;
            return;
          }
          this.admin.createContent('site.reports', payload).subscribe({
            next: (created) => onSuccess(created),
            error: () => {
              this.reportsSettingsError = this.t('adminUi.reports.errors.save');
              this.reportsSettingsMessage = null;
            },
          });
        },
      });
  }

  sendReportNow(kind: 'weekly' | 'monthly', force = false): void {
    if (this.reportsSending) return;
    this.reportsSending = true;
    this.reportsSettingsError = null;
    this.reportsSettingsMessage = null;
    this.admin.sendScheduledReport({ kind, force }).subscribe({
      next: (res) => {
        this.reportsSending = false;
        this.reportsSettingsMessage = res.skipped
          ? this.t('adminUi.reports.success.skipped')
          : this.t('adminUi.reports.success.sent');
        this.loadReportsSettings();
      },
      error: () => {
        this.reportsSending = false;
        this.reportsSettingsError = this.t('adminUi.reports.errors.send');
      },
    });
  }
}
