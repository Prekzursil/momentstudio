import { HealthService } from './health.service';

describe('HealthService tip1240',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
