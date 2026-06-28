import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap } from '@angular/router';

import { AccountOrdersComponent } from './account-orders.component';
import { AccountComponent } from './account.component';

describe('AccountOrdersComponent', () => {
  let applyOrderFilters: jasmine.Spy;
  let accountStub: { ordersQuery: string; applyOrderFilters: jasmine.Spy };

  function setup(qParam: string | null): AccountOrdersComponent {
    applyOrderFilters = jasmine.createSpy('applyOrderFilters');
    accountStub = { ordersQuery: '', applyOrderFilters };
    const queryParamMap: ParamMap = convertToParamMap(qParam === null ? {} : { q: qParam });

    TestBed.configureTestingModule({
      providers: [
        AccountOrdersComponent,
        { provide: AccountComponent, useValue: accountStub },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap } } },
      ],
    });

    return TestBed.inject(AccountOrdersComponent);
  }

  it('seeds the orders query from a non-empty ?q param and applies filters', () => {
    const component = setup('  shoes  ');

    component.ngOnInit();

    // Whitespace is trimmed before seeding the parent account search.
    expect(accountStub.ordersQuery).toBe('shoes');
    expect(applyOrderFilters).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the ?q param is absent', () => {
    const component = setup(null);

    component.ngOnInit();

    expect(accountStub.ordersQuery).toBe('');
    expect(applyOrderFilters).not.toHaveBeenCalled();
  });

  it('does nothing when the ?q param is whitespace-only', () => {
    const component = setup('   ');

    component.ngOnInit();

    expect(accountStub.ordersQuery).toBe('');
    expect(applyOrderFilters).not.toHaveBeenCalled();
  });
});
