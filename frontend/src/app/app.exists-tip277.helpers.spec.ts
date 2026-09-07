import { AppComponent } from './app.component';

describe('AppComponent tip277',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
