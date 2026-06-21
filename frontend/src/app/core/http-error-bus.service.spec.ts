import { TestBed } from '@angular/core/testing';

import { HttpErrorBusService } from './http-error-bus.service';

describe('HttpErrorBusService', () => {
  let service: HttpErrorBusService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [HttpErrorBusService] });
    service = TestBed.inject(HttpErrorBusService);
  });

  it('emits events to subscribers', () => {
    const received: number[] = [];
    service.events$.subscribe((event) => received.push(event.status));

    service.emit({ status: 500, method: 'GET', url: '/api/x' });
    service.emit({ status: 404, method: 'POST', url: '/api/y' });

    expect(received).toEqual([500, 404]);
  });

  it('does not replay past events to late subscribers', () => {
    service.emit({ status: 500, method: 'GET', url: '/api/x' });

    const received: number[] = [];
    service.events$.subscribe((event) => received.push(event.status));

    expect(received).toEqual([]);
  });
});
