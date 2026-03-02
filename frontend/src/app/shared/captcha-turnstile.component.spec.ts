import { ElementRef } from '@angular/core';

import { CaptchaTurnstileComponent } from './captcha-turnstile.component';

function createCaptchaTurnstileComponent(): CaptchaTurnstileComponent {
  const component = new CaptchaTurnstileComponent();
  component.host = { nativeElement: document.createElement('div') } as ElementRef<HTMLDivElement>;
  component.siteKey = 'site-key';
  component.theme = 'dark';
  return component;
}

describe('CaptchaTurnstileComponent', () => {
  afterEach(() => {
    delete (globalThis as any).turnstile;
  });

  it('returns early when site key is missing', async () => {
    const component = createCaptchaTurnstileComponent();
    component.siteKey = '';

    await (component as any).initTurnstile();

    expect(component.errorKey).toBeNull();
  });

  it('renders widget and propagates callback tokens', async () => {
    const component = createCaptchaTurnstileComponent();
    let renderOptions: Record<string, any> | null = null;
    const resetSpy = jasmine.createSpy('reset');
    const removeSpy = jasmine.createSpy('remove');

    (globalThis as any).turnstile = {
      render: (_el: HTMLElement, options: Record<string, unknown>) => {
        renderOptions = options as any;
        return 'widget-1';
      },
      reset: resetSpy,
      remove: removeSpy
    };

    const emitSpy = spyOn(component.tokenChange, 'emit');
    await (component as any).initTurnstile();

    expect(renderOptions).toBeTruthy();
    expect((component as any).widgetId).toBe('widget-1');

    (renderOptions as any).callback('token-abc');
    expect(emitSpy).toHaveBeenCalledWith('token-abc');

    (renderOptions as any)['expired-callback']();
    expect(emitSpy).toHaveBeenCalledWith(null);

    (renderOptions as any)['error-callback']();
    expect(component.errorKey).toBe('auth.captchaFailedTryAgain');
    expect(emitSpy).toHaveBeenCalledWith(null);

    component.reset();
    expect(resetSpy).toHaveBeenCalledWith('widget-1');
    expect(emitSpy).toHaveBeenCalledWith(null);

    component.ngOnDestroy();
    expect(removeSpy).toHaveBeenCalledWith('widget-1');
    expect((component as any).widgetId).toBeNull();
  });

  it('sets load error when render throws', async () => {
    const component = createCaptchaTurnstileComponent();
    (globalThis as any).turnstile = {
      render: () => {
        throw new Error('boom');
      },
      reset: () => undefined,
      remove: () => undefined
    };

    await (component as any).initTurnstile();

    expect(component.errorKey).toBe('auth.captchaFailedLoad');
  });

  it('ignores reset when no widget id exists', () => {
    const component = createCaptchaTurnstileComponent();
    const resetSpy = jasmine.createSpy('reset');
    (globalThis as any).turnstile = { reset: resetSpy, render: () => 'id', remove: () => undefined };

    component.reset();

    expect(resetSpy).not.toHaveBeenCalled();
  });
});
