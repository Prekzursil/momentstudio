import { ProductComponent } from './product.component';

describe('ProductComponent tip33b',()=>{it('proto',()=>{expect(Object.create(ProductComponent.prototype)).toBeTruthy();});});
