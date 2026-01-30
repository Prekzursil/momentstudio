import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface HealthResponse {
  status: string;
}

@Injectable({ providedIn: 'root' })
export class HealthService {
  constructor(private api: ApiService) {}

  health(): Observable<HealthResponse> {
    return this.api.get<HealthResponse>('/health');
  }

  ready(): Observable<HealthResponse> {
    return this.api.get<HealthResponse>('/health/ready');
  }
}

