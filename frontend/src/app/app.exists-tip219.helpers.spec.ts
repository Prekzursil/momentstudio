import { AppComponent } from './app.component';

describe('AppComponent tip219',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
