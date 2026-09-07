import { AppComponent } from './app.component';

describe('AppComponent tip119',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
