import { HealthService } from './health.service';

describe('HealthService tip83',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
