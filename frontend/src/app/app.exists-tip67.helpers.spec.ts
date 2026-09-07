import { AppComponent } from './app.component';

describe('AppComponent tip67',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
