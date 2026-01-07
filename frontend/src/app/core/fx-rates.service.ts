import { Injectable } from '@angular/core';

import { ApiService } from './api.service';

export interface FxRatesResponse {
  base: string;
  eur_per_ron: number;
  usd_per_ron: number;
  as_of: string;
  source: string;
  fetched_at: string;
}

export interface FxRatesSnapshot {
  base: string;
  eurPerRon: number;
  usdPerRon: number;
  asOf?: string;
  fetchedAt?: string;
  source?: string;
  loaded: boolean;
}

@Injectable({ providedIn: 'root' })
export class FxRatesService {
  private loading = false;
  private loaded = false;
  private eurPerRon = 0;
  private usdPerRon = 0;
  private asOf?: string;
  private fetchedAt?: string;
  private source?: string;

  constructor(private api: ApiService) {}

  get snapshot(): FxRatesSnapshot {
    return {
      base: 'RON',
      eurPerRon: this.eurPerRon,
      usdPerRon: this.usdPerRon,
      asOf: this.asOf,
      fetchedAt: this.fetchedAt,
      source: this.source,
      loaded: this.loaded
    };
  }

  ensureLoaded(): void {
    if (this.loaded || this.loading) return;
    this.loading = true;
    this.api.get<FxRatesResponse>('/fx/rates').subscribe({
      next: (resp) => {
        this.eurPerRon = Number(resp.eur_per_ron) || 0;
        this.usdPerRon = Number(resp.usd_per_ron) || 0;
        this.asOf = resp.as_of;
        this.fetchedAt = resp.fetched_at;
        this.source = resp.source;
        this.loaded = this.eurPerRon > 0 && this.usdPerRon > 0;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }
}

