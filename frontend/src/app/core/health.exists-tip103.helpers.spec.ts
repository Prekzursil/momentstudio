import { HealthService } from './health.service';

describe('HealthService tip103',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
