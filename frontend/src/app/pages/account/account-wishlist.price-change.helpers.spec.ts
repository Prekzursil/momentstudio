import { Product } from '../../core/catalog.service';
import { AccountWishlistComponent } from './account-wishlist.component';

/** Golden WU tip orphan — priceChange. */
describe('AccountWishlistComponent priceChange (golden WU)', () => {
  function bare(current: number, prev: number): AccountWishlistComponent {
    const cmp = Object.create(AccountWishlistComponent.prototype) as AccountWishlistComponent;
    Object.assign(cmp as any, {
      account: {
        wishlist: {
          getBaseline: () => ({ price: prev }),
          effectivePrice: () => current,
        },
      },
    });
    return cmp;
  }

  it('detects up/down price deltas', () => {
    const item = { id: 'p1', currency: 'RON' } as Product;
    expect(bare(12, 10).priceChange(item)?.direction).toBe('up');
    expect(bare(8, 10).priceChange(item)?.direction).toBe('down');
    expect(bare(10, 10).priceChange(item)).toBeNull();
  });
});
