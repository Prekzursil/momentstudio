import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Slide } from './page-blocks';
import { ButtonComponent } from './button.component';

@Component({
  selector: 'app-banner-block',
  standalone: true,
  imports: [CommonModule, RouterLink, ButtonComponent],
  template: `
    <div class="grid gap-6" [ngClass]="wrapperClass()">
      <ng-container *ngIf="slide.variant === 'split'; else fullTpl">
        <div class="grid gap-6 lg:gap-10 lg:grid-cols-[1fr_1.4fr] items-start">
          <div class="grid gap-4">
            <p *ngIf="tagline" class="font-cinzel font-semibold text-[28px] tracking-[0.3em] text-slate-500 dark:text-slate-400">
              {{ tagline }}
            </p>
            <h2 *ngIf="slide.headline" class="text-3xl sm:text-4xl lg:text-5xl font-semibold leading-tight text-slate-900 dark:text-slate-50">
              {{ slide.headline }}
            </h2>
            <p *ngIf="slide.subheadline" class="text-lg text-slate-600 dark:text-slate-300">
              {{ slide.subheadline }}
            </p>
            <div class="flex flex-wrap gap-3" *ngIf="slide.cta_label && slide.cta_url">
              <ng-container *ngIf="isInternalUrl(slide.cta_url); else externalCta">
                <app-button [label]="slide.cta_label" [routerLink]="slide.cta_url"></app-button>
              </ng-container>
              <ng-template #externalCta>
                <app-button
                  [label]="slide.cta_label"
                  [href]="slide.cta_url"
                  target="_blank"
                  rel="noopener noreferrer"
                ></app-button>
              </ng-template>
            </div>
          </div>

          <div class="relative">
            <ng-container *ngIf="imageUrl(); else splitPlaceholder">
              <ng-container *ngIf="useOptimizedAsset(); else splitPlainImage">
                <picture class="block">
                  <source type="image/avif" [attr.srcset]="optimizedSrcset('avif')" [attr.sizes]="splitSizes()" />
                  <source type="image/webp" [attr.srcset]="optimizedSrcset('webp')" [attr.sizes]="splitSizes()" />
                  <img
                    [ngClass]="imageClass()"
                    [src]="imageUrl()"
                    [attr.srcset]="optimizedSrcset('jpg')"
                    [attr.sizes]="splitSizes()"
                    [alt]="slide.alt || slide.headline || ''"
                    [style.object-position]="focalPosition()"
                    [attr.loading]="tagline ? 'eager' : 'lazy'"
                    [attr.fetchpriority]="tagline ? 'high' : null"
                    decoding="async"
                  />
                </picture>
              </ng-container>
              <ng-template #splitPlainImage>
                <img
                  [ngClass]="imageClass()"
                  [src]="imageUrl()"
                  [alt]="slide.alt || slide.headline || ''"
                  [style.object-position]="focalPosition()"
                  [attr.loading]="tagline ? 'eager' : 'lazy'"
                  [attr.fetchpriority]="tagline ? 'high' : null"
                  decoding="async"
                />
              </ng-template>
            </ng-container>
            <ng-template #splitPlaceholder>
              <div
                [ngClass]="imageClass()"
                class="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 grid place-items-center text-white text-xl font-semibold"
              >
                Banner image slot
              </div>
            </ng-template>
          </div>
        </div>
      </ng-container>

      <ng-template #fullTpl>
        <div class="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <ng-container *ngIf="imageUrl(); else fullPlaceholder">
            <ng-container *ngIf="useOptimizedAsset(); else fullPlainImage">
              <picture class="block">
                <source type="image/avif" [attr.srcset]="optimizedSrcset('avif')" [attr.sizes]="fullSizes()" />
                <source type="image/webp" [attr.srcset]="optimizedSrcset('webp')" [attr.sizes]="fullSizes()" />
                <img
                  [ngClass]="fullImageClass()"
                  [src]="imageUrl()"
                  [attr.srcset]="optimizedSrcset('jpg')"
                  [attr.sizes]="fullSizes()"
                  [alt]="slide.alt || slide.headline || ''"
                  [style.object-position]="focalPosition()"
                  [attr.loading]="tagline ? 'eager' : 'lazy'"
                  [attr.fetchpriority]="tagline ? 'high' : null"
                  decoding="async"
                />
              </picture>
            </ng-container>
            <ng-template #fullPlainImage>
              <img
                [ngClass]="fullImageClass()"
                [src]="imageUrl()"
                [alt]="slide.alt || slide.headline || ''"
                [style.object-position]="focalPosition()"
                [attr.loading]="tagline ? 'eager' : 'lazy'"
                [attr.fetchpriority]="tagline ? 'high' : null"
                decoding="async"
              />
            </ng-template>
          </ng-container>
          <ng-template #fullPlaceholder>
            <div
              [ngClass]="fullImageClass()"
              class="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 grid place-items-center text-white text-xl font-semibold"
            >
              Banner image slot
            </div>
          </ng-template>

          <div class="absolute inset-0" [ngClass]="overlayClass()"></div>
          <div class="absolute inset-0 p-6 sm:p-10 flex items-end">
            <div class="grid gap-3 max-w-2xl">
              <p *ngIf="tagline" class="font-cinzel font-semibold text-[18px] tracking-[0.3em]" [ngClass]="textClass()">
                {{ tagline }}
              </p>
              <h2 *ngIf="slide.headline" class="text-3xl sm:text-4xl font-semibold leading-tight" [ngClass]="textClass()">
                {{ slide.headline }}
              </h2>
              <p *ngIf="slide.subheadline" class="text-base sm:text-lg" [ngClass]="subTextClass()">
                {{ slide.subheadline }}
              </p>
              <div class="flex flex-wrap gap-3" *ngIf="slide.cta_label && slide.cta_url">
                <ng-container *ngIf="isInternalUrl(slide.cta_url); else externalFullCta">
                  <app-button [label]="slide.cta_label" [routerLink]="slide.cta_url"></app-button>
                </ng-container>
                <ng-template #externalFullCta>
                  <app-button
                    [label]="slide.cta_label"
                    [href]="slide.cta_url"
                    target="_blank"
                    rel="noopener noreferrer"
                  ></app-button>
                </ng-template>
              </div>
            </div>
          </div>
        </div>
      </ng-template>
    </div>
  `
})
export class BannerBlockComponent {
  @Input({ required: true }) slide!: Slide;
  @Input() tagline: string | null = null;

  private static readonly OPTIMIZED_WIDTHS = [640, 960, 1280] as const;
  private static readonly OPTIMIZED_ASSET_PREFIX = 'assets/home/banner_image';
  private static readonly OPTIMIZED_JPEG_FALLBACK = 'assets/home/banner_image.jpeg';

  isInternalUrl(url: string | null | undefined): boolean {
    const trimmed = (url || '').trim();
    return Boolean(trimmed && trimmed.startsWith('/') && !trimmed.startsWith('//'));
  }

  wrapperClass(): string {
    return '';
  }

  imageUrl(): string {
    return (this.slide?.image_url || '').trim();
  }

  private normalizeAssetUrl(url: string): string {
    const trimmed = (url || '').trim();
    return trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  }

  useOptimizedAsset(): boolean {
    const normalized = this.normalizeAssetUrl(this.imageUrl());
    return (
      normalized === BannerBlockComponent.OPTIMIZED_JPEG_FALLBACK || normalized.startsWith(`${BannerBlockComponent.OPTIMIZED_ASSET_PREFIX}-`)
    );
  }

  optimizedSrcset(format: 'avif' | 'webp' | 'jpg'): string {
    if (!this.useOptimizedAsset()) return '';
    const entries = BannerBlockComponent.OPTIMIZED_WIDTHS.map((width) => {
      if (format === 'jpg' && width === 1280) return `${BannerBlockComponent.OPTIMIZED_JPEG_FALLBACK} ${width}w`;
      const ext = format === 'jpg' ? 'jpg' : format;
      return `${BannerBlockComponent.OPTIMIZED_ASSET_PREFIX}-${width}.${ext} ${width}w`;
    });
    return entries.join(', ');
  }

  splitSizes(): string {
    return '(min-width: 1024px) 680px, 100vw';
  }

  fullSizes(): string {
    return '(min-width: 1024px) 1152px, 100vw';
  }

  private sizeToken(): 'S' | 'M' | 'L' {
    return this.slide?.size === 'S' || this.slide?.size === 'L' ? this.slide.size : 'M';
  }

  imageClass(): string {
    const size = this.sizeToken();
    const aspect = size === 'S' ? 'aspect-[16/8]' : size === 'L' ? 'aspect-[5/4]' : 'aspect-video';
    return `${aspect} w-full rounded-2xl object-cover`;
  }

  fullImageClass(): string {
    const size = this.sizeToken();
    const aspect = size === 'S' ? 'aspect-[16/5]' : size === 'L' ? 'aspect-[16/7]' : 'aspect-video';
    return `${aspect} w-full object-cover`;
  }

  focalPosition(): string {
    const x = Math.max(0, Math.min(100, Math.round(Number(this.slide?.focal_x ?? 50))));
    const y = Math.max(0, Math.min(100, Math.round(Number(this.slide?.focal_y ?? 50))));
    return `${x}% ${y}%`;
  }

  overlayClass(): string {
    return this.slide.text_style === 'light'
      ? 'bg-gradient-to-t from-slate-900/70 via-slate-900/30 to-transparent'
      : 'bg-gradient-to-t from-white/80 via-white/20 to-transparent dark:from-slate-900/70 dark:via-slate-900/30';
  }

  textClass(): string {
    return this.slide.text_style === 'light' ? 'text-white' : 'text-slate-900 dark:text-slate-50';
  }

  subTextClass(): string {
    return this.slide.text_style === 'light' ? 'text-slate-100' : 'text-slate-700 dark:text-slate-200';
  }
}
