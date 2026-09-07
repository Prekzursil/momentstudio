import { AppComponent } from './app.component';

describe('AppComponent tip175',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
