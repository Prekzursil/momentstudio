import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';

export interface CartApiItem {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
  max_quantity?: number | null;
}

export interface CartTotals {
  subtotal: string;
  fee?: string;
  tax: string;
  shipping: string;
  total: string;
  currency?: string;
  free_shipping_threshold_ron?: string | null;
  phone_required_home?: boolean;
  phone_required_locker?: boolean;
  delivery_locker_allowed?: boolean;
  delivery_allowed_couriers?: string[];
}

export interface CartResponse {
  id: string;
  session_id?: string;
  user_id?: string;
  items: CartItemResponse[];
  totals: CartTotals;
}

export interface CartItemResponse {
  id: string;
  product_id: string;
  variant_id?: string | null;
  quantity: number;
  max_quantity?: number | null;
  unit_price_at_add: string;
  name?: string | null;
  slug?: string | null;
  image_url?: string | null;
  currency?: string | null;
}
export interface CartItemAddRequest {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
}

const CART_SESSION_ID_STORAGE_ITEM = 'cart_session_id';

@Injectable({ providedIn: 'root' })
export class CartApi {
  constructor(private api: ApiService) {}

  getSessionId(): string {
    if (typeof localStorage === 'undefined') return '';
    const existing = localStorage.getItem(CART_SESSION_ID_STORAGE_ITEM);
    if (existing) return existing;
    const newId = `guest-${crypto.randomUUID?.() || Date.now()}`;
    localStorage.setItem(CART_SESSION_ID_STORAGE_ITEM, newId);
    return newId;
  }

  headers(): Record<string, string> {
    const sid = this.getSessionId();
    return sid ? { 'X-Session-Id': sid } : {};
  }

  sync(items: CartApiItem[]): Observable<CartResponse> {
    return this.api.post<CartResponse>('/cart/sync', { items }, this.headers()).pipe(
      map((res) => res)
    );
  }

  get(
    params?: Record<string, string | number | boolean | string[] | number[] | undefined>
  ): Observable<CartResponse> {
    return this.api.get<CartResponse>('/cart', params, this.headers());
  }

  paymentIntent(): Observable<{ client_secret: string; intent_id: string }> {
    return this.api.post<{ client_secret: string; intent_id: string }>('/payments/intent', {}, this.headers());
  }

  addItem(body: CartItemAddRequest): Observable<CartItemResponse> {
    return this.api.post<CartItemResponse>('/cart/items', body, this.headers());
  }

  deleteItem(itemId: string): Observable<void> {
    return this.api.delete<void>(`/cart/items/${itemId}`, this.headers());
  }
}
