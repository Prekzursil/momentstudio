import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ButtonComponent } from '../../shared/button.component';
import { CardComponent } from '../../shared/card.component';
import { ContainerComponent } from '../../layout/container.component';
import { CatalogService, Product } from '../../core/catalog.service';
import { ProductCardComponent } from '../../shared/product-card.component';
import { SkeletonComponent } from '../../shared/skeleton.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, ButtonComponent, CardComponent, ContainerComponent, ProductCardComponent, SkeletonComponent],
  template: `
    <section class="grid gap-10">
      <div class="grid gap-6 lg:grid-cols-[1.2fr_1fr] items-center">
        <div class="grid gap-4">
          <p class="uppercase text-sm tracking-[0.3em] text-slate-500">Handcrafted ceramic art</p>
          <h1 class="text-3xl sm:text-4xl lg:text-5xl font-semibold leading-tight text-slate-900">
            Build the AdrianaArt storefront experience.
          </h1>
          <p class="text-lg text-slate-600">
            A crisp Angular starter with Tailwind design tokens, shared components, and a responsive shell ready
            for product, cart, and content flows.
          </p>
          <div class="flex flex-wrap gap-3">
            <app-button label="Shop now" [routerLink]="['/shop']"></app-button>
            <app-button label="View admin" variant="ghost" [routerLink]="['/admin']"></app-button>
          </div>
        </div>
        <div class="relative">
          <div class="absolute -inset-4 rounded-3xl bg-slate-900/5 blur-xl"></div>
          <app-card class="relative">
            <div class="aspect-video rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 grid place-items-center text-white text-xl font-semibold">
              Hero image slot
            </div>
          </app-card>
        </div>
      </div>

      <div class="grid gap-4">
        <div class="flex items-center justify-between">
          <h2 class="text-xl font-semibold text-slate-900">Featured pieces</h2>
          <app-button label="View all" variant="ghost" [routerLink]="['/shop']"></app-button>
        </div>

        <div *ngIf="featuredLoading()" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <app-skeleton *ngFor="let i of skeletons" height="260px"></app-skeleton>
        </div>

        <div
          *ngIf="featuredError()"
          class="border border-amber-200 bg-amber-50 rounded-2xl p-4 flex items-center justify-between"
        >
          <div>
            <p class="font-semibold text-amber-900">Could not load featured products.</p>
            <p class="text-sm text-amber-800">Check your connection and retry.</p>
          </div>
          <app-button label="Retry" size="sm" (action)="loadFeatured()"></app-button>
        </div>

        <div *ngIf="!featuredLoading() && !featuredError() && featured.length" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <app-product-card *ngFor="let product of featured" [product]="product"></app-product-card>
        </div>

        <div *ngIf="!featuredLoading() && !featuredError() && !featured.length" class="text-sm text-slate-600">
          No featured products right now.
        </div>
      </div>

      <div class="grid gap-4">
        <h2 class="text-xl font-semibold text-slate-900">Why this starter</h2>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <app-card title="Strict TS">
            <p>Angular standalone setup with strict TypeScript and routing baked in.</p>
          </app-card>
          <app-card title="Tailwind design tokens">
            <p>Utility-first styling with a small token palette to keep UI consistent.</p>
          </app-card>
          <app-card title="Shared primitives">
            <p>Buttons, inputs, cards, modals, and toast scaffolding ready to wire.</p>
          </app-card>
          <app-card title="Resilient shell">
            <p>Global error route, responsive header/footer, and space for store pages.</p>
          </app-card>
        </div>
      </div>
    </section>
  `
})
export class HomeComponent implements OnInit {
  featured: Product[] = [];
  featuredLoading = signal<boolean>(true);
  featuredError = signal<boolean>(false);
  skeletons = Array.from({ length: 3 });

  constructor(private catalog: CatalogService) {}

  ngOnInit(): void {
    this.loadFeatured();
  }

  loadFeatured(): void {
    this.featuredLoading.set(true);
    this.featuredError.set(false);
    this.catalog
      .listProducts({
        is_featured: true,
        limit: 6,
        sort: 'newest',
        page: 1
      })
      .subscribe({
        next: (resp) => {
          this.featured = resp.items;
          this.featuredLoading.set(false);
        },
        error: () => {
          this.featured = [];
          this.featuredLoading.set(false);
          this.featuredError.set(true);
        }
      });
  }
}
