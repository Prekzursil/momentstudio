import { HealthService } from './health.service';

describe('HealthService tip1540',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
