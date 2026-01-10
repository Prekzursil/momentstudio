import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Address, Order, OrderItem } from './account.service';

export interface AdminPaginationMeta {
  total_items: number;
  total_pages: number;
  page: number;
  limit: number;
}

export interface AdminOrderListItem {
  id: string;
  reference_code?: string | null;
  status: string;
  total_amount: number;
  currency: string;
  created_at: string;
  customer_email?: string | null;
  customer_username?: string | null;
}

export interface AdminOrderListResponse {
  items: AdminOrderListItem[];
  meta: AdminPaginationMeta;
}

export interface AdminOrderEvent {
  id: string;
  event: string;
  note?: string | null;
  created_at: string;
}

export interface AdminOrderDetail extends Order {
  payment_retry_count?: number;
  stripe_payment_intent_id?: string | null;
  customer_email?: string | null;
  customer_username?: string | null;
  shipping_address?: Address | null;
  billing_address?: Address | null;
  events?: AdminOrderEvent[];
  items: OrderItem[];
}

@Injectable({ providedIn: 'root' })
export class AdminOrdersService {
  constructor(private api: ApiService) {}

  search(params: {
    q?: string;
    status?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Observable<AdminOrderListResponse> {
    return this.api.get<AdminOrderListResponse>('/orders/admin/search', params as any);
  }

  get(orderId: string): Observable<AdminOrderDetail> {
    return this.api.get<AdminOrderDetail>(`/orders/admin/${orderId}`);
  }

  update(orderId: string, payload: { status?: string; tracking_number?: string | null }): Observable<AdminOrderDetail> {
    return this.api.patch<AdminOrderDetail>(`/orders/admin/${orderId}`, payload);
  }

  downloadExport(): Observable<Blob> {
    return this.api.getBlob('/orders/admin/export');
  }
}

