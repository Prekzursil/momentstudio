import { AppComponent } from './app.component';

describe('AppComponent tip241',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
