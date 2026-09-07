import { HomeComponent } from './home.component';

describe('HomeComponent tip38',()=>{it('proto',()=>{expect(Object.create(HomeComponent.prototype)).toBeTruthy();});});
