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
});
