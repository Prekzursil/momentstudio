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
}

export interface BlogPostListResponse {
  items: BlogPostListItem[];
  meta: PaginationMeta;
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
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  author: BlogCommentAuthor;
}

export interface BlogCommentListResponse {
  items: BlogComment[];
  meta: PaginationMeta;
}

@Injectable({ providedIn: 'root' })
export class BlogService {
  constructor(private api: ApiService) {}

  listPosts(params: { lang?: string; page?: number; limit?: number }): Observable<BlogPostListResponse> {
    return this.api.get<BlogPostListResponse>('/blog/posts', {
      lang: params.lang,
      page: params.page ?? 1,
      limit: params.limit ?? 10
    });
  }

  getPost(slug: string, lang?: string): Observable<BlogPost> {
    return this.api.get<BlogPost>(`/blog/posts/${slug}`, { lang });
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
}
