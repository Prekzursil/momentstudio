import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { Subscription, combineLatest } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { appConfig } from '../../core/app-config';
import { AuthService } from '../../core/auth.service';
import { MarkdownService } from '../../core/markdown.service';
import { ToastService } from '../../core/toast.service';
import { BlogComment, BlogPost, BlogService } from '../../core/blog.service';
import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { CardComponent } from '../../shared/card.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { formatIdentity } from '../../shared/user-identity';

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
        <app-card>
          <div class="grid gap-6">
            <img
              *ngIf="post()!.cover_image_url"
              [src]="post()!.cover_image_url"
              [alt]="post()!.title"
              class="w-full rounded-2xl border border-slate-200 bg-slate-50 object-cover dark:border-slate-800 dark:bg-slate-800"
              loading="lazy"
            />
            <div class="markdown text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="bodyHtml()"></div>
            <a routerLink="/blog" class="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200">
              ← {{ 'blog.post.backToBlog' | translate }}
            </a>
          </div>
        </app-card>
      </div>

      <section class="grid gap-3">
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

  comments = signal<BlogComment[]>([]);
  loadingComments = signal<boolean>(true);
  hasCommentsError = signal<boolean>(false);
  commentSkeletons = Array.from({ length: 3 });

  commentBody = '';
  submitting = signal<boolean>(false);
  replyTo = signal<BlogComment | null>(null);
  isPreview = signal<boolean>(false);

  private slug = '';
  private previewToken = '';
  private langSub?: Subscription;
  private routeSub?: Subscription;
  private canonicalEl?: HTMLLinkElement;
  private document: Document = inject(DOCUMENT);

  constructor(
    private blog: BlogService,
    private route: ActivatedRoute,
    private translate: TranslateService,
    private title: Title,
    private meta: Meta,
    private toast: ToastService,
    private markdown: MarkdownService,
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
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
    this.routeSub?.unsubscribe();
  }

  load(): void {
    if (!this.slug) return;
    this.loadingPost.set(true);
    this.hasPostError.set(false);
    this.post.set(null);
    this.setCanonical();

    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    const req = this.previewToken
      ? this.blog.getPreviewPost(this.slug, this.previewToken, lang)
      : this.blog.getPost(this.slug, lang);
    req.subscribe({
      next: (post) => {
        this.post.set(post);
        this.bodyHtml.set(this.markdown.render(post.body_markdown));
        this.loadingPost.set(false);
        this.hasPostError.set(false);
        this.crumbs = [
          { label: 'nav.home', url: '/' },
          { label: 'nav.blog', url: '/blog' },
          { label: post.title }
        ];
        this.setMetaTags(post);
        this.loadComments();
      },
      error: () => {
        this.post.set(null);
        this.bodyHtml.set('');
        this.loadingPost.set(false);
        this.hasPostError.set(true);
        this.setErrorMetaTags();
        this.comments.set([]);
      }
    });
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
}
