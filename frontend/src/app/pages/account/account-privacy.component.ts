import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { ButtonComponent } from '../../shared/button.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { AccountComponent } from './account.component';
import { AnalyticsService } from '../../core/analytics.service';

@Component({
  selector: 'app-account-privacy',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, ButtonComponent, SkeletonComponent],
  template: `
    <section class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'account.privacy.title' | translate }}</h2>

      <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-2">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="font-semibold text-slate-900 dark:text-slate-50">{{ 'account.privacy.export.title' | translate }}</p>
            <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'account.privacy.export.copy' | translate }}</p>
          </div>
          <app-button
            size="sm"
            variant="ghost"
            [label]="account.exportActionLabelKey() | translate"
            [disabled]="account.exportActionDisabled()"
            (action)="account.downloadMyData()"
          ></app-button>
        </div>

        <div *ngIf="account.exportJob() as job" class="grid gap-2">
          <div class="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{{ ('account.privacy.export.status.' + job.status) | translate }}</span>
            <span *ngIf="job.status === 'pending' || job.status === 'running'">{{ job.progress || 0 }}%</span>
          </div>
          <div *ngIf="job.status === 'pending' || job.status === 'running'" class="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              class="h-2 rounded-full bg-indigo-600 dark:bg-indigo-500 transition-all"
              [style.width.%]="job.progress || 0"
            ></div>
          </div>

          <p *ngIf="job.status === 'pending' || job.status === 'running'" class="text-xs text-slate-600 dark:text-slate-300">
            {{ 'account.privacy.export.notifyCopy' | translate }}
          </p>
          <p *ngIf="job.status === 'succeeded'" class="text-xs text-slate-600 dark:text-slate-300">
            {{
              job.expires_at
                ? ('account.privacy.export.readyWithExpiry' | translate: { date: account.formatTimestamp(job.expires_at) })
                : ('account.privacy.export.ready' | translate)
            }}
          </p>
          <p *ngIf="job.status === 'failed'" class="text-xs text-rose-700 dark:text-rose-300">
            {{ job.error_message || ('account.privacy.export.failedCopy' | translate) }}
          </p>
        </div>

        <p *ngIf="account.exportError" class="text-xs text-rose-700 dark:text-rose-300">{{ account.exportError }}</p>
      </div>

      <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-2">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="font-semibold text-slate-900 dark:text-slate-50">{{ 'account.privacy.analytics.title' | translate }}</p>
            <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'account.privacy.analytics.copy' | translate }}</p>
          </div>
          <label class="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" [(ngModel)]="analyticsOptIn" />
            <span>{{ 'account.privacy.analytics.toggleLabel' | translate }}</span>
          </label>
        </div>
      </div>

      <div class="rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/40 dark:bg-rose-950/30 grid gap-3">
        <div class="flex items-center justify-between">
          <p class="font-semibold text-rose-900 dark:text-rose-100">{{ 'account.privacy.deletion.title' | translate }}</p>
          <span *ngIf="account.deletionStatus()?.scheduled_for" class="text-xs text-rose-800 dark:text-rose-200">{{
            'account.privacy.deletion.scheduledBadge' | translate
          }}</span>
        </div>

        <div *ngIf="account.deletionLoading(); else deletionBody" class="grid gap-2">
          <app-skeleton height="18px" width="70%"></app-skeleton>
          <app-skeleton height="18px" width="90%"></app-skeleton>
        </div>
        <ng-template #deletionBody>
          <p class="text-sm text-rose-900 dark:text-rose-100">
            {{ 'account.privacy.deletion.copy' | translate: { hours: account.deletionStatus()?.cooldown_hours || 24 } }}
          </p>

          <div *ngIf="account.deletionStatus()?.scheduled_for; else requestDelete" class="grid gap-2">
            <p class="text-sm text-rose-900 dark:text-rose-100">
              {{
                'account.privacy.deletion.scheduledFor'
                  | translate: { date: account.formatTimestamp(account.deletionStatus()?.scheduled_for || '') }
              }}
            </p>
            <div class="grid gap-2">
              <div class="flex items-center justify-between text-xs text-rose-800 dark:text-rose-200">
                <span>
                  {{
                    'account.privacy.deletion.remaining'
                      | translate: { time: account.formatDurationShort(account.deletionCooldownRemainingMs() || 0) }
                  }}
                </span>
                <span>{{ account.deletionCooldownProgressPercent() | number: '1.0-0' }}%</span>
              </div>
              <div class="h-2 rounded-full bg-rose-200 dark:bg-rose-900/40">
                <div
                  class="h-2 rounded-full bg-rose-600 dark:bg-rose-500 transition-all"
                  [style.width.%]="account.deletionCooldownProgressPercent()"
                ></div>
              </div>
            </div>
            <div class="flex gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'account.privacy.deletion.cancelAction' | translate"
                [disabled]="account.cancellingDeletion"
                (action)="account.cancelDeletion()"
              ></app-button>
            </div>
          </div>
          <ng-template #requestDelete>
            <p class="text-sm text-rose-900 dark:text-rose-100">
              {{
                'account.privacy.deletion.confirmCopy'
                  | translate: { hours: account.deletionStatus()?.cooldown_hours || 24 }
              }}
            </p>
            <div class="grid gap-2 rounded-xl border border-rose-200 bg-white/70 p-3 dark:border-rose-900/40 dark:bg-slate-900/40">
              <p class="text-sm font-semibold text-rose-900 dark:text-rose-100">{{ 'account.privacy.deletion.consequencesTitle' | translate }}</p>
              <ul class="list-disc pl-5 text-sm text-rose-900 dark:text-rose-100 grid gap-1">
                <li>{{ 'account.privacy.deletion.consequences.logout' | translate }}</li>
                <li>{{ 'account.privacy.deletion.consequences.anonymize' | translate }}</li>
                <li>{{ 'account.privacy.deletion.consequences.noAccess' | translate }}</li>
                <li>{{ 'account.privacy.deletion.consequences.irreversible' | translate }}</li>
              </ul>
            </div>
            <div class="flex flex-col sm:flex-row gap-2">
              <input
                name="deletionConfirmText"
                [(ngModel)]="account.deletionConfirmText"
                [placeholder]="'account.privacy.deletion.confirmPlaceholder' | translate"
                [attr.aria-label]="'account.privacy.deletion.confirmAria' | translate"
                class="rounded-lg border border-rose-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-rose-900/40 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
              />
              <div class="relative">
                <input
                  name="deletionPassword"
                  [type]="showDeletionPassword ? 'text' : 'password'"
                  [(ngModel)]="account.deletionPassword"
                  autocomplete="current-password"
                  [placeholder]="'auth.password' | translate"
                  [attr.aria-label]="'account.privacy.deletion.passwordAria' | translate"
                  class="w-full rounded-lg border border-rose-200 bg-white px-3 py-2 pr-16 text-slate-900 shadow-sm dark:border-rose-900/40 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                />
                <button
                  type="button"
                  class="absolute inset-y-0 right-2 inline-flex items-center text-xs font-semibold text-slate-600 dark:text-slate-300"
                  (click)="showDeletionPassword = !showDeletionPassword"
                  [attr.aria-label]="(showDeletionPassword ? 'auth.hidePassword' : 'auth.showPassword') | translate"
                >
                  {{ (showDeletionPassword ? 'auth.hide' : 'auth.show') | translate }}
                </button>
              </div>
              <app-button
                size="sm"
                [label]="'account.privacy.deletion.requestAction' | translate"
                [disabled]="
                  account.requestingDeletion ||
                  account.deletionConfirmText.trim().toUpperCase() !== 'DELETE' ||
                  !account.deletionPassword.trim()
                "
                (action)="account.requestDeletion()"
              ></app-button>
            </div>
          </ng-template>

          <p *ngIf="account.deletionError()" class="text-xs text-rose-700 dark:text-rose-300">{{ account.deletionError() }}</p>
        </ng-template>
      </div>
    </section>
  `
})
export class AccountPrivacyComponent {
  protected readonly account = inject(AccountComponent);
  private readonly analytics = inject(AnalyticsService);
  showDeletionPassword = false;

  get analyticsOptIn(): boolean {
    return this.analytics.enabled();
  }

  set analyticsOptIn(value: boolean) {
    this.analytics.setEnabled(Boolean(value));
  }
}
