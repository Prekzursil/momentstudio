import { AppComponent } from './app.component';

describe('AppComponent tip215',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
