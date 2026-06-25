import { TestBed } from '@angular/core/testing';

import { CheckoutShippingStepComponent } from './checkout-shipping-step.component';

/**
 * CheckoutShippingStepComponent is a thin presentational wrapper that delegates
 * every property and method to an injected `vm` view-model. These specs verify
 * the delegation contract: getters read from `vm`, setters write to `vm`, and
 * methods forward their arguments to the matching `vm` method.
 */
describe('CheckoutShippingStepComponent', () => {
  const readOnlyGetters = [
    'auth',
    'roCounties',
    'roCities',
    'phoneCountries',
    'countries',
    'currency',
    'savedAddresses',
    'savedAddressesLoading',
    'savedAddressesError',
    'guestVerificationSent',
    'guestEmailVerified',
    'guestSendingCode',
    'guestConfirmingCode',
    'guestEmailError',
    'guestResendSecondsLeft',
    'address',
    'billing',
    'courier',
    'deliveryType',
    'deliveryError',
    'deliveryLockerAllowed',
    'addressError',
  ];

  const readWriteProps = [
    'selectedShippingAddressId',
    'selectedBillingAddressId',
    'guestCreateAccount',
    'guestUsername',
    'guestPassword',
    'guestPasswordConfirm',
    'guestShowPassword',
    'guestShowPasswordConfirm',
    'guestFirstName',
    'guestMiddleName',
    'guestLastName',
    'guestDob',
    'guestPhoneCountry',
    'guestPhoneNational',
    'guestVerificationToken',
    'shippingPhoneCountry',
    'shippingPhoneNational',
    'billingSameAsShipping',
    'invoiceEnabled',
    'invoiceCompany',
    'invoiceVatId',
    'shippingCountryInput',
    'billingCountryInput',
    'shippingCountryError',
    'billingCountryError',
    'locker',
    'saveAddress',
    'saveDefaultShipping',
    'saveDefaultBilling',
  ];

  const returningMethods = [
    'step1Complete',
    'step2Complete',
    'guestPhoneE164',
    'shippingPhoneRequired',
    'shippingPhoneE164',
    'quoteShipping',
  ];

  const voidMethods = [
    'toggleGuestPassword',
    'toggleGuestPasswordConfirm',
    'onGuestPhoneChanged',
    'onEmailChanged',
    'requestGuestEmailVerification',
    'confirmGuestEmailVerification',
    'applySelectedShippingAddress',
    'applySelectedBillingAddress',
    'copyShippingToBilling',
    'onBillingSameAsShippingChanged',
    'normalizeShippingCountry',
    'normalizeBillingCountry',
  ];

  const argReturningMethods = [
    'formatSavedAddress',
    'formatCountryOption',
    'courierAllowed',
    'courierEstimateKey',
    'courierEstimateParams',
  ];

  const argVoidMethods = ['scrollToStep', 'onGuestCreateAccountChanged', 'openEditSavedAddress'];

  // setCourier / setDeliveryType take a single argument and return void.
  const argVoidSetters = ['setDeliveryType', 'setCourier'];

  function build(): {
    cmp: CheckoutShippingStepComponent;
    vm: Record<string, unknown>;
  } {
    const vm: Record<string, unknown> = {};
    for (const name of [...readOnlyGetters, ...readWriteProps]) {
      vm[name] = Symbol(name);
    }
    for (const name of [...returningMethods, ...argReturningMethods]) {
      vm[name] = jasmine.createSpy(name).and.returnValue(Symbol(`${name}:result`));
    }
    for (const name of [...voidMethods, ...argVoidMethods, ...argVoidSetters]) {
      vm[name] = jasmine.createSpy(name);
    }

    TestBed.configureTestingModule({ imports: [CheckoutShippingStepComponent] }).overrideComponent(
      CheckoutShippingStepComponent,
      { set: { template: '', imports: [] } },
    );
    const fixture = TestBed.createComponent(CheckoutShippingStepComponent);
    const cmp = fixture.componentInstance;
    (cmp as unknown as { vm: unknown }).vm = vm;
    return { cmp, vm };
  }

  it('creates', () => {
    const { cmp } = build();
    expect(cmp).toBeTruthy();
  });

  it('delegates every read-only getter to the view-model', () => {
    const { cmp, vm } = build();
    for (const name of readOnlyGetters) {
      expect((cmp as unknown as Record<string, unknown>)[name]).toBe(vm[name]);
    }
  });

  it('delegates read/write properties to the view-model', () => {
    const { cmp, vm } = build();
    for (const name of readWriteProps) {
      const ref = cmp as unknown as Record<string, unknown>;
      // getter reads current vm value
      expect(ref[name]).toBe(vm[name]);
      // setter writes back to vm
      const next = Symbol(`${name}:next`);
      ref[name] = next;
      expect(vm[name]).toBe(next);
      expect(ref[name]).toBe(next);
    }
  });

  it('forwards no-argument returning methods to the view-model', () => {
    const { cmp, vm } = build();
    for (const name of returningMethods) {
      const result = (cmp as unknown as Record<string, () => unknown>)[name]();
      expect(vm[name] as jasmine.Spy).toHaveBeenCalled();
      expect(result).toBe((vm[name] as jasmine.Spy).calls.mostRecent().returnValue);
    }
  });

  it('forwards no-argument void methods to the view-model', () => {
    const { cmp, vm } = build();
    for (const name of voidMethods) {
      (cmp as unknown as Record<string, () => void>)[name]();
      expect(vm[name] as jasmine.Spy).toHaveBeenCalled();
    }
  });

  it('forwards single-argument returning methods to the view-model', () => {
    const { cmp, vm } = build();
    for (const name of argReturningMethods) {
      const arg = Symbol(`${name}:arg`);
      const result = (cmp as unknown as Record<string, (a: unknown) => unknown>)[name](arg);
      expect(vm[name] as jasmine.Spy).toHaveBeenCalledWith(arg);
      expect(result).toBe((vm[name] as jasmine.Spy).calls.mostRecent().returnValue);
    }
  });

  it('forwards single-argument void methods to the view-model', () => {
    const { cmp, vm } = build();
    for (const name of [...argVoidMethods, ...argVoidSetters]) {
      const arg = Symbol(`${name}:arg`);
      (cmp as unknown as Record<string, (a: unknown) => void>)[name](arg);
      expect(vm[name] as jasmine.Spy).toHaveBeenCalledWith(arg);
    }
  });
});
