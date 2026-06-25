import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ApiService } from './api.service';
import {
  NewsletterConfirmResponse,
  NewsletterService,
  NewsletterSubscribeResponse,
  NewsletterUnsubscribeResponse,
} from './newsletter.service';

describe('NewsletterService', () => {
  let service: NewsletterService;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['post']);
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, NewsletterService],
    });
    service = TestBed.inject(NewsletterService);
  });

  it('subscribes with defaults when no params are given', () => {
    const response: NewsletterSubscribeResponse = { subscribed: true, already_subscribed: false };
    api.post.and.returnValue(of(response));

    let result: NewsletterSubscribeResponse | undefined;
    service.subscribe('a@b.com').subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith(
      '/newsletter/subscribe',
      { email: 'a@b.com', source: 'blog', captcha_token: null },
      { 'X-Silent': '1' },
    );
    expect(result).toBe(response);
  });

  it('subscribes with an explicit source and captcha token', () => {
    api.post.and.returnValue(of({ subscribed: true, already_subscribed: false }));

    service.subscribe('a@b.com', { source: 'footer', captcha_token: 'tok' }).subscribe();

    expect(api.post).toHaveBeenCalledWith(
      '/newsletter/subscribe',
      { email: 'a@b.com', source: 'footer', captcha_token: 'tok' },
      { 'X-Silent': '1' },
    );
  });

  it('confirms a subscription', () => {
    const response: NewsletterConfirmResponse = { confirmed: true };
    api.post.and.returnValue(of(response));

    let result: NewsletterConfirmResponse | undefined;
    service.confirm('token-1').subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith(
      '/newsletter/confirm',
      { token: 'token-1' },
      { 'X-Silent': '1' },
    );
    expect(result).toBe(response);
  });

  it('unsubscribes', () => {
    const response: NewsletterUnsubscribeResponse = { unsubscribed: true };
    api.post.and.returnValue(of(response));

    let result: NewsletterUnsubscribeResponse | undefined;
    service.unsubscribe('token-2').subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith(
      '/newsletter/unsubscribe',
      { token: 'token-2' },
      { 'X-Silent': '1' },
    );
    expect(result).toBe(response);
  });
});
