import { SimpleChange } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';

import { ModalBodyScrollEvent, ModalComponent } from './modal.component';

type BodyMetrics = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

function setBodyMetrics(element: HTMLElement, metrics: BodyMetrics): void {
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    writable: true,
    value: metrics.scrollTop
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: metrics.clientHeight
  });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: metrics.scrollHeight
  });
}


function getBodyElement(component: ModalComponent): HTMLDivElement {
  const body = component.bodyRef?.nativeElement;
  expect(body).toBeDefined();
  if (!body) {
    throw new Error('Expected modal body element to be present');
  }
  return body;
}

function getDialogElement(component: ModalComponent): HTMLElement {
  const dialog = component.dialogRef?.nativeElement;
  expect(dialog).toBeDefined();
  if (!dialog) {
    throw new Error('Expected modal dialog element to be present');
  }
  return dialog;
}

describe('ModalComponent coverage wave', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ModalComponent]
    });
  });

  it('enforces scroll-to-confirm until the modal body reaches bottom', fakeAsync(() => {
    const fixture = TestBed.createComponent(ModalComponent);
    const component = fixture.componentInstance;
    component.open = true;
    component.requireScrollToConfirm = true;

    const scrollEvents: ModalBodyScrollEvent[] = [];
    component.bodyScroll.subscribe((event) => {
      scrollEvents.push(event);
    });

    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const body = getBodyElement(component);
    setBodyMetrics(body, { scrollTop: 0, clientHeight: 200, scrollHeight: 600 });
    component.emitBodyScroll();

    expect(component.effectiveConfirmDisabled()).toBeTrue();
    expect(scrollEvents.length).toBeGreaterThan(0);

    setBodyMetrics(body, { scrollTop: 408, clientHeight: 200, scrollHeight: 600 });
    component.emitBodyScroll();

    expect(component.effectiveConfirmDisabled()).toBeFalse();
    const lastEvent = scrollEvents.at(-1);
    expect(lastEvent).toBeDefined();
    if (!lastEvent) {
      fail('Expected at least one modal body scroll event');
      return;
    }
    expect(lastEvent.atBottom).toBeTrue();
  }));

  it('keeps confirm blocked for non-scrollable body until settle flag is true', fakeAsync(() => {
    const fixture = TestBed.createComponent(ModalComponent);
    const component = fixture.componentInstance;
    component.open = true;
    component.requireScrollToConfirm = true;

    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const body = getBodyElement(component);
    setBodyMetrics(body, { scrollTop: 0, clientHeight: 300, scrollHeight: 300 });
    (component as unknown as { scrollGateReady: boolean; scrollGateSettled: boolean }).scrollGateSettled = false;
    (component as unknown as { scrollGateReady: boolean; scrollGateSettled: boolean }).scrollGateReady = false;
    component.emitBodyScroll();

    expect(component.effectiveConfirmDisabled()).toBeTrue();

    (component as unknown as { scrollGateSettled: boolean }).scrollGateSettled = true;
    tick();
    component.emitBodyScroll();
    expect(component.effectiveConfirmDisabled()).toBeFalse();
  }));

  it('closes on escape and restores focus to the previously focused element', fakeAsync(() => {
    const opener = document.createElement('button');
    opener.textContent = 'Open modal';
    document.body.appendChild(opener);
    const openerFocusSpy = spyOn(opener, 'focus').and.callThrough();
    opener.focus();

    const fixture = TestBed.createComponent(ModalComponent);
    const component = fixture.componentInstance;
    component.open = true;
    spyOn(component.closed, 'emit');

    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    component.handleEscape();
    tick();

    expect(component.open).toBeFalse();
    expect(component.closed.emit).toHaveBeenCalled();
    expect(openerFocusSpy).toHaveBeenCalled();

    opener.remove();
  }));

  it('stops scroll gate immediately when requireScrollToConfirm is turned off while open', fakeAsync(() => {
    const fixture = TestBed.createComponent(ModalComponent);
    const component = fixture.componentInstance;
    component.open = true;
    component.requireScrollToConfirm = true;

    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const body = getBodyElement(component);
    setBodyMetrics(body, { scrollTop: 0, clientHeight: 200, scrollHeight: 700 });
    component.emitBodyScroll();
    expect(component.effectiveConfirmDisabled()).toBeTrue();

    component.requireScrollToConfirm = false;
    component.ngOnChanges({
      requireScrollToConfirm: new SimpleChange(true, false, false)
    });

    expect(component.effectiveConfirmDisabled()).toBeFalse();
    component.ngOnDestroy();
  }));

  it('covers focus trap branches with removed target and hidden/inert elements', fakeAsync(() => {
    const fixture = TestBed.createComponent(ModalComponent);
    const component = fixture.componentInstance;
    component.open = true;
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const dialog = getDialogElement(component);
    const hidden = document.createElement('button');
    hidden.setAttribute('aria-hidden', 'true');
    const inert = document.createElement('button');
    inert.setAttribute('inert', '');
    const visible = document.createElement('button');
    dialog.append(hidden, inert, visible);

    const focusable = (component as any).getFocusableElements(dialog) as HTMLElement[];
    expect(focusable.includes(hidden)).toBeFalse();
    expect(focusable.includes(inert)).toBeFalse();
    expect(focusable.includes(visible)).toBeTrue();

    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    component.close();
    opener.remove();
    tick();
    expect(document.contains(opener)).toBeFalse();
  }));
});
