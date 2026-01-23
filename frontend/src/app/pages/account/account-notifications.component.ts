import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { ButtonComponent } from '../../shared/button.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { AccountComponent } from './account.component';

@Component({
  selector: 'app-account-notifications',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, ButtonComponent, SkeletonComponent],
  template: `
    <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <ng-container *ngIf="account.loading(); else notificationsBody">
        <div class="grid gap-3">
          <app-skeleton height="18px" width="220px"></app-skeleton>
          <app-skeleton height="120px"></app-skeleton>
        </div>
      </ng-container>

      <ng-template #notificationsBody>
        <div class="flex items-start justify-between gap-3">
          <div class="grid gap-1">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'account.notifications.title' | translate }}</h2>
          <p *ngIf="account.notificationLastUpdated" class="text-xs text-slate-500 dark:text-slate-400">
            {{ 'account.notifications.lastUpdated' | translate: { date: account.formatTimestamp(account.notificationLastUpdated) } }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <app-button
            size="sm"
            variant="ghost"
            [label]="'notifications.viewAll' | translate"
            routerLink="/account/notifications"
          ></app-button>
          <app-button
            size="sm"
            variant="ghost"
            [label]="'account.notifications.save' | translate"
            [disabled]="account.savingNotifications"
            (action)="account.saveNotifications()"
          ></app-button>
        </div>
      </div>

      <div class="grid gap-4 text-sm text-slate-700 dark:text-slate-200">
        <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 grid gap-1">
          <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {{ 'account.notifications.transactionalTitle' | translate }}
          </p>
          <p>{{ 'account.notifications.transactionalCopy' | translate }}</p>
        </div>

        <div class="grid gap-2">
          <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {{ 'account.notifications.communityHeading' | translate }}
          </p>
          <div class="flex items-center justify-between gap-3">
            <label class="flex items-center gap-2">
              <input type="checkbox" [(ngModel)]="account.notifyBlogCommentReplies" />
              <span>{{ 'account.notifications.replyLabel' | translate }}</span>
            </label>
            <button
              type="button"
              class="text-xs font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-200"
              (click)="togglePreview('reply')"
            >
              {{ preview === 'reply' ? ('account.notifications.hidePreview' | translate) : ('account.notifications.showPreview' | translate) }}
            </button>
          </div>
          <div
            *ngIf="preview === 'reply'"
            class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 grid gap-2"
          >
            <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {{ 'account.notifications.previewTitle' | translate }}
            </p>
            <p class="whitespace-pre-wrap">{{ 'account.notifications.previewReply' | translate }}</p>
          </div>
        </div>

        <div class="grid gap-2" *ngIf="account.isAdmin()">
          <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {{ 'account.notifications.adminHeading' | translate }}
          </p>
          <div class="flex items-center justify-between gap-3">
            <label class="flex items-center gap-2">
              <input type="checkbox" [(ngModel)]="account.notifyBlogComments" />
              <span>{{ 'account.notifications.adminLabel' | translate }}</span>
            </label>
            <button
              type="button"
              class="text-xs font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-200"
              (click)="togglePreview('admin')"
            >
              {{ preview === 'admin' ? ('account.notifications.hidePreview' | translate) : ('account.notifications.showPreview' | translate) }}
            </button>
          </div>
          <div
            *ngIf="preview === 'admin'"
            class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 grid gap-2"
          >
            <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {{ 'account.notifications.previewTitle' | translate }}
            </p>
            <p class="whitespace-pre-wrap">{{ 'account.notifications.previewAdmin' | translate }}</p>
          </div>
        </div>

        <div class="grid gap-2">
          <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {{ 'account.notifications.marketingHeading' | translate }}
          </p>
          <div class="flex items-center justify-between gap-3">
            <label class="flex items-center gap-2">
              <input type="checkbox" [(ngModel)]="account.notifyMarketing" />
              <span>{{ 'account.notifications.marketingLabel' | translate }}</span>
            </label>
            <button
              type="button"
              class="text-xs font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-200"
              (click)="togglePreview('marketing')"
            >
              {{ preview === 'marketing' ? ('account.notifications.hidePreview' | translate) : ('account.notifications.showPreview' | translate) }}
            </button>
          </div>
          <div
            *ngIf="preview === 'marketing'"
            class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 grid gap-2"
          >
            <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {{ 'account.notifications.previewTitle' | translate }}
            </p>
            <p class="whitespace-pre-wrap">{{ 'account.notifications.previewMarketing' | translate }}</p>
          </div>
        </div>

        <span *ngIf="account.notificationsMessage" class="text-xs text-emerald-700 dark:text-emerald-300">{{
          account.notificationsMessage | translate
        }}</span>
        <span *ngIf="account.notificationsError" class="text-xs text-rose-700 dark:text-rose-300">{{ account.notificationsError | translate }}</span>
      </div>
      </ng-template>
    </section>
  `
})
export class AccountNotificationsComponent {
  protected readonly account = inject(AccountComponent);
  preview: 'reply' | 'admin' | 'marketing' | null = null;

  togglePreview(key: 'reply' | 'admin' | 'marketing'): void {
    this.preview = this.preview === key ? null : key;
  }

  hasUnsavedChanges(): boolean {
    return this.account.notificationsHasUnsavedChanges();
  }

  discardUnsavedChanges(): void {
    this.account.discardNotificationChanges();
  }
}
