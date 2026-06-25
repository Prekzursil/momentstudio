import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { SimpleChanges } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AddressFormComponent } from './address-form.component';

describe('AddressFormComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AddressFormComponent, TranslateModule.forRoot()],
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
          save: 'Save',
        },
        checkout: {
          city: 'City',
          region: 'County / State',
          regionSelect: 'Select a county',
          postal: 'Postal code',
          country: 'Country',
          countrySelect: 'Select a country',
        },
        validation: { required: 'Required' },
      },
      true,
    );
    translate.use('en');
  });

  function make(): AddressFormComponent {
    const fixture = TestBed.createComponent(AddressFormComponent);
    return fixture.componentInstance;
  }

  it('does not emit save when form is invalid', () => {
    const cmp = make();
    spyOn(cmp.save, 'emit');

    cmp.submit({ valid: false } as never);

    expect(cmp.save.emit).not.toHaveBeenCalled();
  });

  it('emits save when form is valid', () => {
    const cmp = make();
    spyOn(cmp.save, 'emit');

    cmp.model = { line1: '123 Main', city: 'Bucharest', postal_code: '010203', country: 'RO' };
    cmp.submit({ valid: true } as never);

    expect(cmp.save.emit).toHaveBeenCalledWith(cmp.model);
  });

  it('does not emit save when the phone is present but invalid', () => {
    const cmp = make();
    spyOn(cmp.save, 'emit');
    cmp.phoneCountry = 'RO';
    cmp.phoneNational = '123'; // not a valid RO number -> phoneE164() === null

    cmp.submit({ valid: true } as never);

    expect(cmp.save.emit).not.toHaveBeenCalled();
  });

  it('supports "Use as billing too" convenience action', () => {
    const fixture = TestBed.createComponent(AddressFormComponent);
    const cmp = fixture.componentInstance;
    cmp.model = {
      line1: '123 Main',
      city: 'Bucharest',
      postal_code: '010203',
      country: 'RO',
      is_default_shipping: true,
      is_default_billing: false,
    };
    fixture.detectChanges();

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    const useAsBilling = buttons.find((b) => {
      const text = (b.textContent ?? '').trim();
      return text.includes('Use as billing too') || text.includes('addressForm.useAsBillingToo');
    });
    expect(useAsBilling).toBeTruthy();

    useAsBilling?.click();
    fixture.detectChanges();

    expect(cmp.model.is_default_billing).toBeTrue();
  });

  describe('phone handling', () => {
    it('clears the model phone when the national number is empty', () => {
      const cmp = make();
      cmp.phoneNational = '';
      cmp.onPhoneChanged();
      expect(cmp.model.phone).toBeNull();
    });

    it('clears the model phone when the national number is only whitespace', () => {
      const cmp = make();
      cmp.phoneNational = '   ';
      cmp.onPhoneChanged();
      expect(cmp.model.phone).toBeNull();
    });

    it('builds an E.164 phone when a valid national number is entered', () => {
      const cmp = make();
      cmp.phoneCountry = 'RO';
      cmp.phoneNational = '712345678';
      cmp.onPhoneChanged();
      expect(cmp.model.phone).toBe('+40712345678');
    });

    it('falls back to RO when phoneCountry is empty', () => {
      const cmp = make();
      cmp.phoneCountry = '';
      cmp.phoneNational = '712345678';
      expect(cmp.phoneE164()).toBe('+40712345678');
    });
  });

  describe('postal helpers', () => {
    it('returns the example postal code for known countries', () => {
      const cmp = make();
      const cases: Array<[string, string]> = [
        ['RO', '123456'],
        ['US', '12345'],
        ['CA', 'A1A 1A1'],
        ['GB', 'SW1A 1AA'],
        ['DE', '12345'],
        ['ZZ', '12345'],
      ];
      for (const [country, example] of cases) {
        cmp.model.country = country;
        expect(cmp.postalExample).toBe(example);
      }
    });

    it('returns the example default when the model is missing', () => {
      const cmp = make();
      cmp.model = null as never;
      expect(cmp.postalExample).toBe('12345');
    });

    it('returns the regex pattern for known countries and a default', () => {
      const cmp = make();
      cmp.model.country = 'US';
      expect(cmp.postalPattern).toBe('^\\d{5}(-\\d{4})?$');
      cmp.model.country = 'RO';
      expect(cmp.postalPattern).toBe('^\\d{6}$');
      cmp.model.country = 'XX';
      expect(cmp.postalPattern).toBe('^[A-Za-z0-9 -]{3,12}$');
    });

    it('returns the default pattern when the model is missing', () => {
      const cmp = make();
      cmp.model = null as never;
      expect(cmp.postalPattern).toBe('^[A-Za-z0-9 -]{3,12}$');
    });
  });

  describe('ngOnChanges syncs label and phone state', () => {
    function change(model: unknown): SimpleChanges {
      return { model: { currentValue: model } } as unknown as SimpleChanges;
    }

    it('ignores changes that do not include the model input', () => {
      const cmp = make();
      cmp.labelPreset = 'work';
      cmp.ngOnChanges({} as SimpleChanges);
      expect(cmp.labelPreset).toBe('work');
    });

    it('resets to the home preset when there is no label', () => {
      const cmp = make();
      cmp.model = { line1: '', city: '', postal_code: '', country: 'RO', label: '' };
      cmp.ngOnChanges(change(cmp.model));
      expect(cmp.labelPreset).toBe('home');
      expect(cmp.model.label).toBe('home');
    });

    it('maps known preset labels', () => {
      const cmp = make();
      for (const preset of ['home', 'work', 'other'] as const) {
        cmp.model = { line1: '', city: '', postal_code: '', country: 'RO', label: preset };
        cmp.ngOnChanges(change(cmp.model));
        expect(cmp.labelPreset).toBe(preset);
      }
    });

    it('maps an arbitrary label to the custom preset', () => {
      const cmp = make();
      cmp.model = { line1: '', city: '', postal_code: '', country: 'RO', label: 'Beach House' };
      cmp.ngOnChanges(change(cmp.model));
      expect(cmp.labelPreset).toBe('custom');
      expect(cmp.labelCustom).toBe('Beach House');
    });

    it('resets the phone when the model has none', () => {
      const cmp = make();
      cmp.phoneCountry = 'US';
      cmp.phoneNational = '5551234';
      cmp.model = { line1: '', city: '', postal_code: '', country: 'RO', phone: '' };
      cmp.ngOnChanges(change(cmp.model));
      expect(cmp.phoneCountry).toBe('RO');
      expect(cmp.phoneNational).toBe('');
    });

    it('splits a valid E.164 phone into country and national parts', () => {
      const cmp = make();
      cmp.model = {
        line1: '',
        city: '',
        postal_code: '',
        country: 'RO',
        phone: '+40712345678',
      };
      cmp.ngOnChanges(change(cmp.model));
      expect(cmp.phoneCountry).toBe('RO');
      expect(cmp.phoneNational).toBe('712345678');
    });

    it('keeps the existing country when the phone cannot be parsed', () => {
      const cmp = make();
      cmp.phoneCountry = 'US';
      cmp.model = { line1: '', city: '', postal_code: '', country: 'RO', phone: 'not-a-phone' };
      cmp.ngOnChanges(change(cmp.model));
      expect(cmp.phoneCountry).toBe('US');
      expect(cmp.phoneNational).toBe('');
    });
  });

  describe('label preset application', () => {
    it('uses a trimmed custom label', () => {
      const cmp = make();
      cmp.labelPreset = 'custom';
      cmp.labelCustom = '  Studio  ';
      cmp.applyLabelPreset();
      expect(cmp.model.label).toBe('Studio');
    });

    it('clears the label for an empty custom value', () => {
      const cmp = make();
      cmp.labelPreset = 'custom';
      cmp.labelCustom = '   ';
      cmp.applyLabelPreset();
      expect(cmp.model.label).toBeNull();
    });

    it('uses the preset name for non-custom labels', () => {
      const cmp = make();
      cmp.labelPreset = 'work';
      cmp.applyLabelPreset();
      expect(cmp.model.label).toBe('work');
    });
  });

  describe('autocomplete query handling', () => {
    it('does nothing when autocomplete is disabled', () => {
      const cmp = make();
      cmp.onAutocompleteQueryChange('bucharest');
      expect(cmp.autocompleteQuery).toBe('');
    });

    it('clears results for a short query', () => {
      const cmp = make();
      (cmp as unknown as { addressAutocompleteEnabled: boolean }).addressAutocompleteEnabled = true;
      cmp.autocompleteResults = [{ display_name: 'old' }];
      cmp.onAutocompleteQueryChange('bu');
      expect(cmp.autocompleteResults).toEqual([]);
    });

    it('schedules a fetch for a long query and clears a pending timer', fakeAsync(() => {
      const cmp = make();
      (cmp as unknown as { addressAutocompleteEnabled: boolean }).addressAutocompleteEnabled = true;
      const fetchSpy = spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response('[]', { status: 200 })),
      );
      cmp.onAutocompleteQueryChange('bucharest');
      // Calling again clears the previously scheduled timer (branch coverage).
      cmp.onAutocompleteQueryChange('bucharesti');
      tick(300);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    }));

    it('onCountryChange re-runs autocomplete when enabled with a long query', () => {
      const cmp = make();
      (cmp as unknown as { addressAutocompleteEnabled: boolean }).addressAutocompleteEnabled = true;
      cmp.autocompleteQuery = 'bucharest';
      const spy = spyOn(cmp, 'onAutocompleteQueryChange');
      cmp.onCountryChange();
      expect(cmp.autocompleteResults).toEqual([]);
      expect(spy).toHaveBeenCalledWith('bucharest');
    });

    it('onCountryChange only clears results when autocomplete is disabled', () => {
      const cmp = make();
      cmp.autocompleteResults = [{ display_name: 'old' }];
      const spy = spyOn(cmp, 'onAutocompleteQueryChange');
      cmp.onCountryChange();
      expect(cmp.autocompleteResults).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('fetchAutocomplete', () => {
    function callFetch(cmp: AddressFormComponent, query: string): Promise<void> {
      return (cmp as unknown as { fetchAutocomplete(q: string): Promise<void> }).fetchAutocomplete(
        query,
      );
    }

    it('maps successful results and applies the country filter', async () => {
      const cmp = make();
      cmp.model.country = 'RO';
      const fetchSpy = spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(
          new Response(
            JSON.stringify([
              { display_name: '  Strada A  ', address: { city: 'Cluj' } },
              { display_name: 'No address' },
              { nope: true },
              null,
              { display_name: '' },
            ]),
            { status: 200 },
          ),
        ),
      );
      await callFetch(cmp, 'cluj');
      expect(fetchSpy.calls.mostRecent().args[0]).toContain('countrycodes=ro');
      expect(cmp.autocompleteResults).toEqual([
        { display_name: 'Strada A', address: { city: 'Cluj' } },
        { display_name: 'No address', address: {} },
      ]);
    });

    it('clears results for a non-OK response', async () => {
      const cmp = make();
      cmp.model.country = '';
      const fetchSpy = spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response('', { status: 500 })),
      );
      cmp.autocompleteResults = [{ display_name: 'old' }];
      await callFetch(cmp, 'paris');
      expect(fetchSpy.calls.mostRecent().args[0]).not.toContain('countrycodes');
      expect(cmp.autocompleteResults).toEqual([]);
    });

    it('clears results when the payload is not an array', async () => {
      const cmp = make();
      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify({ not: 'array' }), { status: 200 })),
      );
      cmp.autocompleteResults = [{ display_name: 'old' }];
      await callFetch(cmp, 'paris');
      expect(cmp.autocompleteResults).toEqual([]);
    });

    it('clears results when the request throws a non-abort error', async () => {
      const cmp = make();
      spyOn(window, 'fetch').and.returnValue(Promise.reject(new Error('network')));
      cmp.autocompleteResults = [{ display_name: 'old' }];
      await callFetch(cmp, 'paris');
      expect(cmp.autocompleteResults).toEqual([]);
    });

    it('preserves results when the request is aborted', async () => {
      const cmp = make();
      const abortErr = new DOMException('aborted', 'AbortError');
      spyOn(window, 'fetch').and.returnValue(Promise.reject(abortErr));
      cmp.autocompleteResults = [{ display_name: 'keep' }];
      await callFetch(cmp, 'paris');
      expect(cmp.autocompleteResults).toEqual([{ display_name: 'keep' }]);
    });
  });

  describe('applyAutocomplete', () => {
    it('applies a fully populated RO suggestion and matches the county', () => {
      const cmp = make();
      cmp.applyAutocomplete({
        display_name: 'x',
        address: {
          country_code: 'ro',
          house_number: '12',
          road: 'Strada Mare',
          city: 'Alba Iulia',
          postcode: '510001',
          state: 'alba',
        },
      });
      expect(cmp.model.country).toBe('RO');
      expect(cmp.model.line1).toBe('12 Strada Mare');
      expect(cmp.model.city).toBe('Alba Iulia');
      expect(cmp.model.postal_code).toBe('510001');
      expect(cmp.model.region).toBe('Alba');
      expect(cmp.autocompleteQuery).toBe('');
    });

    it('uses fallback fields for a non-RO suggestion', () => {
      const cmp = make();
      cmp.applyAutocomplete({
        display_name: 'x',
        address: {
          country_code: 'us',
          house_number: 5,
          pedestrian: 'Walk Way',
          town: 'Springfield',
          region: 'Ohio',
          postcode: '12345',
        },
      });
      expect(cmp.model.country).toBe('US');
      expect(cmp.model.line1).toBe('Walk Way');
      expect(cmp.model.city).toBe('Springfield');
      expect(cmp.model.region).toBe('Ohio');
    });

    it('uses cycleway/village fields and skips an unmatched RO county', () => {
      const cmp = make();
      cmp.model.region = 'Existing';
      cmp.applyAutocomplete({
        display_name: 'x',
        address: {
          country_code: 'ro',
          house_number: '',
          cycleway: 'Bike Path',
          village: 'Tinyville',
          county: 'NotARealCounty',
          postcode: '',
        },
      });
      expect(cmp.model.line1).toBe('Bike Path');
      expect(cmp.model.city).toBe('Tinyville');
      expect(cmp.model.region).toBe('Existing');
    });

    it('skips empty fields and a country code that is not two letters', () => {
      const cmp = make();
      cmp.model = { line1: 'keep', city: 'keepcity', postal_code: 'keep', country: 'RO' };
      cmp.applyAutocomplete({
        display_name: 'x',
        address: { country_code: 'usa', municipality: 'Metro' },
      });
      expect(cmp.model.country).toBe('RO');
      expect(cmp.model.line1).toBe('keep');
      expect(cmp.model.city).toBe('Metro');
    });

    it('handles a missing address object', () => {
      const cmp = make();
      cmp.model = { line1: 'keep', city: 'keepcity', postal_code: 'keep', country: 'RO' };
      cmp.applyAutocomplete({ display_name: 'x' });
      expect(cmp.model.line1).toBe('keep');
      expect(cmp.autocompleteResults).toEqual([]);
    });
  });

  describe('ngOnDestroy', () => {
    it('clears a pending timer and aborts an in-flight request', () => {
      const cmp = make();
      const controller = new AbortController();
      const abortSpy = spyOn(controller, 'abort');
      const clearSpy = spyOn(window, 'clearTimeout').and.callThrough();
      (cmp as unknown as { autocompleteTimer: number }).autocompleteTimer = 123;
      (cmp as unknown as { autocompleteAbort: AbortController }).autocompleteAbort = controller;
      cmp.ngOnDestroy();
      expect(clearSpy).toHaveBeenCalledWith(123);
      expect(abortSpy).toHaveBeenCalled();
    });

    it('is a no-op when there is nothing to clean up', () => {
      const cmp = make();
      expect(() => cmp.ngOnDestroy()).not.toThrow();
    });
  });

  describe('constructor locale fallback', () => {
    it('falls back to English when the current language is empty', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [AddressFormComponent],
        providers: [{ provide: TranslateService, useValue: { currentLang: '' } }],
      });
      const cmp = TestBed.createComponent(AddressFormComponent).componentInstance;
      expect(cmp.countries.length).toBeGreaterThan(0);
    });
  });
});
