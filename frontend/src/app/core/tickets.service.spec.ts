import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ApiService } from './api.service';
import { TicketsService, TicketCreateRequest } from './tickets.service';

describe('TicketsService', () => {
  let get: jasmine.Spy;
  let post: jasmine.Spy;
  let service: TicketsService;

  beforeEach(() => {
    get = jasmine.createSpy('get').and.returnValue(of([]));
    post = jasmine.createSpy('post').and.returnValue(of({}));
    TestBed.configureTestingModule({
      providers: [TicketsService, { provide: ApiService, useValue: { get, post } }],
    });
    service = TestBed.inject(TicketsService);
  });

  it('lists my submissions', () => {
    service.listMine().subscribe();
    expect(get).toHaveBeenCalledWith('/support/me/submissions');
  });

  it('creates a ticket', () => {
    const payload: TicketCreateRequest = { topic: 'support', message: 'hi' };
    service.create(payload).subscribe();
    expect(post).toHaveBeenCalledWith('/support/me/submissions', payload);
  });

  it('gets one ticket by id', () => {
    service.getOne('abc').subscribe();
    expect(get).toHaveBeenCalledWith('/support/me/submissions/abc');
  });

  it('adds a message to a ticket', () => {
    service.addMessage('abc', 'reply').subscribe();
    expect(post).toHaveBeenCalledWith('/support/me/submissions/abc/messages', { message: 'reply' });
  });
});
