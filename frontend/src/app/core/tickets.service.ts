import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService } from './api.service';

export type TicketTopic = 'contact' | 'support' | 'refund' | 'dispute';
export type TicketStatus = 'new' | 'triaged' | 'resolved';

export interface TicketMessage {
  id: string;
  from_admin: boolean;
  message: string;
  created_at: string;
}

export interface TicketListItem {
  id: string;
  topic: TicketTopic;
  status: TicketStatus;
  order_reference?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
}

export interface TicketRead extends TicketListItem {
  name: string;
  email: string;
  messages: TicketMessage[];
}

export interface TicketCreateRequest {
  topic: TicketTopic;
  message: string;
  order_reference?: string | null;
}

@Injectable({ providedIn: 'root' })
export class TicketsService {
  constructor(private api: ApiService) {}

  listMine(): Observable<TicketListItem[]> {
    return this.api.get<TicketListItem[]>('/support/me/submissions');
  }

  create(payload: TicketCreateRequest): Observable<TicketRead> {
    return this.api.post<TicketRead>('/support/me/submissions', payload);
  }

  getOne(id: string): Observable<TicketRead> {
    return this.api.get<TicketRead>(`/support/me/submissions/${id}`);
  }

  addMessage(id: string, message: string): Observable<TicketRead> {
    return this.api.post<TicketRead>(`/support/me/submissions/${id}/messages`, { message });
  }
}

