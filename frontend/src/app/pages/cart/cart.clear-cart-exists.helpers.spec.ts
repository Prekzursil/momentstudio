import { CartComponent } from './cart.component';

describe('clearCart tip',()=>{it('fn',()=>{const c=Object.create(CartComponent.prototype) as CartComponent; expect(typeof c.clearCart).toBe('function');});});
