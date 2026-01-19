import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AddressCreateRequest } from '../core/account.service';
import { ButtonComponent } from './button.component';
import { listPhoneCountries, PhoneCountryOption } from './phone';
import { RO_CITIES, RO_COUNTIES } from './ro-geo';

@Component({
  selector: 'app-address-form',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, TranslateModule],
  template: `
    <form #addrForm="ngForm" class="grid gap-3" (ngSubmit)="submit(addrForm)">
      <div class="grid gap-1 text-sm">
        <label class="font-medium text-slate-700 dark:text-slate-200">{{ 'addressForm.label' | translate }}</label>
        <input
          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
          name="label"
          autocomplete="off"
          [(ngModel)]="model.label"
        />
      </div>
      <div class="grid gap-1 text-sm">
        <label class="font-medium text-slate-700 dark:text-slate-200">{{ 'addressForm.line1' | translate }}</label>
        <input
          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
          name="line1"
          autocomplete="address-line1"
          [(ngModel)]="model.line1"
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
        />
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="grid gap-1 text-sm">
          <label class="font-medium text-slate-700 dark:text-slate-200">{{ 'checkout.city' | translate }}</label>
          <input
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            name="city"
            autocomplete="address-level2"
            [(ngModel)]="model.city"
            [attr.list]="model.country === 'RO' ? 'roCities' : null"
            required
          />
          <p *ngIf="addrForm.submitted && addrForm.controls.city?.invalid" class="text-xs text-rose-700 dark:text-rose-300">{{ 'validation.required' | translate }}</p>
        </div>
        <div class="grid gap-1 text-sm">
          <label class="font-medium text-slate-700 dark:text-slate-200">{{ 'checkout.region' | translate }}</label>
          <ng-container *ngIf="model.country === 'RO'; else freeRegion">
            <select
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              name="region"
              autocomplete="address-level1"
              [(ngModel)]="model.region"
            />
          </ng-template>
        </div>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="grid gap-1 text-sm">
          <label class="font-medium text-slate-700 dark:text-slate-200">{{ 'checkout.postal' | translate }}</label>
          <input
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            name="postal_code"
            autocomplete="postal-code"
            [(ngModel)]="model.postal_code"
            required
          />
          <p *ngIf="addrForm.submitted && addrForm.controls.postal_code?.invalid" class="text-xs text-rose-700 dark:text-rose-300">{{ 'validation.required' | translate }}</p>
        </div>
        <div class="grid gap-1 text-sm">
          <label class="font-medium text-slate-700 dark:text-slate-200">{{ 'checkout.country' | translate }}</label>
          <select
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            name="country"
            autocomplete="country"
            required
            [(ngModel)]="model.country"
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
      <div class="flex justify-end gap-2 pt-2">
        <app-button type="button" variant="ghost" [label]="'addressForm.cancel' | translate" (action)="cancel.emit()"></app-button>
        <app-button type="submit" [label]="'addressForm.save' | translate"></app-button>
      </div>
    </form>
  `
})
export class AddressFormComponent {
  @Input() model: AddressCreateRequest = {
    line1: '',
    city: '',
    postal_code: '',
    country: 'RO'
  };
  readonly roCounties = RO_COUNTIES;
  readonly roCities = RO_CITIES;
  readonly countries: PhoneCountryOption[];
  @Output() save = new EventEmitter<AddressCreateRequest>();
  @Output() cancel = new EventEmitter<void>();

  constructor(translate: TranslateService) {
    this.countries = listPhoneCountries(translate.currentLang || 'en');
  }

  submit(form: NgForm): void {
    if (form.valid) {
      this.save.emit(this.model);
    }
  }
}
