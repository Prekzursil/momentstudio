import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService } from './api.service';

export interface TaxRateRead {
  id: string;
  country_code: string;
  vat_rate_percent: number;
  created_at: string;
  updated_at: string;
}

export interface TaxGroupRead {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  rates: TaxRateRead[];
}

export interface TaxGroupCreate {
  code: string;
  name: string;
  description?: string | null;
  is_default?: boolean;
}

export interface TaxGroupUpdate {
  name?: string | null;
  description?: string | null;
  is_default?: boolean | null;
}

export interface TaxRateUpsert {
  country_code: string;
  vat_rate_percent: number;
}

@Injectable({ providedIn: 'root' })
export class TaxesAdminService {
  constructor(private readonly api: ApiService) {}

  listGroups(): Observable<TaxGroupRead[]> {
    return this.api.get<TaxGroupRead[]>('/taxes/admin/groups');
  }

  createGroup(payload: TaxGroupCreate): Observable<TaxGroupRead> {
    return this.api.post<TaxGroupRead>('/taxes/admin/groups', payload);
  }

  updateGroup(id: string, payload: TaxGroupUpdate): Observable<TaxGroupRead> {
    return this.api.patch<TaxGroupRead>(`/taxes/admin/groups/${id}`, payload);
  }

  deleteGroup(id: string): Observable<void> {
    return this.api.delete<void>(`/taxes/admin/groups/${id}`);
  }

  upsertRate(groupId: string, payload: TaxRateUpsert): Observable<TaxRateRead> {
    return this.api.put<TaxRateRead>(`/taxes/admin/groups/${groupId}/rates`, payload);
  }

  deleteRate(groupId: string, countryCode: string): Observable<void> {
    return this.api.delete<void>(`/taxes/admin/groups/${groupId}/rates/${encodeURIComponent(countryCode)}`);
  }
}

