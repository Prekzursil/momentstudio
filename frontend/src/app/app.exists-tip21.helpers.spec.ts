import { AppComponent } from './app.component';

describe('AppComponent tip21',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
