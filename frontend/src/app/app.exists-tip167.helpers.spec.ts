import { AppComponent } from './app.component';

describe('AppComponent tip167',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
