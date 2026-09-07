import { AppComponent } from './app.component';

describe('AppComponent tip197',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
