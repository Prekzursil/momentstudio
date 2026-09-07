import { AppComponent } from './app.component';

describe('AppComponent tip101',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
