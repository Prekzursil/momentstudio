import { AppComponent } from './app.component';

describe('AppComponent tip63',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
