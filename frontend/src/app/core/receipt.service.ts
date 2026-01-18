import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';
import { appConfig } from './app-config';
import { parseMoney } from '../shared/money';

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
  pii_redacted?: boolean;
  shipping_amount?: number | null;
  tax_amount?: number | null;
  fee_amount?: number | null;
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
    return this.api.get<ReceiptRead>(`/orders/receipt/${encodeURIComponent(token)}`).pipe(
      map((r: any) => ({
        ...r,
        pii_redacted: Boolean(r?.pii_redacted),
        shipping_amount: r?.shipping_amount != null ? parseMoney(r.shipping_amount) : null,
        tax_amount: r?.tax_amount != null ? parseMoney(r.tax_amount) : null,
        fee_amount: r?.fee_amount != null ? parseMoney(r.fee_amount) : null,
        total_amount: r?.total_amount != null ? parseMoney(r.total_amount) : null,
        items: (r?.items ?? []).map((it: any) => ({
          ...it,
          unit_price: parseMoney(it?.unit_price),
          subtotal: parseMoney(it?.subtotal)
        }))
      }))
    );
  }

  pdfUrl(token: string): string {
    return `${this.apiBaseUrl}/orders/receipt/${encodeURIComponent(token)}/pdf`;
  }
}
