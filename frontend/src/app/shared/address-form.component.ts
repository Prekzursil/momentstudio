import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { AddressCreateRequest } from '../core/account.service';
import { ButtonComponent } from './button.component';

@Component({
  selector: 'app-address-form',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent],
  template: `
    <form #addrForm="ngForm" class="grid gap-3" (ngSubmit)="submit(addrForm)">
      <div class="grid gap-1 text-sm">
        <label class="font-medium text-slate-700 dark:text-slate-200">Label</label>
        <input
          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
          name="label"
          autocomplete="address-level1"
          [(ngModel)]="model.label"
        />
      </div>
      <div class="grid gap-1 text-sm">
        <label class="font-medium text-slate-700 dark:text-slate-200">Address line 1</label>
        <input
          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
          name="line1"
          autocomplete="address-line1"
          [(ngModel)]="model.line1"
          required
        />
        <p *ngIf="addrForm.submitted && addrForm.controls.line1?.invalid" class="text-xs text-rose-700 dark:text-rose-300">
          Address line 1 is required.
        </p>
      </div>
      <div class="grid gap-1 text-sm">
        <label class="font-medium text-slate-700 dark:text-slate-200">Address line 2</label>
        <input
          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
          name="line2"
          autocomplete="address-line2"
          [(ngModel)]="model.line2"
        />
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="grid gap-1 text-sm">
          <label class="font-medium text-slate-700 dark:text-slate-200">City</label>
          <input
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            name="city"
            autocomplete="address-level2"
            [(ngModel)]="model.city"
            required
          />
          <p *ngIf="addrForm.submitted && addrForm.controls.city?.invalid" class="text-xs text-rose-700 dark:text-rose-300">
            City is required.
          </p>
        </div>
        <div class="grid gap-1 text-sm">
          <label class="font-medium text-slate-700 dark:text-slate-200">Region/State</label>
          <input
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            name="region"
            autocomplete="address-level1"
            [(ngModel)]="model.region"
          />
        </div>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="grid gap-1 text-sm">
          <label class="font-medium text-slate-700 dark:text-slate-200">Postal code</label>
          <input
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            name="postal_code"
            autocomplete="postal-code"
            [(ngModel)]="model.postal_code"
            required
          />
          <p
            *ngIf="addrForm.submitted && addrForm.controls.postal_code?.invalid"
            class="text-xs text-rose-700 dark:text-rose-300"
          >
            Postal code is required.
          </p>
        </div>
        <div class="grid gap-1 text-sm">
          <label class="font-medium text-slate-700 dark:text-slate-200">Country (ISO code)</label>
          <input
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm uppercase dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            name="country"
            autocomplete="country"
            maxlength="2"
            [(ngModel)]="model.country"
            required
          />
          <p *ngIf="addrForm.submitted && addrForm.controls.country?.invalid" class="text-xs text-rose-700 dark:text-rose-300">
            Country code is required (2 letters).
          </p>
        </div>
      </div>
      <div class="grid gap-2 pt-2">
        <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" name="is_default_shipping" [(ngModel)]="model.is_default_shipping" />
          <span>Set as default shipping</span>
        </label>
        <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" name="is_default_billing" [(ngModel)]="model.is_default_billing" />
          <span>Set as default billing</span>
        </label>
        <button
          *ngIf="model.is_default_shipping && !model.is_default_billing"
          type="button"
          class="text-left text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
          (click)="model.is_default_billing = true"
        >
          Use as billing too
        </button>
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <app-button type="button" variant="ghost" label="Cancel" (action)="cancel.emit()"></app-button>
        <app-button type="submit" label="Save"></app-button>
      </div>
    </form>
  `
})
export class AddressFormComponent {
  @Input() model: AddressCreateRequest = {
    line1: '',
    city: '',
    postal_code: '',
    country: 'US'
  };
  @Output() save = new EventEmitter<AddressCreateRequest>();
  @Output() cancel = new EventEmitter<void>();

  submit(form: NgForm): void {
    if (form.valid) {
      this.save.emit(this.model);
    }
  }
}
