import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AdminUserAliasesResponse, AdminUserSession, AdminService } from '../../../core/admin.service';
import { AdminCouponsV2Service } from '../../../core/admin-coupons-v2.service';
import {
  AdminEmailVerificationHistoryResponse,
  AdminUserListItem,
  AdminUserListResponse,
  AdminUserProfileResponse,
  AdminUsersService
} from '../../../core/admin-users.service';
import { AuthService } from '../../../core/auth.service';
import type { PromotionRead } from '../../../core/coupons.service';
import { AdminRecentService } from '../../../core/admin-recent.service';
import { AdminFavoriteItem, AdminFavoritesService } from '../../../core/admin-favorites.service';
import { ToastService } from '../../../core/toast.service';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { extractRequestId } from '../../../shared/http-error';
import { InputComponent } from '../../../shared/input.component';
import { HelpPanelComponent } from '../../../shared/help-panel.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { formatIdentity } from '../../../shared/user-identity';
import {
  AdminTableLayoutV1,
  adminTableCellPaddingClass,
  adminTableLayoutStorageKey,
  defaultAdminTableLayout,
  loadAdminTableLayout,
  saveAdminTableLayout,
  visibleAdminTableColumnIds
} from '../shared/admin-table-layout';
import { AdminTableLayoutColumnDef, TableLayoutModalComponent } from '../shared/table-layout-modal.component';
import { AdminPageHeaderComponent } from '../shared/admin-page-header.component';
import { adminFilterFavoriteKey } from '../shared/admin-filter-favorites';
import { CustomerTimelineComponent } from '../shared/customer-timeline.component';

type RoleFilter = 'all' | 'customer' | 'support' | 'fulfillment' | 'content' | 'admin' | 'owner';

const USERS_TABLE_COLUMNS: AdminTableLayoutColumnDef[] = [
  { id: 'identity', labelKey: 'adminUi.users.table.identity', required: true },
  { id: 'email', labelKey: 'adminUi.users.table.email' },
  { id: 'role', labelKey: 'adminUi.users.table.role' },
  { id: 'verified', labelKey: 'adminUi.users.table.verified' },
  { id: 'created', labelKey: 'adminUi.users.table.created' },
  { id: 'actions', labelKey: 'adminUi.users.table.actions', required: true }
];

const defaultUsersTableLayout = (): AdminTableLayoutV1 => ({
  ...defaultAdminTableLayout(USERS_TABLE_COLUMNS),
  hidden: ['email']
});

@Component({
  selector: 'app-admin-users',
  standalone: true,
	  imports: [
	    CommonModule,
	    FormsModule,
	    RouterLink,
	    ScrollingModule,
	    TranslateModule,
	    BreadcrumbComponent,
	    ButtonComponent,
	    ErrorStateComponent,
	    InputComponent,
	    HelpPanelComponent,
	    SkeletonComponent,
	    CustomerTimelineComponent,
	    TableLayoutModalComponent,
      AdminPageHeaderComponent
	  ],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

		      <app-admin-page-header [titleKey]="'adminUi.users.title'" [hintKey]="'adminUi.users.hint'">
		        <ng-template #primaryActions>
		          <app-button
		            size="sm"
		            variant="ghost"
		            [label]="(piiReveal() ? 'adminUi.pii.hide' : 'adminUi.pii.reveal') | translate"
		            [disabled]="loading() || !canRevealPii()"
		            (action)="togglePiiReveal()"
		          ></app-button>
		          <app-button size="sm" variant="ghost" routerLink="/admin/users/segments" [label]="'adminUi.users.segments' | translate"></app-button>
		          <app-button size="sm" variant="ghost" routerLink="/admin/users/gdpr" [label]="'adminUi.users.gdprQueue' | translate"></app-button>
		        </ng-template>

		        <ng-template #secondaryActions>
		          <app-button size="sm" variant="ghost" [label]="densityToggleLabelKey() | translate" (action)="toggleDensity()"></app-button>
		          <app-button size="sm" variant="ghost" [label]="'adminUi.tableLayout.title' | translate" (action)="openLayoutModal()"></app-button>
		        </ng-template>
		      </app-admin-page-header>

      <app-table-layout-modal
        [open]="layoutModalOpen()"
        [columns]="tableColumns"
        [layout]="tableLayout()"
        [defaults]="tableDefaults"
        (closed)="closeLayoutModal()"
        (applied)="applyTableLayout($event)"
      ></app-table-layout-modal>

      <div class="grid gap-6 lg:grid-cols-[1.25fr_0.75fr] items-start">
        <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <app-help-panel
            [titleKey]="'adminUi.help.title'"
            [subtitleKey]="'adminUi.users.help.subtitle'"
            [mediaSrc]="'assets/help/admin-users-help.svg'"
            [mediaAltKey]="'adminUi.users.help.mediaAlt'"
          >
            <ul class="list-disc pl-5 text-xs text-slate-600 dark:text-slate-300">
              <li>{{ 'adminUi.users.help.points.search' | translate }}</li>
              <li>{{ 'adminUi.users.help.points.pii' | translate }}</li>
              <li>{{ 'adminUi.users.help.points.roles' | translate }}</li>
            </ul>
          </app-help-panel>

          <div class="grid gap-3 lg:grid-cols-[1fr_240px_auto] items-end">
            <app-input [label]="'adminUi.users.search' | translate" [(value)]="q"></app-input>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'adminUi.users.roleFilter' | translate }}
              <select
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="role"
              >
                <option value="all">{{ 'adminUi.users.all' | translate }}</option>
                <option value="customer">{{ 'adminUi.users.roles.customer' | translate }}</option>
                <option value="support">{{ 'adminUi.users.roles.support' | translate }}</option>
                <option value="fulfillment">{{ 'adminUi.users.roles.fulfillment' | translate }}</option>
                <option value="content">{{ 'adminUi.users.roles.content' | translate }}</option>
                <option value="admin">{{ 'adminUi.users.roles.admin' | translate }}</option>
                <option value="owner">{{ 'adminUi.users.roles.owner' | translate }}</option>
              </select>
            </label>

            <div class="flex items-center gap-2">
              <app-button size="sm" [label]="'adminUi.actions.refresh' | translate" (action)="applyFilters()"></app-button>
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.reset' | translate" (action)="resetFilters()"></app-button>
            </div>
          </div>

          <div class="flex flex-wrap items-end justify-between gap-3">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 w-full sm:w-auto">
              {{ 'adminUi.favorites.savedViews.label' | translate }}
              <select
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 min-w-[220px]"
                [(ngModel)]="selectedSavedViewKey"
                (ngModelChange)="applySavedView($event)"
              >
                <option value="">{{ 'adminUi.favorites.savedViews.none' | translate }}</option>
                <option *ngFor="let view of savedViews()" [value]="view.key">{{ view.label }}</option>
              </select>
            </label>

            <div class="flex flex-wrap items-center gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="(isCurrentViewPinned() ? 'adminUi.favorites.savedViews.unpinCurrent' : 'adminUi.favorites.savedViews.pinCurrent') | translate"
                [disabled]="favorites.loading()"
                (action)="toggleCurrentViewPin()"
              ></app-button>
            </div>
          </div>

          <app-error-state
            *ngIf="error()"
            [message]="error()!"
            [requestId]="errorRequestId()"
            [showRetry]="true"
            (retry)="retryLoad()"
          ></app-error-state>

          <div *ngIf="loading(); else listTpl">
            <app-skeleton [rows]="8"></app-skeleton>
          </div>
          <ng-template #listTpl>
            <div *ngIf="users().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.users.empty' | translate }}
            </div>

	            <div *ngIf="users().length > 0" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <ng-template #usersTableHeader>
                  <tr>
                    <ng-container *ngFor="let colId of visibleColumnIds(); trackBy: trackColumnId" [ngSwitch]="colId">
                      <th *ngSwitchCase="'identity'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                        {{ 'adminUi.users.table.identity' | translate }}
                      </th>
                      <th *ngSwitchCase="'email'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                        {{ 'adminUi.users.table.email' | translate }}
                      </th>
                      <th *ngSwitchCase="'role'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                        {{ 'adminUi.users.table.role' | translate }}
                      </th>
                      <th *ngSwitchCase="'verified'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                        {{ 'adminUi.users.table.verified' | translate }}
                      </th>
                      <th *ngSwitchCase="'created'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                        {{ 'adminUi.users.table.created' | translate }}
                      </th>
                      <th *ngSwitchCase="'actions'" class="text-right font-semibold" [ngClass]="cellPaddingClass()">
                        {{ 'adminUi.users.table.actions' | translate }}
                      </th>
                    </ng-container>
                  </tr>
                </ng-template>

                <ng-template #usersTableRow let-user>
                  <tr class="border-t border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
                    <ng-container *ngFor="let colId of visibleColumnIds(); trackBy: trackColumnId" [ngSwitch]="colId">
                      <td
                        *ngSwitchCase="'identity'"
                        class="font-medium text-slate-900 dark:text-slate-50"
                        [ngClass]="cellPaddingClass()"
                      >
                        {{ identityLabel(user) }}
                      </td>
                      <td *ngSwitchCase="'email'" class="text-slate-700 dark:text-slate-200" [ngClass]="cellPaddingClass()">
                        {{ user.email }}
                      </td>
                      <td *ngSwitchCase="'role'" [ngClass]="cellPaddingClass()">
                        <span class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold" [ngClass]="rolePillClass(user.role)">
                          {{ ('adminUi.users.roles.' + user.role) | translate }}
                        </span>
                      </td>
                      <td *ngSwitchCase="'verified'" [ngClass]="cellPaddingClass()">
                        <span
                          class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold"
                          [ngClass]="
                            user.email_verified
                              ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100'
                              : 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100'
                          "
                        >
                          {{ user.email_verified ? ('adminUi.users.verified' | translate) : ('adminUi.users.unverified' | translate) }}
                        </span>
                      </td>
                      <td *ngSwitchCase="'created'" class="text-slate-600 dark:text-slate-300" [ngClass]="cellPaddingClass()">
                        {{ user.created_at | date: 'short' }}
                      </td>
                      <td *ngSwitchCase="'actions'" class="text-right" [ngClass]="cellPaddingClass()">
                        <app-button size="sm" variant="ghost" [label]="'adminUi.users.manage' | translate" (action)="select(user)"></app-button>
                      </td>
                    </ng-container>
                  </tr>
                </ng-template>

	              <ng-container *ngIf="users().length > 100; else usersTableStandard">
	                <cdk-virtual-scroll-viewport
	                  class="block h-[min(70vh,720px)]"
                  [itemSize]="userRowHeight"
                  [minBufferPx]="userRowHeight * 10"
                  [maxBufferPx]="userRowHeight * 20"
	                >
	                  <table class="min-w-[880px] w-full text-sm">
	                    <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
	                      <ng-container [ngTemplateOutlet]="usersTableHeader"></ng-container>
	                    </thead>
	                    <tbody>
                        <ng-container *cdkVirtualFor="let user of users(); trackBy: trackUserId">
                          <ng-container
                            [ngTemplateOutlet]="usersTableRow"
                            [ngTemplateOutletContext]="{ $implicit: user }"
                          ></ng-container>
                        </ng-container>
	                    </tbody>
	                  </table>
	                </cdk-virtual-scroll-viewport>
	              </ng-container>
	              <ng-template #usersTableStandard>
	                <table class="min-w-[880px] w-full text-sm">
	                  <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
	                    <ng-container [ngTemplateOutlet]="usersTableHeader"></ng-container>
	                  </thead>
	                  <tbody>
                      <ng-container *ngFor="let user of users(); trackBy: trackUserId">
                        <ng-container
                          [ngTemplateOutlet]="usersTableRow"
                          [ngTemplateOutletContext]="{ $implicit: user }"
                        ></ng-container>
                      </ng-container>
	                  </tbody>
	                </table>
	              </ng-template>
	            </div>

            <div *ngIf="meta()" class="flex items-center justify-between gap-3 pt-2 text-sm text-slate-700 dark:text-slate-200">
              <div>
                {{ 'adminUi.users.pagination' | translate: { page: meta()!.page, total_pages: meta()!.total_pages, total_items: meta()!.total_items } }}
              </div>
              <div class="flex items-center gap-2">
                <app-button size="sm" variant="ghost" [label]="'adminUi.users.prev' | translate" [disabled]="meta()!.page <= 1" (action)="goToPage(meta()!.page - 1)"></app-button>
                <app-button size="sm" variant="ghost" [label]="'adminUi.users.next' | translate" [disabled]="meta()!.page >= meta()!.total_pages" (action)="goToPage(meta()!.page + 1)"></app-button>
              </div>
            </div>
          </ng-template>
        </section>

        <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.users.detailTitle' | translate }}</h2>

          <div *ngIf="!selectedUser()" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'adminUi.users.selectHint' | translate }}
          </div>

          <div *ngIf="selectedUser()" class="grid gap-3">
            <div class="rounded-xl border border-slate-200 p-3 grid gap-1 dark:border-slate-800">
              <div class="font-semibold text-slate-900 dark:text-slate-50">{{ identityLabel(selectedUser()!) }}</div>
              <div class="text-sm text-slate-600 dark:text-slate-300">{{ selectedUser()!.email }}</div>
              <div *ngIf="vip" class="mt-2">
                <span class="inline-flex items-center rounded-full bg-indigo-100 px-2 py-1 text-xs font-semibold text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-100">
                  {{ 'adminUi.users.vip' | translate }}
                </span>
              </div>
            </div>

            <div class="rounded-xl border border-slate-200 p-3 grid gap-2 dark:border-slate-800">
              <app-customer-timeline
                [userId]="selectedUser()!.id"
                [customerEmail]="piiReveal() ? selectedUser()!.email : null"
                [includePii]="piiReveal()"
              ></app-customer-timeline>
            </div>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'adminUi.users.role' | translate }}
              <select
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="selectedRole"
                [disabled]="!canManageRoles() || selectedUser()!.role === 'owner'"
              >
                <option value="customer">{{ 'adminUi.users.roles.customer' | translate }}</option>
                <option value="support">{{ 'adminUi.users.roles.support' | translate }}</option>
                <option value="fulfillment">{{ 'adminUi.users.roles.fulfillment' | translate }}</option>
                <option value="content">{{ 'adminUi.users.roles.content' | translate }}</option>
                <option value="admin">{{ 'adminUi.users.roles.admin' | translate }}</option>
                <option value="owner" disabled>{{ 'adminUi.users.roles.owner' | translate }}</option>
              </select>
              <span *ngIf="selectedUser()!.role === 'owner'" class="text-xs font-normal text-slate-500 dark:text-slate-400">
                {{ 'adminUi.users.ownerLocked' | translate }}
              </span>
              <span *ngIf="selectedRole" class="text-xs font-normal text-slate-500 dark:text-slate-400">
                {{ ('adminUi.users.roleHints.' + selectedRole) | translate }}
              </span>
            </label>

            <div class="flex gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.users.setRole' | translate"
                [disabled]="!canManageRoles() || selectedUser()!.role === 'owner' || selectedRole === selectedUser()!.role"
                (action)="updateRole()"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.users.viewAsUser' | translate"
                [disabled]="selectedUser()!.role !== 'customer' || impersonateBusy()"
                (action)="impersonate()"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.users.forceLogout' | translate"
                (action)="forceLogout()"
              ></app-button>
            </div>

            <div class="rounded-xl border border-slate-200 p-3 grid gap-3 dark:border-slate-800">
              <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" [(ngModel)]="vip" />
                {{ 'adminUi.users.vip' | translate }}
              </label>

              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.users.adminNote' | translate }}
                <textarea
                  class="min-h-[120px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="adminNote"
                  [maxLength]="2000"
                ></textarea>
                <span class="text-xs font-normal text-slate-500 dark:text-slate-400">{{ 'adminUi.users.adminNoteHint' | translate }}</span>
              </label>

              <div class="flex gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.users.saveInternal' | translate"
                  [disabled]="internalBusy()"
                  (action)="saveInternal()"
                ></app-button>
              </div>
            </div>

            <div class="rounded-xl border border-slate-200 p-3 grid gap-3 dark:border-slate-800">
              <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                {{ 'adminUi.users.securityTitle' | translate }}
              </div>

              <div class="flex items-center justify-between gap-3 text-sm">
                <div class="text-slate-700 dark:text-slate-200">{{ 'adminUi.users.lockStatus' | translate }}</div>
                <span
                  class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold"
                  [ngClass]="isLocked() ? 'bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-100' : 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'"
                >
                  {{ isLocked() ? ('adminUi.users.locked' | translate) : ('adminUi.users.unlocked' | translate) }}
                </span>
              </div>

              <div *ngIf="profile()?.user?.locked_until" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'adminUi.users.lockedUntil' | translate }}:
                <span class="font-medium text-slate-900 dark:text-slate-100">{{ profile()!.user.locked_until | date: 'short' }}</span>
              </div>

              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.users.lockReason' | translate }}
                <input
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="lockedReason"
                  [maxLength]="255"
                />
              </label>

              <div class="flex flex-wrap items-center gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.users.lock1h' | translate"
                  [disabled]="securityBusy()"
                  (action)="lockForMinutes(60)"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.users.lock24h' | translate"
                  [disabled]="securityBusy()"
                  (action)="lockForMinutes(60 * 24)"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.users.lock7d' | translate"
                  [disabled]="securityBusy()"
                  (action)="lockForMinutes(60 * 24 * 7)"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.users.unlock' | translate"
                  [disabled]="securityBusy() || !isLocked()"
                  (action)="unlock()"
                ></app-button>
              </div>

              <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" [(ngModel)]="passwordResetRequired" />
                {{ 'adminUi.users.passwordResetRequired' | translate }}
              </label>

              <div class="flex gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.users.saveSecurity' | translate"
                  [disabled]="securityBusy()"
                  (action)="saveSecurity()"
                ></app-button>
              </div>
            </div>

            <div class="rounded-xl border border-slate-200 p-3 grid gap-3 dark:border-slate-800">
              <div class="flex items-center justify-between gap-3">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.users.sessionsTitle' | translate }}
                </div>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.actions.refresh' | translate"
                  [disabled]="sessionsLoading()"
                  (action)="refreshSessions()"
                ></app-button>
              </div>

              <div *ngIf="sessionsLoading()" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'adminUi.users.sessionsLoading' | translate }}
              </div>
              <div *ngIf="sessionsError()" class="text-sm text-rose-700 dark:text-rose-200">
                {{ sessionsError() }}
              </div>

              <div *ngIf="sessions() && sessions()!.length === 0" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'adminUi.users.sessionsEmpty' | translate }}
              </div>

              <div *ngIf="sessions() && sessions()!.length > 0" class="grid gap-2">
                <div
                  *ngFor="let s of sessions()!"
                  class="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="grid gap-1 min-w-0">
                      <div class="font-medium text-slate-900 dark:text-slate-50 truncate">
                        {{ sessionDeviceLabel(s) }}
                      </div>
                      <div class="text-xs text-slate-600 dark:text-slate-300">
                        {{ s.ip_address || '—' }}{{ s.country_code ? ' · ' + s.country_code : '' }}
                        ·
                        {{ s.persistent ? ('adminUi.users.sessionPersistent' | translate) : ('adminUi.users.sessionNonPersistent' | translate) }}
                      </div>
                      <div class="text-xs text-slate-500 dark:text-slate-400">
                        {{ 'adminUi.users.sessionCreated' | translate }}: {{ s.created_at | date: 'short' }} ·
                        {{ 'adminUi.users.sessionExpires' | translate }}: {{ s.expires_at | date: 'short' }}
                      </div>
                    </div>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.users.revokeSession' | translate"
                      [disabled]="revokingSessionId() === s.id"
                      (action)="revokeOneSession(s.id)"
                    ></app-button>
                  </div>
                </div>
              </div>
            </div>

            <div *ngIf="canIssueCoupons()" class="rounded-xl border border-slate-200 p-3 grid gap-3 dark:border-slate-800">
              <div class="flex items-center justify-between gap-3">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.users.couponGrantTitle' | translate }}
                </div>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.actions.refresh' | translate"
                  [disabled]="couponPromotionsLoading()"
                  (action)="ensureCouponPromotions(true)"
                ></app-button>
              </div>

              <div *ngIf="couponPromotionsLoading()" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'adminUi.users.couponPromotionsLoading' | translate }}
              </div>
              <div *ngIf="couponPromotionsError()" class="text-sm text-rose-700 dark:text-rose-200">
                {{ couponPromotionsError() }}
              </div>

              <div *ngIf="couponPromotions() && couponPromotions()!.length === 0 && !couponPromotionsLoading()" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'adminUi.users.couponPromotionsEmpty' | translate }}
              </div>

              <ng-container *ngIf="couponPromotions() && couponPromotions()!.length > 0">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.users.couponPromotion' | translate }}
                  <select
                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="couponPromotionId"
                  >
                    <option *ngFor="let p of couponPromotions()!" [value]="p.id">{{ p.name }}</option>
                  </select>
                </label>

                <div class="grid gap-3 lg:grid-cols-2">
                  <app-input [label]="'adminUi.users.couponPrefix' | translate" [(value)]="couponPrefix"></app-input>
                  <app-input
                    [label]="'adminUi.users.couponValidityDays' | translate"
                    type="number"
                    [min]="1"
                    [(value)]="couponValidityDays"
                  ></app-input>
                </div>

                <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" class="h-5 w-5 accent-indigo-600" [(ngModel)]="couponSendEmail" />
                  {{ 'adminUi.users.couponSendEmail' | translate }}
                </label>

                <div class="flex flex-wrap items-center gap-2">
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.users.issueCoupon' | translate"
                    [disabled]="couponIssueBusy() || !couponPromotionId"
                    (action)="issueCoupon()"
                  ></app-button>
                  <app-button
                    *ngIf="couponIssuedCode()"
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.users.copyCouponCode' | translate"
                    (action)="copyIssuedCoupon()"
                  ></app-button>
                </div>

                <div *ngIf="couponIssueError()" class="text-sm text-rose-700 dark:text-rose-200">
                  {{ couponIssueError() }}
                </div>

                <div
                  *ngIf="couponIssuedCode()"
                  class="rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                >
                  {{ 'adminUi.users.couponIssuedCode' | translate }}:
                  <span class="font-semibold">{{ couponIssuedCode() }}</span>
                </div>
              </ng-container>
            </div>

            <div class="rounded-xl border border-slate-200 p-3 grid gap-3 dark:border-slate-800">
              <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                {{ 'adminUi.users.emailVerificationTitle' | translate }}
              </div>

              <div class="flex items-center justify-between gap-3 text-sm">
                <div class="text-slate-700 dark:text-slate-200">{{ selectedUser()!.email }}</div>
                <span
                  class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold"
                  [ngClass]="selectedUser()!.email_verified ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100' : 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100'"
                >
                  {{ selectedUser()!.email_verified ? ('adminUi.users.verified' | translate) : ('adminUi.users.unverified' | translate) }}
                </span>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.users.resendVerification' | translate"
                  [disabled]="emailVerificationBusy() || selectedUser()!.email_verified"
                  (action)="resendVerification()"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.users.loadVerificationHistory' | translate"
                  [disabled]="emailHistoryLoading()"
                  (action)="loadEmailHistory()"
                ></app-button>
                <app-button
                  *ngIf="isOwner() && !selectedUser()!.email_verified"
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.users.overrideVerification' | translate"
                  [disabled]="emailVerificationBusy()"
                  (action)="overrideVerification()"
                ></app-button>
              </div>

              <div *ngIf="emailHistoryLoading()" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'adminUi.users.loadingVerificationHistory' | translate }}
              </div>
              <div *ngIf="emailHistoryError()" class="text-sm text-rose-700 dark:text-rose-200">
                {{ emailHistoryError() }}
              </div>

              <div *ngIf="emailHistory() && emailHistory()!.tokens.length" class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
                <div class="grid gap-1 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900" *ngFor="let tok of emailHistory()!.tokens">
                  <div class="flex items-center justify-between gap-3">
                    <div class="font-medium">{{ tok.created_at | date: 'short' }}</div>
                    <span
                      class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold"
                      [ngClass]="tok.used ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100' : 'bg-indigo-100 text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-100'"
                    >
                      {{ tok.used ? ('adminUi.users.verificationUsed' | translate) : ('adminUi.users.verificationPending' | translate) }}
                    </span>
                  </div>
                  <div class="text-xs text-slate-600 dark:text-slate-300">
                    {{ 'adminUi.users.verificationExpires' | translate }}: {{ tok.expires_at | date: 'short' }}
                  </div>
                </div>
              </div>
            </div>

            <div class="grid gap-2">
              <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                {{ 'adminUi.users.aliasHistory' | translate }}
              </div>

              <div *ngIf="aliasesLoading()" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'adminUi.users.loadingAliases' | translate }}
              </div>
              <div *ngIf="aliasesError()" class="text-sm text-rose-700 dark:text-rose-200">
                {{ aliasesError() }}
              </div>

              <ng-container *ngIf="aliases()">
                <div class="grid gap-3 text-sm text-slate-700 dark:text-slate-200">
                  <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.users.usernameHistory' | translate }}</p>
                    <p *ngIf="aliases()!.usernames.length === 0" class="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.users.noHistory' | translate }}
                    </p>
                    <ul *ngIf="aliases()!.usernames.length > 0" class="mt-2 grid gap-2">
                      <li *ngFor="let h of aliases()!.usernames" class="flex items-center justify-between gap-2">
                        <span class="font-medium text-slate-900 dark:text-slate-50 truncate">{{ h.username }}</span>
                        <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">{{ h.created_at | date: 'short' }}</span>
                      </li>
                    </ul>
                  </div>

                  <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.users.displayNameHistory' | translate }}</p>
                    <p *ngIf="aliases()!.display_names.length === 0" class="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.users.noHistory' | translate }}
                    </p>
                    <ul *ngIf="aliases()!.display_names.length > 0" class="mt-2 grid gap-2">
                      <li *ngFor="let h of aliases()!.display_names" class="flex items-center justify-between gap-2">
                        <span class="font-medium text-slate-900 dark:text-slate-50 truncate">{{ h.name }}#{{ h.name_tag }}</span>
                        <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">{{ h.created_at | date: 'short' }}</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </ng-container>
            </div>

            <div class="grid gap-2">
              <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                {{ 'adminUi.users.customerProfile' | translate }}
              </div>

              <div *ngIf="profileLoading()" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'adminUi.users.profileLoading' | translate }}
              </div>
              <div *ngIf="profileError()" class="text-sm text-rose-700 dark:text-rose-200">
                {{ profileError() }}
              </div>

              <ng-container *ngIf="profile() as profile">
                <div class="grid gap-3 text-sm text-slate-700 dark:text-slate-200">
                  <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.users.addressesTitle' | translate }}
                    </p>
                    <p *ngIf="profile.addresses.length === 0" class="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.users.addressesEmpty' | translate }}
                    </p>
                    <ul *ngIf="profile.addresses.length > 0" class="mt-2 grid gap-2">
                      <li *ngFor="let addr of profile.addresses | slice: 0:5" class="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                        <div class="flex items-center justify-between gap-2">
                          <div class="font-medium text-slate-900 dark:text-slate-50 truncate">
                            {{ addr.label || addr.line1 }}
                          </div>
                          <div class="flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-300">
                            <span *ngIf="addr.is_default_shipping" class="rounded-full bg-indigo-100 px-2 py-0.5 text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-100">
                              {{ 'adminUi.users.defaultShipping' | translate }}
                            </span>
                            <span *ngIf="addr.is_default_billing" class="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              {{ 'adminUi.users.defaultBilling' | translate }}
                            </span>
                          </div>
                        </div>
                        <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                          {{ addr.city }}{{ addr.region ? ', ' + addr.region : '' }} · {{ addr.postal_code }} · {{ addr.country }}
                        </div>
                      </li>
                    </ul>
                  </div>

                  <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.users.ordersTitle' | translate }}
                    </p>
                    <p *ngIf="profile.orders.length === 0" class="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.users.ordersEmpty' | translate }}
                    </p>
                    <ul *ngIf="profile.orders.length > 0" class="mt-2 grid gap-2">
                      <li *ngFor="let order of profile.orders | slice: 0:5" class="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                        <a [routerLink]="['/admin/orders', order.id]" class="font-medium text-indigo-700 hover:underline dark:text-indigo-200">
                          {{ order.reference_code || order.id }}
                        </a>
                        <span class="text-xs text-slate-500 dark:text-slate-400">
                          {{ order.status }} · {{ order.total_amount }} {{ order.currency }}
                        </span>
                      </li>
                    </ul>
                  </div>

                  <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.users.ticketsTitle' | translate }}
                    </p>
                    <p *ngIf="profile.tickets.length === 0" class="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.users.ticketsEmpty' | translate }}
                    </p>
                    <ul *ngIf="profile.tickets.length > 0" class="mt-2 grid gap-2">
                      <li *ngFor="let ticket of profile.tickets | slice: 0:5" class="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                        <div class="flex items-center justify-between gap-2">
                          <span class="font-medium text-slate-900 dark:text-slate-50 truncate">
                            {{ ticket.topic }} · {{ ticket.status }}
                          </span>
                          <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">{{ ticket.created_at | date: 'short' }}</span>
                        </div>
                        <div *ngIf="ticket.order_reference" class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                          {{ ticket.order_reference }}
                        </div>
                      </li>
                    </ul>
                  </div>

                  <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.users.activityTitle' | translate }}
                    </p>
                    <p *ngIf="profile.security_events.length === 0" class="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.users.activityEmpty' | translate }}
                    </p>
                    <ul *ngIf="profile.security_events.length > 0" class="mt-2 grid gap-2">
                      <li *ngFor="let ev of profile.security_events | slice: 0:5" class="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                        <span class="font-medium text-slate-900 dark:text-slate-50 truncate">
                          {{ ev.event_type }}
                        </span>
                        <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                          {{ ev.ip_address || '—' }} · {{ ev.created_at | date: 'short' }}
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>
              </ng-container>
            </div>
          </div>
	        </section>
	      </div>

	      <ng-container *ngIf="roleChangeOpen() && selectedUser() as u">
	        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" (click)="closeRoleChange()">
	          <div
	            class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900"
	            (click)="$event.stopPropagation()"
	          >
	            <div class="flex items-start justify-between gap-3">
	              <div class="grid gap-1">
	                <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.users.setRole' | translate }}</h3>
	                <div class="text-xs text-slate-600 dark:text-slate-300">{{ identityLabel(u) }}</div>
	              </div>
	              <button
	                type="button"
	                class="rounded-md px-2 py-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50"
	                (click)="closeRoleChange()"
	                [attr.aria-label]="'adminUi.actions.cancel' | translate"
	              >
	                ✕
	              </button>
	            </div>

	            <p class="mt-3 text-sm text-slate-700 dark:text-slate-200">
	              {{ 'adminUi.users.rolePasswordPrompt' | translate }}
	            </p>

	            <div class="mt-3">
	              <app-input
	                [label]="'adminUi.users.rolePasswordLabel' | translate"
	                type="password"
	                [(value)]="roleChangePassword"
	                [placeholder]="'auth.password' | translate"
	                autocomplete="current-password"
	              ></app-input>
	            </div>
	            <div *ngIf="roleChangeError()" class="mt-2 text-sm text-rose-700 dark:text-rose-300">{{ roleChangeError() }}</div>

	            <div class="mt-4 flex justify-end gap-2">
	              <app-button
	                size="sm"
	                variant="ghost"
	                [label]="'adminUi.actions.cancel' | translate"
	                [disabled]="roleChangeBusy()"
	                (action)="closeRoleChange()"
	              ></app-button>
	              <app-button
	                size="sm"
	                [label]="'adminUi.users.setRole' | translate"
	                [disabled]="roleChangeBusy()"
	                (action)="confirmRoleChange()"
	              ></app-button>
	            </div>
	          </div>
	        </div>
	      </ng-container>
	    </div>
	  `
})
export class AdminUsersComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin', url: '/admin/dashboard' },
    { label: 'adminUi.users.title' }
  ];

  readonly userRowHeight = 44;
  readonly tableColumns = USERS_TABLE_COLUMNS;
  readonly tableDefaults = defaultUsersTableLayout();

  layoutModalOpen = signal(false);
  tableLayout = signal<AdminTableLayoutV1>(defaultUsersTableLayout());

  loading = signal(true);
  error = signal<string | null>(null);
  errorRequestId = signal<string | null>(null);
  users = signal<AdminUserListItem[]>([]);
  meta = signal<AdminUserListResponse['meta'] | null>(null);
  piiReveal = signal(false);

  q = '';
  role: RoleFilter = 'all';
  page = 1;
  limit = 25;
  selectedSavedViewKey = '';

  selectedUser = signal<AdminUserListItem | null>(null);
  selectedRole = 'customer';
  roleChangeOpen = signal(false);
  roleChangeBusy = signal(false);
  roleChangeError = signal<string | null>(null);
  roleChangePassword = '';

  aliases = signal<AdminUserAliasesResponse | null>(null);
  aliasesLoading = signal(false);
  aliasesError = signal<string | null>(null);

  profile = signal<AdminUserProfileResponse | null>(null);
  profileLoading = signal(false);
  profileError = signal<string | null>(null);

  vip = false;
  adminNote = '';
  internalBusy = signal(false);
  impersonateBusy = signal(false);
  lockedReason = '';
  passwordResetRequired = false;
  securityBusy = signal(false);

  emailHistory = signal<AdminEmailVerificationHistoryResponse | null>(null);
  emailHistoryLoading = signal(false);
  emailHistoryError = signal<string | null>(null);
  emailVerificationBusy = signal(false);

  sessions = signal<AdminUserSession[] | null>(null);
  sessionsLoading = signal(false);
  sessionsError = signal<string | null>(null);
  revokingSessionId = signal<string | null>(null);

  couponPromotions = signal<PromotionRead[] | null>(null);
  couponPromotionsLoading = signal(false);
  couponPromotionsError = signal<string | null>(null);
  couponPromotionId = '';
  couponPrefix = '';
  couponValidityDays: string | number = 30;
  couponSendEmail = true;
  couponIssueBusy = signal(false);
  couponIssueError = signal<string | null>(null);
  couponIssuedCode = signal<string | null>(null);

  private pendingPrefillSearch: string | null = null;
  private autoSelectAfterLoad = false;

  constructor(
    private usersApi: AdminUsersService,
    private couponsApi: AdminCouponsV2Service,
    private admin: AdminService,
    private auth: AuthService,
    private recent: AdminRecentService,
    private toast: ToastService,
    private translate: TranslateService,
    public favorites: AdminFavoritesService
  ) {}

  ngOnInit(): void {
    this.favorites.init();
    this.tableLayout.set(loadAdminTableLayout(this.tableLayoutStorageKey(), this.tableColumns, this.tableDefaults));
    const state = history.state as any;
    const appliedSavedView = this.maybeApplyFiltersFromState(state);
    if (!appliedSavedView) {
      const prefill = typeof state?.prefillUserSearch === 'string' ? state.prefillUserSearch : '';
      this.pendingPrefillSearch = prefill.trim() ? prefill.trim() : null;
      this.autoSelectAfterLoad = Boolean(state?.autoSelectFirst);
      if (this.pendingPrefillSearch) {
        this.q = this.pendingPrefillSearch;
        this.page = 1;
      }
    }
    this.load();
  }

  openLayoutModal(): void {
    this.layoutModalOpen.set(true);
  }

  closeLayoutModal(): void {
    this.layoutModalOpen.set(false);
  }

  applyTableLayout(layout: AdminTableLayoutV1): void {
    this.tableLayout.set(layout);
    saveAdminTableLayout(this.tableLayoutStorageKey(), layout);
  }

  toggleDensity(): void {
    const current = this.tableLayout();
    const next: AdminTableLayoutV1 = {
      ...current,
      density: current.density === 'compact' ? 'comfortable' : 'compact',
    };
    this.applyTableLayout(next);
  }

  densityToggleLabelKey(): string {
    return this.tableLayout().density === 'compact'
      ? 'adminUi.tableLayout.densityToggle.toComfortable'
      : 'adminUi.tableLayout.densityToggle.toCompact';
  }

  visibleColumnIds(): string[] {
    return visibleAdminTableColumnIds(this.tableLayout(), this.tableColumns);
  }

  trackColumnId(_: number, colId: string): string {
    return colId;
  }

  cellPaddingClass(): string {
    return adminTableCellPaddingClass(this.tableLayout().density);
  }

  private tableLayoutStorageKey(): string {
    return adminTableLayoutStorageKey('users', this.auth.user()?.id);
  }

  applyFilters(): void {
    this.page = 1;
    this.selectedSavedViewKey = '';
    this.load();
  }

  resetFilters(): void {
    this.q = '';
    this.role = 'all';
    this.page = 1;
    this.selectedSavedViewKey = '';
    this.load();
  }

  savedViews(): AdminFavoriteItem[] {
    return this.favorites
      .items()
      .filter((item) => item?.type === 'filter' && (item?.state as any)?.adminFilterScope === 'users');
  }

  applySavedView(key: string): void {
    this.selectedSavedViewKey = key;
    if (!key) return;
    const view = this.savedViews().find((item) => item.key === key);
    const filters = view?.state && typeof view.state === 'object' ? (view.state as any).adminFilters : null;
    if (!filters || typeof filters !== 'object') return;

    this.q = String(filters.q ?? '');
    this.role = (filters.role ?? 'all') as RoleFilter;
    const nextLimit = typeof filters.limit === 'number' && Number.isFinite(filters.limit) ? filters.limit : this.limit;
    this.limit = nextLimit;
    this.page = 1;
    this.load();
  }

  isCurrentViewPinned(): boolean {
    return this.favorites.isFavorite(this.currentViewFavoriteKey());
  }

  toggleCurrentViewPin(): void {
    const key = this.currentViewFavoriteKey();
    if (this.favorites.isFavorite(key)) {
      this.favorites.remove(key);
      if (this.selectedSavedViewKey === key) this.selectedSavedViewKey = '';
      return;
    }

    const name = (window.prompt(this.translate.instant('adminUi.favorites.savedViews.prompt')) ?? '').trim();
    if (!name) {
      this.toast.error(this.translate.instant('adminUi.favorites.savedViews.errors.nameRequired'));
      return;
    }

    const filters = this.currentViewFilters();
    this.favorites.add({
      key,
      type: 'filter',
      label: name,
      subtitle: '',
      url: '/admin/users',
      state: { adminFilterScope: 'users', adminFilters: filters }
    });
    this.selectedSavedViewKey = key;
  }

  private maybeApplyFiltersFromState(state: any): boolean {
    const scope = (state?.adminFilterScope || '').toString();
    if (scope !== 'users') return false;
    const filters = state?.adminFilters;
    if (!filters || typeof filters !== 'object') return false;

    this.q = String(filters.q ?? '');
    this.role = (filters.role ?? 'all') as RoleFilter;
    const nextLimit = typeof filters.limit === 'number' && Number.isFinite(filters.limit) ? filters.limit : this.limit;
    this.limit = nextLimit;
    this.page = 1;
    this.selectedSavedViewKey = this.currentViewFavoriteKey();
    this.pendingPrefillSearch = null;
    this.autoSelectAfterLoad = false;
    return true;
  }

  private currentViewFilters(): { q: string; role: RoleFilter; limit: number } {
    return {
      q: this.q,
      role: this.role,
      limit: this.limit
    };
  }

  private currentViewFavoriteKey(): string {
    return adminFilterFavoriteKey('users', this.currentViewFilters());
  }

  goToPage(page: number): void {
    this.page = page;
    this.load();
  }

  trackUserId(_: number, user: AdminUserListItem): string {
    return user.id;
  }

  select(user: AdminUserListItem): void {
    const email = (user.email || '').toString().trim();
    this.recent.add({
      key: `user:${user.id}`,
      type: 'user',
      label: this.identityLabel(user),
      subtitle: email,
      url: '/admin/users',
      state: email ? { prefillUserSearch: email, autoSelectFirst: true } : null
    });
    this.selectedUser.set(user);
    this.selectedRole = user.role;
    this.vip = false;
    this.adminNote = '';
    this.lockedReason = '';
    this.passwordResetRequired = false;
    this.emailHistory.set(null);
    this.emailHistoryError.set(null);
    this.sessions.set(null);
    this.sessionsError.set(null);
    this.couponIssueError.set(null);
    this.couponIssuedCode.set(null);
    this.loadAliases(user.id);
    this.loadProfile(user.id);
    this.loadSessions(user.id);
    this.ensureCouponPromotions();
  }

  updateRole(): void {
    const user = this.selectedUser();
    if (!user) return;
    if (user.role === 'owner') return;
    if (this.selectedRole === user.role) return;
    this.roleChangePassword = '';
    this.roleChangeError.set(null);
    this.roleChangeOpen.set(true);
  }

  closeRoleChange(): void {
    this.roleChangeOpen.set(false);
    this.roleChangeBusy.set(false);
    this.roleChangeError.set(null);
    this.roleChangePassword = '';
  }

  confirmRoleChange(): void {
    const user = this.selectedUser();
    if (!user) return;
    if (user.role === 'owner') return;
    if (this.selectedRole === user.role) {
      this.closeRoleChange();
      return;
    }
    const password = this.roleChangePassword.trim();
    if (!password) {
      this.roleChangeError.set(this.t('adminUi.users.rolePasswordRequired'));
      return;
    }

    this.roleChangeBusy.set(true);
    this.roleChangeError.set(null);
    this.admin.updateUserRole(user.id, this.selectedRole, password).subscribe({
      next: (updated) => {
        this.toast.success(this.t('adminUi.users.success.role'));
        this.selectedUser.set({ ...user, role: updated.role });
        this.users.set(this.users().map((u) => (u.id === user.id ? { ...u, role: updated.role } : u)));
        const profile = this.profile();
        if (profile) this.profile.set({ ...profile, user: { ...profile.user, role: updated.role } });
        this.closeRoleChange();
      },
      error: (err) => {
        const msg = err?.error?.detail || this.t('adminUi.users.errors.role');
        this.roleChangeError.set(msg);
        this.toast.error(msg);
        this.roleChangeBusy.set(false);
      }
    });
  }

  forceLogout(): void {
    const user = this.selectedUser();
    if (!user) return;
    this.admin.revokeSessions(user.id).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.users.success.revoke'));
        this.sessions.set([]);
      },
      error: () => this.toast.error(this.t('adminUi.users.errors.revoke'))
    });
  }

  refreshSessions(): void {
    const user = this.selectedUser();
    if (!user) return;
    this.loadSessions(user.id);
  }

  revokeOneSession(sessionId: string): void {
    const user = this.selectedUser();
    if (!user) return;
    this.revokingSessionId.set(sessionId);
    this.admin.revokeSession(user.id, sessionId).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.users.success.sessionRevoked'));
        const current = this.sessions();
        if (current) {
          this.sessions.set(current.filter((s) => s.id !== sessionId));
        }
        this.revokingSessionId.set(null);
      },
      error: () => {
        this.toast.error(this.t('adminUi.users.errors.sessionRevoke'));
        this.revokingSessionId.set(null);
      }
    });
  }

  saveInternal(): void {
    const user = this.selectedUser();
    if (!user) return;
    this.internalBusy.set(true);
    this.usersApi
      .updateInternal(user.id, { vip: this.vip, admin_note: this.adminNote.trim() ? this.adminNote.trim() : null })
      .subscribe({
        next: (updated) => {
          const profile = this.profile();
          if (profile) {
            this.profile.set({ ...profile, user: { ...profile.user, ...updated } });
          }
          this.vip = Boolean(updated?.vip);
          this.adminNote = (updated?.admin_note || '').toString();
          this.toast.success(this.t('adminUi.users.success.internal'));
          this.internalBusy.set(false);
        },
        error: () => {
          this.toast.error(this.t('adminUi.users.errors.internal'));
          this.internalBusy.set(false);
        }
      });
  }

  isLocked(): boolean {
    const until = this.profile()?.user?.locked_until;
    if (!until) return false;
    const ts = new Date(until).getTime();
    return Number.isFinite(ts) && ts > Date.now();
  }

  isOwner(): boolean {
    return (this.auth.role() || '').toString() === 'owner';
  }

  canManageRoles(): boolean {
    return this.auth.isAdmin();
  }

  canIssueCoupons(): boolean {
    return this.auth.canAccessAdminSection('coupons');
  }

  ensureCouponPromotions(force = false): void {
    if (!this.canIssueCoupons()) return;
    if (!force && this.couponPromotions() !== null) return;
    this.couponPromotionsLoading.set(true);
    this.couponPromotionsError.set(null);
    this.couponsApi.listPromotions().subscribe({
      next: (promos) => {
        const list = promos || [];
        this.couponPromotions.set(list);
        if (!this.couponPromotionId && list.length > 0) {
          this.couponPromotionId = list[0].id;
        }
        this.couponPromotionsLoading.set(false);
      },
      error: () => {
        this.couponPromotionsError.set(this.t('adminUi.users.errors.couponPromotions'));
        this.couponPromotions.set([]);
        this.couponPromotionsLoading.set(false);
      }
    });
  }

  issueCoupon(): void {
    const user = this.selectedUser();
    if (!user) return;
    if (!this.canIssueCoupons()) return;
    const promotionId = (this.couponPromotionId || '').trim();
    if (!promotionId) return;

    const prefix = this.couponPrefix.trim() ? this.couponPrefix.trim() : null;
    const rawDays = typeof this.couponValidityDays === 'string' ? Number(this.couponValidityDays) : this.couponValidityDays;
    const validityDays = Number.isFinite(rawDays) && Number(rawDays) > 0 ? Math.floor(Number(rawDays)) : null;

    this.couponIssueBusy.set(true);
    this.couponIssueError.set(null);
    this.couponIssuedCode.set(null);
    this.couponsApi
      .issueCouponToUser({
        user_id: user.id,
        promotion_id: promotionId,
        prefix,
        validity_days: validityDays,
        send_email: this.couponSendEmail
      })
      .subscribe({
        next: (coupon) => {
          this.couponIssuedCode.set(coupon.code);
          this.toast.success(this.t('adminUi.users.success.couponIssued'));
          this.couponIssueBusy.set(false);
        },
        error: () => {
          this.couponIssueError.set(this.t('adminUi.users.errors.couponIssued'));
          this.toast.error(this.t('adminUi.users.errors.couponIssued'));
          this.couponIssueBusy.set(false);
        }
      });
  }

  copyIssuedCoupon(): void {
    const code = this.couponIssuedCode();
    if (!code) return;
    void navigator.clipboard?.writeText(code);
    this.toast.success(this.t('adminUi.users.success.couponCopied'));
  }

  lockForMinutes(minutes: number): void {
    const user = this.selectedUser();
    if (!user) return;
    const mins = Math.max(1, Number(minutes) || 0);
    const untilIso = new Date(Date.now() + mins * 60_000).toISOString();
    const reason = this.lockedReason.trim() ? this.lockedReason.trim() : null;
    this.securityBusy.set(true);
    this.usersApi.updateSecurity(user.id, { locked_until: untilIso, locked_reason: reason }).subscribe({
      next: (updated) => {
        const profile = this.profile();
        if (profile) {
          this.profile.set({ ...profile, user: { ...profile.user, ...updated } });
        }
        this.lockedReason = (updated?.locked_reason || '').toString();
        this.passwordResetRequired = Boolean(updated?.password_reset_required);
        this.toast.success(this.t('adminUi.users.success.security'));
        this.securityBusy.set(false);
      },
      error: () => {
        this.toast.error(this.t('adminUi.users.errors.security'));
        this.securityBusy.set(false);
      }
    });
  }

  unlock(): void {
    const user = this.selectedUser();
    if (!user) return;
    this.securityBusy.set(true);
    this.usersApi.updateSecurity(user.id, { locked_until: null, locked_reason: null }).subscribe({
      next: (updated) => {
        const profile = this.profile();
        if (profile) {
          this.profile.set({ ...profile, user: { ...profile.user, ...updated } });
        }
        this.lockedReason = '';
        this.passwordResetRequired = Boolean(updated?.password_reset_required);
        this.toast.success(this.t('adminUi.users.success.security'));
        this.securityBusy.set(false);
      },
      error: () => {
        this.toast.error(this.t('adminUi.users.errors.security'));
        this.securityBusy.set(false);
      }
    });
  }

  saveSecurity(): void {
    const user = this.selectedUser();
    if (!user) return;
    const reason = this.lockedReason.trim() ? this.lockedReason.trim() : null;
    this.securityBusy.set(true);
    this.usersApi.updateSecurity(user.id, { password_reset_required: this.passwordResetRequired, locked_reason: reason }).subscribe({
      next: (updated) => {
        const profile = this.profile();
        if (profile) {
          this.profile.set({ ...profile, user: { ...profile.user, ...updated } });
        }
        this.lockedReason = (updated?.locked_reason || '').toString();
        this.passwordResetRequired = Boolean(updated?.password_reset_required);
        this.toast.success(this.t('adminUi.users.success.security'));
        this.securityBusy.set(false);
      },
      error: () => {
        this.toast.error(this.t('adminUi.users.errors.security'));
        this.securityBusy.set(false);
      }
    });
  }

  loadEmailHistory(): void {
    const user = this.selectedUser();
    if (!user) return;
    this.emailHistoryLoading.set(true);
    this.emailHistoryError.set(null);
    this.usersApi.getEmailVerificationHistory(user.id).subscribe({
      next: (res) => {
        this.emailHistory.set(res);
        this.emailHistoryLoading.set(false);
      },
      error: () => {
        this.emailHistoryError.set(this.t('adminUi.users.errors.verificationHistory'));
        this.emailHistoryLoading.set(false);
      }
    });
  }

  resendVerification(): void {
    const user = this.selectedUser();
    if (!user) return;
    this.emailVerificationBusy.set(true);
    this.usersApi.resendEmailVerification(user.id).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.users.success.verificationResent'));
        this.emailVerificationBusy.set(false);
        this.loadEmailHistory();
      },
      error: () => {
        this.toast.error(this.t('adminUi.users.errors.verificationResent'));
        this.emailVerificationBusy.set(false);
      }
    });
  }

  overrideVerification(): void {
    const user = this.selectedUser();
    if (!user) return;
    this.emailVerificationBusy.set(true);
    this.usersApi.overrideEmailVerification(user.id).subscribe({
      next: (updated) => {
        const profile = this.profile();
        if (profile) {
          this.profile.set({ ...profile, user: { ...profile.user, ...updated } });
        }
        const nextVerified = Boolean(updated?.email_verified);
        this.selectedUser.set({ ...user, email_verified: nextVerified });
        this.users.set(this.users().map((u) => (u.id === user.id ? { ...u, email_verified: nextVerified } : u)));
        this.toast.success(this.t('adminUi.users.success.verificationOverridden'));
        this.emailVerificationBusy.set(false);
        this.loadEmailHistory();
      },
      error: () => {
        this.toast.error(this.t('adminUi.users.errors.verificationOverridden'));
        this.emailVerificationBusy.set(false);
      }
    });
  }

  impersonate(): void {
    const user = this.selectedUser();
    if (!user) return;
    this.impersonateBusy.set(true);
    this.usersApi.impersonate(user.id).subscribe({
      next: (res) => {
        const token = (res?.access_token || '').toString();
        if (!token) {
          this.toast.error(this.t('adminUi.users.errors.impersonate'));
          this.impersonateBusy.set(false);
          return;
        }
        const url = `${window.location.origin}/#impersonate=${encodeURIComponent(token)}`;
        window.open(url, '_blank', 'noopener');
        this.toast.success(this.t('adminUi.users.success.impersonate'));
        this.impersonateBusy.set(false);
      },
      error: () => {
        this.toast.error(this.t('adminUi.users.errors.impersonate'));
        this.impersonateBusy.set(false);
      }
    });
  }

  identityLabel(user: AdminUserListItem): string {
    return formatIdentity(user, user.email);
  }

  canRevealPii(): boolean {
    const role = (this.auth.role() || '').toString();
    return role === 'owner' || role === 'admin' || role === 'support' || role === 'fulfillment';
  }

  togglePiiReveal(): void {
    if (!this.canRevealPii()) return;
    this.piiReveal.set(!this.piiReveal());
    this.load();
    const user = this.selectedUser();
    if (user) {
      this.loadAliases(user.id);
      this.loadProfile(user.id);
    }
  }

  rolePillClass(role: string): string {
    if (role === 'owner') return 'bg-indigo-100 text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-100';
    if (role === 'admin') return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100';
    if (role === 'support') return 'bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-100';
    if (role === 'fulfillment') return 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100';
    if (role === 'content') return 'bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/30 dark:text-fuchsia-100';
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
  }

  sessionDeviceLabel(session: AdminUserSession): string {
    const ua = (session.user_agent || '').toString().trim();
    if (!ua) return this.t('adminUi.users.unknownDevice');
    return ua.length > 140 ? `${ua.slice(0, 140)}…` : ua;
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.errorRequestId.set(null);
    this.usersApi
      .search({
        q: this.q.trim() ? this.q.trim() : undefined,
        role: this.role === 'all' ? undefined : this.role,
        page: this.page,
        limit: this.limit,
        include_pii: this.piiReveal() ? true : undefined
      })
      .subscribe({
        next: (res) => {
          const items = res.items || [];
          this.users.set(items);
          this.meta.set(res.meta || null);
          this.loading.set(false);

          const selected = this.selectedUser();
          if (selected) {
            const refreshed = items.find((u) => u.id === selected.id);
            if (refreshed) this.selectedUser.set(refreshed);
          }

          if (this.autoSelectAfterLoad && items.length > 0) {
            const needle = (this.pendingPrefillSearch || '').trim().toLowerCase();
            const match =
              items.find((u) => (u.id || '').toLowerCase() === needle) ||
              items.find((u) => (u.username || '').toLowerCase() === needle) ||
              items.find((u) => (u.email || '').toLowerCase() === needle) ||
              items[0];
            this.autoSelectAfterLoad = false;
            this.pendingPrefillSearch = null;
            this.select(match);
          }
        },
        error: (err) => {
          if (err?.status === 403 && this.piiReveal()) {
            this.piiReveal.set(false);
            this.toast.error(this.t('adminUi.pii.notAuthorized'));
            this.load();
            return;
          }
          this.error.set(this.t('adminUi.users.errors.load'));
          this.errorRequestId.set(extractRequestId(err));
          this.loading.set(false);
        }
      });
  }

  retryLoad(): void {
    this.load();
  }

  private loadAliases(userId: string): void {
    this.aliasesLoading.set(true);
    this.aliasesError.set(null);
    this.aliases.set(null);
    this.admin.userAliases(userId, { include_pii: this.piiReveal() }).subscribe({
      next: (res) => {
        this.aliases.set(res);
        this.aliasesLoading.set(false);
      },
      error: () => {
        this.aliasesError.set(this.t('adminUi.users.errors.aliases'));
        this.aliasesLoading.set(false);
      }
    });
  }

  private loadProfile(userId: string): void {
    this.profileLoading.set(true);
    this.profileError.set(null);
    this.profile.set(null);
    this.usersApi.getProfile(userId, { include_pii: this.piiReveal() }).subscribe({
      next: (res) => {
        this.profile.set(res);
        this.vip = Boolean(res?.user?.vip);
        this.adminNote = (res?.user?.admin_note || '').toString();
        this.lockedReason = (res?.user?.locked_reason || '').toString();
        this.passwordResetRequired = Boolean(res?.user?.password_reset_required);
        this.profileLoading.set(false);
      },
      error: () => {
        this.profileError.set(this.t('adminUi.users.errors.profile'));
        this.profileLoading.set(false);
      }
    });
  }

  private t(key: string): string {
    return this.translate.instant(key) as string;
  }

  private loadSessions(userId: string): void {
    this.sessionsLoading.set(true);
    this.sessionsError.set(null);
    this.sessions.set(null);
    this.admin.listUserSessions(userId).subscribe({
      next: (sessions) => {
        this.sessions.set(sessions || []);
        this.sessionsLoading.set(false);
      },
      error: () => {
        this.sessionsError.set(this.t('adminUi.users.errors.sessionsLoad'));
        this.sessionsLoading.set(false);
      }
    });
  }
}
