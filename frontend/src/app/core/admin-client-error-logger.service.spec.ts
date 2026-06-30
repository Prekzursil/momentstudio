import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';

import { AdminClientErrorIn, AdminService } from './admin.service';
import { AdminClientErrorLoggerService } from './admin-client-error-logger.service';
import { AuthService } from './auth.service';
import { appConfig } from './app-config';

class AdminServiceStub {
  payloads: AdminClientErrorIn[] = [];
  shouldError = false;

  logClientError(payload: AdminClientErrorIn): Observable<void> {
    this.payloads.push(payload);
    return this.shouldError ? throwError(() => new Error('network')) : of(undefined);
  }
}

class AuthServiceStub {
  roleValue: string | null = null;

  role(): string | null {
    return this.roleValue;
  }
}

class RouterStub {
  url = '/';
  events = new Subject<unknown>();
}

interface InternalService {
  enabled: boolean;
  recent: Map<string, number>;
  send(payload: AdminClientErrorIn): void;
  buildBasePayload(
    kind: string,
    message: string,
    stack: string | null,
    context?: Record<string, unknown> | null,
  ): AdminClientErrorIn;
  onWindowError(event: ErrorEvent): void;
  onUnhandledRejection(event: PromiseRejectionEvent): void;
  updateEnabled(url: string): void;
}

describe('AdminClientErrorLoggerService', () => {
  let admin: AdminServiceStub;
  let auth: AuthServiceStub;
  let router: RouterStub;
  let service: AdminClientErrorLoggerService;
  let internal: InternalService;

  const originalAppVersion = appConfig.appVersion;

  beforeEach(() => {
    admin = new AdminServiceStub();
    auth = new AuthServiceStub();
    router = new RouterStub();

    TestBed.configureTestingModule({
      providers: [
        AdminClientErrorLoggerService,
        { provide: AdminService, useValue: admin },
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
      ],
    });

    service = TestBed.inject(AdminClientErrorLoggerService);
    internal = service as unknown as InternalService;
  });

  afterEach(() => {
    appConfig.appVersion = originalAppVersion;
  });

  describe('init', () => {
    // Capture the window handlers wired by init() without registering real
    // listeners. Dispatching a genuine 'error' event on window trips Jasmine's
    // global error handler and would fail the spec, so we invoke the captured
    // callbacks directly instead.
    let handlers: Record<string, (event: Event) => void>;

    beforeEach(() => {
      handlers = {};
      spyOn(window, 'addEventListener').and.callFake(((type: string, cb: EventListener) => {
        handlers[type] = cb as (event: Event) => void;
      }) as typeof window.addEventListener);
    });

    it('enables admin routes, reacts to navigation, and wires window handlers', () => {
      router.url = '/admin';
      auth.roleValue = 'owner';

      service.init();

      expect(internal.enabled).toBeTrue();
      expect(typeof handlers['error']).toBe('function');
      expect(typeof handlers['unhandledrejection']).toBe('function');

      // NavigationEnd with urlAfterRedirects keeps admin enabled.
      router.events.next(new NavigationEnd(1, '/admin/orders', '/admin/orders'));
      expect(internal.enabled).toBeTrue();

      // NavigationEnd whose urlAfterRedirects is empty falls back to url.
      router.events.next(new NavigationEnd(2, '/shop', ''));
      expect(internal.enabled).toBeFalse();

      // Non-NavigationEnd events are filtered out (enabled stays unchanged).
      router.events.next(new NavigationStart(3, '/admin'));
      expect(internal.enabled).toBeFalse();

      // The handlers wired during init forward window/promise failures to the API.
      internal.updateEnabled('/admin');
      handlers['error'](new ErrorEvent('error', { error: new Error('win'), message: 'win' }));
      handlers['unhandledrejection'](
        new PromiseRejectionEvent('unhandledrejection', {
          promise: Promise.resolve(),
          reason: new Error('rej'),
        }),
      );

      expect(admin.payloads.map((p) => p.kind)).toEqual(
        jasmine.arrayContaining(['window_error', 'unhandled_rejection']),
      );
    });

    it('only initializes once', () => {
      router.url = '/admin';
      service.init();
      expect(internal.enabled).toBeTrue();

      // Flip url so a second init would change state if it ran again.
      router.url = '/shop';
      service.init();
      expect(internal.enabled).toBeTrue();
    });
  });

  describe('updateEnabled', () => {
    it('enables on exact /admin', () => {
      internal.updateEnabled('/admin');
      expect(internal.enabled).toBeTrue();
    });

    it('enables on /admin/ sub-routes', () => {
      internal.updateEnabled('/admin/users');
      expect(internal.enabled).toBeTrue();
    });

    it('disables on non-admin routes', () => {
      internal.updateEnabled('/shop');
      expect(internal.enabled).toBeFalse();
    });

    it('treats a nullish url as empty and disables', () => {
      internal.updateEnabled(null as unknown as string);
      expect(internal.enabled).toBeFalse();
    });
  });

  describe('shouldSend (via send)', () => {
    const sendableRoles = ['owner', 'admin', 'support', 'fulfillment', 'content'];

    beforeEach(() => {
      internal.updateEnabled('/admin');
    });

    sendableRoles.forEach((role) => {
      it(`sends for role "${role}"`, () => {
        auth.roleValue = role;
        internal.send(internal.buildBasePayload('window_error', 'm', null));
        expect(admin.payloads.length).toBe(1);
      });
    });

    it('does not send for a non-privileged role', () => {
      auth.roleValue = 'customer';
      internal.send(internal.buildBasePayload('window_error', 'm', null));
      expect(admin.payloads.length).toBe(0);
    });

    it('does not send when disabled', () => {
      internal.updateEnabled('/shop');
      auth.roleValue = 'owner';
      internal.send(internal.buildBasePayload('window_error', 'm', null));
      expect(admin.payloads.length).toBe(0);
    });
  });

  describe('send', () => {
    beforeEach(() => {
      internal.updateEnabled('/admin');
      auth.roleValue = 'owner';
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date('2026-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
      jasmine.clock().uninstall();
    });

    it('dedupes identical payloads within the 5s window then resends after it', () => {
      const make = (): AdminClientErrorIn =>
        internal.buildBasePayload('window_error', 'dup', 'stack-trace');

      internal.send(make());
      expect(admin.payloads.length).toBe(1);

      // Duplicate signature within 5s is suppressed.
      jasmine.clock().tick(1000);
      internal.send(make());
      expect(admin.payloads.length).toBe(1);

      // After the window elapses, the same signature is sent again.
      jasmine.clock().tick(5000);
      internal.send(make());
      expect(admin.payloads.length).toBe(2);
    });

    it('builds a signature when the stack is absent', () => {
      internal.send(internal.buildBasePayload('window_error', 'no-stack', null));
      expect(admin.payloads.length).toBe(1);
    });

    it('evicts the oldest entries once more than 50 signatures are tracked', () => {
      for (let i = 0; i < 60; i += 1) {
        jasmine.clock().tick(1);
        internal.send(internal.buildBasePayload('window_error', `msg-${i}`, null));
      }
      expect(internal.recent.size).toBe(50);
      expect(admin.payloads.length).toBe(60);
    });

    it('swallows API errors via the error subscriber', () => {
      admin.shouldError = true;
      expect(() =>
        internal.send(internal.buildBasePayload('window_error', 'boom', null)),
      ).not.toThrow();
    });
  });

  describe('buildBasePayload', () => {
    it('includes app_version when configured and merges context', () => {
      appConfig.appVersion = '9.9.9';
      const payload = internal.buildBasePayload('window_error', 'hello', 'trace', { foo: 'bar' });

      expect(payload.message).toBe('hello');
      expect(payload.stack).toBe('trace');
      expect(payload.context).toEqual(
        jasmine.objectContaining({ app_env: appConfig.appEnv, app_version: '9.9.9', foo: 'bar' }),
      );
      expect(typeof payload.occurred_at).toBe('string');
    });

    it('omits app_version when blank, defaults blank message, and nulls a missing stack', () => {
      appConfig.appVersion = '';
      const payload = internal.buildBasePayload('unhandled_rejection', '', null);

      expect(payload.message).toBe('Unknown error');
      expect(payload.stack).toBeNull();
      expect(payload.context).not.toEqual(
        jasmine.objectContaining({ app_version: jasmine.anything() }),
      );
    });

    it('handles a nullish message', () => {
      const payload = internal.buildBasePayload('window_error', null as unknown as string, null);
      expect(payload.message).toBe('Unknown error');
    });
  });

  describe('onWindowError', () => {
    beforeEach(() => {
      internal.updateEnabled('/admin');
      auth.roleValue = 'owner';
    });

    it('uses the Error message and stack when event.error is an Error', () => {
      const error = new Error('explode');
      error.stack = 'deep-stack';
      internal.onWindowError(
        new ErrorEvent('error', {
          error,
          message: 'fallback',
          filename: 'a.js',
          lineno: 1,
          colno: 2,
        }),
      );

      expect(admin.payloads.length).toBe(1);
      const payload = admin.payloads[0];
      expect(payload.kind).toBe('window_error');
      expect(payload.message).toBe('explode');
      expect(payload.stack).toBe('deep-stack');
      expect(payload.context).toEqual(
        jasmine.objectContaining({ filename: 'a.js', lineno: 1, colno: 2 }),
      );
    });

    it('nulls the stack when the Error has none', () => {
      const error = new Error('no-stack');
      delete (error as { stack?: string }).stack;
      internal.onWindowError(new ErrorEvent('error', { error, message: 'ignored' }));

      expect(admin.payloads[0].stack).toBeNull();
      expect(admin.payloads[0].message).toBe('no-stack');
    });

    it('falls back to event data and default message when there is no Error', () => {
      internal.onWindowError(new ErrorEvent('error', { error: null, message: '' }));

      expect(admin.payloads.length).toBe(1);
      expect(admin.payloads[0].message).toBe('Window error');
      expect(admin.payloads[0].stack).toBeNull();
    });
  });

  describe('onUnhandledRejection', () => {
    beforeEach(() => {
      internal.updateEnabled('/admin');
      auth.roleValue = 'owner';
    });

    it('uses the Error message and stack when reason is an Error', () => {
      const reason = new Error('rejected');
      reason.stack = 'reject-stack';
      internal.onUnhandledRejection(
        new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason }),
      );

      expect(admin.payloads.length).toBe(1);
      expect(admin.payloads[0].kind).toBe('unhandled_rejection');
      expect(admin.payloads[0].message).toBe('rejected');
      expect(admin.payloads[0].stack).toBe('reject-stack');
    });

    it('nulls the stack when the Error reason has none', () => {
      const reason = new Error('no-stack-reason');
      delete (reason as { stack?: string }).stack;
      internal.onUnhandledRejection(
        new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason }),
      );

      expect(admin.payloads[0].stack).toBeNull();
      expect(admin.payloads[0].message).toBe('no-stack-reason');
    });

    it('stringifies non-Error reasons and applies the default message', () => {
      internal.onUnhandledRejection(
        new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: '' }),
      );

      expect(admin.payloads.length).toBe(1);
      expect(admin.payloads[0].message).toBe('Unhandled rejection');
      expect(admin.payloads[0].stack).toBeNull();
    });
  });
});
