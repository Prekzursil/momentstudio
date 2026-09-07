import { AppComponent } from './app.component';

describe('AppComponent tip117',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
