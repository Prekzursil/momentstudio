import { HealthService } from './health.service';

describe('HealthService tip259',()=>{it('proto',()=>{expect(Object.create(HealthService.prototype)).toBeTruthy();});});
