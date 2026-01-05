import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
        <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'blog.title' | translate }}</h1>
      </div>

      <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div class="grid gap-3 md:grid-cols-[1fr_240px_auto] items-end">
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
          <div class="flex items-center justify-end gap-2">
            <app-button size="sm" [label]="'blog.searchCta' | translate" (action)="applyFilters()"></app-button>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'blog.clearFilters' | translate"
              [disabled]="!searchQuery.trim() && !tagQuery.trim()"
              (action)="clearFilters()"
            ></app-button>
          </div>
        </div>
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
                  <ng-container *ngIf="post.reading_time_minutes"> · {{ 'blog.minutesRead' | translate : { minutes: post.reading_time_minutes } }}</ng-container>
                </p>
                <h2 class="text-lg font-semibold text-slate-900 group-hover:text-indigo-600 dark:text-slate-50 dark:group-hover:text-indigo-300">
                  {{ post.title }}
                </h2>
                <p class="text-sm text-slate-600 dark:text-slate-300">
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
  searchQuery = '';
  tagQuery = '';

  private sub?: Subscription;
  private langSub?: Subscription;
  private canonicalEl?: HTMLLinkElement;
  private document: Document = inject(DOCUMENT);

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
    this.searchQuery = typeof params['q'] === 'string' ? params['q'] : '';
    this.tagQuery = typeof params['tag'] === 'string' ? params['tag'] : '';
    this.load(page);
  }

  load(page = 1): void {
    this.loading.set(true);
    this.hasError.set(false);
    this.setCanonical(page);
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    this.blog.listPosts({ lang, page, limit: 9, q: this.searchQuery.trim() || undefined, tag: this.tagQuery.trim() || undefined }).subscribe({
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

  applyFilters(): void {
    const q = this.searchQuery.trim() || undefined;
    const tag = this.tagQuery.trim() || undefined;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q, tag, page: undefined },
      queryParamsHandling: 'merge'
    });
  }

  clearFilters(): void {
    this.searchQuery = '';
    this.tagQuery = '';
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: undefined, tag: undefined, page: undefined },
      queryParamsHandling: 'merge'
    });
  }

  filterByTag(event: MouseEvent, tag: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.tagQuery = tag;
    this.applyFilters();
  }

  private setCanonical(page: number): void {
    if (typeof window === 'undefined' || !this.document) return;
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    const qs = new URLSearchParams({ lang });
    if (page > 1) qs.set('page', String(page));
    const q = this.searchQuery.trim();
    const tag = this.tagQuery.trim();
    if (q) qs.set('q', q);
    if (tag) qs.set('tag', tag);
    const href = `${window.location.origin}/blog?${qs.toString()}`;
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
