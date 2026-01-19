import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, Output, EventEmitter, SimpleChanges, ViewChild } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ShippingService, LockerProvider, LockerRead } from '../core/shipping.service';
import { LazyStylesService } from '../core/lazy-styles.service';

type Leaflet = typeof import('leaflet');

@Component({
  selector: 'app-locker-picker',
  standalone: true,
  imports: [CommonModule, TranslateModule],
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

  private leaflet: Leaflet | null = null;
  private map: import('leaflet').Map | null = null;
  private markers: import('leaflet').LayerGroup | null = null;
  private initialized = false;
  private lastCenter: { lat: number; lng: number } = { lat: 44.4268, lng: 26.1025 }; // Bucharest default

  constructor(private shipping: ShippingService, private translate: TranslateService, private styles: LazyStylesService) {}

  ngAfterViewInit(): void {
    void this.initMap();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['provider'] && !changes['provider'].firstChange) {
      // Provider changed; clear selection and refresh results around the last center.
      this.selectLocker(null);
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
  }

  trackLocker(_index: number, item: LockerRead): string {
    return item.id;
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
        error: () => {
          this.loading = false;
          this.lockers = [];
          this.redrawMarkers();
          this.error = this.translate.instant('checkout.lockers.error');
          resolve();
        }
      });
    });
  }

  private redrawMarkers(): void {
    if (!this.leaflet || !this.map || !this.markers) return;
    const L = this.leaflet;
    this.markers.clearLayers();
    for (const locker of this.lockers) {
      const isSelected = this.selected?.id === locker.id;
      const marker = L.circleMarker([locker.lat, locker.lng], {
        radius: isSelected ? 8 : 6,
        color: isSelected ? '#4f46e5' : '#94a3b8',
        fillColor: isSelected ? '#4f46e5' : '#94a3b8',
        fillOpacity: 1,
        weight: 2
      });
      marker.on('click', () => this.selectLocker(locker));
      marker.addTo(this.markers);
    }
  }
}
