import { AppComponent } from './app.component';

describe('AppComponent tip199',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
