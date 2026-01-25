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
  user: AdminUserListItem;
  addresses: AdminUserAddress[];
  orders: AdminUserOrderSummary[];
  tickets: AdminUserTicketSummary[];
  security_events: AdminUserSecurityEventSummary[];
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
}
