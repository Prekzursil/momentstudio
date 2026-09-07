import { AppComponent } from './app.component';

describe('AppComponent tip129',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
