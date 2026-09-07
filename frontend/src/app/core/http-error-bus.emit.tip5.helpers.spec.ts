import { Subject } from 'rxjs';
import { HttpErrorBusService } from './http-error-bus.service';

/** Golden WU tip orphan — HttpErrorBusService.emit. */
describe('HttpErrorBusService emit (golden WU tip5)', () => {
  function bare(): HttpErrorBusService {
    const svc = Object.create(HttpErrorBusService.prototype) as HttpErrorBusService & {
      subject: Subject<unknown>;
    };
    svc.subject = new Subject();
    return svc;
  }

  it('publishes error events on the bus', () => {
    const svc = bare();
    const events: unknown[] = [];
    (svc as any).subject.subscribe((evt: unknown) => events.push(evt));

    HttpErrorBusService.prototype.emit.call(svc, { status: 404, method: 'GET', url: '/x' });
    expect(events).toEqual([{ status: 404, method: 'GET', url: '/x' }]);
  });
});
