import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface NewsletterSubscribeResponse {
  subscribed: boolean;
  already_subscribed: boolean;
}

export interface NewsletterConfirmResponse {
  confirmed: boolean;
}

export interface NewsletterUnsubscribeResponse {
  unsubscribed: boolean;
}

@Injectable({ providedIn: 'root' })
export class NewsletterService {
  constructor(private api: ApiService) {}

  subscribe(email: string, params: { source?: string; captcha_token?: string | null } = {}): Observable<NewsletterSubscribeResponse> {
    return this.api.post<NewsletterSubscribeResponse>(
      '/newsletter/subscribe',
      {
        email,
        source: params.source ?? 'blog',
        captcha_token: params.captcha_token ?? null
      },
      { 'X-Silent': '1' }
    );
  }

  confirm(token: string): Observable<NewsletterConfirmResponse> {
    return this.api.post<NewsletterConfirmResponse>('/newsletter/confirm', { token }, { 'X-Silent': '1' });
  }

  unsubscribe(token: string): Observable<NewsletterUnsubscribeResponse> {
    return this.api.post<NewsletterUnsubscribeResponse>('/newsletter/unsubscribe', { token }, { 'X-Silent': '1' });
  }
}
