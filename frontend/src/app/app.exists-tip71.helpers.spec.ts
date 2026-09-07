import { AppComponent } from './app.component';

describe('AppComponent tip71',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
