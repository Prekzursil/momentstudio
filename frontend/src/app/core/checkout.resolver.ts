import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { ApiService } from './api.service';

export type ShippingMethodRead = {
  id: string;
  created_at: string;
  name: string;
  rate_flat: string | number | null;
  rate_per_kg: string | number | null;
};

type ContentBlockRead = {
  meta?: Record<string, unknown> | null;
};

export const checkoutShippingMethodsResolver: ResolveFn<ShippingMethodRead[]> = (): Observable<ShippingMethodRead[]> => {
  const api = inject(ApiService);
  return api.get<ShippingMethodRead[]>('/orders/shipping-methods').pipe(catchError(() => of([])));
};

export const checkoutPricingSettingsResolver: ResolveFn<Record<string, unknown> | null> = (): Observable<Record<string, unknown> | null> => {
  const api = inject(ApiService);
  return api.get<ContentBlockRead>('/content/site.checkout').pipe(
    map((block) => block?.meta ?? null),
    catchError(() => of(null))
  );
};

