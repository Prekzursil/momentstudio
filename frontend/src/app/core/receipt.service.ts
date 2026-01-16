import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { appConfig } from './app-config';

export type ReceiptAddress = {
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postal_code: string;
  country: string;
};

export type ReceiptItem = {
  product_id: string;
  slug?: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  product_url?: string | null;
};

export type ReceiptRead = {
  order_id: string;
  reference_code?: string | null;
  status: string;
  created_at: string;
  currency: string;
  payment_method?: string | null;
  courier?: string | null;
  delivery_type?: string | null;
  locker_name?: string | null;
  locker_address?: string | null;
  tracking_number?: string | null;
  customer_email?: string | null;
  customer_name?: string | null;
  shipping_amount?: number | null;
  tax_amount?: number | null;
  total_amount?: number | null;
  shipping_address?: ReceiptAddress | null;
  billing_address?: ReceiptAddress | null;
  items: ReceiptItem[];
};

@Injectable({ providedIn: 'root' })
export class ReceiptService {
  private readonly apiBaseUrl = appConfig.apiBaseUrl.replace(/\/$/, '');

  constructor(private api: ApiService) {}

  getByToken(token: string): Observable<ReceiptRead> {
    return this.api.get<ReceiptRead>(`/orders/receipt/${encodeURIComponent(token)}`);
  }

  pdfUrl(token: string): string {
    return `${this.apiBaseUrl}/orders/receipt/${encodeURIComponent(token)}/pdf`;
  }
}

