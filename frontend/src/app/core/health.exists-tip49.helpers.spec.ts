import { HealthService } from './health.service';

describe('HealthService tip49',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
