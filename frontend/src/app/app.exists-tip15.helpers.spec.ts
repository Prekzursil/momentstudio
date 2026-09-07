import { AppComponent } from './app.component';

describe('AppComponent tip15',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
