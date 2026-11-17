import { of } from 'rxjs';

import { ErrorComponent } from './error.component';
import {
  errorNavLinks,
  errorPageMessage,
  resolveLocationReload,
  shouldReloadOnRetry,
} from './error.helpers';

/**
 * Golden WU err50 — first error page specs.
 * Covers message mapping, escape-nav paths, and retry/reload guards.
 */
describe('ErrorComponent message / nav / retry helpers', () => {
  it('errorPageMessage maps known kinds and falls back to generic', () => {
    expect(errorPageMessage('network')).toContain('network');
    expect(errorPageMessage('server')).toContain('server');
    expect(errorPageMessage('timeout')).toContain('timed out');
    expect(errorPageMessage('generic')).toContain('logged the issue');
    expect(errorPageMessage(null)).toBe(errorPageMessage('generic'));
    expect(errorPageMessage(undefined)).toBe(errorPageMessage('generic'));
    expect(errorPageMessage('unknown-code')).toBe(errorPageMessage('generic'));
  });

  it('errorNavLinks returns home, shop, and blog escape paths', () => {
    const links = errorNavLinks();
    expect(links.map((l) => l.path)).toEqual(['/', '/shop', '/blog']);
    expect(links.map((l) => l.kind)).toEqual(['home', 'shop', 'blog']);
    expect(errorNavLinks()).not.toBe(links);
    expect(errorNavLinks()).toEqual(links);
  });

  it('shouldReloadOnRetry arms only when reload is available and not already reloading', () => {
    const reload = jasmine.createSpy('reload');
    expect(shouldReloadOnRetry(reload, false)).toBeTrue();
    expect(shouldReloadOnRetry(reload, true)).toBeFalse();
    expect(shouldReloadOnRetry(null, false)).toBeFalse();
    expect(shouldReloadOnRetry(undefined, false)).toBeFalse();
  });

  it('resolveLocationReload wraps host.reload and nulls missing hosts', () => {
    const reload = jasmine.createSpy('reload');
    const fn = resolveLocationReload({ reload });
    expect(typeof fn).toBe('function');
    fn!();
    expect(reload).toHaveBeenCalled();
    expect(resolveLocationReload(null)).toBeNull();
    expect(resolveLocationReload({})).toBeNull();
    expect(typeof resolveLocationReload()).toBe('function');
  });
});

describe('ErrorComponent field wiring (golden WU)', () => {
  function createCmp(): ErrorComponent {
    const social = {
      get: () => of({ contact: { email: 'support@example.com' } }),
    } as any;
    return new ErrorComponent(social);
  }

  it('exposes navLinks and bodyMessage from helpers at construction', () => {
    const cmp = createCmp();
    expect(cmp.navLinks).toEqual(errorNavLinks());
    expect(cmp.bodyMessage).toBe(errorPageMessage('generic'));
  });

  it('onRetry reloads once then no-ops while already reloading', () => {
    const cmp = createCmp();
    const reload = jasmine.createSpy('reload');
    cmp.onRetry(reload);
    expect(reload).toHaveBeenCalledTimes(1);
    cmp.onRetry(reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('onRetry no-ops when reload resolver is null', () => {
    const cmp = createCmp();
    expect(() => cmp.onRetry(null)).not.toThrow();
  });
});
