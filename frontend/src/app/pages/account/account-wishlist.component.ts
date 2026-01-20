import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { ProductCardComponent } from '../../shared/product-card.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { AccountComponent } from './account.component';

@Component({
  selector: 'app-account-wishlist',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, ProductCardComponent, SkeletonComponent],
  template: `
    <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'nav.myWishlist' | translate }}</h2>
        <a routerLink="/shop" class="text-sm text-indigo-600 dark:text-indigo-300 font-medium">{{ 'account.wishlist.browse' | translate }}</a>
      </div>

      <div *ngIf="!account.wishlist.isLoaded()" class="grid gap-3">
        <app-skeleton height="18px" width="200px"></app-skeleton>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <app-skeleton height="220px"></app-skeleton>
          <app-skeleton height="220px"></app-skeleton>
          <app-skeleton height="220px"></app-skeleton>
        </div>
      </div>

      <ng-container *ngIf="account.wishlist.isLoaded()">
        <div
          *ngIf="account.wishlist.items().length === 0"
          class="border border-dashed border-slate-200 rounded-xl p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"
        >
          {{ 'account.wishlist.empty' | translate }}
        </div>
        <div *ngIf="account.wishlist.items().length" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <app-product-card *ngFor="let item of account.wishlist.items()" [product]="item"></app-product-card>
        </div>
      </ng-container>
    </section>
  `
})
export class AccountWishlistComponent {
  protected readonly account = inject(AccountComponent);
}
