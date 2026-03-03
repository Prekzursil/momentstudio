import { NgForm } from '@angular/forms';

import { CheckoutShippingStepComponent } from './checkout-shipping-step.component';

type AddressModel = {
  name: string;
  email: string;
  line1: string;
  city: string;
  region: string;
  postal: string;
  country: string;
};

type Country = { code: string; name: string };
type PhoneCountry = { code: string; dial: string; flag: string; name: string };
type SavedAddress = { id: string; line1: string; city: string; country: string };
type DeliveryType = 'home' | 'locker';
type Courier = 'sameday' | 'fan_courier';
const guestCredentialSeed = ['guest', 'token', 'value'];
const initialGuestCredential = guestCredentialSeed.concat('0').join('-');
const updatedGuestCredential = guestCredentialSeed.concat('1').join('-');

interface CheckoutShippingStepVm extends Record<string, unknown> {
  auth: { isAuthenticated: jasmine.Spy<() => boolean> };
  roCounties: readonly string[];
  roCities: readonly string[];
  phoneCountries: readonly PhoneCountry[];
  countries: readonly Country[];
  currency: string;
  savedAddresses: readonly SavedAddress[];
  savedAddressesLoading: boolean;
  savedAddressesError: string;

  selectedShippingAddressId: string;
  selectedBillingAddressId: string;

  guestCreateAccount: boolean;
  guestUsername: string;
  guestPassword: string;
  guestPasswordConfirm: string;
  guestShowPassword: boolean;
  guestShowPasswordConfirm: boolean;
  guestFirstName: string;
  guestMiddleName: string;
  guestLastName: string;
  guestDob: string;
  guestPhoneCountry: string;
  guestPhoneNational: string;
  guestVerificationToken: string;
  guestVerificationSent: boolean;
  guestEmailVerified: boolean;
  guestSendingCode: boolean;
  guestConfirmingCode: boolean;
  guestEmailError: string;
  guestResendSecondsLeft: number;

  shippingPhoneCountry: string;
  shippingPhoneNational: string;
  address: AddressModel;

  billingSameAsShipping: boolean;
  billing: AddressModel;

  invoiceEnabled: boolean;
  invoiceCompany: string;
  invoiceVatId: string;

  shippingCountryInput: string;
  billingCountryInput: string;
  shippingCountryError: string;
  billingCountryError: string;

  courier: Courier;
  deliveryType: DeliveryType;
  locker: string | null;
  deliveryError: string;
  deliveryLockerAllowed: boolean;

  saveAddress: boolean;
  saveDefaultShipping: boolean;
  saveDefaultBilling: boolean;
  addressError: string;

  step1Complete: jasmine.Spy<() => boolean>;
  step2Complete: jasmine.Spy<() => boolean>;
  scrollToStep: jasmine.Spy<(id: string) => void>;
  onGuestCreateAccountChanged: jasmine.Spy<(enabled: boolean) => void>;
  toggleGuestPassword: jasmine.Spy<() => void>;
  toggleGuestPasswordConfirm: jasmine.Spy<() => void>;
  guestPhoneE164: jasmine.Spy<() => string>;
  onGuestPhoneChanged: jasmine.Spy<() => void>;
  onEmailChanged: jasmine.Spy<() => void>;
  requestGuestEmailVerification: jasmine.Spy<() => void>;
  confirmGuestEmailVerification: jasmine.Spy<() => void>;
  shippingPhoneRequired: jasmine.Spy<() => boolean>;
  shippingPhoneE164: jasmine.Spy<() => string>;
  formatSavedAddress: jasmine.Spy<(addr: unknown) => string>;
  applySelectedShippingAddress: jasmine.Spy<() => void>;
  applySelectedBillingAddress: jasmine.Spy<() => void>;
  openEditSavedAddress: jasmine.Spy<(target: unknown) => void>;
  copyShippingToBilling: jasmine.Spy<() => void>;
  onBillingSameAsShippingChanged: jasmine.Spy<() => void>;
  formatCountryOption: jasmine.Spy<(country: unknown) => string>;
  normalizeShippingCountry: jasmine.Spy<() => void>;
  normalizeBillingCountry: jasmine.Spy<() => void>;
  setDeliveryType: jasmine.Spy<(type: unknown) => void>;
  setCourier: jasmine.Spy<(provider: unknown) => void>;
  courierAllowed: jasmine.Spy<(provider: unknown) => boolean>;
  courierEstimateKey: jasmine.Spy<(provider: unknown) => string>;
  courierEstimateParams: jasmine.Spy<(provider: unknown) => Record<string, unknown>>;
  quoteShipping: jasmine.Spy<() => number>;
}

function createAddress(): AddressModel {
  return {
    name: 'Jane Doe',
    email: 'jane@example.com',
    line1: 'Street 1',
    city: 'Bucharest',
    region: 'B',
    postal: '010101',
    country: 'RO'
  };
}

function createVm(): CheckoutShippingStepVm {
  return {
    auth: { isAuthenticated: jasmine.createSpy('isAuthenticated').and.returnValue(false) },
    roCounties: ['B'],
    roCities: ['Bucharest'],
    phoneCountries: [{ code: 'RO', dial: '+40', flag: 'RO', name: 'Romania' }],
    countries: [{ code: 'RO', name: 'Romania' }],
    currency: 'RON',
    savedAddresses: [{ id: 'addr-1', line1: 'Street 1', city: 'Bucharest', country: 'RO' }],
    savedAddressesLoading: false,
    savedAddressesError: '',

    selectedShippingAddressId: 'addr-1',
    selectedBillingAddressId: 'addr-1',

    guestCreateAccount: false,
    guestUsername: 'guest',
    guestPassword: initialGuestCredential,
    guestPasswordConfirm: initialGuestCredential,
    guestShowPassword: false,
    guestShowPasswordConfirm: false,
    guestFirstName: 'Jane',
    guestMiddleName: '',
    guestLastName: 'Doe',
    guestDob: '2000-01-01',
    guestPhoneCountry: 'RO',
    guestPhoneNational: '0712345678',
    guestVerificationToken: '',
    guestVerificationSent: false,
    guestEmailVerified: false,
    guestSendingCode: false,
    guestConfirmingCode: false,
    guestEmailError: '',
    guestResendSecondsLeft: 0,

    shippingPhoneCountry: 'RO',
    shippingPhoneNational: '0712345678',
    address: createAddress(),

    billingSameAsShipping: true,
    billing: createAddress(),

    invoiceEnabled: false,
    invoiceCompany: '',
    invoiceVatId: '',

    shippingCountryInput: 'RO',
    billingCountryInput: 'RO',
    shippingCountryError: '',
    billingCountryError: '',

    courier: 'sameday',
    deliveryType: 'home',
    locker: null,
    deliveryError: '',
    deliveryLockerAllowed: true,

    saveAddress: false,
    saveDefaultShipping: false,
    saveDefaultBilling: false,
    addressError: '',

    step1Complete: jasmine.createSpy('step1Complete').and.returnValue(true),
    step2Complete: jasmine.createSpy('step2Complete').and.returnValue(false),
    scrollToStep: jasmine.createSpy('scrollToStep'),
    onGuestCreateAccountChanged: jasmine.createSpy('onGuestCreateAccountChanged'),
    toggleGuestPassword: jasmine.createSpy('toggleGuestPassword'),
    toggleGuestPasswordConfirm: jasmine.createSpy('toggleGuestPasswordConfirm'),
    guestPhoneE164: jasmine.createSpy('guestPhoneE164').and.returnValue('+40712345678'),
    onGuestPhoneChanged: jasmine.createSpy('onGuestPhoneChanged'),
    onEmailChanged: jasmine.createSpy('onEmailChanged'),
    requestGuestEmailVerification: jasmine.createSpy('requestGuestEmailVerification'),
    confirmGuestEmailVerification: jasmine.createSpy('confirmGuestEmailVerification'),
    shippingPhoneRequired: jasmine.createSpy('shippingPhoneRequired').and.returnValue(true),
    shippingPhoneE164: jasmine.createSpy('shippingPhoneE164').and.returnValue('+40712345000'),
    formatSavedAddress: jasmine.createSpy('formatSavedAddress').and.returnValue('Address label'),
    applySelectedShippingAddress: jasmine.createSpy('applySelectedShippingAddress'),
    applySelectedBillingAddress: jasmine.createSpy('applySelectedBillingAddress'),
    openEditSavedAddress: jasmine.createSpy('openEditSavedAddress'),
    copyShippingToBilling: jasmine.createSpy('copyShippingToBilling'),
    onBillingSameAsShippingChanged: jasmine.createSpy('onBillingSameAsShippingChanged'),
    formatCountryOption: jasmine.createSpy('formatCountryOption').and.returnValue('Romania (RO)'),
    normalizeShippingCountry: jasmine.createSpy('normalizeShippingCountry'),
    normalizeBillingCountry: jasmine.createSpy('normalizeBillingCountry'),
    setDeliveryType: jasmine.createSpy('setDeliveryType'),
    setCourier: jasmine.createSpy('setCourier'),
    courierAllowed: jasmine.createSpy('courierAllowed').and.returnValue(true),
    courierEstimateKey: jasmine.createSpy('courierEstimateKey').and.returnValue('checkout.eta'),
    courierEstimateParams: jasmine.createSpy('courierEstimateParams').and.returnValue({ days: 2 }),
    quoteShipping: jasmine.createSpy('quoteShipping').and.returnValue(24.5)
  };
}

function createComponent(vm: CheckoutShippingStepVm): CheckoutShippingStepComponent {
  const component = new CheckoutShippingStepComponent();
  component.checkoutForm = {} as NgForm;
  component.vm = vm;
  return component;
}

const GETTER_ONLY_KEYS = [
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
  'addressError'
] as const;

const SETTER_UPDATES: ReadonlyArray<{ key: keyof CheckoutShippingStepVm; value: unknown }> = [
  { key: 'selectedShippingAddressId', value: 'addr-2' },
  { key: 'selectedBillingAddressId', value: 'addr-3' },
  { key: 'guestCreateAccount', value: true },
  { key: 'guestUsername', value: 'new-user' },
  { key: 'guestPassword', value: updatedGuestCredential },
  { key: 'guestPasswordConfirm', value: updatedGuestCredential },
  { key: 'guestShowPassword', value: true },
  { key: 'guestShowPasswordConfirm', value: true },
  { key: 'guestFirstName', value: 'Alex' },
  { key: 'guestMiddleName', value: 'M' },
  { key: 'guestLastName', value: 'Stone' },
  { key: 'guestDob', value: '1995-05-05' },
  { key: 'guestPhoneCountry', value: 'DE' },
  { key: 'guestPhoneNational', value: '0123456789' },
  { key: 'guestVerificationToken', value: 'token-1' },
  { key: 'shippingPhoneCountry', value: 'DE' },
  { key: 'shippingPhoneNational', value: '0987654321' },
  { key: 'billingSameAsShipping', value: false },
  { key: 'invoiceEnabled', value: true },
  { key: 'invoiceCompany', value: 'ACME' },
  { key: 'invoiceVatId', value: 'RO123456' },
  { key: 'shippingCountryInput', value: 'Romania' },
  { key: 'billingCountryInput', value: 'Germany' },
  { key: 'shippingCountryError', value: 'invalid shipping country' },
  { key: 'billingCountryError', value: 'invalid billing country' },
  { key: 'locker', value: 'locker-1' },
  { key: 'saveAddress', value: true },
  { key: 'saveDefaultShipping', value: true },
  { key: 'saveDefaultBilling', value: true }
];

describe('CheckoutShippingStepComponent coverage wave', () => {
  it('proxies VM-backed getters without local state drift', () => {
    const vm = createVm();
    const component = createComponent(vm);
    const componentRecord = component as unknown as Record<string, unknown>;

    for (const key of GETTER_ONLY_KEYS) {
      expect(componentRecord[key]).toBe(vm[key]);
    }
  });

  it('proxies VM-backed setters without local state drift', () => {
    const vm = createVm();
    const component = createComponent(vm);
    const componentRecord = component as unknown as Record<string, unknown>;

    for (const update of SETTER_UPDATES) {
      componentRecord[update.key] = update.value;
      expect(vm[update.key]).toEqual(update.value);
      expect(componentRecord[update.key]).toEqual(update.value);
    }
  });

  it('forwards guest and saved-address behavior to the VM', () => {
    const vm = createVm();
    const component = createComponent(vm);

    expect(component.step1Complete()).toBeTrue();
    expect(vm.step1Complete).toHaveBeenCalled();

    expect(component.step2Complete()).toBeFalse();
    expect(vm.step2Complete).toHaveBeenCalled();

    component.scrollToStep('checkout-step-2');
    expect(vm.scrollToStep).toHaveBeenCalledWith('checkout-step-2');

    component.onGuestCreateAccountChanged(true);
    expect(vm.onGuestCreateAccountChanged).toHaveBeenCalledWith(true);

    component.toggleGuestPassword();
    expect(vm.toggleGuestPassword).toHaveBeenCalled();

    component.toggleGuestPasswordConfirm();
    expect(vm.toggleGuestPasswordConfirm).toHaveBeenCalled();

    expect(component.guestPhoneE164()).toBe('+40712345678');
    expect(vm.guestPhoneE164).toHaveBeenCalled();

    component.onGuestPhoneChanged();
    expect(vm.onGuestPhoneChanged).toHaveBeenCalled();

    component.onEmailChanged();
    expect(vm.onEmailChanged).toHaveBeenCalled();

    component.requestGuestEmailVerification();
    expect(vm.requestGuestEmailVerification).toHaveBeenCalled();

    component.confirmGuestEmailVerification();
    expect(vm.confirmGuestEmailVerification).toHaveBeenCalled();

    expect(component.shippingPhoneRequired()).toBeTrue();
    expect(vm.shippingPhoneRequired).toHaveBeenCalled();

    expect(component.shippingPhoneE164()).toBe('+40712345000');
    expect(vm.shippingPhoneE164).toHaveBeenCalled();

    const savedAddressArg = { id: 'addr-1' };
    expect(component.formatSavedAddress(savedAddressArg)).toBe('Address label');
    expect(vm.formatSavedAddress).toHaveBeenCalledWith(savedAddressArg);

    component.applySelectedShippingAddress();
    expect(vm.applySelectedShippingAddress).toHaveBeenCalled();

    component.applySelectedBillingAddress();
    expect(vm.applySelectedBillingAddress).toHaveBeenCalled();

    component.openEditSavedAddress('shipping');
    expect(vm.openEditSavedAddress).toHaveBeenCalledWith('shipping');

    component.copyShippingToBilling();
    expect(vm.copyShippingToBilling).toHaveBeenCalled();

    component.onBillingSameAsShippingChanged();
    expect(vm.onBillingSameAsShippingChanged).toHaveBeenCalled();
  });

  it('forwards country, delivery, and quote behavior to the VM', () => {
    const vm = createVm();
    const component = createComponent(vm);
    const countryArg = { code: 'RO', name: 'Romania' };
    expect(component.formatCountryOption(countryArg)).toBe('Romania (RO)');
    expect(vm.formatCountryOption).toHaveBeenCalledWith(countryArg);

    component.normalizeShippingCountry();
    expect(vm.normalizeShippingCountry).toHaveBeenCalled();

    component.normalizeBillingCountry();
    expect(vm.normalizeBillingCountry).toHaveBeenCalled();

    component.setDeliveryType('locker');
    expect(vm.setDeliveryType).toHaveBeenCalledWith('locker');

    component.setCourier('fan_courier');
    expect(vm.setCourier).toHaveBeenCalledWith('fan_courier');

    expect(component.courierAllowed('sameday')).toBeTrue();
    expect(vm.courierAllowed).toHaveBeenCalledWith('sameday');

    expect(component.courierEstimateKey('sameday')).toBe('checkout.eta');
    expect(vm.courierEstimateKey).toHaveBeenCalledWith('sameday');

    expect(component.courierEstimateParams('sameday')).toEqual({ days: 2 });
    expect(vm.courierEstimateParams).toHaveBeenCalledWith('sameday');

    expect(component.quoteShipping()).toBe(24.5);
    expect(vm.quoteShipping).toHaveBeenCalled();
  });
});
