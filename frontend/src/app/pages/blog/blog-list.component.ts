import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Subscription, combineLatest } from 'rxjs';
import { Meta, Title } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { BlogPostListItem, BlogService, PaginationMeta } from '../../core/blog.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';
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
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

	      <div class="flex items-center justify-between gap-4">
	        <div class="flex flex-wrap items-baseline gap-3">
	          <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'blog.title' | translate }}</h1>
	          <span
	            *ngIf="routeTag"
	            class="text-sm font-semibold rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200"
	          >
	            #{{ routeTag }}
	          </span>
	          <span
	            *ngIf="routeSeries"
	            class="text-sm font-semibold rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200"
	          >
	            {{ 'blog.seriesPill' | translate : { series: routeSeries } }}
	          </span>
	        </div>
	      </div>

      <div class="sticky top-24 z-30">
        <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
          <div class="grid gap-3 md:grid-cols-[1fr_240px_240px_240px_auto] items-end">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              <span>{{ 'blog.searchLabel' | translate }}</span>
              <input
                class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                [placeholder]="'blog.searchPlaceholder' | translate"
                name="blogSearch"
                [(ngModel)]="searchQuery"
                (keyup.enter)="applyFilters()"
              />
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              <span>{{ 'blog.tagLabel' | translate }}</span>
              <input
                class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                [placeholder]="'blog.tagPlaceholder' | translate"
                name="blogTag"
                [(ngModel)]="tagQuery"
                (keyup.enter)="applyFilters()"
              />
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              <span>{{ 'blog.seriesLabel' | translate }}</span>
              <input
                class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                [placeholder]="'blog.seriesPlaceholder' | translate"
                name="blogSeries"
                [(ngModel)]="seriesQuery"
                (keyup.enter)="applyFilters()"
              />
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              <span>{{ 'blog.sortLabel' | translate }}</span>
              <select
                name="blogSort"
                class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="sort"
                (change)="applySort()"
              >
                <option value="newest">{{ 'blog.sortNewest' | translate }}</option>
                <option value="oldest">{{ 'blog.sortOldest' | translate }}</option>
                <option value="most_viewed">{{ 'blog.sortMostViewed' | translate }}</option>
                <option value="most_commented">{{ 'blog.sortMostCommented' | translate }}</option>
              </select>
            </label>
            <div class="flex items-center justify-end gap-2">
              <app-button size="sm" [label]="'blog.searchCta' | translate" (action)="applyFilters()"></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'blog.clearFilters' | translate"
                [disabled]="!searchQuery.trim() && !tagQuery.trim() && !seriesQuery.trim()"
                (action)="clearFilters()"
              ></app-button>
            </div>
          </div>

          <div *ngIf="searchQuery.trim() || tagQuery.trim() || seriesQuery.trim()" class="flex flex-wrap gap-2">
            <button
              *ngIf="searchQuery.trim()"
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600"
              (click)="clearSearchChip()"
            >
              {{ 'blog.chipSearch' | translate : { q: searchQuery.trim() } }}
              <span aria-hidden="true">✕</span>
            </button>
            <button
              *ngIf="tagQuery.trim()"
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600"
              (click)="clearTagChip()"
            >
              {{ 'blog.chipTag' | translate : { tag: tagQuery.trim() } }}
              <span aria-hidden="true">✕</span>
            </button>
            <button
              *ngIf="seriesQuery.trim()"
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600"
              (click)="clearSeriesChip()"
            >
              {{ 'blog.chipSeries' | translate : { series: seriesQuery.trim() } }}
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>
      </div>

      <div *ngIf="loading()" class="grid gap-4">
        <app-skeleton *ngFor="let i of skeletons" height="200px"></app-skeleton>
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
        <ng-container *ngIf="hasActiveFilters(); else blogEmptyAllTpl">
          <p class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'blog.noResultsTitle' | translate }}</p>
          <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'blog.noResultsCopy' | translate }}</p>
          <div class="flex justify-center pt-2">
            <app-button size="sm" variant="ghost" [label]="'blog.clearFilters' | translate" (action)="clearFilters()"></app-button>
          </div>
        </ng-container>
        <ng-template #blogEmptyAllTpl>
          <p class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'blog.emptyTitle' | translate }}</p>
          <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'blog.emptyCopy' | translate }}</p>
        </ng-template>
      </div>

      <a
        *ngIf="!loading() && !hasError() && heroPost"
        class="group relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:shadow-none"
        [routerLink]="['/blog', heroPost.slug]"
        (mouseenter)="prefetchPost(heroPost.slug)"
        (focusin)="prefetchPost(heroPost.slug)"
      >
        <button
          *ngIf="canEditBlog()"
          type="button"
          class="absolute top-4 right-4 z-10 rounded-full border border-slate-200 bg-white/95 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-200 dark:hover:border-slate-600"
          (click)="editBlogPost($event, heroPost.slug)"
        >
          {{ 'blog.admin.edit' | translate }}
        </button>
        <div [ngClass]="heroPost.cover_image_url ? 'grid md:grid-cols-[1.35fr_1fr]' : 'grid'">
          <div
            *ngIf="heroPost.cover_image_url"
            class="relative min-h-[220px] md:min-h-[360px] bg-slate-100 dark:bg-slate-800"
          >
            <img
              *ngIf="thumbUrl(heroPost.cover_image_url) as thumb"
              [src]="thumb"
              [alt]="heroPost.title"
              class="absolute inset-0 h-full w-full object-cover blur-xl scale-110 opacity-80"
              [style.object-position]="focalPosition(heroPost.cover_focal_x, heroPost.cover_focal_y)"
              (error)="markThumbFailed(thumb)"
              loading="lazy"
              decoding="async"
            />
            <img
              [src]="heroPost.cover_image_url"
              [alt]="heroPost.title"
              class="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
              [style.object-position]="focalPosition(heroPost.cover_focal_x, heroPost.cover_focal_y)"
              [class.opacity-0]="!isImageLoaded(heroPost.cover_image_url)"
              (load)="markImageLoaded(heroPost.cover_image_url)"
              loading="lazy"
              decoding="async"
            />
          </div>
          <div class="p-6 md:p-8 grid gap-3">
            <p class="text-xs font-semibold tracking-wide uppercase text-indigo-600 dark:text-indigo-300">
              {{ 'blog.featuredLabel' | translate }}
            </p>
            <p class="text-sm text-slate-500 dark:text-slate-400" *ngIf="heroPost.published_at">
              {{ heroPost.published_at | date: 'mediumDate' }}
              <ng-container *ngIf="heroPost.reading_time_minutes">
                · {{ 'blog.minutesRead' | translate : { minutes: heroPost.reading_time_minutes } }}
              </ng-container>
              <ng-container *ngIf="heroPost.author_name">
                · {{ 'blog.byAuthor' | translate : { author: heroPost.author_name } }}
              </ng-container>
            </p>
            <button
              *ngIf="heroPost.series"
              type="button"
              class="justify-self-start text-xs font-semibold rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:border-slate-600"
              (click)="filterBySeries($event, heroPost.series!)"
            >
              {{ 'blog.seriesPill' | translate : { series: heroPost.series } }}
            </button>
            <h2 class="text-2xl md:text-3xl font-semibold text-slate-900 group-hover:text-indigo-600 dark:text-slate-50 dark:group-hover:text-indigo-300">
              {{ heroPost.title }}
            </h2>
            <p class="text-sm md:text-base text-slate-600 dark:text-slate-300 line-clamp-4">
              {{ heroPost.excerpt }}
            </p>
            <div class="flex flex-wrap gap-1 pt-1" *ngIf="heroPost.tags?.length">
              <button
                *ngFor="let tag of heroPost.tags"
                type="button"
                class="text-xs rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:border-slate-600"
                (click)="filterByTag($event, tag)"
              >
                #{{ tag }}
              </button>
            </div>
          </div>
        </div>
      </a>

      <div *ngIf="!loading() && !hasError() && gridPosts.length" class="grid gap-4">
        <a
          *ngFor="let post of gridPosts"
          class="group block"
          [routerLink]="['/blog', post.slug]"
          (mouseenter)="prefetchPost(post.slug)"
          (focusin)="prefetchPost(post.slug)"
        >
          <div class="h-full transition-transform duration-200 ease-out group-hover:-translate-y-0.5">
            <app-card class="h-full">
              <div class="relative">
                <button
                  *ngIf="canEditBlog()"
                  type="button"
                  class="absolute top-3 right-3 z-10 rounded-full border border-slate-200 bg-white/95 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-200 dark:hover:border-slate-600"
                  (click)="editBlogPost($event, post.slug)"
                >
                  {{ 'blog.admin.edit' | translate }}
                </button>

                <div class="grid gap-4 md:grid-cols-[240px_1fr] md:items-start">
                  <div class="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800">
                    <ng-container *ngIf="post.cover_image_url; else blogCoverPlaceholderTpl">
                      <img
                        *ngIf="thumbUrl(post.cover_image_url) as thumb"
                        [src]="thumb"
                        [alt]="post.title"
                        class="absolute inset-0 h-full w-full object-cover blur-xl scale-110 opacity-80"
                        [style.object-position]="focalPosition(post.cover_focal_x, post.cover_focal_y)"
                        (error)="markThumbFailed(thumb)"
                        loading="lazy"
                        decoding="async"
                      />
                      <img
                        [src]="post.cover_image_url"
                        [alt]="post.title"
                        class="relative w-full aspect-[16/9] object-cover transition-opacity duration-300"
                        [style.object-position]="focalPosition(post.cover_focal_x, post.cover_focal_y)"
                        [class.opacity-0]="!isImageLoaded(post.cover_image_url)"
                        (load)="markImageLoaded(post.cover_image_url)"
                        loading="lazy"
                        decoding="async"
                      />
                    </ng-container>
                    <ng-template #blogCoverPlaceholderTpl>
                      <div
                        class="aspect-[16/9] w-full grid place-items-center bg-gradient-to-br from-indigo-500/15 via-sky-500/10 to-fuchsia-500/15 text-slate-600 dark:text-slate-300"
                      >
                        <span class="text-xs font-semibold tracking-wide uppercase px-3 py-1 rounded-full border border-slate-200 bg-white/70 dark:border-slate-700 dark:bg-slate-900/60">
                          {{ 'blog.title' | translate }}
                        </span>
                      </div>
                    </ng-template>
                  </div>

                  <div class="grid gap-2 py-1">
                    <p class="text-sm text-slate-500 dark:text-slate-400" *ngIf="post.published_at">
                      {{ post.published_at | date: 'mediumDate' }}
                      <ng-container *ngIf="post.reading_time_minutes">
                        · {{ 'blog.minutesRead' | translate : { minutes: post.reading_time_minutes } }}
                      </ng-container>
                      <ng-container *ngIf="post.author_name">
                        · {{ 'blog.byAuthor' | translate : { author: post.author_name } }}
                      </ng-container>
                    </p>
                    <button
                      *ngIf="post.series"
                      type="button"
                      class="justify-self-start text-xs font-semibold rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:border-slate-600"
                      (click)="filterBySeries($event, post.series!)"
                    >
                      {{ 'blog.seriesPill' | translate : { series: post.series } }}
                    </button>
                    <h2 class="text-lg font-semibold text-slate-900 group-hover:text-indigo-600 dark:text-slate-50 dark:group-hover:text-indigo-300">
                      {{ post.title }}
                    </h2>
                    <p class="text-sm text-slate-600 dark:text-slate-300 line-clamp-3">
                      {{ post.excerpt }}
                    </p>
                    <div class="flex flex-wrap gap-1 pt-1" *ngIf="post.tags?.length">
                      <button
                        *ngFor="let tag of post.tags"
                        type="button"
                        class="text-xs rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:border-slate-600"
                        (click)="filterByTag($event, tag)"
                      >
                        #{{ tag }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </app-card>
          </div>
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
  heroPost: BlogPostListItem | null = null;
  gridPosts: BlogPostListItem[] = [];
  appliedTag: string | null = null;
  appliedSeries: string | null = null;
  routeTag: string | null = null;
  routeSeries: string | null = null;
  pageMeta: PaginationMeta | null = null;
  loading = signal<boolean>(true);
  hasError = signal<boolean>(false);
  skeletons = Array.from({ length: 6 });
  searchQuery = '';
  tagQuery = '';
  seriesQuery = '';
  sort: BlogSort = 'newest';
  private readonly loadedImages = new Set<string>();
  private readonly failedThumbs = new Set<string>();

  private sub?: Subscription;
  private langSub?: Subscription;
  private canonicalEl?: HTMLLinkElement;
  private document: Document = inject(DOCUMENT);

  constructor(
    private blog: BlogService,
    private route: ActivatedRoute,
    private router: Router,
    private storefrontAdminMode: StorefrontAdminModeService,
    private translate: TranslateService,
    private title: Title,
    private meta: Meta
  ) {}

  ngOnInit(): void {
    this.sub = combineLatest([this.route.params, this.route.queryParams]).subscribe(([routeParams, queryParams]) =>
      this.loadFromRoute(routeParams, queryParams)
    );
    this.langSub = this.translate.onLangChange.subscribe(() => this.load());
    this.setMetaTags();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.langSub?.unsubscribe();
  }

  private setMetaTags(): void {
    const title = this.routeSeries
      ? this.translate.instant('blog.seriesMetaTitle', { series: this.routeSeries })
      : this.routeTag
        ? this.translate.instant('blog.tagMetaTitle', { tag: this.routeTag })
        : this.translate.instant('blog.metaTitle');
    const description = this.routeSeries
      ? this.translate.instant('blog.seriesMetaDescription', { series: this.routeSeries })
      : this.routeTag
        ? this.translate.instant('blog.tagMetaDescription', { tag: this.routeTag })
        : this.translate.instant('blog.metaDescription');
    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
  }

  private loadFromRoute(routeParams: Params, queryParams: Params): void {
    const page = queryParams['page'] ? Number(queryParams['page']) : 1;
    this.searchQuery = typeof queryParams['q'] === 'string' ? queryParams['q'] : '';
    const routeTag = typeof routeParams['tag'] === 'string' ? routeParams['tag'] : '';
    const routeSeries = typeof routeParams['series'] === 'string' ? routeParams['series'] : '';
    const queryTag = typeof queryParams['tag'] === 'string' ? queryParams['tag'] : '';
    const querySeries = typeof queryParams['series'] === 'string' ? queryParams['series'] : '';
    this.routeSeries = routeSeries.trim() ? routeSeries.trim() : null;
    this.routeTag = !this.routeSeries && routeTag.trim() ? routeTag.trim() : null;

    if (this.routeSeries) {
      this.seriesQuery = this.routeSeries;
      this.tagQuery = '';
    } else if (this.routeTag) {
      this.tagQuery = this.routeTag;
      this.seriesQuery = '';
    } else {
      const legacySeries = (querySeries || '').trim();
      const legacyTag = (queryTag || '').trim();
      this.seriesQuery = legacySeries;
      this.tagQuery = legacySeries ? '' : legacyTag;
    }

    this.appliedTag = this.tagQuery.trim() ? this.tagQuery.trim() : null;
    this.appliedSeries = this.seriesQuery.trim() ? this.seriesQuery.trim() : null;
    this.crumbs =
      this.appliedSeries && this.routeSeries
        ? [
            { label: 'nav.home', url: '/' },
            { label: 'nav.blog', url: '/blog' },
            { label: this.appliedSeries }
          ]
        : this.appliedTag && this.routeTag
          ? [
              { label: 'nav.home', url: '/' },
              { label: 'nav.blog', url: '/blog' },
              { label: `#${this.appliedTag}` }
            ]
        : [
            { label: 'nav.home', url: '/' },
            { label: 'nav.blog' }
          ];

    const querySort = typeof queryParams['sort'] === 'string' ? queryParams['sort'] : null;
    const nextSort = this.normalizeSort(querySort) ?? this.loadSavedSort() ?? 'newest';
    this.sort = nextSort;
    this.saveSort(nextSort);
    this.load(page);
  }

  load(page = 1): void {
    this.loading.set(true);
    this.hasError.set(false);
    this.heroPost = null;
    this.gridPosts = [];
    this.setCanonical(page);
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    this.blog
      .listPosts({
        lang,
        page,
        limit: 9,
        q: this.searchQuery.trim() || undefined,
        tag: this.tagQuery.trim() || undefined,
        series: this.seriesQuery.trim() || undefined,
        sort: this.sort
      })
      .subscribe({
      next: (resp) => {
        this.posts = resp.items;
        const hasFilters = Boolean(this.searchQuery.trim() || this.tagQuery.trim() || this.seriesQuery.trim());
        const canShowHero = !hasFilters && resp.meta.page === 1 && this.sort === 'newest' && resp.items.length > 0;
        if (canShowHero) {
          this.heroPost = resp.items[0];
          this.gridPosts = resp.items.slice(1);
        } else {
          this.heroPost = null;
          this.gridPosts = resp.items;
        }
        this.pageMeta = resp.meta;
        this.loading.set(false);
        this.hasError.set(false);
        this.setMetaTags();
      },
      error: () => {
        this.posts = [];
        this.heroPost = null;
        this.gridPosts = [];
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

  applyFilters(): void {
    const q = this.searchQuery.trim() || undefined;
    const tag = this.tagQuery.trim();
    const series = this.seriesQuery.trim();
    const sort = this.sort !== 'newest' ? this.sort : undefined;
    if (series) {
      this.tagQuery = '';
      void this.router.navigate(['/blog/series', series], {
        queryParams: { q, sort, page: undefined },
        queryParamsHandling: 'merge'
      });
      return;
    }
    if (tag) {
      this.seriesQuery = '';
      void this.router.navigate(['/blog/tag', tag], {
        queryParams: { q, sort, page: undefined },
        queryParamsHandling: 'merge'
      });
      return;
    }
    void this.router.navigate(['/blog'], { queryParams: { q, sort, page: undefined }, queryParamsHandling: 'merge' });
  }

  clearFilters(): void {
    this.searchQuery = '';
    this.tagQuery = '';
    this.seriesQuery = '';
    void this.router.navigate(['/blog'], { queryParams: { q: undefined, tag: undefined, series: undefined, sort: undefined, page: undefined }, queryParamsHandling: 'merge' });
  }

  clearSearchChip(): void {
    if (!this.searchQuery.trim()) return;
    this.searchQuery = '';
    this.applyFilters();
  }

  clearTagChip(): void {
    if (!this.tagQuery.trim()) return;
    this.tagQuery = '';
    this.applyFilters();
  }

  clearSeriesChip(): void {
    if (!this.seriesQuery.trim()) return;
    this.seriesQuery = '';
    this.applyFilters();
  }

  applySort(): void {
    const normalized = this.normalizeSort(this.sort) ?? 'newest';
    this.sort = normalized;
    this.saveSort(normalized);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { sort: normalized !== 'newest' ? normalized : undefined, page: undefined },
      queryParamsHandling: 'merge'
    });
  }

  filterByTag(event: MouseEvent, tag: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.tagQuery = tag;
    this.seriesQuery = '';
    this.applyFilters();
  }

  filterBySeries(event: MouseEvent, series: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.seriesQuery = series;
    this.tagQuery = '';
    this.applyFilters();
  }

  prefetchPost(slug: string): void {
    const cleaned = (slug || '').trim();
    if (!cleaned) return;
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    this.blog.prefetchPost(cleaned, lang);
  }

  private setCanonical(page: number): void {
    if (typeof window === 'undefined' || !this.document) return;
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    const qs = new URLSearchParams({ lang });
    if (page > 1) qs.set('page', String(page));
    const q = this.searchQuery.trim();
    const tag = this.tagQuery.trim();
    const series = this.seriesQuery.trim();
    const sort = this.sort;
    if (q) qs.set('q', q);
    if (!this.routeTag && !this.routeSeries && tag) qs.set('tag', tag);
    if (!this.routeTag && !this.routeSeries && series) qs.set('series', series);
    if (sort && sort !== 'newest') qs.set('sort', sort);
    const base = this.routeSeries
      ? `/blog/series/${encodeURIComponent(this.routeSeries)}`
      : this.routeTag
        ? `/blog/tag/${encodeURIComponent(this.routeTag)}`
        : '/blog';
    const href = `${window.location.origin}${base}?${qs.toString()}`;
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

  private normalizeSort(value: unknown): BlogSort | null {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    if (v === 'newest' || v === 'oldest' || v === 'most_viewed' || v === 'most_commented') return v;
    return null;
  }

  private loadSavedSort(): BlogSort | null {
    const w = this.document?.defaultView;
    if (!w?.localStorage) return null;
    return this.normalizeSort(w.localStorage.getItem('blog_sort'));
  }

  private saveSort(value: BlogSort): void {
    const w = this.document?.defaultView;
    if (!w?.localStorage) return;
    w.localStorage.setItem('blog_sort', value);
  }

  markImageLoaded(src: string | null | undefined): void {
    if (!src) return;
    this.loadedImages.add(src);
  }

  isImageLoaded(src: string | null | undefined): boolean {
    if (!src) return true;
    return this.loadedImages.has(src);
  }

  thumbUrl(src: string | null | undefined): string | null {
    const raw = String(src || '').trim();
    if (!raw || !raw.startsWith('/media/')) return null;
    const base = raw.split('?')[0].split('#')[0];
    const dot = base.lastIndexOf('.');
    const slash = base.lastIndexOf('/');
    if (dot <= slash) return null;
    const thumb = `${base.slice(0, dot)}-sm${base.slice(dot)}`;
    if (this.failedThumbs.has(thumb)) return null;
    return thumb;
  }

  markThumbFailed(src: string | null | undefined): void {
    const raw = String(src || '').trim();
    if (!raw) return;
    const base = raw.split('?')[0].split('#')[0];
    this.failedThumbs.add(base);
  }

  hasActiveFilters(): boolean {
    return Boolean(this.searchQuery.trim() || this.tagQuery.trim() || this.seriesQuery.trim());
  }

  canEditBlog(): boolean {
    return this.storefrontAdminMode.enabled();
  }

  focalPosition(focalX?: number | null, focalY?: number | null): string {
    const x = Math.max(0, Math.min(100, Math.round(Number(focalX ?? 50))));
    const y = Math.max(0, Math.min(100, Math.round(Number(focalY ?? 50))));
    return `${x}% ${y}%`;
  }

  editBlogPost(event: Event, slug: string): void {
    event.preventDefault();
    event.stopPropagation();
    const desired = String(slug || '').trim();
    if (!desired) return;
    void this.router.navigate(['/admin/content/blog'], { queryParams: { edit: desired } });
  }
}

type BlogSort = 'newest' | 'oldest' | 'most_viewed' | 'most_commented';
