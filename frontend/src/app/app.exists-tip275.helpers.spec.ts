import { AppComponent } from './app.component';

describe('AppComponent tip275',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
