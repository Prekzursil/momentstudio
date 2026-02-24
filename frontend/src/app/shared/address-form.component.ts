import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AddressCreateRequest } from '../core/account.service';
import { appConfig } from '../core/app-config';
import { ButtonComponent } from './button.component';
import { buildE164, listPhoneCountries, PhoneCountryOption, splitE164 } from './phone';
import { RO_CITIES, RO_COUNTIES } from './ro-geo';

@Component({
  selector: 'app-address-form',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, TranslateModule],
  template: `
    <form #addrForm="ngForm" class="grid gap-3" (ngSubmit)="submit(addrForm)">
      <div *ngIf="addressAutocompleteEnabled" class="grid gap-1 text-sm">
        <label class="font-medium text-slate-700 dark:text-slate-200">{{ 'addressForm.autocomplete.label' | translate }}</label>
        <div class="relative">
          <input
            class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            name="autocomplete"
            autocomplete="off"
            [(ngModel)]="autocompleteQuery"
            (ngModelChange)="onAutocompleteQueryChange($event)"
            [placeholder]="'addressForm.autocomplete.placeholder' | translate"
          />
          <div
            *ngIf="autocompleteResults.length"
            class="absolute z-10 mt-1 grid w-full gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          >
            <button
              *ngFor="let item of autocompleteResults"
              type="button"
              class="rounded-lg px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
              (click)="applyAutocomplete(item)"
            >
              {{ item.display_name }}
            </button>
          </div>
        </div>
        <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'addressForm.autocomplete.poweredBy' | translate }}</p>
      </div>

      <div class="grid gap-1 text-sm">
        <label class="font-medium text-slate-700 dark:text-slate-200">{{ 'addressForm.label' | translate }}</label>
        <div class="grid gap-2 sm:grid-cols-2 min-w-0">
          <select
            class="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            name="labelPreset"
            [(ngModel)]="labelPreset"
            (ngModelChange)="applyLabelPreset()"
          >
            <option value="home">{{ 'account.addresses.labels.home' | translate }}</option>
            <option value="work">{{ 'account.addresses.labels.work' | translate }}</option>
            <option value="other">{{ 'account.addresses.labels.other' | translate }}</option>
            <option value="custom">{{ 'account.addresses.labels.custom' | translate }}</option>
          </select>
          <input
            *ngIf="labelPreset === 'custom'"
            class="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            name="labelCustom"
            autocomplete="off"
            [(ngModel)]="labelCustom"
            (ngModelChange)="applyLabelPreset()"
            [placeholder]="'addressForm.customLabelPlaceholder' | translate"
            maxlength="50"
          />
        </div>
      </div>

      <div class="grid gap-1 text-sm">
        <label class="font-medium text-slate-700 dark:text-slate-200">{{ 'auth.phone' | translate }}</label>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
          <select
            class="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            name="phoneCountry"
            [(ngModel)]="phoneCountry"
            (ngModelChange)="onPhoneChanged()"
          >
            <option *ngFor="let c of countries" [value]="c.code">{{ c.flag }} {{ c.dial }} {{ c.name }}</option>
          </select>
          <input
            #phoneCtrl="ngModel"
            type="tel"
            class="w-full min-w-0 rounded-lg border bg-white px-3 py-2 text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            [ngClass]="
              (phoneCtrl.invalid && (phoneCtrl.touched || addrForm.submitted)) || (phoneNational && !phoneE164())
                ? 'border-rose-300 ring-2 ring-rose-200 dark:border-rose-900/40 dark:ring-rose-900/30'
                : 'border-slate-200 dark:border-slate-700'
            "
            [attr.aria-invalid]="
              (phoneCtrl.invalid && (phoneCtrl.touched || addrForm.submitted)) || (phoneNational && !phoneE164()) ? 'true' : null
            "
            aria-describedby="address-phone-invalid"
            name="phoneNational"
            [(ngModel)]="phoneNational"
            (ngModelChange)="onPhoneChanged()"
            autocomplete="tel-national"
            inputmode="numeric"
            pattern="^[0-9]{6,14}$"
          />
        </div>
        <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'auth.phoneHint' | translate }}</span>
        <span
          *ngIf="phoneNational && !phoneE164()"
          id="address-phone-invalid"
          class="text-xs font-normal text-rose-700 dark:text-rose-300"
        >
          {{ 'validation.phoneInvalid' | translate }}
        </span>
      </div>
      <div class="grid gap-1 text-sm">
        <label class="font-medium text-slate-700 dark:text-slate-200">{{ 'addressForm.line1' | translate }} <span class="text-rose-600">*</span></label>
        <input
          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
          name="line1"
          autocomplete="address-line1"
          [(ngModel)]="model.line1"
          maxlength="200"
          required
        />
        <p *ngIf="addrForm.submitted && addrForm.controls.line1?.invalid" class="text-xs text-rose-700 dark:text-rose-300">{{ 'validation.required' | translate }}</p>
      </div>
      <div class="grid gap-1 text-sm">
        <label class="font-medium text-slate-700 dark:text-slate-200">{{ 'addressForm.line2' | translate }}</label>
        <input
          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
          name="line2"
          autocomplete="address-line2"
          [(ngModel)]="model.line2"
          maxlength="200"
        />
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="grid gap-1 text-sm">
          <label class="font-medium text-slate-700 dark:text-slate-200">{{ 'checkout.city' | translate }} <span class="text-rose-600">*</span></label>
          <input
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            name="city"
            autocomplete="address-level2"
            [(ngModel)]="model.city"
            [attr.list]="model.country === 'RO' ? 'roCities' : null"
            maxlength="100"
            required
          />
          <p *ngIf="addrForm.submitted && addrForm.controls.city?.invalid" class="text-xs text-rose-700 dark:text-rose-300">{{ 'validation.required' | translate }}</p>
        </div>
        <div class="grid gap-1 text-sm">
          <label class="font-medium text-slate-700 dark:text-slate-200"
            >{{ 'checkout.region' | translate }} <span *ngIf="model.country === 'RO'" class="text-rose-600">*</span></label
          >
          <ng-container *ngIf="model.country === 'RO'; else freeRegion">
            <select
              class="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              name="region"
              autocomplete="address-level1"
              [(ngModel)]="model.region"
              required
            >
              <option value="">{{ 'checkout.regionSelect' | translate }}</option>
              <option *ngFor="let r of roCounties" [value]="r">{{ r }}</option>
            </select>
          </ng-container>
          <ng-template #freeRegion>
            <input
              class="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              name="region"
              autocomplete="address-level1"
              [(ngModel)]="model.region"
              maxlength="100"
            />
          </ng-template>
        </div>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="grid gap-1 text-sm">
          <label class="font-medium text-slate-700 dark:text-slate-200">{{ 'checkout.postal' | translate }} <span class="text-rose-600">*</span></label>
          <input
            class="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            name="postal_code"
            autocomplete="postal-code"
            [(ngModel)]="model.postal_code"
            [attr.pattern]="postalPattern || null"
            [placeholder]="postalExample"
            maxlength="20"
            required
          />
          <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'addressForm.postalHint' | translate : { example: postalExample } }}</p>
          <p
            *ngIf="addrForm.submitted && addrForm.controls.postal_code?.errors?.required"
            class="text-xs text-rose-700 dark:text-rose-300"
          >
            {{ 'validation.required' | translate }}
          </p>
          <p
            *ngIf="addrForm.submitted && addrForm.controls.postal_code?.errors?.pattern"
            class="text-xs text-rose-700 dark:text-rose-300"
          >
            {{ 'validation.invalidPostal' | translate }}
          </p>
        </div>
        <div class="grid gap-1 text-sm">
          <label class="font-medium text-slate-700 dark:text-slate-200">{{ 'checkout.country' | translate }} <span class="text-rose-600">*</span></label>
          <select
            class="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            name="country"
            autocomplete="country"
            required
            [(ngModel)]="model.country"
            (ngModelChange)="onCountryChange()"
          >
            <option value="">{{ 'checkout.countrySelect' | translate }}</option>
            <option *ngFor="let c of countries" [value]="c.code">{{ c.flag }} {{ c.name }}</option>
          </select>
          <p *ngIf="addrForm.submitted && addrForm.controls.country?.invalid" class="text-xs text-rose-700 dark:text-rose-300">{{ 'validation.required' | translate }}</p>
        </div>
      </div>
      <datalist id="roCities">
        <option *ngFor="let c of roCities" [value]="c"></option>
      </datalist>
      <div class="grid gap-2 pt-2">
        <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" name="is_default_shipping" [(ngModel)]="model.is_default_shipping" />
          <span>{{ 'addressForm.defaultShipping' | translate }}</span>
        </label>
        <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" name="is_default_billing" [(ngModel)]="model.is_default_billing" />
          <span>{{ 'addressForm.defaultBilling' | translate }}</span>
        </label>
        <button
          *ngIf="model.is_default_shipping && !model.is_default_billing"
          type="button"
          class="text-left text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
          (click)="model.is_default_billing = true"
        >
          {{ 'addressForm.useAsBillingToo' | translate }}
        </button>
      </div>
      <div [ngClass]="stickyActions ? stickyActionsClass : normalActionsClass">
        <app-button type="button" variant="ghost" [label]="'addressForm.cancel' | translate" (action)="cancel.emit()"></app-button>
        <app-button type="submit" [label]="'addressForm.save' | translate"></app-button>
      </div>
    </form>
  `
})
export class AddressFormComponent implements OnChanges, OnDestroy {
  @Input() model: AddressCreateRequest = {
    line1: '',
    city: '',
    postal_code: '',
    country: 'RO'
  };
  @Input() stickyActions = false;
  readonly roCounties = RO_COUNTIES;
  readonly roCities = RO_CITIES;
  readonly countries: PhoneCountryOption[];
  readonly addressAutocompleteEnabled = appConfig.addressAutocompleteEnabled;
  autocompleteQuery = '';
  autocompleteResults: Array<{ display_name: string; address?: Record<string, unknown> }> = [];
  private autocompleteTimer: number | null = null;
  private autocompleteAbort: AbortController | null = null;
  labelPreset: 'home' | 'work' | 'other' | 'custom' = 'home';
  labelCustom = '';
  phoneCountry = 'RO';
  phoneNational = '';
  @Output() save = new EventEmitter<AddressCreateRequest>();
  @Output() cancel = new EventEmitter<void>();
  readonly normalActionsClass = 'flex justify-end gap-2 pt-2';
  readonly stickyActionsClass =
    'sticky bottom-0 z-10 -mx-4 sm:-mx-6 mt-4 px-4 sm:px-6 py-3 flex justify-end gap-2 bg-white/95 backdrop-blur border-t border-slate-200 dark:bg-slate-900/95 dark:border-slate-700';

  constructor(translate: TranslateService) {
    this.countries = listPhoneCountries(translate.currentLang || 'en');
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['model']) {
      this.syncLabelState();
      this.syncPhoneState();
    }
  }

  ngOnDestroy(): void {
    if (this.autocompleteTimer) {
      window.clearTimeout(this.autocompleteTimer);
      this.autocompleteTimer = null;
    }
    this.autocompleteAbort?.abort();
    this.autocompleteAbort = null;
  }

  phoneE164(): string | null {
    const country = (this.phoneCountry || 'RO') as any;
    return buildE164(country, this.phoneNational);
  }

  onPhoneChanged(): void {
    const digits = (this.phoneNational || '').trim();
    if (!digits) {
      this.model.phone = null;
      return;
    }
    this.model.phone = this.phoneE164();
  }

  get postalExample(): string {
    const country = String(this.model?.country || '').trim().toUpperCase();
    return (
      {
        RO: '123456',
        US: '12345',
        CA: 'A1A 1A1',
        GB: 'SW1A 1AA',
        DE: '12345'
      }[country] || '12345'
    );
  }

  private syncPhoneState(): void {
    const raw = typeof this.model?.phone === 'string' ? this.model.phone.trim() : '';
    if (!raw) {
      this.phoneCountry = 'RO';
      this.phoneNational = '';
      return;
    }
    const split = splitE164(raw);
    if (split.country) this.phoneCountry = split.country;
    this.phoneNational = split.nationalNumber || '';
  }

  get postalPattern(): string | null {
    const country = String(this.model?.country || '').trim().toUpperCase();
    return (
      {
        US: '^\\d{5}(-\\d{4})?$',
        CA: '^[A-Za-z]\\d[A-Za-z][ -]?\\d[A-Za-z]\\d$',
        GB: '^[A-Za-z]{1,2}\\d[A-Za-z\\d]? ?\\d[A-Za-z]{2}$',
        RO: '^\\d{6}$',
        DE: '^\\d{5}$'
      }[country] || '^[A-Za-z0-9 -]{3,12}$'
    );
  }

  onCountryChange(): void {
    this.autocompleteResults = [];
    if (this.addressAutocompleteEnabled && this.autocompleteQuery.trim().length >= 3) {
      this.onAutocompleteQueryChange(this.autocompleteQuery);
    }
  }

  onAutocompleteQueryChange(next: string): void {
    if (!this.addressAutocompleteEnabled) return;
    this.autocompleteQuery = next;
    if (this.autocompleteTimer) window.clearTimeout(this.autocompleteTimer);
    const query = next.trim();
    if (query.length < 3) {
      this.autocompleteResults = [];
      this.autocompleteAbort?.abort();
      return;
    }
    this.autocompleteTimer = window.setTimeout(() => void this.fetchAutocomplete(query), 300);
  }

  applyAutocomplete(item: { display_name: string; address?: Record<string, unknown> }): void {
    const addr = item.address || {};
    const countryRaw = typeof addr['country_code'] === 'string' ? addr['country_code'] : '';
    const country = countryRaw ? countryRaw.toUpperCase() : '';
    const house = typeof addr['house_number'] === 'string' ? addr['house_number'] : '';
    const roadRaw =
      (typeof addr['road'] === 'string' && addr['road']) ||
      (typeof addr['pedestrian'] === 'string' && addr['pedestrian']) ||
      (typeof addr['cycleway'] === 'string' && addr['cycleway']) ||
      '';
    const cityRaw =
      (typeof addr['city'] === 'string' && addr['city']) ||
      (typeof addr['town'] === 'string' && addr['town']) ||
      (typeof addr['village'] === 'string' && addr['village']) ||
      (typeof addr['municipality'] === 'string' && addr['municipality']) ||
      '';
    const regionRaw =
      (typeof addr['state'] === 'string' && addr['state']) ||
      (typeof addr['county'] === 'string' && addr['county']) ||
      (typeof addr['region'] === 'string' && addr['region']) ||
      '';
    const postal = typeof addr['postcode'] === 'string' ? addr['postcode'] : '';

    if (country && country.length === 2) this.model.country = country;
    const line1 = `${house} ${roadRaw}`.trim() || roadRaw;
    if (line1) this.model.line1 = line1;
    if (cityRaw) this.model.city = cityRaw;
    if (postal) this.model.postal_code = postal;

    if (country === 'RO' && regionRaw) {
      const match = this.roCounties.find((r) => r.toLowerCase() === regionRaw.toLowerCase());
      if (match) this.model.region = match;
    } else if (regionRaw) {
      this.model.region = regionRaw;
    }

    this.autocompleteResults = [];
    this.autocompleteQuery = '';
  }

  applyLabelPreset(): void {
    if (this.labelPreset === 'custom') {
      const value = this.labelCustom.trim();
      this.model.label = value ? value : null;
      return;
    }
    this.model.label = this.labelPreset;
  }

  private syncLabelState(): void {
    const value = String(this.model?.label || '').trim();
    if (!value) {
      this.labelPreset = 'home';
      this.labelCustom = '';
      this.model.label = 'home';
      return;
    }
    const normalized = value.toLowerCase();
    if (normalized === 'home' || normalized === 'work' || normalized === 'other') {
      this.labelPreset = normalized as 'home' | 'work' | 'other';
      this.labelCustom = '';
      this.model.label = this.labelPreset;
      return;
    }
    this.labelPreset = 'custom';
    this.labelCustom = value;
  }

  private async fetchAutocomplete(query: string): Promise<void> {
    if (typeof window === 'undefined') return;
    this.autocompleteAbort?.abort();
    const controller = new AbortController();
    this.autocompleteAbort = controller;

    const country = String(this.model?.country || '').trim().toLowerCase();
    const params = new URLSearchParams({
      format: 'jsonv2',
      addressdetails: '1',
      limit: '6',
      q: query
    });
    if (country.length === 2) params.set('countrycodes', country);

    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        signal: controller.signal,
        headers: { accept: 'application/json' }
      });
      if (!resp.ok) {
        this.autocompleteResults = [];
        return;
      }
      const data = (await resp.json()) as unknown;
      this.autocompleteResults = Array.isArray(data)
        ? data
            .filter((it) => it && typeof it === 'object' && 'display_name' in it)
            .slice(0, 6)
            .map((it: any) => ({
              display_name: String(it.display_name || '').trim(),
              address: typeof it.address === 'object' && it.address ? it.address : {}
            }))
            .filter((it) => it.display_name)
        : [];
    } catch (err) {
      if ((err as any)?.name !== 'AbortError') {
        this.autocompleteResults = [];
      }
    }
  }

  submit(form: NgForm): void {
    if (form.valid && !(this.phoneNational && !this.phoneE164())) {
      this.save.emit(this.model);
    }
  }
}

