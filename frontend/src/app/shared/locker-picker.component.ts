import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, Output, EventEmitter, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { ShippingService, LockerMirrorSnapshot, LockerProvider, LockerRead } from '../core/shipping.service';
import { LazyStylesService } from '../core/lazy-styles.service';

type Leaflet = typeof import('leaflet');
type LocationResult = { display_name: string; lat: number; lng: number; locker_count?: number };

@Component({
  selector: 'app-locker-picker',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  template: `
    <div class="grid gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="rounded-xl border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            [ngClass]="
              loading
                ? 'border-slate-200 bg-white text-slate-400 dark:border-slate-800 dark:bg-slate-900'
                : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
            "
            (click)="useMyLocation()"
          >
            {{ 'checkout.lockers.useMyLocation' | translate }}
          </button>
          <button
            type="button"
            class="rounded-xl border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            [ngClass]="
              loading
                ? 'border-slate-200 bg-white text-slate-400 dark:border-slate-800 dark:bg-slate-900'
                : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
            "
            (click)="searchThisArea()"
          >
            {{ 'checkout.lockers.searchArea' | translate }}
          </button>
        </div>
        <span *ngIf="loading" class="text-xs text-slate-500 dark:text-slate-400">{{ 'checkout.lockers.loading' | translate }}</span>
      </div>

      <div class="grid gap-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'checkout.lockers.searchLabel' | translate }}</p>
          <span *ngIf="searchLoading" class="text-xs text-slate-500 dark:text-slate-400">{{ 'checkout.lockers.searching' | translate }}</span>
        </div>
        <div class="relative">
          <div class="flex gap-2">
            <div class="relative flex-1">
              <input
                class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="lockerSearch"
                autocomplete="off"
                [placeholder]="'checkout.lockers.searchPlaceholder' | translate"
                [(ngModel)]="searchQuery"
                (ngModelChange)="onSearchQueryChange($event)"
                (keydown.enter)="searchFirstResult()"
              />
              <button
                *ngIf="searchQuery.trim().length"
                type="button"
                class="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:text-slate-300 dark:hover:bg-slate-800"
                [attr.aria-label]="'checkout.lockers.clearSearch' | translate"
                (click)="clearSearchQuery()"
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-xl border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
              [disabled]="!searchQuery.trim() || searchLoading"
              [ngClass]="
                searchLoading
                  ? 'border-slate-200 bg-white text-slate-400 dark:border-slate-800 dark:bg-slate-900'
                  : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
              "
              (click)="searchFirstResult()"
            >
              {{ 'checkout.lockers.searchButton' | translate }}
            </button>
          </div>

          <div
            *ngIf="searchResults.length"
            class="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900"
            role="listbox"
          >
            <button
              *ngFor="let r of searchResults; trackBy: trackLocation"
              type="button"
              class="w-full text-left px-3 py-2 border-b border-slate-200 last:border-b-0 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"
              (click)="applyLocation(r)"
              role="option"
            >
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm text-slate-900 dark:text-slate-100">{{ r.display_name }}</p>
                <span
                  *ngIf="r.locker_count != null"
                  class="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-200"
                >
                  {{ r.locker_count }}
                </span>
              </div>
            </button>
          </div>
        </div>
        <p *ngIf="searchError" class="text-xs text-amber-700 dark:text-amber-300">{{ searchError }}</p>
        <div *ngIf="selectedLocation" class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'checkout.lockers.searchingAround' | translate }}</span>
          <button
            type="button"
            class="inline-flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            [attr.aria-label]="'checkout.lockers.clearSelectedLocation' | translate"
            (click)="clearSelectedLocation()"
            [title]="selectedLocation.display_name"
          >
            <span class="truncate max-w-[18rem]">{{ selectedLocation.display_name }}</span>
            <span class="text-slate-500 dark:text-slate-300" aria-hidden="true">&times;</span>
          </button>
        </div>
        <div
          *ngIf="provider === 'sameday' && mirrorSnapshot?.stale"
          class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100"
        >
          {{ 'checkout.lockers.snapshotStale' | translate: { days: staleDays() } }}
        </div>
      </div>

      <div #mapHost class="h-72 w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950"></div>

      <p *ngIf="error" class="text-xs text-amber-700 dark:text-amber-300">{{ error }}</p>
      <p *ngIf="!loading && !error && lockers.length === 0" class="text-xs text-slate-500 dark:text-slate-400">
        {{ 'checkout.lockers.none' | translate }}
      </p>

      <div *ngIf="lockers.length" class="grid gap-2">
        <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'checkout.lockers.results' | translate }}</p>
        <div class="max-h-48 overflow-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <button
            *ngFor="let l of lockers; trackBy: trackLocker"
            type="button"
            class="w-full text-left px-3 py-2 border-b border-slate-200 last:border-b-0 dark:border-slate-800"
            [ngClass]="
              selected?.id === l.id
                ? 'bg-indigo-50 text-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-100'
                : 'hover:bg-slate-50 text-slate-800 dark:text-slate-100 dark:hover:bg-slate-800'
            "
            (click)="selectLocker(l)"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="grid gap-0.5">
                <p class="text-sm font-medium">{{ l.name }}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400" *ngIf="l.address">{{ l.address }}</p>
              </div>
              <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0" *ngIf="l.distance_km !== null">
                {{ l.distance_km | number: '1.0-1' }} km
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  `
})
export class LockerPickerComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() provider: LockerProvider = 'sameday';
  @Input() selected: LockerRead | null = null;
  @Output() selectedChange = new EventEmitter<LockerRead | null>();

  @ViewChild('mapHost') mapHost?: ElementRef<HTMLDivElement>;

  lockers: LockerRead[] = [];
  loading = false;
  error = '';
  searchQuery = '';
  searchResults: LocationResult[] = [];
  searchLoading = false;
  searchError = '';
  selectedLocation: LocationResult | null = null;
  mirrorSnapshot: LockerMirrorSnapshot | null = null;

  private leaflet: Leaflet | null = null;
  private map: import('leaflet').Map | null = null;
  private markers: import('leaflet').LayerGroup | null = null;
  private initialized = false;
  private lastCenter: { lat: number; lng: number } = { lat: 44.4268, lng: 26.1025 }; // Bucharest default
  private searchTimer: number | null = null;
  private searchAbort: AbortController | null = null;

  constructor(private shipping: ShippingService, private translate: TranslateService, private styles: LazyStylesService) {}

  ngAfterViewInit(): void {
    void this.initMap();
    if (this.provider === 'sameday') {
      void this.refreshMirrorSnapshot();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['provider'] && !changes['provider'].firstChange) {
      // Provider changed; clear selection and refresh results around the last center.
      this.selectLocker(null);
      this.searchResults = [];
      this.searchError = '';
      this.searchQuery = '';
      if (this.provider === 'sameday') {
        void this.refreshMirrorSnapshot();
      } else {
        this.mirrorSnapshot = null;
      }
      if (this.initialized) {
        this.searchThisArea();
      }
    }
    if (changes['selected'] && this.initialized) {
      this.redrawMarkers();
    }
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
    this.markers = null;
    if (this.searchTimer && typeof window !== 'undefined') {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.searchAbort?.abort();
    this.searchAbort = null;
  }

  trackLocker(_index: number, item: LockerRead): string {
    return item.id;
  }

  trackLocation(_index: number, item: LocationResult): string {
    return `${item.lat},${item.lng},${item.display_name}`;
  }

  async initMap(): Promise<void> {
    if (this.initialized) return;
    if (!this.mapHost?.nativeElement) return;

    await this.styles.ensure('leaflet', 'assets/vendor/leaflet/leaflet.css');
    const L = await import('leaflet');
    this.leaflet = L;

    const map = L.map(this.mapHost.nativeElement, { zoomControl: true }).setView([this.lastCenter.lat, this.lastCenter.lng], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const markers = L.layerGroup().addTo(map);
    map.on('moveend', () => {
      const center = map.getCenter();
      this.lastCenter = { lat: center.lat, lng: center.lng };
    });
    map.on('dragend', () => {
      if (!this.selectedLocation) return;
      const center = map.getCenter();
      const distanceKm = this.haversineKm(this.selectedLocation.lat, this.selectedLocation.lng, center.lat, center.lng);
      if (distanceKm > 1) {
        this.selectedLocation = null;
      }
    });

    this.map = map;
    this.markers = markers;
    this.initialized = true;

    this.searchThisArea();
  }

  useMyLocation(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.error = this.translate.instant('checkout.lockers.noGeolocation');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        this.selectedLocation = null;
        this.lastCenter = { lat, lng };
        this.map?.setView([lat, lng], 13);
        this.searchThisArea();
      },
      () => {
        this.error = this.translate.instant('checkout.lockers.geoDenied');
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }

  searchThisArea(): void {
    void this.loadLockers(this.lastCenter.lat, this.lastCenter.lng);
  }

  clearSearchQuery(): void {
    this.searchQuery = '';
    this.searchResults = [];
    this.searchError = '';
    this.searchLoading = false;
    this.searchAbort?.abort();
  }

  clearSelectedLocation(): void {
    this.selectedLocation = null;
  }

  onSearchQueryChange(next: string): void {
    this.searchQuery = next;
    this.searchError = '';
    if (this.searchTimer && typeof window !== 'undefined') window.clearTimeout(this.searchTimer);
    const query = next.trim();
    if (query.length < 3) {
      this.searchResults = [];
      this.searchAbort?.abort();
      return;
    }
    if (typeof window === 'undefined') return;
    this.searchTimer = window.setTimeout(() => void this.fetchLocations(query), 250);
  }

  searchFirstResult(): void {
    const query = this.searchQuery.trim();
    if (!query) return;
    if (this.searchResults.length) {
      this.applyLocation(this.searchResults[0]);
      return;
    }
    void this.fetchLocations(query, { applyFirst: true });
  }

  applyLocation(item: LocationResult): void {
    this.searchResults = [];
    this.searchError = '';
    this.searchQuery = '';
    this.selectedLocation = item;
    this.lastCenter = { lat: item.lat, lng: item.lng };
    this.map?.setView([item.lat, item.lng], 13);
    this.searchThisArea();
  }

  selectLocker(locker: LockerRead | null): void {
    this.selected = locker;
    this.selectedChange.emit(locker);
    this.redrawMarkers();
    if (locker) {
      this.map?.panTo([locker.lat, locker.lng]);
    }
  }

  private loadLockers(lat: number, lng: number): Promise<void> {
    this.loading = true;
    this.error = '';
    const radius_km = 12;
    const limit = 60;
    return new Promise((resolve) => {
      this.shipping.listLockers({ provider: this.provider, lat, lng, radius_km, limit }).subscribe({
        next: (items) => {
          this.lockers = Array.isArray(items) ? items : [];
          this.loading = false;
          this.redrawMarkers();
          resolve();
        },
        error: (err) => {
          this.loading = false;
          this.lockers = [];
          this.redrawMarkers();
          const detail = String(err?.error?.detail || '').toLowerCase();
          if (this.provider === 'sameday' && (detail.includes('mirror') || detail.includes('locker'))) {
            this.error = this.translate.instant('checkout.lockers.mirrorUnavailable');
          } else {
            this.error = this.translate.instant('checkout.lockers.error');
          }
          resolve();
        }
      });
    });
  }

  private redrawMarkers(): void {
    if (!this.leaflet || !this.map || !this.markers) return;
    const L = this.leaflet;
    this.markers.clearLayers();
    const stroke = '#0f172a';
    const fill = '#38bdf8';
    const selectedFill = '#4f46e5';
    for (const locker of this.lockers) {
      const isSelected = this.selected?.id === locker.id;
      const marker = L.circleMarker([locker.lat, locker.lng], {
        radius: isSelected ? 9 : 7,
        color: stroke,
        fillColor: isSelected ? selectedFill : fill,
        fillOpacity: isSelected ? 1 : 0.9,
        weight: isSelected ? 3 : 2
      });
      marker.on('click', () => this.selectLocker(locker));
      marker.addTo(this.markers);
    }
  }

  private haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const r = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  private async fetchLocations(query: string, opts?: { applyFirst?: boolean }): Promise<void> {
    if (typeof window === 'undefined') return;
    this.searchAbort?.abort();
    const controller = new AbortController();
    this.searchAbort = controller;
    this.searchLoading = true;
    this.searchError = '';

    if (this.provider === 'sameday') {
      try {
        const response = await firstValueFrom(
          this.shipping.listLockerCities({
            provider: this.provider,
            q: query,
            limit: 6
          })
        );
        if (controller.signal.aborted) return;
        this.mirrorSnapshot = response?.snapshot ?? null;
        const rows = Array.isArray(response?.items) ? response.items : [];
        const results: LocationResult[] = rows
          .map((row) => ({
            display_name: String(row.display_name || '').trim(),
            lat: Number(row.lat),
            lng: Number(row.lng),
            locker_count: Number.isFinite(Number(row.locker_count)) ? Number(row.locker_count) : undefined
          }))
          .filter((row) => row.display_name && Number.isFinite(row.lat) && Number.isFinite(row.lng));
        this.searchResults = results;
        this.searchLoading = false;
        if (opts?.applyFirst && results.length) {
          this.applyLocation(results[0]);
        } else if (opts?.applyFirst && !results.length) {
          this.searchError = this.translate.instant('checkout.lockers.searchNoResults');
        }
      } catch (err) {
        this.searchLoading = false;
        this.searchResults = [];
        if ((err as any)?.name !== 'AbortError') {
          this.searchError = this.translate.instant('checkout.lockers.searchError');
        }
      }
      return;
    }

    const params = new URLSearchParams({
      format: 'jsonv2',
      limit: '6',
      q: query,
      countrycodes: 'ro'
    });

    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        signal: controller.signal,
        headers: { accept: 'application/json' }
      });
      if (!resp.ok) {
        this.searchResults = [];
        this.searchLoading = false;
        this.searchError = this.translate.instant('checkout.lockers.searchError');
        return;
      }
      const data = (await resp.json()) as unknown;
      const results: LocationResult[] = Array.isArray(data)
        ? data
            .filter((it) => it && typeof it === 'object' && 'display_name' in it && 'lat' in it && 'lon' in it)
            .slice(0, 6)
            .map((it: any) => ({
              display_name: String(it.display_name || '').trim(),
              lat: Number.parseFloat(String(it.lat || '')),
              lng: Number.parseFloat(String(it.lon || ''))
            }))
            .filter((it) => it.display_name && Number.isFinite(it.lat) && Number.isFinite(it.lng))
        : [];

      this.searchResults = results;
      this.searchLoading = false;

      if (opts?.applyFirst && results.length) {
        this.applyLocation(results[0]);
      } else if (opts?.applyFirst && !results.length) {
        this.searchError = this.translate.instant('checkout.lockers.searchNoResults');
      }
    } catch (err) {
      this.searchLoading = false;
      this.searchResults = [];
      if ((err as any)?.name !== 'AbortError') {
        this.searchError = this.translate.instant('checkout.lockers.searchError');
      }
    }
  }

  staleDays(): number {
    const age = Number(this.mirrorSnapshot?.stale_age_seconds ?? 0);
    if (!Number.isFinite(age) || age <= 0) return 30;
    return Math.max(1, Math.floor(age / 86400));
  }

  private async refreshMirrorSnapshot(): Promise<void> {
    if (this.provider !== 'sameday') return;
    try {
      const res = await firstValueFrom(this.shipping.listLockerCities({ provider: this.provider, q: '', limit: 1 }));
      this.mirrorSnapshot = res?.snapshot ?? null;
    } catch {
      // Best-effort only; picker should remain usable without snapshot metadata.
    }
  }
}
