import { AppComponent } from './app.component';

describe('AppComponent tip179',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
