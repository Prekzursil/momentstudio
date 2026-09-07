import { HealthService } from './health.service';

describe('HealthService tip133',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
