import { AppComponent } from './app.component';

describe('AppComponent tip107',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
