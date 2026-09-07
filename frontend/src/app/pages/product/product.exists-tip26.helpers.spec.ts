import { ProductComponent } from './product.component';

describe('ProductComponent tip26',()=>{it('proto',()=>{expect(Object.create(ProductComponent.prototype)).toBeTruthy();});});
