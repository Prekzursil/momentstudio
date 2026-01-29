import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService } from './api.service';

export type ContactSubmissionTopic = 'contact' | 'support' | 'refund' | 'dispute';

export interface ContactSubmissionCreate {
  topic: ContactSubmissionTopic;
  name: string;
  email: string;
  message: string;
  order_reference?: string | null;
  captcha_token?: string | null;
}

export interface ContactSubmissionRead {
  id: string;
  topic: ContactSubmissionTopic;
  status: 'new' | 'triaged' | 'resolved';
  name: string;
  email: string;
  message: string;
  order_reference?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
}

@Injectable({ providedIn: 'root' })
export class SupportService {
  constructor(private api: ApiService) {}

  submitContact(payload: ContactSubmissionCreate): Observable<ContactSubmissionRead> {
    return this.api.post<ContactSubmissionRead>('/support/contact', payload);
  }
}
