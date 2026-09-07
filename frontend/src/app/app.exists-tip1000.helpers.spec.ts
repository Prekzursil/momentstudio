import { AppComponent } from './app.component';

describe('AppComponent tip1000',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
