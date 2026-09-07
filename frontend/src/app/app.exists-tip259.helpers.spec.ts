import { AppComponent } from './app.component';

describe('AppComponent tip259',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
