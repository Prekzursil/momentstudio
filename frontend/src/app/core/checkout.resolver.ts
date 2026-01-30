import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { ApiService } from './api.service';

type ContentBlockRead = {
  meta?: Record<string, unknown> | null;
};

export const checkoutPricingSettingsResolver: ResolveFn<Record<string, unknown> | null> = (): Observable<Record<string, unknown> | null> => {
  const api = inject(ApiService);
  return api.get<ContentBlockRead>('/content/site.checkout').pipe(
    map((block) => block?.meta ?? null),
    catchError(() => of(null))
  );
};
