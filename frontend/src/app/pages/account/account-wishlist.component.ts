import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

import { CartStore } from '../../core/cart.store';
import { BackInStockRequest, BackInStockStatus, CatalogService, Product } from '../../core/catalog.service';
import { ToastService } from '../../core/toast.service';
import { ProductCardComponent } from '../../shared/product-card.component';
import { ButtonComponent } from '../../shared/button.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { AccountComponent } from './account.component';

@Component({
  selector: 'app-account-wishlist',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    TranslateModule,
    ProductCardComponent,
    SkeletonComponent,
    ButtonComponent,
    LocalizedCurrencyPipe
  ],
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
        <ng-container *ngIf="account.wishlist.items().length">
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
            <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                [checked]="allSelected()"
                (change)="toggleSelectAll($any($event.target).checked)"
                [disabled]="bulkBusy"
              />
              <span>{{ 'account.wishlist.selectAll' | translate }}</span>
            </label>
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm text-slate-600 dark:text-slate-300" *ngIf="selectedCount()">{{
                'account.wishlist.selectedCount' | translate : { count: selectedCount() }
              }}</span>
              <app-button
                size="sm"
                [label]="'account.wishlist.addSelectedToCart' | translate"
                [disabled]="bulkBusy || selectedCount() === 0"
                (action)="addSelectedToCart()"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'account.wishlist.removeSelected' | translate"
                [disabled]="bulkBusy || selectedCount() === 0"
                (action)="removeSelected()"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'account.wishlist.clearSelection' | translate"
                [disabled]="bulkBusy || selectedCount() === 0"
                (action)="clearSelection()"
              ></app-button>
            </div>
          </div>

          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div *ngFor="let item of account.wishlist.items()" class="relative">
              <label
                class="absolute left-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white/90 shadow-sm dark:border-slate-700 dark:bg-slate-900/90"
              >
                <input
                  type="checkbox"
                  [checked]="isSelected(item.id)"
                  (change)="toggleSelected(item.id, $any($event.target).checked)"
                  [disabled]="bulkBusy"
                />
              </label>
              <div class="absolute left-3 top-14 z-10 flex flex-col gap-1">
                <span
                  *ngIf="stockChange(item) === 'back'"
                  class="rounded-full bg-emerald-600/90 px-3 py-1 text-xs font-semibold text-white shadow"
                >
                  {{ 'account.wishlist.backInStock' | translate }}
                </span>
                <span
                  *ngIf="stockChange(item) === 'out'"
                  class="rounded-full bg-slate-900/90 px-3 py-1 text-xs font-semibold text-white shadow dark:bg-slate-800/90"
                >
                  {{ 'account.wishlist.outOfStock' | translate }}
                </span>
                <span
                  *ngIf="priceChange(item) as p"
                  class="rounded-full bg-indigo-600/90 px-3 py-1 text-xs font-semibold text-white shadow"
                >
                  {{ p.direction === 'up' ? ('account.wishlist.priceUp' | translate) : ('account.wishlist.priceDown' | translate) }}
                  {{ p.delta | localizedCurrency : item.currency }}
                </span>
              </div>
              <app-product-card [product]="item"></app-product-card>
              <div *ngIf="isOutOfStock(item)" class="mt-2 flex flex-wrap gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="
                    backInStockRequest(item)
                      ? ('product.notifyRequested' | translate)
                      : ('product.notifyBackInStock' | translate)
                  "
                  [disabled]="bulkBusy || isBackInStockBusy(item) || !!backInStockRequest(item)"
                  (action)="requestBackInStock(item)"
                ></app-button>
                <app-button
                  *ngIf="backInStockRequest(item)"
                  size="sm"
                  variant="ghost"
                  [label]="'product.notifyCancel' | translate"
                  [disabled]="bulkBusy || isBackInStockBusy(item)"
                  (action)="cancelBackInStock(item)"
                ></app-button>
              </div>
            </div>
          </div>
        </ng-container>
      </ng-container>
    </section>
  `
})
export class AccountWishlistComponent {
  protected readonly account = inject(AccountComponent);
  private readonly cart = inject(CartStore);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly catalog = inject(CatalogService);

  selected = new Set<string>();
  bulkBusy = false;
  private readonly backInStockById = new Map<string, BackInStockStatus>();
  private readonly backInStockBusy = new Set<string>();

  isSelected(productId: string): boolean {
    return this.selected.has(productId);
  }

  selectedCount(): number {
    return this.selected.size;
  }

  allSelected(): boolean {
    const items = this.account.wishlist.items();
    return items.length > 0 && items.every((p) => this.selected.has(p.id));
  }

  toggleSelected(productId: string, checked: boolean): void {
    if (checked) {
      this.selected.add(productId);
    } else {
      this.selected.delete(productId);
    }
  }

  toggleSelectAll(checked: boolean): void {
    if (!checked) {
      this.selected.clear();
      return;
    }
    for (const item of this.account.wishlist.items()) {
      this.selected.add(item.id);
    }
  }

  clearSelection(): void {
    this.selected.clear();
  }

  addSelectedToCart(): void {
    const ids = Array.from(this.selected);
    const byId = new Map(this.account.wishlist.items().map((p) => [p.id, p]));
    for (const id of ids) {
      const product = byId.get(id);
      if (!product) continue;
      this.cart.addFromProduct({
        product_id: product.id,
        quantity: 1,
        name: product.name,
        slug: product.slug,
        price: product.sale_price != null ? product.sale_price : product.base_price,
        currency: product.currency,
        stock: product.stock_quantity ?? undefined,
        image: product.images?.[0]?.url
      });
    }
    this.toast.success(this.translate.instant('account.wishlist.messages.addedToCart'));
  }

  removeSelected(): void {
    const ids = Array.from(this.selected);
    if (!ids.length) return;
    if (!confirm(this.translate.instant('account.wishlist.confirm.removeSelected'))) return;
    this.bulkBusy = true;
    forkJoin(ids.map((id) => this.account.wishlist.remove(id).pipe(catchError(() => of(undefined)))))
      .pipe(
        finalize(() => {
          this.bulkBusy = false;
          this.clearSelection();
        })
      )
      .subscribe({
        next: () => {
          for (const id of ids) this.account.wishlist.removeLocal(id);
          this.toast.success(this.translate.instant('account.wishlist.messages.removedSelected'));
        }
      });
  }

  isOutOfStock(item: Product): boolean {
    const stock = item.stock_quantity ?? 0;
    const allowBackorder = Boolean(item.allow_backorder);
    return stock <= 0 && !allowBackorder;
  }

  private ensureBackInStockStatus(item: Product): void {
    if (!this.isOutOfStock(item)) return;
    if (this.backInStockById.has(item.id)) return;
    if (this.backInStockBusy.has(item.id)) return;
    this.backInStockBusy.add(item.id);
    this.catalog
      .getBackInStockStatus(item.slug)
      .pipe(finalize(() => this.backInStockBusy.delete(item.id)))
      .subscribe({
        next: (status) => {
          this.backInStockById.set(item.id, status);
        }
      });
  }

  backInStockRequest(item: Product): BackInStockRequest | null {
    this.ensureBackInStockStatus(item);
    return this.backInStockById.get(item.id)?.request ?? null;
  }

  isBackInStockBusy(item: Product): boolean {
    return this.backInStockBusy.has(item.id);
  }

  requestBackInStock(item: Product): void {
    if (!this.isOutOfStock(item)) return;
    if (this.backInStockRequest(item)) return;
    if (this.backInStockBusy.has(item.id)) return;
    this.backInStockBusy.add(item.id);
    this.catalog
      .requestBackInStock(item.slug)
      .pipe(finalize(() => this.backInStockBusy.delete(item.id)))
      .subscribe({
        next: (req) => {
          this.backInStockById.set(item.id, { in_stock: false, request: req });
          this.toast.success(
            this.translate.instant('product.notifyRequestedTitle'),
            this.translate.instant('product.notifyRequestedBody', { name: item.name })
          );
        },
        error: () => {
          this.toast.error(this.translate.instant('product.loadErrorTitle'), this.translate.instant('product.loadErrorCopy'));
        }
      });
  }

  cancelBackInStock(item: Product): void {
    const existing = this.backInStockRequest(item);
    if (!existing) return;
    if (this.backInStockBusy.has(item.id)) return;
    this.backInStockBusy.add(item.id);
    this.catalog
      .cancelBackInStock(item.slug)
      .pipe(finalize(() => this.backInStockBusy.delete(item.id)))
      .subscribe({
        next: () => {
          this.backInStockById.set(item.id, { in_stock: false, request: null });
          this.toast.success(
            this.translate.instant('product.notifyCanceledTitle'),
            this.translate.instant('product.notifyCanceledBody', { name: item.name })
          );
        },
        error: () => {
          this.toast.error(this.translate.instant('product.loadErrorTitle'), this.translate.instant('product.loadErrorCopy'));
        }
      });
  }

  priceChange(item: Product): {
    direction: 'up' | 'down';
    delta: number;
  } | null {
    const baseline = this.account.wishlist.getBaseline(item.id);
    if (!baseline) return null;
    const current = this.account.wishlist.effectivePrice(item);
    const prev = baseline.price;
    if (!Number.isFinite(current) || !Number.isFinite(prev)) return null;
    const diff = Number(current) - Number(prev);
    if (Math.abs(diff) < 0.01) return null;
    return { direction: diff > 0 ? 'up' : 'down', delta: Math.abs(diff) };
  }

  stockChange(item: Product): 'back' | 'out' | null {
    const baseline = this.account.wishlist.getBaseline(item.id);
    if (!baseline || baseline.stock_quantity == null) return null;
    const savedInStock = baseline.stock_quantity > 0;
    const currentInStock = (item.stock_quantity ?? 0) > 0 || Boolean(item.allow_backorder);
    if (savedInStock && !currentInStock) return 'out';
    if (!savedInStock && currentInStock) return 'back';
    return null;
  }
}
