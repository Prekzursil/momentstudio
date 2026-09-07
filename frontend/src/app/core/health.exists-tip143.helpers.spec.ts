import { HealthService } from './health.service';

describe('HealthService tip143',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
