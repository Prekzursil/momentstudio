import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AddressFormComponent } from './address-form.component';

describe('AddressFormComponent', () => {
  registerAddressFormSetup();
  defineInvalidSubmitSpec();
  defineValidSubmitSpec();
  defineUseAsBillingSpec();
  definePhoneValidationSpec();
  defineLabelSyncSpec();
  defineAutocompleteApplySpec();
  defineAutocompleteFetchBranchesSpec();
  defineCountryChangeAndLabelPresetSpec();
});

function registerAddressFormSetup(): void {
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

function defineInvalidSubmitSpec(): void {
  it('does not emit save when form is invalid', () => {
    const fixture = TestBed.createComponent(AddressFormComponent);
    const component = fixture.componentInstance;
    spyOn(component.save, 'emit');
    component.submit({ valid: false } as any);
    expect(component.save.emit).not.toHaveBeenCalled();
  });
};

function defineValidSubmitSpec(): void {
  it('emits save when form is valid', () => {
    const fixture = TestBed.createComponent(AddressFormComponent);
    const component = fixture.componentInstance;
    spyOn(component.save, 'emit');
    component.model = { line1: '123 Main', city: 'Bucharest', postal_code: '010203', country: 'RO' };
    component.submit({ valid: true } as any);
    expect(component.save.emit).toHaveBeenCalledWith(component.model);
  });
};

function defineUseAsBillingSpec(): void {
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

function definePhoneValidationSpec(): void {
  it('builds valid E164 numbers and blocks save when number is invalid', () => {
    const fixture = TestBed.createComponent(AddressFormComponent);
    const component = fixture.componentInstance;
    component.model = { line1: '123 Main', city: 'Bucharest', postal_code: '010203', country: 'RO' };
    component.phoneCountry = 'RO';
    component.phoneNational = '712345678';
    component.onPhoneChanged();
    expect(component.model.phone).toBe('+40712345678');

    spyOn(component.save, 'emit');
    component.phoneNational = '123';
    component.onPhoneChanged();
    component.submit({ valid: true } as any);
    expect(component.model.phone).toBeNull();
    expect(component.save.emit).not.toHaveBeenCalled();
  });
};

function defineLabelSyncSpec(): void {
  it('synchronizes known and custom labels from incoming model changes', () => {
    const fixture = TestBed.createComponent(AddressFormComponent);
    const component = fixture.componentInstance;
    component.model = { line1: 'L1', city: 'C', postal_code: '1', country: 'RO', label: 'work' };
    component.ngOnChanges({ model: {} as any });
    expect(component.labelPreset).toBe('work');
    expect(component.model.label).toBe('work');

    component.model = { ...component.model, label: 'Studio label' };
    component.ngOnChanges({ model: {} as any });
    expect(component.labelPreset).toBe('custom');
    expect(component.labelCustom).toBe('Studio label');
  });
};

function defineAutocompleteApplySpec(): void {
  it('applies autocomplete values and normalizes Romanian county names', () => {
    const fixture = TestBed.createComponent(AddressFormComponent);
    const component = fixture.componentInstance;
    component.model = { line1: '', city: '', postal_code: '', country: 'RO' };
    component.autocompleteQuery = 'bucu';
    component.autocompleteResults = [{ display_name: 'Bucuresti', address: {} }];

    component.applyAutocomplete({
      display_name: 'Bucuresti',
      address: { country_code: 'ro', house_number: '10', road: 'Strada Lunga', city: 'Bucuresti', state: 'ilfov', postcode: '010203' }
    });

    expect(component.model.country).toBe('RO');
    expect(component.model.line1).toBe('10 Strada Lunga');
    expect(component.model.city).toBe('Bucuresti');
    expect(component.model.region).toBe('Ilfov');
    expect(component.model.postal_code).toBe('010203');
    expect(component.autocompleteQuery).toBe('');
    expect(component.autocompleteResults).toEqual([]);
  });
};

function defineAutocompleteFetchBranchesSpec(): void {
  it('covers autocomplete timer, fetch non-ok, and successful parse branches', async () => {
    const fixture = TestBed.createComponent(AddressFormComponent);
    const component = fixture.componentInstance;
    component.addressAutocompleteEnabled = true;
    component.model = { line1: '', city: '', postal_code: '', country: 'RO' };

    component.onAutocompleteQueryChange('ab');
    expect(component.autocompleteResults).toEqual([]);

    const fetchSpy = spyOn(globalThis as any, 'fetch');
    fetchSpy.and.returnValue(Promise.resolve({ ok: false, json: async () => [] } as any));
    await (component as any).fetchAutocomplete('Bucharest');
    expect(component.autocompleteResults).toEqual([]);

    fetchSpy.and.returnValue(
      Promise.resolve({
        ok: true,
        json: async () => [
          { display_name: 'Bucharest', address: { city: 'Bucharest' } },
          { display_name: '', address: {} },
        ],
      } as any)
    );
    await (component as any).fetchAutocomplete('Bucharest');
    expect(component.autocompleteResults.length).toBe(1);
    expect(component.autocompleteResults[0].display_name).toBe('Bucharest');
  });
};

function defineCountryChangeAndLabelPresetSpec(): void {
  it('covers country change and custom label preset branches', () => {
    const fixture = TestBed.createComponent(AddressFormComponent);
    const component = fixture.componentInstance;
    component.addressAutocompleteEnabled = true;
    component.autocompleteQuery = 'Bucharest';
    component.autocompleteResults = [{ display_name: 'Old', address: {} }];

    const autoSpy = spyOn(component, 'onAutocompleteQueryChange').and.callThrough();
    component.onCountryChange();
    expect(autoSpy).toHaveBeenCalledWith('Bucharest');

    component.labelPreset = 'custom';
    component.labelCustom = '  Family  ';
    component.applyLabelPreset();
    expect(component.model.label).toBe('Family');

    component.labelCustom = '   ';
    component.applyLabelPreset();
    expect(component.model.label).toBeNull();
  });
};
