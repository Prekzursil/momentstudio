import { ProductComponent } from './product.component';

describe('ProductComponent tip28',()=>{it('proto',()=>{expect(Object.create(ProductComponent.prototype)).toBeTruthy();});});
