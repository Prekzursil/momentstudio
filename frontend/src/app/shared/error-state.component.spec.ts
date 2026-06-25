import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { ErrorStateComponent } from './error-state.component';

describe('ErrorStateComponent', () => {
  let fixture: ComponentFixture<ErrorStateComponent>;
  let component: ErrorStateComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ErrorStateComponent, TranslateModule.forRoot()],
    }).compileComponents();
    fixture = TestBed.createComponent(ErrorStateComponent);
    component = fixture.componentInstance;
  });

  it('creates with default inputs', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
    expect(component.title).toBe('');
    expect(component.showRetry).toBe(false);
    expect(component.requestId).toBeNull();
  });

  it('renders the message and a custom title', () => {
    component.title = 'Boom';
    component.message = 'Something failed';
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(text).toContain('Boom');
    expect(text).toContain('Something failed');
  });

  it('shows the retry button and emits retry', () => {
    component.showRetry = true;
    fixture.detectChanges();
    const retrySpy = jasmine.createSpy('retry');
    component.retry.subscribe(retrySpy);
    component.retry.emit();
    expect(retrySpy).toHaveBeenCalled();
    const btn = (fixture.nativeElement as HTMLElement).querySelector('app-button');
    expect(btn).toBeTruthy();
  });

  it('renders the request id row when requestId is set', () => {
    component.requestId = 'req-123';
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('req-123');
  });

  describe('copyRequestId', () => {
    it('does nothing when the request id is null or blank', async () => {
      component.requestId = null;
      await component.copyRequestId();
      expect(component.copied()).toBe(false);

      component.requestId = '   ';
      await component.copyRequestId();
      expect(component.copied()).toBe(false);
    });

    it('copies via the clipboard API and toggles the copied flag', fakeAsync(() => {
      const writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });
      component.requestId = 'req-1';

      component.copyRequestId();
      tick();
      expect(writeText).toHaveBeenCalledWith('req-1');
      expect(component.copied()).toBe(true);

      tick(1500);
      expect(component.copied()).toBe(false);
    }));

    it('uses the textarea fallback when the clipboard API is missing', fakeAsync(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      spyOn(document, 'execCommand').and.returnValue(true);
      component.requestId = 'req-2';

      component.copyRequestId();
      tick();
      expect(document.execCommand).toHaveBeenCalledWith('copy');
      expect(component.copied()).toBe(true);
      tick(1500);
    }));

    it('recovers via the fallback when the clipboard API rejects', fakeAsync(() => {
      const writeText = jasmine.createSpy('writeText').and.rejectWith(new Error('denied'));
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      spyOn(document, 'execCommand').and.returnValue(true);
      component.requestId = 'req-3';

      component.copyRequestId();
      tick();
      expect(document.execCommand).toHaveBeenCalled();
      expect(component.copied()).toBe(true);
      tick(1500);
    }));

    it('swallows errors when both clipboard and fallback fail', fakeAsync(() => {
      const writeText = jasmine.createSpy('writeText').and.rejectWith(new Error('denied'));
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      spyOn(document, 'execCommand').and.throwError('no exec');
      component.requestId = 'req-4';

      expect(() => {
        component.copyRequestId();
        tick();
      }).not.toThrow();
      expect(component.copied()).toBe(false);
    }));
  });
});
