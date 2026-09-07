import { AppComponent } from './app.component';

describe('AppComponent tip169',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
