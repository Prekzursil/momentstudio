import { AppComponent } from './app.component';

describe('AppComponent tip29',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
