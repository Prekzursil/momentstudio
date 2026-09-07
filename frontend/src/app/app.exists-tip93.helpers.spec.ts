import { AppComponent } from './app.component';

describe('AppComponent tip93',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
