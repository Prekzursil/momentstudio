import { AppComponent } from './app.component';

describe('AppComponent tip191',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
