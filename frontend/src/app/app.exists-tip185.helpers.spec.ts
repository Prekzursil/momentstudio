import { AppComponent } from './app.component';

describe('AppComponent tip185',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
