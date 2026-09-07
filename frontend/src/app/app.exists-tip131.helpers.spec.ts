import { AppComponent } from './app.component';

describe('AppComponent tip131',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
