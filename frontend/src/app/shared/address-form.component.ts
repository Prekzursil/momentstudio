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
        <label class="font-medium text-slate-700">Label</label>
        <input class="rounded-lg border border-slate-200 px-3 py-2" name="label" [(ngModel)]="model.label" />
      </div>
      <div class="grid gap-1 text-sm">
        <label class="font-medium text-slate-700">Address line 1</label>
        <input class="rounded-lg border border-slate-200 px-3 py-2" name="line1" [(ngModel)]="model.line1" required />
      </div>
      <div class="grid gap-1 text-sm">
        <label class="font-medium text-slate-700">Address line 2</label>
        <input class="rounded-lg border border-slate-200 px-3 py-2" name="line2" [(ngModel)]="model.line2" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div class="grid gap-1 text-sm">
          <label class="font-medium text-slate-700">City</label>
          <input class="rounded-lg border border-slate-200 px-3 py-2" name="city" [(ngModel)]="model.city" required />
        </div>
        <div class="grid gap-1 text-sm">
          <label class="font-medium text-slate-700">Region/State</label>
          <input class="rounded-lg border border-slate-200 px-3 py-2" name="region" [(ngModel)]="model.region" />
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div class="grid gap-1 text-sm">
          <label class="font-medium text-slate-700">Postal code</label>
          <input class="rounded-lg border border-slate-200 px-3 py-2" name="postal_code" [(ngModel)]="model.postal_code" required />
        </div>
        <div class="grid gap-1 text-sm">
          <label class="font-medium text-slate-700">Country (ISO code)</label>
          <input class="rounded-lg border border-slate-200 px-3 py-2" name="country" [(ngModel)]="model.country" required />
        </div>
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
