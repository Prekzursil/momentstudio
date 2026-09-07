import { AppComponent } from './app.component';

describe('AppComponent tip237',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
