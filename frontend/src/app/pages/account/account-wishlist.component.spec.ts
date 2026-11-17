import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';

import { AccountWishlistComponent } from './account-wishlist.component';
import { AccountComponent } from './account.component';
import { CartStore } from '../../core/cart.store';
import { CatalogService, Product } from '../../core/catalog.service';
import { ToastService } from '../../core/toast.service';

/** Golden WU wl48 — first account-wishlist selection helper specs. */
describe('AccountWishlistComponent selection helpers (golden WU)', () => {
  const wishlistItems = signal<Product[]>([]);

  beforeEach(() => {
    wishlistItems.set([]);
    TestBed.configureTestingModule({
      imports: [RouterTestingModule, AccountWishlistComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: AccountComponent,
          useValue: {
            wishlist: {
              items: () => wishlistItems(),
              isLoaded: () => true,
              removeLocal: jasmine.createSpy('removeLocal'),
            },
          },
        },
        {
          provide: CartStore,
          useValue: { addFromProduct: jasmine.createSpy('addFromProduct') },
        },
        {
          provide: CatalogService,
          useValue: {
            getBackInStockStatus: () => of({ in_stock: false, request: null }),
            requestBackInStock: () => of(null),
            cancelBackInStock: () => of(null),
          },
        },
        {
          provide: ToastService,
          useValue: {
            success: jasmine.createSpy('success'),
            error: jasmine.createSpy('error'),
            info: jasmine.createSpy('info'),
          },
        },
      ],
    });
  });

  function makeProduct(id: string): Product {
    return {
      id,
      slug: id,
      name: id.toUpperCase(),
      base_price: 10,
      currency: 'RON',
    };
  }

  function create() {
    const fixture = TestBed.createComponent(AccountWishlistComponent);
    return { fixture, cmp: fixture.componentInstance };
  }

  it('isSelected, toggleSelected, and selectedCount track per-item check state', () => {
    const { fixture, cmp } = create();
    expect(cmp.isSelected('p1')).toBe(false);
    expect(cmp.selectedCount()).toBe(0);

    cmp.toggleSelected('p1', true);
    expect(cmp.isSelected('p1')).toBe(true);
    expect(cmp.selectedCount()).toBe(1);

    cmp.toggleSelected('p2', true);
    expect(cmp.selectedCount()).toBe(2);

    cmp.toggleSelected('p1', false);
    expect(cmp.isSelected('p1')).toBe(false);
    expect(cmp.selectedCount()).toBe(1);
    fixture.destroy();
  });

  it('allSelected is false when empty or partial and true when every item is selected', () => {
    const { fixture, cmp } = create();
    wishlistItems.set([makeProduct('a'), makeProduct('b')]);

    expect(cmp.allSelected()).toBe(false);

    cmp.toggleSelected('a', true);
    expect(cmp.allSelected()).toBe(false);

    cmp.toggleSelected('b', true);
    expect(cmp.allSelected()).toBe(true);

    wishlistItems.set([]);
    expect(cmp.allSelected()).toBe(false);
    fixture.destroy();
  });

  it('toggleSelectAll selects every item when checked and clearSelection empties the set', () => {
    const { fixture, cmp } = create();
    wishlistItems.set([makeProduct('a'), makeProduct('b')]);

    cmp.toggleSelectAll(true);
    expect(cmp.allSelected()).toBe(true);
    expect(cmp.selectedCount()).toBe(2);

    cmp.toggleSelectAll(false);
    expect(cmp.selectedCount()).toBe(0);
    expect(cmp.allSelected()).toBe(false);

    cmp.toggleSelectAll(true);
    cmp.clearSelection();
    expect(cmp.selectedCount()).toBe(0);
    expect(cmp.isSelected('a')).toBe(false);
    fixture.destroy();
  });
});
