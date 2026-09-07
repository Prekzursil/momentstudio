import { CartComponent } from './cart.component';

describe('clearPromo tip',()=>{it('fn',()=>{const c=Object.create(CartComponent.prototype) as CartComponent; expect(typeof c.clearPromo).toBe('function');});});
