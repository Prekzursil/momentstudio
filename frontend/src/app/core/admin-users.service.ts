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
}

