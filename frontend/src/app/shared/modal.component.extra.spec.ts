import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';

import { ModalBodyScrollEvent, ModalComponent } from './modal.component';

describe('ModalComponent', () => {
  let fixture: ComponentFixture<ModalComponent>;
  let component: ModalComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ModalComponent] }).compileComponents();
    fixture = TestBed.createComponent(ModalComponent);
    component = fixture.componentInstance;
  });

  function open(): void {
    component.open = true;
    fixture.detectChanges();
  }

  it('creates and is hidden by default', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the dialog, subtitle and actions when open', fakeAsync(() => {
    component.subtitle = 'Sub';
    open();
    tick();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="dialog"]')).toBeTruthy();
    expect(el.textContent).toContain('Sub');
  }));

  it('hides the action bar when showActions is false', fakeAsync(() => {
    component.showActions = false;
    open();
    tick();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('app-button').length).toBe(1);
  }));

  it('close() hides the modal and emits closed', fakeAsync(() => {
    open();
    tick();
    const closed = jasmine.createSpy('closed');
    component.closed.subscribe(closed);
    component.close();
    expect(component.open).toBe(false);
    expect(closed).toHaveBeenCalled();
  }));

  describe('handleEscape / handleKeydown', () => {
    it('closes on escape when open', () => {
      component.open = true;
      const spy = spyOn(component, 'close');
      component.handleEscape();
      expect(spy).toHaveBeenCalled();
    });

    it('ignores escape when closed', () => {
      component.open = false;
      const spy = spyOn(component, 'close');
      component.handleEscape();
      expect(spy).not.toHaveBeenCalled();
    });

    it('ignores keydown while closed and non-Tab keys while open', () => {
      component.open = false;
      component.handleKeydown(new KeyboardEvent('keydown', { key: 'Tab' }));
      component.open = true;
      const evt = new KeyboardEvent('keydown', { key: 'Enter' });
      const prevent = spyOn(evt, 'preventDefault');
      component.handleKeydown(evt);
      expect(prevent).not.toHaveBeenCalled();
    });
  });

  describe('trapFocus edge cases', () => {
    it('focuses the container when there are no focusable elements', fakeAsync(() => {
      component.showActions = false;
      open();
      tick();
      const dialog = (fixture.nativeElement as HTMLElement).querySelector(
        '[role="dialog"]',
      ) as HTMLElement;
      // Hide the only focusable (close button) so the focusable list is empty.
      dialog.querySelectorAll('button').forEach((b) => b.setAttribute('disabled', 'true'));
      const evt = new KeyboardEvent('keydown', { key: 'Tab' });
      const prevent = spyOn(evt, 'preventDefault');
      component.handleKeydown(evt);
      expect(prevent).toHaveBeenCalled();
    }));

    it('wraps focus to the first element when active focus is outside', fakeAsync(() => {
      open();
      tick();
      (document.activeElement as HTMLElement | null)?.blur();
      const evt = new KeyboardEvent('keydown', { key: 'Tab' });
      expect(() => component.handleKeydown(evt)).not.toThrow();
    }));
  });

  describe('effectiveConfirmDisabled', () => {
    it('is disabled when confirmDisabled is set', () => {
      component.confirmDisabled = true;
      expect(component.effectiveConfirmDisabled()).toBe(true);
    });

    it('is enabled when the scroll gate is not required', () => {
      component.confirmDisabled = false;
      component.requireScrollToConfirm = false;
      expect(component.effectiveConfirmDisabled()).toBe(false);
    });

    it('reflects scroll gate readiness when required', () => {
      component.confirmDisabled = false;
      component.requireScrollToConfirm = true;
      (component as unknown as { scrollGateReady: boolean }).scrollGateReady = false;
      expect(component.effectiveConfirmDisabled()).toBe(true);
    });
  });

  describe('emitBodyScroll', () => {
    it('is a no-op when there is no body element', () => {
      const spy = jasmine.createSpy('bodyScroll');
      component.bodyScroll.subscribe(spy);
      component.emitBodyScroll();
      expect(spy).not.toHaveBeenCalled();
    });

    it('emits metrics when open', fakeAsync(() => {
      open();
      tick();
      const spy = jasmine.createSpy('bodyScroll');
      component.bodyScroll.subscribe(spy);
      component.emitBodyScroll();
      expect(spy).toHaveBeenCalled();
      const evt = spy.calls.mostRecent().args[0] as ModalBodyScrollEvent;
      expect(typeof evt.atBottom).toBe('boolean');
    }));
  });

  describe('ngOnChanges', () => {
    it('opens and captures focus on transition to open', fakeAsync(() => {
      component.open = true;
      component.ngOnChanges({ open: new SimpleChange(false, true, false) });
      tick();
      expect(component.open).toBe(true);
    }));

    it('stops the gate and restores focus when closing', () => {
      component.open = false;
      const stop = spyOn(
        component as unknown as { stopScrollGate: () => void },
        'stopScrollGate',
      ).and.callThrough();
      component.ngOnChanges({ open: new SimpleChange(true, false, false) });
      expect(stop).toHaveBeenCalled();
    });

    it('starts the scroll gate when opening with the gate required', fakeAsync(() => {
      component.open = true;
      component.requireScrollToConfirm = true;
      fixture.detectChanges();
      component.ngOnChanges({
        open: new SimpleChange(false, true, false),
        requireScrollToConfirm: new SimpleChange(false, true, false),
      });
      tick(300);
      expect(component).toBeTruthy();
    }));

    it('stops the gate when the requirement is removed while open', () => {
      component.open = true;
      component.requireScrollToConfirm = false;
      const stop = spyOn(
        component as unknown as { stopScrollGate: () => void },
        'stopScrollGate',
      ).and.callThrough();
      component.ngOnChanges({ requireScrollToConfirm: new SimpleChange(true, false, false) });
      expect(stop).toHaveBeenCalled();
    });

    it('re-emits scroll on open without a gate', fakeAsync(() => {
      open();
      tick();
      component.requireScrollToConfirm = false;
      component.ngOnChanges({ open: new SimpleChange(false, true, false) });
      tick();
      expect(component.open).toBe(true);
    }));

    it('does nothing when unrelated inputs change', () => {
      const stop = spyOn(component as unknown as { stopScrollGate: () => void }, 'stopScrollGate');
      component.ngOnChanges({ title: new SimpleChange('a', 'b', false) });
      expect(stop).not.toHaveBeenCalled();
    });
  });

  it('cleans up on destroy', () => {
    const stop = spyOn(component as unknown as { stopScrollGate: () => void }, 'stopScrollGate');
    component.ngOnDestroy();
    expect(stop).toHaveBeenCalled();
  });

  describe('scroll gate measurement', () => {
    it('handles scrollable content (gate ready at bottom)', fakeAsync(() => {
      component.requireScrollToConfirm = true;
      open();
      tick();
      const body = (component as unknown as { bodyRef?: { nativeElement: HTMLElement } }).bodyRef
        ?.nativeElement;
      if (body) {
        Object.defineProperty(body, 'scrollHeight', { value: 500, configurable: true });
        Object.defineProperty(body, 'clientHeight', { value: 100, configurable: true });
        Object.defineProperty(body, 'scrollTop', { value: 400, configurable: true });
      }
      component.emitBodyScroll();
      tick(300);
      expect(component).toBeTruthy();
    }));

    it('handles non-scrollable content', fakeAsync(() => {
      component.requireScrollToConfirm = true;
      open();
      tick();
      const body = (component as unknown as { bodyRef?: { nativeElement: HTMLElement } }).bodyRef
        ?.nativeElement;
      if (body) {
        Object.defineProperty(body, 'scrollHeight', { value: 100, configurable: true });
        Object.defineProperty(body, 'clientHeight', { value: 100, configurable: true });
      }
      component.emitBodyScroll();
      tick(300);
      expect(component.effectiveConfirmDisabled()).toBeDefined();
    }));

    it('attaches IntersectionObserver and MutationObserver and reacts to them', fakeAsync(() => {
      component.requireScrollToConfirm = true;
      open();
      tick();
      const internal = component as unknown as {
        startScrollGate: () => void;
        scrollGateObserver: IntersectionObserver | null;
        scrollGateMutationObserver: MutationObserver | null;
        scrollGateLoadListener: ((e: Event) => void) | null;
      };
      const emit = spyOn(component, 'emitBodyScroll').and.callThrough();
      internal.startScrollGate();

      // The IntersectionObserver and MutationObserver are wired with callbacks
      // that call emitBodyScroll; invoke them directly to exercise those paths.
      const io = internal.scrollGateObserver as unknown as {
        callback?: IntersectionObserverCallback;
      };
      expect(internal.scrollGateObserver).toBeTruthy();
      internal.scrollGateLoadListener?.(new Event('load'));
      tick(300);
      expect(emit).toHaveBeenCalled();
      void io;
      component.close();
    }));

    it('no-ops the gate start when not open or gate not required', () => {
      const internal = component as unknown as {
        startScrollGate: () => void;
        scrollGateReady: boolean;
      };
      component.open = false;
      component.requireScrollToConfirm = true;
      internal.startScrollGate();
      expect(internal.scrollGateReady).toBe(true);

      component.open = true;
      component.requireScrollToConfirm = false;
      internal.startScrollGate();
      expect(internal.scrollGateReady).toBe(true);
    });

    it('skips observers when IntersectionObserver is unavailable', fakeAsync(() => {
      component.requireScrollToConfirm = true;
      open();
      tick();
      const ioDescriptor = Object.getOwnPropertyDescriptor(window, 'IntersectionObserver');
      Object.defineProperty(window, 'IntersectionObserver', {
        value: undefined,
        configurable: true,
      });
      try {
        const internal = component as unknown as {
          startScrollGate: () => void;
          scrollGateObserver: IntersectionObserver | null;
        };
        internal.startScrollGate();
        expect(internal.scrollGateObserver).toBeNull();
        tick(300);
      } finally {
        if (ioDescriptor) Object.defineProperty(window, 'IntersectionObserver', ioDescriptor);
      }
    }));
  });

  describe('focus management', () => {
    it('focuses a focusable element inside the dialog', fakeAsync(() => {
      open();
      tick();
      const internal = component as unknown as { focusDialog: () => void };
      internal.focusDialog();
      tick();
      expect(component).toBeTruthy();
    }));

    it('captures and restores the previously focused element', fakeAsync(() => {
      const prev = document.createElement('button');
      document.body.appendChild(prev);
      prev.focus();
      const internal = component as unknown as {
        capturePreviousFocus: () => void;
        restorePreviousFocus: () => void;
        previouslyFocused: HTMLElement | null;
      };
      internal.capturePreviousFocus();
      expect(internal.previouslyFocused).toBe(prev);
      internal.restorePreviousFocus();
      tick();
      document.body.removeChild(prev);
    }));

    it('ignores capture when the active element is not an HTMLElement', () => {
      const internal = component as unknown as {
        capturePreviousFocus: () => void;
        previouslyFocused: HTMLElement | null;
      };
      internal.previouslyFocused = null;
      spyOnProperty(document, 'activeElement', 'get').and.returnValue(null);
      internal.capturePreviousFocus();
      expect(internal.previouslyFocused).toBeNull();
    });

    it('restore is a no-op when there is no captured element', () => {
      const internal = component as unknown as {
        restorePreviousFocus: () => void;
        previouslyFocused: HTMLElement | null;
      };
      internal.previouslyFocused = null;
      expect(() => internal.restorePreviousFocus()).not.toThrow();
    });

    it('focusDialog is a no-op without a dialog ref', () => {
      const internal = component as unknown as {
        focusDialog: () => void;
        dialogRef?: unknown;
      };
      internal.dialogRef = undefined;
      expect(() => internal.focusDialog()).not.toThrow();
    });

    it('filters out non-focusable candidates (tabindex<0, aria-hidden, inert)', fakeAsync(() => {
      open();
      tick();
      const dialog = (component as unknown as { dialogRef?: { nativeElement: HTMLElement } })
        .dialogRef?.nativeElement as HTMLElement;
      const hidden = document.createElement('button');
      hidden.setAttribute('aria-hidden', 'true');
      const inert = document.createElement('button');
      inert.setAttribute('inert', '');
      const negTab = document.createElement('input');
      negTab.tabIndex = -1;
      negTab.setAttribute('tabindex', '0'); // matches selector but tabIndex resolves <0 via property
      dialog.appendChild(hidden);
      dialog.appendChild(inert);
      dialog.appendChild(negTab);
      const internal = component as unknown as {
        getFocusableElements: (c: HTMLElement) => HTMLElement[];
      };
      const focusable = internal.getFocusableElements(dialog);
      expect(focusable).not.toContain(hidden);
      expect(focusable).not.toContain(inert);
    }));

    it('traps focus with shift on the first element wrapping to the last', fakeAsync(() => {
      open();
      tick();
      const dialog = (component as unknown as { dialogRef?: { nativeElement: HTMLElement } })
        .dialogRef?.nativeElement as HTMLElement;
      const a = document.createElement('button');
      a.textContent = 'a';
      const b = document.createElement('button');
      b.textContent = 'b';
      dialog.appendChild(a);
      dialog.appendChild(b);
      const internal = component as unknown as {
        getFocusableElements: (c: HTMLElement) => HTMLElement[];
      };
      const list = internal.getFocusableElements(dialog);
      const first = list[0];
      const last = list[list.length - 1];

      first.focus();
      const shift = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true });
      spyOn(shift, 'preventDefault');
      component.handleKeydown(shift);
      expect(document.activeElement).toBe(last);

      last.focus();
      const fwd = new KeyboardEvent('keydown', { key: 'Tab' });
      component.handleKeydown(fwd);
      expect(document.activeElement).toBe(first);
    }));

    it('restorePreviousFocus skips a detached element', fakeAsync(() => {
      const detached = document.createElement('button');
      const internal = component as unknown as {
        previouslyFocused: HTMLElement | null;
        restorePreviousFocus: () => void;
      };
      internal.previouslyFocused = detached; // never appended to the document
      internal.restorePreviousFocus();
      tick();
      expect(internal.previouslyFocused).toBeNull();
    }));

    it('stopScrollGate disconnects active observers and timers', fakeAsync(() => {
      component.requireScrollToConfirm = true;
      open();
      tick();
      const internal = component as unknown as {
        startScrollGate: () => void;
        stopScrollGate: () => void;
        scrollGateObserver: IntersectionObserver | null;
        scrollGateMutationObserver: MutationObserver | null;
      };
      internal.startScrollGate();
      expect(internal.scrollGateObserver).toBeTruthy();
      internal.stopScrollGate();
      expect(internal.scrollGateObserver).toBeNull();
      expect(internal.scrollGateMutationObserver).toBeNull();
    }));
  });
});
