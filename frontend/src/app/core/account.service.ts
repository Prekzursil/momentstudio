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
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface Order {
  id: string;
  reference_code?: string | null;
  status: string;
  total_amount: number;
  currency: string;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
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
}
