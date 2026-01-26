import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { ApiService } from '../../core/api.service';
import { NotificationsService, UserNotification } from '../../core/notifications.service';
import { ButtonComponent } from '../../shared/button.component';
import { SkeletonComponent } from '../../shared/skeleton.component';

type NotificationsTab = 'inbox' | 'hidden';

@Component({
  selector: 'app-account-notifications-inbox',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterLink, TranslateModule, ButtonComponent, SkeletonComponent],
  template: `
    <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div class="flex items-start justify-between gap-3">
        <div class="grid gap-1 min-w-0">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50 truncate">{{ 'notifications.title' | translate }}</h2>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{
              tab === 'hidden'
                ? ('notifications.hiddenHint' | translate)
                : ('notifications.inboxHint' | translate)
            }}
          </p>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <app-button size="sm" variant="ghost" [label]="'notifications.refresh' | translate" (action)="load()"></app-button>
          <app-button size="sm" variant="ghost" [label]="'notifications.settings' | translate" [routerLink]="['/account/notifications/settings']"></app-button>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="h-9 px-4 rounded-full border text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          [ngClass]="
            tab === 'inbox'
              ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/30 dark:text-indigo-100'
              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
          "
          (click)="tab = 'inbox'"
          [attr.aria-pressed]="tab === 'inbox'"
        >
          {{ 'notifications.inbox' | translate }}
          <span class="ml-2 text-xs" *ngIf="activeNotifications().length">{{ activeNotifications().length }}</span>
        </button>
        <button
          type="button"
          class="h-9 px-4 rounded-full border text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          [ngClass]="
            tab === 'hidden'
              ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/30 dark:text-indigo-100'
              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
          "
          (click)="tab = 'hidden'"
          [attr.aria-pressed]="tab === 'hidden'"
        >
          {{ 'notifications.hidden' | translate }}
          <span class="ml-2 text-xs" *ngIf="hiddenNotifications().length">{{ hiddenNotifications().length }}</span>
        </button>
      </div>

      <ng-container *ngIf="loading; else body">
        <div class="grid gap-3">
          <app-skeleton height="18px"></app-skeleton>
          <app-skeleton height="18px"></app-skeleton>
          <app-skeleton height="18px"></app-skeleton>
        </div>
      </ng-container>

      <ng-template #body>
        <p *ngIf="errorKey" class="text-sm text-rose-700 dark:text-rose-300">{{ errorKey | translate }}</p>

        <ng-container *ngIf="!errorKey">
          <div *ngIf="currentList().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
            {{ (tab === 'hidden' ? 'notifications.emptyHidden' : 'notifications.empty') | translate }}
          </div>
          <ul *ngIf="currentList().length" class="grid gap-3">
            <li *ngFor="let n of currentList()">
              <div
                class="rounded-xl p-4 border border-slate-200 dark:border-slate-800"
                [ngClass]="
                  !n.read_at && !n.dismissed_at ? 'bg-amber-50/70 dark:bg-amber-950/25' : 'bg-white dark:bg-slate-900'
                "
              >
                <button type="button" class="w-full text-left" (click)="openNotification(n)">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <p class="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">{{ n.title }}</p>
                      <p *ngIf="n.body" class="mt-1 text-sm text-slate-700 dark:text-slate-200 break-words">{{ n.body }}</p>
                    </div>
                    <p class="shrink-0 text-xs text-slate-500 dark:text-slate-400">{{ n.created_at | date: 'short' }}</p>
                  </div>
                </button>
                <div class="mt-3 flex flex-wrap items-center justify-end gap-2">
                  <button
                    *ngIf="tab === 'inbox' && !n.read_at && !n.dismissed_at"
                    type="button"
                    class="h-8 px-3 rounded-full text-xs font-medium border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    (click)="markRead(n); $event.stopPropagation()"
                  >
                    {{ 'notifications.markRead' | translate }}
                  </button>
                  <button
                    *ngIf="tab === 'inbox' && !n.dismissed_at"
                    type="button"
                    class="h-8 px-3 rounded-full text-xs font-medium border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    (click)="dismiss(n); $event.stopPropagation()"
                  >
                    {{ 'notifications.dismiss' | translate }}
                  </button>
                  <button
                    *ngIf="tab === 'hidden' && n.dismissed_at"
                    type="button"
                    class="h-8 px-3 rounded-full text-xs font-medium border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    (click)="restore(n); $event.stopPropagation()"
                  >
                    {{ 'notifications.restore' | translate }}
                  </button>
                </div>
              </div>
            </li>
          </ul>
        </ng-container>
      </ng-template>
    </section>
  `
})
export class AccountNotificationsInboxComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationsService);

  tab: NotificationsTab = 'inbox';
  items: UserNotification[] = [];
  loading = true;
  errorKey = '';

  ngOnInit(): void {
    this.load();
  }

  currentList(): UserNotification[] {
    return this.tab === 'hidden' ? this.hiddenNotifications() : this.activeNotifications();
  }

  activeNotifications(): UserNotification[] {
    return this.items.filter((n) => !n.dismissed_at);
  }

  hiddenNotifications(): UserNotification[] {
    return this.items.filter((n) => Boolean(n.dismissed_at));
  }

  load(): void {
    this.loading = true;
    this.errorKey = '';
    this.api
      .get<{ items: UserNotification[] }>('/notifications', { limit: 75, include_dismissed: true, include_old_read: true })
      .subscribe({
        next: (resp) => {
          this.items = Array.isArray(resp.items) ? resp.items : [];
          this.loading = false;
          this.notifications.refreshUnreadCount();
        },
        error: () => {
          this.errorKey = 'notifications.loadError';
          this.loading = false;
        }
      });
  }

  openNotification(n: UserNotification): void {
    if (!n.dismissed_at && !n.read_at) {
      this.markRead(n);
    }
    if (n.url) {
      void this.router.navigateByUrl(n.url);
    }
  }

  markRead(n: UserNotification): void {
    this.api.post<UserNotification>(`/notifications/${encodeURIComponent(n.id)}/read`, {}).subscribe({
      next: (updated) => {
        this.items = this.items.map((item) => (item.id === updated.id ? updated : item));
        this.notifications.refreshUnreadCount();
      }
    });
  }

  dismiss(n: UserNotification): void {
    this.api.post<UserNotification>(`/notifications/${encodeURIComponent(n.id)}/dismiss`, {}).subscribe({
      next: (updated) => {
        this.items = this.items.map((item) => (item.id === updated.id ? updated : item));
        this.notifications.refreshUnreadCount();
      }
    });
  }

  restore(n: UserNotification): void {
    this.api.post<UserNotification>(`/notifications/${encodeURIComponent(n.id)}/restore`, {}).subscribe({
      next: (updated) => {
        this.items = this.items.map((item) => (item.id === updated.id ? updated : item));
        this.notifications.refreshUnreadCount();
      }
    });
  }
}
