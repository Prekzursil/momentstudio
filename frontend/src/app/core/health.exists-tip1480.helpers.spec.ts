import { HealthService } from './health.service';

describe('HealthService tip1480',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
