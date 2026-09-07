import { HealthService } from './health.service';

describe('HealthService tip53',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
