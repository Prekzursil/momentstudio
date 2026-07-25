import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';

import { StripeCancelComponent } from './stripe-cancel.component';

const CHECKOUT_STRIPE_PENDING_KEY = 'checkout_stripe_pending';

/**
 * StripeCancelComponent renders the Stripe "payment cancelled" screen and, on
 * construction, clears the pending-checkout marker from localStorage. These
 * specs assert the rendered DOM contract (breadcrumbs, copy, action buttons)
 * plus every branch of the constructor's localStorage cleanup: the happy path,
 * the missing-localStorage guard, and the throwing-removeItem catch.
 */
describe('StripeCancelComponent', () => {
  let originalLocalStorageDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    TestBed.configureTestingModule({
      imports: [StripeCancelComponent, RouterTestingModule, TranslateModule.forRoot()],
    });
  });

  afterEach(() => {
    // Restore the real localStorage binding so later specs are unaffected.
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(window, 'localStorage', originalLocalStorageDescriptor);
    }
    window.localStorage.removeItem(CHECKOUT_STRIPE_PENDING_KEY);
  });

  it('creates and exposes the breadcrumb trail', () => {
    const fixture = TestBed.createComponent(StripeCancelComponent);
    const cmp = fixture.componentInstance;

    expect(cmp).toBeTruthy();
    expect(cmp.crumbs).toEqual([
      { label: 'nav.home', url: '/' },
      { label: 'checkout.title', url: '/checkout' },
      { label: 'checkout.stripeCancelled' },
    ]);
  });

  it('renders the cancelled heading and three action links', () => {
    const fixture = TestBed.createComponent(StripeCancelComponent);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;

    // Heading uses the untranslated key (no translations loaded in TranslateModule.forRoot()).
    expect(host.querySelector('h1')?.textContent).toContain('checkout.stripeCancelled');

    // RouterTestingModule resolves each routerLink into a real href on the anchor.
    const hrefs = Array.from(host.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/checkout');
    expect(hrefs).toContain('/cart');
    expect(hrefs).toContain('/contact');
  });

  it('removes the pending-checkout marker from localStorage on construction', () => {
    window.localStorage.setItem(CHECKOUT_STRIPE_PENDING_KEY, 'order-123');

    TestBed.createComponent(StripeCancelComponent);

    expect(window.localStorage.getItem(CHECKOUT_STRIPE_PENDING_KEY)).toBeNull();
  });

  it('returns early without touching storage when localStorage is undefined', () => {
    // Simulate a non-browser / privacy-locked environment where the global is absent.
    Object.defineProperty(window, 'localStorage', { configurable: true, value: undefined });

    expect(() => TestBed.createComponent(StripeCancelComponent)).not.toThrow();
  });

  it('swallows errors thrown by localStorage.removeItem', () => {
    const removeItem = jasmine.createSpy('removeItem').and.throwError('quota');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { removeItem } as unknown as Storage,
    });

    expect(() => TestBed.createComponent(StripeCancelComponent)).not.toThrow();
    expect(removeItem).toHaveBeenCalledWith(CHECKOUT_STRIPE_PENDING_KEY);
  });
});
