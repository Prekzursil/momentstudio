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
}
