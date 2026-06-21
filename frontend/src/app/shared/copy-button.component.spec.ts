import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { CopyButtonComponent } from './copy-button.component';

describe('CopyButtonComponent', () => {
  let fixture: ComponentFixture<CopyButtonComponent>;
  let component: CopyButtonComponent;
  let originalClipboard: PropertyDescriptor | undefined;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CopyButtonComponent, TranslateModule.forRoot()],
    }).compileComponents();
    fixture = TestBed.createComponent(CopyButtonComponent);
    component = fixture.componentInstance;
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    }
  });

  function setClipboard(value: unknown): void {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value,
    });
  }

  it('creates with defaults', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
    expect(component.copied()).toBeFalse();
  });

  it('returns early when the value is whitespace', async () => {
    component.value = '   ';
    setClipboard({ writeText: jasmine.createSpy('writeText') });
    await component.copy();
    expect((navigator.clipboard.writeText as jasmine.Spy).calls.any()).toBeFalse();
    expect(component.copied()).toBeFalse();
  });

  it('returns early when the value is an empty string (falsy)', async () => {
    component.value = '';
    setClipboard({ writeText: jasmine.createSpy('writeText') });
    await component.copy();
    expect((navigator.clipboard.writeText as jasmine.Spy).calls.any()).toBeFalse();
    expect(component.copied()).toBeFalse();
  });

  it('uses the clipboard API and flashes copied', fakeAsync(() => {
    const writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
    setClipboard({ writeText });
    component.value = 'hello';
    void component.copy();
    tick();
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(component.copied()).toBeTrue();
    tick(1500);
    expect(component.copied()).toBeFalse();
  }));

  it('falls back to execCommand when clipboard API is unavailable', fakeAsync(() => {
    setClipboard(undefined);
    const exec = spyOn(document, 'execCommand').and.returnValue(true);
    component.value = 'fallback-text';
    void component.copy();
    tick();
    expect(exec).toHaveBeenCalledWith('copy');
    expect(component.copied()).toBeTrue();
  }));

  it('falls back to execCommand when clipboard write rejects', fakeAsync(() => {
    setClipboard({ writeText: jasmine.createSpy('writeText').and.rejectWith(new Error('denied')) });
    const exec = spyOn(document, 'execCommand').and.returnValue(true);
    component.value = 'data';
    void component.copy();
    tick();
    expect(exec).toHaveBeenCalledWith('copy');
    expect(component.copied()).toBeTrue();
  }));

  it('swallows errors when both clipboard and fallback fail', fakeAsync(() => {
    setClipboard({ writeText: jasmine.createSpy('writeText').and.rejectWith(new Error('denied')) });
    spyOn(document, 'execCommand').and.throwError('no exec');
    component.value = 'data';
    void component.copy();
    tick();
    expect(component.copied()).toBeFalse();
  }));

  it('renders the copied label while copied is true', fakeAsync(() => {
    const writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
    setClipboard({ writeText });
    component.copiedKey = 'copied.key';
    component.value = 'x';
    fixture.detectChanges();
    void component.copy();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('copied.key');
    tick(1500);
  }));
});
