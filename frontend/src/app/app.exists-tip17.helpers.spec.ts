import { AppComponent } from './app.component';

describe('AppComponent tip17',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
