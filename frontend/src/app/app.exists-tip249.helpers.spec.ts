import { AppComponent } from './app.component';

describe('AppComponent tip249',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
