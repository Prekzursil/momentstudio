import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

import { AddressFormComponent } from '../../shared/address-form.component';
import { ButtonComponent } from '../../shared/button.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { AccountComponent } from './account.component';

@Component({
  selector: 'app-account-addresses',
  standalone: true,
  imports: [CommonModule, TranslateModule, ButtonComponent, AddressFormComponent, SkeletonComponent],
  template: `
    <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'account.sections.addresses' | translate }}</h2>
        <app-button size="sm" variant="ghost" [label]="'account.addresses.add' | translate" (action)="account.openAddressForm()"></app-button>
      </div>

      <div *ngIf="account.addressesLoading() && !account.addressesLoaded()" class="grid gap-3">
        <app-skeleton height="18px" width="220px"></app-skeleton>
        <app-skeleton height="84px"></app-skeleton>
      </div>

      <div
        *ngIf="!account.addressesLoading() && account.addressesError()"
        class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
      >
        <div class="flex items-start justify-between gap-3">
          <span class="min-w-0">{{ account.addressesError() | translate }}</span>
          <app-button
            size="sm"
            variant="ghost"
            [label]="'shop.retry' | translate"
            [disabled]="account.addressesLoading()"
            (action)="account.loadAddresses(true)"
          ></app-button>
        </div>
      </div>

      <div *ngIf="account.showAddressForm" class="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <app-address-form [model]="account.addressModel" (save)="account.saveAddress($event)" (cancel)="account.closeAddressForm()"></app-address-form>
      </div>
      <div
        *ngIf="
          account.addressesLoaded() && !account.addressesLoading() && !account.addressesError() && account.addresses().length === 0 && !account.showAddressForm
        "
        class="text-sm text-slate-700 dark:text-slate-200"
      >
        {{ 'account.addresses.empty' | translate }}
      </div>
      <div
        *ngFor="let addr of account.addresses()"
        class="rounded-lg border border-slate-200 p-3 grid gap-1 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200"
      >
        <div class="flex items-center justify-between">
          <span class="font-semibold text-slate-900 dark:text-slate-50">{{ addr.label || 'Address' }}</span>
          <div class="flex items-center gap-2 text-xs">
            <span *ngIf="addr.is_default_shipping" class="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">{{
              'account.addresses.defaultShipping' | translate
            }}</span>
            <span *ngIf="addr.is_default_billing" class="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">{{
              'account.addresses.defaultBilling' | translate
            }}</span>
          </div>
          <div class="flex flex-wrap gap-2">
            <app-button
              size="sm"
              variant="ghost"
              [label]="'account.addresses.makeDefaultShipping' | translate"
              *ngIf="!addr.is_default_shipping"
              (action)="account.setDefaultShipping(addr)"
            ></app-button>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'account.addresses.makeDefaultBilling' | translate"
              *ngIf="!addr.is_default_billing"
              (action)="account.setDefaultBilling(addr)"
            ></app-button>
            <app-button size="sm" variant="ghost" [label]="'account.addresses.edit' | translate" (action)="account.editAddress(addr)"></app-button>
            <app-button size="sm" variant="ghost" [label]="'account.addresses.delete' | translate" (action)="account.removeAddress(addr.id)"></app-button>
          </div>
        </div>
        <span
          >{{ addr.line1 }}<ng-container *ngIf="addr.line2">, {{ addr.line2 }}</ng-container></span
        >
        <span>{{ addr.city }}<ng-container *ngIf="addr.region">, {{ addr.region }}</ng-container>, {{ addr.postal_code }}</span>
        <span>{{ addr.country }}</span>
      </div>
    </section>
  `
})
export class AccountAddressesComponent {
  protected readonly account = inject(AccountComponent);

  hasUnsavedChanges(): boolean {
    return this.account.addressesHasUnsavedChanges();
  }

  discardUnsavedChanges(): void {
    this.account.discardAddressChanges();
  }
}
