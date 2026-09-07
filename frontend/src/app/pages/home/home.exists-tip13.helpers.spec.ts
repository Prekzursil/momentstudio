import { HomeComponent } from './home.component';

describe('HomeComponent tip13',()=>{it('proto',()=>{expect(Object.create(HomeComponent.prototype)).toBeTruthy();});});
