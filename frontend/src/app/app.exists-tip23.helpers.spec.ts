import { AppComponent } from './app.component';

describe('AppComponent tip23',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
