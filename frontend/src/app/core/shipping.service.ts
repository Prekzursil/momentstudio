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

export type LockerMirrorSnapshot = {
  provider: LockerProvider;
  total_lockers: number;
  last_success_at: string | null;
  last_error: string | null;
  stale: boolean;
  stale_age_seconds: number | null;
};

export type LockerCityRead = {
  provider: LockerProvider;
  city: string;
  county: string | null;
  display_name: string;
  lat: number;
  lng: number;
  locker_count: number;
};

export type LockerCitySearchResponse = {
  items: LockerCityRead[];
  snapshot: LockerMirrorSnapshot | null;
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

  listLockerCities(params: {
    provider: LockerProvider;
    q?: string;
    limit?: number;
  }): Observable<LockerCitySearchResponse> {
    return this.api.get<LockerCitySearchResponse>('/shipping/lockers/cities', params);
  }
}
