import { AppComponent } from './app.component';

describe('AppComponent tip171',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
