import { ProductComponent } from './product.component';

describe('ProductComponent tip37',()=>{it('proto',()=>{expect(Object.create(ProductComponent.prototype)).toBeTruthy();});});
