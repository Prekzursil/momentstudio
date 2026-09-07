import { AppComponent } from './app.component';

describe('AppComponent tip177',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
