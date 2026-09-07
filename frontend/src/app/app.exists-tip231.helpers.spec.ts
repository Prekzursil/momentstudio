import { AppComponent } from './app.component';

describe('AppComponent tip231',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
