import { CartComponent } from './cart.component';

describe('applyPromo tip',()=>{it('fn',()=>{const c=Object.create(CartComponent.prototype) as CartComponent; expect(typeof c.applyPromo).toBe('function');});});
