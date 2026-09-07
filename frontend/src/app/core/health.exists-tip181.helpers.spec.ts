import { HealthService } from './health.service';

describe('HealthService tip181',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
