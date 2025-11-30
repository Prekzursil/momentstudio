import { Component, OnInit } from '@angular/core';
import { ContainerComponent } from '../../layout/container.component';
import { CardComponent } from '../../shared/card.component';
import { LazyImageDirective } from '../../shared/lazy-image.directive';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { SpinnerComponent } from '../../shared/spinner.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';

interface Product {
  title: string;
  price: string;
  image: string;
  tag?: string;
}

@Component({
  selector: 'app-shop',
  standalone: true,
  imports: [
    ContainerComponent,
    CardComponent,
    LazyImageDirective,
    SkeletonComponent,
    SpinnerComponent,
    BreadcrumbComponent
  ],
  template: `
    <app-container class="grid gap-8">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <section class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Featured</p>
          <h2 class="text-2xl font-semibold text-slate-900">Customer favorites</h2>
        </div>
      </section>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <ng-container *ngIf="loading; else productGrid">
          <app-card *ngFor="let _ of placeholders">
            <app-skeleton height="180px"></app-skeleton>
            <div class="mt-3 grid gap-2">
              <app-skeleton width="70%" height="1rem"></app-skeleton>
              <app-skeleton width="40%" height="1rem"></app-skeleton>
            </div>
          </app-card>
        </ng-container>
        <ng-template #productGrid>
          <app-card *ngFor="let product of featured">
            <div class="rounded-xl overflow-hidden bg-slate-100">
              <img
                appLazyImage="{{ product.image }}"
                [alt]="product.title"
                class="w-full h-40 object-cover opacity-0"
              />
            </div>
            <div class="mt-3 grid gap-1">
              <p class="font-semibold text-slate-900">{{ product.title }}</p>
              <p class="text-slate-600">{{ product.price }}</p>
              <span *ngIf="product.tag" class="inline-flex text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded-full">
                {{ product.tag }}
              </span>
            </div>
          </app-card>
        </ng-template>
      </div>

      <section class="grid gap-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm uppercase tracking-[0.3em] text-slate-500">Catalog</p>
            <h2 class="text-xl font-semibold text-slate-900">Browse by category</h2>
          </div>
          <div class="text-sm text-slate-600">Page {{ page }} / {{ totalPages }}</div>
        </div>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <app-card *ngFor="let product of pagedProducts">
            <div class="rounded-xl overflow-hidden bg-slate-100">
              <img appLazyImage="{{ product.image }}" [alt]="product.title" class="w-full h-36 object-cover opacity-0" />
            </div>
            <div class="mt-2 font-semibold text-slate-900">{{ product.title }}</div>
            <div class="text-slate-600">{{ product.price }}</div>
          </app-card>
        </div>
        <div class="flex items-center justify-between">
          <button class="text-sm font-semibold text-slate-700 hover:text-slate-900" (click)="prevPage()" [disabled]="page === 1">
            ← Previous
          </button>
          <button
            class="text-sm font-semibold text-slate-700 hover:text-slate-900"
            (click)="nextPage()"
            [disabled]="page === totalPages"
          >
            Next →
          </button>
        </div>
      </section>
    </app-container>
  `
})
export class ShopComponent implements OnInit {
  loading = true;
  crumbs = [
    { label: 'Home', url: '/' },
    { label: 'Shop', url: '/shop' },
    { label: 'Featured' }
  ];
  featured: Product[] = [];
  allProducts: Product[] = [];
  pagedProducts: Product[] = [];
  page = 1;
  pageSize = 6;
  totalPages = 1;
  placeholders = Array.from({ length: 6 });

  ngOnInit(): void {
    setTimeout(() => {
      this.featured = this.mockProducts().slice(0, 6);
      this.allProducts = this.mockProducts();
      this.totalPages = Math.ceil(this.allProducts.length / this.pageSize);
      this.setPage(1);
      this.loading = false;
    }, 500);
  }

  setPage(page: number): void {
    this.page = page;
    const start = (page - 1) * this.pageSize;
    this.pagedProducts = this.allProducts.slice(start, start + this.pageSize);
  }

  nextPage(): void {
    if (this.page < this.totalPages) this.setPage(this.page + 1);
  }

  prevPage(): void {
    if (this.page > 1) this.setPage(this.page - 1);
  }

  private mockProducts(): Product[] {
    return [
      { title: 'Ocean glaze cup', price: '$28', image: 'https://picsum.photos/seed/ocean/400/240', tag: 'Bestseller' },
      { title: 'Matte black bowl', price: '$32', image: 'https://picsum.photos/seed/bowl/400/240' },
      { title: 'Speckled mug', price: '$24', image: 'https://picsum.photos/seed/mug/400/240' },
      { title: 'Sculpted vase', price: '$58', image: 'https://picsum.photos/seed/vase/400/240', tag: 'New' },
      { title: 'Serving platter', price: '$45', image: 'https://picsum.photos/seed/platter/400/240' },
      { title: 'Teapot set', price: '$72', image: 'https://picsum.photos/seed/teapot/400/240' },
      { title: 'Minimal plate set', price: '$55', image: 'https://picsum.photos/seed/plate/400/240' },
      { title: 'Stoneware pitcher', price: '$38', image: 'https://picsum.photos/seed/pitcher/400/240' },
      { title: 'Candle holder duo', price: '$22', image: 'https://picsum.photos/seed/candle/400/240' }
    ];
  }
}
