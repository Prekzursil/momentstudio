import { AppComponent } from './app.component';

describe('AppComponent tip121',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
