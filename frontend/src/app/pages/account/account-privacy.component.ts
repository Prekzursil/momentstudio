import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { ButtonComponent } from '../../shared/button.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { AccountComponent } from './account.component';

@Component({
  selector: 'app-account-privacy',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, ButtonComponent, SkeletonComponent],
  template: `
    <section class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Privacy & data</h2>

      <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-2">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="font-semibold text-slate-900 dark:text-slate-50">Download my data</p>
            <p class="text-sm text-slate-600 dark:text-slate-300">Export your profile, orders, wishlist, and blog activity as JSON.</p>
          </div>
          <app-button
            size="sm"
            variant="ghost"
            [label]="account.exportingData ? 'Downloading…' : 'Download'"
            [disabled]="account.exportingData"
            (action)="account.downloadMyData()"
          ></app-button>
        </div>
        <p *ngIf="account.exportError" class="text-xs text-rose-700 dark:text-rose-300">{{ account.exportError }}</p>
      </div>

      <div class="rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/40 dark:bg-rose-950/30 grid gap-3">
        <div class="flex items-center justify-between">
          <p class="font-semibold text-rose-900 dark:text-rose-100">Delete account</p>
          <span *ngIf="account.deletionStatus()?.scheduled_for" class="text-xs text-rose-800 dark:text-rose-200">Scheduled</span>
        </div>

        <div *ngIf="account.deletionLoading(); else deletionBody" class="grid gap-2">
          <app-skeleton height="18px" width="70%"></app-skeleton>
          <app-skeleton height="18px" width="90%"></app-skeleton>
        </div>
        <ng-template #deletionBody>
          <p class="text-sm text-rose-900 dark:text-rose-100">
            Requesting deletion schedules your account to be removed after {{ account.deletionStatus()?.cooldown_hours || 24 }} hours.
          </p>

          <div *ngIf="account.deletionStatus()?.scheduled_for; else requestDelete" class="grid gap-2">
            <p class="text-sm text-rose-900 dark:text-rose-100">
              Scheduled for {{ account.formatTimestamp(account.deletionStatus()?.scheduled_for || '') }}.
            </p>
            <div class="flex gap-2">
              <app-button
                size="sm"
                variant="ghost"
                label="Cancel deletion"
                [disabled]="account.cancellingDeletion"
                (action)="account.cancelDeletion()"
              ></app-button>
            </div>
          </div>
          <ng-template #requestDelete>
            <p class="text-sm text-rose-900 dark:text-rose-100">
              Type <span class="font-semibold">DELETE</span> to confirm. You can cancel during the {{
                account.deletionStatus()?.cooldown_hours || 24
              }}h cooldown window.
            </p>
            <div class="flex flex-col sm:flex-row gap-2">
              <input
                name="deletionConfirmText"
                [(ngModel)]="account.deletionConfirmText"
                placeholder="DELETE"
                aria-label="Confirm account deletion"
                class="rounded-lg border border-rose-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-rose-900/40 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
              />
              <div class="relative">
                <input
                  name="deletionPassword"
                  [type]="showDeletionPassword ? 'text' : 'password'"
                  [(ngModel)]="account.deletionPassword"
                  autocomplete="current-password"
                  placeholder="Password"
                  aria-label="Confirm password for account deletion"
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
                label="Request deletion"
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
  showDeletionPassword = false;
}
