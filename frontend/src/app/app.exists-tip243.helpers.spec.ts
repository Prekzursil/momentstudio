import { AppComponent } from './app.component';

describe('AppComponent tip243',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
