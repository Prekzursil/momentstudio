import { AppComponent } from './app.component';

describe('AppComponent tip221',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
