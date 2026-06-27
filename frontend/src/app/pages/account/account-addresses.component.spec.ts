import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';

import { AccountAddressesComponent } from './account-addresses.component';
import { AccountComponent } from './account.component';
import { Address, AddressCreateRequest } from '../../core/account.service';

/**
 * A lightweight stand-in for the parent AccountComponent. The addresses
 * component only consumes a small slice of the parent's public surface, so the
 * fake exposes exactly those signals/properties/methods. Methods are spies so
 * tests can assert the template wires user actions to the parent correctly.
 */
interface FakeAccount {
  addressesLoading: WritableSignal<boolean>;
  addressesLoaded: WritableSignal<boolean>;
  addressesError: WritableSignal<string | null>;
  addresses: WritableSignal<Address[]>;
  showAddressForm: boolean;
  addressModel: AddressCreateRequest;
  openAddressForm: jasmine.Spy;
  loadAddresses: jasmine.Spy;
  saveAddress: jasmine.Spy;
  closeAddressForm: jasmine.Spy;
  setDefaultShipping: jasmine.Spy;
  setDefaultBilling: jasmine.Spy;
  editAddress: jasmine.Spy;
  duplicateAddress: jasmine.Spy;
  removeAddress: jasmine.Spy;
  addressesHasUnsavedChanges: jasmine.Spy;
  discardAddressChanges: jasmine.Spy;
}

function makeAddress(overrides: Partial<Address> = {}): Address {
  return {
    id: 'addr-1',
    label: 'home',
    phone: null,
    line1: '12 Baker Street',
    line2: null,
    city: 'London',
    region: null,
    postal_code: 'NW1',
    country: 'UK',
    is_default_shipping: false,
    is_default_billing: false,
    ...overrides,
  };
}

function makeFakeAccount(): FakeAccount {
  return {
    addressesLoading: signal(false),
    addressesLoaded: signal(false),
    addressesError: signal<string | null>(null),
    addresses: signal<Address[]>([]),
    showAddressForm: false,
    addressModel: {
      line1: '',
      city: '',
      postal_code: '',
      country: '',
    },
    openAddressForm: jasmine.createSpy('openAddressForm'),
    loadAddresses: jasmine.createSpy('loadAddresses'),
    saveAddress: jasmine.createSpy('saveAddress'),
    closeAddressForm: jasmine.createSpy('closeAddressForm'),
    setDefaultShipping: jasmine.createSpy('setDefaultShipping'),
    setDefaultBilling: jasmine.createSpy('setDefaultBilling'),
    editAddress: jasmine.createSpy('editAddress'),
    duplicateAddress: jasmine.createSpy('duplicateAddress'),
    removeAddress: jasmine.createSpy('removeAddress'),
    addressesHasUnsavedChanges: jasmine
      .createSpy('addressesHasUnsavedChanges')
      .and.returnValue(false),
    discardAddressChanges: jasmine.createSpy('discardAddressChanges'),
  };
}

describe('AccountAddressesComponent', () => {
  let account: FakeAccount;
  let fixture: ComponentFixture<AccountAddressesComponent>;
  let component: AccountAddressesComponent;

  function buttonByLabel(label: string): HTMLButtonElement | undefined {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    return buttons.find((b) => b.textContent?.trim() === label);
  }

  beforeEach(() => {
    account = makeFakeAccount();

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), AccountAddressesComponent],
      providers: [{ provide: AccountComponent, useValue: account }],
    });

    fixture = TestBed.createComponent(AccountAddressesComponent);
    component = fixture.componentInstance;
  });

  it('creates and injects the parent account component', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('shows the loading skeletons while addresses load for the first time', () => {
    account.addressesLoading.set(true);
    account.addressesLoaded.set(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('app-skeleton').length).toBe(2);
  });

  it('hides skeletons once addresses have loaded', () => {
    account.addressesLoading.set(true);
    account.addressesLoaded.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('app-skeleton').length).toBe(0);
  });

  it('opens the address form via the add button', () => {
    fixture.detectChanges();
    const addButton = buttonByLabel('account.addresses.add');
    expect(addButton).toBeDefined();

    addButton!.click();

    expect(account.openAddressForm).toHaveBeenCalledTimes(1);
  });

  it('renders the error banner and retries loading addresses', () => {
    account.addressesLoading.set(false);
    account.addressesError.set('account.addresses.loadError');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('account.addresses.loadError');
    const retry = buttonByLabel('shop.retry');
    expect(retry).toBeDefined();

    retry!.click();

    expect(account.loadAddresses).toHaveBeenCalledWith(true);
  });

  it('does not show the error banner while still loading', () => {
    account.addressesLoading.set(true);
    account.addressesError.set('account.addresses.loadError');
    fixture.detectChanges();

    expect(buttonByLabel('shop.retry')).toBeUndefined();
  });

  it('renders the address form and wires save/cancel to the parent', () => {
    account.showAddressForm = true;
    fixture.detectChanges();

    const form = fixture.nativeElement.querySelector('app-address-form');
    expect(form).toBeTruthy();

    const formDebug = fixture.debugElement.query(
      (de) => de.nativeElement.tagName?.toLowerCase() === 'app-address-form',
    );
    const payload: AddressCreateRequest = {
      line1: 'x',
      city: 'y',
      postal_code: 'z',
      country: 'c',
    };
    formDebug.componentInstance.save.emit(payload);
    formDebug.componentInstance.cancel.emit();

    expect(account.saveAddress).toHaveBeenCalledWith(payload);
    expect(account.closeAddressForm).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when loaded with no addresses and no open form', () => {
    account.addressesLoaded.set(true);
    account.addressesLoading.set(false);
    account.addressesError.set(null);
    account.addresses.set([]);
    account.showAddressForm = false;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('account.addresses.empty');
  });

  it('hides the empty state while the form is open', () => {
    account.addressesLoaded.set(true);
    account.addresses.set([]);
    account.showAddressForm = true;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('account.addresses.empty');
  });

  it('renders known label translations for home/work/other addresses', () => {
    account.addressesLoaded.set(true);
    account.addresses.set([
      makeAddress({ id: 'a', label: 'home' }),
      makeAddress({ id: 'b', label: 'work' }),
      makeAddress({ id: 'c', label: 'other' }),
    ]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('account.addresses.labels.home');
    expect(text).toContain('account.addresses.labels.work');
    expect(text).toContain('account.addresses.labels.other');
  });

  it('falls back to the custom label text when the label is non-standard', () => {
    account.addressesLoaded.set(true);
    account.addresses.set([makeAddress({ id: 'a', label: 'Holiday Home' })]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Holiday Home');
  });

  it('falls back to the generic address label when no label is provided', () => {
    account.addressesLoaded.set(true);
    account.addresses.set([makeAddress({ id: 'a', label: null })]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('account.addresses.labels.address');
  });

  it('shows the default shipping and billing badges only when set', () => {
    account.addressesLoaded.set(true);
    account.addresses.set([
      makeAddress({ id: 'a', is_default_shipping: true, is_default_billing: true }),
    ]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('account.addresses.defaultShipping');
    expect(text).toContain('account.addresses.defaultBilling');
    // The make-default buttons are hidden when already default.
    expect(buttonByLabel('account.addresses.makeDefaultShipping')).toBeUndefined();
    expect(buttonByLabel('account.addresses.makeDefaultBilling')).toBeUndefined();
  });

  it('offers make-default actions when an address is not yet default', () => {
    const addr = makeAddress({
      id: 'a',
      is_default_shipping: false,
      is_default_billing: false,
    });
    account.addressesLoaded.set(true);
    account.addresses.set([addr]);
    fixture.detectChanges();

    buttonByLabel('account.addresses.makeDefaultShipping')!.click();
    buttonByLabel('account.addresses.makeDefaultBilling')!.click();

    expect(account.setDefaultShipping).toHaveBeenCalledWith(addr);
    expect(account.setDefaultBilling).toHaveBeenCalledWith(addr);
  });

  it('wires edit, duplicate and delete actions for an address', () => {
    const addr = makeAddress({ id: 'addr-42' });
    account.addressesLoaded.set(true);
    account.addresses.set([addr]);
    fixture.detectChanges();

    buttonByLabel('account.addresses.edit')!.click();
    buttonByLabel('account.addresses.duplicate')!.click();
    buttonByLabel('account.addresses.delete')!.click();

    expect(account.editAddress).toHaveBeenCalledWith(addr);
    expect(account.duplicateAddress).toHaveBeenCalledWith(addr);
    expect(account.removeAddress).toHaveBeenCalledWith('addr-42');
  });

  it('renders the optional line2, region and phone details when present', () => {
    account.addressesLoaded.set(true);
    account.addresses.set([
      makeAddress({
        id: 'a',
        line1: '1 Main St',
        line2: 'Apt 5',
        city: 'Paris',
        region: 'IDF',
        postal_code: '75001',
        country: 'France',
        phone: '+33123456789',
      }),
    ]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('1 Main St');
    expect(text).toContain('Apt 5');
    expect(text).toContain('Paris');
    expect(text).toContain('IDF');
    expect(text).toContain('75001');
    expect(text).toContain('France');
    expect(text).toContain('+33123456789');
  });

  it('omits optional details when they are absent', () => {
    account.addressesLoaded.set(true);
    account.addresses.set([
      makeAddress({
        id: 'a',
        line1: 'Only line',
        line2: null,
        region: null,
        phone: null,
      }),
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.rounded-lg.border').length).toBeGreaterThan(0);
    expect(fixture.nativeElement.textContent).toContain('Only line');
  });

  it('delegates hasUnsavedChanges to the parent account component', () => {
    account.addressesHasUnsavedChanges.and.returnValue(true);
    expect(component.hasUnsavedChanges()).toBeTrue();

    account.addressesHasUnsavedChanges.and.returnValue(false);
    expect(component.hasUnsavedChanges()).toBeFalse();

    expect(account.addressesHasUnsavedChanges).toHaveBeenCalledTimes(2);
  });

  it('delegates discardUnsavedChanges to the parent account component', () => {
    component.discardUnsavedChanges();
    expect(account.discardAddressChanges).toHaveBeenCalledTimes(1);
  });
});
