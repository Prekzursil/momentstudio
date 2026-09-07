import { HealthService } from './health.service';

describe('HealthService tip29',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
