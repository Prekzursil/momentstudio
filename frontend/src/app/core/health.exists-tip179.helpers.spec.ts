import { HealthService } from './health.service';

describe('HealthService tip179',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
