import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, OnDestroy, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError, finalize, map } from 'rxjs/operators';

import { CatalogService, Product } from '../core/catalog.service';
import { ButtonComponent } from './button.component';
import { PageProductGridBlock } from './page-blocks';
import { ProductCardComponent } from './product-card.component';
import { SkeletonComponent } from './skeleton.component';

@Component({
  selector: 'app-cms-product-grid-block',
  standalone: true,
  imports: [CommonModule, TranslateModule, ButtonComponent, ProductCardComponent, SkeletonComponent],
  template: `
    <div class="grid gap-4">
      <div *ngIf="loading()" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <app-skeleton *ngFor="let i of skeletons" height="260px"></app-skeleton>
      </div>

      <div
        *ngIf="error()"
        class="border border-amber-200 bg-amber-50 rounded-2xl p-4 flex items-center justify-between dark:border-amber-900/40 dark:bg-amber-950/30"
      >
        <div>
          <p class="font-semibold text-amber-900 dark:text-amber-100">{{ 'page.blocks.productGrid.errorTitle' | translate }}</p>
          <p class="text-sm text-amber-800 dark:text-amber-200">{{ 'page.blocks.productGrid.errorCopy' | translate }}</p>
        </div>
        <app-button [label]="'shop.retry' | translate" size="sm" (action)="load()"></app-button>
      </div>

      <div *ngIf="!loading() && !error() && products().length" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <app-product-card *ngFor="let product of products(); trackBy: trackProduct" [product]="product"></app-product-card>
      </div>

      <div *ngIf="!loading() && !error() && !products().length" class="text-sm text-slate-600 dark:text-slate-300">
        {{ 'page.blocks.productGrid.empty' | translate }}
      </div>
    </div>
  `
})
export class CmsProductGridBlockComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) block!: PageProductGridBlock;

  products = signal<Product[]>([]);
  loading = signal(false);
  error = signal(false);
  skeletons: number[] = Array.from({ length: 6 }, (_, idx) => idx);

  private sub?: Subscription;

  constructor(private catalog: CatalogService) {}

  ngOnChanges(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  trackProduct(index: number, product: Product): string {
    return product.id || product.slug || String(index);
  }

  load(): void {
    this.sub?.unsubscribe();
    this.products.set([]);
    this.error.set(false);

    const block = this.block;
    if (!block) return;

    const desiredLimit = Number(block.limit ?? 6);
    const limit = Math.max(1, Math.min(24, Number.isFinite(desiredLimit) ? Math.round(desiredLimit) : 6));
    this.skeletons = Array.from({ length: Math.min(12, limit) }, (_, idx) => idx);

    const source = block.source;
    const categorySlug = (block.category_slug || '').trim();
    const collectionSlug = (block.collection_slug || '').trim();
    const manualSlugs = (block.product_slugs || []).map((s) => (s || '').trim()).filter(Boolean);

    const req =
      source === 'category' && categorySlug
        ? this.catalog.listProducts({ category_slug: categorySlug, limit }).pipe(map((res) => res.items || []))
        : source === 'collection' && collectionSlug
          ? this.catalog
            .listFeaturedCollections()
            .pipe(map((cols) => (cols || []).find((c) => c.slug === collectionSlug)?.products?.slice(0, limit) || []))
          : source === 'products' && manualSlugs.length
            ? forkJoin(
              manualSlugs.slice(0, limit).map((slug) =>
                this.catalog.getProduct(slug).pipe(
                  catchError(() => of(null))
                )
              )
            ).pipe(map((rows) => rows.filter((p): p is Product => Boolean(p))))
            : null;

    if (!req) return;

    this.loading.set(true);
    this.sub = req.pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (products) => {
        this.products.set(products);
        this.error.set(false);
      },
      error: () => {
        this.products.set([]);
        this.error.set(true);
      }
    });
  }
}
