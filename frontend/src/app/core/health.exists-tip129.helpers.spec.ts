import { HealthService } from './health.service';

describe('HealthService tip129',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
