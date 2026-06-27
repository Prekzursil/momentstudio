import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { AccountComponent } from './account.component';
import { AccountOrdersComponent } from './account-orders.component';

interface AccountStub {
  ordersQuery: string;
  applyOrderFilters: jasmine.Spy;
}

interface QueryParams {
  [key: string]: string | null;
}

function configure(params: QueryParams): {
  component: AccountOrdersComponent;
  account: AccountStub;
} {
  const account: AccountStub = {
    ordersQuery: '',
    applyOrderFilters: jasmine.createSpy('applyOrderFilters'),
  };

  const route = {
    snapshot: {
      queryParamMap: {
        get: (key: string): string | null =>
          Object.prototype.hasOwnProperty.call(params, key) ? params[key] : null,
      },
    },
  };

  TestBed.configureTestingModule({
    imports: [AccountOrdersComponent, RouterTestingModule, TranslateModule.forRoot()],
    providers: [
      { provide: AccountComponent, useValue: account },
      { provide: ActivatedRoute, useValue: route },
    ],
  });

  const component = TestBed.createComponent(AccountOrdersComponent).componentInstance;
  return { component, account };
}

describe('AccountOrdersComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('seeds the orders query from the trimmed "q" param and applies filters', () => {
    const { component, account } = configure({ q: '  birthday gift  ' });

    component.ngOnInit();

    expect(account.ordersQuery).toBe('birthday gift');
    expect(account.applyOrderFilters).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the "q" param is absent', () => {
    const { component, account } = configure({});

    component.ngOnInit();

    expect(account.ordersQuery).toBe('');
    expect(account.applyOrderFilters).not.toHaveBeenCalled();
  });

  it('does nothing when the "q" param is only whitespace', () => {
    const { component, account } = configure({ q: '   ' });

    component.ngOnInit();

    expect(account.ordersQuery).toBe('');
    expect(account.applyOrderFilters).not.toHaveBeenCalled();
  });
});
