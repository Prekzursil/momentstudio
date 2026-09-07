import { HealthService } from './health.service';

describe('HealthService tip149',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
