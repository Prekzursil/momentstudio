import { AppComponent } from './app.component';

describe('AppComponent tip73',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
