import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ApiService } from './api.service';
import { ContactSubmissionRead, SupportService } from './support.service';

describe('SupportService', () => {
  let service: SupportService;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['post']);
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, SupportService],
    });
    service = TestBed.inject(SupportService);
  });

  it('posts a contact submission and returns the response', () => {
    const response = { id: '1', topic: 'contact', status: 'new' } as ContactSubmissionRead;
    api.post.and.returnValue(of(response));

    let result: ContactSubmissionRead | undefined;
    service
      .submitContact({ topic: 'contact', name: 'Ada', email: 'a@b.com', message: 'hi' })
      .subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/support/contact', {
      topic: 'contact',
      name: 'Ada',
      email: 'a@b.com',
      message: 'hi',
    });
    expect(result).toBe(response);
  });
});
