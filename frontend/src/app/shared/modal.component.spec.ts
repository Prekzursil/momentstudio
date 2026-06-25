import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Component, SimpleChange } from '@angular/core';

import { ModalComponent } from './modal.component';

@Component({
  standalone: true,
  imports: [ModalComponent],
  template: `<app-modal [open]="true" title="Host modal">
    <button tabindex="-1">not focusable</button>
    <a href="#anchor">link</a>
  </app-modal>`,
})
class ModalHostComponent {}

describe('ModalComponent accessibility behavior', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ModalComponent],
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
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusable.length).toBeGreaterThan(1);

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    first.focus();
    expect(document.activeElement).toBe(first);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(last);

    last.focus();
    expect(document.activeElement).toBe(last);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(first);
  }));
});

describe('ModalComponent behavior', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ModalComponent] });
  });

  it('emits closed and clears open state on close()', () => {
    const fixture = TestBed.createComponent(ModalComponent);
    const cmp = fixture.componentInstance;
    cmp.open = true;
    fixture.detectChanges();
    let closed = false;
    cmp.closed.subscribe(() => (closed = true));
    cmp.close();
    expect(cmp.open).toBeFalse();
    expect(closed).toBeTrue();
  });

  it('closes on Escape only when open', () => {
    const fixture = TestBed.createComponent(ModalComponent);
    const cmp = fixture.componentInstance;
    const spy = spyOn(cmp, 'close').and.callThrough();
    cmp.open = false;
    cmp.handleEscape();
    expect(spy).not.toHaveBeenCalled();
    cmp.open = true;
    fixture.detectChanges();
    cmp.handleEscape();
    expect(spy).toHaveBeenCalled();
  });

  it('ignores non-Tab keydown and keydown while closed', () => {
    const fixture = TestBed.createComponent(ModalComponent);
    const cmp = fixture.componentInstance;
    cmp.open = false;
    cmp.handleKeydown(new KeyboardEvent('keydown', { key: 'Tab' }));
    cmp.open = true;
    fixture.detectChanges();
    // Non-Tab key returns before trapFocus.
    cmp.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(cmp.open).toBeTrue();
  });

  it('handles a Tab keydown when the dialog has not been rendered', () => {
    const fixture = TestBed.createComponent(ModalComponent);
    const cmp = fixture.componentInstance;
    cmp.open = true;
    // Do NOT call detectChanges, so the dialog ViewChild stays undefined.
    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    expect(() => cmp.handleKeydown(event)).not.toThrow();
  });

  it('moves focus to the dialog when no focus is inside on Tab', fakeAsync(() => {
    const fixture = TestBed.createComponent(ModalComponent);
    const cmp = fixture.componentInstance;
    cmp.open = true;
    cmp.title = 'Focus test';
    fixture.detectChanges();
    tick();
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    // Move focus outside the dialog.
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    expect(dialog.contains(document.activeElement)).toBeFalse();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(dialog.contains(document.activeElement)).toBeTrue();
    outside.remove();
  }));

  it('reflects confirmDisabled and scroll-gate readiness', () => {
    const fixture = TestBed.createComponent(ModalComponent);
    const cmp = fixture.componentInstance;
    cmp.confirmDisabled = true;
    expect(cmp.effectiveConfirmDisabled()).toBeTrue();

    cmp.confirmDisabled = false;
    cmp.requireScrollToConfirm = false;
    expect(cmp.effectiveConfirmDisabled()).toBeFalse();

    cmp.requireScrollToConfirm = true;
    (cmp as any).scrollGateReady = false;
    expect(cmp.effectiveConfirmDisabled()).toBeTrue();
    (cmp as any).scrollGateReady = true;
    expect(cmp.effectiveConfirmDisabled()).toBeFalse();
  });

  it('emitBodyScroll is a no-op when the body element is missing', () => {
    const fixture = TestBed.createComponent(ModalComponent);
    const cmp = fixture.componentInstance;
    let emitted = false;
    cmp.bodyScroll.subscribe(() => (emitted = true));
    cmp.emitBodyScroll();
    expect(emitted).toBeFalse();
  });

  it('emits scroll metrics and computes atBottom from the body element', () => {
    const fixture = TestBed.createComponent(ModalComponent);
    const cmp = fixture.componentInstance;
    cmp.open = true;
    fixture.detectChanges();
    const events: Array<{ atBottom: boolean }> = [];
    cmp.bodyScroll.subscribe((e) => events.push(e));
    const body = fixture.nativeElement.querySelector('[role="dialog"] > div + div') as HTMLElement;
    Object.defineProperty(body, 'scrollTop', { value: 0, configurable: true });
    Object.defineProperty(body, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(body, 'scrollHeight', { value: 400, configurable: true });
    cmp.emitBodyScroll();
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].atBottom).toBeFalse();

    Object.defineProperty(body, 'scrollTop', { value: 320, configurable: true });
    cmp.emitBodyScroll();
    expect(events[events.length - 1].atBottom).toBeTrue();
  });

  it('marks the gate ready when content is not scrollable', () => {
    const fixture = TestBed.createComponent(ModalComponent);
    const cmp = fixture.componentInstance;
    cmp.open = true;
    cmp.requireScrollToConfirm = true;
    fixture.detectChanges();
    const body = fixture.nativeElement.querySelector('[role="dialog"] > div + div') as HTMLElement;
    Object.defineProperty(body, 'scrollTop', { value: 0, configurable: true });
    Object.defineProperty(body, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(body, 'scrollHeight', { value: 400, configurable: true });
    (cmp as any).scrollGateSettled = true;
    cmp.emitBodyScroll();
    expect(cmp.effectiveConfirmDisabled()).toBeFalse();
  });

  it('restores previous focus when the modal closes via ngOnChanges', fakeAsync(() => {
    const fixture = TestBed.createComponent(ModalComponent);
    const cmp = fixture.componentInstance;
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    cmp.open = true;
    cmp.ngOnChanges({ open: new SimpleChange(false, true, true) });
    fixture.detectChanges();
    tick();

    cmp.open = false;
    cmp.ngOnChanges({ open: new SimpleChange(true, false, false) });
    tick();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  }));

  it('starts the scroll gate and reacts to all observer callbacks', fakeAsync(() => {
    const ioCallbacks: IntersectionObserverCallback[] = [];
    const moCallbacks: MutationCallback[] = [];
    const fakeIO = class {
      constructor(cb: IntersectionObserverCallback) {
        ioCallbacks.push(cb);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    };
    const fakeMO = class {
      constructor(cb: MutationCallback) {
        moCallbacks.push(cb);
      }
      observe() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
    const originalIO = (window as any).IntersectionObserver;
    const originalMO = (window as any).MutationObserver;
    (window as any).IntersectionObserver = fakeIO as unknown as typeof IntersectionObserver;
    (window as any).MutationObserver = fakeMO as unknown as typeof MutationObserver;
    try {
      const fixture = TestBed.createComponent(ModalComponent);
      const cmp = fixture.componentInstance;
      cmp.open = true;
      cmp.requireScrollToConfirm = true;
      fixture.detectChanges();
      cmp.ngOnChanges({
        open: new SimpleChange(false, true, true),
        requireScrollToConfirm: new SimpleChange(false, true, true),
      });
      tick();
      expect(ioCallbacks.length).toBeGreaterThan(0);
      expect(moCallbacks.length).toBeGreaterThan(0);

      let emitted = 0;
      cmp.bodyScroll.subscribe(() => (emitted += 1));
      // IntersectionObserver callback.
      ioCallbacks[0]([], {} as IntersectionObserver);
      // MutationObserver callback.
      moCallbacks[0]([], {} as MutationObserver);
      // Capturing `load` listener attached to the body element.
      const body = fixture.nativeElement.querySelector(
        '[role="dialog"] > div + div',
      ) as HTMLElement;
      body.dispatchEvent(new Event('load'));
      expect(emitted).toBeGreaterThanOrEqual(3);

      // The settle timer (250ms) flips the gate to settled.
      tick(250);

      // Stops gate cleanly on close.
      cmp.ngOnChanges({ open: new SimpleChange(true, false, false) });
      tick();
    } finally {
      (window as any).IntersectionObserver = originalIO;
      (window as any).MutationObserver = originalMO;
    }
  }));

  it('stops the scroll gate when the gate flag is turned off while open', fakeAsync(() => {
    const fixture = TestBed.createComponent(ModalComponent);
    const cmp = fixture.componentInstance;
    cmp.open = true;
    cmp.requireScrollToConfirm = true;
    fixture.detectChanges();
    cmp.ngOnChanges({ requireScrollToConfirm: new SimpleChange(false, true, true) });
    tick();
    cmp.requireScrollToConfirm = false;
    cmp.ngOnChanges({ requireScrollToConfirm: new SimpleChange(true, false, false) });
    expect(cmp.effectiveConfirmDisabled()).toBeFalse();
  }));

  it('cleans up the scroll gate on destroy', () => {
    const fixture = TestBed.createComponent(ModalComponent);
    const cmp = fixture.componentInstance;
    cmp.open = true;
    fixture.detectChanges();
    expect(() => cmp.ngOnDestroy()).not.toThrow();
  });

  it('filters out non-focusable projected content and recenters from the container', fakeAsync(() => {
    TestBed.configureTestingModule({ imports: [ModalHostComponent] });
    const fixture = TestBed.createComponent(ModalHostComponent);
    fixture.detectChanges();
    tick();
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();

    // Focus the dialog container itself, then Tab: active === container path.
    dialog.focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(dialog.contains(document.activeElement)).toBeTrue();

    // The projected tabindex="-1" button must never receive trap focus.
    const inert = dialog.querySelector('button[tabindex="-1"]') as HTMLElement;
    expect(document.activeElement).not.toBe(inert);
  }));
});
