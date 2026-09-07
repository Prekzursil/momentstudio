import { AppComponent } from './app.component';

describe('AppComponent tip105',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
