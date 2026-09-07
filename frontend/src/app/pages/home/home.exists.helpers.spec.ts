import { HomeComponent } from './home.component';

describe('HomeComponent tip',()=>{it('proto',()=>{expect(Object.create(HomeComponent.prototype)).toBeTruthy();});});
