import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ButtonComponent } from '../../shared/button.component';
import { CardComponent } from '../../shared/card.component';
import { ContainerComponent } from '../../layout/container.component';
import { CatalogService, Product } from '../../core/catalog.service';
import { ProductCardComponent } from '../../shared/product-card.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Meta, Title } from '@angular/platform-browser';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, ButtonComponent, CardComponent, ContainerComponent, ProductCardComponent, SkeletonComponent, TranslateModule],
  template: `
    <section class="grid gap-10">
      <div class="grid gap-6 lg:grid-cols-[1.2fr_1fr] items-center">
        <div class="grid gap-4">
          <p class="uppercase text-sm tracking-[0.3em] text-slate-500">{{ 'app.tagline' | translate }}</p>
          <h1 class="text-3xl sm:text-4xl lg:text-5xl font-semibold leading-tight text-slate-900">
            {{ 'home.headline' | translate }}
          </h1>
          <p class="text-lg text-slate-600">{{ 'home.subhead' | translate }}</p>
          <div class="flex flex-wrap gap-3">
            <app-button [label]="'home.ctaShop' | translate" [routerLink]="['/shop']"></app-button>
            <app-button [label]="'home.ctaAdmin' | translate" variant="ghost" [routerLink]="['/admin']"></app-button>
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
          <h2 class="text-xl font-semibold text-slate-900">{{ 'home.featured' | translate }}</h2>
          <app-button [label]="'home.viewAll' | translate" variant="ghost" [routerLink]="['/shop']"></app-button>
        </div>

        <div *ngIf="featuredLoading()" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <app-skeleton *ngFor="let i of skeletons" height="260px"></app-skeleton>
        </div>

          <div *ngIf="featuredError()" class="border border-amber-200 bg-amber-50 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p class="font-semibold text-amber-900">{{ 'home.featuredError.title' | translate }}</p>
              <p class="text-sm text-amber-800">{{ 'home.featuredError.copy' | translate }}</p>
            </div>
            <app-button [label]="'shop.retry' | translate" size="sm" (action)="loadFeatured()"></app-button>
          </div>

        <div *ngIf="!featuredLoading() && !featuredError() && featured.length" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <app-product-card *ngFor="let product of featured" [product]="product"></app-product-card>
        </div>

        <div *ngIf="!featuredLoading() && !featuredError() && !featured.length" class="text-sm text-slate-600">
          {{ 'home.noFeatured' | translate }}
        </div>
      </div>

      <div class="grid gap-4">
        <h2 class="text-xl font-semibold text-slate-900">{{ 'home.why' | translate }}</h2>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <app-card [title]="'home.cards.strictTitle' | translate">
            <p>{{ 'home.cards.strict' | translate }}</p>
          </app-card>
          <app-card [title]="'home.cards.tokensTitle' | translate">
            <p>{{ 'home.cards.tokens' | translate }}</p>
          </app-card>
          <app-card [title]="'home.cards.primitivesTitle' | translate">
            <p>{{ 'home.cards.primitives' | translate }}</p>
          </app-card>
          <app-card [title]="'home.cards.shellTitle' | translate">
            <p>{{ 'home.cards.shell' | translate }}</p>
          </app-card>
        </div>
      </div>
    </section>
  `
})
export class HomeComponent implements OnInit, OnDestroy {
  featured: Product[] = [];
  featuredLoading = signal<boolean>(true);
  featuredError = signal<boolean>(false);
  skeletons = Array.from({ length: 3 });

  private langSub?: Subscription;

  constructor(
    private catalog: CatalogService,
    private title: Title,
    private meta: Meta,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.setMetaTags();
    this.langSub = this.translate.onLangChange.subscribe(() => this.setMetaTags());
    this.loadFeatured();
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
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

  private setMetaTags(): void {
    const title = this.translate.instant('home.metaTitle');
    const description = this.translate.instant('home.metaDescription');
    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
  }
}
