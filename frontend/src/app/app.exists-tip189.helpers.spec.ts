import { AppComponent } from './app.component';

describe('AppComponent tip189',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
