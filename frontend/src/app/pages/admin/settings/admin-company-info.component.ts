import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AdminService } from '../../../core/admin.service';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';

interface CompanyForm {
  name: string;
  registration_number: string;
  cui: string;
  address: string;
  phone: string;
  email: string;
}

/**
 * Settings > Company info panel, extracted (behaviour-preserving) from the
 * monolithic AdminComponent. Owns the company form state and its load/save
 * logic; the shared content-version bookkeeping stays on the parent and is
 * threaded in through the three callback inputs so all CMS panels keep sharing
 * one `contentVersions` map.
 */
@Component({
  selector: 'app-admin-company-info',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, TranslateModule, ButtonComponent, InputComponent],
  template: `
    <section
      class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
          {{ 'adminUi.site.company.title' | translate }}
        </h2>
        <div class="flex items-center gap-2">
          <app-button
            size="sm"
            variant="ghost"
            [label]="'adminUi.actions.refresh' | translate"
            (action)="loadCompany()"
          ></app-button>
          <app-button
            size="sm"
            [label]="'adminUi.actions.save' | translate"
            (action)="saveCompany()"
          ></app-button>
        </div>
      </div>
      <p class="text-xs text-slate-600 dark:text-slate-300">
        {{ 'adminUi.site.company.hint' | translate }}
      </p>
      <div class="grid md:grid-cols-2 gap-3 text-sm">
        <app-input
          [label]="'adminUi.site.company.fields.name' | translate"
          [(value)]="companyForm.name"
        ></app-input>
        <app-input
          [label]="'adminUi.site.company.fields.registrationNumber' | translate"
          [(value)]="companyForm.registration_number"
        ></app-input>
        <app-input
          [label]="'adminUi.site.company.fields.cui' | translate"
          [(value)]="companyForm.cui"
        ></app-input>
        <app-input
          [label]="'adminUi.site.company.fields.phone' | translate"
          [(value)]="companyForm.phone"
        ></app-input>
        <app-input
          [label]="'adminUi.site.company.fields.email' | translate"
          [(value)]="companyForm.email"
        ></app-input>
        <app-input
          [label]="'adminUi.site.company.fields.address' | translate"
          [(value)]="companyForm.address"
        ></app-input>
      </div>

      <div
        *ngIf="companyMissingFields().length"
        class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
      >
        <p class="text-xs font-semibold uppercase tracking-[0.2em]">
          {{ 'adminUi.site.company.missing.title' | translate }}
        </p>
        <ul class="mt-2 list-disc pl-5 text-xs">
          <li *ngFor="let fieldKey of companyMissingFields()">{{ fieldKey | translate }}</li>
        </ul>
      </div>

      <div class="flex items-center gap-2 text-sm">
        <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="companyMessage">{{
          companyMessage
        }}</span>
        <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="companyError">{{
          companyError
        }}</span>
      </div>
    </section>
  `,
})
export class AdminCompanyInfoComponent implements OnInit {
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

  companyForm: CompanyForm = {
    name: '',
    registration_number: '',
    cui: '',
    address: '',
    phone: '',
    email: '',
  };
  companyMessage: string | null = null;
  companyError: string | null = null;

  constructor(
    private readonly admin: AdminService,
    private readonly translate: TranslateService,
  ) {}

  ngOnInit(): void {
    this.loadCompany();
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }

  loadCompany(): void {
    this.companyError = null;
    this.companyMessage = null;
    this.admin.getContent('site.company').subscribe({
      next: (block) => {
        this.rememberContentVersion('site.company', block);
        const meta = (block.meta || {}) as Record<string, any>;
        const company = (meta['company'] || {}) as Record<string, any>;
        this.companyForm = {
          name: String(company['name'] || '').trim(),
          registration_number: String(company['registration_number'] || '').trim(),
          cui: String(company['cui'] || '').trim(),
          address: String(company['address'] || '').trim(),
          phone: String(company['phone'] || '').trim(),
          email: String(company['email'] || '').trim(),
        };
        this.companyMessage = null;
      },
      error: () => {
        this.forgetContentVersion('site.company');
        this.companyForm = {
          name: '',
          registration_number: '',
          cui: '',
          address: '',
          phone: '',
          email: '',
        };
      },
    });
  }

  companyMissingFields(): string[] {
    const missing: string[] = [];
    if (!(this.companyForm.name || '').trim()) missing.push('adminUi.site.company.fields.name');
    if (!(this.companyForm.registration_number || '').trim())
      missing.push('adminUi.site.company.fields.registrationNumber');
    if (!(this.companyForm.cui || '').trim()) missing.push('adminUi.site.company.fields.cui');
    if (!(this.companyForm.address || '').trim())
      missing.push('adminUi.site.company.fields.address');
    if (!(this.companyForm.phone || '').trim()) missing.push('adminUi.site.company.fields.phone');
    if (!(this.companyForm.email || '').trim()) missing.push('adminUi.site.company.fields.email');
    return missing;
  }

  saveCompany(): void {
    this.companyMessage = null;
    this.companyError = null;
    if (this.companyMissingFields().length) {
      this.companyError = this.t('adminUi.site.company.errors.required');
      return;
    }
    const payload = {
      title: 'Company information',
      body_markdown: 'Company identification details (used in footer).',
      status: 'published',
      meta: {
        version: 1,
        company: {
          name: (this.companyForm.name || '').trim(),
          registration_number: (this.companyForm.registration_number || '').trim(),
          cui: (this.companyForm.cui || '').trim(),
          address: (this.companyForm.address || '').trim(),
          phone: (this.companyForm.phone || '').trim(),
          email: (this.companyForm.email || '').trim(),
        },
      },
    };
    const onSuccess = (block?: { version?: number } | null) => {
      this.rememberContentVersion('site.company', block);
      this.companyMessage = this.t('adminUi.site.company.success.save');
      this.companyError = null;
    };
    this.admin
      .updateContentBlock('site.company', this.withExpectedVersion('site.company', payload))
      .subscribe({
        next: (block) => onSuccess(block),
        error: (err) => {
          if (this.handleContentConflict(err, 'site.company', () => this.loadCompany())) {
            this.companyError = this.t('adminUi.site.company.errors.save');
            this.companyMessage = null;
            return;
          }
          this.admin.createContent('site.company', payload).subscribe({
            next: (created) => onSuccess(created),
            error: () => {
              this.companyError = this.t('adminUi.site.company.errors.save');
              this.companyMessage = null;
            },
          });
        },
      });
  }
}
