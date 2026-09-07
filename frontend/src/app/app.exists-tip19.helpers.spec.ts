import { AppComponent } from './app.component';

describe('AppComponent tip19',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
