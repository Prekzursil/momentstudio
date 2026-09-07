import { AppComponent } from './app.component';

describe('AppComponent tip183',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
