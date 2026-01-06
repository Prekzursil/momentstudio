import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { AuthUser } from './auth.service';

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
  payment_retry_count?: number;
  total_amount: number;
  tax_amount?: number;
  shipping_amount?: number;
  currency: string;
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
    return this.api.get<Order[]>('/orders');
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
