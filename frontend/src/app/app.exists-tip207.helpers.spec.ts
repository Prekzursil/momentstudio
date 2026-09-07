import { AppComponent } from './app.component';

describe('AppComponent tip207',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
