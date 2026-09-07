import { AppComponent } from './app.component';

describe('AppComponent tip133',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
