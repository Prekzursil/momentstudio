import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { Meta, Title } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { BlogPostListItem, BlogService, PaginationMeta } from '../../core/blog.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { CardComponent } from '../../shared/card.component';
import { ContainerComponent } from '../../layout/container.component';
import { SkeletonComponent } from '../../shared/skeleton.component';

@Component({
  selector: 'app-blog-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    TranslateModule,
    ContainerComponent,
    BreadcrumbComponent,
    CardComponent,
    ButtonComponent,
    SkeletonComponent
  ],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div class="flex items-center justify-between gap-4">
        <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'blog.title' | translate }}</h1>
      </div>

      <div *ngIf="loading()" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <app-skeleton *ngFor="let i of skeletons" height="240px"></app-skeleton>
      </div>

      <div
        *ngIf="!loading() && hasError()"
        class="border border-amber-200 bg-amber-50 rounded-2xl p-6 text-center grid gap-2 dark:border-amber-900/40 dark:bg-amber-950/30"
      >
        <p class="text-lg font-semibold text-amber-900 dark:text-amber-100">{{ 'blog.errorTitle' | translate }}</p>
        <p class="text-sm text-amber-800 dark:text-amber-200">{{ 'blog.errorCopy' | translate }}</p>
        <div class="flex justify-center">
          <app-button [label]="'blog.retry' | translate" size="sm" (action)="load()"></app-button>
        </div>
      </div>

      <div
        *ngIf="!loading() && !hasError() && posts.length === 0"
        class="border border-dashed border-slate-200 rounded-2xl p-10 text-center grid gap-2 dark:border-slate-800"
      >
        <p class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'blog.emptyTitle' | translate }}</p>
        <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'blog.emptyCopy' | translate }}</p>
      </div>

      <div *ngIf="!loading() && !hasError() && posts.length" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <a
          *ngFor="let post of posts"
          class="group"
          [routerLink]="['/blog', post.slug]"
        >
          <app-card class="h-full">
            <div class="grid gap-3">
              <img
                *ngIf="post.cover_image_url"
                [src]="post.cover_image_url"
                [alt]="post.title"
                class="w-full h-40 rounded-xl object-cover border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800"
                loading="lazy"
              />
              <div class="grid gap-1">
                <p class="text-sm text-slate-500 dark:text-slate-400" *ngIf="post.published_at">
                  {{ post.published_at | date: 'mediumDate' }}
                </p>
                <h2 class="text-lg font-semibold text-slate-900 group-hover:text-indigo-600 dark:text-slate-50 dark:group-hover:text-indigo-300">
                  {{ post.title }}
                </h2>
                <p class="text-sm text-slate-600 dark:text-slate-300">
                  {{ post.excerpt }}
                </p>
              </div>
            </div>
          </app-card>
        </a>
      </div>

      <div *ngIf="pageMeta" class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
        <div>
          {{ 'blog.pageMeta' | translate : { page: pageMeta.page, totalPages: pageMeta.total_pages, totalItems: pageMeta.total_items } }}
        </div>
        <div class="flex gap-2">
          <app-button [label]="'blog.prev' | translate" size="sm" variant="ghost" [disabled]="pageMeta.page <= 1" (action)="changePage(-1)">
          </app-button>
          <app-button
            [label]="'blog.next' | translate"
            size="sm"
            variant="ghost"
            [disabled]="pageMeta.page >= pageMeta.total_pages"
            (action)="changePage(1)"
          >
          </app-button>
        </div>
      </div>
    </app-container>
  `
})
export class BlogListComponent implements OnInit, OnDestroy {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.blog' }
  ];

  posts: BlogPostListItem[] = [];
  pageMeta: PaginationMeta | null = null;
  loading = signal<boolean>(true);
  hasError = signal<boolean>(false);
  skeletons = Array.from({ length: 6 });

  private sub?: Subscription;
  private langSub?: Subscription;

  constructor(
    private blog: BlogService,
    private route: ActivatedRoute,
    private router: Router,
    private translate: TranslateService,
    private title: Title,
    private meta: Meta
  ) {}

  ngOnInit(): void {
    this.sub = this.route.queryParams.subscribe((params) => this.loadFromQuery(params));
    this.langSub = this.translate.onLangChange.subscribe(() => this.load());
    this.setMetaTags();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.langSub?.unsubscribe();
  }

  private setMetaTags(): void {
    const title = this.translate.instant('blog.metaTitle');
    const description = this.translate.instant('blog.metaDescription');
    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
  }

  private loadFromQuery(params: Params): void {
    const page = params['page'] ? Number(params['page']) : 1;
    this.load(page);
  }

  load(page = 1): void {
    this.loading.set(true);
    this.hasError.set(false);
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    this.blog.listPosts({ lang, page, limit: 9 }).subscribe({
      next: (resp) => {
        this.posts = resp.items;
        this.pageMeta = resp.meta;
        this.loading.set(false);
        this.hasError.set(false);
        this.setMetaTags();
      },
      error: () => {
        this.posts = [];
        this.pageMeta = null;
        this.loading.set(false);
        this.hasError.set(true);
        this.setMetaTags();
      }
    });
  }

  changePage(delta: number): void {
    if (!this.pageMeta) return;
    const next = Math.min(Math.max(1, this.pageMeta.page + delta), this.pageMeta.total_pages);
    const queryParams: Params = { page: next !== 1 ? next : undefined };
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
