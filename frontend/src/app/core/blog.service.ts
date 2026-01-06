import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
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
  tags: string[];
  reading_time_minutes?: number | null;
}

export interface BlogPostListResponse {
  items: BlogPostListItem[];
  meta: PaginationMeta;
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
  tags?: string[];
  reading_time_minutes?: number | null;
}

export interface BlogCommentAuthor {
  id: string;
  name?: string | null;
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

  listPosts(params: { lang?: string; page?: number; limit?: number; q?: string; tag?: string }): Observable<BlogPostListResponse> {
    return this.api.get<BlogPostListResponse>('/blog/posts', {
      lang: params.lang,
      page: params.page ?? 1,
      limit: params.limit ?? 10,
      q: params.q,
      tag: params.tag
    });
  }

  getPost(slug: string, lang?: string): Observable<BlogPost> {
    return this.api.get<BlogPost>(`/blog/posts/${slug}`, { lang });
  }

  getPreviewPost(slug: string, token: string, lang?: string): Observable<BlogPost> {
    return this.api.get<BlogPost>(`/blog/posts/${slug}/preview`, { token, lang });
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
    });
  }

  createComment(slug: string, payload: { body: string; parent_id?: string | null }): Observable<BlogComment> {
    return this.api.post<BlogComment>(`/blog/posts/${slug}/comments`, payload);
  }

  deleteComment(commentId: string): Observable<void> {
    return this.api.delete<void>(`/blog/comments/${commentId}`);
  }

  flagComment(commentId: string, payload: { reason?: string | null }): Observable<BlogCommentFlag> {
    return this.api.post<BlogCommentFlag>(`/blog/comments/${commentId}/flag`, payload);
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
