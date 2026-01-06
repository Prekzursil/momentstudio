import { TestBed } from '@angular/core/testing';

import { AddressFormComponent } from './address-form.component';

describe('AddressFormComponent', () => {
  it('does not emit save when form is invalid', () => {
    const fixture = TestBed.createComponent(AddressFormComponent);
    const cmp = fixture.componentInstance;
    spyOn(cmp.save, 'emit');

    cmp.submit({ valid: false } as any);

    expect(cmp.save.emit).not.toHaveBeenCalled();
  });

  it('emits save when form is valid', () => {
    const fixture = TestBed.createComponent(AddressFormComponent);
    const cmp = fixture.componentInstance;
    spyOn(cmp.save, 'emit');

    cmp.model = { line1: '123 Main', city: 'Bucharest', postal_code: '010203', country: 'RO' };
    cmp.submit({ valid: true } as any);

    expect(cmp.save.emit).toHaveBeenCalledWith(cmp.model);
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
      is_default_billing: false
    };
    fixture.detectChanges();

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const useAsBilling = buttons.find((b) => (b.textContent ?? '').includes('Use as billing too'));
    expect(useAsBilling).toBeTruthy();

    useAsBilling?.click();
    fixture.detectChanges();

    expect(cmp.model.is_default_billing).toBeTrue();
  });
});

