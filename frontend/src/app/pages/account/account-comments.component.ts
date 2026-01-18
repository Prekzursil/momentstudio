import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { ButtonComponent } from '../../shared/button.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { AccountComponent } from './account.component';

@Component({
  selector: 'app-account-comments',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, ButtonComponent, SkeletonComponent],
  template: `
    <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">My comments</h2>
        <app-button size="sm" variant="ghost" label="Refresh" (action)="account.loadMyComments(account.myCommentsPage)"></app-button>
      </div>

      <div *ngIf="account.myCommentsLoading(); else myCommentsBody" class="grid gap-3">
        <app-skeleton height="64px"></app-skeleton>
        <app-skeleton height="64px"></app-skeleton>
      </div>
      <ng-template #myCommentsBody>
        <div
          *ngIf="account.myCommentsError()"
          class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
        >
          {{ account.myCommentsError() }}
        </div>
        <div
          *ngIf="!account.myCommentsError() && account.myComments().length === 0"
          class="border border-dashed border-slate-200 rounded-xl p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"
        >
          No comments yet. <a routerLink="/blog" class="text-indigo-600 dark:text-indigo-300 font-medium">Browse the blog</a>.
        </div>

        <div *ngIf="!account.myCommentsError() && account.myComments().length" class="grid gap-3">
          <div *ngFor="let c of account.myComments()" class="rounded-lg border border-slate-200 p-3 grid gap-2 dark:border-slate-700">
            <div class="flex items-start justify-between gap-3">
              <a [routerLink]="['/blog', c.post_slug]" class="font-semibold text-slate-900 dark:text-slate-50 hover:underline">
                {{ c.post_title || c.post_slug }}
              </a>
              <span class="text-xs rounded-full px-2 py-1 whitespace-nowrap" [ngClass]="account.commentStatusChipClass(c.status)">
                {{ c.status }}
              </span>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ account.formatTimestamp(c.created_at) }}</p>
            <p *ngIf="c.body" class="text-sm text-slate-700 dark:text-slate-200">{{ c.body }}</p>
            <p *ngIf="!c.body && c.status === 'deleted'" class="text-sm text-slate-500 dark:text-slate-400">This comment was deleted.</p>
            <p *ngIf="!c.body && c.status === 'hidden'" class="text-sm text-slate-500 dark:text-slate-400">This comment was hidden by moderators.</p>

            <div
              *ngIf="c.parent"
              class="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200"
            >
              <p class="text-xs text-slate-500 dark:text-slate-400">
                Replying to {{ c.parent.author_name || ('blog.comments.anonymous' | translate) }}
              </p>
              <p>{{ c.parent.snippet }}</p>
            </div>

            <div *ngIf="c.reply_count" class="text-sm text-slate-700 dark:text-slate-200">
              {{ c.reply_count }} repl{{ c.reply_count === 1 ? 'y' : 'ies' }}
              <span *ngIf="c.last_reply">
                · Latest: {{ c.last_reply.author_name || ('blog.comments.anonymous' | translate) }} — {{ c.last_reply.snippet }}
              </span>
            </div>
          </div>

          <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200" *ngIf="account.myCommentsMeta()">
            <span>Page {{ account.myCommentsMeta()?.page }} / {{ account.myCommentsMeta()?.total_pages }}</span>
            <div class="flex gap-2">
              <app-button
                size="sm"
                variant="ghost"
                label="Prev"
                [disabled]="(account.myCommentsMeta()?.page || 1) <= 1"
                (action)="account.prevMyCommentsPage()"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                label="Next"
                [disabled]="(account.myCommentsMeta()?.page || 1) >= (account.myCommentsMeta()?.total_pages || 1)"
                (action)="account.nextMyCommentsPage()"
              ></app-button>
            </div>
          </div>
        </div>
      </ng-template>
    </section>
  `
})
export class AccountCommentsComponent {
  protected readonly account = inject(AccountComponent);
}
