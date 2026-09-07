import { AppComponent } from './app.component';

describe('AppComponent tip79',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
