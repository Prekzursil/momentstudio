import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService } from './api.service';

export type SupportTopic = 'contact' | 'support' | 'refund' | 'dispute' | 'feedback';
export type SupportStatus = 'new' | 'triaged' | 'resolved';
export type StaffRole = 'customer' | 'support' | 'fulfillment' | 'content' | 'admin' | 'owner';

export interface SupportAgentRef {
  id: string;
  username: string;
  name?: string | null;
  name_tag?: number | null;
  role: StaffRole;
}

export interface AdminContactSubmissionListItem {
  id: string;
  topic: SupportTopic;
  status: SupportStatus;
  name: string;
  email: string;
  order_reference?: string | null;
  assignee?: SupportAgentRef | null;
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
  assignee?: SupportAgentRef | null;
  assigned_by?: SupportAgentRef | null;
  assigned_at?: string | null;
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

export interface SupportCannedResponseRead {
  id: string;
  title: string;
  body_en: string;
  body_ro: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupportSlaSettings {
  first_reply_hours: number;
  resolution_hours: number;
}

@Injectable({ providedIn: 'root' })
export class AdminSupportService {
  constructor(private api: ApiService) {}

  submitFeedback(payload: { message: string; context?: string | null }): Observable<AdminContactSubmissionRead> {
    return this.api.post<AdminContactSubmissionRead>('/support/admin/feedback', payload);
  }

  list(params: {
    q?: string;
    status_filter?: SupportStatus;
    channel_filter?: SupportTopic;
    topic_filter?: SupportTopic;
    customer_filter?: string;
    assignee_filter?: string;
    page?: number;
    limit?: number;
    include_pii?: boolean;
  }): Observable<AdminContactSubmissionListResponse> {
    const finalParams = { ...params, include_pii: params.include_pii ?? true };
    return this.api.get<AdminContactSubmissionListResponse>('/support/admin/submissions', finalParams);
  }

  listAssignees(): Observable<SupportAgentRef[]> {
    return this.api.get<SupportAgentRef[]>('/support/admin/assignees');
  }

  getOne(id: string, opts?: { include_pii?: boolean }): Observable<AdminContactSubmissionRead> {
    const params = { include_pii: opts?.include_pii ?? true };
    return this.api.get<AdminContactSubmissionRead>(`/support/admin/submissions/${id}`, params);
  }

  update(
    id: string,
    payload: { status?: SupportStatus | null; admin_note?: string | null; assignee_id?: string | null },
    opts?: { include_pii?: boolean }
  ): Observable<AdminContactSubmissionRead> {
    const params = { include_pii: opts?.include_pii ?? true };
    return this.api.patch<AdminContactSubmissionRead>(`/support/admin/submissions/${id}`, payload, undefined, params);
  }

  addMessage(id: string, message: string, opts?: { include_pii?: boolean }): Observable<AdminContactSubmissionRead> {
    const params = { include_pii: opts?.include_pii ?? true };
    return this.api.post<AdminContactSubmissionRead>(`/support/admin/submissions/${id}/messages`, { message }, undefined, params);
  }

  listCannedResponses(params?: { include_inactive?: boolean }): Observable<SupportCannedResponseRead[]> {
    return this.api.get<SupportCannedResponseRead[]>('/support/admin/canned-responses', params || {});
  }

  createCannedResponse(payload: {
    title: string;
    body_en: string;
    body_ro: string;
    is_active: boolean;
  }): Observable<SupportCannedResponseRead> {
    return this.api.post<SupportCannedResponseRead>('/support/admin/canned-responses', payload);
  }

  updateCannedResponse(
    id: string,
    payload: { title?: string | null; body_en?: string | null; body_ro?: string | null; is_active?: boolean | null }
  ): Observable<SupportCannedResponseRead> {
    return this.api.patch<SupportCannedResponseRead>(`/support/admin/canned-responses/${id}`, payload);
  }

  deleteCannedResponse(id: string): Observable<unknown> {
    return this.api.delete(`/support/admin/canned-responses/${id}`);
  }

  getSlaSettings(): Observable<SupportSlaSettings> {
    return this.api.get<SupportSlaSettings>('/support/admin/sla-settings');
  }

  updateSlaSettings(payload: SupportSlaSettings): Observable<SupportSlaSettings> {
    return this.api.patch<SupportSlaSettings>('/support/admin/sla-settings', payload);
  }
}
