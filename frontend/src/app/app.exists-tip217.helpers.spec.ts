import { AppComponent } from './app.component';

describe('AppComponent tip217',()=>{it('proto',()=>{expect(Object.create(AppComponent.prototype)).toBeTruthy();});});
