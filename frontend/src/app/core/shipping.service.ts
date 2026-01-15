import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export type LockerProvider = 'sameday' | 'fan_courier';

export type LockerRead = {
  id: string;
  provider: LockerProvider;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  distance_km: number | null;
};

@Injectable({ providedIn: 'root' })
export class ShippingService {
  constructor(private api: ApiService) {}

  listLockers(params: {
    provider: LockerProvider;
    lat: number;
    lng: number;
    radius_km?: number;
    limit?: number;
  }): Observable<LockerRead[]> {
    return this.api.get<LockerRead[]>('/shipping/lockers', params);
  }
}

