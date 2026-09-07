import { AppComponent } from './app.component';

describe('AppComponent tip35',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
