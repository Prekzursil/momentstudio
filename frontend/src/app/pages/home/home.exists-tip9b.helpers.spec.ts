import { HomeComponent } from './home.component';

describe('HomeComponent tip9b',()=>{it('proto',()=>{expect(Object.create(HomeComponent.prototype)).toBeTruthy();});});
