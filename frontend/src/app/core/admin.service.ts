import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface AdminSummary {
  products: number;
  orders: number;
  users: number;
  low_stock: number;
  sales_30d: number;
  orders_30d: number;
}

export interface AdminProduct {
  id: string;
  slug: string;
  name: string;
  price: number;
  currency: string;
  status: string;
  category: string;
  stock_quantity: number;
}

export interface AdminOrder {
  id: string;
  status: string;
  total_amount: number;
  currency: string;
  created_at: string;
  customer: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  created_at: string;
}

export interface AdminContent {
  id: string;
  key: string;
  title: string;
  updated_at: string;
  version: number;
  body_markdown?: string;
  status?: string;
}

export interface AdminCoupon {
  id: string;
  code: string;
  percentage_off?: number | null;
  amount_off?: number | null;
  currency?: string | null;
  expires_at?: string | null;
  active: boolean;
  times_used: number;
  max_uses?: number | null;
}

export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  sort_order?: number;
}

export interface AdminProductDetail extends AdminProduct {
  short_description?: string | null;
  long_description?: string | null;
  category_id?: string | null;
  stock_quantity: number;
  images?: { id: string; url: string; alt_text?: string | null }[];
}

export interface AdminAudit {
  products: AdminAuditItem[];
  content: AdminAuditItem[];
}

export interface AdminAuditItem {
  id: string;
  product_id?: string;
  block_id?: string;
  action: string;
  version?: number;
  user_id?: string | null;
  created_at: string;
}

export interface LowStockItem {
  id: string;
  name: string;
  stock_quantity: number;
  sku: string;
  slug: string;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  constructor(private api: ApiService) {}

  summary(): Observable<AdminSummary> {
    return this.api.get<AdminSummary>('/admin/dashboard/summary');
  }

  products(): Observable<AdminProduct[]> {
    return this.api.get<AdminProduct[]>('/admin/dashboard/products');
  }

  orders(): Observable<AdminOrder[]> {
    return this.api.get<AdminOrder[]>('/admin/dashboard/orders');
  }

  users(): Observable<AdminUser[]> {
    return this.api.get<AdminUser[]>('/admin/dashboard/users');
  }

  content(): Observable<AdminContent[]> {
    return this.api.get<AdminContent[]>('/admin/dashboard/content');
  }

  updateContent(key: string, payload: Partial<AdminContent>): Observable<AdminContent> {
    return this.api.patch<AdminContent>(`/content/admin/${key}`, payload);
  }

  coupons(): Observable<AdminCoupon[]> {
    return this.api.get<AdminCoupon[]>('/admin/dashboard/coupons');
  }

  audit(): Observable<AdminAudit> {
    return this.api.get<AdminAudit>('/admin/dashboard/audit');
  }

  revokeSessions(userId: string): Observable<void> {
    return this.api.post<void>(`/admin/dashboard/sessions/${userId}/revoke`, {});
  }

  lowStock(): Observable<LowStockItem[]> {
    return this.api.get<LowStockItem[]>('/admin/dashboard/low-stock');
  }

  updateOrderStatus(orderId: string, status: string): Observable<AdminOrder> {
    return this.api.patch<AdminOrder>(`/orders/admin/${orderId}`, { status });
  }

  bulkUpdateProducts(payload: { slug: string; status?: string }[]): Observable<AdminProduct[]> {
    return this.api.post<AdminProduct[]>('/catalog/products/bulk-update', payload);
  }

  getCategories(): Observable<AdminCategory[]> {
    return this.api.get<AdminCategory[]>('/catalog/categories');
  }

  createCategory(payload: Partial<AdminCategory>): Observable<AdminCategory> {
    return this.api.post<AdminCategory>('/catalog/categories', payload);
  }

  deleteCategory(slug: string): Observable<AdminCategory> {
    return this.api.delete<AdminCategory>(`/catalog/categories/${slug}`);
  }

  reorderCategories(items: { slug: string; sort_order: number }[]): Observable<AdminCategory[]> {
    return this.api.post<AdminCategory[]>('/catalog/categories/reorder', items);
  }

  getProduct(slug: string): Observable<AdminProductDetail> {
    return this.api.get<AdminProductDetail>(`/catalog/products/${slug}`);
  }

  createProduct(payload: Partial<AdminProductDetail>): Observable<AdminProductDetail> {
    return this.api.post<AdminProductDetail>('/catalog/products', payload);
  }

  updateProduct(slug: string, payload: Partial<AdminProductDetail>): Observable<AdminProductDetail> {
    return this.api.patch<AdminProductDetail>(`/catalog/products/${slug}`, payload);
  }

  deleteProduct(slug: string): Observable<void> {
    return this.api.delete<void>(`/catalog/products/${slug}`);
  }

  createCoupon(payload: Partial<AdminCoupon>): Observable<AdminCoupon> {
    return this.api.post<AdminCoupon>('/admin/dashboard/coupons', payload);
  }

  updateCoupon(id: string, payload: Partial<AdminCoupon>): Observable<AdminCoupon> {
    return this.api.patch<AdminCoupon>(`/admin/dashboard/coupons/${id}`, payload);
  }

  uploadProductImage(slug: string, file: File): Observable<AdminProductDetail> {
    const form = new FormData();
    form.append('file', file);
    return this.api.post<AdminProductDetail>(`/catalog/products/${slug}/images`, form);
  }

  deleteProductImage(slug: string, imageId: string): Observable<AdminProductDetail> {
    return this.api.delete<AdminProductDetail>(`/catalog/products/${slug}/images/${imageId}`);
  }

  reorderProductImage(slug: string, imageId: string, sortOrder: number): Observable<AdminProductDetail> {
    return this.api.patch<AdminProductDetail>(
      `/catalog/products/${slug}/images/${imageId}/sort?sort_order=${sortOrder}`,
      {}
    );
  }

  updateUserRole(userId: string, role: string): Observable<AdminUser> {
    return this.api.patch<AdminUser>(`/admin/dashboard/users/${userId}/role`, { role });
  }

  getMaintenance(): Observable<{ enabled: boolean }> {
    return this.api.get<{ enabled: boolean }>('/admin/dashboard/maintenance');
  }

  setMaintenance(enabled: boolean): Observable<{ enabled: boolean }> {
    return this.api.post<{ enabled: boolean }>('/admin/dashboard/maintenance', { enabled });
  }
}
