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

export interface FxOverrideAuditEntry {
  id: string;
  action: string;
  created_at: string;
  user_id?: string | null;
  user_email?: string | null;
  eur_per_ron?: number | null;
  usd_per_ron?: number | null;
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

  listOverrideAudit(limit = 50): Observable<FxOverrideAuditEntry[]> {
    return this.api.get<FxOverrideAuditEntry[]>('/fx/admin/override/audit', { limit });
  }

  restoreOverrideFromAudit(id: string): Observable<FxAdminStatus> {
    return this.api.post<FxAdminStatus>(`/fx/admin/override/audit/${id}/revert`, {});
  }
}
