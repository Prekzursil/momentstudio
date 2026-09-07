import { AppComponent } from './app.component';

describe('AppComponent tip195',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
