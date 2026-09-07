import { HealthService } from './health.service';

describe('HealthService tip1580',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
