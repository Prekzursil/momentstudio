import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface NewsletterSubscribeResponse {
  subscribed: boolean;
  already_subscribed: boolean;
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
}

