import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { AdminPaginationMeta } from './admin-orders.service';

export interface AdminProductListItem {
  id: string;
  slug: string;
  deleted_slug?: string | null;
  sku: string;
  name: string;
  base_price: number;
  sale_type?: 'percent' | 'amount' | null;
  sale_value?: number | null;
  currency: string;
  status: string;
  is_active: boolean;
  is_featured: boolean;
  stock_quantity: number;
  category_slug: string;
  category_name: string;
  updated_at: string;
  deleted_at?: string | null;
  publish_at?: string | null;
  publish_scheduled_for?: string | null;
  unpublish_scheduled_for?: string | null;
}

export interface AdminProductListResponse {
  items: AdminProductListItem[];
  meta: AdminPaginationMeta;
}

export interface AdminProductDuplicateMatch {
  id: string;
  slug: string;
  sku: string;
  name: string;
  status: string;
  is_active: boolean;
}

export interface AdminProductDuplicateCheckResponse {
  slug_base?: string | null;
  suggested_slug?: string | null;
  slug_matches: AdminProductDuplicateMatch[];
  sku_matches: AdminProductDuplicateMatch[];
  name_matches: AdminProductDuplicateMatch[];
}

@Injectable({ providedIn: 'root' })
export class AdminProductsService {
  constructor(private api: ApiService) {}

  search(params: {
    q?: string;
    status?: string;
    category_slug?: string;
    deleted?: boolean;
    page?: number;
    limit?: number;
  }): Observable<AdminProductListResponse> {
    return this.api.get<AdminProductListResponse>('/admin/dashboard/products/search', params as any);
  }

  restore(productId: string): Observable<AdminProductListItem> {
    return this.api.post<AdminProductListItem>(`/admin/dashboard/products/${productId}/restore`, {});
  }

  byIds(ids: string[]): Observable<AdminProductListItem[]> {
    return this.api.post<AdminProductListItem[]>('/admin/dashboard/products/by-ids', { ids });
  }

  duplicateCheck(params: {
    name?: string;
    sku?: string;
    exclude_slug?: string;
  }): Observable<AdminProductDuplicateCheckResponse> {
    return this.api.get<AdminProductDuplicateCheckResponse>('/admin/dashboard/products/duplicate-check', params as any);
  }
}
