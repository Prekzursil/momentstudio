import { ProductComponent } from './product.component';

describe('ProductComponent tip13',()=>{it('proto',()=>{expect(Object.create(ProductComponent.prototype)).toBeTruthy();});});
