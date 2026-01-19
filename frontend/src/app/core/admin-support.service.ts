import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService } from './api.service';

export type SupportTopic = 'contact' | 'support' | 'refund' | 'dispute';
export type SupportStatus = 'new' | 'triaged' | 'resolved';

export interface AdminContactSubmissionListItem {
  id: string;
  topic: SupportTopic;
  status: SupportStatus;
  name: string;
  email: string;
  order_reference?: string | null;
  created_at: string;
}

export interface AdminPaginationMeta {
  total_items: number;
  total_pages: number;
  page: number;
  limit: number;
}

export interface AdminContactSubmissionListResponse {
  items: AdminContactSubmissionListItem[];
  meta: AdminPaginationMeta;
}

export interface AdminContactSubmissionRead {
  id: string;
  topic: SupportTopic;
  status: SupportStatus;
  name: string;
  email: string;
  message: string;
  order_reference?: string | null;
  admin_note?: string | null;
  messages?: AdminContactSubmissionMessage[];
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
}

export interface AdminContactSubmissionMessage {
  id: string;
  from_admin: boolean;
  message: string;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class AdminSupportService {
  constructor(private api: ApiService) {}

  list(params: {
    q?: string;
    status_filter?: SupportStatus;
    topic_filter?: SupportTopic;
    page?: number;
    limit?: number;
  }): Observable<AdminContactSubmissionListResponse> {
    return this.api.get<AdminContactSubmissionListResponse>('/support/admin/submissions', params);
  }

  getOne(id: string): Observable<AdminContactSubmissionRead> {
    return this.api.get<AdminContactSubmissionRead>(`/support/admin/submissions/${id}`);
  }

  update(
    id: string,
    payload: { status?: SupportStatus | null; admin_note?: string | null }
  ): Observable<AdminContactSubmissionRead> {
    return this.api.patch<AdminContactSubmissionRead>(`/support/admin/submissions/${id}`, payload);
  }

  addMessage(id: string, message: string): Observable<AdminContactSubmissionRead> {
    return this.api.post<AdminContactSubmissionRead>(`/support/admin/submissions/${id}/messages`, { message });
  }
}
