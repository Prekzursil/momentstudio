import { HealthService } from './health.service';

describe('HealthService tip183',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
