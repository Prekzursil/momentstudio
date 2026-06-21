import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ApiService } from './api.service';
import { HealthService, HealthResponse } from './health.service';

describe('HealthService', () => {
  let apiGet: jasmine.Spy;

  beforeEach(() => {
    apiGet = jasmine
      .createSpy('get')
      .and.callFake((path: string) => of<HealthResponse>({ status: path }));
    TestBed.configureTestingModule({
      providers: [HealthService, { provide: ApiService, useValue: { get: apiGet } }],
    });
  });

  it('is created', () => {
    expect(TestBed.inject(HealthService)).toBeTruthy();
  });

  it('queries the /health endpoint', (done) => {
    TestBed.inject(HealthService)
      .health()
      .subscribe((res) => {
        expect(res.status).toBe('/health');
        expect(apiGet).toHaveBeenCalledWith('/health');
        done();
      });
  });

  it('queries the /health/ready endpoint', (done) => {
    TestBed.inject(HealthService)
      .ready()
      .subscribe((res) => {
        expect(res.status).toBe('/health/ready');
        expect(apiGet).toHaveBeenCalledWith('/health/ready');
        done();
      });
  });
});
