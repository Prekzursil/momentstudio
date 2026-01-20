import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';
import { AuthUser } from './auth.service';
import { parseMoney } from '../shared/money';

export interface Address {
  id: string;
  label?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postal_code: string;
  country: string;
  is_default_shipping: boolean;
  is_default_billing: boolean;
}

export interface OrderItem {
  id: string;
  product_id: string;
  variant_id?: string | null;
  product?: { id: string; slug: string; name: string } | null;
  quantity: number;
  shipped_quantity?: number;
  unit_price: number;
  subtotal: number;
}

export interface Order {
  id: string;
  reference_code?: string | null;
  status: string;
  cancel_reason?: string | null;
  payment_method?: string;
  paypal_capture_id?: string | null;
  stripe_payment_intent_id?: string | null;
  payment_retry_count?: number;
  total_amount: number;
  tax_amount?: number;
  fee_amount?: number;
  shipping_amount?: number;
  currency: string;
  courier?: string | null;
  delivery_type?: string | null;
  locker_id?: string | null;
  locker_name?: string | null;
  locker_address?: string | null;
  locker_lat?: number | null;
  locker_lng?: number | null;
  tracking_number?: string | null;
  shipping_method?: { id: string; name: string } | null;
  shipping_address_id?: string | null;
  billing_address_id?: string | null;
  created_at: string;
  updated_at: string;
  events?: Array<{ id: string; event: string; note?: string | null; created_at: string }>;
  items: OrderItem[];
}

export interface OrderPaginationMeta {
  total_items: number;
  total_pages: number;
  page: number;
  limit: number;
  pending_count: number;
}

export interface OrderListResponse {
  items: Order[];
  meta: OrderPaginationMeta;
}

export type ReturnRequestStatus = 'requested' | 'approved' | 'rejected' | 'received' | 'refunded' | 'closed';

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
  status: ReturnRequestStatus;
  reason: string;
  customer_message?: string | null;
  created_at: string;
  updated_at: string;
  items: ReturnRequestItemRead[];
}

export interface AddressCreateRequest {
  label?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postal_code: string;
  country: string;
  is_default_shipping?: boolean;
  is_default_billing?: boolean;
}

export interface AccountDeletionStatus {
  requested_at?: string | null;
  scheduled_for?: string | null;
  deleted_at?: string | null;
  cooldown_hours: number;
}

export interface ReceiptShareToken {
  token: string;
  receipt_url: string;
  receipt_pdf_url: string;
  expires_at: string;
}

@Injectable({ providedIn: 'root' })
export class AccountService {
  constructor(private api: ApiService) {}

  private normalizeOrder(order: any): Order {
    return {
      ...order,
      total_amount: parseMoney(order?.total_amount),
      tax_amount: parseMoney(order?.tax_amount),
      fee_amount: parseMoney(order?.fee_amount),
      shipping_amount: parseMoney(order?.shipping_amount),
      items: (order?.items ?? []).map((it: any) => ({
        ...it,
        unit_price: parseMoney(it?.unit_price),
        subtotal: parseMoney(it?.subtotal)
      }))
    };
  }

  getProfile(): Observable<AuthUser> {
    return this.api.get<AuthUser>('/auth/me');
  }

  getAddresses(): Observable<Address[]> {
    return this.api.get<Address[]>('/me/addresses');
  }

  getOrders(): Observable<Order[]> {
    return this.api.get<Order[]>('/orders').pipe(map((orders: any[]) => (orders ?? []).map((o) => this.normalizeOrder(o))));
  }

  getOrdersPage(params: {
    q?: string;
    status?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Observable<OrderListResponse> {
    return this.api.get<any>('/orders/me', params).pipe(
      map((resp) => {
        const metaRaw = resp?.meta ?? {};
        const totalItems = Number(metaRaw?.total_items);
        const totalPages = Number(metaRaw?.total_pages);
        const page = Number(metaRaw?.page);
        const limit = Number(metaRaw?.limit);
        const pending = Number(metaRaw?.pending_count);
        return {
          items: (resp?.items ?? []).map((o: any) => this.normalizeOrder(o)),
          meta: {
            total_items: Number.isFinite(totalItems) ? totalItems : 0,
            total_pages: Number.isFinite(totalPages) ? totalPages : 1,
            page: Number.isFinite(page) ? page : 1,
            limit: Number.isFinite(limit) ? limit : Number(params?.limit ?? 10) || 10,
            pending_count: Number.isFinite(pending) ? pending : 0
          }
        } satisfies OrderListResponse;
      })
    );
  }

  createReturnRequest(payload: {
    order_id: string;
    reason: string;
    customer_message?: string | null;
    items: Array<{ order_item_id: string; quantity: number }>;
  }): Observable<ReturnRequestRead> {
    return this.api.post<ReturnRequestRead>('/returns', payload as any);
  }

  downloadExport(): Observable<Blob> {
    return this.api.getBlob('/auth/me/export');
  }

  getDeletionStatus(): Observable<AccountDeletionStatus> {
    return this.api.get<AccountDeletionStatus>('/auth/me/delete/status');
  }

  requestAccountDeletion(confirm: string): Observable<AccountDeletionStatus> {
    return this.api.post<AccountDeletionStatus>('/auth/me/delete', { confirm });
  }

  cancelAccountDeletion(): Observable<AccountDeletionStatus> {
    return this.api.post<AccountDeletionStatus>('/auth/me/delete/cancel', {});
  }

  reorderOrder(orderId: string): Observable<unknown> {
    return this.api.post(`/orders/${orderId}/reorder`, {});
  }

  requestOrderCancellation(orderId: string, reason: string): Observable<Order> {
    return this.api
      .post<any>(`/orders/${orderId}/cancel-request`, { reason })
      .pipe(map((order) => this.normalizeOrder(order)));
  }

  downloadReceipt(orderId: string): Observable<Blob> {
    return this.api.getBlob(`/orders/${orderId}/receipt`);
  }

  shareReceipt(orderId: string): Observable<ReceiptShareToken> {
    return this.api.post<ReceiptShareToken>(`/orders/${orderId}/receipt/share`, {});
  }

  revokeReceiptShare(orderId: string): Observable<ReceiptShareToken> {
    return this.api.post<ReceiptShareToken>(`/orders/${orderId}/receipt/revoke`, {});
  }

  createAddress(payload: AddressCreateRequest): Observable<Address> {
    return this.api.post<Address>('/me/addresses', payload);
  }

  updateAddress(id: string, payload: Partial<AddressCreateRequest>): Observable<Address> {
    return this.api.patch<Address>(`/me/addresses/${id}`, payload);
  }

  deleteAddress(id: string): Observable<void> {
    return this.api.delete<void>(`/me/addresses/${id}`);
  }
}
