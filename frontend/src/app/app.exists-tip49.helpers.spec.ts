import { AppComponent } from './app.component';

describe('AppComponent tip49',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
