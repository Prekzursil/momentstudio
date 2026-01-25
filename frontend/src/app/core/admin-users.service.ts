import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { AdminPaginationMeta } from './admin-orders.service';

export interface AdminUserListItem {
  id: string;
  email: string;
  username: string;
  name?: string | null;
  name_tag?: number | null;
  role: string;
  email_verified: boolean;
  created_at: string;
}

export interface AdminUserListResponse {
  items: AdminUserListItem[];
  meta: AdminPaginationMeta;
}

export interface AdminUserAddress {
  id: string;
  label?: string | null;
  phone?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postal_code: string;
  country: string;
  is_default_shipping: boolean;
  is_default_billing: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminUserOrderSummary {
  id: string;
  reference_code?: string | null;
  status: string;
  total_amount: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface AdminUserTicketSummary {
  id: string;
  topic: string;
  status: string;
  order_reference?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
}

export interface AdminUserSecurityEventSummary {
  id: string;
  event_type: string;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at: string;
}

export interface AdminUserProfileResponse {
  user: AdminUserProfileUser;
  addresses: AdminUserAddress[];
  orders: AdminUserOrderSummary[];
  tickets: AdminUserTicketSummary[];
  security_events: AdminUserSecurityEventSummary[];
}

export interface AdminUserProfileUser extends AdminUserListItem {
  vip: boolean;
  admin_note?: string | null;
  locked_until?: string | null;
  locked_reason?: string | null;
  password_reset_required?: boolean;
}

export interface AdminUserImpersonationResponse {
  access_token: string;
  expires_at: string;
}

export interface AdminEmailVerificationTokenInfo {
  id: string;
  created_at: string;
  expires_at: string;
  used: boolean;
}

export interface AdminEmailVerificationHistoryResponse {
  tokens: AdminEmailVerificationTokenInfo[];
}

export interface AdminGdprUserRef {
  id: string;
  email: string;
  username: string;
  role: string;
}

export interface AdminGdprExportJobItem {
  id: string;
  user: AdminGdprUserRef;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  progress: number;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  expires_at?: string | null;
  has_file: boolean;
  sla_due_at: string;
  sla_breached: boolean;
}

export interface AdminGdprExportJobsResponse {
  items: AdminGdprExportJobItem[];
  meta: AdminPaginationMeta;
}

export interface AdminGdprDeletionRequestItem {
  user: AdminGdprUserRef;
  requested_at: string;
  scheduled_for?: string | null;
  status: string;
  sla_due_at: string;
  sla_breached: boolean;
}

export interface AdminGdprDeletionRequestsResponse {
  items: AdminGdprDeletionRequestItem[];
  meta: AdminPaginationMeta;
}

export interface AdminUserSegmentListItem {
  user: AdminUserListItem;
  orders_count: number;
  total_spent: number;
  avg_order_value: number;
}

export interface AdminUserSegmentResponse {
  items: AdminUserSegmentListItem[];
  meta: AdminPaginationMeta;
}

@Injectable({ providedIn: 'root' })
export class AdminUsersService {
  constructor(private api: ApiService) {}

  search(params: {
    q?: string;
    role?: string;
    page?: number;
    limit?: number;
  }): Observable<AdminUserListResponse> {
    return this.api.get<AdminUserListResponse>('/admin/dashboard/users/search', params as any);
  }

  getProfile(userId: string): Observable<AdminUserProfileResponse> {
    return this.api.get<AdminUserProfileResponse>(`/admin/dashboard/users/${userId}/profile`);
  }

  updateInternal(userId: string, payload: { vip?: boolean; admin_note?: string | null }): Observable<AdminUserProfileUser> {
    return this.api.patch<AdminUserProfileUser>(`/admin/dashboard/users/${userId}/internal`, payload as any);
  }

  impersonate(userId: string): Observable<AdminUserImpersonationResponse> {
    return this.api.post<AdminUserImpersonationResponse>(`/admin/dashboard/users/${userId}/impersonate`, {});
  }

  updateSecurity(
    userId: string,
    payload: { locked_until?: string | null; locked_reason?: string | null; password_reset_required?: boolean }
  ): Observable<AdminUserProfileUser> {
    return this.api.patch<AdminUserProfileUser>(`/admin/dashboard/users/${userId}/security`, payload as any);
  }

  getEmailVerificationHistory(userId: string): Observable<AdminEmailVerificationHistoryResponse> {
    return this.api.get<AdminEmailVerificationHistoryResponse>(`/admin/dashboard/users/${userId}/email/verification`);
  }

  resendEmailVerification(userId: string): Observable<{ detail: string }> {
    return this.api.post<{ detail: string }>(`/admin/dashboard/users/${userId}/email/verification/resend`, {});
  }

  overrideEmailVerification(userId: string): Observable<AdminUserProfileUser> {
    return this.api.post<AdminUserProfileUser>(`/admin/dashboard/users/${userId}/email/verification/override`, {});
  }

  listGdprExportJobs(params: {
    q?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Observable<AdminGdprExportJobsResponse> {
    return this.api.get<AdminGdprExportJobsResponse>('/admin/dashboard/gdpr/exports', params as any);
  }

  retryGdprExportJob(jobId: string): Observable<AdminGdprExportJobItem> {
    return this.api.post<AdminGdprExportJobItem>(`/admin/dashboard/gdpr/exports/${jobId}/retry`, {});
  }

  downloadGdprExportJob(jobId: string): Observable<Blob> {
    return this.api.getBlob(`/admin/dashboard/gdpr/exports/${jobId}/download`);
  }

  listGdprDeletionRequests(params: { q?: string; page?: number; limit?: number }): Observable<AdminGdprDeletionRequestsResponse> {
    return this.api.get<AdminGdprDeletionRequestsResponse>('/admin/dashboard/gdpr/deletions', params as any);
  }

  executeGdprDeletion(userId: string): Observable<void> {
    return this.api.post<void>(`/admin/dashboard/gdpr/deletions/${userId}/execute`, {});
  }

  cancelGdprDeletion(userId: string): Observable<void> {
    return this.api.post<void>(`/admin/dashboard/gdpr/deletions/${userId}/cancel`, {});
  }

  listRepeatBuyersSegment(params: { q?: string; min_orders?: number; page?: number; limit?: number }): Observable<AdminUserSegmentResponse> {
    return this.api.get<AdminUserSegmentResponse>('/admin/dashboard/users/segments/repeat-buyers', params as any);
  }

  listHighAovSegment(params: {
    q?: string;
    min_orders?: number;
    min_aov?: number;
    page?: number;
    limit?: number;
  }): Observable<AdminUserSegmentResponse> {
    return this.api.get<AdminUserSegmentResponse>('/admin/dashboard/users/segments/high-aov', params as any);
  }
}
