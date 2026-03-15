import { ElementRef, SimpleChange } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';

import { ModalComponent } from './modal.component';

describe('ModalComponent accessibility behavior', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ModalComponent]
    });
  });

  it('traps keyboard tab focus inside the dialog', fakeAsync(() => {
    const fixture = TestBed.createComponent(ModalComponent);
    fixture.componentInstance.open = true;
    fixture.componentInstance.title = 'Test modal';
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    expect(focusable.length).toBeGreaterThan(1);

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    first.focus();
    expect(document.activeElement).toBe(first);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);

    last.focus();
    expect(document.activeElement).toBe(last);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);
  }));

  it('covers open/close ngOnChanges transitions and scroll gate stop/start branches', fakeAsync(() => {
    const fixture = TestBed.createComponent(ModalComponent);
    const component = fixture.componentInstance as any;
    const startSpy = spyOn(component, 'startScrollGate').and.stub();
    const stopSpy = spyOn(component, 'stopScrollGate').and.callThrough();
    const restoreSpy = spyOn(component, 'restorePreviousFocus').and.stub();
    const emitSpy = spyOn(component, 'emitBodyScroll').and.stub();

    component.open = true;
    component.requireScrollToConfirm = true;
    component.ngOnChanges({
      open: new SimpleChange(false, true, false),
      requireScrollToConfirm: new SimpleChange(false, true, false),
    });
    expect(component.scrollGateReady).toBeFalse();
    expect(component.scrollGateSettled).toBeFalse();
    tick();
    expect(startSpy).toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalled();

    component.open = false;
    component.ngOnChanges({
      open: new SimpleChange(true, false, false),
    });
    expect(stopSpy).toHaveBeenCalled();
    expect(restoreSpy).toHaveBeenCalled();

    component.open = true;
    component.requireScrollToConfirm = false;
    component.ngOnChanges({
      requireScrollToConfirm: new SimpleChange(true, false, false),
    });
    expect(stopSpy.calls.count()).toBeGreaterThan(1);
  }));

  it('covers trapFocus no-focusable and out-of-container branches', () => {
    const fixture = TestBed.createComponent(ModalComponent);
    const component = fixture.componentInstance as any;
    const container = document.createElement('div');
    component.dialogRef = new ElementRef(container);

    const noFocusableEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    spyOn(noFocusableEvent, 'preventDefault').and.callThrough();
    component.trapFocus(noFocusableEvent);
    expect(noFocusableEvent.preventDefault).toHaveBeenCalled();

    const buttonA = document.createElement('button');
    const buttonB = document.createElement('button');
    container.append(buttonA, buttonB);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    const outsideEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    spyOn(outsideEvent, 'preventDefault').and.callThrough();
    component.trapFocus(outsideEvent);
    expect(outsideEvent.preventDefault).toHaveBeenCalled();

    outside.remove();
  });

  it('covers start/stop scroll gate observer and listener teardown paths', fakeAsync(() => {
    const fixture = TestBed.createComponent(ModalComponent);
    const component = fixture.componentInstance as any;
    const root = document.createElement('div');
    const sentinel = document.createElement('div');
    const loadSpy = spyOn(root, 'addEventListener').and.callThrough();
    component.bodyRef = new ElementRef(root);
    component.bodyEndSentinel = new ElementRef(sentinel);
    component.open = true;
    component.requireScrollToConfirm = true;

    const observeSpy = jasmine.createSpy('observe');
    const disconnectSpy = jasmine.createSpy('disconnect');
    class IOStub {
      constructor(private readonly cb: () => void) {}
      observe = observeSpy;
      disconnect = disconnectSpy;
    }
    const moDisconnectSpy = jasmine.createSpy('mutationDisconnect');
    class MOStub {
      constructor(private readonly cb: () => void) {}
      observe() {
        return undefined;
      }
      disconnect = moDisconnectSpy;
    }

    const originalIO = (globalThis as any).IntersectionObserver;
    const originalMO = (globalThis as any).MutationObserver;
    (globalThis as any).IntersectionObserver = IOStub;
    (globalThis as any).MutationObserver = MOStub;

    const emitSpy = spyOn(component, 'emitBodyScroll').and.stub();
    component.startScrollGate();
    expect(component.scrollGateReady).toBeFalse();
    expect(observeSpy).toHaveBeenCalledWith(sentinel);
    expect(loadSpy).toHaveBeenCalled();

    tick(260);
    expect(component.scrollGateSettled).toBeTrue();
    expect(emitSpy).toHaveBeenCalled();

    component.scrollGateLoadListener = () => undefined;
    component.stopScrollGate();
    expect(disconnectSpy).toHaveBeenCalled();
    expect(moDisconnectSpy).toHaveBeenCalled();

    (globalThis as any).IntersectionObserver = originalIO;
    (globalThis as any).MutationObserver = originalMO;
  }));

  it('covers startScrollGate early-return and restorePreviousFocus missing-node branch', fakeAsync(() => {
    const fixture = TestBed.createComponent(ModalComponent);
    const component = fixture.componentInstance as any;

    component.open = false;
    component.requireScrollToConfirm = true;
    component.startScrollGate();
    expect(component.scrollGateReady).toBeTrue();
    expect(component.scrollGateSettled).toBeTrue();

    component.open = true;
    component.requireScrollToConfirm = true;
    component.bodyRef = new ElementRef(document.createElement('div'));
    component.bodyEndSentinel = undefined;
    component.startScrollGate();
    expect(component.scrollGateReady).toBeFalse();

    const detached = document.createElement('button');
    component.previouslyFocused = detached;
    component.restorePreviousFocus();
    tick();
    expect(component.previouslyFocused).toBeNull();
  }));
});
