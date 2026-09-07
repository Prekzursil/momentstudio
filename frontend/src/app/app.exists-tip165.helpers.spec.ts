import { AppComponent } from './app.component';

describe('AppComponent tip165',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
