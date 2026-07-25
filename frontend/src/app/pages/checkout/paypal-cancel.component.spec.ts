import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';

import { PayPalCancelComponent } from './paypal-cancel.component';

const CHECKOUT_PAYPAL_PENDING_KEY = 'checkout_paypal_pending';

/**
 * PayPalCancelComponent renders the "PayPal payment cancelled" return screen and,
 * on construction, clears the pending-PayPal marker from localStorage. These specs
 * exercise the rendered DOM (breadcrumbs + the three navigation buttons) and every
 * branch of the constructor: the happy path, the swallowed-error path, and the
 * environment without localStorage (server-side rendering).
 */
describe('PayPalCancelComponent', () => {
  function configure(): void {
    TestBed.configureTestingModule({
      imports: [PayPalCancelComponent, RouterTestingModule, TranslateModule.forRoot()],
    });
  }

  function create(): ComponentFixture<PayPalCancelComponent> {
    configure();
    const fixture = TestBed.createComponent(PayPalCancelComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('creates and exposes the checkout breadcrumb trail', () => {
    const removeItem = spyOn(localStorage, 'removeItem');
    const fixture = create();

    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.componentInstance.crumbs).toEqual([
      { label: 'nav.home', url: '/' },
      { label: 'checkout.title', url: '/checkout' },
      { label: 'checkout.paypalCancelled' },
    ]);
    // Construction clears the pending marker via the happy localStorage path.
    expect(removeItem).toHaveBeenCalledWith(CHECKOUT_PAYPAL_PENDING_KEY);
  });

  it('renders the cancelled heading and the three return actions', () => {
    spyOn(localStorage, 'removeItem');
    const fixture = create();
    const host = fixture.nativeElement as HTMLElement;

    const heading = host.querySelector('h1');
    expect(heading?.textContent).toContain('checkout.paypalCancelled');

    const buttons = host.querySelectorAll('app-button');
    expect(buttons.length).toBe(3);

    const anchors = Array.from(host.querySelectorAll('app-button a')).map((a) =>
      a.getAttribute('href'),
    );
    expect(anchors).toEqual(['/checkout', '/cart', '/contact']);
  });

  it('swallows errors thrown while clearing the pending marker', () => {
    const removeItem = spyOn(localStorage, 'removeItem').and.throwError('quota');

    expect(() => create()).not.toThrow();
    expect(removeItem).toHaveBeenCalledWith(CHECKOUT_PAYPAL_PENDING_KEY);
  });

  it('does nothing when localStorage is unavailable (SSR)', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => undefined,
    });

    try {
      expect(() => create()).not.toThrow();
    } finally {
      if (original) {
        Object.defineProperty(window, 'localStorage', original);
      }
    }
  });
});
