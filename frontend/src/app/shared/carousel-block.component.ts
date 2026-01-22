import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { BannerBlockComponent } from './banner-block.component';
import { CarouselSettings, Slide } from './page-blocks';

@Component({
  selector: 'app-carousel-block',
  standalone: true,
  imports: [CommonModule, BannerBlockComponent],
  template: `
    <div
      class="relative"
      (mouseenter)="onHover(true)"
      (mouseleave)="onHover(false)"
    >
      <app-banner-block
        *ngIf="activeSlide() as slide"
        [slide]="slide"
        [tagline]="tagline"
      ></app-banner-block>

      <button
        *ngIf="settings.show_arrows && slides.length > 1"
        type="button"
        class="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-slate-200 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm backdrop-blur hover:bg-white dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-50 dark:hover:bg-slate-900"
        (click)="prev()"
        aria-label="Previous slide"
      >
        ‹
      </button>
      <button
        *ngIf="settings.show_arrows && slides.length > 1"
        type="button"
        class="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-slate-200 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm backdrop-blur hover:bg-white dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-50 dark:hover:bg-slate-900"
        (click)="next()"
        aria-label="Next slide"
      >
        ›
      </button>

      <div
        *ngIf="settings.show_dots && slides.length > 1"
        class="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-2 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/70"
      >
        <button
          *ngFor="let s of slides; let idx = index"
          type="button"
          class="h-2.5 w-2.5 rounded-full transition"
          [ngClass]="idx === activeIndex ? 'bg-slate-900 dark:bg-slate-50' : 'bg-slate-300 hover:bg-slate-400 dark:bg-slate-600 dark:hover:bg-slate-500'"
          (click)="goTo(idx)"
          [attr.aria-label]="'Go to slide ' + (idx + 1)"
          [attr.aria-current]="idx === activeIndex ? 'true' : null"
        ></button>
      </div>
    </div>
  `
})
export class CarouselBlockComponent implements OnInit, OnDestroy {
  @Input({ required: true }) slides: Slide[] = [];
  @Input() settings: CarouselSettings = {
    autoplay: false,
    interval_ms: 5000,
    show_dots: true,
    show_arrows: true,
    pause_on_hover: true
  };
  @Input() tagline: string | null = null;

  activeIndex = 0;
  private timer?: ReturnType<typeof setInterval>;
  private hovered = false;

  ngOnInit(): void {
    this.activeIndex = 0;
    this.startAutoplay();
  }

  ngOnDestroy(): void {
    this.stopAutoplay();
  }

  activeSlide(): Slide | null {
    if (!this.slides.length) return null;
    const idx = Math.max(0, Math.min(this.activeIndex, this.slides.length - 1));
    return this.slides[idx] ?? null;
  }

  goTo(index: number): void {
    if (!this.slides.length) return;
    const next = Math.max(0, Math.min(index, this.slides.length - 1));
    this.activeIndex = next;
    this.restartAutoplay();
  }

  prev(): void {
    if (!this.slides.length) return;
    this.activeIndex = (this.activeIndex - 1 + this.slides.length) % this.slides.length;
    this.restartAutoplay();
  }

  next(): void {
    if (!this.slides.length) return;
    this.activeIndex = (this.activeIndex + 1) % this.slides.length;
    this.restartAutoplay();
  }

  onHover(value: boolean): void {
    this.hovered = value;
    if (this.settings.pause_on_hover) {
      if (this.hovered) this.stopAutoplay();
      else this.startAutoplay();
    }
  }

  private startAutoplay(): void {
    this.stopAutoplay();
    if (!this.settings.autoplay) return;
    if (this.settings.pause_on_hover && this.hovered) return;
    if (this.slides.length < 2) return;
    const interval = Math.max(1000, Number(this.settings.interval_ms) || 5000);
    this.timer = setInterval(() => this.next(), interval);
  }

  private stopAutoplay(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private restartAutoplay(): void {
    this.startAutoplay();
  }
}

