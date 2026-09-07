import { AppComponent } from './app.component';

describe('AppComponent tip103',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
