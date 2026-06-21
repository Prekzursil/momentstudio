import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { CaptchaTurnstileComponent } from './captcha-turnstile.component';

type TurnstileApi = NonNullable<Window['turnstile']>;

describe('CaptchaTurnstileComponent', () => {
  let originalTurnstile: Window['turnstile'];

  beforeEach(() => {
    originalTurnstile = window.turnstile;
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), CaptchaTurnstileComponent],
    });
  });

  afterEach(() => {
    window.turnstile = originalTurnstile;
    document.querySelectorAll('script[data-turnstile="true"]').forEach((el) => el.remove());
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

  it('injects the script, then reports unavailable when the API never appears', fakeAsync(() => {
    const fixture = create();
    const script = document.querySelector('script[data-turnstile="true"]') as HTMLScriptElement;
    expect(script).not.toBeNull();
    script.dispatchEvent(new Event('load'));
    tick();
    expect(fixture.componentInstance.errorKey).toBe('auth.captchaUnavailable');
  }));

  it('renders the widget and wires the callbacks once the API is ready', fakeAsync(() => {
    // First detectChanges below uses the now-cached resolved promise.
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
    expect(fixture.componentInstance.errorKey).toBe('auth.captchaFailedLoad');
  }));

  it('reset and destroy are no-ops without a widget id', () => {
    const fixture = TestBed.createComponent(CaptchaTurnstileComponent);
    fixture.componentInstance.siteKey = '';
    expect(() => fixture.componentInstance.reset()).not.toThrow();
    expect(() => fixture.destroy()).not.toThrow();
  });
});
