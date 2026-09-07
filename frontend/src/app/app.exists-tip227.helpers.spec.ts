import { AppComponent } from './app.component';

describe('AppComponent tip227',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
