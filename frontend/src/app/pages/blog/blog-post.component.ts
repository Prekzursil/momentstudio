import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { Subscription, combineLatest, forkJoin, of } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';

import { appConfig } from '../../core/app-config';
import { AuthService } from '../../core/auth.service';
import { CatalogService, Category, FeaturedCollection, Product } from '../../core/catalog.service';
import { MarkdownService } from '../../core/markdown.service';
import { ToastService } from '../../core/toast.service';
import { BlogComment, BlogPost, BlogPostListItem, BlogService } from '../../core/blog.service';
import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { CardComponent } from '../../shared/card.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { formatIdentity } from '../../shared/user-identity';
import { catchError } from 'rxjs/operators';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('python', python);
hljs.registerLanguage('typescript', typescript);

@Component({
  selector: 'app-blog-post',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TranslateModule,
    ContainerComponent,
    BreadcrumbComponent,
    CardComponent,
    ButtonComponent,
    SkeletonComponent
  ],
  template: `
    <div
      *ngIf="post()"
      class="fixed left-0 right-0 top-0 z-[110] h-1 bg-transparent no-print"
      role="progressbar"
      [attr.aria-label]="'blog.post.progressLabel' | translate"
      [attr.aria-valuemin]="0"
      [attr.aria-valuemax]="100"
      [attr.aria-valuenow]="progressPercent()"
    >
      <div
        class="h-full bg-indigo-600 dark:bg-indigo-300 transition-[width] duration-100"
        [style.width.%]="progressPercent()"
      ></div>
    </div>

    <app-container classes="py-10 grid gap-6 max-w-4xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div
        *ngIf="isPreview()"
        class="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100"
      >
        {{ 'blog.preview.banner' | translate }}
      </div>

      <div class="grid gap-2">
        <h1 class="text-3xl font-semibold text-slate-900 dark:text-slate-50">
          <span *ngIf="loadingPost(); else postTitleTpl">{{ 'blog.post.loadingTitle' | translate }}</span>
          <ng-template #postTitleTpl>{{ post()?.title }}</ng-template>
        </h1>
        <p class="text-sm text-slate-500 dark:text-slate-400" *ngIf="post()?.published_at">
          {{ post()!.published_at | date: 'mediumDate' }}
          <ng-container *ngIf="post()?.reading_time_minutes"> · {{ 'blog.minutesRead' | translate : { minutes: post()!.reading_time_minutes } }}</ng-container>
          <ng-container *ngIf="post()?.author_name"> · {{ 'blog.byAuthor' | translate : { author: post()!.author_name } }}</ng-container>
        </p>
        <a
          *ngIf="post()?.series"
          [routerLink]="['/blog/series', post()!.series]"
          class="justify-self-start text-xs font-semibold rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:border-slate-600"
        >
          {{ 'blog.seriesPill' | translate : { series: post()!.series } }}
        </a>
        <p class="text-sm text-slate-600 dark:text-slate-300" *ngIf="post()?.summary">{{ post()!.summary }}</p>
        <div class="flex flex-wrap gap-1" *ngIf="post()?.tags?.length">
          <a
            *ngFor="let tag of post()!.tags"
            [routerLink]="['/blog/tag', tag]"
            class="text-xs rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:border-slate-600"
          >
            #{{ tag }}
          </a>
        </div>
      </div>

      <div *ngIf="loadingPost()" class="grid gap-4">
        <app-skeleton height="240px"></app-skeleton>
        <app-skeleton [rows]="6"></app-skeleton>
      </div>

      <div
        *ngIf="!loadingPost() && hasPostError()"
        class="border border-amber-200 bg-amber-50 rounded-2xl p-6 text-center grid gap-2 dark:border-amber-900/40 dark:bg-amber-950/30"
      >
        <p class="text-lg font-semibold text-amber-900 dark:text-amber-100">{{ 'blog.post.errorTitle' | translate }}</p>
        <p class="text-sm text-amber-800 dark:text-amber-200">{{ 'blog.post.errorCopy' | translate }}</p>
        <div class="flex justify-center">
          <app-button [label]="'blog.retry' | translate" size="sm" (action)="load()"></app-button>
        </div>
      </div>

      <div *ngIf="!loadingPost() && !hasPostError() && post()">
        <div class="grid gap-6 lg:grid-cols-[1fr_260px] lg:items-start">
          <app-card>
            <div #articleContent class="grid gap-6" (click)="handleArticleClick($event)">
              <img
                *ngIf="post()!.cover_image_url"
                [src]="post()!.cover_image_url"
                [alt]="post()!.title"
                class="w-full aspect-[16/9] rounded-2xl border border-slate-200 bg-slate-50 object-cover dark:border-slate-800 dark:bg-slate-800"
                loading="lazy"
              />
              <div class="markdown blog-markdown text-slate-700 dark:text-slate-200" [innerHTML]="bodyHtml()"></div>
              <div class="mx-auto w-full max-w-prose no-print">
                <a
                  routerLink="/blog"
                  class="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
                >
                  ← {{ 'blog.post.backToBlog' | translate }}
                </a>
              </div>
            </div>
          </app-card>

          <aside *ngIf="toc().length > 1" class="hidden lg:block lg:sticky lg:top-24 no-print">
            <app-card>
              <nav class="grid gap-3" [attr.aria-label]="'blog.post.tocTitle' | translate">
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'blog.post.tocTitle' | translate }}</p>
                <div class="grid gap-1">
                  <a
                    *ngFor="let item of toc()"
                    class="text-sm rounded-md px-2 py-1 transition-colors"
                    [ngClass]="
                      (item.id === activeHeadingId() ? 'text-indigo-600 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-950/40' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 dark:text-slate-300 dark:hover:text-slate-50 dark:hover:bg-slate-950/40') +
                      (item.level === 3 ? ' pl-5' : '')
                    "
                    [attr.href]="'#' + item.id"
                    (click)="scrollToHeading($event, item.id)"
                  >
                    {{ item.title }}
                  </a>
                </div>
              </nav>
            </app-card>
          </aside>
        </div>
      </div>

      <section *ngIf="post()" class="grid gap-2 no-print">
        <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'blog.post.shareTitle' | translate }}</p>
        <div class="flex flex-wrap gap-2">
          <app-button size="sm" variant="ghost" [label]="'blog.post.shareCopy' | translate" (action)="copyShareLink()"></app-button>
          <app-button size="sm" variant="ghost" [label]="'blog.post.shareWhatsApp' | translate" (action)="shareWhatsApp()"></app-button>
          <app-button size="sm" variant="ghost" [label]="'blog.post.shareFacebook' | translate" (action)="shareFacebook()"></app-button>
        </div>
      </section>

      <section *ngIf="neighbors().previous || neighbors().next" class="grid gap-3 no-print">
        <div class="grid gap-3 sm:grid-cols-2">
          <a
            *ngIf="neighbors().previous as prev"
            [routerLink]="['/blog', prev.slug]"
            class="group block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:shadow-none"
          >
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
              ← {{ 'blog.post.previousPost' | translate }}
            </p>
            <p class="pt-1 text-base font-semibold text-slate-900 group-hover:text-indigo-600 dark:text-slate-50 dark:group-hover:text-indigo-300">
              {{ prev.title }}
            </p>
          </a>
          <a
            *ngIf="neighbors().next as next"
            [routerLink]="['/blog', next.slug]"
            class="group block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:shadow-none"
          >
            <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400 text-right">
              {{ 'blog.post.nextPost' | translate }} →
            </p>
            <p class="pt-1 text-base font-semibold text-slate-900 group-hover:text-indigo-600 dark:text-slate-50 dark:group-hover:text-indigo-300 text-right">
              {{ next.title }}
            </p>
          </a>
        </div>
      </section>

      <section *ngIf="relatedPosts().length" class="grid gap-3 no-print">
        <h2 class="text-xl font-semibold text-slate-900 dark:text-slate-50">{{ 'blog.post.relatedTitle' | translate }}</h2>
        <div class="grid gap-4 sm:grid-cols-2">
          <a *ngFor="let related of relatedPosts()" [routerLink]="['/blog', related.slug]" class="group block">
            <div class="h-full transition-transform duration-200 ease-out group-hover:-translate-y-0.5">
              <app-card class="h-full">
                <div class="grid gap-3">
                  <div
                    *ngIf="related.cover_image_url"
                    class="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800"
                  >
                    <img
                      [src]="related.cover_image_url"
                      [alt]="related.title"
                      class="w-full aspect-[16/9] object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <div class="grid gap-1">
                    <p class="text-sm text-slate-500 dark:text-slate-400" *ngIf="related.published_at">
                      {{ related.published_at | date: 'mediumDate' }}
                      <ng-container *ngIf="related.reading_time_minutes">
                        · {{ 'blog.minutesRead' | translate : { minutes: related.reading_time_minutes } }}
                      </ng-container>
                    </p>
                    <h3 class="text-lg font-semibold text-slate-900 group-hover:text-indigo-600 dark:text-slate-50 dark:group-hover:text-indigo-300">
                      {{ related.title }}
                    </h3>
                    <p class="text-sm text-slate-600 dark:text-slate-300 line-clamp-3">
                      {{ related.excerpt }}
                    </p>
                  </div>
                </div>
              </app-card>
            </div>
          </a>
        </div>
      </section>

      <section *ngIf="authorDisplayName()" class="grid gap-3">
        <app-card>
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
            <ng-container *ngIf="post()?.author?.avatar_url; else authorAvatarFallback">
              <img
                [src]="post()!.author!.avatar_url"
                [alt]="authorDisplayName()"
                class="h-16 w-16 rounded-full border border-slate-200 object-cover dark:border-slate-800"
                loading="lazy"
                decoding="async"
              />
            </ng-container>
            <ng-template #authorAvatarFallback>
              <div
                class="h-16 w-16 rounded-full border border-slate-200 bg-slate-50 grid place-items-center text-lg font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-200"
              >
                {{ authorInitials() }}
              </div>
            </ng-template>

            <div class="grid gap-1 flex-1">
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {{ 'blog.post.author.title' | translate }}
              </p>
              <p class="text-lg font-semibold text-slate-900 dark:text-slate-50">
                {{ authorDisplayName() }}
              </p>
              <p *ngIf="authorBio()" class="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line">
                {{ authorBio() }}
              </p>
              <div *ngIf="authorLinks().length" class="flex flex-wrap gap-3 pt-1 text-sm">
                <a
                  *ngFor="let link of authorLinks()"
                  [href]="link.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-indigo-600 underline underline-offset-4 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
                >
                  {{ link.label }}
                </a>
              </div>
            </div>
          </div>
        </app-card>

        <div *ngIf="loadingMoreFromAuthor()" class="grid gap-2 sm:grid-cols-2">
          <app-skeleton height="86px"></app-skeleton>
          <app-skeleton height="86px"></app-skeleton>
        </div>

        <div *ngIf="!loadingMoreFromAuthor() && moreFromAuthor().length" class="grid gap-2">
          <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
            {{ 'blog.post.author.moreFrom' | translate : { author: authorDisplayName() } }}
          </p>
          <div class="grid gap-3 sm:grid-cols-2">
            <a
              *ngFor="let item of moreFromAuthor()"
              [routerLink]="['/blog', item.slug]"
              class="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:shadow-none"
            >
              <p class="text-xs text-slate-500 dark:text-slate-400" *ngIf="item.published_at">
                {{ item.published_at | date: 'mediumDate' }}
                <ng-container *ngIf="item.reading_time_minutes">
                  · {{ 'blog.minutesRead' | translate : { minutes: item.reading_time_minutes } }}
                </ng-container>
              </p>
              <p class="pt-1 text-base font-semibold text-slate-900 hover:text-indigo-600 dark:text-slate-50 dark:hover:text-indigo-300">
                {{ item.title }}
              </p>
            </a>
          </div>
        </div>
      </section>

      <section class="grid gap-3 no-print">
        <div class="flex items-center justify-between gap-4">
          <h2 class="text-xl font-semibold text-slate-900 dark:text-slate-50">
            {{ 'blog.comments.title' | translate : { count: comments().length } }}
          </h2>
          <app-button
            size="sm"
            variant="ghost"
            [label]="'blog.comments.refresh' | translate"
            [disabled]="loadingComments()"
            (action)="loadComments()"
          ></app-button>
        </div>

        <div *ngIf="loadingComments()" class="grid gap-3">
          <app-skeleton *ngFor="let i of commentSkeletons" height="88px"></app-skeleton>
        </div>

        <div
          *ngIf="!loadingComments() && hasCommentsError()"
          class="border border-amber-200 bg-amber-50 rounded-2xl p-4 text-center grid gap-1 dark:border-amber-900/40 dark:bg-amber-950/30"
        >
          <p class="font-semibold text-amber-900 dark:text-amber-100">{{ 'blog.comments.errorTitle' | translate }}</p>
          <p class="text-sm text-amber-800 dark:text-amber-200">{{ 'blog.comments.errorCopy' | translate }}</p>
        </div>

        <div
          *ngIf="!loadingComments() && !hasCommentsError() && comments().length === 0"
          class="border border-dashed border-slate-200 rounded-2xl p-6 text-center text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300"
        >
          {{ 'blog.comments.empty' | translate }}
        </div>

        <div *ngIf="!loadingComments() && !hasCommentsError() && comments().length" class="grid gap-3">
          <ng-container *ngFor="let comment of rootComments()">
            <app-card>
              <div class="grid gap-2">
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {{ authorLabel(comment.author) }}
                    </p>
                    <p class="text-xs text-slate-500 dark:text-slate-400">
                      {{ comment.created_at | date: 'short' }}
                    </p>
                  </div>
                  <div class="flex items-center gap-2 text-xs">
                    <button
                      *ngIf="canReply(comment)"
                      type="button"
                      class="text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
                      (click)="startReply(comment)"
                    >
                      {{ 'blog.comments.reply' | translate }}
                    </button>
                    <button
                      *ngIf="canFlag(comment)"
                      type="button"
                      class="text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100"
                      (click)="flagComment(comment)"
                    >
                      {{ 'blog.comments.report' | translate }}
                    </button>
                    <button
                      *ngIf="canDelete(comment)"
                      type="button"
                      class="text-rose-600 hover:text-rose-700 dark:text-rose-300 dark:hover:text-rose-200"
                      (click)="deleteComment(comment)"
                    >
                      {{ 'blog.comments.delete' | translate }}
                    </button>
                  </div>
                </div>

                <div
                  class="text-sm leading-relaxed whitespace-pre-line"
                  [ngClass]="comment.is_deleted || comment.is_hidden ? 'text-slate-500 dark:text-slate-400 italic' : 'text-slate-700 dark:text-slate-200'"
                >
                  {{
                    comment.is_deleted
                      ? ('blog.comments.deleted' | translate)
                      : comment.is_hidden
                        ? ('blog.comments.hidden' | translate)
                        : comment.body
                  }}
                </div>

                <div *ngIf="replies(comment.id).length" class="grid gap-2 border-l border-slate-200 pl-4 dark:border-slate-700">
                  <div *ngFor="let reply of replies(comment.id)" class="grid gap-1">
                    <div class="flex items-start justify-between gap-2">
                      <div>
                        <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {{ authorLabel(reply.author) }}
                        </p>
                        <p class="text-xs text-slate-500 dark:text-slate-400">
                          {{ reply.created_at | date: 'short' }}
                        </p>
                      </div>
                      <div class="flex items-center gap-2 text-xs">
                        <button
                          *ngIf="canFlag(reply)"
                          type="button"
                          class="text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100"
                          (click)="flagComment(reply)"
                        >
                          {{ 'blog.comments.report' | translate }}
                        </button>
                        <button
                          *ngIf="canDelete(reply)"
                          type="button"
                          class="text-rose-600 hover:text-rose-700 dark:text-rose-300 dark:hover:text-rose-200"
                          (click)="deleteComment(reply)"
                        >
                          {{ 'blog.comments.delete' | translate }}
                        </button>
                      </div>
                    </div>
                    <div
                      class="text-sm leading-relaxed whitespace-pre-line"
                      [ngClass]="reply.is_deleted || reply.is_hidden ? 'text-slate-500 dark:text-slate-400 italic' : 'text-slate-700 dark:text-slate-200'"
                    >
                      {{
                        reply.is_deleted
                          ? ('blog.comments.deleted' | translate)
                          : reply.is_hidden
                            ? ('blog.comments.hidden' | translate)
                            : reply.body
                      }}
                    </div>
                  </div>
                </div>
              </div>
            </app-card>
          </ng-container>
        </div>

        <app-card>
          <div *ngIf="!auth.isAuthenticated()" class="text-sm text-slate-700 dark:text-slate-200">
            {{ 'blog.comments.signInPrompt' | translate }}
            <a routerLink="/login" class="text-indigo-600 dark:text-indigo-300 hover:underline">{{ 'nav.signIn' | translate }}</a
            >.
          </div>

          <form *ngIf="auth.isAuthenticated()" class="grid gap-3" (submit)="submitComment($event)">
            <div *ngIf="replyTo()" class="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200">
              <span>
                {{ 'blog.comments.replyingTo' | translate : { name: authorLabel(replyTo()!.author) } }}
              </span>
              <button type="button" class="text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white" (click)="cancelReply()">
                {{ 'blog.comments.cancelReply' | translate }}
              </button>
            </div>

            <label class="grid gap-1 text-sm font-medium text-slate-800 dark:text-slate-200">
              {{ 'blog.comments.yourComment' | translate }}
              <textarea
                rows="4"
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="commentBody"
                name="commentBody"
                [placeholder]="'blog.comments.placeholder' | translate"
              ></textarea>
            </label>

            <div class="flex items-center gap-2">
              <app-button
                size="sm"
                [label]="'blog.comments.submit' | translate"
                [disabled]="submitting() || !commentBody.trim()"
                (action)="submitComment()"
              ></app-button>
              <span *ngIf="submitting()" class="text-xs text-slate-500 dark:text-slate-400">{{ 'blog.comments.submitting' | translate }}</span>
            </div>
          </form>
        </app-card>
      </section>
    </app-container>

    <div
      *ngIf="lightboxOpen()"
      class="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm p-4 grid place-items-center"
      (click)="closeLightbox()"
      role="dialog"
      aria-modal="true"
    >
      <div class="relative w-full max-w-5xl" (click)="$event.stopPropagation()">
        <button
          type="button"
          class="absolute -top-3 -right-3 h-10 w-10 rounded-full bg-white text-slate-900 shadow-soft hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-50 dark:hover:bg-slate-800"
          (click)="closeLightbox()"
          [attr.aria-label]="'blog.post.lightbox.close' | translate"
        >
          ✕
        </button>

        <img
          *ngIf="lightboxImage() as img"
          [src]="img.src"
          [alt]="img.alt || ''"
          class="w-full max-h-[78vh] object-contain rounded-2xl bg-black"
        />

        <div class="pt-3 grid gap-2 text-center">
          <p *ngIf="lightboxImage()?.alt" class="text-sm text-white/80">{{ lightboxImage()!.alt }}</p>
          <p *ngIf="galleryImages().length > 1" class="text-xs text-white/60">
            {{ (lightboxIndex() ?? 0) + 1 }} / {{ galleryImages().length }}
          </p>
        </div>

        <div *ngIf="galleryImages().length > 1" class="absolute inset-y-0 left-0 right-0 flex items-center justify-between px-2">
          <button
            type="button"
            class="h-10 w-10 rounded-full bg-black/40 text-white hover:bg-black/55"
            (click)="prevLightbox($event)"
            [attr.aria-label]="'blog.post.lightbox.previous' | translate"
          >
            ‹
          </button>
          <button
            type="button"
            class="h-10 w-10 rounded-full bg-black/40 text-white hover:bg-black/55"
            (click)="nextLightbox($event)"
            [attr.aria-label]="'blog.post.lightbox.next' | translate"
          >
            ›
          </button>
        </div>
      </div>
    </div>

    <button
      *ngIf="showBackToTop()"
      type="button"
      class="fixed bottom-6 right-6 z-50 h-11 w-11 rounded-full bg-slate-900 text-white shadow-soft hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white no-print"
      (click)="scrollToTop()"
      [attr.aria-label]="'blog.post.backToTop' | translate"
    >
      ↑
    </button>
  `
})
export class BlogPostComponent implements OnInit, OnDestroy {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.blog', url: '/blog' },
    { label: 'blog.post.breadcrumb' }
  ];

  post = signal<BlogPost | null>(null);
  loadingPost = signal<boolean>(true);
  hasPostError = signal<boolean>(false);
  bodyHtml = signal<string>('');
  toc = signal<Array<{ id: string; title: string; level: 2 | 3 }>>([]);
  activeHeadingId = signal<string | null>(null);
  neighbors = signal<{ previous: BlogPostListItem | null; next: BlogPostListItem | null }>({ previous: null, next: null });
  relatedPosts = signal<BlogPostListItem[]>([]);
  moreFromAuthor = signal<BlogPostListItem[]>([]);
  loadingMoreFromAuthor = signal<boolean>(false);
  galleryImages = signal<Array<{ src: string; alt: string }>>([]);
  lightboxIndex = signal<number | null>(null);
  lightboxImage = computed(() => {
    const idx = this.lightboxIndex();
    if (idx === null) return null;
    const images = this.galleryImages();
    return images[idx] ?? null;
  });
  lightboxOpen = computed(() => this.lightboxIndex() !== null && !!this.lightboxImage());

  comments = signal<BlogComment[]>([]);
  loadingComments = signal<boolean>(true);
  hasCommentsError = signal<boolean>(false);
  commentSkeletons = Array.from({ length: 3 });

  commentBody = '';
  submitting = signal<boolean>(false);
  replyTo = signal<BlogComment | null>(null);
  isPreview = signal<boolean>(false);
  readingProgress = signal<number>(0);
  showBackToTop = signal<boolean>(false);
  progressPercent = computed(() => Math.round(this.readingProgress() * 100));

  authorDisplayName = computed(() => {
    const post = this.post();
    return post?.author_name || post?.author?.name || post?.author?.username || '';
  });
  authorInitials = computed(() => {
    const name = this.authorDisplayName().trim();
    if (!name) return '?';
    const parts = name.split(/\s+/g).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
  });
  authorBio = computed(() => {
    const post = this.post();
    const meta = (post?.meta as any) || {};
    const author = meta?.author;
    const bio = author?.bio;
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    if (typeof bio === 'string') return bio.trim();
    if (bio && typeof bio === 'object' && typeof bio[lang] === 'string') return String(bio[lang]).trim();
    return '';
  });
  authorLinks = computed(() => {
    const post = this.post();
    const meta = (post?.meta as any) || {};
    const author = meta?.author;
    const links = author?.links;
    if (!Array.isArray(links)) return [] as Array<{ label: string; url: string }>;
    return links
      .map((row: any) => ({
        label: typeof row?.label === 'string' ? row.label.trim() : '',
        url: typeof row?.url === 'string' ? row.url.trim() : ''
      }))
      .filter((row) => row.label && row.url);
  });

  @ViewChild('articleContent') articleContent?: ElementRef<HTMLElement>;

  private slug = '';
  private previewToken = '';
  private langSub?: Subscription;
  private routeSub?: Subscription;
  private canonicalEl?: HTMLLinkElement;
  private document: Document = inject(DOCUMENT);
  private scrollStartY = 0;
  private scrollEndY = 1;
  private tocHeadingEls: HTMLElement[] = [];
  private embedRevision = 0;
  private previousBodyOverflow: string | null = null;
  private lightboxKeyListener = (event: KeyboardEvent) => {
    if (!this.lightboxOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeLightbox();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.nextLightbox();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.prevLightbox();
    }
  };
  private scrollListener = () => this.updateReadingProgress();
  private resizeListener = () => this.measureReadingProgressSoon();

  constructor(
    private blog: BlogService,
    private route: ActivatedRoute,
    private router: Router,
    private translate: TranslateService,
    private title: Title,
    private meta: Meta,
    private toast: ToastService,
    private markdown: MarkdownService,
    private catalog: CatalogService,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    this.routeSub = combineLatest([this.route.params, this.route.queryParams]).subscribe(([params, query]) => {
      this.slug = params['slug'];
      this.previewToken = typeof query['preview'] === 'string' ? query['preview'] : '';
      this.isPreview.set(!!this.previewToken);
      this.load();
    });
    this.langSub = this.translate.onLangChange.subscribe(() => this.load());

    const w = this.document?.defaultView;
    if (w) {
      w.addEventListener('scroll', this.scrollListener, { passive: true });
      w.addEventListener('resize', this.resizeListener);
    }
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
    this.routeSub?.unsubscribe();
    const w = this.document?.defaultView;
    if (w) {
      w.removeEventListener('scroll', this.scrollListener);
      w.removeEventListener('resize', this.resizeListener);
    }
    this.closeLightbox();
  }

  load(): void {
    if (!this.slug) return;
    this.loadingPost.set(true);
    this.hasPostError.set(false);
    this.post.set(null);
    this.readingProgress.set(0);
    this.showBackToTop.set(false);
    this.toc.set([]);
    this.activeHeadingId.set(null);
    this.neighbors.set({ previous: null, next: null });
    this.relatedPosts.set([]);
    this.moreFromAuthor.set([]);
    this.loadingMoreFromAuthor.set(false);
    this.galleryImages.set([]);
    this.lightboxIndex.set(null);
    this.scrollStartY = 0;
    this.scrollEndY = 1;
    this.tocHeadingEls = [];
    this.setCanonical();

    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    const req = this.previewToken
      ? this.blog.getPreviewPost(this.slug, this.previewToken, lang)
      : this.blog.getPost(this.slug, lang);
    req.subscribe({
      next: (post) => {
        this.post.set(post);
        const rendered = this.renderPostBody(post.body_markdown);
        this.bodyHtml.set(rendered.html);
        this.toc.set(rendered.toc);
        this.embedRevision += 1;
        this.hydrateEmbeds(rendered.embeds, this.embedRevision, lang);
        this.loadingPost.set(false);
        this.hasPostError.set(false);
        this.crumbs = [
          { label: 'nav.home', url: '/' },
          { label: 'nav.blog', url: '/blog' },
          { label: post.title }
        ];
        this.setMetaTags(post);
        this.measureReadingProgressSoon();
        this.loadNeighbors(lang);
        this.loadRelatedPosts(lang, post);
        this.loadMoreFromAuthor(lang, post);
        this.loadComments();
      },
      error: () => {
        this.post.set(null);
        this.bodyHtml.set('');
        this.toc.set([]);
        this.activeHeadingId.set(null);
        this.neighbors.set({ previous: null, next: null });
        this.relatedPosts.set([]);
        this.moreFromAuthor.set([]);
        this.loadingMoreFromAuthor.set(false);
        this.embedRevision += 1;
        this.loadingPost.set(false);
        this.hasPostError.set(true);
        this.setErrorMetaTags();
        this.readingProgress.set(0);
        this.showBackToTop.set(false);
        this.comments.set([]);
      }
    });
  }

  private loadNeighbors(lang: string): void {
    if (!this.slug) return;
    this.blog.getNeighbors(this.slug, lang).subscribe({
      next: (resp) => {
        this.neighbors.set({ previous: resp.previous ?? null, next: resp.next ?? null });
      },
      error: () => {
        this.neighbors.set({ previous: null, next: null });
      }
    });
  }

  private loadRelatedPosts(lang: string, post: BlogPost): void {
    const series = (post.series || '').trim().toLowerCase();
    const tagSet = new Set((post.tags || []).map((t) => t.toLowerCase()));
    if (!series && tagSet.size === 0) {
      this.relatedPosts.set([]);
      return;
    }
    this.blog
      .listPosts({
        lang,
        page: 1,
        limit: 50,
        sort: 'newest'
      })
      .subscribe({
        next: (resp) => {
          const scored = resp.items
            .filter((item) => item.slug !== post.slug)
            .map((item) => {
              let score = 0;
              if (series && item.series && item.series.toLowerCase() === series) score += 10;
              const sharedTags = (item.tags || []).reduce((acc, t) => acc + (tagSet.has(t.toLowerCase()) ? 1 : 0), 0);
              score += sharedTags;
              return { item, score };
            })
            .filter((row) => row.score > 0)
            .sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score;
              const aTs = a.item.published_at ? Date.parse(a.item.published_at) : 0;
              const bTs = b.item.published_at ? Date.parse(b.item.published_at) : 0;
              return bTs - aTs;
            })
            .slice(0, 6)
            .map((row) => row.item);
          this.relatedPosts.set(scored);
        },
        error: () => {
          this.relatedPosts.set([]);
        }
      });
  }

  private loadMoreFromAuthor(lang: string, post: BlogPost): void {
    const authorId = post.author?.id;
    if (!authorId) {
      this.moreFromAuthor.set([]);
      this.loadingMoreFromAuthor.set(false);
      return;
    }
    this.loadingMoreFromAuthor.set(true);
    this.blog
      .listPosts({
        lang,
        page: 1,
        limit: 8,
        sort: 'newest',
        author_id: authorId
      })
      .subscribe({
        next: (resp) => {
          const items = (resp.items || []).filter((item) => item.slug !== post.slug).slice(0, 4);
          this.moreFromAuthor.set(items);
          this.loadingMoreFromAuthor.set(false);
        },
        error: () => {
          this.moreFromAuthor.set([]);
          this.loadingMoreFromAuthor.set(false);
        }
      });
  }

  scrollToTop(): void {
    const w = this.document?.defaultView;
    if (!w) return;
    w.scrollTo({ top: 0, behavior: 'smooth' });
  }

  scrollToHeading(event: Event, id: string): void {
    event.preventDefault();
    const w = this.document?.defaultView;
    if (!w) return;
    const target = this.document.getElementById(id);
    if (!target) return;
    const offset = 112;
    const top = target.getBoundingClientRect().top + (w.scrollY || 0) - offset;
    w.scrollTo({ top, behavior: 'smooth' });
    w.history.replaceState(null, '', `${w.location.pathname}${w.location.search}#${encodeURIComponent(id)}`);
    this.activeHeadingId.set(id);
  }

  handleArticleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const link = target?.closest('a[data-router-link]') as HTMLAnchorElement | null;
    if (link) {
      const to = link.getAttribute('data-router-link') || '';
      if (to && !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        void this.router.navigateByUrl(to);
        return;
      }
    }
    const codeButton = target?.closest('button[data-code-action]') as HTMLButtonElement | null;
    if (codeButton) {
      const action = codeButton.getAttribute('data-code-action');
      const wrapper = codeButton.closest('.blog-codeblock') as HTMLElement | null;
      if (!action || !wrapper) return;
      if (action === 'copy') {
        const code = wrapper.querySelector('pre code') as HTMLElement | null;
        const value = (code?.textContent || '').trimEnd();
        if (value) this.copyCode(value);
      } else if (action === 'wrap') {
        const wrap = wrapper.classList.toggle('blog-codeblock--wrap');
        const wrapLabel = codeButton.getAttribute('data-wrap-label') || this.translate.instant('blog.post.code.wrap');
        const unwrapLabel = codeButton.getAttribute('data-unwrap-label') || this.translate.instant('blog.post.code.unwrap');
        codeButton.textContent = wrap ? unwrapLabel : wrapLabel;
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const img = target?.closest('img') as HTMLImageElement | null;
    if (!img) return;
    const images = this.galleryImages();
    if (!images.length) return;
    const src = img.currentSrc || img.src;
    if (!src) return;
    const idx = images.findIndex((candidate) => candidate.src === src);
    if (idx < 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.openLightbox(idx);
  }

  private copyCode(code: string): void {
    const w = this.document?.defaultView;
    if (!w) return;
    const toastTitle = this.translate.instant('blog.post.code.copiedTitle');
    const toastCopy = this.translate.instant('blog.post.code.copiedCopy');
    const errorTitle = this.translate.instant('blog.post.code.copyErrorTitle');
    const errorCopy = this.translate.instant('blog.post.code.copyErrorCopy');
    if (w.navigator?.clipboard?.writeText) {
      w.navigator.clipboard
        .writeText(code)
        .then(() => this.toast.success(toastTitle, toastCopy))
        .catch(() => this.toast.error(errorTitle, errorCopy));
      return;
    }
    try {
      const input = this.document.createElement('textarea');
      input.value = code;
      input.setAttribute('readonly', 'true');
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      this.document.body.appendChild(input);
      input.select();
      const ok = this.document.execCommand('copy');
      input.remove();
      if (ok) {
        this.toast.success(toastTitle, toastCopy);
      } else {
        this.toast.error(errorTitle, errorCopy);
      }
    } catch {
      this.toast.error(errorTitle, errorCopy);
    }
  }

  openLightbox(index: number): void {
    const images = this.galleryImages();
    if (!images.length) return;
    const clamped = Math.min(Math.max(0, index), images.length - 1);
    this.lightboxIndex.set(clamped);
    const w = this.document?.defaultView;
    if (w) w.addEventListener('keydown', this.lightboxKeyListener);
    if (this.previousBodyOverflow === null) {
      this.previousBodyOverflow = this.document.body.style.overflow || '';
      this.document.body.style.overflow = 'hidden';
    }
  }

  closeLightbox(): void {
    const w = this.document?.defaultView;
    if (w) w.removeEventListener('keydown', this.lightboxKeyListener);
    this.lightboxIndex.set(null);
    if (this.previousBodyOverflow !== null) {
      this.document.body.style.overflow = this.previousBodyOverflow;
      this.previousBodyOverflow = null;
    }
  }

  nextLightbox(event?: Event): void {
    if (event) event.stopPropagation();
    const images = this.galleryImages();
    const idx = this.lightboxIndex();
    if (idx === null || images.length < 2) return;
    this.lightboxIndex.set((idx + 1) % images.length);
  }

  prevLightbox(event?: Event): void {
    if (event) event.stopPropagation();
    const images = this.galleryImages();
    const idx = this.lightboxIndex();
    if (idx === null || images.length < 2) return;
    this.lightboxIndex.set((idx - 1 + images.length) % images.length);
  }

  copyShareLink(): void {
    const w = this.document?.defaultView;
    if (!w) return;
    const url = this.buildShareUrl();
    if (!url) return;

    const toastTitle = this.translate.instant('blog.post.shareCopiedTitle');
    const toastCopy = this.translate.instant('blog.post.shareCopiedCopy');
    const errorTitle = this.translate.instant('blog.post.shareCopyErrorTitle');
    const errorCopy = this.translate.instant('blog.post.shareCopyErrorCopy');

    if (w.navigator?.clipboard?.writeText) {
      w.navigator.clipboard
        .writeText(url)
        .then(() => this.toast.success(toastTitle, toastCopy))
        .catch(() => this.toast.error(errorTitle, errorCopy));
      return;
    }

    try {
      const input = this.document.createElement('textarea');
      input.value = url;
      input.setAttribute('readonly', 'true');
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      this.document.body.appendChild(input);
      input.select();
      const ok = this.document.execCommand('copy');
      input.remove();
      if (ok) {
        this.toast.success(toastTitle, toastCopy);
      } else {
        this.toast.error(errorTitle, errorCopy);
      }
    } catch {
      this.toast.error(errorTitle, errorCopy);
    }
  }

  shareWhatsApp(): void {
    const w = this.document?.defaultView;
    if (!w) return;
    const url = this.buildShareUrl();
    if (!url) return;
    const title = this.post()?.title || '';
    const text = title ? `${title} ${url}` : url;
    w.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }

  shareFacebook(): void {
    const w = this.document?.defaultView;
    if (!w) return;
    const url = this.buildShareUrl();
    if (!url) return;
    w.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank', 'noopener,noreferrer');
  }

  loadComments(): void {
    if (!this.slug) return;
    this.loadingComments.set(true);
    this.hasCommentsError.set(false);
    this.blog.listComments(this.slug, { page: 1, limit: 50 }).subscribe({
      next: (resp) => {
        this.comments.set(resp.items);
        this.loadingComments.set(false);
        this.hasCommentsError.set(false);
      },
      error: () => {
        this.comments.set([]);
        this.loadingComments.set(false);
        this.hasCommentsError.set(true);
      }
    });
  }

  rootComments(): BlogComment[] {
    return this.comments().filter((c) => !c.parent_id);
  }

  replies(parentId: string): BlogComment[] {
    return this.comments().filter((c) => c.parent_id === parentId);
  }

  canDelete(comment: BlogComment): boolean {
    if (!this.auth.isAuthenticated()) return false;
    if (comment.is_deleted) return false;
    const current = this.auth.user();
    if (!current) return false;
    return this.auth.isAdmin() || current.id === comment.author.id;
  }

  canReply(comment: BlogComment): boolean {
    if (!this.auth.isAuthenticated()) return false;
    return !comment.is_deleted;
  }

  startReply(comment: BlogComment): void {
    this.replyTo.set(comment);
  }

  cancelReply(): void {
    this.replyTo.set(null);
  }

  authorLabel(author: BlogComment['author'] | null | undefined): string {
    return formatIdentity(author, this.translate.instant('blog.comments.anonymous'));
  }

  submitComment(event?: Event): void {
    if (event) event.preventDefault();
    if (!this.slug) return;
    if (!this.auth.isAuthenticated()) return;
    const body = this.commentBody.trim();
    if (!body) return;

    this.submitting.set(true);
    const parent = this.replyTo();
    this.blog.createComment(this.slug, { body, parent_id: parent?.id ?? null }).subscribe({
      next: () => {
        this.commentBody = '';
        this.replyTo.set(null);
        this.submitting.set(false);
        this.loadComments();
      },
      error: () => {
        this.submitting.set(false);
        this.toast.error(this.translate.instant('blog.comments.createErrorTitle'), this.translate.instant('blog.comments.createErrorCopy'));
      }
    });
  }

  deleteComment(comment: BlogComment): void {
    if (!this.canDelete(comment)) return;
    const ok = confirm(this.translate.instant('blog.comments.confirmDelete'));
    if (!ok) return;
    this.blog.deleteComment(comment.id).subscribe({
      next: () => {
        this.loadComments();
      },
      error: () => {
        this.toast.error(this.translate.instant('blog.comments.deleteErrorTitle'), this.translate.instant('blog.comments.deleteErrorCopy'));
      }
    });
  }

  canFlag(comment: BlogComment): boolean {
    if (!this.auth.isAuthenticated()) return false;
    const me = this.auth.user();
    if (!me) return false;
    if (comment.is_deleted || comment.is_hidden) return false;
    return comment.author?.id !== me.id;
  }

  flagComment(comment: BlogComment): void {
    if (!this.canFlag(comment)) return;
    const reason = prompt(this.translate.instant('blog.comments.reportPrompt')) || '';
    this.blog.flagComment(comment.id, { reason: reason.trim() || null }).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('blog.comments.reportedTitle'), this.translate.instant('blog.comments.reportedCopy'));
      },
      error: () => {
        this.toast.error(this.translate.instant('blog.comments.reportErrorTitle'), this.translate.instant('blog.comments.reportErrorCopy'));
      }
    });
  }

  private setMetaTags(post: BlogPost): void {
    const pageTitle = `${post.title} | momentstudio`;
    const description = (post.summary || post.body_markdown || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    this.title.setTitle(pageTitle);
    if (description) {
      this.meta.updateTag({ name: 'description', content: description });
      this.meta.updateTag({ property: 'og:description', content: description });
      this.meta.updateTag({ name: 'twitter:description', content: description });
    }
    this.meta.updateTag({ property: 'og:title', content: pageTitle });
    this.meta.updateTag({ property: 'og:type', content: 'article' });
    this.meta.updateTag({ property: 'og:site_name', content: 'momentstudio' });

    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    const apiBaseUrl = (appConfig.apiBaseUrl || '/api/v1').replace(/\/$/, '');
    const ogPath = `${apiBaseUrl}/blog/posts/${this.slug}/og.png?lang=${lang}`;
    const ogImage =
      ogPath.startsWith('http://') || ogPath.startsWith('https://') || typeof window === 'undefined'
        ? ogPath
        : `${window.location.origin}${ogPath}`;
    this.meta.updateTag({ property: 'og:image', content: ogImage });
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:title', content: pageTitle });
    this.meta.updateTag({ name: 'twitter:image', content: ogImage });
    this.setCanonical();
  }

  private setErrorMetaTags(): void {
    const title = this.translate.instant('blog.post.metaTitle');
    const description = this.translate.instant('blog.post.metaDescription');
    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.setCanonical();
  }

  private setCanonical(): void {
    if (!this.slug || typeof window === 'undefined' || !this.document) return;
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    const href = `${window.location.origin}/blog/${this.slug}?lang=${lang}`;
    let link: HTMLLinkElement | null = this.document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.document.head.appendChild(link);
    }
    link.setAttribute('href', href);
    this.canonicalEl = link;
    this.meta.updateTag({ property: 'og:url', content: href });
  }

  private measureReadingProgressSoon(): void {
    const w = this.document?.defaultView;
    if (!w) return;
    w.requestAnimationFrame(() => {
      this.measureReadingProgress();
      this.updateReadingProgress();
    });
  }

  private measureReadingProgress(): void {
    const w = this.document?.defaultView;
    const el = this.articleContent?.nativeElement;
    if (!w || !el) return;
    const rect = el.getBoundingClientRect();
    const scrollTop = w.scrollY || this.document.documentElement.scrollTop || 0;
    const start = rect.top + scrollTop;
    const end = rect.bottom + scrollTop - w.innerHeight;
    this.scrollStartY = start;
    this.scrollEndY = Math.max(start + 1, end);
    this.tocHeadingEls = Array.from(el.querySelectorAll('h2[id], h3[id]')) as HTMLElement[];
    const imgs = Array.from(el.querySelectorAll('img')) as HTMLImageElement[];
    const gallery: Array<{ src: string; alt: string }> = [];
    const seen = new Set<string>();
    for (const img of imgs) {
      if (img.closest('.blog-embed')) continue;
      const src = img.currentSrc || img.src;
      if (!src || seen.has(src)) continue;
      seen.add(src);
      gallery.push({ src, alt: img.getAttribute('alt') || '' });
    }
    this.galleryImages.set(gallery);
    this.updateActiveHeading();
  }

  private updateReadingProgress(): void {
    const w = this.document?.defaultView;
    if (!w) return;
    if (!this.articleContent?.nativeElement) {
      this.readingProgress.set(0);
      this.showBackToTop.set(false);
      this.activeHeadingId.set(null);
      return;
    }
    if (!this.scrollEndY || this.scrollEndY <= this.scrollStartY + 1) {
      this.measureReadingProgress();
    }
    const scrollTop = w.scrollY || 0;
    const raw = (scrollTop - this.scrollStartY) / (this.scrollEndY - this.scrollStartY);
    const progress = Math.min(1, Math.max(0, raw));
    this.readingProgress.set(progress);
    this.showBackToTop.set(scrollTop > this.scrollStartY + 600);
    this.updateActiveHeading();
  }

  private updateActiveHeading(): void {
    if (!this.tocHeadingEls.length) {
      this.activeHeadingId.set(null);
      return;
    }
    const w = this.document?.defaultView;
    if (!w) return;
    const offset = 120;
    let active: string | null = null;
    for (const heading of this.tocHeadingEls) {
      const top = heading.getBoundingClientRect().top;
      if (top - offset <= 0) {
        active = heading.id;
      } else {
        break;
      }
    }
    this.activeHeadingId.set(active);
  }

  private buildShareUrl(): string {
    const w = this.document?.defaultView;
    if (!w || !this.slug) return '';
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    const hash = w.location.hash || '';
    return `${w.location.origin}/blog/${encodeURIComponent(this.slug)}?lang=${lang}${hash}`;
  }

  private renderPostBody(markdown: string): {
    html: string;
    toc: Array<{ id: string; title: string; level: 2 | 3 }>;
    embeds: Array<{ type: 'product' | 'category' | 'collection'; slug: string }>;
  } {
    const html = this.markdown.render(markdown || '');
    const w = this.document?.defaultView;
    if (!w?.DOMParser) return { html, toc: [], embeds: [] };

    const parser = new w.DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const headings = Array.from(doc.body.querySelectorAll('h2, h3')) as HTMLElement[];

    const toc: Array<{ id: string; title: string; level: 2 | 3 }> = [];
    const embeds: Array<{ type: 'product' | 'category' | 'collection'; slug: string }> = [];
    const used = new Set<string>();
    const linkLabel = this.translate.instant('blog.post.sectionLinkLabel');

    for (const heading of headings) {
      const level = heading.tagName.toLowerCase() === 'h3' ? 3 : 2;
      const title = (heading.textContent || '').replace(/\s+/g, ' ').trim();
      if (!title) continue;
      const baseId = this.slugifyHeading(title) || 'section';
      let id = baseId;
      let i = 2;
      while (used.has(id)) {
        id = `${baseId}-${i}`;
        i += 1;
      }
      used.add(id);
      heading.id = id;

      const anchor = doc.createElement('a');
      anchor.className = 'blog-heading-anchor';
      anchor.href = `#${id}`;
      anchor.setAttribute('aria-label', linkLabel);
      anchor.textContent = '#';
      heading.appendChild(anchor);

      toc.push({ id, title, level: level as 2 | 3 });
    }

    const images = Array.from(doc.body.querySelectorAll('img')) as HTMLImageElement[];
    for (const img of images) {
      const title = (img.getAttribute('title') || '').trim().toLowerCase();
      if (!title) continue;
      const tokens = title.split(/[\s,]+/).filter(Boolean);
      const hasLayoutToken = tokens.some((t) => t === 'wide' || t === 'full' || t === 'left' || t === 'right' || t === 'gallery');
      if (!hasLayoutToken) continue;

      if (tokens.includes('wide') || tokens.includes('full')) img.classList.add('blog-img-wide');
      if (tokens.includes('left')) img.classList.add('blog-img-left');
      if (tokens.includes('right')) img.classList.add('blog-img-right');
      if (tokens.includes('gallery')) img.classList.add('blog-img-gallery');
      img.removeAttribute('title');
    }

    let idx = 0;
    while (idx < doc.body.children.length) {
      const node = doc.body.children[idx];
      if (node.tagName !== 'P') {
        idx += 1;
        continue;
      }
      const img = node.querySelector('img');
      if (!img || !img.classList.contains('blog-img-gallery') || node.children.length !== 1) {
        idx += 1;
        continue;
      }
      const group: Element[] = [];
      let j = idx;
      while (j < doc.body.children.length) {
        const candidate = doc.body.children[j];
        if (candidate.tagName !== 'P') break;
        const candidateImg = candidate.querySelector('img');
        if (!candidateImg || !candidateImg.classList.contains('blog-img-gallery') || candidate.children.length !== 1) break;
        group.push(candidate);
        j += 1;
      }
      if (group.length < 2) {
        idx += 1;
        continue;
      }
      const gallery = doc.createElement('div');
      gallery.className = 'blog-gallery';
      for (const para of group) {
        const galleryImg = para.querySelector('img');
        if (!galleryImg) continue;
        galleryImg.classList.remove('blog-img-gallery');
        gallery.appendChild(galleryImg);
      }
      group[0].replaceWith(gallery);
      for (const extra of group.slice(1)) {
        extra.remove();
      }
      idx += 1;
    }

    const embedRe = /^\{\{\s*(product|category|collection)\s*:\s*([a-z0-9_-]+)\s*\}\}$/i;
    const embedParas = Array.from(doc.body.querySelectorAll('p')) as HTMLElement[];
    for (const para of embedParas) {
      const text = (para.textContent || '').trim();
      const match = text.match(embedRe);
      if (!match) continue;
      const rawType = (match[1] || '').toLowerCase();
      const type = rawType === 'product' || rawType === 'category' || rawType === 'collection' ? rawType : null;
      if (!type) continue;
      const slug = (match[2] || '').trim();
      if (!slug) continue;
      embeds.push({ type, slug });

      const embed = doc.createElement('div');
      embed.className = `blog-embed blog-embed--${type}`;
      embed.setAttribute('data-embed-type', type);
      embed.setAttribute('data-embed-slug', slug);
      embed.textContent = this.translate.instant('blog.post.loadingTitle');
      para.replaceWith(embed);
    }

    const calloutTipLabel = this.translate.instant('blog.post.callout.tip');
    const calloutNoteLabel = this.translate.instant('blog.post.callout.note');
    const calloutWarningLabel = this.translate.instant('blog.post.callout.warning');
    const calloutMarker = /^\s*\[!(TIP|NOTE|WARNING|CAUTION|IMPORTANT|INFO)\]\s*/i;

    const createCalloutIcon = (kind: 'tip' | 'note' | 'warning'): Element => {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = doc.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('width', '18');
      svg.setAttribute('height', '18');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('class', 'blog-callout-icon');

      const addPath = (d: string): void => {
        const path = doc.createElementNS(ns, 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
      };

      if (kind === 'tip') {
        addPath('M9 18h6');
        addPath('M10 22h4');
        addPath('M12 2a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2z');
      } else if (kind === 'warning') {
        addPath('M12 9v4');
        addPath('M12 17h.01');
        addPath('M10.29 3.86 1.82 18.53A1 1 0 0 0 2.68 20h18.64a1 1 0 0 0 .86-1.47L13.71 3.86a1 1 0 0 0-1.72 0z');
      } else {
        addPath('M12 17h.01');
        addPath('M11 10h1v4h1');
        addPath('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z');
      }

      return svg;
    };

    const callouts = Array.from(doc.body.querySelectorAll('blockquote')) as HTMLElement[];
    for (const blockquote of callouts) {
      const firstPara = blockquote.querySelector('p') as HTMLElement | null;
      if (!firstPara) continue;
      const text = (firstPara.textContent || '').trimStart();
      const match = text.match(/^\[!(TIP|NOTE|WARNING|CAUTION|IMPORTANT|INFO)\]/i);
      if (!match) continue;
      const marker = match[1].toLowerCase();
      const kind = marker === 'tip' ? 'tip' : marker === 'warning' || marker === 'caution' ? 'warning' : 'note';

      const firstChild = firstPara.firstChild;
      if (firstChild?.nodeType === w.Node.TEXT_NODE) {
        firstChild.textContent = (firstChild.textContent || '').replace(calloutMarker, '');
      } else {
        firstPara.innerHTML = firstPara.innerHTML.replace(calloutMarker, '');
      }
      if ((firstPara.textContent || '').trim().length === 0) {
        firstPara.remove();
      }

      const labelText = kind === 'tip' ? calloutTipLabel : kind === 'warning' ? calloutWarningLabel : calloutNoteLabel;
      const header = doc.createElement('div');
      header.className = 'blog-callout-header';
      header.appendChild(createCalloutIcon(kind));
      const headerLabel = doc.createElement('span');
      headerLabel.textContent = labelText;
      header.appendChild(headerLabel);

      const body = doc.createElement('div');
      body.className = 'blog-callout-body';
      while (blockquote.firstChild) {
        body.appendChild(blockquote.firstChild);
      }
      blockquote.classList.add('blog-callout', `blog-callout--${kind}`);
      blockquote.appendChild(header);
      blockquote.appendChild(body);
    }

    const codeCopyLabel = this.translate.instant('blog.post.code.copy');
    const codeWrapLabel = this.translate.instant('blog.post.code.wrap');
    const codeUnwrapLabel = this.translate.instant('blog.post.code.unwrap');
    const codeFallbackLabel = this.translate.instant('blog.post.code.languageFallback');

    const codeBlocks = Array.from(doc.body.querySelectorAll('pre > code')) as HTMLElement[];
    for (const codeEl of codeBlocks) {
      const pre = codeEl.parentElement as HTMLElement | null;
      if (!pre) continue;
      const raw = codeEl.textContent || '';
      const langMatch = codeEl.className.match(/language-([a-z0-9_-]+)/i);
      const rawLang = (langMatch?.[1] || '').trim().toLowerCase();
      const lang =
        rawLang === 'js'
          ? 'javascript'
          : rawLang === 'ts'
            ? 'typescript'
            : rawLang === 'html'
              ? 'html'
              : rawLang === 'xml'
                ? 'html'
                : rawLang;

      try {
        const highlighted = lang && hljs.getLanguage(lang) ? hljs.highlight(raw, { language: lang }).value : hljs.highlightAuto(raw).value;
        codeEl.innerHTML = highlighted;
        codeEl.classList.add('hljs');
      } catch {
        // leave as-is
      }

      const wrapper = doc.createElement('div');
      wrapper.className = 'blog-codeblock';

      const header = doc.createElement('div');
      header.className = 'blog-codeblock-header';

      const langSpan = doc.createElement('span');
      langSpan.className = 'blog-codeblock-lang';
      langSpan.textContent = lang || codeFallbackLabel;

      const actions = doc.createElement('div');
      actions.className = 'blog-codeblock-actions';

      const copyBtn = doc.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'blog-codeblock-btn';
      copyBtn.setAttribute('data-code-action', 'copy');
      copyBtn.textContent = codeCopyLabel;

      const wrapBtn = doc.createElement('button');
      wrapBtn.type = 'button';
      wrapBtn.className = 'blog-codeblock-btn';
      wrapBtn.setAttribute('data-code-action', 'wrap');
      wrapBtn.setAttribute('data-wrap-label', codeWrapLabel);
      wrapBtn.setAttribute('data-unwrap-label', codeUnwrapLabel);
      wrapBtn.textContent = codeWrapLabel;

      actions.appendChild(copyBtn);
      actions.appendChild(wrapBtn);
      header.appendChild(langSpan);
      header.appendChild(actions);

      pre.classList.add('blog-codeblock-pre');
      pre.replaceWith(wrapper);
      wrapper.appendChild(header);
      wrapper.appendChild(pre);
    }

    return { html: doc.body.innerHTML, toc, embeds };
  }

  private hydrateEmbeds(
    embeds: Array<{ type: 'product' | 'category' | 'collection'; slug: string }>,
    revision: number,
    lang: string
  ): void {
    const html = this.bodyHtml();
    if (!html || !embeds.length) return;
    const deduped: Array<{ type: 'product' | 'category' | 'collection'; slug: string }> = [];
    const seen = new Set<string>();
    for (const embed of embeds) {
      const key = `${embed.type}:${embed.slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(embed);
    }

    const productSlugs = deduped.filter((e) => e.type === 'product').map((e) => e.slug);
    const categorySlugs = deduped.filter((e) => e.type === 'category').map((e) => e.slug);
    const collectionSlugs = deduped.filter((e) => e.type === 'collection').map((e) => e.slug);

    const productCalls: Record<string, any> = {};
    for (const slug of productSlugs) {
      productCalls[slug] = this.catalog.getProduct(slug).pipe(catchError(() => of(null)));
    }

    const req = forkJoin({
      products: Object.keys(productCalls).length ? forkJoin(productCalls) : of({}),
      categories: categorySlugs.length ? this.catalog.listCategories(lang as any).pipe(catchError(() => of([]))) : of([]),
      collections: collectionSlugs.length ? this.catalog.listFeaturedCollections().pipe(catchError(() => of([]))) : of([])
    });

    req.subscribe({
      next: ({ products, categories, collections }: { products: Record<string, Product | null>; categories: Category[]; collections: FeaturedCollection[] }) => {
        if (revision !== this.embedRevision) return;
        const nextHtml = this.applyEmbedData(html, { products, categories, collections });
        if (nextHtml !== html) {
          this.bodyHtml.set(nextHtml);
          this.measureReadingProgressSoon();
        }
      }
    });
  }

  private applyEmbedData(
    html: string,
    data: { products: Record<string, Product | null>; categories: Category[]; collections: FeaturedCollection[] }
  ): string {
    const w = this.document?.defaultView;
    if (!w?.DOMParser) return html;
    const doc = new w.DOMParser().parseFromString(html, 'text/html');
    const embeds = Array.from(doc.body.querySelectorAll('.blog-embed[data-embed-type][data-embed-slug]')) as HTMLElement[];
    if (!embeds.length) return html;

    const categoryBySlug = new Map<string, Category>();
    for (const c of data.categories || []) {
      if (c?.slug) categoryBySlug.set(c.slug, c);
    }
    const collectionBySlug = new Map<string, FeaturedCollection>();
    for (const c of data.collections || []) {
      if (c?.slug) collectionBySlug.set(c.slug, c);
    }

    const buildPrice = (product: Product): { primary: string; secondary?: string } => {
      const currency = product.currency || '';
      const base = typeof product.base_price === 'number' && Number.isFinite(product.base_price) ? product.base_price : 0;
      const sale = typeof product.sale_price === 'number' && Number.isFinite(product.sale_price) ? product.sale_price : null;
      if (sale !== null && sale < base) {
        return { primary: `${sale.toFixed(2)} ${currency}`, secondary: `${base.toFixed(2)} ${currency}` };
      }
      return { primary: `${base.toFixed(2)} ${currency}` };
    };

    const buildThumb = (src: string, alt: string): HTMLImageElement => {
      const img = doc.createElement('img');
      img.src = src;
      img.alt = alt;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.className = 'blog-embed-thumb';
      return img;
    };

    for (const el of embeds) {
      const type = (el.getAttribute('data-embed-type') || '').toLowerCase();
      const slug = (el.getAttribute('data-embed-slug') || '').trim();
      if (!type || !slug) continue;

      while (el.firstChild) el.removeChild(el.firstChild);

      if (type === 'product') {
        const product = data.products?.[slug] ?? null;
        if (!product) {
          el.textContent = this.translate.instant('blog.post.embed.notFoundProduct');
          continue;
        }
        const card = doc.createElement('a');
        card.href = `/products/${encodeURIComponent(product.slug)}`;
        card.setAttribute('data-router-link', `/products/${encodeURIComponent(product.slug)}`);
        card.className = 'blog-embed-card';

        const media = doc.createElement('div');
        media.className = 'blog-embed-media';
        const imgUrl = product.images?.[0]?.url || 'assets/placeholder/product-placeholder.svg';
        media.appendChild(buildThumb(imgUrl, product.name || 'Product'));

        const content = doc.createElement('div');
        content.className = 'blog-embed-content';
        const title = doc.createElement('div');
        title.className = 'blog-embed-title';
        title.textContent = product.name || product.slug;
        const price = buildPrice(product);
        const priceWrap = doc.createElement('div');
        priceWrap.className = 'blog-embed-price';
        const primary = doc.createElement('span');
        primary.textContent = price.primary;
        priceWrap.appendChild(primary);
        if (price.secondary) {
          const secondary = doc.createElement('span');
          secondary.className = 'blog-embed-price-secondary';
          secondary.textContent = price.secondary;
          priceWrap.appendChild(secondary);
        }

        content.appendChild(title);
        content.appendChild(priceWrap);
        const desc = (product.short_description || '').trim();
        if (desc) {
          const p = doc.createElement('p');
          p.className = 'blog-embed-desc';
          p.textContent = desc;
          content.appendChild(p);
        }
        card.appendChild(media);
        card.appendChild(content);
        el.appendChild(card);
        continue;
      }

      if (type === 'category') {
        const category = categoryBySlug.get(slug);
        if (!category) {
          el.textContent = this.translate.instant('blog.post.embed.notFoundCategory');
          continue;
        }
        const card = doc.createElement('a');
        card.href = `/shop/${encodeURIComponent(category.slug)}`;
        card.setAttribute('data-router-link', `/shop/${encodeURIComponent(category.slug)}`);
        card.className = 'blog-embed-card';

        const media = doc.createElement('div');
        media.className = 'blog-embed-media';
        const imgUrl = category.thumbnail_url || category.banner_url || 'assets/placeholder/product-placeholder.svg';
        media.appendChild(buildThumb(imgUrl, category.name || category.slug));

        const content = doc.createElement('div');
        content.className = 'blog-embed-content';
        const title = doc.createElement('div');
        title.className = 'blog-embed-title';
        title.textContent = category.name || category.slug;
        const kind = doc.createElement('div');
        kind.className = 'blog-embed-kind';
        kind.textContent = this.translate.instant('blog.post.embed.categoryLabel');
        content.appendChild(kind);
        content.appendChild(title);

        card.appendChild(media);
        card.appendChild(content);
        el.appendChild(card);
        continue;
      }

      if (type === 'collection') {
        const collection = collectionBySlug.get(slug);
        if (!collection) {
          el.textContent = this.translate.instant('blog.post.embed.notFoundCollection');
          continue;
        }

        const wrapper = doc.createElement('div');
        wrapper.className = 'blog-embed-collection';

        const header = doc.createElement('div');
        header.className = 'blog-embed-collection-header';
        const kind = doc.createElement('div');
        kind.className = 'blog-embed-kind';
        kind.textContent = this.translate.instant('blog.post.embed.collectionLabel');
        const title = doc.createElement('div');
        title.className = 'blog-embed-title';
        title.textContent = collection.name || collection.slug;
        header.appendChild(kind);
        header.appendChild(title);

        if (collection.description) {
          const desc = doc.createElement('p');
          desc.className = 'blog-embed-desc';
          desc.textContent = collection.description;
          header.appendChild(desc);
        }

        const grid = doc.createElement('div');
        grid.className = 'blog-embed-collection-grid';
        for (const product of (collection.products || []).slice(0, 6)) {
          const item = doc.createElement('a');
          item.href = `/products/${encodeURIComponent(product.slug)}`;
          item.setAttribute('data-router-link', `/products/${encodeURIComponent(product.slug)}`);
          item.className = 'blog-embed-collection-item';
          const imgUrl = product.images?.[0]?.url || 'assets/placeholder/product-placeholder.svg';
          item.appendChild(buildThumb(imgUrl, product.name || product.slug));
          const name = doc.createElement('span');
          name.className = 'blog-embed-collection-name';
          name.textContent = product.name || product.slug;
          item.appendChild(name);
          grid.appendChild(item);
        }

        wrapper.appendChild(header);
        wrapper.appendChild(grid);
        el.appendChild(wrapper);
      }
    }

    return doc.body.innerHTML;
  }

  private slugifyHeading(value: string): string {
    return (value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 80);
  }
}
