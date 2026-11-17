import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { AccountAddressesComponent } from './account-addresses.component';
import { AccountComponent } from './account.component';

describe('AccountAddressesComponent helpers (golden WU)', () => {
  let addressesHasUnsavedChanges: jasmine.Spy;
  let discardAddressChanges: jasmine.Spy;

  beforeEach(() => {
    addressesHasUnsavedChanges = jasmine
      .createSpy('addressesHasUnsavedChanges')
      .and.returnValue(false);
    discardAddressChanges = jasmine.createSpy('discardAddressChanges');
    TestBed.configureTestingModule({
      imports: [AccountAddressesComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: AccountComponent,
          useValue: {
            addressesLoading: () => false,
            addressesLoaded: () => true,
            addressesError: () => null,
            addresses: () => [],
            showAddressForm: false,
            addressModel: {},
            openAddressForm: jasmine.createSpy('openAddressForm'),
            loadAddresses: jasmine.createSpy('loadAddresses'),
            saveAddress: jasmine.createSpy('saveAddress'),
            closeAddressForm: jasmine.createSpy('closeAddressForm'),
            setDefaultShipping: jasmine.createSpy('setDefaultShipping'),
            setDefaultBilling: jasmine.createSpy('setDefaultBilling'),
            editAddress: jasmine.createSpy('editAddress'),
            duplicateAddress: jasmine.createSpy('duplicateAddress'),
            removeAddress: jasmine.createSpy('removeAddress'),
            addressesHasUnsavedChanges,
            discardAddressChanges,
          },
        },
      ],
    });
  });

  function create() {
    const fixture = TestBed.createComponent(AccountAddressesComponent);
    return { fixture, cmp: fixture.componentInstance };
  }

  it('hasUnsavedChanges delegates to account.addressesHasUnsavedChanges', () => {
    const { fixture, cmp } = create();
    addressesHasUnsavedChanges.and.returnValue(false);
    expect(cmp.hasUnsavedChanges()).toBe(false);
    addressesHasUnsavedChanges.and.returnValue(true);
    expect(cmp.hasUnsavedChanges()).toBe(true);
    expect(addressesHasUnsavedChanges).toHaveBeenCalled();
    fixture.destroy();
  });

  it('discardUnsavedChanges delegates to account.discardAddressChanges', () => {
    const { fixture, cmp } = create();
    cmp.discardUnsavedChanges();
    expect(discardAddressChanges).toHaveBeenCalled();
    fixture.destroy();
  });

  it('discardUnsavedChanges clears unsaved state reported by hasUnsavedChanges', () => {
    const { fixture, cmp } = create();
    let dirty = true;
    addressesHasUnsavedChanges.and.callFake(() => dirty);
    discardAddressChanges.and.callFake(() => {
      dirty = false;
    });
    expect(cmp.hasUnsavedChanges()).toBe(true);
    cmp.discardUnsavedChanges();
    expect(discardAddressChanges).toHaveBeenCalled();
    expect(cmp.hasUnsavedChanges()).toBe(false);
    fixture.destroy();
  });
});
