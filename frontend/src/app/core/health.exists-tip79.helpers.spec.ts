import { HealthService } from './health.service';

describe('HealthService tip79',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
