import { AppComponent } from './app.component';

describe('AppComponent tip143',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
