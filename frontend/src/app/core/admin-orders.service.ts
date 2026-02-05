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
  payment_method?: string | null;
  created_at: string;
  customer_email?: string | null;
  customer_username?: string | null;
  tags?: string[];
  sla_kind?: 'accept' | 'ship' | string | null;
  sla_started_at?: string | null;
  sla_due_at?: string | null;
  sla_overdue?: boolean;
  fraud_flagged?: boolean;
  fraud_severity?: 'low' | 'medium' | 'high' | string | null;
}

export interface AdminOrderListResponse {
  items: AdminOrderListItem[];
  meta: AdminPaginationMeta;
}

export interface AdminOrderTagStat {
  tag: string;
  count: number;
}

export interface AdminOrderTagRenameResult {
  from_tag: string;
  to_tag: string;
  updated: number;
  merged: number;
  total: number;
}

export type OrderDocumentExportKind = 'packing_slip' | 'packing_slips_batch' | 'shipping_label' | 'receipt';

export interface AdminOrderDocumentExport {
  id: string;
  kind: OrderDocumentExportKind;
  filename: string;
  mime_type: string;
  created_at: string;
  expires_at?: string | null;
  order_id?: string | null;
  order_reference?: string | null;
  order_count?: number;
}

export interface AdminOrderDocumentExportListResponse {
  items: AdminOrderDocumentExport[];
  meta: AdminPaginationMeta;
}

export interface AdminOrderEvent {
  id: string;
  event: string;
  note?: string | null;
  data?: Record<string, unknown> | null;
  created_at: string;
}

export interface AdminOrderEmailEvent {
  id: string;
  to_email: string;
  subject: string;
  status: 'sent' | 'failed' | string;
  error_message?: string | null;
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

export interface AdminOrderNoteActor {
  id: string;
  email: string;
  username?: string | null;
}

export interface AdminOrderNote {
  id: string;
  note: string;
  created_at: string;
  actor?: AdminOrderNoteActor | null;
}

export interface AdminOrderFraudSignal {
  code: string;
  severity: 'info' | 'low' | 'medium' | 'high';
  data?: Record<string, unknown> | null;
}

export interface AdminOrderShipment {
  id: string;
  order_id: string;
  courier?: string | null;
  tracking_number: string;
  tracking_url?: string | null;
  created_at: string;
}

export interface AdminOrderDetail extends Order {
  user_id?: string | null;
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
  admin_notes?: AdminOrderNote[];
  tags?: string[];
  fraud_signals?: AdminOrderFraudSignal[];
  shipments?: AdminOrderShipment[];
  items: OrderItem[];
}

@Injectable({ providedIn: 'root' })
export class AdminOrdersService {
  constructor(private api: ApiService) {}

  search(params: {
    q?: string;
    user_id?: string;
    status?: string;
    tag?: string;
    sla?: string;
    fraud?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    include_pii?: boolean;
    include_test?: boolean;
  }): Observable<AdminOrderListResponse> {
    const finalParams = { ...params, include_pii: params.include_pii ?? true };
    return this.api.get<AdminOrderListResponse>('/orders/admin/search', finalParams as any).pipe(
      map((res: any) => ({
        ...(res ?? {}),
        items: (res?.items ?? []).map((o: any) => ({
          ...o,
          total_amount: parseMoney(o?.total_amount),
          tags: Array.isArray(o?.tags) ? o.tags : []
        }))
      }))
    );
  }

  get(orderId: string, opts?: { include_pii?: boolean }): Observable<AdminOrderDetail> {
    const params = { include_pii: opts?.include_pii ?? true };
    return this.api.get<AdminOrderDetail>(`/orders/admin/${orderId}`, params as any).pipe(
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
        admin_notes: o?.admin_notes ?? [],
        fraud_signals: Array.isArray(o?.fraud_signals) ? o.fraud_signals : [],
        shipments: Array.isArray(o?.shipments) ? o.shipments : [],
        items: (o?.items ?? []).map((it: any) => ({
          ...it,
          unit_price: parseMoney(it?.unit_price),
          subtotal: parseMoney(it?.subtotal)
        }))
      }))
    );
  }

  listEmailEvents(
    orderId: string,
    params?: { limit?: number; since_hours?: number; include_pii?: boolean }
  ): Observable<AdminOrderEmailEvent[]> {
    const finalParams = { ...params, include_pii: params?.include_pii ?? true };
    return this.api.get<AdminOrderEmailEvent[]>(`/orders/admin/${orderId}/email-events`, finalParams as any).pipe(
      map((rows: any) => (Array.isArray(rows) ? rows : []))
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
    },
    opts?: { include_pii?: boolean }
  ): Observable<AdminOrderDetail> {
    const params = { include_pii: opts?.include_pii ?? true };
    return this.api.patch<AdminOrderDetail>(`/orders/admin/${orderId}`, payload, undefined, params as any).pipe(
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
        admin_notes: o?.admin_notes ?? [],
        fraud_signals: Array.isArray(o?.fraud_signals) ? o.fraud_signals : [],
        shipments: Array.isArray(o?.shipments) ? o.shipments : [],
        items: (o?.items ?? []).map((it: any) => ({
          ...it,
          unit_price: parseMoney(it?.unit_price),
          subtotal: parseMoney(it?.subtotal)
        }))
      }))
    );
  }

  reviewFraud(
    orderId: string,
    payload: { decision: 'approve' | 'deny'; note?: string | null },
    opts?: { include_pii?: boolean }
  ): Observable<AdminOrderDetail> {
    const params = { include_pii: opts?.include_pii ?? true };
    return this.api.post<AdminOrderDetail>(`/orders/admin/${orderId}/fraud-review`, payload, undefined, params as any).pipe(
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
        admin_notes: o?.admin_notes ?? [],
        fraud_signals: Array.isArray(o?.fraud_signals) ? o.fraud_signals : [],
        shipments: Array.isArray(o?.shipments) ? o.shipments : [],
        items: (o?.items ?? []).map((it: any) => ({
          ...it,
          unit_price: parseMoney(it?.unit_price),
          subtotal: parseMoney(it?.subtotal)
        }))
      }))
    );
  }

  updateAddresses(
    orderId: string,
    payload: {
      shipping_address?: Partial<Address> | null;
      billing_address?: Partial<Address> | null;
      rerate_shipping?: boolean;
      note?: string | null;
    },
    opts?: { include_pii?: boolean }
  ): Observable<AdminOrderDetail> {
    const params = { include_pii: opts?.include_pii ?? true };
    return this.api.patch<AdminOrderDetail>(`/orders/admin/${orderId}/addresses`, payload, undefined, params as any).pipe(
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
        admin_notes: o?.admin_notes ?? [],
        fraud_signals: Array.isArray(o?.fraud_signals) ? o.fraud_signals : [],
        shipments: Array.isArray(o?.shipments) ? o.shipments : [],
        items: (o?.items ?? []).map((it: any) => ({
          ...it,
          unit_price: parseMoney(it?.unit_price),
          subtotal: parseMoney(it?.subtotal)
        }))
      }))
    );
  }

  createShipment(
    orderId: string,
    payload: { courier?: string | null; tracking_number: string; tracking_url?: string | null },
    opts?: { include_pii?: boolean }
  ): Observable<AdminOrderDetail> {
    const params = { include_pii: opts?.include_pii ?? true };
    return this.api.post<AdminOrderDetail>(`/orders/admin/${orderId}/shipments`, payload, undefined, params as any).pipe(
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
        admin_notes: o?.admin_notes ?? [],
        fraud_signals: Array.isArray(o?.fraud_signals) ? o.fraud_signals : [],
        shipments: Array.isArray(o?.shipments) ? o.shipments : [],
        items: (o?.items ?? []).map((it: any) => ({
          ...it,
          unit_price: parseMoney(it?.unit_price),
          subtotal: parseMoney(it?.subtotal)
        }))
      }))
    );
  }

  updateShipment(
    orderId: string,
    shipmentId: string,
    payload: { courier?: string | null; tracking_number?: string | null; tracking_url?: string | null },
    opts?: { include_pii?: boolean }
  ): Observable<AdminOrderDetail> {
    const params = { include_pii: opts?.include_pii ?? true };
    return this.api.patch<AdminOrderDetail>(`/orders/admin/${orderId}/shipments/${shipmentId}`, payload, undefined, params as any).pipe(
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
        admin_notes: o?.admin_notes ?? [],
        fraud_signals: Array.isArray(o?.fraud_signals) ? o.fraud_signals : [],
        shipments: Array.isArray(o?.shipments) ? o.shipments : [],
        items: (o?.items ?? []).map((it: any) => ({
          ...it,
          unit_price: parseMoney(it?.unit_price),
          subtotal: parseMoney(it?.subtotal)
        }))
      }))
    );
  }

  deleteShipment(orderId: string, shipmentId: string, opts?: { include_pii?: boolean }): Observable<AdminOrderDetail> {
    const params = { include_pii: opts?.include_pii ?? true };
    return this.api.delete<AdminOrderDetail>(`/orders/admin/${orderId}/shipments/${shipmentId}`, undefined, params as any).pipe(
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
        admin_notes: o?.admin_notes ?? [],
        fraud_signals: Array.isArray(o?.fraud_signals) ? o.fraud_signals : [],
        shipments: Array.isArray(o?.shipments) ? o.shipments : [],
        items: (o?.items ?? []).map((it: any) => ({
          ...it,
          unit_price: parseMoney(it?.unit_price),
          subtotal: parseMoney(it?.subtotal)
        }))
      }))
    );
  }

  fulfillItem(
    orderId: string,
    itemId: string,
    shippedQuantity: number,
    opts?: { include_pii?: boolean }
  ): Observable<AdminOrderDetail> {
    const params: any = { shipped_quantity: shippedQuantity, include_pii: opts?.include_pii ?? true };
    return this.api
      .post<AdminOrderDetail>(`/orders/admin/${orderId}/items/${itemId}/fulfill`, {}, undefined, params)
      .pipe(
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
        admin_notes: o?.admin_notes ?? [],
        fraud_signals: Array.isArray(o?.fraud_signals) ? o.fraud_signals : [],
        shipments: Array.isArray(o?.shipments) ? o.shipments : [],
        items: (o?.items ?? []).map((it: any) => ({
          ...it,
          unit_price: parseMoney(it?.unit_price),
          subtotal: parseMoney(it?.subtotal)
        }))
      }))
    );
  }

  uploadShippingLabel(orderId: string, file: File, opts?: { include_pii?: boolean }): Observable<AdminOrderDetail> {
    const data = new FormData();
    data.append('file', file);
    const params = { include_pii: opts?.include_pii ?? true };
    return this.api.post<AdminOrderDetail>(`/orders/admin/${orderId}/shipping-label`, data, undefined, params as any);
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

  requestRefund(orderId: string, payload: { password: string; note?: string | null }): Observable<Order> {
    return this.api.post<Order>(`/orders/admin/${orderId}/refund`, payload);
  }

  createPartialRefund(
    orderId: string,
    payload: {
      password: string;
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
        admin_notes: o?.admin_notes ?? [],
        fraud_signals: Array.isArray(o?.fraud_signals) ? o.fraud_signals : [],
        shipments: Array.isArray(o?.shipments) ? o.shipments : [],
        items: (o?.items ?? []).map((it: any) => ({
          ...it,
          unit_price: parseMoney(it?.unit_price),
          subtotal: parseMoney(it?.subtotal)
        }))
      }))
    );
  }

  addAdminNote(orderId: string, note: string, opts?: { include_pii?: boolean }): Observable<AdminOrderDetail> {
    const params = { include_pii: opts?.include_pii ?? true };
    return this.api.post<AdminOrderDetail>(`/orders/admin/${orderId}/notes`, { note }, undefined, params as any).pipe(
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
        admin_notes: o?.admin_notes ?? [],
        fraud_signals: Array.isArray(o?.fraud_signals) ? o.fraud_signals : [],
        items: (o?.items ?? []).map((it: any) => ({
          ...it,
          unit_price: parseMoney(it?.unit_price),
          subtotal: parseMoney(it?.subtotal)
        }))
      }))
    );
  }

  listOrderTags(): Observable<string[]> {
    return this.api.get<{ items?: string[] }>('/orders/admin/tags').pipe(
      map((res: any) => (Array.isArray(res?.items) ? res.items : []).filter((t: any) => typeof t === 'string' && t.length))
    );
  }

  listOrderTagStats(): Observable<AdminOrderTagStat[]> {
    return this.api.get<{ items?: AdminOrderTagStat[] }>('/orders/admin/tags/stats').pipe(
      map((res: any) =>
        (Array.isArray(res?.items) ? res.items : [])
          .filter((row: any) => typeof row?.tag === 'string' && row.tag.length)
          .map((row: any) => ({ tag: String(row.tag), count: Math.max(0, Number(row.count || 0) || 0) }))
      )
    );
  }

  renameOrderTag(payload: { from_tag: string; to_tag: string }): Observable<AdminOrderTagRenameResult> {
    return this.api.post<AdminOrderTagRenameResult>('/orders/admin/tags/rename', payload as any).pipe(
      map((res: any) => ({
        from_tag: String(res?.from_tag || ''),
        to_tag: String(res?.to_tag || ''),
        updated: Math.max(0, Number(res?.updated || 0) || 0),
        merged: Math.max(0, Number(res?.merged || 0) || 0),
        total: Math.max(0, Number(res?.total || 0) || 0)
      }))
    );
  }

  addOrderTag(orderId: string, tag: string, opts?: { include_pii?: boolean }): Observable<AdminOrderDetail> {
    const params = { include_pii: opts?.include_pii ?? true };
    return this.api.post<AdminOrderDetail>(`/orders/admin/${orderId}/tags`, { tag }, undefined, params as any).pipe(
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
        admin_notes: o?.admin_notes ?? [],
        tags: Array.isArray(o?.tags) ? o.tags : [],
        fraud_signals: Array.isArray(o?.fraud_signals) ? o.fraud_signals : [],
        items: (o?.items ?? []).map((it: any) => ({
          ...it,
          unit_price: parseMoney(it?.unit_price),
          subtotal: parseMoney(it?.subtotal)
        }))
      }))
    );
  }

  removeOrderTag(orderId: string, tag: string, opts?: { include_pii?: boolean }): Observable<AdminOrderDetail> {
    const params = { include_pii: opts?.include_pii ?? true };
    return this.api
      .delete<AdminOrderDetail>(`/orders/admin/${orderId}/tags/${encodeURIComponent(tag)}`, undefined, params as any)
      .pipe(
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
        admin_notes: o?.admin_notes ?? [],
        tags: Array.isArray(o?.tags) ? o.tags : [],
        fraud_signals: Array.isArray(o?.fraud_signals) ? o.fraud_signals : [],
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

  downloadPickListCsv(orderIds: string[]): Observable<Blob> {
    return this.api.postBlob('/orders/admin/batch/pick-list.csv', { order_ids: orderIds });
  }

  downloadPickListPdf(orderIds: string[]): Observable<Blob> {
    return this.api.postBlob('/orders/admin/batch/pick-list.pdf', { order_ids: orderIds });
  }

  downloadBatchShippingLabelsZip(orderIds: string[]): Observable<Blob> {
    return this.api.postBlob('/orders/admin/batch/shipping-labels.zip', { order_ids: orderIds });
  }

  downloadReceiptPdf(orderId: string): Observable<Blob> {
    return this.api.getBlob(`/orders/admin/${orderId}/receipt`);
  }

  listDocumentExports(params?: { page?: number; limit?: number }): Observable<AdminOrderDocumentExportListResponse> {
    return this.api.get<AdminOrderDocumentExportListResponse>('/orders/admin/exports', params as any);
  }

  downloadDocumentExport(exportId: string): Observable<Blob> {
    return this.api.getBlob(`/orders/admin/exports/${exportId}/download`);
  }

  downloadExport(columns?: string[], opts?: { include_pii?: boolean }): Observable<Blob> {
    const cols = (columns ?? []).filter((c) => (c ?? '').trim());
    const params: any = cols.length ? { columns: cols } : {};
    params.include_pii = opts?.include_pii ?? true;
    return this.api.getBlob('/orders/admin/export', params);
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
