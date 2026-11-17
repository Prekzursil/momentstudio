import { CartComponent } from './cart.component';
import type { CartItem } from '../../core/cart.store';

/** Golden WU expand for #772 — quote accessors, stock guards, save-for-later helpers. */
describe('CartComponent quote/stock/save helpers (golden WU)', () => {
  function bare(overrides: Record<string, unknown> = {}): CartComponent {
    const cmp = Object.create(CartComponent.prototype) as CartComponent;
    const quoteVal = {
      subtotal: 100,
      fee: 5,
      tax: 19,
      shipping: 15,
      total: 139,
      currency: 'RON',
      freeShippingThresholdRon: 200,
    };
    (cmp as any).quote = () => quoteVal;
    (cmp as any).subtotal = () => 100;
    (cmp as any).savedForLater = [];
    (cmp as any).restoringSaved = {};
    (cmp as any).appliedCouponOffer = null;
    (cmp as any).promo = '';
    Object.assign(cmp as any, overrides);
    return cmp;
  }

  it('quote accessors read quote() fields', () => {
    const cmp = bare();
    expect(cmp.quoteSubtotal()).toBe(100);
    expect(cmp.quoteFee()).toBe(5);
    expect(cmp.quoteTax()).toBe(19);
    expect(cmp.quoteShipping()).toBe(15);
    expect(cmp.quoteTotal()).toBe(139);
    expect(cmp.quoteDiscount()).toBe(0); // 100+5+19+15-139 = 0
  });

  it('freeShippingThreshold / remaining / progressPct handle null and progress', () => {
    const cmp = bare();
    expect(cmp.freeShippingThreshold()).toBe(200);
    expect(cmp.freeShippingRemaining()).toBe(100);
    expect(cmp.freeShippingProgressPct()).toBe(50);

    const none = bare({
      quote: () => ({
        subtotal: 50,
        fee: 0,
        tax: 0,
        shipping: 0,
        total: 50,
        currency: 'RON',
        freeShippingThresholdRon: null,
      }),
      subtotal: () => 50,
    });
    expect(none.freeShippingThreshold()).toBeNull();
    expect(none.freeShippingRemaining()).toBeNull();
    expect(none.freeShippingProgressPct()).toBe(0);
  });

  it('isLowStock / isMaxQuantity use stock thresholds', () => {
    const cmp = bare();
    expect(cmp.isLowStock({ quantity: 1, stock: 10 } as CartItem)).toBe(false);
    expect(cmp.isLowStock({ quantity: 1, stock: 3 } as CartItem)).toBe(true);
    expect(cmp.isLowStock({ quantity: 1, stock: 0 } as CartItem)).toBe(false);
    expect(cmp.isMaxQuantity({ quantity: 5, stock: 5 } as CartItem)).toBe(true);
    expect(cmp.isMaxQuantity({ quantity: 4, stock: 5 } as CartItem)).toBe(false);
  });

  it('saveKey / removeSavedForLater manage saved list keys', () => {
    const cmp = bare({
      savedForLater: [
        {
          product_id: 'p1',
          variant_id: 'v1',
          quantity: 1,
          name: 'A',
          slug: 'a',
          price: 1,
          currency: 'RON',
          saved_at: 't',
        },
        {
          product_id: 'p2',
          variant_id: null,
          quantity: 1,
          name: 'B',
          slug: 'b',
          price: 2,
          currency: 'RON',
          saved_at: 't',
        },
      ],
      restoringSaved: { 'p1::v1': true },
    });
    expect(cmp.saveKey({ product_id: 'p1', variant_id: 'v1' })).toBe('p1::v1');
    expect(cmp.saveKey({ product_id: 'p2', variant_id: null })).toBe('p2::');
    spyOn(cmp as any, 'persistSavedForLater').and.stub();
    cmp.removeSavedForLater({
      product_id: 'p1',
      variant_id: 'v1',
      quantity: 1,
      name: 'A',
      slug: 'a',
      price: 1,
      currency: 'RON',
      saved_at: 't',
    } as any);
    expect(cmp.savedForLater.map((s) => s.product_id)).toEqual(['p2']);
    expect(cmp.restoringSaved['p1::v1']).toBeUndefined();
  });
});
