import { AboutComponent } from './about.component';

describe('canEditPage tip3',()=>{it('fn',()=>{const c=Object.create(AboutComponent.prototype) as AboutComponent; expect(typeof c.canEditPage).toBe('function');});});
