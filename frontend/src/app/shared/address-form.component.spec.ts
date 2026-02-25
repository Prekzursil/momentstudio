import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AddressFormComponent } from './address-form.component';

describe('AddressFormComponent', () => {
  registerAddressFormSetup();
  defineInvalidSubmitSpec();
  defineValidSubmitSpec();
  defineUseAsBillingSpec();
});

const registerAddressFormSetup = (): void => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AddressFormComponent, TranslateModule.forRoot()]
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        addressForm: {
          label: 'Label',
          line1: 'Address line 1',
          line2: 'Address line 2',
          defaultShipping: 'Set as default shipping',
          defaultBilling: 'Set as default billing',
          useAsBillingToo: 'Use as billing too',
          cancel: 'Cancel',
          save: 'Save'
        },
        checkout: {
          city: 'City',
          region: 'County / State',
          regionSelect: 'Select a county',
          postal: 'Postal code',
          country: 'Country',
          countrySelect: 'Select a country'
        },
        validation: { required: 'Required' }
      },
      true
    );
    translate.use('en');
  });
};

const defineInvalidSubmitSpec = (): void => {
  it('does not emit save when form is invalid', () => {
    const fixture = TestBed.createComponent(AddressFormComponent);
    const component = fixture.componentInstance;
    spyOn(component.save, 'emit');
    component.submit({ valid: false } as any);
    expect(component.save.emit).not.toHaveBeenCalled();
  });
};

const defineValidSubmitSpec = (): void => {
  it('emits save when form is valid', () => {
    const fixture = TestBed.createComponent(AddressFormComponent);
    const component = fixture.componentInstance;
    spyOn(component.save, 'emit');
    component.model = { line1: '123 Main', city: 'Bucharest', postal_code: '010203', country: 'RO' };
    component.submit({ valid: true } as any);
    expect(component.save.emit).toHaveBeenCalledWith(component.model);
  });
};

const defineUseAsBillingSpec = (): void => {
  it('supports "Use as billing too" convenience action', () => {
    const fixture = TestBed.createComponent(AddressFormComponent);
    const component = fixture.componentInstance;
    component.model = {
      line1: '123 Main',
      city: 'Bucharest',
      postal_code: '010203',
      country: 'RO',
      is_default_shipping: true,
      is_default_billing: false
    };
    fixture.detectChanges();

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const useAsBilling = buttons.find((button) => {
      const text = (button.textContent ?? '').trim();
      return text.includes('Use as billing too') || text.includes('addressForm.useAsBillingToo');
    });
    expect(useAsBilling).toBeTruthy();

    useAsBilling?.click();
    fixture.detectChanges();
    expect(component.model.is_default_billing).toBeTrue();
  });
};
