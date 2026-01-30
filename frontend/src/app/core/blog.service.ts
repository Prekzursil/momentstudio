import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, shareReplay } from 'rxjs/operators';
import { ApiService } from './api.service';

export interface PaginationMeta {
  total_items: number;
  total_pages: number;
  page: number;
  limit: number;
}

export interface BlogPostListItem {
  slug: string;
  title: string;
  excerpt: string;
  published_at?: string | null;
  cover_image_url?: string | null;
  cover_focal_x?: number | null;
  cover_focal_y?: number | null;
  tags: string[];
  series?: string | null;
  author_name?: string | null;
  reading_time_minutes?: number | null;
}

export interface BlogPostListResponse {
  items: BlogPostListItem[];
  meta: PaginationMeta;
}

export interface BlogPostNeighbors {
  previous?: BlogPostListItem | null;
  next?: BlogPostListItem | null;
}

export interface BlogPreviewTokenResponse {
  token: string;
  expires_at: string;
  url: string;
}

export interface BlogPostImage {
  id: string;
  url: string;
  alt_text?: string | null;
  sort_order: number;
}

export interface BlogPost {
  slug: string;
  title: string;
  body_markdown: string;
  published_at?: string | null;
  created_at: string;
  updated_at: string;
  images: BlogPostImage[];
  meta?: Record<string, unknown> | null;
  summary?: string | null;
  cover_image_url?: string | null;
  cover_focal_x?: number | null;
  cover_focal_y?: number | null;
  tags?: string[];
  series?: string | null;
  author?: BlogCommentAuthor | null;
  author_name?: string | null;
  reading_time_minutes?: number | null;
}

export interface BlogCommentAuthor {
  id: string;
  name?: string | null;
  name_tag?: number | null;
  username?: string | null;
  avatar_url?: string | null;
}

export interface BlogComment {
  id: string;
  parent_id?: string | null;
  body: string;
  is_deleted: boolean;
  is_hidden?: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  hidden_at?: string | null;
  author: BlogCommentAuthor;
}

export interface BlogCommentListResponse {
  items: BlogComment[];
  meta: PaginationMeta;
}

export type BlogCommentSort = 'newest' | 'oldest' | 'top';

export interface BlogCommentThread {
  root: BlogComment;
  replies: BlogComment[];
}

export interface BlogCommentThreadListResponse {
  items: BlogCommentThread[];
  meta: PaginationMeta;
  total_comments: number;
}

export interface BlogCommentSubscriptionResponse {
  enabled: boolean;
}

export interface BlogCommentFlag {
  id: string;
  user_id: string;
  reason?: string | null;
  created_at: string;
}

export interface AdminBlogComment {
  id: string;
  content_block_id: string;
  post_slug: string;
  parent_id?: string | null;
  body: string;
  is_deleted: boolean;
  deleted_at?: string | null;
  deleted_by?: string | null;
  is_hidden: boolean;
  hidden_at?: string | null;
  hidden_by?: string | null;
  hidden_reason?: string | null;
  created_at: string;
  updated_at: string;
  author: BlogCommentAuthor;
  flag_count: number;
  flags: BlogCommentFlag[];
}

export interface AdminBlogCommentListResponse {
  items: AdminBlogComment[];
  meta: PaginationMeta;
}

export interface BlogMyCommentParentContext {
  id: string;
  author_name?: string | null;
  snippet: string;
}

export interface BlogMyCommentLastReplyContext {
  id: string;
  author_name?: string | null;
  snippet: string;
  created_at: string;
}

export interface BlogMyComment {
  id: string;
  post_slug: string;
  post_title: string;
  parent_id?: string | null;
  body: string;
  status: 'posted' | 'hidden' | 'deleted' | string;
  created_at: string;
  updated_at: string;
  reply_count: number;
  parent?: BlogMyCommentParentContext | null;
  last_reply?: BlogMyCommentLastReplyContext | null;
}

export interface BlogMyCommentListResponse {
  items: BlogMyComment[];
  meta: PaginationMeta;
}

@Injectable({ providedIn: 'root' })
export class BlogService {
  constructor(private api: ApiService) {}

  private readonly cache = new Map<string, { expires_at: number; value$: Observable<any> }>();
  private readonly ttlMs = {
    list: 2 * 60 * 1000,
    post: 10 * 60 * 1000,
    neighbors: 10 * 60 * 1000
  };

  private cached<T>(key: string, ttlMs: number, factory: () => Observable<T>): Observable<T> {
    const now = Date.now();
    const existing = this.cache.get(key);
    if (existing && existing.expires_at > now) return existing.value$ as Observable<T>;

    const value$ = factory().pipe(
      shareReplay({ bufferSize: 1, refCount: false }),
      catchError((err) => {
        this.cache.delete(key);
        return throwError(() => err);
      })
    );
    this.cache.set(key, { expires_at: now + ttlMs, value$ });

    if (this.cache.size > 200) {
      for (const [k, entry] of this.cache.entries()) {
        if (entry.expires_at <= now) this.cache.delete(k);
      }
    }

    return value$;
  }

  private listCacheKey(params: {
    lang?: string;
    page?: number;
    limit?: number;
    q?: string;
    tag?: string;
    series?: string;
    author_id?: string;
    sort?: string;
  }): string {
    const normalized = {
      lang: (params.lang || '').trim(),
      page: params.page ?? 1,
      limit: params.limit ?? 10,
      q: (params.q || '').trim(),
      tag: (params.tag || '').trim(),
      series: (params.series || '').trim(),
      author_id: (params.author_id || '').trim(),
      sort: (params.sort || '').trim()
    };
    return `blog:list:${JSON.stringify(normalized)}`;
  }

  listPosts(params: {
    lang?: string;
    page?: number;
    limit?: number;
    q?: string;
    tag?: string;
    series?: string;
    author_id?: string;
    sort?: string;
  }): Observable<BlogPostListResponse> {
    const key = this.listCacheKey(params);
    return this.cached(key, this.ttlMs.list, () =>
      this.api.get<BlogPostListResponse>('/blog/posts', {
        lang: params.lang,
        page: params.page ?? 1,
        limit: params.limit ?? 10,
        q: params.q,
        tag: params.tag,
        series: params.series,
        author_id: params.author_id,
        sort: params.sort
      })
    );
  }

  getPost(slug: string, lang?: string): Observable<BlogPost> {
    const key = `blog:post:${slug}:${(lang || '').trim()}`;
    return this.cached(key, this.ttlMs.post, () => this.api.get<BlogPost>(`/blog/posts/${slug}`, { lang }));
  }

  getNeighbors(slug: string, lang?: string): Observable<BlogPostNeighbors> {
    const key = `blog:neighbors:${slug}:${(lang || '').trim()}`;
    return this.cached(key, this.ttlMs.neighbors, () => this.api.get<BlogPostNeighbors>(`/blog/posts/${slug}/neighbors`, { lang }));
  }

  getPreviewPost(slug: string, token: string, lang?: string): Observable<BlogPost> {
    return this.api.get<BlogPost>(`/blog/posts/${slug}/preview`, { token, lang });
  }

  prefetchPost(slug: string, lang?: string): void {
    this.getPost(slug, lang).subscribe({ error: () => {} });
    this.getNeighbors(slug, lang).subscribe({ error: () => {} });
  }

  createPreviewToken(
    slug: string,
    params: { lang?: string; expires_minutes?: number } = {}
  ): Observable<BlogPreviewTokenResponse> {
    const qs = new URLSearchParams();
    if (params.lang) qs.set('lang', params.lang);
    if (params.expires_minutes) qs.set('expires_minutes', String(params.expires_minutes));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.api.post<BlogPreviewTokenResponse>(`/blog/posts/${slug}/preview-token${suffix}`, {});
  }

  listComments(slug: string, params: { page?: number; limit?: number } = {}): Observable<BlogCommentListResponse> {
    return this.api.get<BlogCommentListResponse>(`/blog/posts/${slug}/comments`, {
      page: params.page ?? 1,
      limit: params.limit ?? 50
    }, { 'X-Silent': '1' });
  }

  listCommentThreads(
    slug: string,
    params: { page?: number; limit?: number; sort?: BlogCommentSort } = {}
  ): Observable<BlogCommentThreadListResponse> {
    return this.api.get<BlogCommentThreadListResponse>(`/blog/posts/${slug}/comment-threads`, {
      sort: params.sort ?? 'newest',
      page: params.page ?? 1,
      limit: params.limit ?? 10
    }, { 'X-Silent': '1' });
  }

  getCommentSubscription(slug: string): Observable<BlogCommentSubscriptionResponse> {
    return this.api.get<BlogCommentSubscriptionResponse>(`/blog/posts/${slug}/comment-subscription`, {}, { 'X-Silent': '1' });
  }

  setCommentSubscription(slug: string, enabled: boolean): Observable<BlogCommentSubscriptionResponse> {
    return this.api.put<BlogCommentSubscriptionResponse>(`/blog/posts/${slug}/comment-subscription`, { enabled }, { 'X-Silent': '1' });
  }

  createComment(slug: string, payload: { body: string; parent_id?: string | null; captcha_token?: string | null }): Observable<BlogComment> {
    return this.api.post<BlogComment>(`/blog/posts/${slug}/comments`, payload, { 'X-Silent': '1' });
  }

  deleteComment(commentId: string): Observable<void> {
    return this.api.delete<void>(`/blog/comments/${commentId}`, { 'X-Silent': '1' });
  }

  flagComment(commentId: string, payload: { reason?: string | null }): Observable<BlogCommentFlag> {
    return this.api.post<BlogCommentFlag>(`/blog/comments/${commentId}/flag`, payload, { 'X-Silent': '1' });
  }

  listFlaggedComments(params: { page?: number; limit?: number } = {}): Observable<AdminBlogCommentListResponse> {
    return this.api.get<AdminBlogCommentListResponse>('/blog/admin/comments/flagged', {
      page: params.page ?? 1,
      limit: params.limit ?? 20
    });
  }

  listMyComments(params: { lang?: string; page?: number; limit?: number } = {}): Observable<BlogMyCommentListResponse> {
    return this.api.get<BlogMyCommentListResponse>('/blog/me/comments', {
      lang: params.lang,
      page: params.page ?? 1,
      limit: params.limit ?? 20
    });
  }

  hideCommentAdmin(commentId: string, payload: { reason?: string | null } = {}): Observable<AdminBlogComment> {
    return this.api.post<AdminBlogComment>(`/blog/admin/comments/${commentId}/hide`, payload);
  }

  unhideCommentAdmin(commentId: string): Observable<AdminBlogComment> {
    return this.api.post<AdminBlogComment>(`/blog/admin/comments/${commentId}/unhide`, {});
  }

  resolveCommentFlagsAdmin(commentId: string): Observable<{ resolved: number }> {
    return this.api.post<{ resolved: number }>(`/blog/admin/comments/${commentId}/resolve-flags`, {});
  }
}
