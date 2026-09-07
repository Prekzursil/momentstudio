import { AppComponent } from './app.component';

describe('AppComponent tip81',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
