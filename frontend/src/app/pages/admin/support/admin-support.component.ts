import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BreadcrumbComponent, Crumb } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { extractRequestId } from '../../../shared/http-error';
import { InputComponent } from '../../../shared/input.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { AdminPageHeaderComponent } from '../shared/admin-page-header.component';
import { ToastService } from '../../../core/toast.service';
import { AuthService } from '../../../core/auth.service';
import {
  AdminContactSubmissionListItem,
  AdminContactSubmissionRead,
  AdminSupportService,
  SupportAgentRef,
  SupportCannedResponseRead,
  SupportSlaSettings,
  SupportStatus,
  SupportTopic
} from '../../../core/admin-support.service';

@Component({
  selector: 'app-admin-support',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    BreadcrumbComponent,
    ButtonComponent,
    ErrorStateComponent,
    InputComponent,
    SkeletonComponent,
    AdminPageHeaderComponent
  ],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <app-admin-page-header [titleKey]="'adminUi.support.title'" [hintKey]="'adminUi.support.subtitle'"></app-admin-page-header>

	      <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
	        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_220px_220px_1fr_220px_auto] items-end">
	          <app-input
	            [label]="'adminUi.support.filters.search' | translate"
	            [(value)]="q"
	            [placeholder]="'adminUi.support.filters.searchPlaceholder' | translate"
	            [ariaLabel]="'adminUi.support.filters.search' | translate"
	          ></app-input>
	
	          <label class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
	            <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'adminUi.support.filters.topic' | translate }}</span>
	            <select
	              class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
	              [(ngModel)]="channel"
	            >
	              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="">
	                {{ 'adminUi.support.filters.topicAll' | translate }}
	              </option>
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="contact">
                {{ 'adminUi.support.topics.contact' | translate }}
              </option>
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="support">
                {{ 'adminUi.support.topics.support' | translate }}
              </option>
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="refund">
                {{ 'adminUi.support.topics.refund' | translate }}
              </option>
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="dispute">
                {{ 'adminUi.support.topics.dispute' | translate }}
              </option>
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="feedback">
                {{ 'adminUi.support.topics.feedback' | translate }}
              </option>
	            </select>
	          </label>
	
	          <label class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
	            <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'adminUi.support.filters.status' | translate }}</span>
	            <select
	              class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
	              [(ngModel)]="status"
	            >
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="">
                {{ 'adminUi.support.filters.statusAll' | translate }}
              </option>
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="new">
                {{ 'adminUi.support.status.new' | translate }}
              </option>
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="triaged">
                {{ 'adminUi.support.status.triaged' | translate }}
              </option>
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="resolved">
                {{ 'adminUi.support.status.resolved' | translate }}
              </option>
	            </select>
	          </label>

	          <app-input
	            [label]="'adminUi.support.filters.customer' | translate"
	            [(value)]="customerFilter"
	            [placeholder]="'adminUi.support.filters.customerPlaceholder' | translate"
	            [ariaLabel]="'adminUi.support.filters.customer' | translate"
	          ></app-input>

	          <label class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
	            <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'adminUi.support.filters.assignee' | translate }}</span>
	            <select
	              class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
	              [(ngModel)]="assigneeFilter"
	            >
	              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="">
	                {{ 'adminUi.support.filters.assigneeAll' | translate }}
	              </option>
	              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="unassigned">
	                {{ 'adminUi.support.filters.assigneeUnassigned' | translate }}
	              </option>
	              <option
	                *ngFor="let a of assignees()"
	                class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"
	                [value]="a.id"
	              >
	                {{ formatAgent(a) }}
	              </option>
	            </select>
	          </label>
	
	          <app-button size="sm" [label]="'adminUi.support.filters.apply' | translate" (action)="applyFilters()"></app-button>
	        </div>

        <div class="grid lg:grid-cols-[1fr_420px] gap-4 items-start">
          <div class="grid gap-3">
            <div *ngIf="loading()" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <app-skeleton [rows]="6"></app-skeleton>
            </div>

            <app-error-state
              *ngIf="!loading() && error()"
              [message]="error()"
              [requestId]="errorRequestId()"
              [showRetry]="true"
              (retry)="retryLoad()"
            ></app-error-state>

            <div *ngIf="!loading() && !items().length" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.support.empty' | translate }}
            </div>

            <details class="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
              <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                {{ 'adminUi.support.sla.title' | translate }}
              </summary>
              <div class="mt-3 grid gap-3">
                <p class="text-xs text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.support.sla.current' | translate: { first: slaFirstReplyHours, resolution: slaResolutionHours } }}
                </p>
                <div *ngIf="canEditSlaSettings()" class="grid sm:grid-cols-2 gap-3">
                  <app-input
                    [label]="'adminUi.support.sla.firstReplyHours' | translate"
                    type="number"
                    [min]="1"
                    [max]="720"
                    [step]="1"
                    [(value)]="slaFirstReplyHoursDraft"
                  ></app-input>
                  <app-input
                    [label]="'adminUi.support.sla.resolutionHours' | translate"
                    type="number"
                    [min]="1"
                    [max]="720"
                    [step]="1"
                    [(value)]="slaResolutionHoursDraft"
                  ></app-input>
                </div>
                <div *ngIf="canEditSlaSettings()" class="flex items-center gap-2 text-sm">
                  <app-button size="sm" [label]="'adminUi.actions.save' | translate" [disabled]="slaSettingsSaving" (action)="saveSlaSettings()"></app-button>
                  <span class="text-xs text-emerald-700 dark:text-emerald-300" *ngIf="slaSettingsMessage">{{ slaSettingsMessage }}</span>
                  <span class="text-xs text-rose-700 dark:text-rose-300" *ngIf="slaSettingsError">{{ slaSettingsError }}</span>
                </div>
              </div>
            </details>

	            <div *ngIf="items().length" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
	              <table class="min-w-[860px] w-full text-sm">
	                <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
	                  <tr>
	                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.support.table.date' | translate }}</th>
	                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.support.table.topic' | translate }}</th>
	                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.support.table.status' | translate }}</th>
	                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.support.table.sla' | translate }}</th>
	                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.support.table.assignee' | translate }}</th>
	                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.support.table.from' | translate }}</th>
	                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.support.table.order' | translate }}</th>
	                  </tr>
		                </thead>
	                <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
	                  <tr
	                    *ngFor="let row of items()"
	                    class="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
	                    [ngClass]="row.id === selectedId() ? 'bg-slate-100 dark:bg-slate-800/70' : ''"
	                    (click)="select(row)"
	                  >
	                    <td class="px-3 py-2 whitespace-nowrap text-slate-700 dark:text-slate-200">
	                      {{ row.created_at | date: 'short' }}
	                    </td>
                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {{ ('adminUi.support.topics.' + row.topic) | translate }}
                    </td>
	                    <td class="px-3 py-2">
	                      <span class="inline-flex rounded-full px-2 py-0.5 text-xs border border-slate-200 dark:border-slate-700">
	                        {{ ('adminUi.support.status.' + row.status) | translate }}
	                      </span>
	                    </td>
	                    <td class="px-3 py-2">
	                      <ng-container *ngIf="slaInfo(row) as sla; else slaNone">
	                        <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold" [ngClass]="sla.class">
	                          {{ sla.label }}
	                        </span>
	                      </ng-container>
	                      <ng-template #slaNone>—</ng-template>
	                    </td>
	                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
	                      <span class="text-xs text-slate-600 dark:text-slate-300">
	                        {{ row.assignee ? formatAgent(row.assignee) : '—' }}
	                      </span>
	                    </td>
	                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
	                      <div class="font-medium text-slate-900 dark:text-slate-50">{{ row.name }}</div>
	                      <div class="text-xs text-slate-500 dark:text-slate-400">{{ row.email }}</div>
	                    </td>
                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                      <span class="font-mono text-xs text-slate-600 dark:text-slate-400">{{ row.order_reference || '—' }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div *ngIf="items().length" class="flex items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
              <span>
                {{
                  'adminUi.support.pagination' | translate: { page: meta().page || 1, total: meta().total_pages || 1, count: meta().total_items || 0 }
                }}
              </span>
              <div class="flex items-center gap-2">
                <app-button size="sm" [disabled]="!hasPrev()" [label]="'adminUi.support.prev' | translate" (action)="prev()"></app-button>
                <app-button size="sm" [disabled]="!hasNext()" [label]="'adminUi.support.next' | translate" (action)="next()"></app-button>
              </div>
            </div>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-3 dark:border-slate-800 dark:bg-slate-900">
            <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.support.detail.title' | translate }}</div>

            <div *ngIf="detailLoading()" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <app-skeleton [rows]="5"></app-skeleton>
            </div>

            <div *ngIf="!detailLoading() && !selected()" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.support.detail.empty' | translate }}
            </div>

            <div *ngIf="selected()" class="grid gap-3 text-sm text-slate-700 dark:text-slate-200">
              <div class="grid gap-1">
                <div class="font-semibold text-slate-900 dark:text-slate-50">{{ selected()!.name }}</div>
                <a class="text-indigo-600 hover:underline dark:text-indigo-300" [href]="'mailto:' + selected()!.email">
                  {{ selected()!.email }}
                </a>
              </div>

	              <div class="grid gap-1">
	                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.support.detail.meta' | translate }}</div>
	                <div class="flex flex-wrap gap-2">
	                  <span class="inline-flex rounded-full px-2 py-0.5 text-xs border border-slate-200 dark:border-slate-700">
	                    {{ ('adminUi.support.topics.' + selected()!.topic) | translate }}
	                  </span>
	                  <span class="inline-flex rounded-full px-2 py-0.5 text-xs border border-slate-200 dark:border-slate-700">
	                    {{ ('adminUi.support.status.' + selected()!.status) | translate }}
	                  </span>
	                  <span
	                    *ngIf="selected()!.assignee"
	                    class="inline-flex rounded-full px-2 py-0.5 text-xs border border-slate-200 dark:border-slate-700"
	                  >
	                    {{ 'adminUi.support.detail.assigneeChip' | translate }}: {{ formatAgent(selected()!.assignee!) }}
	                  </span>
	                  <span class="text-xs text-slate-500 dark:text-slate-400">
	                    {{ selected()!.created_at | date: 'medium' }}
	                  </span>
	                </div>
                <div *ngIf="selected()!.order_reference" class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.support.detail.order' | translate }}:
                  <span class="font-mono">{{ selected()!.order_reference }}</span>
                </div>
              </div>

              <div class="grid gap-1">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.support.detail.message' | translate }}</div>
                <div class="rounded-xl border border-slate-200 p-3 whitespace-pre-wrap leading-relaxed dark:border-slate-800">
                  {{ selected()!.message }}
                </div>
              </div>

              <div *ngIf="selected()!.messages?.length" class="grid gap-1">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.support.detail.thread' | translate }}
                </div>
                <div class="grid gap-3">
                  <div
                    *ngFor="let m of selected()!.messages"
                    class="rounded-xl border border-slate-200 p-3 whitespace-pre-wrap leading-relaxed dark:border-slate-800"
                    [ngClass]="m.from_admin ? 'bg-slate-50 dark:bg-slate-950/30' : 'bg-white dark:bg-slate-900'"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                        {{ m.from_admin ? ('adminUi.support.detail.fromSupport' | translate) : ('adminUi.support.detail.fromCustomer' | translate) }}
                      </div>
                      <div class="text-xs text-slate-500 dark:text-slate-400">{{ m.created_at | date: 'short' }}</div>
                    </div>
                    <div class="mt-2 text-slate-800 dark:text-slate-100">{{ m.message }}</div>
                  </div>
                </div>
              </div>

	              <div class="grid gap-2">
	                <div class="flex flex-wrap items-end justify-between gap-2">
	                  <div class="flex flex-wrap items-end gap-2">
	                    <label class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
	                      <span class="text-xs font-medium text-slate-600 dark:text-slate-300">
	                        {{ 'adminUi.support.detail.cannedLabel' | translate }}
	                      </span>
	                      <select
	                        class="h-11 w-full min-w-[220px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
	                        [(ngModel)]="cannedSelectedId"
	                      >
	                        <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="">
	                          {{ 'adminUi.support.detail.cannedNone' | translate }}
	                        </option>
	                        <option
	                          *ngFor="let t of activeCannedResponses()"
	                          class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"
	                          [value]="t.id"
	                        >
	                          {{ t.title }}
	                        </option>
	                      </select>
	                    </label>

	                    <label class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
	                      <span class="text-xs font-medium text-slate-600 dark:text-slate-300">
	                        {{ 'adminUi.support.detail.cannedLang' | translate }}
	                      </span>
	                      <select
	                        class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
	                        [(ngModel)]="cannedLang"
	                      >
	                        <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="en">EN</option>
	                        <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="ro">RO</option>
	                      </select>
	                    </label>

	                    <app-button
	                      size="sm"
	                      [disabled]="!cannedSelectedId || selected()!.status === 'resolved'"
	                      [label]="'adminUi.support.detail.cannedInsert' | translate"
	                      (action)="insertCanned()"
	                    ></app-button>
	                  </div>

	                  <app-button
	                    size="sm"
	                    [label]="
	                      showTemplates()
	                        ? ('adminUi.support.detail.cannedManageHide' | translate)
	                        : ('adminUi.support.detail.cannedManage' | translate)
	                    "
	                    (action)="toggleTemplates()"
	                  ></app-button>
	                </div>

	                <div
	                  *ngIf="showTemplates()"
	                  class="rounded-xl border border-slate-200 bg-slate-50 p-3 grid gap-3 dark:border-slate-800 dark:bg-slate-950/20"
	                >
	                  <div class="flex items-center justify-between gap-2">
	                    <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-300">
	                      {{ 'adminUi.support.templates.title' | translate }}
	                    </div>
	                    <div class="flex items-center gap-2">
	                      <app-button
	                        size="sm"
	                        [disabled]="cannedLoading()"
	                        [label]="'adminUi.actions.refresh' | translate"
	                        (action)="loadCanned()"
	                      ></app-button>
	                      <app-button size="sm" [label]="'adminUi.actions.add' | translate" (action)="startNewTemplate()"></app-button>
	                    </div>
	                  </div>

	                  <div *ngIf="cannedLoading()" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
	                    <app-skeleton [rows]="3"></app-skeleton>
	                  </div>

	                  <div *ngIf="!cannedLoading() && !cannedResponses().length" class="text-sm text-slate-600 dark:text-slate-300">
	                    {{ 'adminUi.support.templates.empty' | translate }}
	                  </div>

	                  <div *ngIf="!cannedLoading() && cannedResponses().length" class="grid gap-2">
	                    <div
	                      *ngFor="let t of cannedResponses()"
	                      class="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-start justify-between gap-3 dark:border-slate-800 dark:bg-slate-900"
	                    >
	                      <div class="grid gap-0.5">
	                        <div class="font-medium text-slate-900 dark:text-slate-50">
	                          {{ t.title }}
	                        </div>
	                        <div class="text-xs text-slate-500 dark:text-slate-300">
	                          {{
	                            (t.is_active ? 'adminUi.support.templates.active' : 'adminUi.support.templates.inactive')
	                              | translate
	                          }}
	                        </div>
	                      </div>
	                      <div class="flex flex-wrap items-center gap-2">
	                        <app-button size="sm" [label]="'adminUi.actions.edit' | translate" (action)="editTemplate(t)"></app-button>
	                        <app-button
	                          size="sm"
	                          [label]="t.is_active ? ('adminUi.actions.hide' | translate) : ('adminUi.actions.restore' | translate)"
	                          (action)="toggleTemplateActive(t)"
	                        ></app-button>
	                        <app-button size="sm" [label]="'adminUi.actions.delete' | translate" (action)="deleteTemplate(t)"></app-button>
	                      </div>
	                    </div>
	                  </div>

	                  <div
	                    *ngIf="templateFormOpen()"
	                    class="rounded-xl border border-slate-200 bg-white p-3 grid gap-3 dark:border-slate-800 dark:bg-slate-900"
	                  >
	                    <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
	                      {{
	                        (templateEditingId ? 'adminUi.support.templates.editTitle' : 'adminUi.support.templates.newTitle') | translate
	                      }}
	                    </div>

	                    <app-input
	                      [label]="'adminUi.support.templates.fields.title' | translate"
	                      [(value)]="templateTitle"
	                      [placeholder]="'adminUi.support.templates.fields.titlePlaceholder' | translate"
	                      [ariaLabel]="'adminUi.support.templates.fields.title' | translate"
	                    ></app-input>

	                    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                      {{ 'adminUi.support.templates.fields.bodyEn' | translate }}
	                      <textarea
	                        class="min-h-[120px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                        [(ngModel)]="templateBodyEn"
	                        maxlength="10000"
	                        [placeholder]="'adminUi.support.templates.fields.bodyPlaceholder' | translate"
	                      ></textarea>
	                    </label>

	                    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                      {{ 'adminUi.support.templates.fields.bodyRo' | translate }}
	                      <textarea
	                        class="min-h-[120px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                        [(ngModel)]="templateBodyRo"
	                        maxlength="10000"
	                        [placeholder]="'adminUi.support.templates.fields.bodyPlaceholder' | translate"
	                      ></textarea>
	                    </label>

	                    <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
	                      <input type="checkbox" class="h-4 w-4 rounded border-slate-300" [(ngModel)]="templateActive" />
	                      <span>{{ 'adminUi.support.templates.fields.active' | translate }}</span>
	                    </label>

	                    <div class="text-xs text-slate-500 dark:text-slate-300">
	                      {{ 'adminUi.support.templates.variablesHint' | translate }}
	                    </div>

	                    <div class="flex items-center justify-end gap-2">
	                      <app-button size="sm" [label]="'adminUi.actions.cancel' | translate" (action)="cancelTemplateEdit()"></app-button>
	                      <app-button
	                        size="sm"
	                        [disabled]="templateSaving()"
	                        [label]="'adminUi.actions.save' | translate"
	                        (action)="saveTemplate()"
	                      ></app-button>
	                    </div>
	                  </div>
	                </div>

	                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                  {{ 'adminUi.support.detail.reply' | translate }}
	                  <textarea
	                    class="min-h-[120px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                    [(ngModel)]="replyMessage"
	                    name="replyMessage"
	                    maxlength="10000"
	                    [disabled]="selected()!.status === 'resolved'"
	                    [placeholder]="
	                      selected()!.status === 'resolved'
	                        ? ('adminUi.support.detail.solvedHint' | translate)
	                        : ('adminUi.support.detail.replyPlaceholder' | translate)
	                    "
	                  ></textarea>
	                </label>
	
	                <div class="flex justify-end">
	                  <app-button
	                    size="sm"
	                    [disabled]="replying() || selected()!.status === 'resolved'"
	                    [label]="'adminUi.support.detail.sendReply' | translate"
	                    (action)="sendReply()"
	                  ></app-button>
	                </div>
	              </div>

	              <div class="grid gap-2">
	                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                  {{ 'adminUi.support.detail.assigneeLabel' | translate }}
	                  <select
	                    class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
	                    [(ngModel)]="editAssigneeId"
	                  >
	                    <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="">
	                      {{ 'adminUi.support.detail.assigneeUnassigned' | translate }}
	                    </option>
	                    <option
	                      *ngFor="let a of assignees()"
	                      class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"
	                      [value]="a.id"
	                    >
	                      {{ formatAgent(a) }}
	                    </option>
	                  </select>
	                </label>

	                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                  {{ 'adminUi.support.detail.statusLabel' | translate }}
	                  <select
	                    class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
	                    [(ngModel)]="editStatus"
	                  >
                    <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="new">{{ 'adminUi.support.status.new' | translate }}</option>
                    <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="triaged">{{ 'adminUi.support.status.triaged' | translate }}</option>
                    <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="resolved">{{ 'adminUi.support.status.resolved' | translate }}</option>
                  </select>
                </label>

                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.support.detail.adminNote' | translate }}
                  <textarea
                    class="min-h-[120px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                    [(ngModel)]="editNote"
                    [placeholder]="'adminUi.support.detail.adminNotePlaceholder' | translate"
                  ></textarea>
                </label>

                <div class="flex justify-end">
                  <app-button size="sm" [disabled]="saving()" [label]="'adminUi.support.detail.save' | translate" (action)="save()"></app-button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `
})
export class AdminSupportComponent implements OnInit {
  readonly crumbs: Crumb[] = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin', url: '/admin' },
    { label: 'adminUi.nav.support' }
  ];

  q = '';
  channel: '' | SupportTopic = '';
  status: '' | SupportStatus = '';
  customerFilter = '';
  assigneeFilter = '';

  slaFirstReplyHours = 24;
  slaResolutionHours = 72;
  slaFirstReplyHoursDraft: number | string = 24;
  slaResolutionHoursDraft: number | string = 72;
  slaSettingsSaving = false;
  slaSettingsMessage: string | null = null;
  slaSettingsError: string | null = null;

  loading = signal<boolean>(true);
  detailLoading = signal<boolean>(false);
  saving = signal<boolean>(false);
  replying = signal<boolean>(false);
  error = signal<string>('');
  errorRequestId = signal<string | null>(null);

  assigneesLoading = signal<boolean>(false);
  assignees = signal<SupportAgentRef[]>([]);

  cannedLoading = signal<boolean>(false);
  cannedResponses = signal<SupportCannedResponseRead[]>([]);
  cannedSelectedId = '';
  cannedLang: 'en' | 'ro' = 'en';
  showTemplates = signal<boolean>(false);

  templateFormOpen = signal<boolean>(false);
  templateSaving = signal<boolean>(false);
  templateEditingId: string | null = null;
  templateTitle = '';
  templateBodyEn = '';
  templateBodyRo = '';
  templateActive = true;

  items = signal<AdminContactSubmissionListItem[]>([]);
  meta = signal<{ page: number; total_pages: number; total_items: number; limit: number }>({
    page: 1,
    total_pages: 1,
    total_items: 0,
    limit: 25
  });

  selectedId = signal<string>('');
  selected = signal<AdminContactSubmissionRead | null>(null);

  editStatus: SupportStatus = 'new';
  editNote = '';
  editAssigneeId = '';
  replyMessage = '';

  constructor(
    private readonly api: AdminSupportService,
    private readonly auth: AuthService,
    private readonly toast: ToastService,
    private readonly translate: TranslateService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.cannedLang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    this.loadAssignees();
    this.loadSlaSettings();
    this.loadCanned();
    this.load();
    const ticketId = this.route.snapshot.queryParamMap.get('ticket');
    if (ticketId) {
      this.openTicket(ticketId, false);
    }
  }

  applyFilters(): void {
    this.meta.set({ ...this.meta(), page: 1 });
    this.load();
  }

  retryLoad(): void {
    this.load();
  }

  canEditSlaSettings(): boolean {
    const role = this.auth.role();
    return role === 'owner' || role === 'admin';
  }

  loadSlaSettings(): void {
    this.api.getSlaSettings().subscribe({
      next: (settings: SupportSlaSettings) => {
        const first = Number(settings?.first_reply_hours);
        const resolution = Number(settings?.resolution_hours);
        this.slaFirstReplyHours = Number.isFinite(first) ? Math.trunc(first) : 24;
        this.slaResolutionHours = Number.isFinite(resolution) ? Math.trunc(resolution) : 72;
        this.slaFirstReplyHoursDraft = this.slaFirstReplyHours;
        this.slaResolutionHoursDraft = this.slaResolutionHours;
      },
      error: () => {
        // Keep defaults.
      }
    });
  }

  saveSlaSettings(): void {
    if (this.slaSettingsSaving) return;
    const firstRaw = Number(this.slaFirstReplyHoursDraft);
    const resolutionRaw = Number(this.slaResolutionHoursDraft);
    const first = Number.isFinite(firstRaw) ? Math.trunc(firstRaw) : 0;
    const resolution = Number.isFinite(resolutionRaw) ? Math.trunc(resolutionRaw) : 0;
    if (first < 1 || first > 720 || resolution < 1 || resolution > 720) {
      this.slaSettingsError = this.translate.instant('adminUi.support.sla.errors.invalid');
      this.slaSettingsMessage = null;
      return;
    }

    this.slaSettingsSaving = true;
    this.slaSettingsError = null;
    this.slaSettingsMessage = null;
    this.api.updateSlaSettings({ first_reply_hours: first, resolution_hours: resolution }).subscribe({
      next: (updated) => {
        this.slaSettingsSaving = false;
        const nextFirst = Number(updated?.first_reply_hours);
        const nextResolution = Number(updated?.resolution_hours);
        this.slaFirstReplyHours = Number.isFinite(nextFirst) ? Math.trunc(nextFirst) : first;
        this.slaResolutionHours = Number.isFinite(nextResolution) ? Math.trunc(nextResolution) : resolution;
        this.slaFirstReplyHoursDraft = this.slaFirstReplyHours;
        this.slaResolutionHoursDraft = this.slaResolutionHours;
        this.slaSettingsMessage = this.translate.instant('adminUi.support.sla.success.save');
        this.slaSettingsError = null;
      },
      error: () => {
        this.slaSettingsSaving = false;
        this.slaSettingsError = this.translate.instant('adminUi.support.sla.errors.save');
        this.slaSettingsMessage = null;
      }
    });
  }

  private formatDuration(ms: number): string {
    const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];
    if (days) parts.push(`${days}d`);
    if (hours || days) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    return parts.join(' ');
  }

  slaInfo(row: AdminContactSubmissionListItem): { label: string; class: string } | null {
    const createdAt = new Date(row.created_at).getTime();
    if (!Number.isFinite(createdAt)) return null;
    if (row.status === 'resolved') return null;

    const now = Date.now();
    const replyDueAt = createdAt + this.slaFirstReplyHours * 60 * 60 * 1000;
    const resolveDueAt = createdAt + this.slaResolutionHours * 60 * 60 * 1000;

    const isReply = row.status === 'new';
    const dueAt = isReply ? replyDueAt : resolveDueAt;
    const delta = dueAt - now;
    const duration = this.formatDuration(Math.abs(delta));
    const prefix = this.translate.instant(isReply ? 'adminUi.support.sla.reply' : 'adminUi.support.sla.resolve');
    const suffix = delta < 0
      ? this.translate.instant('adminUi.support.sla.overdue', { duration })
      : this.translate.instant('adminUi.support.sla.due', { duration });

    const dueSoon = delta >= 0 && delta <= 6 * 60 * 60 * 1000;
    const klass =
      delta < 0
        ? 'bg-rose-100 text-rose-900 dark:bg-rose-950/30 dark:text-rose-100'
        : dueSoon
          ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100'
          : 'bg-slate-100 text-slate-900 dark:bg-slate-800/70 dark:text-slate-100';

    return { label: `${prefix}: ${suffix}`, class: klass };
  }

  formatAgent(agent: SupportAgentRef): string {
    const username = (agent?.username || '').trim();
    const name = (agent?.name || '').trim();
    const tag = Number.isFinite(agent?.name_tag as any) ? Number(agent?.name_tag) : 0;
    if (name) return `${username} (${name}#${tag})`;
    return username || '—';
  }

  activeCannedResponses(): SupportCannedResponseRead[] {
    return this.cannedResponses().filter((t) => !!t && t.is_active);
  }

  toggleTemplates(): void {
    this.showTemplates.set(!this.showTemplates());
  }

  loadCanned(): void {
    if (this.cannedLoading()) return;
    this.cannedLoading.set(true);
    this.api.listCannedResponses({ include_inactive: true }).subscribe({
      next: (rows) => this.cannedResponses.set(rows || []),
      error: () => {
        this.toast.error(this.translate.instant('adminUi.support.templates.errors.load'));
        this.cannedLoading.set(false);
      },
      complete: () => this.cannedLoading.set(false)
    });
  }

  startNewTemplate(): void {
    this.templateEditingId = null;
    this.templateTitle = '';
    this.templateBodyEn = '';
    this.templateBodyRo = '';
    this.templateActive = true;
    this.templateFormOpen.set(true);
  }

  editTemplate(t: SupportCannedResponseRead): void {
    this.templateEditingId = t.id;
    this.templateTitle = t.title || '';
    this.templateBodyEn = t.body_en || '';
    this.templateBodyRo = t.body_ro || '';
    this.templateActive = !!t.is_active;
    this.templateFormOpen.set(true);
  }

  cancelTemplateEdit(): void {
    this.templateFormOpen.set(false);
    this.templateEditingId = null;
  }

  saveTemplate(): void {
    const title = (this.templateTitle || '').trim();
    const bodyEn = (this.templateBodyEn || '').trim();
    const bodyRo = (this.templateBodyRo || '').trim();
    if (!title || !bodyEn || !bodyRo) {
      this.toast.error(this.translate.instant('adminUi.support.templates.errors.required'));
      return;
    }
    if (this.templateSaving()) return;
    this.templateSaving.set(true);

    const done = () => {
      this.templateSaving.set(false);
      this.templateFormOpen.set(false);
      this.templateEditingId = null;
      this.loadCanned();
      this.toast.success(this.translate.instant('adminUi.support.templates.success.saved'));
    };
    const fail = (err: any) => {
      this.templateSaving.set(false);
      const msg = err?.error?.detail || this.translate.instant('adminUi.support.templates.errors.save');
      this.toast.error(msg);
    };

    if (this.templateEditingId) {
      this.api
        .updateCannedResponse(this.templateEditingId, {
          title,
          body_en: bodyEn,
          body_ro: bodyRo,
          is_active: this.templateActive
        })
        .subscribe({ next: () => done(), error: (err) => fail(err) });
      return;
    }

    this.api
      .createCannedResponse({
        title,
        body_en: bodyEn,
        body_ro: bodyRo,
        is_active: this.templateActive
      })
      .subscribe({ next: () => done(), error: (err) => fail(err) });
  }

  toggleTemplateActive(t: SupportCannedResponseRead): void {
    this.api.updateCannedResponse(t.id, { is_active: !t.is_active }).subscribe({
      next: (updated) => {
        this.cannedResponses.set(this.cannedResponses().map((row) => (row.id === updated.id ? updated : row)));
      },
      error: () => this.toast.error(this.translate.instant('adminUi.support.templates.errors.save'))
    });
  }

  deleteTemplate(t: SupportCannedResponseRead): void {
    const ok = confirm(this.translate.instant('adminUi.support.templates.confirmDelete'));
    if (!ok) return;
    this.api.deleteCannedResponse(t.id).subscribe({
      next: () => {
        this.cannedResponses.set(this.cannedResponses().filter((row) => row.id !== t.id));
        if (this.templateEditingId === t.id) this.cancelTemplateEdit();
        this.toast.success(this.translate.instant('adminUi.support.templates.success.deleted'));
      },
      error: () => this.toast.error(this.translate.instant('adminUi.support.templates.errors.delete'))
    });
  }

  insertCanned(): void {
    const selected = this.selected();
    if (!selected) return;
    const template = this.cannedResponses().find((t) => t.id === this.cannedSelectedId);
    if (!template) return;
    const base = this.cannedLang === 'ro' ? template.body_ro : template.body_en;
    const rendered = this.renderTemplate(base || '', selected).trim();
    if (!rendered) return;
    const existing = (this.replyMessage || '').trim();
    this.replyMessage = existing ? `${existing}\n\n${rendered}` : rendered;
    this.toast.success(this.translate.instant('adminUi.support.templates.success.inserted'));
  }

  private renderTemplate(body: string, ticket: AdminContactSubmissionRead): string {
    return (body || '')
      .replace(/\\{\\{\\s*customer_name\\s*\\}\\}/gi, ticket.name || '')
      .replace(/\\{\\{\\s*customer_email\\s*\\}\\}/gi, ticket.email || '')
      .replace(/\\{\\{\\s*order_reference\\s*\\}\\}/gi, ticket.order_reference || '')
      .replace(/\\{\\{\\s*ticket_id\\s*\\}\\}/gi, ticket.id || '');
  }

  private loadAssignees(): void {
    this.assigneesLoading.set(true);
    this.api.listAssignees().subscribe({
      next: (rows) => this.assignees.set(rows || []),
      error: () => {
        this.toast.error(this.translate.instant('adminUi.support.errors.loadAssignees'));
        this.assigneesLoading.set(false);
      },
      complete: () => this.assigneesLoading.set(false)
    });
  }

  private load(): void {
    this.loading.set(true);
    this.error.set('');
    this.errorRequestId.set(null);
    const meta = this.meta();
    this.api
      .list({
        q: this.q.trim() || undefined,
        channel_filter: this.channel || undefined,
        status_filter: this.status || undefined,
        customer_filter: this.customerFilter.trim() || undefined,
        assignee_filter: this.assigneeFilter || undefined,
        page: meta.page,
        limit: meta.limit
      })
      .subscribe({
        next: (resp) => {
          this.items.set(resp.items);
          this.meta.set(resp.meta);
        },
        error: (err) => {
          this.items.set([]);
          this.error.set(this.translate.instant('adminUi.support.errors.load'));
          this.errorRequestId.set(extractRequestId(err));
          this.loading.set(false);
        },
        complete: () => this.loading.set(false)
      });
  }

  select(row: AdminContactSubmissionListItem): void {
    this.openTicket(row.id, true);
  }

  private openTicket(id: string, pushUrl: boolean): void {
    if (!id) return;
    if (this.selectedId() === id) return;
    this.selectedId.set(id);
    this.selected.set(null);
    this.detailLoading.set(true);
    if (pushUrl) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { ticket: id },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
    this.api.getOne(id).subscribe({
      next: (detail) => {
        this.selected.set(detail);
        this.editStatus = detail.status;
        this.editNote = detail.admin_note || '';
        this.editAssigneeId = detail.assignee?.id || '';
        this.replyMessage = '';
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.support.errors.loadDetail'));
        this.selectedId.set('');
        this.selected.set(null);
        this.detailLoading.set(false);
      },
      complete: () => this.detailLoading.set(false)
    });
  }

  save(): void {
    const selected = this.selected();
    if (!selected) return;
    if (this.saving()) return;
    this.saving.set(true);
    this.api
      .update(selected.id, {
        status: this.editStatus,
        admin_note: this.editNote.trim() || null,
        assignee_id: this.editAssigneeId || null
      })
      .subscribe({
        next: (updated) => {
          this.selected.set(updated);
          this.editStatus = updated.status;
          this.editNote = updated.admin_note || '';
          this.editAssigneeId = updated.assignee?.id || '';
          // Update row in list
          this.items.set(
            this.items().map((it) =>
              it.id === updated.id ? { ...it, status: updated.status, topic: updated.topic, assignee: updated.assignee } : it
            )
          );
          this.toast.success(this.translate.instant('adminUi.support.success.saved'));
        },
        error: (err) => {
          const msg = err?.error?.detail || this.translate.instant('adminUi.support.errors.save');
          this.toast.error(msg);
          this.saving.set(false);
        },
        complete: () => this.saving.set(false)
      });
  }

  sendReply(): void {
    const selected = this.selected();
    if (!selected) return;
    const message = (this.replyMessage || '').trim();
    if (!message) {
      this.toast.error(this.translate.instant('adminUi.support.errors.reply'));
      return;
    }
    if (this.replying()) return;
    this.replying.set(true);
    this.api.addMessage(selected.id, message).subscribe({
      next: (updated) => {
        this.selected.set(updated);
        this.replyMessage = '';
        this.items.set(this.items().map((it) => (it.id === updated.id ? { ...it, status: updated.status } : it)));
        this.toast.success(this.translate.instant('adminUi.support.success.replySent'));
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('adminUi.support.errors.reply');
        this.toast.error(msg);
        this.replying.set(false);
      },
      complete: () => this.replying.set(false)
    });
  }

  hasPrev(): boolean {
    return this.meta().page > 1;
  }

  hasNext(): boolean {
    return this.meta().page < this.meta().total_pages;
  }

  prev(): void {
    if (!this.hasPrev()) return;
    this.meta.set({ ...this.meta(), page: this.meta().page - 1 });
    this.load();
  }

  next(): void {
    if (!this.hasNext()) return;
    this.meta.set({ ...this.meta(), page: this.meta().page + 1 });
    this.load();
  }
}

