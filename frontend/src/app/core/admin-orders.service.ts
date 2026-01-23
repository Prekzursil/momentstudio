import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';
import { Address, Order, OrderItem, ReceiptShareToken } from './account.service';
import { parseMoney } from '../shared/money';

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

export interface AdminOrderRefund {
  id: string;
  amount: number;
  currency: string;
  provider: string;
  provider_refund_id?: string | null;
  note?: string | null;
  created_at: string;
  data?: Record<string, unknown> | null;
}

export interface AdminOrderDetail extends Order {
  payment_retry_count?: number;
  stripe_payment_intent_id?: string | null;
  customer_email?: string | null;
  customer_username?: string | null;
  shipping_address?: Address | null;
  billing_address?: Address | null;
  tracking_url?: string | null;
  shipping_label_filename?: string | null;
  shipping_label_uploaded_at?: string | null;
  has_shipping_label?: boolean;
  events?: AdminOrderEvent[];
  refunds?: AdminOrderRefund[];
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
    return this.api.get<AdminOrderListResponse>('/orders/admin/search', params as any).pipe(
      map((res: any) => ({
        ...(res ?? {}),
        items: (res?.items ?? []).map((o: any) => ({
          ...o,
          total_amount: parseMoney(o?.total_amount)
        }))
      }))
    );
  }

  get(orderId: string): Observable<AdminOrderDetail> {
    return this.api.get<AdminOrderDetail>(`/orders/admin/${orderId}`).pipe(
      map((o: any) => ({
        ...o,
        total_amount: parseMoney(o?.total_amount),
        tax_amount: parseMoney(o?.tax_amount),
        fee_amount: parseMoney(o?.fee_amount),
        shipping_amount: parseMoney(o?.shipping_amount),
        refunds: (o?.refunds ?? []).map((r: any) => ({
          ...r,
          amount: parseMoney(r?.amount)
        })),
        items: (o?.items ?? []).map((it: any) => ({
          ...it,
          unit_price: parseMoney(it?.unit_price),
          subtotal: parseMoney(it?.subtotal)
        }))
      }))
    );
  }

  update(
    orderId: string,
    payload: {
      status?: string;
      cancel_reason?: string | null;
      courier?: string | null;
      tracking_number?: string | null;
      tracking_url?: string | null;
    }
  ): Observable<AdminOrderDetail> {
    return this.api.patch<AdminOrderDetail>(`/orders/admin/${orderId}`, payload).pipe(
      map((o: any) => ({
        ...o,
        total_amount: parseMoney(o?.total_amount),
        tax_amount: parseMoney(o?.tax_amount),
        fee_amount: parseMoney(o?.fee_amount),
        shipping_amount: parseMoney(o?.shipping_amount),
        refunds: (o?.refunds ?? []).map((r: any) => ({
          ...r,
          amount: parseMoney(r?.amount)
        })),
        items: (o?.items ?? []).map((it: any) => ({
          ...it,
          unit_price: parseMoney(it?.unit_price),
          subtotal: parseMoney(it?.subtotal)
        }))
      }))
    );
  }

  uploadShippingLabel(orderId: string, file: File): Observable<AdminOrderDetail> {
    const data = new FormData();
    data.append('file', file);
    return this.api.post<AdminOrderDetail>(`/orders/admin/${orderId}/shipping-label`, data);
  }

  downloadShippingLabel(orderId: string, opts?: { action?: 'download' | 'print' }): Observable<Blob> {
    const action = opts?.action;
    const params = action && action !== 'download' ? { action } : undefined;
    return this.api.getBlob(`/orders/admin/${orderId}/shipping-label`, params);
  }

  deleteShippingLabel(orderId: string): Observable<void> {
    return this.api.delete<void>(`/orders/admin/${orderId}/shipping-label`);
  }

  retryPayment(orderId: string): Observable<Order> {
    return this.api.post<Order>(`/orders/admin/${orderId}/retry-payment`, {});
  }

  capturePayment(orderId: string): Observable<Order> {
    return this.api.post<Order>(`/orders/admin/${orderId}/capture-payment`, {});
  }

  voidPayment(orderId: string): Observable<Order> {
    return this.api.post<Order>(`/orders/admin/${orderId}/void-payment`, {});
  }

  requestRefund(orderId: string, note?: string | null): Observable<Order> {
    const suffix = note ? `?note=${encodeURIComponent(note)}` : '';
    return this.api.post<Order>(`/orders/admin/${orderId}/refund${suffix}`, {});
  }

  createPartialRefund(
    orderId: string,
    payload: {
      amount: string;
      note: string;
      items?: Array<{ order_item_id: string; quantity: number }>;
      process_payment?: boolean;
    }
  ): Observable<AdminOrderDetail> {
    return this.api.post<AdminOrderDetail>(`/orders/admin/${orderId}/refunds`, payload).pipe(
      map((o: any) => ({
        ...o,
        total_amount: parseMoney(o?.total_amount),
        tax_amount: parseMoney(o?.tax_amount),
        fee_amount: parseMoney(o?.fee_amount),
        shipping_amount: parseMoney(o?.shipping_amount),
        refunds: (o?.refunds ?? []).map((r: any) => ({
          ...r,
          amount: parseMoney(r?.amount)
        })),
        items: (o?.items ?? []).map((it: any) => ({
          ...it,
          unit_price: parseMoney(it?.unit_price),
          subtotal: parseMoney(it?.subtotal)
        }))
      }))
    );
  }

  sendDeliveryEmail(orderId: string): Observable<Order> {
    return this.api.post<Order>(`/orders/admin/${orderId}/delivery-email`, {});
  }

  downloadPackingSlip(orderId: string): Observable<Blob> {
    return this.api.getBlob(`/orders/admin/${orderId}/packing-slip`);
  }

  downloadBatchPackingSlips(orderIds: string[]): Observable<Blob> {
    return this.api.postBlob('/orders/admin/batch/packing-slips', { order_ids: orderIds });
  }

  downloadExport(): Observable<Blob> {
    return this.api.getBlob('/orders/admin/export');
  }

  resendOrderConfirmationEmail(orderId: string, note?: string | null): Observable<Order> {
    return this.api.post<Order>(`/orders/admin/${orderId}/confirmation-email`, { note: note ?? null });
  }

  resendDeliveryEmail(orderId: string, note?: string | null): Observable<Order> {
    return this.api.post<Order>(`/orders/admin/${orderId}/delivery-email`, { note: note ?? null });
  }

  shareReceipt(orderId: string): Observable<ReceiptShareToken> {
    return this.api.post<ReceiptShareToken>(`/orders/${orderId}/receipt/share`, {});
  }

  revokeReceiptShare(orderId: string): Observable<ReceiptShareToken> {
    return this.api.post<ReceiptShareToken>(`/orders/${orderId}/receipt/revoke`, {});
  }
}
