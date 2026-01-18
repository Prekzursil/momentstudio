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
  items: OrderItem[];
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

@Injectable({ providedIn: 'root' })
export class AccountService {
  constructor(private api: ApiService) {}

  getProfile(): Observable<AuthUser> {
    return this.api.get<AuthUser>('/auth/me');
  }

  getAddresses(): Observable<Address[]> {
    return this.api.get<Address[]>('/me/addresses');
  }

  getOrders(): Observable<Order[]> {
    return this.api.get<Order[]>('/orders').pipe(
      map((orders: any[]) =>
        (orders ?? []).map((o) => ({
          ...o,
          total_amount: parseMoney(o?.total_amount),
          tax_amount: parseMoney(o?.tax_amount),
          fee_amount: parseMoney(o?.fee_amount),
          shipping_amount: parseMoney(o?.shipping_amount),
          items: (o?.items ?? []).map((it: any) => ({
            ...it,
            unit_price: parseMoney(it?.unit_price),
            subtotal: parseMoney(it?.subtotal)
          }))
        }))
      )
    );
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

  downloadReceipt(orderId: string): Observable<Blob> {
    return this.api.getBlob(`/orders/${orderId}/receipt`);
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
