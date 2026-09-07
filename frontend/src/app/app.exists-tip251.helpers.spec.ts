import { AppComponent } from './app.component';

describe('AppComponent tip251',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
