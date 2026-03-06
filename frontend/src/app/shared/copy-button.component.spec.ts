import { CopyButtonComponent } from './copy-button.component';

function setClipboard(value: any): void {
  Object.defineProperty(navigator, 'clipboard', {
    value,
    configurable: true,
  });
}

describe('CopyButtonComponent', () => {
  beforeEach(() => {
    jasmine.clock().install();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('ignores empty values', async () => {
    const component = new CopyButtonComponent();
    component.value = '   ';

    await component.copy();

    expect(component.copied()).toBeFalse();
  });

  it('uses navigator clipboard and resets copied flag after timeout', async () => {
    const component = new CopyButtonComponent();
    component.value = 'hello world';

    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    setClipboard({ writeText });

    await component.copy();

    expect(writeText).toHaveBeenCalledWith('hello world');
    expect(component.copied()).toBeTrue();

    jasmine.clock().tick(1501);
    expect(component.copied()).toBeFalse();
  });

  it('falls back to execCommand path when clipboard API is unavailable', async () => {
    const component = new CopyButtonComponent();
    component.value = 'fallback value';

    setClipboard(undefined);
    const textarea = {
      value: '',
      setAttribute: jasmine.createSpy('setAttribute'),
      style: {} as Record<string, string>,
      select: jasmine.createSpy('select'),
    };
    const createElement = spyOn(document, 'createElement').and.returnValue(textarea as any);
    const execCommand = spyOn(document as any, 'execCommand').and.returnValue(true);
    const appendChild = spyOn(document.body, 'appendChild').and.callFake((el: any) => el);
    const removeChild = spyOn(document.body, 'removeChild').and.callFake((el: any) => el);

    await component.copy();

    expect(createElement).toHaveBeenCalledWith('textarea');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(appendChild).toHaveBeenCalled();
    expect(removeChild).toHaveBeenCalled();
    expect(component.copied()).toBeTrue();
  });

  it('swallows clipboard and fallback errors', async () => {
    const component = new CopyButtonComponent();
    component.value = 'retry copy';

    setClipboard({ writeText: jasmine.createSpy('writeText').and.callFake(() => { throw new Error('denied'); }) });
    spyOn(component as any, 'fallbackCopy').and.callFake(() => {
      throw new Error('no document');
    });

    await component.copy();

    expect(component.copied()).toBeFalse();
  });
});
