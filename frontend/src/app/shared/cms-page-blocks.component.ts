import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { BannerBlockComponent } from './banner-block.component';
import { ButtonComponent } from './button.component';
import { CarouselBlockComponent } from './carousel-block.component';
import { CmsFormBlockComponent } from './cms-form-block.component';
import { CmsProductGridBlockComponent } from './cms-product-grid-block.component';
import {
  ColumnsBreakpoint,
  ColumnsCount,
  PageBlock,
  pageBlockInnerClasses,
  pageBlockOuterClasses
} from './page-blocks';

@Component({
  selector: 'app-cms-page-blocks',
  standalone: true,
  imports: [CommonModule, ButtonComponent, BannerBlockComponent, CarouselBlockComponent, CmsProductGridBlockComponent, CmsFormBlockComponent],
  template: `
    <div class="grid gap-6">
      <ng-container *ngFor="let b of blocks">
        <div class="w-full" [ngClass]="pageBlockOuterClasses(b.layout)">
          <div [ngClass]="pageBlockInnerClasses(b.layout)">
            <ng-container [ngSwitch]="b.type">
              <div *ngSwitchCase="'text'" class="grid gap-2">
                <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                  {{ b.title }}
                </h2>
                <div class="markdown text-lg text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="b.body_html"></div>
              </div>

              <div *ngSwitchCase="'cta'" class="grid gap-3">
                <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                  {{ b.title }}
                </h2>
                <div class="markdown text-lg text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="b.body_html"></div>
                <div class="flex" *ngIf="b.cta_label && b.cta_url">
                  <ng-container *ngIf="isExternalHttpUrl(b.cta_url); else internalCta">
                    <a
                      class="inline-flex items-center justify-center rounded-full font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 bg-slate-900 text-white hover:bg-slate-800 focus-visible:outline-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white px-4 py-2.5 text-sm"
                      [href]="b.cta_url"
                      [attr.target]="b.cta_new_tab ? '_blank' : null"
                      [attr.rel]="b.cta_new_tab ? 'noopener noreferrer' : null"
                    >
                      {{ b.cta_label }}
                    </a>
                  </ng-container>
                  <ng-template #internalCta>
                    <app-button [label]="b.cta_label" [routerLink]="b.cta_url"></app-button>
                  </ng-template>
                </div>
              </div>

              <div *ngSwitchCase="'product_grid'" class="grid gap-3">
                <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                  {{ b.title }}
                </h2>
                <app-cms-product-grid-block [block]="b"></app-cms-product-grid-block>
              </div>

              <app-cms-form-block *ngSwitchCase="'form'" [block]="b"></app-cms-form-block>

              <div *ngSwitchCase="'faq'" class="grid gap-3">
                <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                  {{ b.title }}
                </h2>
                <div class="grid gap-2">
                  <details
                    *ngFor="let item of b.items"
                    class="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
                  >
                    <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
                      {{ item.question }}
                    </summary>
                    <div class="mt-2 markdown text-base text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="item.answer_html"></div>
                  </details>
                </div>
              </div>

              <div *ngSwitchCase="'testimonials'" class="grid gap-3">
                <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                  {{ b.title }}
                </h2>
                <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div *ngFor="let t of b.items" class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <div class="markdown text-lg text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="t.quote_html"></div>
                    <p *ngIf="t.author || t.role" class="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-50">
                      <span *ngIf="t.author">{{ t.author }}</span>
                      <span *ngIf="t.author && t.role"> · </span>
                      <span *ngIf="t.role" class="font-normal text-slate-500 dark:text-slate-400">{{ t.role }}</span>
                    </p>
                  </div>
                </div>
              </div>

              <div *ngSwitchCase="'image'" class="grid gap-2">
                <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                  {{ b.title }}
                </h2>
                <a *ngIf="b.link_url; else plainImage" class="block" [href]="b.link_url" target="_blank" rel="noopener noreferrer">
                  <img
                    [src]="b.url"
                    [alt]="b.alt || b.title || ''"
                    class="w-full rounded-2xl border border-slate-200 bg-slate-50 object-cover dark:border-slate-800 dark:bg-slate-800"
                    [style.object-position]="focalPosition(b.focal_x, b.focal_y)"
                    loading="lazy"
                  />
                </a>
                <ng-template #plainImage>
                  <img
                    [src]="b.url"
                    [alt]="b.alt || b.title || ''"
                    class="w-full rounded-2xl border border-slate-200 bg-slate-50 object-cover dark:border-slate-800 dark:bg-slate-800"
                    [style.object-position]="focalPosition(b.focal_x, b.focal_y)"
                    loading="lazy"
                  />
                </ng-template>
                <p *ngIf="b.caption" class="text-sm text-slate-600 dark:text-slate-300">{{ b.caption }}</p>
              </div>

              <div *ngSwitchCase="'gallery'" class="grid gap-2">
                <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                  {{ b.title }}
                </h2>
                <div class="grid gap-3 sm:grid-cols-2">
                  <div *ngFor="let img of b.images" class="grid gap-2">
                    <img
                      [src]="img.url"
                      [alt]="img.alt || b.title || ''"
                      class="w-full rounded-2xl border border-slate-200 bg-slate-50 object-cover dark:border-slate-800 dark:bg-slate-800"
                      [style.object-position]="focalPosition(img.focal_x, img.focal_y)"
                      loading="lazy"
                    />
                    <p *ngIf="img.caption" class="text-sm text-slate-600 dark:text-slate-300">{{ img.caption }}</p>
                  </div>
                </div>
              </div>

              <div *ngSwitchCase="'banner'" class="grid gap-2">
                <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                  {{ b.title }}
                </h2>
                <app-banner-block [slide]="b.slide"></app-banner-block>
              </div>

              <div *ngSwitchCase="'carousel'" class="grid gap-2">
                <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                  {{ b.title }}
                </h2>
                <app-carousel-block [slides]="b.slides" [settings]="b.settings"></app-carousel-block>
              </div>

              <div *ngSwitchCase="'columns'" class="grid gap-2">
                <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                  {{ b.title }}
                </h2>
                <div [ngClass]="columnsGridClasses(b)">
                  <div *ngFor="let col of b.columns" class="grid gap-2">
                    <h3 *ngIf="col.title" class="text-lg font-semibold text-slate-900 dark:text-slate-50">
                      {{ col.title }}
                    </h3>
                    <div class="markdown text-lg text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="col.body_html"></div>
                  </div>
                </div>
              </div>
            </ng-container>
          </div>
        </div>
      </ng-container>
    </div>
  `
})
export class CmsPageBlocksComponent {
  @Input({ required: true }) blocks: PageBlock[] = [];

  pageBlockOuterClasses = pageBlockOuterClasses;
  pageBlockInnerClasses = pageBlockInnerClasses;

  isExternalHttpUrl(url: string | null | undefined): boolean {
    const trimmed = (url || '').trim().toLowerCase();
    return trimmed.startsWith('http://') || trimmed.startsWith('https://');
  }

  focalPosition(focalX?: number, focalY?: number): string {
    const x = Math.max(0, Math.min(100, Math.round(Number(focalX ?? 50))));
    const y = Math.max(0, Math.min(100, Math.round(Number(focalY ?? 50))));
    return `${x}% ${y}%`;
  }

  columnsGridClasses(block: PageBlock): string {
    if (block.type !== 'columns') return '';
    const count: ColumnsCount = block.columns_count;
    const breakpoint: ColumnsBreakpoint = block.breakpoint;
    const matrix: Record<ColumnsCount, Record<ColumnsBreakpoint, string>> = {
      2: { sm: 'sm:grid-cols-2', md: 'md:grid-cols-2', lg: 'lg:grid-cols-2' },
      3: { sm: 'sm:grid-cols-3', md: 'md:grid-cols-3', lg: 'lg:grid-cols-3' }
    };
    return ['grid', 'gap-6', 'grid-cols-1', matrix[count][breakpoint]].join(' ');
  }
}
