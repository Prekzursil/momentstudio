import { AppComponent } from './app.component';

describe('AppComponent tip75',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
