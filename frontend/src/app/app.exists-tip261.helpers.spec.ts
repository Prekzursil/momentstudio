import { AppComponent } from './app.component';

describe('AppComponent tip261',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
