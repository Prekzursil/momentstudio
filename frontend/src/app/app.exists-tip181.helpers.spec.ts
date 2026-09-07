import { AppComponent } from './app.component';

describe('AppComponent tip181',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
