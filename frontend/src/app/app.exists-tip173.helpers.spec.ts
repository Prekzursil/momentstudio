import { AppComponent } from './app.component';

describe('AppComponent tip173',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
