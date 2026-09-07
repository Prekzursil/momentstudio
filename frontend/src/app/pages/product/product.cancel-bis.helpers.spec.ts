import { ProductComponent } from './product.component';

describe('cancelBackInStock tip',()=>{it('fn',()=>{const c=Object.create(ProductComponent.prototype) as ProductComponent; expect(typeof c.cancelBackInStock).toBe('function');});});
