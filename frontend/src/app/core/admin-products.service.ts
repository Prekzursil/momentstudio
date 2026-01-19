import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { AdminPaginationMeta } from './admin-orders.service';

export interface AdminProductListItem {
  id: string;
  slug: string;
  sku: string;
  name: string;
  base_price: number;
  currency: string;
  status: string;
  is_active: boolean;
  is_featured: boolean;
  stock_quantity: number;
  category_slug: string;
  category_name: string;
  updated_at: string;
  publish_at?: string | null;
}

export interface AdminProductListResponse {
  items: AdminProductListItem[];
  meta: AdminPaginationMeta;
}

@Injectable({ providedIn: 'root' })
export class AdminProductsService {
  constructor(private api: ApiService) {}

  search(params: {
    q?: string;
    status?: string;
    category_slug?: string;
    page?: number;
    limit?: number;
  }): Observable<AdminProductListResponse> {
    return this.api.get<AdminProductListResponse>('/admin/dashboard/products/search', params as any);
  }

  byIds(ids: string[]): Observable<AdminProductListItem[]> {
    return this.api.post<AdminProductListItem[]>('/admin/dashboard/products/by-ids', { ids });
  }
}
