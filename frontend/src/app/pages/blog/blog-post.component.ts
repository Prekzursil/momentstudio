import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { Subscription, combineLatest } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { appConfig } from '../../core/app-config';
import { AuthService } from '../../core/auth.service';
import { MarkdownService } from '../../core/markdown.service';
import { ToastService } from '../../core/toast.service';
import { BlogComment, BlogPost, BlogPostListItem, BlogService } from '../../core/blog.service';
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
    <div
      *ngIf="post()"
      class="fixed left-0 right-0 top-0 z-[110] h-1 bg-transparent"
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
            <div #articleContent class="grid gap-6">
              <img
                *ngIf="post()!.cover_image_url"
                [src]="post()!.cover_image_url"
                [alt]="post()!.title"
                class="w-full aspect-[16/9] rounded-2xl border border-slate-200 bg-slate-50 object-cover dark:border-slate-800 dark:bg-slate-800"
                loading="lazy"
              />
              <div class="mx-auto w-full max-w-[72ch]">
                <div class="markdown blog-markdown text-slate-700 dark:text-slate-200" [innerHTML]="bodyHtml()"></div>
              </div>
              <div class="mx-auto w-full max-w-[72ch]">
                <a
                  routerLink="/blog"
                  class="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
                >
                  ← {{ 'blog.post.backToBlog' | translate }}
                </a>
              </div>
            </div>
          </app-card>

          <aside *ngIf="toc().length > 1" class="hidden lg:block lg:sticky lg:top-24">
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

      <section *ngIf="neighbors().previous || neighbors().next" class="grid gap-3">
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

      <section *ngIf="relatedPosts().length" class="grid gap-3">
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

    <button
      *ngIf="showBackToTop()"
      type="button"
      class="fixed bottom-6 right-6 z-50 h-11 w-11 rounded-full bg-slate-900 text-white shadow-soft hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
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
  private scrollListener = () => this.updateReadingProgress();
  private resizeListener = () => this.measureReadingProgressSoon();

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
        this.loadComments();
      },
      error: () => {
        this.post.set(null);
        this.bodyHtml.set('');
        this.toc.set([]);
        this.activeHeadingId.set(null);
        this.neighbors.set({ previous: null, next: null });
        this.relatedPosts.set([]);
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

  private renderPostBody(markdown: string): { html: string; toc: Array<{ id: string; title: string; level: 2 | 3 }> } {
    const html = this.markdown.render(markdown || '');
    const w = this.document?.defaultView;
    if (!w?.DOMParser) return { html, toc: [] };

    const parser = new w.DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const headings = Array.from(doc.body.querySelectorAll('h2, h3')) as HTMLElement[];

    const toc: Array<{ id: string; title: string; level: 2 | 3 }> = [];
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

    return { html: doc.body.innerHTML, toc };
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
