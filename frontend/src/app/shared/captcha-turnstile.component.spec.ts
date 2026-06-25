import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { CaptchaTurnstileComponent } from './captcha-turnstile.component';

type TurnstileApi = NonNullable<Window['turnstile']>;

function resetScriptCache(): void {
  (CaptchaTurnstileComponent as unknown as { scriptPromise: Promise<void> | null }).scriptPromise =
    null;
}

describe('CaptchaTurnstileComponent', () => {
  let originalTurnstile: Window['turnstile'];

  beforeEach(() => {
    originalTurnstile = window.turnstile;
    resetScriptCache();
    document.querySelectorAll('script[data-turnstile="true"]').forEach((el) => el.remove());
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), CaptchaTurnstileComponent],
    });
  });

  afterEach(() => {
    window.turnstile = originalTurnstile;
    document.querySelectorAll('script[data-turnstile="true"]').forEach((el) => el.remove());
    resetScriptCache();
  });

  function create(siteKey = 'site-key'): ComponentFixture<CaptchaTurnstileComponent> {
    const fixture = TestBed.createComponent(CaptchaTurnstileComponent);
    fixture.componentInstance.siteKey = siteKey;
    delete (window as { turnstile?: unknown }).turnstile;
    fixture.detectChanges(); // triggers ngAfterViewInit
    return fixture;
  }

  it('does nothing when siteKey is empty', fakeAsync(() => {
    const fixture = TestBed.createComponent(CaptchaTurnstileComponent);
    fixture.componentInstance.siteKey = '';
    fixture.detectChanges();
    tick();
    expect(fixture.componentInstance.errorKey).toBeNull();
  }));

  it('injects the script and reports unavailable when the API never appears', fakeAsync(() => {
    const fixture = create();
    const script = document.querySelector(
      'script[data-turnstile="true"]',
    ) as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    script!.dispatchEvent(new Event('load'));
    tick();
    flushMicrotasks();
    expect(fixture.componentInstance.errorKey).toBe('auth.captchaUnavailable');
  }));

  it('reports a load failure when the injected script errors', fakeAsync(() => {
    const fixture = create();
    const script = document.querySelector(
      'script[data-turnstile="true"]',
    ) as HTMLScriptElement | null;
    script!.dispatchEvent(new Event('error'));
    tick();
    flushMicrotasks();
    expect(fixture.componentInstance.errorKey).toBe('auth.captchaFailedLoad');
  }));

  it('reuses an already present script element (load path)', fakeAsync(() => {
    const existing = document.createElement('script');
    existing.dataset['turnstile'] = 'true';
    document.head.appendChild(existing);

    const fixture = create();
    // Only the pre-existing script should be present (no second injection).
    expect(document.querySelectorAll('script[data-turnstile="true"]').length).toBe(1);
    existing.dispatchEvent(new Event('load'));
    tick();
    flushMicrotasks();
    expect(fixture.componentInstance.errorKey).toBe('auth.captchaUnavailable');
  }));

  it('reuses an already present script element (error path)', fakeAsync(() => {
    const existing = document.createElement('script');
    existing.dataset['turnstile'] = 'true';
    document.head.appendChild(existing);

    const fixture = create();
    existing.dispatchEvent(new Event('error'));
    tick();
    flushMicrotasks();
    expect(fixture.componentInstance.errorKey).toBe('auth.captchaFailedLoad');
  }));

  it('resolves immediately when the API is already loaded', fakeAsync(() => {
    let opts: Record<string, unknown> = {};
    const api: TurnstileApi = {
      render: (_el, options) => {
        opts = options;
        return 'widget-1';
      },
      reset: jasmine.createSpy('reset'),
      remove: jasmine.createSpy('remove'),
    };
    window.turnstile = api;

    const fixture = TestBed.createComponent(CaptchaTurnstileComponent);
    fixture.componentInstance.siteKey = 'k';
    const tokens: (string | null)[] = [];
    fixture.componentInstance.tokenChange.subscribe((t) => tokens.push(t));
    fixture.detectChanges();
    tick();
    flushMicrotasks();
    tick();

    // No script injection should occur because window.turnstile already exists.
    expect(document.querySelectorAll('script[data-turnstile="true"]').length).toBe(0);

    (opts['callback'] as (t: string) => void)('tok');
    (opts['expired-callback'] as () => void)();
    (opts['error-callback'] as () => void)();

    expect(tokens).toEqual(['tok', null, null]);
    expect(fixture.componentInstance.errorKey).toBe('auth.captchaFailedTryAgain');

    fixture.componentInstance.reset();
    expect(api.reset).toHaveBeenCalledWith('widget-1');
    expect(tokens[tokens.length - 1]).toBeNull();

    fixture.destroy();
    expect(api.remove).toHaveBeenCalledWith('widget-1');
  }));

  it('falls into the catch branch when render throws', fakeAsync(() => {
    window.turnstile = {
      render: () => {
        throw new Error('boom');
      },
      reset: () => {},
      remove: () => {},
    };
    const fixture = TestBed.createComponent(CaptchaTurnstileComponent);
    fixture.componentInstance.siteKey = 'k';
    fixture.detectChanges();
    tick();
    flushMicrotasks();
    expect(fixture.componentInstance.errorKey).toBe('auth.captchaFailedLoad');
  }));

  it('reuses the memoized script promise for a second widget', fakeAsync(() => {
    const first = create();
    const script = document.querySelector(
      'script[data-turnstile="true"]',
    ) as HTMLScriptElement | null;
    script!.dispatchEvent(new Event('load'));
    tick();
    flushMicrotasks();

    // A second component must reuse the cached promise (no second injection).
    const second = TestBed.createComponent(CaptchaTurnstileComponent);
    second.componentInstance.siteKey = 'second';
    second.detectChanges();
    tick();
    flushMicrotasks();

    expect(document.querySelectorAll('script[data-turnstile="true"]').length).toBe(1);
    expect(second.componentInstance.errorKey).toBe('auth.captchaUnavailable');
    first.destroy();
    second.destroy();
  }));

  it('reset and destroy are no-ops without a widget id', () => {
    const fixture = TestBed.createComponent(CaptchaTurnstileComponent);
    fixture.componentInstance.siteKey = '';
    expect(() => fixture.componentInstance.reset()).not.toThrow();
    expect(() => fixture.destroy()).not.toThrow();
  });
});
