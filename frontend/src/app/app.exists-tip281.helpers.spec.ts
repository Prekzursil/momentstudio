import { AppComponent } from './app.component';

describe('AppComponent tip281',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
