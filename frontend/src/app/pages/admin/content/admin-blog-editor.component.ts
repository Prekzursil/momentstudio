import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { diffLines } from 'diff';
import { firstValueFrom, forkJoin, of, Subscription } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import {
  AdminContent,
  AdminService,
  ContentBlockVersionListItem,
  ContentBlockVersionRead,
  ContentImageAssetRead,
} from '../../../core/admin.service';
import { AdminBlogComment, BlogService } from '../../../core/blog.service';
import { ToastService } from '../../../core/toast.service';
import { MarkdownService } from '../../../core/markdown.service';
import { appConfig } from '../../../core/app-config';
import { formatIdentity } from '../../../shared/user-identity';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';
import { RichEditorComponent } from '../../../shared/rich-editor.component';
import { AssetLibraryComponent } from '../shared/asset-library.component';
import { CmsEditorPrefsService } from '../shared/cms-editor-prefs.service';
import { AdminCmsStateService, CmsDraftManager } from './admin-cms-state.service';
import type { BlogDraftState, UiLang } from '../admin.component';

type ContentStatusUi = 'draft' | 'review' | 'published';
const CMS_DRAFT_POLL_INTERVAL_MS = 1200;

/**
 * Blog authoring + moderation panel, extracted (behaviour-preserving) from the
 * monolithic AdminComponent. Owns the blog post list, the per-post editor
 * (draft/SEO/cover/pinned/versioning/writing-aids/markdown toolbar), the bulk
 * actions, the cover-image + inline-image asset flows, and the flagged-comment
 * moderation (resolve / hide / unhide / delete). Renders the same two
 * `<section>` blocks that previously lived under `section() === 'blog'`.
 *
 * Shared CMS state is NOT duplicated: the per-post undo/redo/autosave draft
 * managers live in the injected AdminCmsStateService (same instance the parent
 * provides), and the optimistic-concurrency version helpers + the shared
 * content-blocks list + the content reload are threaded in from the parent as
 * bound-function / value inputs so the single `contentVersions` map stays
 * authoritative. `:host { display: contents }` keeps the sections in the parent
 * content grid exactly as before.
 */
@Component({
  selector: 'app-admin-blog-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    ButtonComponent,
    InputComponent,
    RichEditorComponent,
    AssetLibraryComponent,
  ],
  styles: [':host { display: contents; }'],
  template: `
        <section
          class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {{ 'adminUi.blog.title' | translate }}
            </h2>
            <div class="flex items-center gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.blog.actions.newPost' | translate"
                (action)="startBlogCreate()"
              ></app-button>
              <app-button
                *ngIf="selectedBlogKey"
                size="sm"
                variant="ghost"
                [label]="'adminUi.blog.actions.closeEditor' | translate"
                (action)="closeBlogEditor()"
              ></app-button>
            </div>
          </div>

          <div
            class="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/40"
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex flex-wrap items-center gap-3">
                <label
                  class="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"
                >
                  <input
                    type="checkbox"
                    [checked]="areAllBlogSelected()"
                    [disabled]="blogPosts().length === 0"
                    (change)="toggleSelectAllBlogs($event)"
                  />
                  {{ 'adminUi.blog.bulk.selectAll' | translate }}
                </label>
                <span class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.blog.bulk.selected' | translate: { count: blogBulkSelection.size } }}
                </span>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.blog.bulk.clear' | translate"
                  (action)="clearBlogBulkSelection()"
                  [disabled]="blogBulkSelection.size === 0"
                ></app-button>
              </div>
              <div class="text-xs text-rose-600 dark:text-rose-300" *ngIf="blogBulkError">
                {{ blogBulkError }}
              </div>
            </div>

            <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <label class="grid gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                {{ 'adminUi.blog.bulk.actionLabel' | translate }}
                <select
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="blogBulkAction"
                >
                  <option value="publish">
                    {{ 'adminUi.blog.bulk.actionPublish' | translate }}
                  </option>
                  <option value="unpublish">
                    {{ 'adminUi.blog.bulk.actionUnpublish' | translate }}
                  </option>
                  <option value="schedule">
                    {{ 'adminUi.blog.bulk.actionSchedule' | translate }}
                  </option>
                  <option value="tags_add">
                    {{ 'adminUi.blog.bulk.actionTagsAdd' | translate }}
                  </option>
                  <option value="tags_remove">
                    {{ 'adminUi.blog.bulk.actionTagsRemove' | translate }}
                  </option>
                </select>
              </label>

              <label
                *ngIf="blogBulkAction === 'schedule'"
                class="grid gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300"
              >
                {{ 'adminUi.blog.bulk.publishAt' | translate }}
                <input
                  type="datetime-local"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="blogBulkPublishAt"
                />
              </label>

              <label
                *ngIf="blogBulkAction === 'schedule'"
                class="grid gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300"
              >
                {{ 'adminUi.blog.bulk.unpublishAt' | translate }}
                <input
                  type="datetime-local"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="blogBulkUnpublishAt"
                />
              </label>

              <label
                *ngIf="blogBulkAction === 'tags_add' || blogBulkAction === 'tags_remove'"
                class="grid gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 md:col-span-2"
              >
                {{ 'adminUi.blog.bulk.tagsLabel' | translate }}
                <input
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [placeholder]="'adminUi.blog.bulk.tagsPlaceholder' | translate"
                  [(ngModel)]="blogBulkTags"
                />
              </label>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="text-xs text-slate-500 dark:text-slate-400">{{ blogBulkPreview() }}</p>
              <app-button
                size="sm"
                [label]="
                  blogBulkSaving
                    ? ('adminUi.common.saving' | translate)
                    : ('adminUi.blog.bulk.apply' | translate)
                "
                (action)="applyBlogBulkAction()"
                [disabled]="!canApplyBlogBulk() || blogBulkSaving"
              ></app-button>
            </div>
          </div>

          <div
            *ngIf="blogPinnedPosts().length"
            class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/40"
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="font-semibold text-slate-900 dark:text-slate-50">
                {{ 'adminUi.blog.pins.title' | translate }}
              </p>
              <span *ngIf="blogPinsSaving" class="text-xs text-slate-500 dark:text-slate-400">{{
                'adminUi.common.saving' | translate
              }}</span>
            </div>
            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {{ 'adminUi.blog.pins.hint' | translate }}
            </p>
            <div class="mt-2 grid gap-2">
              <div
                *ngFor="let post of blogPinnedPosts()"
                class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
                [class.opacity-60]="blogPinsSaving"
                [attr.draggable]="blogPinsSaving ? null : 'true'"
                (dragstart)="onBlogPinDragStart(post.key)"
                (dragover)="onBlogPinDragOver($event)"
                (drop)="onBlogPinDrop(post.key)"
              >
                <div class="min-w-0">
                  <p class="font-medium text-slate-900 dark:text-slate-50 truncate">
                    {{ post.title || post.key }}
                  </p>
                  <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ post.key }}</p>
                </div>
                <span
                  class="shrink-0 inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200"
                >
                  #{{ blogPinnedSlot(post) || 1 }}
                </span>
              </div>
            </div>
          </div>

          <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
            <div
              *ngIf="blogPosts().length === 0"
              class="text-sm text-slate-500 dark:text-slate-400"
            >
              {{ 'adminUi.blog.empty' | translate }}
            </div>
            <div
              *ngFor="let post of blogPosts()"
              class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
              [ngClass]="
                isBlogSelected(post.key)
                  ? 'bg-indigo-50/60 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900'
                  : ''
              "
            >
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  [checked]="isBlogSelected(post.key)"
                  (change)="toggleBlogSelection(post.key, $event)"
                />
              </label>
              <div>
                <p class="font-semibold text-slate-900 dark:text-slate-50">{{ post.title }}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400">
                  <ng-container *ngIf="blogPinnedSlot(post) as slot">
                    <span
                      class="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200"
                    >
                      {{ 'adminUi.blog.pins.badge' | translate: { slot } }}
                    </span>
                    ·
                  </ng-container>
                  {{ post.key }} · {{ 'adminUi.status.' + (post.status || 'draft') | translate }} ·
                  {{ post.author ? commentAuthorLabel(post.author) : '—' }} · v{{ post.version }} ·
                  {{ post.updated_at | date: 'short' }}
                </p>
              </div>
              <div class="flex items-center gap-3">
                <a
                  class="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
                  [attr.href]="'/blog/' + extractBlogSlug(post.key)"
                  target="_blank"
                  rel="noopener"
                  (click)="$event.stopPropagation()"
                >
                  {{ 'adminUi.blog.actions.view' | translate }}
                </a>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.actions.delete' | translate"
                  [disabled]="blogDeleteBusy.has(post.key)"
                  (action)="deleteBlogPost(post)"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.actions.edit' | translate"
                  (action)="selectBlogPost(post)"
                ></app-button>
              </div>
            </div>
          </div>

          <div
            *ngIf="showBlogCreate"
            class="grid gap-3 pt-3 border-t border-slate-200 dark:border-slate-800"
          >
            <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
              {{ 'adminUi.blog.create.title' | translate }}
            </p>
            <div class="grid md:grid-cols-2 gap-3 text-sm">
              <label
                *ngIf="cmsAdvanced()"
                class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                {{ 'adminUi.blog.fields.slug' | translate }}
                <div
                  class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-300"
                >
                  {{ blogCreateSlug() || '—' }}
                </div>
                <span class="text-xs text-slate-500 dark:text-slate-400">{{
                  'adminUi.products.form.slugAutoHint' | translate
                }}</span>
              </label>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.blog.fields.baseLanguage' | translate }}
                <select
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="blogCreate.baseLang"
                >
                  <option value="en">EN</option>
                  <option value="ro">RO</option>
                </select>
              </label>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.blog.fields.status' | translate }}
                <select
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="blogCreate.status"
                >
                  <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
                  <option value="review">{{ 'adminUi.status.review' | translate }}</option>
                  <option value="published">{{ 'adminUi.status.published' | translate }}</option>
                </select>
              </label>
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.blog.fields.publishAtOptional' | translate }}
                <input
                  type="datetime-local"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="blogCreate.published_at"
                  [disabled]="blogCreate.status !== 'published'"
                />
                <span class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.blog.fields.publishAtHint' | translate }}
                </span>
              </label>
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.blog.fields.unpublishAtOptional' | translate }}
                <input
                  type="datetime-local"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="blogCreate.published_until"
                  [disabled]="blogCreate.status !== 'published'"
                />
                <span class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.blog.fields.unpublishAtHint' | translate }}
                </span>
              </label>
              <div class="md:col-span-2">
                <app-input
                  [label]="'adminUi.blog.fields.title' | translate"
                  [(value)]="blogCreate.title"
                ></app-input>
              </div>
              <label
                class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2"
              >
                {{ 'adminUi.blog.fields.summaryOptional' | translate }}
                <textarea
                  rows="3"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="blogCreate.summary"
                ></textarea>
              </label>
              <app-input
                [label]="'adminUi.blog.fields.tags' | translate"
                [(value)]="blogCreate.tags"
                [placeholder]="'adminUi.blog.fields.tagsPlaceholder' | translate"
              ></app-input>
              <app-input
                [label]="'adminUi.blog.fields.seriesOptional' | translate"
                [(value)]="blogCreate.series"
                [placeholder]="'adminUi.blog.fields.seriesPlaceholder' | translate"
                [hint]="'adminUi.blog.fields.seriesHint' | translate"
              ></app-input>
              <app-input
                [label]="'adminUi.blog.fields.coverImageUrlOptional' | translate"
                [(value)]="blogCreate.cover_image_url"
                [placeholder]="'adminUi.blog.fields.coverImagePlaceholder' | translate"
              ></app-input>
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.blog.fields.readingTimeOptional' | translate }}
                <input
                  type="number"
                  min="1"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="blogCreate.reading_time_minutes"
                />
              </label>
              <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" [(ngModel)]="blogCreate.pinned" />
                {{ 'adminUi.blog.fields.pinned' | translate }}
              </label>
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.blog.fields.pinOrder' | translate }}
                <input
                  type="number"
                  min="1"
                  step="1"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="blogCreate.pin_order"
                  [disabled]="!blogCreate.pinned"
                />
                <span class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.blog.fields.pinOrderHint' | translate }}
                </span>
              </label>
              <div
                class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2"
              >
                {{ 'adminUi.blog.fields.body' | translate }}
                <app-rich-editor
                  [(value)]="blogCreate.body_markdown"
                  [initialEditType]="'wysiwyg'"
                  [height]="'420px'"
                ></app-rich-editor>
              </div>
            </div>

            <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" [(ngModel)]="blogCreate.includeTranslation" />
              {{ 'adminUi.blog.create.addTranslation' | translate }}
            </label>

            <div *ngIf="blogCreate.includeTranslation" class="grid md:grid-cols-2 gap-3 text-sm">
              <p class="md:col-span-2 text-xs text-slate-500 dark:text-slate-400">
                {{
                  'adminUi.blog.create.translationHint'
                    | translate: { lang: blogCreate.baseLang === 'en' ? 'RO' : 'EN' }
                }}
              </p>
              <app-input
                [label]="'adminUi.blog.create.translationTitle' | translate"
                [(value)]="blogCreate.translationTitle"
              ></app-input>
              <label
                class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2"
              >
                {{ 'adminUi.blog.create.translationBody' | translate }}
                <textarea
                  rows="5"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="blogCreate.translationBody"
                ></textarea>
              </label>
            </div>

            <div class="flex gap-2">
              <app-button
                [label]="'adminUi.blog.actions.createPost' | translate"
                (action)="createBlogPost()"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.cancel' | translate"
                (action)="cancelBlogCreate()"
              ></app-button>
            </div>
          </div>

          <div
            *ngIf="selectedBlogKey"
            class="grid gap-3 pt-3 border-t border-slate-200 dark:border-slate-800"
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="grid gap-1">
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {{ 'adminUi.blog.editing.title' | translate }}: {{ selectedBlogKey }}
                </p>
                <p class="text-xs text-slate-500 dark:text-slate-400">
                  {{
                    'adminUi.blog.editing.languages'
                      | translate
                        : { base: blogBaseLang.toUpperCase(), edit: blogEditLang.toUpperCase() }
                  }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  label="EN"
                  [disabled]="blogEditLang === 'en'"
                  (action)="setBlogEditLang('en')"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  label="RO"
                  [disabled]="blogEditLang === 'ro'"
                  (action)="setBlogEditLang('ro')"
                ></app-button>
              </div>
            </div>

            <div class="grid md:grid-cols-2 gap-3 text-sm">
              <app-input
                [label]="'adminUi.blog.fields.title' | translate"
                [(value)]="blogForm.title"
              ></app-input>
              <label class="grid text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.blog.editing.statusBaseOnly' | translate }}
                <select
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="blogForm.status"
                  [disabled]="blogEditLang !== blogBaseLang"
                >
                  <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
                  <option value="review">{{ 'adminUi.status.review' | translate }}</option>
                  <option value="published">{{ 'adminUi.status.published' | translate }}</option>
                </select>
              </label>
              <label
                *ngIf="cmsAdvanced()"
                class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2"
              >
                {{ 'adminUi.blog.editing.publishAtBaseOnlyOptional' | translate }}
                <input
                  type="datetime-local"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="blogForm.published_at"
                  [disabled]="blogEditLang !== blogBaseLang || blogForm.status !== 'published'"
                />
                <span class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.blog.editing.publishAtBaseOnlyHint' | translate }}
                </span>
              </label>
              <label
                *ngIf="cmsAdvanced()"
                class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2"
              >
                {{ 'adminUi.blog.editing.unpublishAtBaseOnlyOptional' | translate }}
                <input
                  type="datetime-local"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="blogForm.published_until"
                  [disabled]="blogEditLang !== blogBaseLang || blogForm.status !== 'published'"
                />
                <span class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.blog.editing.unpublishAtBaseOnlyHint' | translate }}
                </span>
              </label>
              <label
                class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2"
              >
                {{
                  'adminUi.blog.editing.summaryOptional'
                    | translate: { lang: blogEditLang.toUpperCase() }
                }}
                <textarea
                  rows="3"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="blogForm.summary"
                ></textarea>
                <span class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.blog.editing.summaryHint' | translate }}
                </span>
              </label>
              <app-input
                [label]="'adminUi.blog.fields.tags' | translate"
                [(value)]="blogForm.tags"
                [placeholder]="'adminUi.blog.fields.tagsPlaceholder' | translate"
              ></app-input>
              <app-input
                [label]="'adminUi.blog.fields.seriesOptional' | translate"
                [(value)]="blogForm.series"
                [placeholder]="'adminUi.blog.fields.seriesPlaceholder' | translate"
                [hint]="'adminUi.blog.fields.seriesHint' | translate"
                [disabled]="blogEditLang !== blogBaseLang"
              ></app-input>
              <div class="grid gap-2 md:col-span-2">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <p class="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.blog.cover.title' | translate }}
                  </p>
                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600"
                      [disabled]="blogEditLang !== blogBaseLang"
                      (click)="blogCoverUploadInput.click()"
                    >
                      {{ 'adminUi.blog.cover.upload' | translate }}
                    </button>
                    <input
                      #blogCoverUploadInput
                      type="file"
                      accept="image/*"
                      class="hidden"
                      (change)="uploadBlogCoverImage($event)"
                    />
                    <button
                      type="button"
                      class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600"
                      [disabled]="blogEditLang !== blogBaseLang"
                      (click)="showBlogCoverLibrary = !showBlogCoverLibrary"
                    >
                      {{
                        showBlogCoverLibrary
                          ? ('adminUi.common.close' | translate)
                          : ('adminUi.blog.cover.choose' | translate)
                      }}
                    </button>
                    <button
                      type="button"
                      class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600"
                      [disabled]="blogEditLang !== blogBaseLang || !blogForm.cover_image_url.trim()"
                      (click)="clearBlogCoverOverride()"
                    >
                      {{ 'adminUi.blog.cover.clear' | translate }}
                    </button>
                  </div>
                </div>

                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.blog.fields.coverImageUrlOptional' | translate }}
                  <input
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogForm.cover_image_url"
                    [placeholder]="'adminUi.blog.fields.coverImagePlaceholder' | translate"
                    [disabled]="blogEditLang !== blogBaseLang"
                  />
                  <span class="text-xs text-slate-500 dark:text-slate-400">{{
                    'adminUi.blog.cover.hint' | translate
                  }}</span>
                  <span class="text-xs text-slate-500 dark:text-slate-400">{{
                    'adminUi.blog.cover.sizeHint' | translate
                  }}</span>
                </label>

                <label
                  class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 sm:max-w-xs"
                >
                  {{ 'adminUi.blog.cover.fitModeLabel' | translate }}
                  <select
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="blogForm.cover_fit"
                    [disabled]="blogEditLang !== blogBaseLang"
                  >
                    <option value="cover">
                      {{ 'adminUi.blog.cover.fitModeCover' | translate }}
                    </option>
                    <option value="contain">
                      {{ 'adminUi.blog.cover.fitModeContain' | translate }}
                    </option>
                  </select>
                </label>

                <div *ngIf="blogCoverPreviewUrl() as coverUrl" class="grid gap-3 sm:grid-cols-2">
                  <div class="grid gap-2">
                    <p
                      class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400"
                    >
                      {{ 'adminUi.blog.cover.previewDesktop' | translate }}
                    </p>
                    <div
                      class="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800"
                    >
                      <img
                        [src]="coverUrl"
                        [alt]="blogForm.title || 'cover'"
                        class="w-full aspect-[16/9]"
                        [ngClass]="
                          blogForm.cover_fit === 'contain'
                            ? 'object-contain bg-slate-50 dark:bg-slate-900'
                            : 'object-cover'
                        "
                        [style.object-position]="blogCoverPreviewFocalPosition()"
                        loading="eager"
                        decoding="async"
                      />
                    </div>
                  </div>
                  <div class="grid gap-2">
                    <p
                      class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400"
                    >
                      {{ 'adminUi.blog.cover.previewMobile' | translate }}
                    </p>
                    <div
                      class="max-w-[280px] relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800"
                    >
                      <img
                        [src]="coverUrl"
                        [alt]="blogForm.title || 'cover'"
                        class="w-full aspect-[1/1]"
                        [ngClass]="
                          blogForm.cover_fit === 'contain'
                            ? 'object-contain bg-slate-50 dark:bg-slate-900'
                            : 'object-cover'
                        "
                        [style.object-position]="blogCoverPreviewFocalPosition()"
                        loading="eager"
                        decoding="async"
                      />
                    </div>
                  </div>
                </div>

                <div
                  *ngIf="blogCoverPreviewAsset() as coverAsset"
                  class="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400"
                >
                  <span>{{
                    'adminUi.blog.cover.focalLabel'
                      | translate: { x: coverAsset.focal_x, y: coverAsset.focal_y }
                  }}</span>
                  <button
                    type="button"
                    class="text-xs text-slate-700 hover:underline disabled:opacity-60 dark:text-slate-200"
                    [disabled]="blogEditLang !== blogBaseLang"
                    (click)="editBlogCoverFocalPoint()"
                  >
                    {{ 'adminUi.blog.cover.editFocal' | translate }}
                  </button>
                </div>

                <div
                  *ngIf="showBlogCoverLibrary && selectedBlogKey"
                  class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
                >
                  <app-asset-library
                    titleKey="adminUi.blog.cover.libraryTitle"
                    [allowUpload]="false"
                    [allowSelect]="true"
                    [scopedKeys]="[selectedBlogKey]"
                    [initialKey]="selectedBlogKey"
                    [uploadKey]="selectedBlogKey"
                    (selectAsset)="selectBlogCoverAsset($event)"
                  ></app-asset-library>
                </div>
              </div>
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.blog.fields.readingTimeOptional' | translate }}
                <input
                  type="number"
                  min="1"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="blogForm.reading_time_minutes"
                />
              </label>
              <label
                class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 md:col-span-2"
              >
                <input
                  type="checkbox"
                  [(ngModel)]="blogForm.pinned"
                  [disabled]="blogEditLang !== blogBaseLang"
                />
                {{ 'adminUi.blog.fields.pinned' | translate }}
              </label>
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.blog.fields.pinOrder' | translate }}
                <input
                  type="number"
                  min="1"
                  step="1"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="blogForm.pin_order"
                  [disabled]="blogEditLang !== blogBaseLang || !blogForm.pinned"
                />
                <span class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.blog.fields.pinOrderHint' | translate }}
                </span>
              </label>
              <div class="grid gap-2 md:col-span-2">
                <div class="grid gap-3 lg:grid-cols-[1fr_280px]">
                  <div class="grid gap-2">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <p class="text-sm font-medium text-slate-700 dark:text-slate-200">
                        {{ 'adminUi.blog.fields.body' | translate }}
                      </p>
                      <div class="flex flex-wrap items-center gap-3">
                        <label
                          class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"
                        >
                          <input type="checkbox" [(ngModel)]="useRichBlogEditor" />
                          {{ 'adminUi.blog.editing.richEditor' | translate }}
                        </label>
                        <label
                          *ngIf="!useRichBlogEditor"
                          class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"
                        >
                          <input type="checkbox" [(ngModel)]="showBlogPreview" />
                          {{ 'adminUi.blog.editing.livePreview' | translate }}
                        </label>
                      </div>
                    </div>

                    <ng-container *ngIf="useRichBlogEditor; else markdownBlogEditor">
                      <div class="flex flex-wrap items-center gap-2 text-xs">
                        <label
                          class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"
                        >
                          {{ 'adminUi.blog.images.layout.label' | translate }}
                          <select
                            class="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            [(ngModel)]="blogImageLayout"
                          >
                            <option value="default">
                              {{ 'adminUi.blog.images.layout.default' | translate }}
                            </option>
                            <option value="wide">
                              {{ 'adminUi.blog.images.layout.wide' | translate }}
                            </option>
                            <option value="left">
                              {{ 'adminUi.blog.images.layout.left' | translate }}
                            </option>
                            <option value="right">
                              {{ 'adminUi.blog.images.layout.right' | translate }}
                            </option>
                            <option value="gallery">
                              {{ 'adminUi.blog.images.layout.gallery' | translate }}
                            </option>
                          </select>
                        </label>
                        <button
                          type="button"
                          class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                          (click)="blogImageInputRich.click()"
                        >
                          {{ 'adminUi.blog.actions.image' | translate }}
                        </button>
                        <button
                          type="button"
                          class="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                          (click)="insertBlogEmbed(blogEditor, 'product')"
                        >
                          {{ 'adminUi.blog.toolbar.product' | translate }}
                        </button>
                        <button
                          type="button"
                          class="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                          (click)="insertBlogEmbed(blogEditor, 'category')"
                        >
                          {{ 'adminUi.blog.toolbar.category' | translate }}
                        </button>
                        <button
                          type="button"
                          class="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                          (click)="insertBlogEmbed(blogEditor, 'collection')"
                        >
                          {{ 'adminUi.blog.toolbar.collection' | translate }}
                        </button>
                        <input
                          #blogImageInputRich
                          type="file"
                          accept="image/*"
                          class="hidden"
                          (change)="uploadAndInsertBlogImage(blogEditor, $event)"
                        />
                      </div>

                      <div
                        (dragover)="onBlogImageDragOver($event)"
                        (drop)="onBlogImageDrop(blogEditor, $event)"
                      >
                        <app-rich-editor
                          #blogEditor
                          [(value)]="blogForm.body_markdown"
                          [initialEditType]="'wysiwyg'"
                          [height]="'520px'"
                        ></app-rich-editor>
                      </div>
                    </ng-container>

                    <ng-template #markdownBlogEditor>
                      <div class="flex flex-wrap items-center gap-2 text-xs">
                        <button
                          type="button"
                          class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                          (click)="applyBlogHeading(blogBody, 1)"
                        >
                          H1
                        </button>
                        <button
                          type="button"
                          class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                          (click)="applyBlogHeading(blogBody, 2)"
                        >
                          H2
                        </button>
                        <button
                          type="button"
                          class="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                          (click)="wrapBlogSelection(blogBody, '**', '**', 'bold text')"
                        >
                          B
                        </button>
                        <button
                          type="button"
                          class="rounded-full border border-slate-200 bg-white px-3 py-1 italic text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                          (click)="wrapBlogSelection(blogBody, '*', '*', 'italic text')"
                        >
                          I
                        </button>
                        <button
                          type="button"
                          class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                          (click)="insertBlogLink(blogBody)"
                        >
                          {{ 'adminUi.blog.toolbar.link' | translate }}
                        </button>
                        <button
                          type="button"
                          class="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                          (click)="insertBlogCodeBlock(blogBody)"
                        >
                          {{ 'adminUi.blog.toolbar.code' | translate }}
                        </button>
                        <button
                          type="button"
                          class="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                          (click)="insertBlogEmbed(blogBody, 'product')"
                        >
                          {{ 'adminUi.blog.toolbar.product' | translate }}
                        </button>
                        <button
                          type="button"
                          class="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                          (click)="insertBlogEmbed(blogBody, 'category')"
                        >
                          {{ 'adminUi.blog.toolbar.category' | translate }}
                        </button>
                        <button
                          type="button"
                          class="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                          (click)="insertBlogEmbed(blogBody, 'collection')"
                        >
                          {{ 'adminUi.blog.toolbar.collection' | translate }}
                        </button>
                        <button
                          type="button"
                          class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                          (click)="applyBlogList(blogBody)"
                        >
                          {{ 'adminUi.blog.toolbar.list' | translate }}
                        </button>
                        <label
                          class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"
                        >
                          {{ 'adminUi.blog.images.layout.label' | translate }}
                          <select
                            class="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            [(ngModel)]="blogImageLayout"
                          >
                            <option value="default">
                              {{ 'adminUi.blog.images.layout.default' | translate }}
                            </option>
                            <option value="wide">
                              {{ 'adminUi.blog.images.layout.wide' | translate }}
                            </option>
                            <option value="left">
                              {{ 'adminUi.blog.images.layout.left' | translate }}
                            </option>
                            <option value="right">
                              {{ 'adminUi.blog.images.layout.right' | translate }}
                            </option>
                            <option value="gallery">
                              {{ 'adminUi.blog.images.layout.gallery' | translate }}
                            </option>
                          </select>
                        </label>
                        <button
                          type="button"
                          class="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white"
                          (click)="blogImageInput.click()"
                        >
                          {{ 'adminUi.blog.actions.image' | translate }}
                        </button>
                        <input
                          #blogImageInput
                          type="file"
                          accept="image/*"
                          class="hidden"
                          (change)="uploadAndInsertBlogImage(blogBody, $event)"
                        />
                      </div>

                      <div
                        class="grid gap-3"
                        [ngClass]="
                          showBlogPreview && cmsPrefs.previewLayout() === 'split'
                            ? 'lg:grid-cols-2'
                            : ''
                        "
                      >
                        <textarea
                          #blogBody
                          rows="10"
                          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          (dragover)="onBlogImageDragOver($event)"
                          (drop)="onBlogImageDrop(blogBody, $event)"
                          [(ngModel)]="blogForm.body_markdown"
                          (scroll)="syncSplitScroll(blogBody, blogPreview)"
                        ></textarea>

                        <div
                          class="mx-auto w-full"
                          [ngClass]="cmsPreviewMaxWidthClass()"
                          [class.hidden]="!showBlogPreview"
                        >
                          <div
                            #blogPreview
                            class="markdown rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-800 shadow-sm max-h-[520px] overflow-auto dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                            [innerHTML]="
                              showBlogPreview
                                ? renderMarkdown(
                                    blogForm.body_markdown ||
                                      ('adminUi.blog.editing.previewEmpty' | translate)
                                  )
                                : ''
                            "
                            (scroll)="syncSplitScroll(blogPreview, blogBody)"
                          ></div>
                        </div>
                      </div>
                    </ng-template>
                  </div>

                  <div
                    class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/30"
                  >
                    <ng-container *ngIf="blogWritingAids() as aids">
                      <p
                        class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400"
                      >
                        {{ 'adminUi.blog.writing.title' | translate }}
                      </p>
                      <div class="mt-2 grid gap-3">
                        <div class="grid gap-1">
                          <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                            {{ 'adminUi.blog.writing.words' | translate: { count: aids.words } }}
                          </p>
                          <p class="text-xs text-slate-600 dark:text-slate-300">
                            {{
                              'adminUi.blog.writing.estimate'
                                | translate: { minutes: aids.minutes || 0 }
                            }}
                          </p>
                          <app-button
                            size="sm"
                            variant="ghost"
                            [label]="'adminUi.blog.writing.applyEstimate' | translate"
                            [disabled]="!aids.minutes"
                            (action)="applyBlogReadingTimeEstimate()"
                          ></app-button>
                        </div>

                        <div class="grid gap-1">
                          <p class="text-xs font-semibold text-slate-700 dark:text-slate-200">
                            {{ 'adminUi.blog.writing.outline' | translate }}
                          </p>
                          <p
                            *ngIf="!aids.headings.length"
                            class="text-xs text-slate-500 dark:text-slate-400"
                          >
                            {{ 'adminUi.blog.writing.outlineEmpty' | translate }}
                          </p>
                          <div
                            *ngFor="let h of aids.headings"
                            class="truncate text-slate-700 dark:text-slate-200"
                            [style.paddingLeft.px]="(h.level - 1) * 8"
                          >
                            {{ h.text }}
                          </div>
                        </div>
                      </div>
                    </ng-container>
                  </div>
                </div>
              </div>
            </div>

            <ng-container *ngIf="blogA11yIssues() as issues">
              <details
                *ngIf="issues.length"
                class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30"
                [open]="blogA11yOpen"
              >
                <summary
                  class="cursor-pointer select-none font-semibold text-amber-900 dark:text-amber-100"
                >
                  {{ 'adminUi.blog.a11y.title' | translate }} ({{ issues.length }})
                </summary>
                <div class="mt-2 grid gap-2">
                  <p class="text-xs text-amber-900/80 dark:text-amber-100/80">
                    {{ 'adminUi.blog.a11y.hint' | translate }}
                  </p>
                  <div
                    *ngFor="let issue of issues"
                    class="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-white p-2 text-xs dark:border-amber-900/50 dark:bg-slate-900"
                  >
                    <a
                      class="text-indigo-600 dark:text-indigo-300 hover:underline truncate"
                      [href]="issue.url"
                      target="_blank"
                      rel="noopener"
                    >
                      {{ issue.url }}
                    </a>
                    <div class="flex items-center gap-2">
                      <span class="text-slate-600 dark:text-slate-300">{{ issue.alt || '—' }}</span>
                      <app-button
                        size="sm"
                        variant="ghost"
                        [label]="'adminUi.blog.a11y.fixAlt' | translate"
                        (action)="promptFixBlogImageAlt(issue.index)"
                      ></app-button>
                    </div>
                  </div>
                </div>
              </details>
            </ng-container>

            <div class="grid gap-2">
              <div *ngIf="blogImages.length" class="grid gap-2">
                <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.blog.images.title' | translate }}
                </p>
                <div
                  *ngFor="let img of blogImages"
                  class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                >
                  <a
                    class="text-xs text-indigo-600 dark:text-indigo-300 hover:underline truncate"
                    [href]="img.url"
                    target="_blank"
                    rel="noopener"
                  >
                    {{ img.url }}
                  </a>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.blog.images.insertMarkdown' | translate"
                    (action)="insertBlogImageMarkdown(img.url, img.alt_text)"
                  ></app-button>
                </div>
              </div>
            </div>

            <div
              *ngIf="blogDraftHasRestore()"
              class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-semibold">{{
                  'adminUi.content.autosave.restoreFound' | translate
                }}</span>
                <span *ngIf="blogDraftRestoreAt()" class="text-amber-700 dark:text-amber-200">{{
                  blogDraftRestoreAt() | date: 'short'
                }}</span>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.actions.restore' | translate"
                  (action)="restoreBlogDraftAutosave()"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.actions.dismiss' | translate"
                  (action)="dismissBlogDraftAutosave()"
                ></app-button>
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <app-button
                [label]="'adminUi.actions.save' | translate"
                (action)="saveBlogPost()"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.blog.actions.previewLink' | translate"
                (action)="generateBlogPreviewLink()"
              ></app-button>
              <a
                class="inline-flex items-center justify-center rounded-full font-semibold transition px-3 py-2 text-sm bg-white text-slate-900 border border-slate-200 hover:border-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:bg-slate-800 dark:text-slate-50 dark:border-slate-700 dark:hover:border-slate-600"
                [attr.href]="'/blog/' + currentBlogSlug()"
                target="_blank"
                rel="noopener"
              >
                {{ 'adminUi.blog.actions.view' | translate }}
              </a>
              <span *ngIf="blogDraftReady()" class="text-xs text-slate-500 dark:text-slate-400">
                <ng-container *ngIf="!blogDraftDirty()">
                  {{ 'adminUi.content.autosave.state.saved' | translate }}
                </ng-container>
                <ng-container *ngIf="blogDraftDirty() && blogDraftAutosaving()">
                  {{ 'adminUi.content.autosave.state.autosaving' | translate }}
                </ng-container>
                <ng-container
                  *ngIf="blogDraftDirty() && !blogDraftAutosaving() && blogDraftLastAutosavedAt()"
                >
                  {{ 'adminUi.content.autosave.state.autosaved' | translate }}
                  {{ blogDraftLastAutosavedAt() | date: 'shortTime' }}
                </ng-container>
                <ng-container
                  *ngIf="blogDraftDirty() && !blogDraftAutosaving() && !blogDraftLastAutosavedAt()"
                >
                  {{ 'adminUi.content.autosave.state.unsaved' | translate }}
                </ng-container>
              </span>
            </div>
            <div
              *ngIf="blogPreviewUrl"
              class="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-950/30"
            >
              <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                {{ 'adminUi.blog.preview.title' | translate }}
              </p>
              <div class="flex items-center gap-2">
                <input
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [value]="blogPreviewUrl"
                  readonly
                />
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.blog.actions.copy' | translate"
                  (action)="copyBlogPreviewLink()"
                ></app-button>
              </div>
              <p *ngIf="blogPreviewExpiresAt" class="text-xs text-slate-500 dark:text-slate-400">
                {{ 'adminUi.blog.preview.expires' | translate }}
                {{ blogPreviewExpiresAt | date: 'short' }}
              </p>
            </div>

            <details
              class="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <summary
                class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50"
              >
                {{ 'adminUi.blog.seo.title' | translate }}
              </summary>
              <div class="mt-3 grid gap-3">
                <p class="text-sm text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.blog.seo.hint' | translate }}
                </p>

                <div class="grid gap-4 md:grid-cols-2">
                  <div
                    *ngFor="let lang of blogSocialLangs"
                    class="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <p
                        class="text-xs font-semibold tracking-wide uppercase text-slate-600 dark:text-slate-300"
                      >
                        {{ lang.toUpperCase() }}
                      </p>
                      <div class="flex items-center gap-2">
                        <a
                          class="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
                          [attr.href]="blogPublicUrl(lang)"
                          target="_blank"
                          rel="noopener"
                        >
                          {{ 'adminUi.blog.actions.view' | translate }}
                        </a>
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.blog.actions.copy' | translate"
                          (action)="copyText(blogPublicUrl(lang))"
                        ></app-button>
                      </div>
                    </div>

                    <div *ngIf="blogSeoHasContent(lang); else seoMissingLang" class="grid gap-3">
                      <div class="grid gap-1">
                        <p
                          class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400"
                        >
                          {{ 'adminUi.blog.seo.searchPreview' | translate }}
                        </p>
                        <div
                          class="rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-900"
                        >
                          <p class="text-emerald-700 dark:text-emerald-300 truncate">
                            {{ blogPublicUrl(lang) }}
                          </p>
                          <p
                            class="mt-1 text-sm font-semibold text-indigo-700 dark:text-indigo-200 truncate"
                          >
                            {{ blogSeoTitlePreview(lang) }}
                          </p>
                          <p class="mt-1 text-xs text-slate-700 dark:text-slate-200">
                            {{ blogSeoDescriptionPreview(lang) }}
                          </p>
                        </div>
                      </div>

                      <div class="grid gap-1 text-xs">
                        <p
                          class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400"
                        >
                          {{ 'adminUi.blog.seo.checks' | translate }}
                        </p>
                        <div
                          class="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
                        >
                          <span class="text-slate-700 dark:text-slate-200">
                            {{
                              'adminUi.blog.seo.length.title'
                                | translate: { count: blogSeoTitleFull(lang).length }
                            }}
                          </span>
                          <span class="text-slate-700 dark:text-slate-200">
                            {{
                              'adminUi.blog.seo.length.description'
                                | translate: { count: blogSeoDescriptionFull(lang).length }
                            }}
                          </span>
                        </div>

                        <div
                          *ngFor="let issue of blogSeoIssues(lang)"
                          class="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
                        >
                          {{ issue.key | translate: issue.params }}
                        </div>
                      </div>

                      <div class="grid gap-1">
                        <p
                          class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400"
                        >
                          {{ 'adminUi.blog.seo.socialPreview' | translate }}
                        </p>
                        <div
                          class="rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-900"
                        >
                          <img
                            *ngIf="blogPreviewToken || blogForm.status === 'published'"
                            [src]="blogPreviewOgImageUrl(lang) || blogPublishedOgImageUrl(lang)"
                            [alt]="'adminUi.blog.social.ogAlt' | translate"
                            class="w-full rounded-lg border border-slate-200 bg-white object-cover dark:border-slate-800 dark:bg-slate-900"
                            loading="lazy"
                          />
                          <p
                            class="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-50 truncate"
                          >
                            {{ blogSeoTitlePreview(lang) }}
                          </p>
                          <p class="mt-1 text-xs text-slate-700 dark:text-slate-200">
                            {{ blogSeoDescriptionPreview(lang) }}
                          </p>
                        </div>
                      </div>
                    </div>

                    <ng-template #seoMissingLang>
                      <div
                        class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
                      >
                        {{ 'adminUi.blog.seo.missingLang' | translate }}
                      </div>
                    </ng-template>
                  </div>
                </div>
              </div>
            </details>

            <details
              class="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <summary
                class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50"
              >
                {{ 'adminUi.blog.social.title' | translate }}
              </summary>
              <div class="mt-3 grid gap-3">
                <p class="text-sm text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.blog.social.hint' | translate }}
                </p>

                <div
                  *ngIf="!blogPreviewToken"
                  class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
                >
                  <p class="font-semibold">
                    {{ 'adminUi.blog.social.previewTokenTitle' | translate }}
                  </p>
                  <p class="text-xs">{{ 'adminUi.blog.social.previewTokenCopy' | translate }}</p>
                  <div class="mt-2">
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.blog.actions.previewLink' | translate"
                      (action)="generateBlogPreviewLink()"
                    ></app-button>
                  </div>
                </div>

                <div class="grid gap-4 md:grid-cols-2">
                  <div
                    *ngFor="let lang of blogSocialLangs"
                    class="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <p
                        class="text-xs font-semibold tracking-wide uppercase text-slate-600 dark:text-slate-300"
                      >
                        {{ lang.toUpperCase() }}
                      </p>
                      <div class="flex items-center gap-2">
                        <a
                          class="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
                          [attr.href]="blogPublicUrl(lang)"
                          target="_blank"
                          rel="noopener"
                        >
                          {{ 'adminUi.blog.actions.view' | translate }}
                        </a>
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.blog.actions.copy' | translate"
                          (action)="copyText(blogPublicUrl(lang))"
                        ></app-button>
                      </div>
                    </div>

                    <img
                      *ngIf="blogPreviewToken || blogForm.status === 'published'"
                      [src]="blogPreviewOgImageUrl(lang) || blogPublishedOgImageUrl(lang)"
                      [alt]="'adminUi.blog.social.ogAlt' | translate"
                      class="w-full rounded-lg border border-slate-200 bg-white object-cover dark:border-slate-800 dark:bg-slate-900"
                      loading="lazy"
                    />

                    <div class="grid gap-2">
                      <label
                        class="grid gap-1 text-xs font-medium text-slate-700 dark:text-slate-200"
                      >
                        {{ 'adminUi.blog.social.pageUrl' | translate }}
                        <input
                          class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          [value]="blogPublicUrl(lang)"
                          readonly
                        />
                      </label>

                      <label
                        class="grid gap-1 text-xs font-medium text-slate-700 dark:text-slate-200"
                        *ngIf="blogPreviewToken"
                      >
                        {{ 'adminUi.blog.social.previewImageUrl' | translate }}
                        <div class="flex items-center gap-2">
                          <input
                            class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            [value]="blogPreviewOgImageUrl(lang) || ''"
                            readonly
                          />
                          <app-button
                            size="sm"
                            variant="ghost"
                            [label]="'adminUi.blog.actions.copy' | translate"
                            (action)="copyText(blogPreviewOgImageUrl(lang) || '')"
                          ></app-button>
                        </div>
                      </label>

                      <label
                        class="grid gap-1 text-xs font-medium text-slate-700 dark:text-slate-200"
                      >
                        {{ 'adminUi.blog.social.publishedImageUrl' | translate }}
                        <div class="flex items-center gap-2">
                          <input
                            class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            [value]="blogPublishedOgImageUrl(lang)"
                            readonly
                          />
                          <app-button
                            size="sm"
                            variant="ghost"
                            [label]="'adminUi.blog.actions.copy' | translate"
                            (action)="copyText(blogPublishedOgImageUrl(lang))"
                          ></app-button>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </details>

            <div
              class="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {{ 'adminUi.blog.revisions.title' | translate }}
                </p>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.actions.refresh' | translate"
                  (action)="loadBlogVersions()"
                ></app-button>
              </div>
              <div
                *ngIf="blogVersions.length === 0"
                class="text-xs text-slate-500 dark:text-slate-400"
              >
                {{ 'adminUi.blog.revisions.empty' | translate }}
              </div>
              <div
                *ngFor="let v of blogVersions"
                class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
              >
                <div>
                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    v{{ v.version }} · {{ v.created_at | date: 'short' }}
                  </p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.status.' + v.status | translate }}
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.blog.revisions.diff' | translate"
                    (action)="selectBlogVersion(v.version)"
                  ></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.blog.revisions.rollback' | translate"
                    (action)="rollbackBlogVersion(v.version)"
                  ></app-button>
                </div>
              </div>

              <div
                *ngIf="blogVersionDetail"
                class="grid gap-2 pt-2 border-t border-slate-200 dark:border-slate-800"
              >
                <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  {{
                    'adminUi.blog.revisions.diffVsCurrent'
                      | translate: { version: blogVersionDetail.version }
                  }}
                </p>
                <div
                  class="rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs whitespace-pre-wrap text-slate-900 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-100"
                >
                  <ng-container *ngFor="let part of blogDiffParts">
                    <span
                      [ngClass]="
                        part.added
                          ? 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100'
                          : part.removed
                            ? 'bg-rose-200 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100'
                            : ''
                      "
                      >{{ part.value }}</span
                    >
                  </ng-container>
                </div>
              </div>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              {{ 'adminUi.blog.editing.toolbarTip' | translate }}
            </p>
          </div>
        </section>

        <section
          class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {{ 'adminUi.blog.moderation.title' | translate }}
            </h2>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'adminUi.actions.refresh' | translate"
              (action)="loadFlaggedComments()"
            ></app-button>
          </div>
          <div
            *ngIf="flaggedCommentsError"
            class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
          >
            {{ flaggedCommentsError }}
          </div>
          <div *ngIf="flaggedCommentsLoading()" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'adminUi.blog.moderation.loading' | translate }}
          </div>
          <div
            *ngIf="
              !flaggedCommentsLoading() && !flaggedCommentsError && flaggedComments().length === 0
            "
            class="text-sm text-slate-500 dark:text-slate-400"
          >
            {{ 'adminUi.blog.moderation.empty' | translate }}
          </div>
          <div *ngIf="!flaggedCommentsLoading() && flaggedComments().length" class="grid gap-3">
            <div
              *ngFor="let c of flaggedComments()"
              class="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="grid gap-0.5">
                  <p class="font-semibold text-slate-900 dark:text-slate-50">
                    {{ commentAuthorLabel(c.author) }}
                  </p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    /blog/{{ c.post_slug }} · {{ c.created_at | date: 'short' }} ·
                    {{ 'adminUi.blog.moderation.flagsCount' | translate: { count: c.flag_count } }}
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <a
                    class="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
                    [attr.href]="'/blog/' + c.post_slug"
                    target="_blank"
                    rel="noopener"
                    (click)="$event.stopPropagation()"
                  >
                    {{ 'adminUi.blog.actions.view' | translate }}
                  </a>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.blog.moderation.actions.resolve' | translate"
                    (action)="resolveFlags(c)"
                  ></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="
                      c.is_hidden
                        ? ('adminUi.blog.moderation.actions.unhide' | translate)
                        : ('adminUi.blog.moderation.actions.hide' | translate)
                    "
                    [disabled]="blogCommentModerationBusy.has(c.id)"
                    (action)="toggleHide(c)"
                  ></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.actions.delete' | translate"
                    [disabled]="blogCommentModerationBusy.has(c.id)"
                    (action)="adminDeleteComment(c)"
                  ></app-button>
                </div>
              </div>
              <p class="mt-2 text-sm whitespace-pre-line text-slate-700 dark:text-slate-200">
                {{ c.body || ('adminUi.blog.moderation.deletedBody' | translate) }}
              </p>
              <div
                *ngIf="c.flags?.length"
                class="mt-2 grid gap-1 text-xs text-slate-600 dark:text-slate-300"
              >
                <p class="font-semibold text-slate-900 dark:text-slate-50">
                  {{ 'adminUi.blog.moderation.flagsTitle' | translate }}
                </p>
                <div *ngFor="let f of c.flags" class="flex items-center justify-between gap-2">
                  <span>{{ f.reason || '—' }}</span>
                  <span class="text-slate-500 dark:text-slate-400">{{
                    f.created_at | date: 'short'
                  }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>  `,
})
export class AdminBlogEditorComponent implements OnInit, OnChanges, OnDestroy {
  /**
   * Shared content-blocks list, owned/loaded by the parent AdminComponent (it is
   * also read by the Settings > Content panel). Threaded in read-only; the blog
   * post list is derived from it via blogPosts().
   */
  @Input() contentBlocks: AdminContent[] = [];
  /** Reloads the shared content-blocks list on the parent after a blog mutation. */
  @Input() reloadContentBlocks: () => void = () => {};
  /** Shared optimistic-concurrency version helpers (bound to the parent's map). */
  @Input() withExpectedVersion: <T extends Record<string, unknown>>(
    key: string,
    payload: T,
  ) => T & { expected_version?: number } = (_key, payload) => payload;
  @Input() rememberContentVersion: (
    key: string,
    block: { version?: number } | null | undefined,
  ) => void = () => {};
  @Input() handleContentConflict: (err: unknown, key: string, reload: () => void) => boolean = () =>
    false;

  private cmsDraftPoller: number | null = null;
  private routeSub?: Subscription;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly admin: AdminService,
    private readonly blog: BlogService,
    private readonly toast: ToastService,
    private readonly translate: TranslateService,
    private readonly markdown: MarkdownService,
    public readonly cmsPrefs: CmsEditorPrefsService,
    private readonly cmsState: AdminCmsStateService,
  ) {}

  ngOnInit(): void {
    this.loadFlaggedComments();
    this.applyEditQuery(this.route.snapshot.queryParams || {});
    this.routeSub = this.route.queryParams.subscribe((q) => this.applyEditQuery(q || {}));
    if (typeof window !== 'undefined' && this.cmsDraftPoller === null) {
      this.observeBlogDraft();
      this.cmsDraftPoller = window.setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        this.observeBlogDraft();
      }, CMS_DRAFT_POLL_INTERVAL_MS);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['contentBlocks']) {
      this.pruneBlogBulkSelection();
    }
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.routeSub = undefined;
    if (this.cmsDraftPoller !== null && typeof window !== 'undefined') {
      window.clearInterval(this.cmsDraftPoller);
      this.cmsDraftPoller = null;
    }
  }

  private applyEditQuery(query: Params): void {
    const raw = typeof query['edit'] === 'string' ? query['edit'] : '';
    const cleaned = raw.trim();
    if (!cleaned) return;
    const key = cleaned.startsWith('blog.') ? cleaned : `blog.${cleaned}`;
    if (this.selectedBlogKey === key) return;
    this.loadBlogEditor(key);
  }

  private observeBlogDraft(): void {
    const blogKey = this.selectedBlogKey;
    if (!blogKey) return;
    const id = this.blogDraftId(blogKey, this.blogEditLang);
    const manager = this.cmsBlogDrafts.get(id);
    if (manager?.isReady()) {
      manager.observe(this.currentBlogDraftState());
    }
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }

  cmsAdvanced(): boolean {
    return this.cmsPrefs.mode() === 'advanced';
  }

  cmsPreviewMaxWidthClass(): string {
    switch (this.cmsPrefs.previewDevice()) {
      case 'mobile':
        return 'max-w-[390px]';
      case 'tablet':
        return 'max-w-[768px]';
      default:
        return 'max-w-[1024px]';
    }
  }

  cmsPreviewViewportWidth(): number {
    switch (this.cmsPrefs.previewDevice()) {
      case 'mobile':
        return 390;
      case 'tablet':
        return 768;
      default:
        return 1024;
    }
  }

  private previewScrollSyncActive = false;

  syncSplitScroll(source: HTMLElement, target: HTMLElement): void {
    if (this.cmsPrefs.previewLayout() !== 'split') return;
    if (this.previewScrollSyncActive) return;

    const sourceScrollable = source.scrollHeight - source.clientHeight;
    const targetScrollable = target.scrollHeight - target.clientHeight;
    if (sourceScrollable <= 0 || targetScrollable <= 0) return;

    const ratio = sourceScrollable ? source.scrollTop / sourceScrollable : 0;
    this.previewScrollSyncActive = true;
    target.scrollTop = ratio * targetScrollable;

    requestAnimationFrame(() => {
      this.previewScrollSyncActive = false;
    });
  }

  toLocalDateTime(iso: string): string {
    const d = new Date(iso);
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
  }

  private pinnedSlotFromMeta(meta: Record<string, any> | null | undefined): number | null {
    if (!meta) return null;
    const pinned = meta['pinned'];
    let pinnedFlag = false;
    if (typeof pinned === 'boolean') pinnedFlag = pinned;
    else if (typeof pinned === 'number') pinnedFlag = pinned === 1;
    else if (typeof pinned === 'string')
      pinnedFlag = ['1', 'true', 'yes', 'on'].includes(pinned.trim().toLowerCase());
    if (!pinnedFlag) return null;
    const raw = meta['pin_order'];
    const parsed = Number(typeof raw === 'number' ? raw : typeof raw === 'string' ? raw.trim() : 1);
    const normalized = Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1;
    return Math.max(1, normalized);
  }

  private truncateForPreview(value: string, max: number): string {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return '';
    if (text.length <= max) return text;
    return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
  }

  private toSeoDescription(markdownOrText: string): string {
    const cleaned = String(markdownOrText || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[#>*_~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned;
  }

  copyText(text: string): void {
    const value = (text || '').trim();
    if (!value) return;
    void this.copyToClipboard(value).then((ok) => {
      if (ok) this.toast.info(this.t('adminUi.blog.social.success.copied'));
      else this.toast.error(this.t('adminUi.blog.social.errors.copy'));
    });
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
      } catch {
        return false;
      }
    }
  }

  renderMarkdown(markdown: string): string {
    return this.markdown.render(markdown);
  }

  private suggestAltFromUrl(url: string): string {
    const cleaned = String(url || '')
      .split('?')[0]
      .split('#')[0]
      .trim();
    const filename = cleaned.split('/').pop() || '';
    const base = filename.replace(/\.[^.]+$/, '');
    return base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'image';
  }

  private countMarkdownWords(markdown: string): number {
    const cleaned = String(markdown || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[#>*_~`-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const matches = cleaned.match(/[\p{L}\p{N}]+/gu);
    return matches?.length ?? 0;
  }

  private extractMarkdownHeadings(markdown: string): Array<{ level: number; text: string }> {
    const lines = String(markdown || '').split('\n');
    const out: Array<{ level: number; text: string }> = [];
    let inCode = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('```')) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;
      const match = /^(#{1,6})\s+(.+)$/.exec(line);
      if (!match) continue;
      const level = match[1].length;
      if (level > 3) continue;
      const text = match[2]
        .replace(/\s+#+\s*$/, '')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim();
      if (!text) continue;
      out.push({ level, text });
      if (out.length >= 40) break;
    }
    return out;
  }

  private insertAtCursor(textarea: HTMLTextAreaElement, text: string): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const next = value.slice(0, start) + text + value.slice(end);
    const pos = start + text.length;
    this.updateBlogBody(textarea, next, pos, pos);
  }

  private parseTags(raw: string): string[] {
    const parts = (raw || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of parts) {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(part);
    }
    return out;
  }

  private toIsoFromLocal(value: string): string | null {
    const trimmed = (value || '').trim();
    if (!trimmed) return null;
    const date = new Date(trimmed);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toISOString();
  }

  private mergeTags(existing: string[], incoming: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of [...existing, ...incoming]) {
      const trimmed = String(value || '').trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
    return out;
  }

  private removeTags(existing: string[], remove: string[]): string[] {
    const removeSet = new Set(
      remove
        .map((t) =>
          String(t || '')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    );
    return existing.filter(
      (t) =>
        !removeSet.has(
          String(t || '')
            .trim()
            .toLowerCase(),
        ),
    );
  }
  showBlogCreate = false;

  blogCreate: {
    baseLang: 'en' | 'ro';
    status: ContentStatusUi;
    published_at: string;
    published_until: string;
    title: string;
    body_markdown: string;
    summary: string;
    tags: string;
    series: string;
    cover_image_url: string;
    reading_time_minutes: string;
    pinned: boolean;
    pin_order: string;
    includeTranslation: boolean;
    translationTitle: string;
    translationBody: string;
  } = {
    baseLang: 'en',
    status: 'draft',
    published_at: '',
    published_until: '',
    title: '',
    body_markdown: '',
    summary: '',
    tags: '',
    series: '',
    cover_image_url: '',
    reading_time_minutes: '',
    pinned: false,
    pin_order: '1',
    includeTranslation: false,
    translationTitle: '',
    translationBody: '',
  };

  selectedBlogKey: string | null = null;

  blogBaseLang: 'en' | 'ro' = 'en';

  blogEditLang: 'en' | 'ro' = 'en';

  blogForm = {
    title: '',
    body_markdown: '',
    status: 'draft',
    published_at: '',
    published_until: '',
    summary: '',
    tags: '',
    series: '',
    cover_image_url: '',
    cover_fit: 'cover' as 'cover' | 'contain',
    reading_time_minutes: '',
    pinned: false,
    pin_order: '1',
  };

  blogMeta: Record<string, any> = {};

  blogImages: {
    id: string;
    url: string;
    alt_text?: string | null;
    sort_order: number;
    focal_x: number;
    focal_y: number;
  }[] = [];

  blogBulkSelection = new Set<string>();

  blogDeleteBusy = new Set<string>();

  blogBulkAction: 'publish' | 'unpublish' | 'schedule' | 'tags_add' | 'tags_remove' = 'publish';

  blogBulkPublishAt = '';

  blogBulkUnpublishAt = '';

  blogBulkTags = '';

  blogBulkSaving = false;

  blogBulkError = '';

  blogPinsSaving = false;

  draggingBlogPinKey: string | null = null;

  showBlogCoverLibrary = false;

  showBlogPreview = false;

  blogA11yOpen = false;

  blogSeoSnapshots: Record<UiLang, { title: string; body_markdown: string } | null> = {
    en: null,
    ro: null,
  };

  blogSeoSnapshotsKey: string | null = null;

  blogSeoSnapshotsLoading = false;

  useRichBlogEditor = true;

  blogImageLayout: 'default' | 'wide' | 'left' | 'right' | 'gallery' = 'default';

  blogSocialLangs: UiLang[] = ['en', 'ro'];

  blogPreviewUrl: string | null = null;

  blogPreviewToken: string | null = null;

  blogPreviewExpiresAt: string | null = null;

  blogVersions: ContentBlockVersionListItem[] = [];

  blogVersionDetail: ContentBlockVersionRead | null = null;

  blogDiffParts: { value: string; added?: boolean; removed?: boolean }[] = [];

  blogCommentModerationBusy = new Set<string>();

  flaggedComments = signal<AdminBlogComment[]>([]);

  flaggedCommentsLoading = signal<boolean>(false);

  flaggedCommentsError: string | null = null;

  private get cmsBlogDrafts(): Map<string, CmsDraftManager<BlogDraftState>> {
    return this.cmsState.cmsBlogDrafts;
  }

  private blogDraftId(key: string, lang: UiLang): string {
    return `${key}.${lang}`;
  }

  private ensureBlogDraft(key: string, lang: UiLang): CmsDraftManager<BlogDraftState> {
    return this.cmsState.ensureBlogDraft(key, lang);
  }

  private currentBlogDraftState(): BlogDraftState {
    return {
      title: this.blogForm.title,
      body_markdown: this.blogForm.body_markdown,
      status:
        this.blogForm.status === 'published'
          ? 'published'
          : this.blogForm.status === 'review'
            ? 'review'
            : 'draft',
      published_at: this.blogForm.published_at,
      published_until: this.blogForm.published_until,
      summary: this.blogForm.summary,
      tags: this.blogForm.tags,
      series: this.blogForm.series,
      cover_image_url: this.blogForm.cover_image_url,
      cover_fit: this.blogForm.cover_fit,
      reading_time_minutes: this.blogForm.reading_time_minutes,
      pinned: Boolean(this.blogForm.pinned),
      pin_order: this.blogForm.pin_order,
    };
  }

  private applyBlogDraftState(draft: BlogDraftState): void {
    this.blogForm = {
      ...this.blogForm,
      ...draft,
    };
  }

  blogDraftReady(): boolean {
    if (!this.selectedBlogKey) return false;
    const id = this.blogDraftId(this.selectedBlogKey, this.blogEditLang);
    const manager = this.cmsBlogDrafts.get(id);
    return manager?.isReady() ?? false;
  }

  blogDraftDirty(): boolean {
    if (!this.selectedBlogKey) return false;
    const id = this.blogDraftId(this.selectedBlogKey, this.blogEditLang);
    return this.cmsBlogDrafts.get(id)?.dirty ?? false;
  }

  blogDraftAutosaving(): boolean {
    if (!this.selectedBlogKey) return false;
    const id = this.blogDraftId(this.selectedBlogKey, this.blogEditLang);
    return this.cmsBlogDrafts.get(id)?.autosavePending ?? false;
  }

  blogDraftLastAutosavedAt(): string | null {
    if (!this.selectedBlogKey) return null;
    const id = this.blogDraftId(this.selectedBlogKey, this.blogEditLang);
    return this.cmsBlogDrafts.get(id)?.lastAutosavedAt ?? null;
  }

  blogDraftHasRestore(): boolean {
    if (!this.selectedBlogKey) return false;
    const manager = this.ensureBlogDraft(this.selectedBlogKey, this.blogEditLang);
    return manager.hasRestorableAutosave && !manager.dirty;
  }

  blogDraftRestoreAt(): string | null {
    if (!this.selectedBlogKey) return null;
    const manager = this.ensureBlogDraft(this.selectedBlogKey, this.blogEditLang);
    return manager.restorableAutosaveAt;
  }

  restoreBlogDraftAutosave(): void {
    if (!this.selectedBlogKey) return;
    const manager = this.ensureBlogDraft(this.selectedBlogKey, this.blogEditLang);
    const next = manager.restoreAutosave(this.currentBlogDraftState());
    if (next) this.applyBlogDraftState(next);
  }

  dismissBlogDraftAutosave(): void {
    if (!this.selectedBlogKey) return;
    const manager = this.ensureBlogDraft(this.selectedBlogKey, this.blogEditLang);
    manager.discardAutosave();
  }

  commentAuthorLabel(author: {
    id: string;
    name?: string | null;
    username?: string | null;
    name_tag?: number | null;
  }): string {
    return formatIdentity(author, author.id);
  }

  blogPosts(): AdminContent[] {
    return this.contentBlocks.filter((c) => c.key.startsWith('blog.'));
  }

  blogPinnedSlot(post: AdminContent): number | null {
    return this.pinnedSlotFromMeta(post.meta || null);
  }

  blogPinnedPosts(): AdminContent[] {
    const pinned = this.blogPosts().filter((p) => Boolean(this.blogPinnedSlot(p)));
    return pinned.sort((a, b) => {
      const ao = this.blogPinnedSlot(a) ?? 999;
      const bo = this.blogPinnedSlot(b) ?? 999;
      if (ao !== bo) return ao - bo;
      const ap = a.published_at ? Date.parse(a.published_at) : 0;
      const bp = b.published_at ? Date.parse(b.published_at) : 0;
      if (ap !== bp) return bp - ap;
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });
  }

  private nextBlogPinOrder(): number {
    const orders = this.blogPosts()
      .map((p) => this.blogPinnedSlot(p))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const max = orders.length ? Math.max(...orders) : 0;
    return max + 1;
  }

  onBlogPinDragStart(key: string): void {
    this.draggingBlogPinKey = (key || '').trim() || null;
  }

  onBlogPinDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  async onBlogPinDrop(targetKey: string): Promise<void> {
    const fromKey = (this.draggingBlogPinKey || '').trim();
    const toKey = (targetKey || '').trim();
    this.draggingBlogPinKey = null;
    if (!fromKey || !toKey || fromKey === toKey || this.blogPinsSaving) return;

    const pinned = this.blogPinnedPosts();
    const pinnedKeys = pinned.map((p) => p.key);
    const fromIdx = pinnedKeys.indexOf(fromKey);
    const toIdx = pinnedKeys.indexOf(toKey);
    if (fromIdx === -1 || toIdx === -1) return;

    const nextKeys = [...pinnedKeys];
    nextKeys.splice(fromIdx, 1);
    const insertIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
    nextKeys.splice(insertIdx, 0, fromKey);

    const updates: Array<{ key: string; meta: Record<string, any> }> = [];
    nextKeys.forEach((key, idx) => {
      const post = pinned.find((p) => p.key === key);
      if (!post) return;
      const nextOrder = idx + 1;
      if ((this.blogPinnedSlot(post) ?? 1) === nextOrder) return;
      const meta = { ...post.meta };
      meta['pinned'] = true;
      meta['pin_order'] = nextOrder;
      updates.push({ key, meta });
    });
    if (!updates.length) return;

    this.blogPinsSaving = true;
    try {
      for (const update of updates) {
        const updated = await firstValueFrom(
          this.admin.updateContentBlock(
            update.key,
            this.withExpectedVersion(update.key, { meta: update.meta }),
          ),
        );
        this.rememberContentVersion(update.key, updated);
      }
      this.toast.success(this.t('adminUi.blog.pins.success.reordered'));
      this.reloadContentBlocks();
    } catch {
      this.toast.error(this.t('adminUi.blog.pins.errors.reorder'));
      this.reloadContentBlocks();
    } finally {
      this.blogPinsSaving = false;
    }
  }

  isBlogSelected(key: string): boolean {
    return this.blogBulkSelection.has(key);
  }

  toggleBlogSelection(key: string, event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (target?.checked) {
      this.blogBulkSelection.add(key);
    } else {
      this.blogBulkSelection.delete(key);
    }
    this.blogBulkError = '';
  }

  areAllBlogSelected(): boolean {
    const posts = this.blogPosts();
    if (!posts.length) return false;
    return posts.every((post) => this.blogBulkSelection.has(post.key));
  }

  toggleSelectAllBlogs(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    if (target.checked) {
      this.blogPosts().forEach((post) => this.blogBulkSelection.add(post.key));
    } else {
      this.blogBulkSelection.clear();
    }
    this.blogBulkError = '';
  }

  clearBlogBulkSelection(): void {
    this.blogBulkSelection.clear();
    this.blogBulkError = '';
  }

  canApplyBlogBulk(): boolean {
    if (this.blogBulkSelection.size === 0) return false;
    if (this.blogBulkAction === 'schedule') {
      const publishIso = this.toIsoFromLocal(this.blogBulkPublishAt);
      if (!publishIso) return false;
      if (this.blogBulkUnpublishAt) {
        const unpublishIso = this.toIsoFromLocal(this.blogBulkUnpublishAt);
        if (!unpublishIso) return false;
        if (new Date(unpublishIso).getTime() <= new Date(publishIso).getTime()) return false;
      }
    }
    if (this.blogBulkAction === 'tags_add' || this.blogBulkAction === 'tags_remove') {
      return this.parseTags(this.blogBulkTags).length > 0;
    }
    return true;
  }

  blogBulkPreview(): string {
    const count = this.blogBulkSelection.size;
    if (!count) return this.t('adminUi.blog.bulk.previewEmpty');
    switch (this.blogBulkAction) {
      case 'publish':
        return this.t('adminUi.blog.bulk.previewPublish', { count });
      case 'unpublish':
        return this.t('adminUi.blog.bulk.previewUnpublish', { count });
      case 'schedule': {
        const publishIso = this.toIsoFromLocal(this.blogBulkPublishAt);
        const publishLabel = publishIso ? new Date(publishIso).toLocaleString() : '—';
        const unpublishIso = this.toIsoFromLocal(this.blogBulkUnpublishAt);
        const unpublishLabel = unpublishIso ? new Date(unpublishIso).toLocaleString() : '—';
        return this.t('adminUi.blog.bulk.previewSchedule', {
          count,
          publish: publishLabel,
          unpublish: unpublishLabel,
        });
      }
      case 'tags_add':
        return this.t('adminUi.blog.bulk.previewTagsAdd', {
          count,
          tags: this.parseTags(this.blogBulkTags).join(', '),
        });
      case 'tags_remove':
        return this.t('adminUi.blog.bulk.previewTagsRemove', {
          count,
          tags: this.parseTags(this.blogBulkTags).join(', '),
        });
      default:
        return this.t('adminUi.blog.bulk.previewEmpty');
    }
  }

  applyBlogBulkAction(): void {
    if (!this.canApplyBlogBulk()) return;
    this.blogBulkSaving = true;
    this.blogBulkError = '';
    const keys = Array.from(this.blogBulkSelection);
    const detailRequests = keys.map((key) =>
      this.admin.getContent(key).pipe(
        map((block) => ({ key, block })),
        catchError(() => of({ key, block: null })),
      ),
    );
    forkJoin(detailRequests).subscribe({
      next: (rows) => {
        const updates = rows
          .map(({ key, block }) => {
            if (!block) return { key, update$: null };
            this.rememberContentVersion(key, block);
            const payload = this.buildBlogBulkPayload(block);
            if (!payload) return { key, update$: null };
            return {
              key,
              update$: this.admin
                .updateContentBlock(key, this.withExpectedVersion(key, payload))
                .pipe(
                  map((res) => ({ key, res })),
                  catchError((error) => of({ key, error })),
                ),
            };
          })
          .filter((row) => row.update$ !== null) as Array<{ key: string; update$: any }>;

        if (!updates.length) {
          this.blogBulkSaving = false;
          this.blogBulkError = this.t('adminUi.blog.bulk.noChanges');
          return;
        }

        forkJoin(updates.map((row) => row.update$)).subscribe({
          next: (results) => {
            const failures = results.filter((r: any) => r?.error);
            const successCount = results.length - failures.length;
            if (successCount) {
              this.toast.success(this.t('adminUi.blog.bulk.success', { count: successCount }));
            }
            if (failures.length) {
              this.toast.error(this.t('adminUi.blog.bulk.errors', { count: failures.length }));
            }
            this.blogBulkSaving = false;
            this.reloadContentBlocks();
          },
          error: () => {
            this.blogBulkSaving = false;
            this.blogBulkError = this.t('adminUi.blog.bulk.errors', { count: keys.length });
          },
        });
      },
      error: () => {
        this.blogBulkSaving = false;
        this.blogBulkError = this.t('adminUi.blog.bulk.loadError');
      },
    });
  }

  extractBlogSlug(key: string): string {
    return key.startsWith('blog.') ? key.slice('blog.'.length) : key;
  }

  currentBlogSlug(): string {
    return this.selectedBlogKey ? this.extractBlogSlug(this.selectedBlogKey) : '';
  }

  startBlogCreate(): void {
    this.showBlogCreate = true;
    this.selectedBlogKey = null;
    this.blogImages = [];
    this.showBlogCoverLibrary = false;
    this.blogCreate = {
      baseLang: 'en',
      status: 'draft',
      published_at: '',
      published_until: '',
      title: '',
      body_markdown: '',
      summary: '',
      tags: '',
      series: '',
      cover_image_url: '',
      reading_time_minutes: '',
      pinned: false,
      pin_order: String(this.nextBlogPinOrder()),
      includeTranslation: false,
      translationTitle: '',
      translationBody: '',
    };
  }

  cancelBlogCreate(): void {
    this.showBlogCreate = false;
  }

  closeBlogEditor(): void {
    this.selectedBlogKey = null;
    this.blogImages = [];
    this.showBlogCoverLibrary = false;
    this.blogPreviewUrl = null;
    this.blogPreviewToken = null;
    this.blogPreviewExpiresAt = null;
    this.blogVersions = [];
    this.blogVersionDetail = null;
    this.blogDiffParts = [];
    this.resetBlogForm();
  }

  async createBlogPost(): Promise<void> {
    const baseSlug = this.blogCreateSlug();
    if (!baseSlug) {
      this.toast.error(
        this.t('adminUi.blog.errors.slugRequiredTitle'),
        this.t('adminUi.blog.errors.slugRequiredCopy'),
      );
      return;
    }
    if (!this.blogCreate.title.trim() || !this.blogCreate.body_markdown.trim()) {
      this.toast.error(this.t('adminUi.blog.errors.titleBodyRequired'));
      return;
    }

    const baseLang = this.blogCreate.baseLang;
    const translationLang: 'en' | 'ro' = baseLang === 'en' ? 'ro' : 'en';
    const meta: Record<string, any> = {};
    const summary = this.blogCreate.summary.trim();
    if (summary) {
      meta['summary'] = { [baseLang]: summary };
    }
    const tags = this.parseTags(this.blogCreate.tags);
    if (tags.length) {
      meta['tags'] = tags;
    }
    const series = this.blogCreate.series.trim();
    if (series) {
      meta['series'] = series;
    }
    const cover = this.blogCreate.cover_image_url.trim();
    if (cover) {
      meta['cover_image_url'] = cover;
    }
    const rt = Number(String(this.blogCreate.reading_time_minutes || '').trim());
    if (Number.isFinite(rt) && rt > 0) {
      meta['reading_time_minutes'] = Math.trunc(rt);
    }
    if (this.blogCreate.pinned) {
      const rawOrder = Number(String(this.blogCreate.pin_order || '').trim());
      const normalized =
        Number.isFinite(rawOrder) && rawOrder > 0 ? Math.trunc(rawOrder) : this.nextBlogPinOrder();
      meta['pinned'] = true;
      meta['pin_order'] = Math.max(1, normalized);
    }
    const published_at = this.blogCreate.published_at
      ? new Date(this.blogCreate.published_at).toISOString()
      : undefined;
    const published_until = this.blogCreate.published_until
      ? new Date(this.blogCreate.published_until).toISOString()
      : undefined;

    try {
      const payload = {
        title: this.blogCreate.title.trim(),
        body_markdown: this.blogCreate.body_markdown,
        status: this.blogCreate.status,
        lang: baseLang,
        published_at,
        published_until,
        meta: Object.keys(meta).length ? meta : undefined,
      };

      let slug = baseSlug;
      let key = `blog.${slug}`;
      let created = null as any;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          created = await firstValueFrom(this.admin.createContent(key, payload));
          break;
        } catch (err: any) {
          const detail = String(err?.error?.detail || '').trim();
          if (detail === 'Content key exists' && attempt < 4) {
            slug = `${baseSlug}-${attempt + 2}`;
            key = `blog.${slug}`;
            continue;
          }
          throw err;
        }
      }
      this.rememberContentVersion(key, created);

      if (this.blogCreate.includeTranslation) {
        const tTitle = this.blogCreate.translationTitle.trim();
        const tBody = this.blogCreate.translationBody.trim();
        if (tTitle || tBody) {
          await firstValueFrom(
            this.admin.updateContentBlock(
              key,
              this.withExpectedVersion(key, {
                title: tTitle || this.blogCreate.title.trim(),
                body_markdown: tBody || this.blogCreate.body_markdown,
                lang: translationLang,
              }),
            ),
          );
        }
      }

      this.toast.success(this.t('adminUi.blog.success.created'));
      this.showBlogCreate = false;
      this.reloadContentBlocks();
      this.loadBlogEditor(key);
    } catch {
      this.toast.error(this.t('adminUi.blog.errors.create'));
    }
  }

  selectBlogPost(post: AdminContent): void {
    this.showBlogCreate = false;
    this.loadBlogEditor(post.key);
  }

  deleteBlogPost(post: AdminContent): void {
    const key = (post?.key || '').trim();
    if (!key) return;
    const label = (post?.title || '').trim() || key;
    const ok = window.confirm(this.t('adminUi.blog.confirms.deletePost', { title: label }));
    if (!ok) return;

    this.blogDeleteBusy.add(key);
    this.admin.deleteContent(key).subscribe({
      next: () => {
        this.blogDeleteBusy.delete(key);
        this.blogBulkSelection.delete(key);
        if (this.selectedBlogKey === key) {
          this.closeBlogEditor();
        }
        this.toast.success(this.t('adminUi.blog.success.deleted'));
        this.reloadContentBlocks();
      },
      error: () => {
        this.blogDeleteBusy.delete(key);
        this.toast.error(this.t('adminUi.blog.errors.delete'));
      },
    });
  }

  setBlogEditLang(lang: 'en' | 'ro'): void {
    if (!this.selectedBlogKey) return;
    this.blogEditLang = lang;
    const key = this.selectedBlogKey;
    const wantsBase = lang === this.blogBaseLang;
    this.admin.getContent(key, wantsBase ? undefined : lang).subscribe({
      next: (block) => {
        this.rememberContentVersion(key, block);
        this.blogForm.title = block.title;
        this.blogForm.body_markdown = block.body_markdown;
        if (wantsBase) {
          this.blogForm.status = block.status;
        }
        this.blogForm.published_at = block.published_at
          ? this.toLocalDateTime(block.published_at)
          : '';
        this.blogForm.published_until = block.published_until
          ? this.toLocalDateTime(block.published_until)
          : '';
        this.blogMeta = block.meta || this.blogMeta || {};
        this.syncBlogMetaToForm(lang);
        this.ensureBlogDraft(key, lang).initFromServer(this.currentBlogDraftState());
        this.setBlogSeoSnapshot(lang, block.title, block.body_markdown);
      },
      error: () => this.toast.error(this.t('adminUi.blog.errors.loadContent')),
    });
  }

  saveBlogPost(): void {
    if (!this.selectedBlogKey) return;
    if (!this.blogForm.title.trim() || !this.blogForm.body_markdown.trim()) {
      this.toast.error(this.t('adminUi.blog.errors.titleBodyRequired'));
      return;
    }

    const key = this.selectedBlogKey;
    const nextMeta = this.buildBlogMeta(this.blogEditLang);
    const metaChanged = JSON.stringify(nextMeta) !== JSON.stringify(this.blogMeta || {});
    const isBase = this.blogEditLang === this.blogBaseLang;
    if (isBase && this.blogForm.status === 'published') {
      const issues = this.blogA11yIssues();
      if (issues.length) {
        this.blogA11yOpen = true;
        const ok = confirm(
          this.t('adminUi.blog.a11y.confirmPublishAnyway', { count: issues.length }),
        );
        if (!ok) return;
      }
    }
    const published_at = isBase
      ? this.blogForm.published_at
        ? new Date(this.blogForm.published_at).toISOString()
        : null
      : undefined;
    const published_until = isBase
      ? this.blogForm.published_until
        ? new Date(this.blogForm.published_until).toISOString()
        : null
      : undefined;
    if (isBase) {
      const payload = this.withExpectedVersion(key, {
        title: this.blogForm.title.trim(),
        body_markdown: this.blogForm.body_markdown,
        status: this.blogForm.status as any,
        published_at,
        published_until,
        meta: nextMeta,
      });
      this.admin.updateContentBlock(key, payload).subscribe({
        next: (block) => {
          this.rememberContentVersion(key, block);
          this.blogMeta = nextMeta;
          this.ensureBlogDraft(key, this.blogEditLang).markServerSaved(
            this.currentBlogDraftState(),
          );
          this.toast.success(this.t('adminUi.blog.success.saved'));
          this.reloadContentBlocks();
          this.loadBlogEditor(key);
        },
        error: (err) => {
          if (this.handleContentConflict(err, key, () => this.loadBlogEditor(key))) return;
          this.toast.error(this.t('adminUi.blog.errors.save'));
        },
      });
      return;
    }

    this.admin
      .updateContentBlock(
        key,
        this.withExpectedVersion(key, {
          title: this.blogForm.title.trim(),
          body_markdown: this.blogForm.body_markdown,
          lang: this.blogEditLang,
        }),
      )
      .subscribe({
        next: (block) => {
          this.rememberContentVersion(key, block);
          const onDone = () => {
            this.toast.success(this.t('adminUi.blog.success.translationSaved'));
            this.reloadContentBlocks();
            this.setBlogEditLang(this.blogEditLang);
          };
          if (!metaChanged) {
            this.ensureBlogDraft(key, this.blogEditLang).markServerSaved(
              this.currentBlogDraftState(),
            );
            onDone();
            return;
          }
          this.admin
            .updateContentBlock(key, this.withExpectedVersion(key, { meta: nextMeta }))
            .subscribe({
              next: (metaBlock) => {
                this.rememberContentVersion(key, metaBlock);
                this.blogMeta = nextMeta;
                this.ensureBlogDraft(key, this.blogEditLang).markServerSaved(
                  this.currentBlogDraftState(),
                );
                onDone();
              },
              error: (err) => {
                if (
                  this.handleContentConflict(err, key, () =>
                    this.setBlogEditLang(this.blogEditLang),
                  )
                )
                  return;
                this.toast.error(this.t('adminUi.blog.errors.translationMetaSave'));
                onDone();
              },
            });
        },
        error: (err) => {
          if (this.handleContentConflict(err, key, () => this.setBlogEditLang(this.blogEditLang)))
            return;
          this.toast.error(this.t('adminUi.blog.errors.translationSave'));
        },
      });
  }

  generateBlogPreviewLink(): void {
    if (!this.selectedBlogKey) return;
    const slug = this.currentBlogSlug();
    this.blog.createPreviewToken(slug, { lang: this.blogEditLang }).subscribe({
      next: (resp) => {
        this.blogPreviewUrl = resp.url;
        this.blogPreviewToken = resp.token;
        this.blogPreviewExpiresAt = resp.expires_at;
        this.toast.success(this.t('adminUi.blog.preview.success.ready'));
        void this.copyToClipboard(resp.url).then((ok) => {
          if (ok) this.toast.info(this.t('adminUi.blog.preview.success.copied'));
        });
      },
      error: () => this.toast.error(this.t('adminUi.blog.preview.errors.generate')),
    });
  }

  copyBlogPreviewLink(): void {
    if (!this.blogPreviewUrl) return;
    void this.copyToClipboard(this.blogPreviewUrl).then((ok) => {
      if (ok) this.toast.info(this.t('adminUi.blog.preview.success.copied'));
      else this.toast.error(this.t('adminUi.blog.preview.errors.copy'));
    });
  }

  private setBlogSeoSnapshot(lang: UiLang, title: string, body_markdown: string): void {
    this.blogSeoSnapshots[lang] = { title: title || '', body_markdown: body_markdown || '' };
  }

  private loadBlogSeoSnapshots(key: string): void {
    this.blogSeoSnapshotsKey = key;
    this.blogSeoSnapshotsLoading = true;
    const langs: UiLang[] = ['en', 'ro'];
    type BlogSeoRow = { lang: UiLang; title: string; body_markdown: string; missing?: true };
    const requests = langs.map((lang) =>
      this.admin.getContent(key, lang).pipe(
        map(
          (block) =>
            ({
              lang,
              title: block.title || '',
              body_markdown: block.body_markdown || '',
            }) as BlogSeoRow,
        ),
        catchError(() => of({ lang, title: '', body_markdown: '', missing: true } as BlogSeoRow)),
      ),
    );
    forkJoin(requests).subscribe({
      next: (rows: BlogSeoRow[]) => {
        if (this.selectedBlogKey !== key || this.blogSeoSnapshotsKey !== key) return;
        for (const row of rows) {
          const lang = row.lang;
          if (row.missing) this.blogSeoSnapshots[lang] = null;
          else this.setBlogSeoSnapshot(lang, row.title, row.body_markdown);
        }
      },
      complete: () => {
        if (this.blogSeoSnapshotsKey === key) this.blogSeoSnapshotsLoading = false;
      },
    });
  }

  blogSeoHasContent(lang: UiLang): boolean {
    if (!this.selectedBlogKey) return false;
    if (lang === this.blogEditLang)
      return Boolean(
        (this.blogForm.title || '').trim() || (this.blogForm.body_markdown || '').trim(),
      );
    return Boolean(
      this.blogSeoSnapshots[lang]?.title || this.blogSeoSnapshots[lang]?.body_markdown,
    );
  }

  blogSeoTitleFull(lang: UiLang): string {
    const rawTitle =
      lang === this.blogEditLang
        ? (this.blogForm.title || '').trim()
        : (this.blogSeoSnapshots[lang]?.title || '').trim();
    if (!rawTitle) return '';
    return `${rawTitle} | momentstudio`;
  }

  blogSeoDescriptionFull(lang: UiLang): string {
    return this.blogSeoDescriptionSource(lang).slice(0, 160).trim();
  }

  blogSeoTitlePreview(lang: UiLang): string {
    return this.truncateForPreview(this.blogSeoTitleFull(lang), 62);
  }

  blogSeoDescriptionPreview(lang: UiLang): string {
    return this.truncateForPreview(this.blogSeoDescriptionSource(lang), 160);
  }

  blogSeoIssues(lang: UiLang): Array<{ key: string; params?: Record<string, unknown> }> {
    const title = this.blogSeoTitleFull(lang);
    const metaDescription = this.blogSeoDescriptionFull(lang);
    const sourceDescription = this.blogSeoDescriptionSource(lang);
    const titleLen = title.length;
    const descMetaLen = metaDescription.length;
    const descSourceLen = sourceDescription.length;
    const issues: Array<{ key: string; params?: Record<string, unknown> }> = [];
    if (!title.trim()) issues.push({ key: 'adminUi.blog.seo.issues.missingTitle' });
    if (!metaDescription.trim()) issues.push({ key: 'adminUi.blog.seo.issues.missingDescription' });
    if (titleLen > 70)
      issues.push({ key: 'adminUi.blog.seo.issues.titleTooLong', params: { count: titleLen } });
    if (titleLen > 0 && titleLen < 25)
      issues.push({ key: 'adminUi.blog.seo.issues.titleTooShort', params: { count: titleLen } });
    if (descSourceLen > 160)
      issues.push({
        key: 'adminUi.blog.seo.issues.descriptionTooLong',
        params: { count: descSourceLen },
      });
    if (descMetaLen > 0 && descMetaLen < 70)
      issues.push({
        key: 'adminUi.blog.seo.issues.descriptionTooShort',
        params: { count: descMetaLen },
      });
    const summary = this.getBlogSummary(this.blogMeta || {}, lang);
    if (!summary.trim() && metaDescription.trim())
      issues.push({ key: 'adminUi.blog.seo.issues.derivedFromBody' });
    if (!this.blogPreviewToken && this.blogForm.status !== 'published')
      issues.push({ key: 'adminUi.blog.seo.issues.previewTokenRecommended' });
    return issues;
  }

  private blogSeoDescriptionSource(lang: UiLang): string {
    const summary = this.getBlogSummary(this.blogMeta || {}, lang);
    const body =
      lang === this.blogEditLang
        ? (this.blogForm.body_markdown || '').trim()
        : (this.blogSeoSnapshots[lang]?.body_markdown || '').trim();
    const source = (summary || '').trim() || body;
    return this.toSeoDescription(source);
  }

  blogPublicUrl(lang: UiLang): string {
    if (typeof window === 'undefined') return `/blog/${this.currentBlogSlug()}?lang=${lang}`;
    return `${window.location.origin}/blog/${this.currentBlogSlug()}?lang=${lang}`;
  }

  blogPublishedOgImageUrl(lang: UiLang): string {
    const apiBaseUrl = (appConfig.apiBaseUrl || '/api/v1').replace(/\/$/, '');
    const ogPath = `${apiBaseUrl}/blog/posts/${this.currentBlogSlug()}/og.png?lang=${lang}`;
    if (
      ogPath.startsWith('http://') ||
      ogPath.startsWith('https://') ||
      typeof window === 'undefined'
    )
      return ogPath;
    return `${window.location.origin}${ogPath}`;
  }

  blogPreviewOgImageUrl(lang: UiLang): string | null {
    if (!this.blogPreviewToken) return null;
    const apiBaseUrl = (appConfig.apiBaseUrl || '/api/v1').replace(/\/$/, '');
    const token = encodeURIComponent(this.blogPreviewToken);
    const ogPath = `${apiBaseUrl}/blog/posts/${this.currentBlogSlug()}/og-preview.png?lang=${lang}&token=${token}`;
    if (
      ogPath.startsWith('http://') ||
      ogPath.startsWith('https://') ||
      typeof window === 'undefined'
    )
      return ogPath;
    return `${window.location.origin}${ogPath}`;
  }

  loadBlogVersions(): void {
    if (!this.selectedBlogKey) return;
    this.admin.listContentVersions(this.selectedBlogKey).subscribe({
      next: (items) => {
        this.blogVersions = items;
        this.blogVersionDetail = null;
        this.blogDiffParts = [];
      },
      error: () => this.toast.error(this.t('adminUi.blog.revisions.errors.load')),
    });
  }

  loadFlaggedComments(): void {
    this.flaggedCommentsLoading.set(true);
    this.flaggedCommentsError = null;
    this.blog.listFlaggedComments().subscribe({
      next: (resp) => {
        this.flaggedComments.set(resp.items || []);
      },
      error: () => {
        this.flaggedComments.set([]);
        this.flaggedCommentsError = this.t('adminUi.blog.moderation.errors.load');
      },
      complete: () => this.flaggedCommentsLoading.set(false),
    });
  }

  resolveFlags(comment: AdminBlogComment): void {
    this.blog.resolveCommentFlagsAdmin(comment.id).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.blog.moderation.success.flagsResolved'));
        this.loadFlaggedComments();
      },
      error: () => this.toast.error(this.t('adminUi.blog.moderation.errors.resolveFlags')),
    });
  }

  toggleHide(comment: AdminBlogComment): void {
    if (this.blogCommentModerationBusy.has(comment.id)) return;

    const setHidden = (value: boolean) => {
      this.flaggedComments.update((items) =>
        items.map((c) => (c.id === comment.id ? { ...c, is_hidden: value } : c)),
      );
    };

    if (comment.is_hidden) {
      setHidden(false);
      this.blogCommentModerationBusy.add(comment.id);
      this.blog.unhideCommentAdmin(comment.id).subscribe({
        next: () => {
          this.blogCommentModerationBusy.delete(comment.id);
          this.toast.success(this.t('adminUi.blog.moderation.success.commentUnhidden'));
          this.loadFlaggedComments();
        },
        error: () => {
          this.blogCommentModerationBusy.delete(comment.id);
          setHidden(true);
          this.toast.error(this.t('adminUi.blog.moderation.errors.unhide'));
        },
      });
      return;
    }
    const reasonPrompt = prompt(this.t('adminUi.blog.moderation.prompts.hideReason'));
    if (reasonPrompt === null) return;
    const reason = reasonPrompt || '';
    setHidden(true);
    this.blogCommentModerationBusy.add(comment.id);
    this.blog.hideCommentAdmin(comment.id, { reason: reason.trim() || null }).subscribe({
      next: () => {
        this.blogCommentModerationBusy.delete(comment.id);
        this.toast.success(this.t('adminUi.blog.moderation.success.commentHidden'));
        this.loadFlaggedComments();
      },
      error: () => {
        this.blogCommentModerationBusy.delete(comment.id);
        setHidden(false);
        this.toast.error(this.t('adminUi.blog.moderation.errors.hide'));
      },
    });
  }

  adminDeleteComment(comment: AdminBlogComment): void {
    if (this.blogCommentModerationBusy.has(comment.id)) return;
    const ok = confirm(this.t('adminUi.blog.moderation.confirms.deleteComment'));
    if (!ok) return;
    this.blog.deleteComment(comment.id).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.blog.moderation.success.commentDeleted'));
        this.loadFlaggedComments();
      },
      error: () => this.toast.error(this.t('adminUi.blog.moderation.errors.delete')),
    });
  }

  selectBlogVersion(version: number): void {
    if (!this.selectedBlogKey) return;
    this.admin.getContentVersion(this.selectedBlogKey, version).subscribe({
      next: (v) => {
        this.blogVersionDetail = v;
        this.blogDiffParts = diffLines(v.body_markdown || '', this.blogForm.body_markdown || '');
      },
      error: () => this.toast.error(this.t('adminUi.blog.revisions.errors.loadVersion')),
    });
  }

  rollbackBlogVersion(version: number): void {
    if (!this.selectedBlogKey) return;
    const ok = confirm(this.t('adminUi.blog.revisions.confirms.rollback', { version }));
    if (!ok) return;
    const key = this.selectedBlogKey;
    this.admin.rollbackContentVersion(key, version).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.blog.revisions.success.rolledBack'));
        this.reloadContentBlocks();
        this.loadBlogEditor(key);
        this.loadBlogVersions();
      },
      error: () => this.toast.error(this.t('adminUi.blog.revisions.errors.rollback')),
    });
  }

  applyBlogHeading(textarea: HTMLTextAreaElement, level: 1 | 2): void {
    const prefix = `${'#'.repeat(level)} `;
    this.prefixBlogLines(textarea, prefix);
  }

  applyBlogList(textarea: HTMLTextAreaElement): void {
    this.prefixBlogLines(textarea, '- ');
  }

  wrapBlogSelection(
    textarea: HTMLTextAreaElement,
    before: string,
    after: string,
    placeholder: string,
  ): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const hasSelection = end > start;
    const selected = hasSelection ? value.slice(start, end) : placeholder;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    const selStart = start + before.length;
    const selEnd = selStart + selected.length;
    this.updateBlogBody(textarea, next, selStart, selEnd);
  }

  insertBlogLink(textarea: HTMLTextAreaElement): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const hasSelection = end > start;
    const text = hasSelection ? value.slice(start, end) : 'link text';
    const url = 'https://';
    const snippet = `[${text}](${url})`;
    const next = value.slice(0, start) + snippet + value.slice(end);
    const urlStart = start + text.length + 3;
    this.updateBlogBody(textarea, next, urlStart, urlStart + url.length);
  }

  insertBlogCodeBlock(textarea: HTMLTextAreaElement): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const hasSelection = end > start;
    const selected = hasSelection ? value.slice(start, end) : 'code';
    const snippet = `\n\`\`\`\n${selected}\n\`\`\`\n`;
    const next = value.slice(0, start) + snippet + value.slice(end);
    const codeStart = start + 5;
    this.updateBlogBody(textarea, next, codeStart, codeStart + selected.length);
  }

  insertBlogEmbed(
    target: HTMLTextAreaElement | RichEditorComponent,
    kind: 'product' | 'category' | 'collection',
  ): void {
    const hintKey =
      kind === 'product'
        ? 'adminUi.blog.embeds.prompt.product'
        : kind === 'category'
          ? 'adminUi.blog.embeds.prompt.category'
          : 'adminUi.blog.embeds.prompt.collection';
    const raw = prompt(this.t(hintKey), '') || '';
    const slug = raw.trim();
    if (!slug) return;
    const snippet = `{{${kind}:${slug}}}`;
    if (target instanceof HTMLTextAreaElement) {
      this.insertAtCursor(target, snippet);
    } else {
      target.insertMarkdown(snippet);
    }
  }

  uploadAndInsertBlogImage(target: HTMLTextAreaElement | RichEditorComponent, event: Event): void {
    if (!this.selectedBlogKey) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.admin.uploadContentImage(this.selectedBlogKey, file).subscribe({
      next: (block) => {
        const images = (block.images || [])
          .map((img) => ({
            id: img.id,
            url: img.url,
            alt_text: img.alt_text,
            sort_order: img.sort_order ?? 0,
            focal_x: img.focal_x ?? 50,
            focal_y: img.focal_y ?? 50,
          }))
          .sort((a, b) => a.sort_order - b.sort_order);
        this.blogImages = images;
        this.toast.success(this.t('adminUi.blog.images.success.uploaded'));
        const inserted = images[images.length - 1];
        if (inserted?.url) {
          const alt =
            file.name
              .replace(/\.[^.]+$/, '')
              .replace(/[\r\n]+/g, ' ')
              .trim() || 'image';
          const layoutToken = this.blogImageLayout === 'default' ? '' : this.blogImageLayout;
          const snippet = layoutToken
            ? `![${alt}](${inserted.url} "${layoutToken}")`
            : `![${alt}](${inserted.url})`;
          if (target instanceof HTMLTextAreaElement) {
            this.insertAtCursor(target, snippet);
          } else {
            target.insertMarkdown(snippet);
          }
          this.toast.info(this.t('adminUi.blog.images.success.insertedMarkdown'));
        }
        input.value = '';
      },
      error: () => this.toast.error(this.t('adminUi.blog.images.errors.upload')),
    });
  }

  onBlogImageDragOver(event: DragEvent): void {
    const transfer = event?.dataTransfer;
    const types = Array.from(transfer?.types || []);
    if (!types.includes('Files')) return;
    event.preventDefault();
    if (transfer) transfer.dropEffect = 'copy';
  }

  async onBlogImageDrop(
    target: HTMLTextAreaElement | RichEditorComponent,
    event: DragEvent,
  ): Promise<void> {
    const transfer = event?.dataTransfer;
    const files = Array.from(transfer?.files || []).filter(
      (file) => file && file.type.startsWith('image/'),
    );
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();

    if (!this.selectedBlogKey) return;
    let insertedCount = 0;

    for (const file of files) {
      try {
        const block = await firstValueFrom(
          this.admin.uploadContentImage(this.selectedBlogKey, file),
        );
        const images = (block.images || [])
          .map((img) => ({
            id: img.id,
            url: img.url,
            alt_text: img.alt_text,
            sort_order: img.sort_order ?? 0,
            focal_x: img.focal_x ?? 50,
            focal_y: img.focal_y ?? 50,
          }))
          .sort((a, b) => a.sort_order - b.sort_order);
        this.blogImages = images;
        const inserted = images[images.length - 1];
        if (!inserted?.url) continue;

        const alt =
          file.name
            .replace(/\.[^.]+$/, '')
            .replace(/[\r\n]+/g, ' ')
            .trim() || 'image';
        const layoutToken = this.blogImageLayout === 'default' ? '' : this.blogImageLayout;
        const snippet = layoutToken
          ? `![${alt}](${inserted.url} "${layoutToken}")`
          : `![${alt}](${inserted.url})`;
        if (target instanceof HTMLTextAreaElement) {
          this.insertAtCursor(target, snippet);
        } else {
          target.insertMarkdown(snippet);
        }
        insertedCount += 1;
      } catch {
        this.toast.error(this.t('adminUi.blog.images.errors.upload'));
        return;
      }
    }

    if (insertedCount) {
      this.toast.success(this.t('adminUi.blog.images.success.uploaded'));
      this.toast.info(this.t('adminUi.blog.images.success.insertedMarkdown'));
    }
  }

  insertBlogImageMarkdown(url: string, altText?: string | null): void {
    const alt = (altText || 'image').replace(/[\r\n]+/g, ' ').trim();
    const snippet = `\n\n![${alt}](${url})\n`;
    this.blogForm.body_markdown = (this.blogForm.body_markdown || '').trimEnd() + snippet;
    this.toast.info(this.t('adminUi.blog.images.success.insertedMarkdown'));
  }

  blogA11yIssues(): Array<{ index: number; url: string; alt: string }> {
    const markdown = this.blogForm.body_markdown || '';
    const issues: Array<{ index: number; url: string; alt: string }> = [];
    const re = /!\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g;
    let match: RegExpExecArray | null;
    let idx = 0;
    while ((match = re.exec(markdown))) {
      const alt = String(match[1] || '').trim();
      const url = String(match[2] || '').trim();
      const altKey = alt.toLowerCase();
      const missing = !alt || altKey === 'image' || altKey === 'photo' || altKey === 'picture';
      if (url && missing) issues.push({ index: idx, url, alt });
      idx += 1;
    }
    return issues;
  }

  promptFixBlogImageAlt(imageIndex: number): void {
    const markdown = this.blogForm.body_markdown || '';
    const re = /!\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g;
    let match: RegExpExecArray | null;
    let idx = 0;
    while ((match = re.exec(markdown))) {
      if (idx !== imageIndex) {
        idx += 1;
        continue;
      }
      const url = String(match[2] || '').trim();
      const suggestion = this.suggestAltFromUrl(url);
      const next = (prompt(this.t('adminUi.blog.a11y.promptAlt'), suggestion) || '').trim();
      if (!next) return;
      this.setBlogMarkdownImageAlt(imageIndex, next);
      this.toast.success(this.t('adminUi.blog.a11y.fixed'));
      this.blogA11yOpen = true;
      return;
    }
  }

  private setBlogMarkdownImageAlt(imageIndex: number, alt: string): void {
    const markdown = this.blogForm.body_markdown || '';
    const safeAlt = String(alt || '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!safeAlt) return;

    const re = /!\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g;
    let match: RegExpExecArray | null;
    let idx = 0;
    let out = '';
    let lastIndex = 0;
    while ((match = re.exec(markdown))) {
      const start = match.index;
      const end = re.lastIndex;
      out += markdown.slice(lastIndex, start);
      if (idx === imageIndex) {
        out += `![${safeAlt}](${match[2]}${match[3]})`;
      } else {
        out += markdown.slice(start, end);
      }
      lastIndex = end;
      idx += 1;
    }
    out += markdown.slice(lastIndex);
    this.blogForm.body_markdown = out;
  }

  blogWritingAids(): {
    words: number;
    minutes: number;
    headings: Array<{ level: number; text: string }>;
  } {
    const markdown = this.blogForm.body_markdown || '';
    const words = this.countMarkdownWords(markdown);
    const minutes = words ? Math.max(1, Math.ceil(words / 200)) : 0;
    return { words, minutes, headings: this.extractMarkdownHeadings(markdown) };
  }

  applyBlogReadingTimeEstimate(): void {
    const aids = this.blogWritingAids();
    if (!aids.minutes) return;
    this.blogForm.reading_time_minutes = String(aids.minutes);
    this.toast.info(this.t('adminUi.blog.writing.applied', { minutes: aids.minutes }));
  }

  blogCoverPreviewUrl(): string | null {
    const explicit = (this.blogForm.cover_image_url || '').trim();
    if (explicit) return explicit;
    const first = this.blogImages[0];
    return first?.url ? String(first.url) : null;
  }

  blogCoverPreviewAsset(): {
    id: string;
    url: string;
    sort_order: number;
    focal_x: number;
    focal_y: number;
    alt_text?: string | null;
  } | null {
    const url = this.blogCoverPreviewUrl();
    if (!url) return null;
    return this.blogImages.find((img) => img.url === url) ?? null;
  }

  blogCoverPreviewFocalPosition(): string {
    const img = this.blogCoverPreviewAsset();
    const x = Math.max(0, Math.min(100, Math.round(Number(img?.focal_x ?? 50))));
    const y = Math.max(0, Math.min(100, Math.round(Number(img?.focal_y ?? 50))));
    return `${x}% ${y}%`;
  }

  clearBlogCoverOverride(): void {
    this.blogForm.cover_image_url = '';
  }

  uploadBlogCoverImage(event: Event): void {
    if (!this.selectedBlogKey) return;
    if (this.blogEditLang !== this.blogBaseLang) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.admin.uploadContentImage(this.selectedBlogKey, file).subscribe({
      next: (block) => {
        const images = (block.images || [])
          .map((img) => ({
            id: img.id,
            url: img.url,
            alt_text: img.alt_text,
            sort_order: img.sort_order ?? 0,
            focal_x: img.focal_x ?? 50,
            focal_y: img.focal_y ?? 50,
          }))
          .sort((a, b) => a.sort_order - b.sort_order);
        this.blogImages = images;
        const inserted = images[images.length - 1];
        if (inserted?.url) {
          this.blogForm.cover_image_url = inserted.url;
        }
        this.toast.success(this.t('adminUi.blog.images.success.uploaded'));
        input.value = '';
      },
      error: () => this.toast.error(this.t('adminUi.blog.images.errors.upload')),
    });
  }

  selectBlogCoverAsset(asset: ContentImageAssetRead): void {
    const url = (asset?.url || '').trim();
    if (!url) return;
    if (this.blogEditLang !== this.blogBaseLang) return;
    this.blogForm.cover_image_url = url;
    const id = String(asset.id || '').trim();
    if (!id) return;
    const next = [...this.blogImages];
    const idx = next.findIndex((img) => img.id === id);
    const row = {
      id,
      url,
      alt_text: asset.alt_text ?? null,
      sort_order: Number.isFinite(asset.sort_order as any) ? Number(asset.sort_order) : 0,
      focal_x: Number.isFinite(asset.focal_x as any) ? Number(asset.focal_x) : 50,
      focal_y: Number.isFinite(asset.focal_y as any) ? Number(asset.focal_y) : 50,
    };
    if (idx >= 0) next[idx] = { ...next[idx], ...row };
    else next.push(row);
    next.sort((a, b) => a.sort_order - b.sort_order);
    this.blogImages = next;
    this.showBlogCoverLibrary = false;
  }

  editBlogCoverFocalPoint(): void {
    if (this.blogEditLang !== this.blogBaseLang) return;
    const img = this.blogCoverPreviewAsset();
    if (!img) return;
    const entered = window.prompt(
      this.t('adminUi.site.assets.library.focalPrompt'),
      `${img.focal_x}, ${img.focal_y}`,
    );
    if (entered === null) return;
    const parts = entered
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length < 2) {
      this.toast.error(this.t('adminUi.site.assets.library.focalErrorsFormat'));
      return;
    }
    const focalX = Math.max(0, Math.min(100, Math.round(Number(parts[0]))));
    const focalY = Math.max(0, Math.min(100, Math.round(Number(parts[1]))));
    if (!Number.isFinite(focalX) || !Number.isFinite(focalY)) {
      this.toast.error(this.t('adminUi.site.assets.library.focalErrorsFormat'));
      return;
    }
    this.admin.updateContentImageFocalPoint(img.id, focalX, focalY).subscribe({
      next: (updated) => {
        this.blogImages = this.blogImages.map((item) =>
          item.id === img.id
            ? { ...item, focal_x: updated.focal_x, focal_y: updated.focal_y }
            : item,
        );
        this.toast.success(this.t('adminUi.site.assets.library.focalSaved'));
      },
      error: () => this.toast.error(this.t('adminUi.site.assets.library.focalErrorsSave')),
    });
  }

  private prefixBlogLines(textarea: HTMLTextAreaElement, prefix: string): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = end === start ? value.indexOf('\n', start) : value.indexOf('\n', end);
    const safeLineEnd = lineEnd === -1 ? value.length : lineEnd;
    const segment = value.slice(lineStart, safeLineEnd);
    const lines = segment.split('\n');
    const nextSegment = lines
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (line.startsWith(prefix)) return line;
        return prefix + line;
      })
      .join('\n');
    const nextValue = value.slice(0, lineStart) + nextSegment + value.slice(safeLineEnd);
    const added = nextSegment.length - segment.length;
    this.updateBlogBody(textarea, nextValue, start + added, end + added);
  }

  private updateBlogBody(
    textarea: HTMLTextAreaElement,
    nextValue: string,
    selectionStart: number,
    selectionEnd: number,
  ): void {
    this.blogForm.body_markdown = nextValue;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  private loadBlogEditor(key: string): void {
    this.selectedBlogKey = key;
    this.resetBlogForm();
    this.showBlogCoverLibrary = false;
    this.blogPreviewUrl = null;
    this.blogPreviewExpiresAt = null;
    this.blogVersions = [];
    this.blogVersionDetail = null;
    this.blogDiffParts = [];
    this.admin.getContent(key).subscribe({
      next: (block) => {
        this.rememberContentVersion(key, block);
        this.blogBaseLang = (block.lang === 'ro' ? 'ro' : 'en') as 'en' | 'ro';
        this.blogEditLang = this.blogBaseLang;
        this.blogMeta = block.meta || {};
        this.blogForm = {
          title: block.title,
          body_markdown: block.body_markdown,
          status: block.status,
          published_at: block.published_at ? this.toLocalDateTime(block.published_at) : '',
          published_until: block.published_until ? this.toLocalDateTime(block.published_until) : '',
          summary: '',
          tags: '',
          series: '',
          cover_image_url: '',
          cover_fit: 'cover',
          reading_time_minutes: '',
          pinned: false,
          pin_order: '1',
        };
        this.syncBlogMetaToForm(this.blogEditLang);
        this.ensureBlogDraft(key, this.blogEditLang).initFromServer(this.currentBlogDraftState());
        this.loadBlogSeoSnapshots(key);
        const images = (block.images || [])
          .map((img) => ({
            id: img.id,
            url: img.url,
            alt_text: img.alt_text,
            sort_order: img.sort_order ?? 0,
            focal_x: img.focal_x ?? 50,
            focal_y: img.focal_y ?? 50,
          }))
          .sort((a, b) => a.sort_order - b.sort_order);
        this.blogImages = [...images];
        this.loadBlogVersions();
      },
      error: () => this.toast.error(this.t('adminUi.blog.errors.loadPost')),
    });
  }

  private resetBlogForm(): void {
    this.blogForm = {
      title: '',
      body_markdown: '',
      status: 'draft',
      published_at: '',
      published_until: '',
      summary: '',
      tags: '',
      series: '',
      cover_image_url: '',
      cover_fit: 'cover',
      reading_time_minutes: '',
      pinned: false,
      pin_order: '1',
    };
    this.blogMeta = {};
  }

  private normalizeBlogSlug(raw: string): string {
    return raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  blogCreateSlug(): string {
    return this.normalizeBlogSlug(this.blogCreate.title || '');
  }

  private buildBlogBulkPayload(block: {
    meta?: Record<string, any> | null;
  }): Record<string, unknown> | null {
    switch (this.blogBulkAction) {
      case 'publish':
        return { status: 'published', published_at: null };
      case 'unpublish':
        return { status: 'draft' };
      case 'schedule': {
        const publishIso = this.toIsoFromLocal(this.blogBulkPublishAt);
        if (!publishIso) return null;
        const unpublishIso = this.toIsoFromLocal(this.blogBulkUnpublishAt);
        if (unpublishIso && new Date(unpublishIso).getTime() <= new Date(publishIso).getTime()) {
          this.blogBulkError = this.t('adminUi.blog.bulk.invalidSchedule');
          return null;
        }
        return {
          status: 'published',
          published_at: publishIso,
          published_until: unpublishIso ?? null,
        };
      }
      case 'tags_add':
      case 'tags_remove': {
        const tagsInput = this.parseTags(this.blogBulkTags);
        if (!tagsInput.length) return null;
        const meta = { ...block.meta } as Record<string, unknown>;
        const existingRaw = meta['tags'];
        const existing = Array.isArray(existingRaw)
          ? existingRaw.map((t) => String(t))
          : typeof existingRaw === 'string'
            ? this.parseTags(existingRaw)
            : [];
        const merged =
          this.blogBulkAction === 'tags_add'
            ? this.mergeTags(existing, tagsInput)
            : this.removeTags(existing, tagsInput);
        if (merged.length) meta['tags'] = merged;
        else delete meta['tags'];
        return { meta };
      }
      default:
        return null;
    }
  }

  private pruneBlogBulkSelection(): void {
    const blogKeys = new Set(this.blogPosts().map((p) => p.key));
    for (const key of Array.from(this.blogBulkSelection)) {
      if (!blogKeys.has(key)) this.blogBulkSelection.delete(key);
    }
  }

  private getBlogSummary(meta: Record<string, any>, lang: 'en' | 'ro'): string {
    const summary = meta?.['summary'];
    if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
      const value = summary[lang];
      return typeof value === 'string' ? value : '';
    }
    if (typeof summary === 'string') {
      return lang === this.blogBaseLang ? summary : '';
    }
    return '';
  }

  private syncBlogMetaToForm(lang: 'en' | 'ro'): void {
    const meta = this.blogMeta || {};
    this.blogForm.summary = this.getBlogSummary(meta, lang);
    const tags = meta['tags'];
    if (Array.isArray(tags)) {
      this.blogForm.tags = tags.join(', ');
    } else if (typeof tags === 'string') {
      this.blogForm.tags = tags;
    } else {
      this.blogForm.tags = '';
    }

    const series = meta['series'];
    this.blogForm.series = typeof series === 'string' ? series : '';

    const cover = meta['cover_image_url'] || meta['cover_image'] || '';
    this.blogForm.cover_image_url = typeof cover === 'string' ? cover : '';
    const coverFit =
      typeof meta['cover_fit'] === 'string' ? String(meta['cover_fit']).trim().toLowerCase() : '';
    this.blogForm.cover_fit = coverFit === 'contain' ? 'contain' : 'cover';
    const rt = meta['reading_time_minutes'] ?? meta['reading_time'] ?? '';
    this.blogForm.reading_time_minutes = rt ? String(rt) : '';

    const pinned = meta['pinned'];
    let pinnedFlag = false;
    if (typeof pinned === 'boolean') pinnedFlag = pinned;
    else if (typeof pinned === 'number') pinnedFlag = pinned === 1;
    else if (typeof pinned === 'string')
      pinnedFlag = ['1', 'true', 'yes', 'on'].includes(pinned.trim().toLowerCase());
    this.blogForm.pinned = pinnedFlag;
    const rawPinOrder = meta['pin_order'];
    const parsedPinOrder = Number(
      typeof rawPinOrder === 'number'
        ? rawPinOrder
        : typeof rawPinOrder === 'string'
          ? rawPinOrder.trim()
          : '1',
    );
    const normalized =
      Number.isFinite(parsedPinOrder) && parsedPinOrder > 0 ? Math.trunc(parsedPinOrder) : 1;
    this.blogForm.pin_order = String(Math.max(1, normalized));
  }

  private buildBlogMeta(lang: 'en' | 'ro'): Record<string, any> {
    const meta: Record<string, any> = { ...this.blogMeta };

    const tags = this.parseTags(this.blogForm.tags);
    if (tags.length) meta['tags'] = tags;
    else delete meta['tags'];

    const series = this.blogForm.series.trim();
    if (series) meta['series'] = series;
    else delete meta['series'];

    const cover = this.blogForm.cover_image_url.trim();
    if (cover) meta['cover_image_url'] = cover;
    else delete meta['cover_image_url'];
    if (this.blogForm.cover_fit === 'contain') meta['cover_fit'] = 'contain';
    else delete meta['cover_fit'];

    const rt = Number(String(this.blogForm.reading_time_minutes || '').trim());
    if (Number.isFinite(rt) && rt > 0) meta['reading_time_minutes'] = Math.trunc(rt);
    else delete meta['reading_time_minutes'];

    const summaryValue = this.blogForm.summary.trim();
    const existing = meta['summary'];
    let summary: Record<string, any> = {};
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      summary = { ...existing };
    } else if (typeof existing === 'string' && existing.trim()) {
      summary = { [this.blogBaseLang]: existing.trim() };
    }
    if (summaryValue) summary[lang] = summaryValue;
    else delete summary[lang];
    if (Object.keys(summary).length) meta['summary'] = summary;
    else delete meta['summary'];

    if (this.blogForm.pinned) {
      meta['pinned'] = true;
      const rawOrder = Number(String(this.blogForm.pin_order || '').trim());
      const normalized = Number.isFinite(rawOrder) && rawOrder > 0 ? Math.trunc(rawOrder) : 1;
      meta['pin_order'] = Math.max(1, normalized);
    } else {
      delete meta['pinned'];
      delete meta['pin_order'];
    }

    return meta;
  }
}
