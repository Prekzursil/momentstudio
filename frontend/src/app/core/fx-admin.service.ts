import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService } from './api.service';
import { FxRatesResponse } from './fx-rates.service';

export interface FxAdminStatus {
  effective: FxRatesResponse;
  override?: FxRatesResponse | null;
  last_known?: FxRatesResponse | null;
}

export interface FxOverridePayload {
  eur_per_ron: number;
  usd_per_ron: number;
  as_of?: string | null;
}

@Injectable({ providedIn: 'root' })
export class FxAdminService {
  constructor(private api: ApiService) {}

  getStatus(): Observable<FxAdminStatus> {
    return this.api.get<FxAdminStatus>('/fx/admin/status');
  }

  setOverride(payload: FxOverridePayload): Observable<FxRatesResponse> {
    return this.api.put<FxRatesResponse>('/fx/admin/override', payload);
  }

  clearOverride(): Observable<void> {
    return this.api.delete<void>('/fx/admin/override');
  }
}

