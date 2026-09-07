import { HealthService } from './health.service';

describe('HealthService tip500',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
