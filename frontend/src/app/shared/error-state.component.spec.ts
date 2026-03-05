import { fakeAsync, tick } from '@angular/core/testing';

import { ErrorStateComponent } from './error-state.component';

describe('ErrorStateComponent coverage wave', () => {
  it('returns early when request id is empty', async () => {
    const component = new ErrorStateComponent();
    component.requestId = '   ';

    await component.copyRequestId();

    expect(component.copied()).toBeFalse();
  });

  it('copies via clipboard api and resets copied flag', fakeAsync(async () => {
    const component = new ErrorStateComponent();
    component.requestId = 'REQ-123';
    const writeTextSpy = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    spyOnProperty(globalThis.navigator, 'clipboard', 'get').and.returnValue({ writeText: writeTextSpy } as any);

    await component.copyRequestId();

    expect(writeTextSpy).toHaveBeenCalledWith('REQ-123');
    expect(component.copied()).toBeTrue();
    tick(1600);
    expect(component.copied()).toBeFalse();
  }));

  it('falls back to textarea copy when clipboard api is unavailable', fakeAsync(async () => {
    const component = new ErrorStateComponent();
    component.requestId = 'REQ-456';

    spyOnProperty(globalThis.navigator, 'clipboard', 'get').and.returnValue(undefined as any);

    const nativeCreate = document.createElement.bind(document);
    const createElementSpy = spyOn(document, 'createElement').and.callFake((tagName: string) => {
      if (tagName.toLowerCase() === 'textarea') {
        return {
          value: '',
          style: { position: '', left: '' },
          setAttribute: () => undefined,
          select: () => undefined,
        } as any;
      }
      return nativeCreate(tagName);
    });
    const appendSpy = spyOn(document.body, 'appendChild').and.callFake(() => ({}) as any);
    const removeSpy = spyOn(document.body, 'removeChild').and.callFake(() => ({}) as any);
    const execSpy = spyOn(document, 'execCommand').and.returnValue(true as any);

    await component.copyRequestId();

    expect(createElementSpy).toHaveBeenCalled();
    expect(appendSpy).toHaveBeenCalled();
    expect(execSpy).toHaveBeenCalledWith('copy');
    expect(removeSpy).toHaveBeenCalled();
    expect(component.copied()).toBeTrue();
    tick(1600);
    expect(component.copied()).toBeFalse();
  }));

  it('swallows copy errors after fallback failure', async () => {
    const component = new ErrorStateComponent();
    component.requestId = 'REQ-789';

    spyOnProperty(globalThis.navigator, 'clipboard', 'get').and.returnValue({
      writeText: () => Promise.reject(new Error('clipboard-fail'))
    } as any);
    spyOn(document, 'createElement').and.throwError('document-fail');

    await component.copyRequestId();

    expect(component.copied()).toBeFalse();
  });
});
