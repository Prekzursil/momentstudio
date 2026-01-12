import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { AdminPaginationMeta } from './admin-orders.service';

export type ReturnRequestStatus = 'requested' | 'approved' | 'rejected' | 'received' | 'refunded' | 'closed';

export interface ReturnRequestListItem {
  id: string;
  order_id: string;
  order_reference?: string | null;
  customer_email?: string | null;
  customer_name?: string | null;
  status: ReturnRequestStatus;
  created_at: string;
}

export interface ReturnRequestItemRead {
  id: string;
  order_item_id?: string | null;
  quantity: number;
  product_id?: string | null;
  product_name?: string | null;
}

export interface ReturnRequestRead {
  id: string;
  order_id: string;
  order_reference?: string | null;
  customer_email?: string | null;
  customer_name?: string | null;
  user_id?: string | null;
  status: ReturnRequestStatus;
  reason: string;
  customer_message?: string | null;
  admin_note?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  items: ReturnRequestItemRead[];
}

export interface ReturnRequestListResponse {
  items: ReturnRequestListItem[];
  meta: AdminPaginationMeta;
}

export interface ReturnRequestUpdatePayload {
  status?: ReturnRequestStatus | null;
  admin_note?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AdminReturnsService {
  constructor(private api: ApiService) {}

  search(params: {
    q?: string;
    status_filter?: ReturnRequestStatus;
    order_id?: string;
    page?: number;
    limit?: number;
  }): Observable<ReturnRequestListResponse> {
    return this.api.get<ReturnRequestListResponse>('/returns/admin', params as any);
  }

  get(returnId: string): Observable<ReturnRequestRead> {
    return this.api.get<ReturnRequestRead>(`/returns/admin/${returnId}`);
  }

  update(returnId: string, payload: ReturnRequestUpdatePayload): Observable<ReturnRequestRead> {
    return this.api.patch<ReturnRequestRead>(`/returns/admin/${returnId}`, payload);
  }

  listByOrder(orderId: string): Observable<ReturnRequestRead[]> {
    return this.api.get<ReturnRequestRead[]>(`/returns/admin/by-order/${orderId}`);
  }

  create(payload: {
    order_id: string;
    reason: string;
    customer_message?: string | null;
    items: Array<{ order_item_id: string; quantity: number }>;
  }): Observable<ReturnRequestRead> {
    return this.api.post<ReturnRequestRead>('/returns/admin', payload as any);
  }
}

