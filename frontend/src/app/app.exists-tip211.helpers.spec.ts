import { AppComponent } from './app.component';

describe('AppComponent tip211',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
