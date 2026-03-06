import { fakeAsync, tick } from '@angular/core/testing';

import { CheckoutComponent } from './checkout.component';

function createComponent(): any {
  const component: any = Object.create(CheckoutComponent.prototype);
  component.syncing = false;
  component.syncQueued = false;
  component.checkoutFlowCompleted = false;
  component.placing = true;
  component.errorMessage = '';
  component.liveAssertive = '';
  component.translate = { instant: (key: string) => key };
  component.auth = {
    isAuthenticated: jasmine.createSpy('isAuthenticated').and.returnValue(true),
    user: jasmine.createSpy('user').and.returnValue(null),
  };
  component.persistAddressIfRequested = jasmine.createSpy('persistAddressIfRequested');
  component.redirectToPaymentUrl = jasmine.createSpy('redirectToPaymentUrl');
  component.buildSuccessSummary = jasmine.createSpy('buildSuccessSummary').and.returnValue({ order_id: 'o-1' });
  component.announceAssertive = jasmine.createSpy('announceAssertive');
  component.focusGlobalError = jasmine.createSpy('focusGlobalError');
  component.detectChangesSafe = jasmine.createSpy('detectChangesSafe');
  component.ensurePaymentMethodAvailable = jasmine.createSpy('ensurePaymentMethodAvailable');
  component.shippingCountryInput = '';
  component.shippingCountryError = '';
  component.address = { country: 'RO' };
  component.billing = { country: 'RO' };
  component.billingSameAsShipping = false;
  component.resolveCountryCode = jasmine.createSpy('resolveCountryCode').and.returnValue('RO');
  component.countryInputFromCode = jasmine.createSpy('countryInputFromCode').and.callFake((code: string) => code);
  return component;
}

describe('CheckoutComponent coverage wave 2', () => {
  it('returns first visible focusable element while skipping hidden and disabled controls', () => {
    const component = createComponent();
    const container = document.createElement('div');
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    const disabled = document.createElement('button');
    disabled.disabled = true;
    const valid = document.createElement('input');
    container.append(hidden, disabled, valid);
    spyOn(component, 'isElementVisible').and.returnValue(true);

    const selected = component.findFirstFocusableElement(container);

    expect(selected).toBe(valid);
  });

  it('focuses first focusable element after smooth step scroll', fakeAsync(() => {
    const component = createComponent();
    const step = document.createElement('section');
    const button = document.createElement('button');
    step.id = 'checkout-step-wave2';
    step.appendChild(button);
    document.body.appendChild(step);
    try {
      spyOn(step, 'scrollIntoView').and.stub();
      spyOn(component, 'findFirstFocusableElement').and.returnValue(button);
      const focusOnlySpy = spyOn(component, 'focusOnly').and.stub();

      component.scrollToStep(step.id);
      tick();

      expect(focusOnlySpy).toHaveBeenCalledWith(button);
    } finally {
      step.remove();
    }
  }));

  it('routes netopia checkout responses through secure redirect handling', () => {
    const component = createComponent();
    component.paymentMethod = 'netopia';

    component.handleCheckoutStartResponse({
      order_id: 'order-netopia',
      reference_code: 'REF-NETOPIA',
      netopia_payment_url: 'https://secure.netopia-payments.com/pay',
    } as any);

    expect(component.persistAddressIfRequested).toHaveBeenCalled();
    expect(component.redirectToPaymentUrl).toHaveBeenCalledWith(
      'https://secure.netopia-payments.com/pay',
      ['mobilpay.ro', 'netopia-payments.com']
    );
  });

  it('applies checkout finalize fallback messaging when request is unresolved', () => {
    const component = createComponent();

    component.handleCheckoutFinalize(false);

    expect(component.placing).toBeFalse();
    expect(component.errorMessage).toBe('checkout.checkoutFailed');
    expect(component.announceAssertive).toHaveBeenCalledWith('checkout.checkoutFailed');
    expect(component.focusGlobalError).toHaveBeenCalled();
    expect(component.detectChangesSafe).toHaveBeenCalledTimes(2);
  });

  it('sets shipping-country validation errors on invalid user input', () => {
    const component = createComponent();
    component.shippingCountryInput = 'invalid-country';
    component.resolveCountryCode.and.returnValue(null);

    component.normalizeShippingCountry();

    expect(component.shippingCountryError).toBe('checkout.countryInvalid');
    expect(component.ensurePaymentMethodAvailable).not.toHaveBeenCalled();
  });
});
